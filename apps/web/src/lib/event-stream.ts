/**
 * Transport-agnostic slice of `EventSource`.
 *
 * Handlers are passed in at open time instead of being assigned as properties,
 * which keeps the mock transport and the reconnect tests free of the real
 * `MessageEvent`/`this`-typed surface — neither runs in a browser.
 */

import type { JobEvent } from "@downloader/shared";

export interface EventStream {
  close(): void;
}

export interface EventStreamHandlers {
  /** The connection is live. Fired once per successful (re)connect. */
  onOpen(): void;
  /** A decoded, shape-checked frame. Malformed frames are dropped by the transport. */
  onEvent(event: JobEvent): void;
  /** The connection dropped. The caller owns the reconnect decision. */
  onError(): void;
}

export type EventStreamFactory = (jobId: string, handlers: EventStreamHandlers) => EventStream;
