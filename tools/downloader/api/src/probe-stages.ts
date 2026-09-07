/**
 * The probe stage hub: fan-out from one running probe to its SSE subscribers.
 *
 * `JobEventHub` is the model and not the implementation, for two reasons that
 * both come from a probe having no job behind it.
 *
 * **It buffers, where the job hub deliberately does not.** A client watching a
 * job that it joined late re-fetches the job and catches up; there is no
 * equivalent fetch for a probe, whose entire history is the frames themselves.
 * And the ordering is genuinely racy: the browser opens the `EventSource` and
 * POSTs the probe without waiting, so the first stages can be emitted before
 * anyone is attached. The buffer is replayed once, to the first subscriber, and
 * then abandoned — a second subscriber is a curiosity, not a case to serve.
 *
 * **Channels expire, where job subscriptions are bounded by the job store.** A
 * probe id is minted by the client and never written down anywhere, so nothing
 * else would ever reclaim one. Every channel carries a deadline and a lazy
 * sweep runs at the top of each public method, which keeps this free of timers
 * — a `setInterval` here would hold the event loop open at shutdown and would
 * have to be faked in every test that touches it.
 *
 * Delivery is best-effort, exactly as in the job hub: a listener that throws is
 * dropped rather than allowed to break the emit, and never allowed to reach the
 * probe it is narrating.
 */

import type { ProbeEvent, ProbeStageEvent } from "@downloader/contract";

export type ProbeEventListener = (event: ProbeEvent) => void;

export interface Unsubscribe {
  (): void;
}

/**
 * How long an idle channel survives. Comfortably longer than
 * `PROBE_TIMEOUT_MS`'s realistic ceiling, so a slow browser probe is never cut
 * off mid-narration, and short enough that an abandoned subscribe costs nothing
 * for long.
 */
export const CHANNEL_TTL_MS = 180_000;

/**
 * Grace after `done`, so a client whose `EventSource` lost the race still gets
 * the buffered stages and the terminator rather than an open socket.
 */
export const DONE_GRACE_MS = 5_000;

/**
 * Global cap on live channels. The probe endpoint is rate-limited per IP and
 * gated globally, so probes cannot outrun this.
 *
 * **The cap alone is not a defence, and an earlier draft of this comment said it
 * was.** The SSE endpoint carries no limiter, and subscribing creates a channel
 * — so 64 requests that connect and disconnect immediately used to occupy every
 * slot for a full `CHANNEL_TTL_MS`, with no socket held and nothing to reclaim
 * them. Measured at 64/64, with a subsequent real probe refused a channel. That
 * is what `Channel.claimed` exists to close.
 *
 * What remained after that, and what dl-46 closed: 64 *concurrently held*
 * connections still filled the cap, and the effect was that other users'
 * analyses ran unnarrated — the analysis itself is unaffected, since
 * `probeStages.open()` returning false only drops the narration. The SSE
 * endpoint now carries a per-IP bucket of its own
 * (`rateLimitProbeEventsPerMinute`, default 10/min), which bounds how fast one
 * address can acquire channels: a subscriber's socket is closed after
 * `CHANNEL_TTL_MS`, so what one address holds at once is what it can ask for in
 * that window — a full bucket's burst plus the refill, `perMinute * (1 + 3)`,
 * which is **40 of these 64** at the default. **The cap is still not the
 * defence on its own**; it is the ceiling the bucket keeps a single address
 * under. Both numbers are pinned together in `rate-limit.test.ts`, because
 * raising either one alone is what would quietly reopen this.
 */
export const MAX_CHANNELS = 64;

/** Frames held for a subscriber that has not attached yet. */
const MAX_BUFFERED = 32;

interface Channel {
  listeners: Set<ProbeEventListener>;
  buffer: ProbeEvent[];
  /** Buffering stops for good once anyone has attached. */
  replayed: boolean;
  /**
   * The probe is over. This is what stops a late subscriber from resetting the
   * deadline: touching a channel normally refreshes it, and a client attaching
   * after `done` would otherwise buy a finished probe another full TTL.
   */
  ended: boolean;
  /**
   * A probe opened this, rather than a subscriber having merely named it.
   *
   * An unclaimed channel is a promise nobody has kept: someone asked to watch an
   * analysis that has not been started and may never be. It is reclaimed the
   * moment its last listener goes, instead of waiting out `CHANNEL_TTL_MS` — see
   * `MAX_CHANNELS`. A claimed one is not, because there its listeners leaving is
   * ordinary (a tab closed mid-probe) and the probe still has stages to publish.
   */
  claimed: boolean;
  expiresAt: number;
}

export class ProbeStageHub {
  readonly #channels = new Map<string, Channel>();
  readonly #clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.#clock = clock;
  }

  get channelCount(): number {
    this.#sweep();
    return this.#channels.size;
  }

  subscriberCount(probeId: string): number {
    this.#sweep();
    return this.#channels.get(probeId)?.listeners.size ?? 0;
  }

  /**
   * Attaches a listener, replaying anything already buffered.
   *
   * Returns `null` when the cap is reached, which the route turns into a
   * refusal rather than an empty stream — a client told "no channel" can still
   * analyse the page, just without narration.
   */
  subscribe(probeId: string, listener: ProbeEventListener): Unsubscribe | null {
    this.#sweep();
    const channel = this.#open(probeId);
    if (channel === null) return null;

    const replay = channel.replayed ? [] : channel.buffer;
    channel.replayed = true;
    channel.buffer = [];
    channel.listeners.add(listener);

    for (const event of replay) {
      try {
        listener(event);
      } catch {
        channel.listeners.delete(listener);
        break;
      }
    }

    return () => {
      const current = this.#channels.get(probeId);
      if (current === undefined) return;
      current.listeners.delete(listener);
      // A channel nobody ever probed against, with nobody left watching it, is
      // reclaimed now rather than at its deadline. Leaving it was what let a
      // handful of one-shot GETs deny narration to everyone for three minutes.
      if (!current.claimed && current.listeners.size === 0) this.#channels.delete(probeId);
    };
  }

  /**
   * Opens a channel for a probe that is about to start. False when the cap is
   * reached, in which case the probe simply runs unnarrated — the analysis is
   * the product, the narration is not.
   */
  open(probeId: string): boolean {
    this.#sweep();
    const channel = this.#open(probeId);
    if (channel === null) return false;
    // From here the channel outlives its subscribers: there is a probe behind it
    // now, and a tab closed mid-analysis must not take the stream down for a
    // second one watching the same id.
    channel.claimed = true;
    return true;
  }

  stage(probeId: string, event: ProbeStageEvent): void {
    this.#emit(probeId, {
      type: "stage",
      probeId,
      stage: event.stage,
      resolver: event.resolver,
      at: this.#clock().toISOString(),
    });
  }

  /** The probe is over. Subscribers close on this frame; the channel goes shortly after. */
  done(probeId: string): void {
    const channel = this.#channels.get(probeId);
    if (channel === undefined) return;
    this.#emit(probeId, { type: "done", probeId, at: this.#clock().toISOString() });
    // Not deleted outright: a client that has not attached yet still has the
    // grace window to collect the buffer and this terminator.
    channel.ended = true;
    channel.expiresAt = this.#clock().getTime() + DONE_GRACE_MS;
  }

  heartbeat(probeId: string): void {
    this.#emit(probeId, { type: "heartbeat", at: this.#clock().toISOString() });
  }

  #emit(probeId: string, event: ProbeEvent): void {
    this.#sweep();
    const channel = this.#channels.get(probeId);
    if (channel === undefined) return;
    if (channel.listeners.size === 0) {
      // A heartbeat exists to keep a socket warm; buffering one for a
      // subscriber that is not there yet would only crowd out a real stage.
      if (event.type !== "heartbeat" && !channel.replayed && channel.buffer.length < MAX_BUFFERED) {
        channel.buffer.push(event);
      }
      return;
    }
    for (const listener of new Set(channel.listeners)) {
      try {
        listener(event);
      } catch {
        channel.listeners.delete(listener);
      }
    }
  }

  #open(probeId: string): Channel | null {
    const existing = this.#channels.get(probeId);
    if (existing !== undefined) {
      if (!existing.ended) existing.expiresAt = this.#clock().getTime() + CHANNEL_TTL_MS;
      return existing;
    }
    if (this.#channels.size >= MAX_CHANNELS) return null;
    const channel: Channel = {
      listeners: new Set(),
      buffer: [],
      replayed: false,
      ended: false,
      claimed: false,
      expiresAt: this.#clock().getTime() + CHANNEL_TTL_MS,
    };
    this.#channels.set(probeId, channel);
    return channel;
  }

  #sweep(): void {
    const now = this.#clock().getTime();
    for (const [probeId, channel] of this.#channels) {
      if (channel.expiresAt > now) continue;
      this.#channels.delete(probeId);
      // Nothing is sent on the way out: an expired channel is one whose probe
      // is long gone, and the route's own socket teardown is what ends the
      // stream. Telling a still-attached client "done" here would be a claim
      // about the probe that this hub cannot make.
      channel.listeners.clear();
    }
  }
}
