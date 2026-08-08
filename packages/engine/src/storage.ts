/**
 * Storage layout, filename safety and retention.
 *
 * ```
 * <STORAGE_DIR>/tmp/<jobId>/   working files — removed on every terminal state
 * <STORAGE_DIR>/out/<jobId>/   finished artifacts — removed by the retention GC
 * ```
 *
 * Two things here are security controls rather than conveniences:
 *
 *  - **Filename sanitisation.** The name is derived from a page title, which is
 *    attacker-controlled. `../../../etc/cron.d/x`, a NUL byte, and `CON.mp4`
 *    are all things a title can contain.
 *  - **Path confinement.** Every path we are about to write is re-resolved and
 *    checked to be inside `STORAGE_DIR`. Sanitisation is a filter and filters
 *    have holes; confinement is a boundary and boundaries do not.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@downloader/shared";
import type { Logger } from "./logger.ts";
import { NOOP_LOGGER } from "./logger.ts";
import { isControlCodePoint } from "./text.ts";

export const TMP_SUBDIR = "tmp";
export const OUT_SUBDIR = "out";

/**
 * Reserved DOS device names. Still special on modern Windows: opening `NUL.mp4`
 * writes to the null device, so the download silently vanishes.
 */
const RESERVED_WINDOWS_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/** Illegal on Windows, or a path separator, or a shell/quoting hazard. */
const UNSAFE_FILENAME_CHARS: ReadonlySet<string> = new Set([
  "/",
  "\\",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

export interface SanitizeFilenameOptions {
  /** Used when nothing survives sanitisation. */
  fallback?: string;
  /** Total length cap, extension included. Most filesystems stop at 255 bytes. */
  maxLength?: number;
}

const DEFAULT_MAX_FILENAME_LENGTH = 120;

/**
 * Reduces an arbitrary string to a single safe path segment.
 *
 * The result never contains a separator, so it cannot express a directory, and
 * never matches a reserved device name.
 */
export function sanitizeFilename(name: string, options: SanitizeFilenameOptions = {}): string {
  const fallback = options.fallback ?? "download";
  const maxLength = options.maxLength ?? DEFAULT_MAX_FILENAME_LENGTH;

  let cleaned = "";
  for (const char of name.normalize("NFC")) {
    const code = char.codePointAt(0);
    if (code !== undefined && isControlCodePoint(code)) continue;
    cleaned += UNSAFE_FILENAME_CHARS.has(char) ? "_" : char;
  }

  // Collapse runs of whitespace and underscores introduced above.
  cleaned = cleaned.replaceAll(/\s+/gu, " ").trim();
  // Leading dots hide the file; trailing dots and spaces are stripped by Windows
  // itself, which turns "x. " into "x" behind our back and breaks the mapping
  // between the name we recorded and the name on disk.
  cleaned = cleaned.replace(/^[.\s]+/u, "").replace(/[.\s]+$/u, "");

  if (cleaned.length === 0) return fallback;

  const lastDot = cleaned.lastIndexOf(".");
  let stem = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const extension = lastDot > 0 ? cleaned.slice(lastDot) : "";

  if (RESERVED_WINDOWS_NAMES.has(stem.toLowerCase())) stem = `_${stem}`;

  const safeExtension = extension.length <= 12 ? extension : "";
  const stemBudget = Math.max(1, maxLength - safeExtension.length);
  if (stem.length > stemBudget) stem = stem.slice(0, stemBudget).trimEnd();
  if (stem.length === 0) stem = fallback;

  return `${stem}${safeExtension}`;
}

/**
 * Resolves `candidate` against `root` and proves the result is inside it.
 *
 * Throws rather than returning a boolean: a caller that forgets to check the
 * boolean writes outside the storage directory, and there is no safe default.
 */
export function assertPathInside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);

  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new AppError("INTERNAL", "Refusing to use a path outside the storage directory.", {
      details: { relative },
    });
  }
  return resolved;
}

/**
 * The same check after following symlinks, for the moment just before a write.
 * `assertPathInside` is textual; a symlink planted inside `tmp/` defeats it.
 */
export async function assertRealPathInside(root: string, candidate: string): Promise<string> {
  const resolved = assertPathInside(root, candidate);
  const realRoot = await fs.realpath(root);
  let realParent: string;
  try {
    realParent = await fs.realpath(path.dirname(resolved));
  } catch {
    // Parent does not exist yet; the textual check is the best available.
    return resolved;
  }
  assertPathInside(realRoot, path.join(realParent, path.basename(resolved)));
  return resolved;
}

export interface GcReport {
  removedOutDirs: string[];
  removedTmpDirs: string[];
  freedBytes: number;
}

export interface StorageOptions {
  storageDir: string;
  fileRetentionHours: number;
  /** Independent of `fileRetentionHours`: a tmp dir this old belongs to a dead job. */
  tmpRetentionHours?: number;
  logger?: Logger;
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(full);
    } else {
      const stat = await fs.stat(full).catch(() => null);
      total += stat?.size ?? 0;
    }
  }
  return total;
}

/** Newest mtime anywhere in the tree; a directory's own mtime lies after a rename. */
async function newestMtimeMs(dir: string): Promise<number> {
  const stat = await fs.stat(dir).catch(() => null);
  let newest = stat?.mtimeMs ?? 0;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const childNewest = entry.isDirectory()
      ? await newestMtimeMs(full)
      : ((await fs.stat(full).catch(() => null))?.mtimeMs ?? 0);
    if (childNewest > newest) newest = childNewest;
  }
  return newest;
}

export class Storage {
  readonly root: string;
  readonly #fileRetentionMs: number;
  readonly #tmpRetentionMs: number;
  readonly #logger: Logger;

  constructor(options: StorageOptions) {
    this.root = path.resolve(options.storageDir);
    this.#fileRetentionMs = options.fileRetentionHours * 3600 * 1000;
    this.#tmpRetentionMs = (options.tmpRetentionHours ?? options.fileRetentionHours) * 3600 * 1000;
    this.#logger = options.logger ?? NOOP_LOGGER;
  }

  get tmpRoot(): string {
    return path.join(this.root, TMP_SUBDIR);
  }

  get outRoot(): string {
    return path.join(this.root, OUT_SUBDIR);
  }

  async init(): Promise<void> {
    await fs.mkdir(this.tmpRoot, { recursive: true });
    await fs.mkdir(this.outRoot, { recursive: true });
  }

  /** Job ids come from the orchestrator, but they still get sanitised. */
  #jobSegment(jobId: string): string {
    return sanitizeFilename(jobId, { fallback: "job", maxLength: 64 });
  }

  tmpDir(jobId: string): string {
    return assertPathInside(this.root, path.join(TMP_SUBDIR, this.#jobSegment(jobId)));
  }

  outDir(jobId: string): string {
    return assertPathInside(this.root, path.join(OUT_SUBDIR, this.#jobSegment(jobId)));
  }

  async createTmpDir(jobId: string): Promise<string> {
    const dir = this.tmpDir(jobId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async createOutDir(jobId: string): Promise<string> {
    const dir = this.outDir(jobId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /** Confined path for a working file. `name` is sanitised to one segment. */
  tmpPath(jobId: string, name: string): string {
    return assertPathInside(this.tmpDir(jobId), sanitizeFilename(name, { fallback: "work" }));
  }

  /** Confined path for a finished artifact. */
  outPath(jobId: string, filename: string): string {
    return assertPathInside(this.outDir(jobId), sanitizeFilename(filename));
  }

  /**
   * Bytes currently held under `tmp/` and `out/`.
   *
   * Walks the tree rather than keeping a running total, because the total is
   * not ours alone: the retention sweep, a crashed job and an operator with a
   * shell all change it behind our back, and a counter that drifts from the
   * disk is worse than no counter. The walk is O(jobs) and happens once per
   * download, next to work measured in minutes.
   */
  async usedBytes(): Promise<number> {
    const [tmp, out] = await Promise.all([
      directorySize(this.tmpRoot),
      directorySize(this.outRoot),
    ]);
    return tmp + out;
  }

  /** Called on every terminal state, success included. */
  async cleanupJob(jobId: string): Promise<void> {
    await fs.rm(this.tmpDir(jobId), { recursive: true, force: true }).catch((error: unknown) => {
      this.#logger.warn("failed to remove tmp dir", { jobId, error: String(error) });
    });
  }

  /** Removes the finished artifact too — for cancel and failure. */
  async removeJob(jobId: string): Promise<void> {
    await this.cleanupJob(jobId);
    await fs.rm(this.outDir(jobId), { recursive: true, force: true }).catch((error: unknown) => {
      this.#logger.warn("failed to remove out dir", { jobId, error: String(error) });
    });
  }

  /**
   * Retention sweep. Deletes `out/` directories past the retention window and
   * `tmp/` directories left behind by a job that died without cleaning up —
   * a crashed worker leaks those forever otherwise.
   */
  async collectGarbage(now: number = Date.now()): Promise<GcReport> {
    const report: GcReport = { removedOutDirs: [], removedTmpDirs: [], freedBytes: 0 };

    const sweep = async (root: string, maxAgeMs: number, sink: string[]): Promise<void> => {
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const age = now - (await newestMtimeMs(dir));
        if (age < maxAgeMs) continue;

        report.freedBytes += await directorySize(dir);
        try {
          await fs.rm(dir, { recursive: true, force: true });
          sink.push(dir);
        } catch (error: unknown) {
          this.#logger.warn("retention sweep could not remove directory", {
            dir,
            error: String(error),
          });
        }
      }
    };

    await sweep(this.outRoot, this.#fileRetentionMs, report.removedOutDirs);
    await sweep(this.tmpRoot, this.#tmpRetentionMs, report.removedTmpDirs);

    if (report.removedOutDirs.length + report.removedTmpDirs.length > 0) {
      this.#logger.info("retention sweep complete", {
        out: report.removedOutDirs.length,
        tmp: report.removedTmpDirs.length,
        freedBytes: report.freedBytes,
      });
    }
    return report;
  }
}

/** Free bytes on the volume holding `dir`. Null when the platform will not say. */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}
