import type {
  CreateJobRequest,
  JobResponse,
  ProbeRequest,
  ProbeResponse,
} from "@downloader/contract";
import type { EventStreamFactory, ProbeEventStreamFactory } from "../lib/event-stream.ts";

/**
 * The whole surface the UI depends on. Both the mock and the HTTP transport
 * implement it, so swapping them is one line in `client.ts`.
 *
 * Every method rejects with `AppError` from `@downloader/contract`; nothing in
 * the UI ever sees a bare `Error`.
 */
export interface ApiClient {
  probe(request: ProbeRequest): Promise<ProbeResponse>;
  createJob(request: CreateJobRequest): Promise<JobResponse>;
  getJob(id: string): Promise<JobResponse>;
  cancelJob(id: string): Promise<JobResponse>;
  openJobEvents: EventStreamFactory;
  /**
   * The stage channel for one analysis (dl-43). Opened *before* `probe` is
   * called, with the same client-minted id, because the first stages are
   * emitted the moment the server starts resolving.
   */
  openProbeEvents: ProbeEventStreamFactory;
}
