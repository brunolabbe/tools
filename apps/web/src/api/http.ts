/**
 * Real HTTP transport. Paths come from `ROUTES`; nothing here spells one out.
 *
 * Unused until `apps/api` lands (WP-5) — `client.ts` selects it with an env flag.
 */

import { AppError, ROUTES } from "@downloader/shared";
import type {
  CreateJobRequest,
  ErrorResponse,
  JobListResponse,
  JobResponse,
  ProbeRequest,
  ProbeResponse,
} from "@downloader/shared";
import { parseJobEvent } from "../lib/contract-guards.ts";
import type { EventStream } from "../lib/event-stream.ts";
import { isAppErrorPayload } from "../lib/contract-guards.ts";
import type { ApiClient } from "./types.ts";

export interface HttpClientOptions {
  /** Origin the API is served from. Empty string means same origin. */
  baseUrl?: string;
}

export function createHttpClient(options: HttpClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const url = (path: string): string => `${baseUrl}${path}`;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url(path), {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } catch (cause) {
      throw new AppError("UNREACHABLE", undefined, { cause });
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const payload = (body as ErrorResponse | null)?.error;
      if (isAppErrorPayload(payload)) {
        throw new AppError(payload.code, payload.message, {
          retryable: payload.retryable,
          ...(payload.details ? { details: payload.details } : {}),
        });
      }
      throw new AppError("INTERNAL", undefined, { details: { status: response.status } });
    }
    return body as T;
  }

  return {
    probe: (probeRequest: ProbeRequest) =>
      request<ProbeResponse>(ROUTES.probe, {
        method: "POST",
        body: JSON.stringify(probeRequest),
      }),

    createJob: (createRequest: CreateJobRequest) =>
      request<JobResponse>(ROUTES.jobs, {
        method: "POST",
        body: JSON.stringify(createRequest),
      }),

    getJob: (id: string) => request<JobResponse>(ROUTES.job(id)),

    listJobs: () => request<JobListResponse>(ROUTES.jobs),

    cancelJob: (id: string) => request<JobResponse>(ROUTES.cancelJob(id), { method: "POST" }),

    openJobEvents(jobId, handlers): EventStream {
      const source = new EventSource(url(ROUTES.jobEvents(jobId)));
      source.addEventListener("open", () => handlers.onOpen());
      source.addEventListener("message", (message: MessageEvent<string>) => {
        const event = parseJobEvent(message.data);
        if (event) handlers.onEvent(event);
      });
      source.addEventListener("error", () => {
        // EventSource retries on its own schedule and tells us nothing about
        // what we missed. Close it and hand the reconnect (and the mandatory
        // reconcile fetch) to the caller's backoff controller.
        source.close();
        handlers.onError();
      });
      return {
        close: () => source.close(),
      };
    },
  };
}
