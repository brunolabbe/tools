/**
 * The job pipeline: `queued → probing → downloading → completed`, run on the
 * request of the visitor who opened the job's link, with the file streamed to
 * that visitor as ffmpeg produces it and no copy kept (dl-53).
 *
 * Three rules shape everything here, and each comes from a specific finding in
 * `tools/downloader/docs/00-ANALYSIS.md`:
 *
 * 1. **Always re-probe** (§5). The `probing` state is not decoration. Signed
 *    media URLs commonly expire in 30–300 s, so the probe from the client's
 *    original `/api/probe` call is very likely dead by the time a worker slot
 *    frees up. The orchestrator never reads the probe cache.
 *
 * 2. **SSRF-check resolver output, not just the page URL.** A resolver returns
 *    URLs a *page* chose, which makes them attacker-influenced. They are vetted
 *    after every probe and before the engine is handed anything.
 *
 * 3. **DRM stops here.** `probe.drm.protected` is terminal. No licence
 *    acquisition, no key extraction, no "try anyway".
 *
 * 4. **Nothing is retried after the first byte** (dl-53). A re-probe before it
 *    is free; after it there is no restarting a response that already holds
 *    half a file, so a later failure ends the job with its code.
 *
 * The FSM lives in `JobStore.transition`, which rejects illegal moves. This
 * file decides *which* transitions to ask for; it does not get to bend them.
 */

import { AppError, canTransition, RETRYABLE_CODES } from "@downloader/contract";
import type {
  Job,
  JobOptions,
  JobProgress,
  JobResult,
  MediaVariant,
  ProbeResult,
  RequestContext,
  ResolveOptions,
} from "@downloader/contract";
import type { DownloadEngine, MediaStream } from "@downloader/engine";
import type { ResolverRegistry } from "@downloader/resolvers";
import { initialProgress } from "../db/job-store.ts";
import type { JobStore } from "../db/job-store.ts";
import { withoutEgressProxy } from "../egress-proxy.ts";
import type { GuardedFetch } from "../guarded-fetch.ts";
import type { AppLogger } from "../logger.ts";
import { probeForClient } from "../probe-out.ts";
import type { SsrfGuard } from "../ssrf.ts";
import { urlsInProbeResult } from "../ssrf.ts";
import { captureThumbnail, withThumbnailPath } from "../thumbnails.ts";
import type { FrameGrabber, ThumbnailStore } from "../thumbnails.ts";
import type { JobEventHub } from "./events.ts";
import { chooseVariant } from "./variant-selection.ts";

export interface OrchestratorOptions {
  store: JobStore;
  engine: DownloadEngine;
  registry: ResolverRegistry;
  guard: SsrfGuard;
  events: JobEventHub;
  logger: AppLogger;
  probeTimeoutMs: number;
  /**
   * The loopback egress proxy the resolver tiers fetch through, not the
   * operator's — the browser and yt-dlp tiers are subprocesses and this is the
   * only check that reaches them. See `egress-proxy.ts` and dl-12.
   */
  proxyUrl?: string | undefined;
  /** Where a captured preview image is held. See `thumbnails.ts`. */
  thumbnails: ThumbnailStore;
  /** The redirect-re-checking fetch the preview capture uses. */
  fetchImpl: GuardedFetch;
  /**
   * The frame grab for a source that names no image (dl-56). Optional so a test
   * that builds an orchestrator by hand gets no ffmpeg; `server.ts` always
   * passes one.
   */
  grabFrame?: FrameGrabber | undefined;
  now?: () => Date;
}

/**
 * How many times a job re-probes and retries after a *retryable* failure.
 *
 * One. The brief says "on `VARIANT_GONE`, re-probe once and retry", and the
 * same reasoning covers `DOWNLOAD_FAILED` during `downloading`: ffmpeg does
 * all the fetching since dl-53, so any failure it has is a `DOWNLOAD_FAILED`
 * (`tools/downloader/engine/src/stream.ts`) — an expiry included, because
 * ffmpeg reports HTTP status only as text on stderr. Refusing to retry
 * `DOWNLOAD_FAILED` would therefore leave the commonest expiry case unhandled.
 * Only before the first byte: see rule 4 above.
 *
 * Not more than one, because if a second fresh probe also produces dead URLs
 * the problem is not expiry and looping would just burn a browser probe per
 * attempt.
 */
export const MAX_REPROBE_RETRIES = 1;

/**
 * A retry sends the job back to `probing`, and that is a real status move.
 *
 * `JOB_TRANSITIONS` carries a `downloading → probing` back-edge for exactly
 * this (dl-9). Before it existed the retry re-probed **in place** — the job sat
 * in `downloading` while it was doing no such thing — which was tested and
 * worked, and was still a job reporting one thing while doing another.
 *
 * The retry is bounded here rather than in the contract: the FSM says the move
 * is legal, `MAX_REPROBE_RETRIES` says how often it may be made.
 */

/**
 * What a run needs from the request that started it. See `registerRequestLogging`
 * for `requestId`, and `routes/files.ts` for `deliver`.
 */
export interface RunContext {
  requestId?: string | undefined;
  /**
   * Hands the stream to the visitor, at its first byte (dl-53): sends the
   * headers, pipes the body, and resolves once the response has finished or
   * the connection has gone. Absent in a run with nobody to deliver to, which
   * reads the stream to its end and discards it — tests use that.
   */
  deliver?: ((media: MediaStream) => Promise<void>) | undefined;
}

/** Codes where a *fresh probe* is a plausible fix, as opposed to plain retrying. */
const REPROBE_WORTHY: ReadonlySet<string> = new Set([
  "VARIANT_GONE",
  "DOWNLOAD_FAILED",
  "CONTAINER_UNSUPPORTED",
]);

/**
 * Re-probed although the taxonomy does not call it retryable (dl-99).
 *
 * `CONTAINER_UNSUPPORTED` is final for the visitor's choice — the same source
 * and the same container fail the same way — but the source's description comes
 * from a header read at probe time, and that read can fail once for an origin
 * that serves it on the next try. The picker offered WebM on the strength of
 * the earlier read, so one fresh probe is owed before the job fails for good
 * (the owner's decision of 2026-10-08). **Once, like every other re-probe**: a
 * variant that really is undeclared is refused again and the job ends there.
 * The error that ends it is still `retryable: false`.
 */
const REPROBE_DESPITE_NOT_RETRYABLE: ReadonlySet<string> = new Set(["CONTAINER_UNSUPPORTED"]);

export class JobOrchestrator {
  readonly #options: OrchestratorOptions;
  readonly #now: () => Date;

  constructor(options: OrchestratorOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Runs one job to a terminal state. Never throws: every outcome is recorded
   * on the job and emitted, because a rejected task in the queue would be a
   * job stuck in `downloading` forever with nothing to explain it.
   */
  async run(jobId: string, signal: AbortSignal, context: RunContext = {}): Promise<void> {
    const { events, logger } = this.#options;
    // The request id rides along so every line this job writes — minutes later,
    // on a queue worker, with the HTTP call long gone — still points back at
    // the call that created it.
    const log = logger.child({
      jobId,
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
    });

    try {
      for (let attempt = 0; ; attempt++) {
        const progress = { started: false };
        try {
          // oxlint-disable-next-line no-await-in-loop
          await this.#attempt(jobId, signal, attempt, log, context, progress);
          return;
        } catch (error: unknown) {
          const appError = AppError.from(error);
          const canRetry =
            !progress.started &&
            attempt < MAX_REPROBE_RETRIES &&
            !signal.aborted &&
            REPROBE_WORTHY.has(appError.code) &&
            (RETRYABLE_CODES.has(appError.code) ||
              REPROBE_DESPITE_NOT_RETRYABLE.has(appError.code));
          if (!canRetry) throw appError;

          log.warn("retrying with a fresh probe", { code: appError.code, attempt: attempt + 1 });
          this.#prepareRetry(jobId);
        }
      }
    } catch (error: unknown) {
      this.#recordFailure(jobId, error, signal, log);
    } finally {
      events.emit({ type: "heartbeat", at: this.#now().toISOString() });
    }
  }

  async #attempt(
    jobId: string,
    signal: AbortSignal,
    attempt: number,
    log: AppLogger,
    context: RunContext,
    progress: { started: boolean },
  ): Promise<void> {
    const { store, events, engine, guard } = this.#options;
    throwIfAborted(signal);

    const job = store.get(jobId);
    const options = store.options(jobId);

    // --- probing ---------------------------------------------------------
    // `queued → probing` on the first attempt; `downloading → probing` on a
    // retry, over the back-edge, so a job that is re-probing says so. The
    // progress snapshot resets with it: the bytes of an abandoned attempt are
    // not progress towards this one, and leaving them would show a percentage
    // that no longer refers to anything being downloaded.
    //
    const attempts = attempt + 1;
    if (canTransition(job.status, "probing")) {
      const reset = initialProgress("probing");
      this.#transition(jobId, "probing", { attempts, progress: reset });
      // Resetting the stored snapshot is not enough on its own: a client that
      // is only listening would keep the dead attempt's percentage on screen
      // under "Re-analysing". The frame is how it learns the counter is back
      // to zero.
      events.progress(jobId, reset);
    } else {
      store.patch(jobId, { attempts }, this.#iso());
    }
    const probe = await this.#probe(job.sourceUrl, signal, log);
    throwIfAborted(signal);

    if (probe.drm.protected) {
      // Terminal by design. Never attempt licence acquisition or key extraction.
      throw new AppError("DRM_PROTECTED", undefined, {
        details: { systems: probe.drm.systems, resolver: probe.resolver },
      });
    }

    // Resolver output is attacker-influenced: a hostile page can name any
    // address it likes and this server would fetch it. Vet every URL the
    // engine could touch before handing it any of them. `bestEffort` — the
    // preview image — is vetted separately, below, because a refusal there must
    // not fail a downloadable video. See `urlsInProbeResult`.
    await guard.assertAllAllowed(urlsInProbeResult(probe).mustPass);

    const { variant, substituted } = chooseVariant(probe, options);
    if (substituted) {
      log.warn(
        "the requested variant was gone from the fresh probe; substituting the best available",
        {
          requested: options.variantId,
          chosen: variant.id,
        },
      );
    }

    if (probe.isLive && (options.liveDurationSec ?? 0) <= 0) {
      throw new AppError("LIVE_STREAM_UNSUPPORTED", undefined, {
        details: { variantId: variant.id },
      });
    }

    // The re-probe is unconditional (rule 1 above), so the credentials needed to
    // fetch the preview are in hand right here and the token below is one this
    // run minted — nothing depends on the probe cache still holding anything.
    const captured = await captureThumbnail({
      probe,
      guard,
      fetchImpl: this.#options.fetchImpl,
      store: this.#options.thumbnails,
      logger: log,
      // dl-56: the same fallback the probe route has, on the job's own signal
      // so a cancel stops the grab's ffmpeg with everything else.
      grabFrame: this.#options.grabFrame,
      signal,
    });
    const thumbnailPath = captured?.path ?? null;

    // A field write, not a state change: the job is already in the right state.
    // The preview rides along with the variant snapshot for the same reason it
    // exists — so the downloads list can still show the video once the probe has
    // aged out.
    store.patch(jobId, { variant, variantId: variant.id, thumbnailPath }, this.#iso());
    // The **rewritten** probe: this frame carries a whole `ProbeResult` to the
    // client, so it is the second door the origin thumbnail URL could have
    // walked out of, and the third seam the source's credentials could. Same
    // reason `withoutEgressProxy` is applied in `#probe`.
    events.probed(jobId, probeForClient(withThumbnailPath(probe, thumbnailPath)));

    // --- downloading ----------------------------------------------------
    throwIfAborted(signal);
    if (canTransition(store.get(jobId).status, "downloading")) {
      this.#transition(jobId, "downloading");
    }

    const media = await engine.stream({
      jobId,
      variant,
      requestContext: probe.requestContext,
      title: probe.title,
      durationSec: probe.durationSec ?? null,
      isLive: probe.isLive,
      subtitles: probe.subtitles,
      options,
      signal,
      onProgress: (value: JobProgress) => {
        this.#onProgress(jobId, value);
      },
    });
    // The first byte exists. From here a failure is the job's end, not a
    // reason to re-probe: the visitor already holds the start of this file.
    progress.started = true;
    if (context.deliver === undefined) {
      media.body.resume();
    } else {
      await context.deliver(media);
    }
    // A connection that went away before the last byte is the visitor's
    // choice, and the signal carries it; see `routes/files.ts`.
    throwIfAborted(signal);
    const outcome = await media.done;
    throwIfAborted(signal);

    // --- completed -------------------------------------------------------
    const result: JobResult = {
      filename: media.filename,
      sizeBytes: outcome.bytes,
      container: media.container,
      durationSec: outcome.durationSec,
    };
    const done = store.transition(
      jobId,
      "completed",
      {
        result,
        error: null,
        progress: {
          ...store.get(jobId).progress,
          stage: "completed",
          percent: 100,
          downloadedBytes: outcome.bytes,
        },
      },
      this.#iso(),
    );
    events.status(jobId, "completed");
    events.completed(jobId, result);
    log.info("job completed", {
      sizeBytes: result.sizeBytes,
      container: result.container,
      transcodes: media.transcodes.length,
      attempts: done.attempts,
    });
  }

  async #probe(sourceUrl: string, signal: AbortSignal, log: AppLogger): Promise<ProbeResult> {
    const { registry, guard, probeTimeoutMs, proxyUrl } = this.#options;
    // Re-checked here as well as at intake: the row has been sitting in SQLite
    // since the client posted it, and DNS may say something different now.
    const url = await guard.assertAllowed(sourceUrl);
    const resolveOptions: ResolveOptions = {
      timeoutMs: probeTimeoutMs,
      signal,
      ...(proxyUrl === undefined ? {} : { proxyUrl }),
    };
    // Stripped here rather than at the event: the `probed` event carries the
    // whole result to the client, and this process's loopback port is no part
    // of what a client is owed.
    const probe = withoutEgressProxy(await registry.resolve(url, resolveOptions));
    log.debug("re-probe complete", {
      resolver: probe.resolver,
      variants: probe.variants.length,
      isLive: probe.isLive,
      requestContext: probe.requestContext,
    });
    return probe;
  }

  #onProgress(jobId: string, progress: JobProgress): void {
    // Written straight through rather than via `transition`: progress arrives
    // many times a second and must never be able to move the FSM.
    this.#options.store.recordProgress(jobId, progress, this.#iso());
    this.#options.events.progress(jobId, progress);
  }

  #transition(
    jobId: string,
    to: Job["status"],
    patch: Parameters<JobStore["transition"]>[2] = {},
  ): void {
    this.#options.store.transition(jobId, to, patch, this.#iso());
    this.#options.events.status(jobId, to);
  }

  /**
   * Clears the failure from the previous attempt. The status move back to
   * `probing` belongs to the next `#attempt`, which is where every other
   * transition is decided.
   */
  #prepareRetry(jobId: string): void {
    this.#options.store.patch(jobId, { error: null }, this.#iso());
  }

  #recordFailure(jobId: string, error: unknown, signal: AbortSignal, log: AppLogger): void {
    const { store, events } = this.#options;
    const appError = AppError.from(error);
    const canceled = appError.code === "JOB_CANCELED" || appError.code === "CANCELED";
    const payload = appError.toPayload();

    try {
      if (canceled) {
        // `status` is authoritative for cancellation; `error` is populated so a
        // listen-only client has copy. See the note on `Job` in shared/job.ts.
        // The signal's own reason first: it is the one that says *why* — a
        // visitor who disconnected (dl-53) — where the engine only knows that
        // something aborted it.
        const reason =
          signal.reason instanceof AppError && signal.reason.code === "JOB_CANCELED"
            ? signal.reason.toPayload()
            : appError.code === "JOB_CANCELED"
              ? payload
              : new AppError("JOB_CANCELED").toPayload();
        store.transition(jobId, "canceled", { error: reason }, this.#iso());
        events.status(jobId, "canceled");
        events.canceled(jobId, reason);
        log.info("job canceled");
        return;
      }
      store.transition(jobId, "failed", { error: payload }, this.#iso());
      events.status(jobId, "failed");
      events.failed(jobId, payload);
      log.warn("job failed", { code: appError.code, retryable: appError.retryable });
    } catch (writeError: unknown) {
      // The job may already be terminal — a cancel that raced the last
      // transition. Nothing left to record, and throwing here would replace a
      // real failure with a bookkeeping one.
      log.error("could not record a job's terminal state", {
        code: appError.code,
        writeError: String(writeError),
      });
    }
  }

  #iso(): string {
    return this.#now().toISOString();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof AppError) throw signal.reason;
  throw new AppError("JOB_CANCELED");
}

/** Re-exported so tests can build a request context without importing shared twice. */
export type { RequestContext, MediaVariant, JobOptions };
