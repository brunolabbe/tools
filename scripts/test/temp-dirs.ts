import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

/**
 * Scratch directories a spec makes under `os.tmpdir()`, removed when the case
 * that made them ends (repo-147).
 *
 * Four spec files made one `mkdtemp` per case and never removed it: 166 entries
 * in an empty `TMPDIR` after one run of `status`, `next-id` and `hooks`, and 17
 * more from `status-gate-record`. That is a disk a developer fills over a week
 * and a count a test that lists the temp directory cannot read through. Removal
 * is per case, not per file, so a directory does not outlive the case that owned
 * it and a failing case does not leave its own behind — `afterEach` runs after a
 * failure too.
 */
export interface TempDirs {
  /** A new directory under `os.tmpdir()` named `<prefix><random>`, tracked for removal. */
  make(prefix: string): string;
  /**
   * Remove every directory `make` returned and forget them. Every removal is
   * attempted even when one fails; the failures are then thrown together, so
   * one directory that will not go does not keep the rest on disk.
   */
  cleanup(): void;
}

/** The registry without the hook, so its own behaviour can be tested directly. */
export function createTempDirs(): TempDirs {
  const made: string[] = [];
  return {
    make(prefix) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
      made.push(dir);
      return dir;
    },
    cleanup() {
      const failures: unknown[] = [];
      for (const dir of made.splice(0)) {
        try {
          // `maxRetries` is for Windows, where a just-exited git can still hold
          // a handle on a file under the directory for a moment.
          fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) {
        throw new AggregateError(failures, `${failures.length} temp directories were not removed`);
      }
    },
  };
}

/**
 * Call once at the top level of a spec file, before any other hook. The hook it
 * registers covers every case in the file; a directory that has to outlive a
 * case (a template shared by many) is made with `fs.mkdtempSync` directly and
 * removed in the file's own `afterAll`.
 */
export function tempDirs(): TempDirs {
  const dirs = createTempDirs();
  afterEach(() => dirs.cleanup());
  return dirs;
}
