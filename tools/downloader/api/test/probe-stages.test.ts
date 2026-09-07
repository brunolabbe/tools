/**
 * The probe stage channel end to end (dl-43): the hub, the SSE route, and what
 * `POST /api/probe` publishes onto it.
 *
 * The acceptance this file carries is the one most easily missed — **a probe
 * answered on tier 1 must not flash the other two on its way to done.** The
 * happy path is the fast one, so a suite that only exercised the slow probe
 * would never notice a chain that announced every registered tier up front.
 *
 * The SSE cases use `inject`, which buffers until the response ends — so they
 * work only because `done` closes the stream. That is not incidental: a channel
 * that never terminated would hang this file, which is a better failure than a
 * socket leaking in production.
 */

import { ROUTES } from "@downloader/contract";
import type { ProbeEvent, ProbeResult, Resolver, ResolveOptions } from "@downloader/contract";
import { AppError } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { CHANNEL_TTL_MS, DONE_GRACE_MS, MAX_CHANNELS, ProbeStageHub } from "../src/probe-stages.ts";
import { formatProbeSseFrame } from "../src/routes/probe-events.ts";
import { createHarness, probeResult, SOURCE_URL } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const PROBE_ID = "0123456789abcdef0123456789abcdef";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

describe("ProbeStageHub", () => {
  test("replays what it buffered to the first subscriber, once", () => {
    const hub = new ProbeStageHub();
    hub.open(PROBE_ID);
    hub.stage(PROBE_ID, { stage: "resolver-start", resolver: "direct" });
    hub.stage(PROBE_ID, { stage: "direct-head", resolver: "direct" });

    // The client opens its EventSource and POSTs without waiting, so the first
    // stages can land before anyone is attached. Without the buffer the
    // narration would routinely start halfway through.
    const first: ProbeEvent[] = [];
    hub.subscribe(PROBE_ID, (event) => first.push(event));
    expect(first.map((event) => event.type)).toEqual(["stage", "stage"]);

    const second: ProbeEvent[] = [];
    hub.subscribe(PROBE_ID, (event) => second.push(event));
    // Replayed once and then abandoned: a second listener is a curiosity, and
    // holding history for one would mean deciding how much and for how long.
    expect(second).toEqual([]);

    hub.stage(PROBE_ID, { stage: "browser-launch", resolver: "browser" });
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(1);
  });

  test("does not buffer heartbeats, which exist only to keep a socket warm", () => {
    const hub = new ProbeStageHub();
    hub.open(PROBE_ID);
    hub.heartbeat(PROBE_ID);
    hub.stage(PROBE_ID, { stage: "page-load", resolver: "browser" });

    const seen: ProbeEvent[] = [];
    hub.subscribe(PROBE_ID, (event) => seen.push(event));
    expect(seen.map((event) => event.type)).toEqual(["stage"]);
  });

  test("a listener that throws is dropped rather than allowed to break the emit", () => {
    const hub = new ProbeStageHub();
    hub.open(PROBE_ID);
    const good: ProbeEvent[] = [];
    hub.subscribe(PROBE_ID, () => {
      throw new Error("socket closed");
    });
    hub.subscribe(PROBE_ID, (event) => good.push(event));

    hub.stage(PROBE_ID, { stage: "page-load", resolver: "browser" });
    hub.stage(PROBE_ID, { stage: "network-quiet", resolver: "browser" });
    expect(good).toHaveLength(2);
    expect(hub.subscriberCount(PROBE_ID)).toBe(1);
  });

  test("`done` reaches a subscriber that only arrives afterwards, then the channel goes", () => {
    let now = 1_000_000;
    const hub = new ProbeStageHub(() => new Date(now));
    hub.open(PROBE_ID);
    hub.stage(PROBE_ID, { stage: "direct-head", resolver: "direct" });
    hub.done(PROBE_ID);

    const seen: ProbeEvent[] = [];
    hub.subscribe(PROBE_ID, (event) => seen.push(event));
    expect(seen.map((event) => event.type)).toEqual(["stage", "done"]);

    now += DONE_GRACE_MS + 1;
    expect(hub.channelCount).toBe(0);
  });

  test("an abandoned channel expires, since nothing else would ever reclaim it", () => {
    let now = 1_000_000;
    const hub = new ProbeStageHub(() => new Date(now));
    hub.open(PROBE_ID);
    expect(hub.channelCount).toBe(1);

    now += CHANNEL_TTL_MS - 1;
    expect(hub.channelCount).toBe(1);
    now += 2;
    expect(hub.channelCount).toBe(0);
  });

  test("the cap refuses rather than growing without bound", () => {
    const hub = new ProbeStageHub();
    for (let index = 0; index < MAX_CHANNELS; index++) {
      expect(hub.open(`channel-${index}`)).toBe(true);
    }
    // The SSE endpoint carries no rate limiter of its own, so this is the whole
    // of what stops an unauthenticated client opening channels forever.
    expect(hub.open("one-too-many")).toBe(false);
    expect(hub.subscribe("one-too-many", () => {})).toBeNull();
  });

  test("publishing to a channel nobody opened is a no-op, not a leak", () => {
    const hub = new ProbeStageHub();
    hub.stage("never-opened", { stage: "page-load", resolver: "browser" });
    hub.done("never-opened");
    expect(hub.channelCount).toBe(0);
  });
});

describe("SSE framing", () => {
  test("one JSON object per data line, terminated by a blank line", () => {
    const frame = formatProbeSseFrame({
      type: "stage",
      probeId: PROBE_ID,
      stage: "network-quiet",
      resolver: "browser",
      at: "2026-09-07T10:00:00.000Z",
    });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(JSON.parse(frame.slice("data: ".length))).toMatchObject({ stage: "network-quiet" });
  });
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/** A resolver that answers, and narrates whichever stages it is told to. */
class NarratingResolver implements Resolver {
  readonly name: string;
  readonly priority: number;
  calls = 0;

  readonly #stages: readonly ProbeStageEventStage[];
  readonly #answer: boolean;

  constructor(config: {
    name: string;
    priority: number;
    stages?: readonly ProbeStageEventStage[];
    answer?: boolean;
  }) {
    this.name = config.name;
    this.priority = config.priority;
    this.#stages = config.stages ?? [];
    this.#answer = config.answer ?? true;
  }

  canHandle(): boolean {
    return true;
  }

  async resolve(_url: URL, options: ResolveOptions): Promise<ProbeResult> {
    this.calls++;
    for (const stage of this.#stages) options.onStage?.({ stage, resolver: this.name });
    if (!this.#answer) throw new AppError("NO_MEDIA_FOUND");
    return await Promise.resolve(probeResult({ resolver: this.name }));
  }
}

type ProbeStageEventStage = Parameters<NonNullable<ResolveOptions["onStage"]>>[0]["stage"];

/** Runs a probe and the stream that watches it together, and returns the frames. */
async function narratedProbe(current: Harness, probeId = PROBE_ID): Promise<ProbeEvent[]> {
  const stream = current.app.server.inject({
    method: "GET",
    url: ROUTES.probeEvents(probeId),
  });
  const probe = current.app.server.inject({
    method: "POST",
    url: ROUTES.probe,
    payload: { url: SOURCE_URL, probeId },
  });
  const [sse] = await Promise.all([stream, probe]);
  return sse.body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as ProbeEvent);
}

describe("GET /api/probe/:id/events", () => {
  test("a probe answered by the first tier never reports the second or third", async () => {
    const first = new NarratingResolver({ name: "yt-dlp", priority: 20, stages: ["ytdlp-run"] });
    const second = new NarratingResolver({ name: "browser", priority: 30 });
    const third = new NarratingResolver({ name: "direct-stub", priority: 40 });
    harness = await createHarness({ resolver: first });
    harness.app.context.registry.register(second);
    harness.app.context.registry.register(third);

    const frames = await narratedProbe(harness);

    const named = frames.flatMap((frame) => (frame.type === "stage" ? [frame.resolver] : []));
    expect(named).toEqual(["yt-dlp", "yt-dlp"]);
    expect(named).not.toContain("browser");
    expect(named).not.toContain("direct-stub");
    // The tiers really did not run, so this is a claim about the chain and not
    // only about the narration.
    expect(second.calls).toBe(0);
    expect(third.calls).toBe(0);
  });

  test("the chain that degrades reports every tier it reached, in order", async () => {
    const first = new NarratingResolver({ name: "yt-dlp", priority: 20, answer: false });
    const second = new NarratingResolver({
      name: "browser",
      priority: 30,
      stages: ["browser-launch", "page-load"],
    });
    harness = await createHarness({ resolver: first });
    harness.app.context.registry.register(second);

    const frames = await narratedProbe(harness);
    const stages = frames.flatMap((frame) => (frame.type === "stage" ? [frame.stage] : []));
    expect(stages).toEqual(["resolver-start", "resolver-start", "browser-launch", "page-load"]);
  });

  test("the stream ends on `done`, so a client never decides when to stop listening", async () => {
    harness = await createHarness({
      resolver: new NarratingResolver({ name: "stub", priority: 10 }),
    });
    const frames = await narratedProbe(harness);
    expect(frames.at(-1)?.type).toBe("done");
    // The channel is not held open behind it either.
    expect(harness.app.context.probeStages.subscriberCount(PROBE_ID)).toBe(0);
  });

  test("a probe that fails still terminates its narration", async () => {
    harness = await createHarness({
      resolver: new NarratingResolver({ name: "stub", priority: 10, answer: false }),
    });
    const frames = await narratedProbe(harness);
    // The chain exhausts and the POST 4xxs; the stream must not be left open on
    // the strength of the probe having gone badly.
    expect(frames.at(-1)?.type).toBe("done");
  });

  test("a probe with no probeId opens no channel at all", async () => {
    harness = await createHarness({
      resolver: new NarratingResolver({ name: "stub", priority: 10, stages: ["ytdlp-run"] }),
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    expect(response.statusCode).toBe(200);
    expect(harness.app.context.probeStages.channelCount).toBe(0);
  });

  test("a malformed probe id is refused by the schema rather than becoming a channel", async () => {
    harness = await createHarness({
      resolver: new NarratingResolver({ name: "stub", priority: 10 }),
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL, probeId: "short" },
    });
    expect(response.statusCode).toBe(400);
    expect(harness.app.context.probeStages.channelCount).toBe(0);
  });

  test("a cache hit narrates nothing, because nothing runs", async () => {
    harness = await createHarness({
      resolver: new NarratingResolver({ name: "stub", priority: 10, stages: ["ytdlp-run"] }),
    });
    await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });

    // Second time round the answer comes from the cache before any channel
    // could be opened. A channel opened here would leave the client watching an
    // empty stream until its own timeout.
    const cached = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL, probeId: PROBE_ID },
    });
    expect(cached.json()).toMatchObject({ cached: true });
    expect(harness.app.context.probeStages.channelCount).toBe(0);
  });
});
