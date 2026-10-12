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
  /**
   * Opens a job's single-use link as a download, which is what starts the work
   * (dl-53), so one press of the panel's Download both creates the job and
   * fetches the file. It cannot report failure: the browser owns the download,
   * and a refusal comes back over the job's event stream (dl-77).
   */
  openLink(href: string): void;
}
