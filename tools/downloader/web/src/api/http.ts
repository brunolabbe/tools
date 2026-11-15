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

/**
 * How long a probe or job request may stay out, from its fetch (dl-138). The
 * probe's is above the longest the server's bounded waits add up to (about 61 s
 * with the human check on and the resolver timeout at its ceiling, by the
 * ticket's arithmetic), but it does not bound the unbounded lookups, and the
 * abort at the bound does not free the server's slot: the server keeps it until
 * its own handler ends. The bound frees the page's count, not the server's slot.
 * A job creation takes no server slot and is a few writes: 30 s clears the
 * siteverify's 5 s by a wide margin.
 */
export const PROBE_TIMEOUT_MS = 90_000;
export const CREATE_JOB_TIMEOUT_MS = 30_000;

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
      // A 429 with no body of ours is Cloudflare's rate limiting rule on `/api/`
      // (dl-136, `docs/02-DEPLOYMENT.md`), whose page is HTML. It means what our
      // own refusal means, so it reads the same, with the header's wait if sent.
      if (response.status === 429) {
        const wait = Number(response.headers.get("retry-after"));
        throw new AppError(
          "RATE_LIMITED",
          undefined,
          Number.isFinite(wait) && wait > 0 ? { details: { retryAfterSec: wait } } : {},
        );
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

  // The signal is the check's own bound on the read (dl-141). Nothing else
  // bounds a config read: `request()` gains none, per dl-138's Question 4.
  const tokens = (options.humanCheck ?? noHumanCheck)((signal) =>
    request(ROUTES.config, clientConfigResponseSchema, signal === undefined ? {} : { signal }),
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

  /**
   * Gives up on a request that has not settled by `ms`, and says so with
   * core's `TIMEOUT` (dl-138). Both halves are needed: the abort closes the
   * socket of a real `fetch`, whose rejection `request()` would otherwise
   * report as `UNREACHABLE`; the race settles the call even when the abort
   * reaches nothing, and the rejection of its own is what says `TIMEOUT`. The
   * timer begins when this is called, so a caller that takes its human check
   * first keeps that wait off the bound.
   */
  async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // The order of these two lines is not required: the abort reaches the
        // race only through `request()`'s `catch`, one microtask later, so the
        // rejection wins either way and no test pins the order. Kept first as the
        // order that does not depend on that hop.
        reject(new AppError("TIMEOUT"));
        controller.abort();
      }, ms);
    });
    try {
      return await Promise.race([run(controller.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    // Bounded on these two calls and no others (dl-138): the page counts a probe
    // and a job creation until the request settles, so one that never does would
    // hold its count for the life of the page. A timeout frees the page's count
    // and not the server's slot, which the server keeps until its own handler
    // ends: after a lost answer that is already free, but while the handler is in
    // an unbounded wait, or a lookup before the slot outlasts the bound, a box
    // that starts next can meet `RATE_LIMITED`.
    probe: async (probeRequest: ProbeRequest) => {
      const body = JSON.stringify(await withHumanCheck(probeRequest));
      return await withTimeout(PROBE_TIMEOUT_MS, (signal) =>
        request(ROUTES.probe, probeResponseSchema, { method: "POST", body, signal }),
      );
    },

    createJob: async (createRequest: CreateJobRequest) => {
      const body = JSON.stringify(await withHumanCheck(createRequest));
      return await withTimeout(CREATE_JOB_TIMEOUT_MS, (signal) =>
        request(ROUTES.jobs, jobResponseSchema, { method: "POST", body, signal }),
      );
    },

    getJob: (id: string) => request(ROUTES.job(id), jobResponseSchema),

    cancelJob: (id: string) => request(ROUTES.cancelJob(id), jobResponseSchema, { method: "POST" }),

    // The same `<a href download>` the job card offers, clicked for the visitor:
    // no value on `download` so the name comes from `Content-Disposition`, and a
    // refusal lands in the downloads list rather than navigating away from the
    // card that explains it. If the browser blocks it, the card's link is still
    // there to press.
    openLink(href: string): void {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "";
      anchor.hidden = true;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    },

    openJobEvents(jobId, handlers): EventStream {
      const source = new EventSource(url(ROUTES.jobEvents(jobId)));
      source.addEventListener("open", () => handlers.onOpen());
      source.addEventListener("message", (message: MessageEvent<string>) => {
        const event = parseJobEvent(message.data);
        // A frame this bundle cannot read is dropped, never taken as a broken
        // stream: a tab opened before a deploy meets every frame the server
        // learned since (dl-110), and a reconnect here would break all of them.
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
