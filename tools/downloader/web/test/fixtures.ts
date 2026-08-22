/**
 * The shapes the API hands the UI, built here rather than asserted.
 *
 * **Every builder returns its value through the contract's own zod schema.**
 * That is what dl-15 asks for and it is not decoration: a component test builds
 * props by hand, and a hand-typed object drifts from the contract silently — the
 * compiler is happy with an object literal that satisfies a type alias that no
 * longer describes anything the server sends. Parsing through `jobSchema`,
 * `probeResultSchema` and friends means a contract change fails these builders
 * at run time as well as at `npm run check`, which is the loud version.
 *
 * The parse also earns something smaller and immediate: `exactOptionalPropertyTypes`
 * makes `MediaVariant`'s optional fields `?: T | undefined`, so spreading
 * overrides into a literal is fine, and `.parse()` hands back a value the
 * component's props type accepts with no cast in the middle.
 *
 * Nothing here comes from `src/api/mock.ts`. The mock is the product's own
 * stand-in transport and `mock-api.test.ts` covers it; a component test fed only
 * mock data proves the mock renders.
 */

import type {
  AppErrorPayload,
  ErrorCode,
  Job,
  JobProgress,
  JobResult,
  JobStatus,
  MediaVariant,
  ProbeResult,
} from "@downloader/contract";
import {
  DEFAULT_ERROR_MESSAGES,
  RETRYABLE_CODES,
  appErrorPayloadSchema,
  jobSchema,
  mediaVariantSchema,
  probeResultSchema,
} from "@downloader/contract";

/** Fixed so a rendered timestamp or countdown is never a function of the wall clock. */
export const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const AT = "2026-08-20T11:59:00.000Z";

export const SOURCE_URL = "https://videos.example.com/watch/sample";

export function variant(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return mediaVariantSchema.parse({
    id: "v-1080",
    protocol: "hls",
    url: "https://cdn.example.com/1080/master.m3u8",
    hasVideo: true,
    hasAudio: true,
    videoCodec: "avc1.640028",
    audioCodec: "mp4a.40.2",
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateBps: 5_000_000,
    filesizeBytes: 420_000_000,
    label: "1080p · H.264 + AAC",
    ...overrides,
  });
}

/**
 * Best-first, the way a resolver returns them, and deliberately mixed: a muxed
 * 1080p, a 720p whose audio is a separate URL, and an audio-only rendition.
 * `pickDefaultVariantId` has to walk past the taller-but-unmuxed one to reach
 * the answer, so a table built from this list exercises the rule rather than
 * agreeing with the first row.
 */
export function variants(): MediaVariant[] {
  return [
    variant({
      id: "v-2160",
      height: 2160,
      width: 3840,
      hasAudio: false,
      audioUrl: "https://cdn.example.com/audio/en.m3u8",
      bitrateBps: 18_000_000,
      label: "2160p · H.264, separate audio",
    }),
    variant(),
    variant({
      id: "v-audio",
      hasVideo: false,
      hasAudio: true,
      width: undefined,
      height: undefined,
      fps: undefined,
      videoCodec: undefined,
      bitrateBps: 128_000,
      filesizeBytes: 12_000_000,
      label: "Audio only · AAC",
    }),
  ];
}

export function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return probeResultSchema.parse({
    sourceUrl: SOURCE_URL,
    resolver: "direct",
    title: "A sample recording",
    durationSec: 754,
    variants: variants(),
    subtitles: [],
    requestContext: { headers: { referer: "https://videos.example.com/" } },
    drm: { protected: false, systems: [] },
    isLive: false,
    probedAt: AT,
    ...overrides,
  });
}

/**
 * A progress snapshot. `percent: null` is the default on purpose — the rule
 * this ticket defends is the unknown-total one, so a test that wants a
 * determinate bar has to ask for it.
 */
export function progress(overrides: Partial<JobProgress> = {}): JobProgress {
  return {
    stage: "downloading",
    percent: null,
    downloadedBytes: 41_000_000,
    totalBytes: null,
    segmentsDone: null,
    segmentsTotal: null,
    speedBps: null,
    etaSec: null,
    processedSec: null,
    ...overrides,
  };
}

export function result(overrides: Partial<JobResult> = {}): JobResult {
  return {
    filename: "a-sample-recording.mp4",
    sizeBytes: 418_000_000,
    container: "mp4",
    durationSec: 754,
    downloadUrl: "/api/files/opaque-token/a-sample-recording.mp4",
    expiresAt: "2026-08-20T14:00:00.000Z",
    ...overrides,
  };
}

export function errorPayload(
  code: ErrorCode,
  overrides: Partial<AppErrorPayload> = {},
): AppErrorPayload {
  return appErrorPayloadSchema.parse({
    code,
    message: DEFAULT_ERROR_MESSAGES[code],
    retryable: RETRYABLE_CODES.has(code),
    ...overrides,
  });
}

export interface JobOverrides extends Partial<Omit<Job, "progress">> {
  progress?: Partial<JobProgress>;
}

/**
 * A job in whatever state the caller names, with `progress.stage` following
 * `status` unless told otherwise — the server keeps those in step and a fixture
 * that let them drift would be testing a job no runner produces.
 */
export function job(status: JobStatus = "downloading", overrides: JobOverrides = {}): Job {
  const { progress: progressOverrides, ...rest } = overrides;
  return jobSchema.parse({
    id: "job-1",
    sourceUrl: SOURCE_URL,
    variantId: "v-1080",
    variant: variant(),
    status,
    progress: progress({ stage: status, ...progressOverrides }),
    result: status === "completed" ? result() : null,
    error: status === "failed" ? errorPayload("DOWNLOAD_FAILED") : null,
    attempts: 1,
    createdAt: AT,
    updatedAt: AT,
    finishedAt: null,
    ...rest,
  });
}
