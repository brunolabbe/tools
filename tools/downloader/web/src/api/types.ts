import type {
  CreateJobRequest,
  JobListResponse,
  JobResponse,
  ProbeRequest,
  ProbeResponse,
} from "@downloader/contract";
import type { EventStreamFactory } from "../lib/event-stream.ts";

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
  listJobs(): Promise<JobListResponse>;
  cancelJob(id: string): Promise<JobResponse>;
  openJobEvents: EventStreamFactory;
}
