/**
 * Real HTTP transport. Paths come from `ROUTES`; nothing here spells one out,
 * and every response body is validated with the shared schemas before it is
 * allowed to become UI state.
 */

import {
  AppError,
  appErrorPayloadSchema,
  clientConfigResponseSchema,
  jobResponseSchema,
  parseJobEvent,
  parseProbeEvent,
  probeResponseSchema,
  ROUTES,
} from "@downloader/contract";
import type { CreateJobRequest, ProbeRequest } from "@downloader/contract";
import type { z } from "zod";
import type { EventStream } from "../lib/event-stream.ts";
import { noHumanCheck } from "../lib/human-check.ts";
import type { HumanCheckFactory } from "../lib/human-check.ts";
import type { ApiClient } from "./types.ts";

export interface HttpClientOptions {
  /** Origin the API is served from. Empty string means same origin. */
  baseUrl?: string;
  /**
   * Where probe and job tokens come from (dl-50). The default sends none, which
   * is what a test of the request shape wants; `client.ts` passes the real
   * Turnstile check. Handed a reader for `GET /api/config` rather than the
   * config itself, so the read happens on the first checked request and not at
   * import time.
   */
  humanCheck?: HumanCheckFactory;
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
        // Only when there is a body. Fastify answers an empty body declared as
        // JSON with a parser error, so a bare `POST` carrying this header never
        // reached the cancel route at all (dl-65).
        headers: {
          ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...init?.headers,
        },
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

  const tokens = (options.humanCheck ?? noHumanCheck)(() =>
    request(ROUTES.config, clientConfigResponseSchema),
  );

  /**
   * Taken here, per call, and never earlier: the probe and the job each spend
   * their own (dl-50). Added only when there is one, so a deployment without a
   * check sends exactly the body it sent before.
   */
  async function withHumanCheck<T extends object>(body: T): Promise<T> {
    const humanCheckToken = await tokens.next();
    return humanCheckToken === null ? body : { ...body, humanCheckToken };
  }

  return {
    probe: async (probeRequest: ProbeRequest) =>
      await request(ROUTES.probe, probeResponseSchema, {
        method: "POST",
        body: JSON.stringify(await withHumanCheck(probeRequest)),
      }),

    createJob: async (createRequest: CreateJobRequest) =>
      await request(ROUTES.jobs, jobResponseSchema, {
        method: "POST",
        body: JSON.stringify(await withHumanCheck(createRequest)),
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

    openProbeEvents(probeId, handlers): EventStream {
      const source = new EventSource(url(ROUTES.probeEvents(probeId)));
      source.addEventListener("open", () => handlers.onOpen());
      source.addEventListener("message", (message: MessageEvent<string>) => {
        const event = parseProbeEvent(message.data);
        if (event) handlers.onEvent(event);
      });
      source.addEventListener("error", () => {
        // No reconnect, unlike `openJobEvents`: there is no probe to reconcile
        // against, and a channel this client alone named is not going to have
        // acquired history while it was away. Narration stops; the analysis the
        // user actually asked for is a separate request and carries on.
        source.close();
        handlers.onError();
      });
      return {
        close: () => source.close(),
      };
    },
  };
}
