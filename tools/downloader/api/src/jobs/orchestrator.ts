/**
 * The job pipeline: `queued → probing → downloading → muxing → completed`.
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
import type { DownloadEngine } from "@downloader/engine";
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
import type { ThumbnailStore } from "../thumbnails.ts";
import type { JobEventHub } from "./events.ts";
import { createFileToken } from "./tokens.ts";
import { chooseVariant } from "./variant-selection.ts";

export interface OrchestratorOptions {
  store: JobStore;
  engine: DownloadEngine;
  registry: ResolverRegistry;
  guard: SsrfGuard;
  events: JobEventHub;
  logger: AppLogger;
  probeTimeoutMs: number;
  fileRetentionHours: number;
  /**
   * The loopback egress proxy the resolver tiers fetch through, not the
   * operator's — the browser and yt-dlp tiers are subprocesses and this is the
   * only check that reaches them. See `egress-proxy.ts` and dl-12.
   */
  proxyUrl?: string | undefined;
  /** Builds the `downloadUrl` on a `JobResult`. Injected so routes own the path. */
  fileUrl: (token: string) => string;
  /** Where a captured preview image is held. See `thumbnails.ts`. */
  thumbnails: ThumbnailStore;
  /** The redirect-re-checking fetch the preview capture uses. */
  fetchImpl: GuardedFetch;
  now?: () => Date;
}

/**
 * How many times a job re-probes and retries after a *retryable* failure.
 *
 * One. The brief says "on `VARIANT_GONE`, re-probe once and retry", and the
 * same reasoning covers `DOWNLOAD_FAILED` during `downloading`: a manifest
 * download is ffmpeg doing the fetching, so any failure it has is a
 * `DOWNLOAD_FAILED` (`tools/downloader/engine/src/download/manifest.ts`) — an
 * expiry included, because ffmpeg reports HTTP status only as text on stderr.
 * The engine's own fetches classify better and raise `VARIANT_GONE`
 * (`tools/downloader/engine/src/download/http.ts`). Refusing to retry
 * `DOWNLOAD_FAILED` would therefore leave the commonest expiry case unhandled.
 *
 * Not more than one, because if a second fresh probe also produces dead URLs
 * the problem is not expiry and looping would just burn a browser probe per
 * attempt.
 */
const MAX_REPROBE_RETRIES = 1;

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

/** Per-run correlation, carried into the job's logger. See `registerRequestLogging`. */
export interface RunContext {
  requestId?: string | undefined;
}

/** Codes where a *fresh probe* is a plausible fix, as opposed to plain retrying. */
const REPROBE_WORTHY: ReadonlySet<string> = new Set(["VARIANT_GONE", "DOWNLOAD_FAILED"]);

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
    const { store, events, logger } = this.#options;
    // The request id rides along so every line this job writes — minutes later,
    // on a queue worker, with the HTTP call long gone — still points back at
    // the call that created it.
    const log = logger.child({
      jobId,
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
    });

    try {
      for (let attempt = 0; ; attempt++) {
        try {
          // oxlint-disable-next-line no-await-in-loop
          await this.#attempt(jobId, signal, attempt, log);
          return;
        } catch (error: unknown) {
          const appError = AppError.from(error);
          const canRetry =
            attempt < MAX_REPROBE_RETRIES &&
            !signal.aborted &&
            REPROBE_WORTHY.has(appError.code) &&
            RETRYABLE_CODES.has(appError.code);
          if (!canRetry) throw appError;

          log.warn("retrying with a fresh probe", { code: appError.code, attempt: attempt + 1 });
          this.#prepareRetry(jobId);
        }
      }
    } catch (error: unknown) {
      this.#recordFailure(jobId, error, log);
    } finally {
      // A canceled or failed job must leave nothing on disk. The engine already
      // cleans up its own tmp/out on throw; this covers the paths where we
      // failed before or after the engine ran.
      const finished = store.find(jobId);
      if (finished !== null && finished.status !== "completed") {
        await this.#options.engine.removeJob(jobId).catch((error: unknown) => {
          log.warn("could not clean up after a non-completed job", { error: String(error) });
        });
      }
      events.emit({ type: "heartbeat", at: this.#now().toISOString() });
    }
  }

  async #attempt(
    jobId: string,
    signal: AbortSignal,
    attempt: number,
    log: AppLogger,
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
    // The fallback is for a failure that surfaced once `muxing` had begun —
    // there is no back-edge from there, so that job re-probes in place as
    // every retry used to.
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
    const thumbnailPath = await captureThumbnail({
      probe,
      guard,
      fetchImpl: this.#options.fetchImpl,
      store: this.#options.thumbnails,
      logger: log,
    });

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

    // --- downloading / muxing -------------------------------------------
    throwIfAborted(signal);
    if (canTransition(store.get(jobId).status, "downloading")) {
      this.#transition(jobId, "downloading");
    }

    const outcome = await engine.download({
      jobId,
      variant,
      requestContext: probe.requestContext,
      title: probe.title,
      durationSec: probe.durationSec ?? null,
      isLive: probe.isLive,
      subtitles: probe.subtitles,
      options,
      signal,
      onProgress: (progress: JobProgress) => {
        this.#onProgress(jobId, progress);
      },
      onStage: (stage) => {
        // The engine reports which phase it is in; the FSM stays ours.
        if (stage === "muxing") this.#transition(jobId, "muxing");
      },
    });

    throwIfAborted(signal);

    // --- completed -------------------------------------------------------
    const result = this.#publish(jobId, outcome);
    const done = store.transition(
      jobId,
      "completed",
      {
        result,
        error: null,
        progress: { ...store.get(jobId).progress, stage: "completed", percent: 100 },
      },
      this.#iso(),
    );
    events.status(jobId, "completed");
    events.completed(jobId, result);
    log.info("job completed", {
      sizeBytes: result.sizeBytes,
      container: result.container,
      transcodes: outcome.transcodes.length,
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

  /** Mints the capability token and turns an engine outcome into a `JobResult`. */
  #publish(
    jobId: string,
    outcome: {
      path: string;
      filename: string;
      sizeBytes: number;
      container: string;
      durationSec: number | null;
    },
  ): JobResult {
    const { store, fileUrl, fileRetentionHours } = this.#options;
    const expiresAt = new Date(
      this.#now().getTime() + fileRetentionHours * 3_600_000,
    ).toISOString();
    const token = createFileToken();
    store.saveToken(
      {
        token,
        jobId,
        path: outcome.path,
        filename: outcome.filename,
        sizeBytes: outcome.sizeBytes,
        expiresAt,
      },
      this.#iso(),
    );
    return {
      filename: outcome.filename,
      sizeBytes: outcome.sizeBytes,
      container: outcome.container,
      durationSec: outcome.durationSec,
      downloadUrl: fileUrl(token),
      expiresAt,
    };
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

  #recordFailure(jobId: string, error: unknown, log: AppLogger): void {
    const { store, events } = this.#options;
    const appError = AppError.from(error);
    const canceled = appError.code === "JOB_CANCELED" || appError.code === "CANCELED";
    const payload = appError.toPayload();

    try {
      if (canceled) {
        // `status` is authoritative for cancellation; `error` is populated so a
        // listen-only client has copy. See the note on `Job` in shared/job.ts.
        const reason =
          appError.code === "JOB_CANCELED" ? payload : new AppError("JOB_CANCELED").toPayload();
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
