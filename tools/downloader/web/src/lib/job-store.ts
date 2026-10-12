/**
 * `localStorage` persistence for the job list.
 *
 * A refresh in the middle of a 20-minute download must not lose the work, so
 * the list survives reloads and is reconciled against the server on mount.
 * Everything stored here is untrusted on the way back in — the user, another
 * tab, or a stale schema version can all put nonsense in it — hence the guard.
 *
 * **A completed job is never kept (dl-109).** The file went to the browser and
 * the server kept no copy (dl-53), so a finished card has nothing to act on, and
 * a list of every page the visitor downloaded from is a history nobody asked
 * this page to keep. A failed or canceled job is kept until dismissed, because
 * its card is the only place the reason is written.
 */

import type { Job } from "@downloader/contract";
import { jobSchema } from "@downloader/contract";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Versioned so a contract change can invalidate old entries instead of crashing on them. */
export const JOBS_STORAGE_KEY = "downloader:jobs:v1";
export const MAX_PERSISTED_JOBS = 25;

function createdAtMs(job: Job): number {
  const parsed = Date.parse(job.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortJobs(jobs: readonly Job[]): Job[] {
  return jobs.toSorted((a, b) => createdAtMs(b) - createdAtMs(a));
}

export function loadJobs(storage: StorageLike): Job[] {
  let raw: string | null;
  try {
    raw = storage.getItem(JOBS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const jobs: Job[] = [];
  for (const candidate of parsed) {
    const parsedJob = jobSchema.safeParse(candidate);
    // Also on the way in: a list saved before dl-109 still holds completed jobs.
    if (parsedJob.success && isKept(parsedJob.data)) jobs.push(parsedJob.data);
  }
  return sortJobs(jobs).slice(0, MAX_PERSISTED_JOBS);
}

export function saveJobs(storage: StorageLike, jobs: readonly Job[]): void {
  const trimmed = sortJobs(jobs.filter(isKept)).slice(0, MAX_PERSISTED_JOBS);
  try {
    storage.setItem(JOBS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage disabled. Losing persistence is survivable;
    // failing the render is not.
  }
}

function isKept(job: Job): boolean {
  return job.status !== "completed";
}

/**
 * The page title each job was started from, by job id (dl-109). The job record
 * is a contract type and has no title — the title is what this page saw when
 * the visitor pressed Download — so it travels beside the list rather than on
 * it, under its own key.
 */
export const TITLES_STORAGE_KEY = "downloader:titles:v1";

export function loadTitles(storage: StorageLike): Record<string, string> {
  let raw: string | null;
  try {
    raw = storage.getItem(TITLES_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const titles: Record<string, string> = {};
  for (const [id, title] of Object.entries(parsed)) {
    if (typeof title === "string" && title !== "") titles[id] = title;
  }
  return titles;
}

/** Only the titles of jobs the list still persists, so the map cannot outgrow it. */
export function saveTitles(
  storage: StorageLike,
  titles: Readonly<Record<string, string>>,
  jobs: readonly Job[],
): void {
  const kept: Record<string, string> = {};
  for (const job of jobs) {
    const title = titles[job.id];
    if (title !== undefined && isKept(job)) kept[job.id] = title;
  }
  try {
    storage.setItem(TITLES_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // See saveJobs.
  }
}

export function clearJobs(storage: StorageLike): void {
  try {
    storage.removeItem(JOBS_STORAGE_KEY);
  } catch {
    // See saveJobs.
  }
}

/** In-memory fallback for private-mode browsers where `localStorage` throws. */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

export function getBrowserStorage(): StorageLike {
  try {
    const probeKey = "downloader:probe";
    globalThis.localStorage.setItem(probeKey, "1");
    globalThis.localStorage.removeItem(probeKey);
    return globalThis.localStorage;
  } catch {
    return createMemoryStorage();
  }
}
