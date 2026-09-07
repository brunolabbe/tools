/**
 * Resolver contract.
 *
 * A resolver turns a page URL into a `ProbeResult`. The registry tries resolvers
 * in ascending `priority` and takes the first usable answer, so a cheap
 * site-specific extractor runs before the expensive browser sniffer.
 *
 * Adding site support should mean adding a resolver — never editing the engine,
 * the API or the UI. If a change to support one site touches another layer, the
 * abstraction is wrong and should be fixed rather than worked around.
 */

import type { ProbeResult } from "./media.ts";

/**
 * Points in the chain a probe can be *observed* to have reached (dl-43).
 *
 * Every entry is an `await` that already existed in a resolver; nothing here is
 * a phase invented to give a progress indicator something to say. The rule the
 * UI depends on is that a stage may only be reported because code reached the
 * line that reports it — never because a timer elapsed. A stage added here that
 * is not emitted next to a real `await` breaks that and makes the whole channel
 * untrustworthy, since a client cannot tell the two apart.
 *
 * `resolver-start` is the only one the registry emits; the rest belong to the
 * tier named in `ProbeStageEvent.resolver`.
 */
export const PROBE_STAGES = [
  /** A tier is about to be tried. Fired before `resolve`, so the last tier is announced too. */
  "resolver-start",
  /** Blocked on the browser pool's semaphore — every browser is busy. */
  "browser-slot",
  /** The slot is held; a browser is being launched or claimed. */
  "browser-launch",
  "page-load",
  "provoke-playback",
  "network-quiet",
  "settle-requests",
  "manifest-fetch",
  "manifest-parse",
  "measure-variants",
  /** The yt-dlp subprocess is running. */
  "ytdlp-run",
  /** The direct tier's HEAD (or ranged GET) is in flight. */
  "direct-head",
] as const;

export type ProbeStage = (typeof PROBE_STAGES)[number];

export interface ProbeStageEvent {
  stage: ProbeStage;
  /** `Resolver.name` of the tier that reached it — "browser", "yt-dlp", "direct". */
  resolver: string;
}

/**
 * Best-effort, and must never throw: a resolver calls this in the middle of its
 * own work, so a listener that raises would fail the probe it is narrating.
 */
export type ProbeStageListener = (event: ProbeStageEvent) => void;

export interface ResolveOptions {
  /** Hard wall-clock budget. Resolvers must abort cleanly when it elapses. */
  timeoutMs: number;
  signal: AbortSignal;
  /** Route all outbound traffic through this proxy when set. */
  proxyUrl?: string;
  /** Cookies to inject, for sources behind a login the operator has provided. */
  cookieHeader?: string;
  /** Preferred UI/content language, sent as Accept-Language. */
  locale?: string;
  /**
   * Called as the chain reaches each point in `PROBE_STAGES`.
   *
   * Optional on purpose: every caller and test that predates dl-43 is
   * unaffected, and a resolver that emits nothing is degraded, not broken.
   * Each resolver stamps its own `name`; `ResolverRegistry` passes down a
   * wrapper that swallows a throwing listener, so the "must never throw" rule
   * above holds for a resolver reached through the chain even when the caller
   * gets it wrong.
   */
  onStage?: ProbeStageListener;
}

/**
 * One frame on `/api/probe/:id/events`.
 *
 * Shaped like `JobEvent`: the SSE route emits this union verbatim, one JSON
 * object per `data:` line, and the client re-validates every frame with the
 * schema in `api.ts`.
 */
export interface ProbeStageFrame extends ProbeStageEvent {
  type: "stage";
  probeId: string;
  at: string;
}

/** The probe is over — succeeded, failed or canceled. The stream ends here. */
export interface ProbeDoneFrame {
  type: "done";
  probeId: string;
  at: string;
}

export interface ProbeHeartbeatFrame {
  type: "heartbeat";
  at: string;
}

export type ProbeEvent = ProbeStageFrame | ProbeDoneFrame | ProbeHeartbeatFrame;

export interface Resolver {
  /** Stable identifier, surfaced in `ProbeResult.resolver` and in logs. */
  readonly name: string;
  /** Lower runs first. Site-specific: 10–49. Generic fallbacks: 50+. */
  readonly priority: number;

  /**
   * Cheap synchronous check — hostname/pattern matching only.
   * Must not perform I/O; the registry calls it for every resolver on every request.
   */
  canHandle(url: URL): boolean;

  /**
   * Perform the analysis.
   *
   * Throw `AppError('NO_MEDIA_FOUND')` to let the registry fall through to the
   * next resolver. Throw any other `AppError` to stop the chain — `DRM_PROTECTED`
   * and `AUTH_REQUIRED` are real answers about the source, not this resolver
   * failing, so trying another resolver would only waste time.
   */
  resolve(url: URL, options: ResolveOptions): Promise<ProbeResult>;

  /** Release browsers, temp dirs and sockets. Called on shutdown. */
  dispose?(): Promise<void>;
}
