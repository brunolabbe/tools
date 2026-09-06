/**
 * The shapes the API hands the UI, built here rather than asserted.
 *
 * **Every builder returns its value through the contract's own zod schema — all
 * seven of them, with no exceptions.**
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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
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
  jobProgressSchema,
  jobResultSchema,
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

/**
 * The variants a resolver really produced from a real source, named by the
 * fixture's path under the resolvers suite — `manifests/…` for something
 * `parseHls` read, `ytdlp/…` for something `mapYtDlpInfo` mapped. For the dl-40
 * rows that differ only in a field the table cannot show.
 *
 * Everything else in this file is built here, and for those shapes that is
 * right — a builder says what the test is about. It is wrong for this one: the
 * claim under test is "the rows a real source really produced", and a
 * hand-written list of near-identical literals is the author agreeing with
 * themselves. So the sources live in the resolvers suite beside the command that
 * produced each one, and this reads what a resolver made of them.
 *
 * The `.variants.json` files are generated, and the resolvers suite fails if one
 * stops matching its producer — so they cannot drift into being hand-written
 * fixtures with extra steps. They are read rather than imported because
 * importing `@downloader/resolvers` into a jsdom test would pull playwright in
 * behind it.
 *
 * Still parsed through `mediaVariantSchema`, like every builder above.
 */
export function parsedVariants(fixture: string): MediaVariant[] {
  const file = join(resolverFixtureDir(), `${fixture}.variants.json`);
  const record: unknown = JSON.parse(readFileSync(file, "utf8"));
  return z.object({ variants: z.array(mediaVariantSchema) }).parse(record).variants;
}

/**
 * Found by walking up from the working directory, not with `import.meta.url`.
 * Half of this suite runs under jsdom, where vite rewrites that URL to an
 * `http:` one rooted at the vitest root — so `new URL("../..", import.meta.url)`
 * resolves to an absolute path that does not exist, and the same helper works
 * in one test file and fails in another for no visible reason.
 */
function resolverFixtureDir(): string {
  const suffix = join("tools", "downloader", "resolvers", "test", "fixtures");
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, suffix);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${suffix} at or above ${process.cwd()}`);
    dir = parent;
  }
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
  return jobProgressSchema.parse({
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
  });
}

export function result(overrides: Partial<JobResult> = {}): JobResult {
  return jobResultSchema.parse({
    filename: "a-sample-recording.mp4",
    sizeBytes: 418_000_000,
    container: "mp4",
    durationSec: 754,
    downloadUrl: "/api/files/opaque-token/a-sample-recording.mp4",
    expiresAt: "2026-08-20T14:00:00.000Z",
    ...overrides,
  });
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
 *
 * **A `queued` job carries no variant, and that is not a detail.** The API
 * inserts its `variant_json` column as a literal `NULL`, so every real job is
 * `variant: null` from creation until the probe fills it in. A fixture that
 * handed every status a variant emitted a shape the server cannot produce, and
 * hid `JobCard`'s title fallback chain behind its first branch — the rest of
 * the chain was unreachable in tests while being the only part a queued card
 * takes in production.
 */
export function job(status: JobStatus = "downloading", overrides: JobOverrides = {}): Job {
  const { progress: progressOverrides, ...rest } = overrides;
  const probed = status !== "queued";
  return jobSchema.parse({
    id: "job-1",
    sourceUrl: SOURCE_URL,
    variantId: probed ? "v-1080" : null,
    variant: probed ? variant() : null,
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
