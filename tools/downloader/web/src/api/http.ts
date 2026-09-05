/**
 * Real HTTP transport. Paths come from `ROUTES`; nothing here spells one out,
 * and every response body is validated with the shared schemas before it is
 * allowed to become UI state.
 */

import {
  AppError,
  appErrorPayloadSchema,
  jobResponseSchema,
  parseJobEvent,
  probeResponseSchema,
  ROUTES,
} from "@downloader/contract";
import type { CreateJobRequest, ProbeRequest } from "@downloader/contract";
import type { z } from "zod";
import type { EventStream } from "../lib/event-stream.ts";
import type { ApiClient } from "./types.ts";

export interface HttpClientOptions {
  /** Origin the API is served from. Empty string means same origin. */
  baseUrl?: string;
}

export function createHttpClient(options: HttpClientOptions = {}): ApiClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const url = (path: string): string => `${baseUrl}${path}`;

  /**
   * Every response is parsed against its schema rather than cast. A server that
   * is a version ahead, a captive-portal login page answering 200, or a proxy
   * rewriting the body all produce data that would otherwise flow into UI state
   * as if it were a `Job` and fail somewhere far from the cause.
   */
  async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
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
      const payload = appErrorPayloadSchema.safeParse((body as { error?: unknown } | null)?.error);
      if (payload.success) {
        throw new AppError(payload.data.code, payload.data.message, {
          retryable: payload.data.retryable,
          ...(payload.data.details ? { details: payload.data.details } : {}),
        });
      }
      throw new AppError("INTERNAL", undefined, { details: { status: response.status } });
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("INTERNAL", "The server sent a response this app cannot read.", {
        details: { path, issues: parsed.error.issues.slice(0, 5) },
      });
    }
    return parsed.data;
  }

  return {
    probe: (probeRequest: ProbeRequest) =>
      request(ROUTES.probe, probeResponseSchema, {
        method: "POST",
        body: JSON.stringify(probeRequest),
      }),

    createJob: (createRequest: CreateJobRequest) =>
      request(ROUTES.jobs, jobResponseSchema, {
        method: "POST",
        body: JSON.stringify(createRequest),
      }),

    getJob: (id: string) => request(ROUTES.job(id), jobResponseSchema),

    cancelJob: (id: string) => request(ROUTES.cancelJob(id), jobResponseSchema, { method: "POST" }),

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
