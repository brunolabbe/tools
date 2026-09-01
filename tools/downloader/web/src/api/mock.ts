/**
 * In-memory mock transport.
 *
 * It exists so the UI can be built and demonstrated before `apps/api` does, and
 * it is deliberately more than a stub: it validates requests with the real zod
 * schemas from `@downloader/contract`, folds its own state with the same reducer
 * the UI uses, and replays a `JobEvent` timeline over a fake event stream with
 * realistic delays — including dropped connections, so the reconnect path is
 * exercised rather than assumed.
 *
 * Two behaviours are intentional and load-bearing for the demo:
 *  - a fake stream delivers only events emitted *after* it opened. Frames sent
 *    while disconnected are genuinely lost, which is what makes the reconcile
 *    refetch observable rather than decorative.
 *  - state lives in memory only, so a page reload leaves persisted jobs unknown
 *    to the "server" and surfaces `JOB_NOT_FOUND` the way a server restart would.
 */

import { AppError, ROUTES, createJobRequestSchema, probeRequestSchema } from "@downloader/contract";
import type {
  CreateJobRequest,
  ErrorCode,
  Job,
  JobEvent,
  JobListItem,
  JobListResponse,
  JobOptions,
  JobProgress,
  JobResponse,
  JobResult,
  JobStatus,
  MediaVariant,
  ProbeRequest,
  ProbeResponse,
  ProbeResult,
} from "@downloader/contract";
import { systemClock, sleep } from "../lib/clock.ts";
import type { Clock } from "../lib/clock.ts";
import type { EventStream, EventStreamHandlers } from "../lib/event-stream.ts";
import { applyJobEvent } from "../lib/job-reducer.ts";
import { findVariant, pickDefaultVariantId } from "../lib/variants.ts";
import { baseProbeResult, findScenario } from "./scenarios.ts";
import type { JobScript, Scenario } from "./scenarios.ts";
import type { ApiClient } from "./types.ts";

const DOWNLOAD_TICKS = 12;
const TICK_MS = 480;
const RETENTION_HOURS = 6;
const FALLBACK_TOTAL_BYTES = 240 * 1024 * 1024;

interface Step {
  /** Milliseconds after job creation. */
  atMs: number;
  run: (runtime: JobRuntime) => void;
}

interface MockStream {
  handlers: EventStreamHandlers;
  closed: boolean;
}

interface JobRuntime {
  job: Job;
  probe: ProbeResult;
  variant: MediaVariant | null;
  scenario: Scenario;
  streams: Set<MockStream>;
  timers: Array<() => void>;
  stopped: boolean;
}

export interface MockClientOptions {
  clock?: Clock;
  /** Multiplies every delay. 0.25 makes the whole demo run four times faster. */
  speed?: number;
}

// Folding with the production reducer keeps the mock's own idea of the job
// identical to what a correct client would compute from the same frames.
function emit(runtime: JobRuntime, event: JobEvent): void {
  runtime.job = applyJobEvent(runtime.job, event);
  for (const stream of runtime.streams) {
    if (!stream.closed) stream.handlers.onEvent(event);
  }
}

/** Simulates the SSE connection dying: every open listener sees an error. */
function dropStreams(runtime: JobRuntime): void {
  const open = [...runtime.streams];
  runtime.streams.clear();
  for (const stream of open) {
    if (stream.closed) continue;
    stream.closed = true;
    stream.handlers.onError();
  }
}

function halt(runtime: JobRuntime): void {
  runtime.stopped = true;
  for (const cancel of runtime.timers) cancel();
  runtime.timers = [];
}

export function createMockClient(options: MockClientOptions = {}): ApiClient {
  const clock = options.clock ?? systemClock;
  const speed = options.speed ?? 1;
  const runtimes = new Map<string, JobRuntime>();

  const scaled = (ms: number): number => Math.max(0, Math.round(ms * speed));
  const nowIso = (): string => new Date(clock.now()).toISOString();

  function schedule(runtime: JobRuntime, steps: readonly Step[]): void {
    for (const step of steps) {
      const cancel = clock.schedule(() => {
        if (runtime.stopped) return;
        step.run(runtime);
      }, scaled(step.atMs));
      runtime.timers.push(cancel);
    }
  }

  function statusStep(atMs: number, status: JobStatus): Step {
    return {
      atMs,
      run: (runtime) =>
        emit(runtime, { type: "status", jobId: runtime.job.id, status, at: nowIso() }),
    };
  }

  function failStep(atMs: number, code: ErrorCode): Step {
    return {
      atMs,
      run: (runtime) => {
        emit(runtime, {
          type: "failed",
          jobId: runtime.job.id,
          error: new AppError(code).toPayload(),
          at: nowIso(),
        });
        halt(runtime);
      },
    };
  }

  function buildSteps(
    script: JobScript,
    probeResult: ProbeResult,
    variant: MediaVariant | null,
  ): Step[] {
    const steps: Step[] = [];
    const totalBytes = script.indeterminate ? null : (variant?.filesizeBytes ?? null);
    const durationSec = variant?.durationSec ?? probeResult.durationSec ?? null;
    const dropTicks = new Set(script.dropStreamAt ?? []);

    let t = 300;
    steps.push(statusStep(t, "probing"));

    t += 800;
    steps.push({
      atMs: t,
      run: (runtime) =>
        emit(runtime, { type: "probed", jobId: runtime.job.id, probe: probeResult, at: nowIso() }),
    });

    if (script.failAt === "probing" && script.failWith) {
      steps.push(failStep(t + 600, script.failWith));
      return steps;
    }

    t += 700;
    steps.push(statusStep(t, "downloading"));

    const failTick = script.failAt === "downloading" ? Math.ceil(DOWNLOAD_TICKS / 2) : -1;
    for (let tick = 1; tick <= DOWNLOAD_TICKS; tick += 1) {
      t += TICK_MS;
      if (tick === failTick && script.failWith) {
        steps.push(failStep(t, script.failWith));
        return steps;
      }
      const fraction = tick / DOWNLOAD_TICKS;
      const progress = downloadProgress(
        fraction,
        totalBytes,
        durationSec,
        script.indeterminate === true,
      );
      steps.push({
        atMs: t,
        run: (runtime) =>
          emit(runtime, { type: "progress", jobId: runtime.job.id, progress, at: nowIso() }),
      });
      if (dropTicks.has(tick)) {
        steps.push({ atMs: t + 40, run: dropStreams });
      }
      if (tick % 4 === 0) {
        steps.push({
          atMs: t + 80,
          run: (runtime) => emit(runtime, { type: "heartbeat", at: nowIso() }),
        });
      }
    }

    t += 600;
    steps.push(statusStep(t, "muxing"));

    if (script.failAt === "muxing" && script.failWith) {
      steps.push(failStep(t + 900, script.failWith));
      return steps;
    }

    for (let tick = 1; tick <= 2; tick += 1) {
      t += 600;
      const fraction = tick / 2;
      const progress: JobProgress = {
        stage: "muxing",
        percent: script.indeterminate ? null : Math.round(fraction * 100),
        downloadedBytes: totalBytes ?? Math.round(FALLBACK_TOTAL_BYTES),
        totalBytes,
        segmentsDone: null,
        segmentsTotal: null,
        speedBps: null,
        etaSec: null,
        processedSec: durationSec === null ? null : Math.round(durationSec * fraction),
      };
      steps.push({
        atMs: t,
        run: (runtime) =>
          emit(runtime, { type: "progress", jobId: runtime.job.id, progress, at: nowIso() }),
      });
    }

    t += 700;
    steps.push({
      atMs: t,
      run: (runtime) => {
        emit(runtime, {
          type: "completed",
          jobId: runtime.job.id,
          result: buildResult(runtime, script, totalBytes, durationSec, clock),
          at: nowIso(),
        });
        halt(runtime);
      },
    });

    return steps;
  }

  async function probe(request: ProbeRequest): Promise<ProbeResponse> {
    const parsed = probeRequestSchema.safeParse(request);
    if (!parsed.success) throw new AppError("INVALID_URL");

    const scenario = findScenario(parsed.data.url);
    await sleep(clock, scaled(scenario.probeDelayMs));

    if (scenario.probeError)
      throw new AppError(scenario.probeError, undefined, drmDetails(scenario));

    return { probe: buildProbe(scenario, parsed.data.url, nowIso()), cached: false };
  }

  async function createJob(request: CreateJobRequest): Promise<JobResponse> {
    const parsed = createJobRequestSchema.safeParse(request);
    if (!parsed.success) throw new AppError("INVALID_URL");

    const scenario = findScenario(parsed.data.url);
    if (scenario.probeError)
      throw new AppError(scenario.probeError, undefined, drmDetails(scenario));

    const result = buildProbe(scenario, parsed.data.url, nowIso());
    const jobOptions: JobOptions = parsed.data.options ?? {};

    // A live manifest has no end; the API refuses to start one open-ended.
    if (result.isLive && !jobOptions.liveDurationSec) {
      throw new AppError("LIVE_STREAM_UNSUPPORTED");
    }

    const variantId = jobOptions.variantId ?? pickDefaultVariantId(result.variants);
    const variant = findVariant(result.variants, variantId);
    const at = nowIso();
    const job: Job = {
      id: newId(),
      sourceUrl: parsed.data.url,
      variantId,
      variant,
      status: "queued",
      progress: idleProgress(),
      result: null,
      error: null,
      attempts: 0,
      createdAt: at,
      updatedAt: at,
      finishedAt: null,
    };

    const runtime: JobRuntime = {
      job,
      probe: result,
      variant,
      scenario,
      streams: new Set(),
      timers: [],
      stopped: false,
    };
    runtimes.set(job.id, runtime);
    schedule(runtime, buildSteps(scenario.job, result, variant));
    return { job };
  }

  function requireRuntime(id: string): JobRuntime {
    const runtime = runtimes.get(id);
    if (!runtime) throw new AppError("JOB_NOT_FOUND");
    return runtime;
  }

  return {
    probe,
    createJob,

    // `async` rather than a plain `Promise.resolve`, so a missing job rejects
    // the promise instead of throwing synchronously at the call site — callers
    // treat this as a network boundary.
    async getJob(id: string): Promise<JobResponse> {
      return { job: requireRuntime(id).job };
    },

    async listJobs(): Promise<JobListResponse> {
      // Strips the capability exactly as the real route does, so the mock
      // cannot make the UI look like it works against a shape the server never
      // sends. The compiler enforces it: `JobListResult` declares
      // `downloadUrl?: never`, so returning the raw jobs does not typecheck.
      const jobs = [...runtimes.values()].map(({ job }): JobListItem => {
        if (job.result === null) return { ...job, result: null };
        const { filename, sizeBytes, container, durationSec, expiresAt } = job.result;
        return { ...job, result: { filename, sizeBytes, container, durationSec, expiresAt } };
      });
      return { jobs, total: jobs.length };
    },

    async cancelJob(id: string): Promise<JobResponse> {
      const runtime = requireRuntime(id);
      halt(runtime);
      // Only a status frame: the `JobEvent` union has no way to attach an
      // error payload to a cancellation, so the UI renders `JOB_CANCELED`
      // copy from the status alone.
      emit(runtime, {
        type: "status",
        jobId: runtime.job.id,
        status: "canceled",
        at: nowIso(),
      });
      return { job: runtime.job };
    },

    openJobEvents(jobId, handlers): EventStream {
      const runtime = runtimes.get(jobId);
      if (!runtime) {
        // Mirrors a 404 on the SSE endpoint: the connection simply fails, and
        // the caller's reconcile fetch is what surfaces JOB_NOT_FOUND.
        const cancel = clock.schedule(() => handlers.onError(), scaled(50));
        return { close: cancel };
      }
      const stream: MockStream = { handlers, closed: false };
      runtime.streams.add(stream);
      const cancelOpen = clock.schedule(() => {
        if (!stream.closed) handlers.onOpen();
      }, scaled(60));
      return {
        close() {
          cancelOpen();
          stream.closed = true;
          runtime.streams.delete(stream);
        },
      };
    },
  };
}

function drmDetails(scenario: Scenario): { details: Record<string, unknown> } | undefined {
  if (scenario.probeError !== "DRM_PROTECTED") return undefined;
  return {
    details: { systems: ["widevine"], evidence: "requestMediaKeySystemAccess(com.widevine.alpha)" },
  };
}

function buildProbe(scenario: Scenario, url: string, at: string): ProbeResult {
  const base = baseProbeResult(url, at);
  return scenario.probe ? scenario.probe(base) : base;
}

function idleProgress(): JobProgress {
  return {
    stage: "queued",
    percent: null,
    downloadedBytes: 0,
    totalBytes: null,
    segmentsDone: null,
    segmentsTotal: null,
    speedBps: null,
    etaSec: null,
    processedSec: null,
  };
}

function downloadProgress(
  fraction: number,
  totalBytes: number | null,
  durationSec: number | null,
  indeterminate: boolean,
): JobProgress {
  const scale = totalBytes ?? FALLBACK_TOTAL_BYTES;
  const downloadedBytes = Math.round(scale * fraction);
  const speedBps = Math.round(scale / (DOWNLOAD_TICKS * (TICK_MS / 1000)));
  const remaining = 1 - fraction;
  return {
    stage: "downloading",
    percent: indeterminate || totalBytes === null ? null : Math.round(fraction * 1000) / 10,
    downloadedBytes,
    totalBytes,
    segmentsDone: Math.round(DOWNLOAD_TICKS * 18 * fraction),
    segmentsTotal: indeterminate ? null : DOWNLOAD_TICKS * 18,
    speedBps,
    etaSec:
      indeterminate || totalBytes === null
        ? null
        : Math.max(0, Math.round((totalBytes * remaining) / speedBps)),
    processedSec: durationSec === null ? null : Math.round(durationSec * fraction),
  };
}

function buildResult(
  runtime: JobRuntime,
  script: JobScript,
  totalBytes: number | null,
  durationSec: number | null,
  clock: Clock,
): JobResult {
  const container = runtime.variant?.container ?? "mp4";
  const expiresAtMs = script.expiredResult
    ? clock.now() - 60_000
    : clock.now() + RETENTION_HOURS * 60 * 60 * 1000;
  return {
    filename: `${safeFilename(runtime.probe.title)}.${container}`,
    sizeBytes: totalBytes ?? FALLBACK_TOTAL_BYTES,
    container,
    durationSec,
    downloadUrl: ROUTES.file(newToken()),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function safeFilename(title: string): string {
  // Allow-list rather than a deny-list: the engine sanitises again, but the
  // demo filename should already be free of separators and control characters.
  const cleaned = title
    .replaceAll(/[^\w .()-]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return (cleaned || "download").slice(0, 80);
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

function newToken(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}
