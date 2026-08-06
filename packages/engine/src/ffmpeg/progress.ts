/**
 * Parsing ffmpeg's `-progress` stream.
 *
 * `-progress pipe:1 -nostats` makes ffmpeg emit machine-readable `key=value`
 * lines on stdout, one block per update, terminated by `progress=continue` or
 * `progress=end`. Parsing stderr instead — the usual approach — means matching
 * a human-formatted status line that changes between builds and interleaves
 * with warnings.
 *
 * Nothing here does I/O: the parser takes chunks of text, which is what makes
 * it testable against a recorded transcript.
 */

import type { JobProgress, JobStatus } from "@downloader/shared";

/** One `progress=` block, with unknown/`N/A` fields left null. */
export interface FfmpegProgressSnapshot {
  /** Media time written so far, in microseconds. */
  outTimeUs: number | null;
  /** Bytes written to the output so far. */
  totalSize: number | null;
  /** Multiple of realtime, e.g. `12.3x`. Not a byte rate. */
  speed: number | null;
  bitrateBps: number | null;
  frame: number | null;
  fps: number | null;
  dupFrames: number | null;
  dropFrames: number | null;
  /** True for the terminal `progress=end` block. */
  done: boolean;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.toUpperCase() === "N/A") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** `12.3x` / `N/A`. A speed of 0 means "not moving", which is not the same as unknown. */
function parseSpeed(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim().replace(/x$/iu, "");
  return parseNumber(trimmed);
}

/** `1234.5kbits/s` / `N/A`. Normalised to bits per second. */
function parseBitrate(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = /^\s*([\d.]+)\s*(k|m|g)?bits\/s\s*$/iu.exec(raw);
  if (match === null) return parseNumber(raw);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const scale = { k: 1e3, m: 1e6, g: 1e9 }[(match[2] ?? "").toLowerCase()] ?? 1;
  return value * scale;
}

function snapshotFromFields(fields: ReadonlyMap<string, string>): FfmpegProgressSnapshot {
  // `out_time_us` and `out_time_ms` are both emitted; despite the name, some
  // builds report microseconds in both, so prefer the unambiguous one.
  const outTimeUs =
    parseNumber(fields.get("out_time_us")) ?? parseNumber(fields.get("out_time_ms"));

  return {
    outTimeUs,
    totalSize: parseNumber(fields.get("total_size")),
    speed: parseSpeed(fields.get("speed")),
    bitrateBps: parseBitrate(fields.get("bitrate")),
    frame: parseNumber(fields.get("frame")),
    fps: parseNumber(fields.get("fps")),
    dupFrames: parseNumber(fields.get("dup_frames")),
    dropFrames: parseNumber(fields.get("drop_frames")),
    done: fields.get("progress") === "end",
  };
}

/**
 * Incremental parser. `push()` tolerates chunk boundaries falling anywhere,
 * including mid-line, and returns one snapshot per completed block.
 */
export class FfmpegProgressParser {
  #buffer = "";
  #fields = new Map<string, string>();

  push(chunk: string): FfmpegProgressSnapshot[] {
    this.#buffer += chunk;
    const snapshots: FfmpegProgressSnapshot[] = [];

    let newlineAt = this.#buffer.indexOf("\n");
    while (newlineAt !== -1) {
      const line = this.#buffer.slice(0, newlineAt).trim();
      this.#buffer = this.#buffer.slice(newlineAt + 1);
      newlineAt = this.#buffer.indexOf("\n");

      if (line.length === 0) continue;
      const equalsAt = line.indexOf("=");
      if (equalsAt === -1) continue;

      const key = line.slice(0, equalsAt).trim();
      const value = line.slice(equalsAt + 1).trim();
      this.#fields.set(key, value);

      // `progress` is always the last key of a block.
      if (key === "progress") {
        snapshots.push(snapshotFromFields(this.#fields));
        this.#fields = new Map();
      }
    }

    return snapshots;
  }

  /** Flushes a trailing block that never got its `progress=` line (killed process). */
  flush(): FfmpegProgressSnapshot | null {
    if (this.#fields.size === 0) return null;
    const snapshot = snapshotFromFields(this.#fields);
    this.#fields = new Map();
    return snapshot;
  }
}

/**
 * Byte rate over a trailing window.
 *
 * `JobProgress.speedBps` is documented as a windowed rate, not a cumulative
 * average — a cumulative average makes a stream that stalled five minutes ago
 * still look healthy.
 */
export class RateTracker {
  readonly #windowMs: number;
  #samples: { at: number; bytes: number }[] = [];

  constructor(windowMs = 5000) {
    this.#windowMs = windowMs;
  }

  record(bytes: number, at: number): void {
    this.#samples.push({ at, bytes });
    const cutoff = at - this.#windowMs;
    while (this.#samples.length > 2 && (this.#samples[0]?.at ?? 0) < cutoff) {
      this.#samples.shift();
    }
  }

  /** Null until there are two samples spanning a non-zero interval. */
  bytesPerSecond(): number | null {
    const first = this.#samples[0];
    const last = this.#samples.at(-1);
    if (first === undefined || last === undefined) return null;
    const elapsedMs = last.at - first.at;
    if (elapsedMs <= 0) return null;
    const delta = last.bytes - first.bytes;
    if (delta < 0) return null;
    return (delta * 1000) / elapsedMs;
  }

  reset(): void {
    this.#samples = [];
  }
}

export interface JobProgressContext {
  stage: JobStatus;
  /** Total media duration, when known. The only thing that can produce a percent. */
  durationSec: number | null;
  /** Expected output size, when known. */
  totalBytes: number | null;
  speedBps: number | null;
  segmentsDone?: number | null;
  segmentsTotal?: number | null;
}

/**
 * Maps an ffmpeg snapshot onto the shared `JobProgress` contract.
 *
 * `percent` stays null whenever the duration is unknown — which is every live
 * stream and plenty of VOD manifests. Inventing a number there is worse than
 * showing a spinner, because the number goes backwards.
 */
export function toJobProgress(
  snapshot: FfmpegProgressSnapshot,
  context: JobProgressContext,
): JobProgress {
  const processedSec = snapshot.outTimeUs === null ? null : snapshot.outTimeUs / 1_000_000;
  const duration =
    context.durationSec !== null && context.durationSec > 0 ? context.durationSec : null;

  let percent: number | null = null;
  if (duration !== null && processedSec !== null) {
    percent = Math.min(100, Math.max(0, (processedSec / duration) * 100));
  }

  let etaSec: number | null = null;
  if (duration !== null && processedSec !== null && snapshot.speed !== null && snapshot.speed > 0) {
    etaSec = Math.max(0, (duration - processedSec) / snapshot.speed);
  }

  return {
    stage: context.stage,
    percent,
    downloadedBytes: snapshot.totalSize ?? 0,
    totalBytes: context.totalBytes,
    segmentsDone: context.segmentsDone ?? null,
    segmentsTotal: context.segmentsTotal ?? null,
    speedBps: context.speedBps,
    etaSec,
    processedSec,
  };
}
