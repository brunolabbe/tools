/**
 * Transport-agnostic slice of `EventSource`.
 *
 * Handlers are passed in at open time instead of being assigned as properties,
 * which keeps the mock transport and the reconnect tests free of the real
 * `MessageEvent`/`this`-typed surface — neither runs in a browser.
 */

import type { JobEvent, ProbeEvent } from "@downloader/contract";

export interface EventStream {
  close(): void;
}

export interface EventStreamHandlers<E = JobEvent> {
  /** The connection is live. Fired once per successful (re)connect. */
  onOpen(): void;
  /** A decoded, shape-checked frame. Malformed frames are dropped by the transport. */
  onEvent(event: E): void;
  /** The connection dropped. The caller owns the reconnect decision. */
  onError(): void;
}

export type EventStreamFactory = (
  jobId: string,
  handlers: EventStreamHandlers<JobEvent>,
) => EventStream;

/**
 * The same shape for a probe's stage channel (dl-43).
 *
 * Separate rather than generic-by-default because the *reconnect* policies
 * differ, not just the payload: a dropped job stream has to reconnect and
 * reconcile, since the job carries on without a listener. A dropped probe
 * stream has nothing to catch up on — the narration is decoration over a POST
 * that is still in flight — so the caller drops it and says nothing more.
 */
export type ProbeEventStreamFactory = (
  probeId: string,
  handlers: EventStreamHandlers<ProbeEvent>,
) => EventStream;
