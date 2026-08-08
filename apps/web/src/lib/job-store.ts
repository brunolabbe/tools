/**
 * `localStorage` persistence for the job list.
 *
 * A refresh in the middle of a 20-minute download must not lose the work, so
 * the list survives reloads and is reconciled against the server on mount.
 * Everything stored here is untrusted on the way back in — the user, another
 * tab, or a stale schema version can all put nonsense in it — hence the guard.
 */

import type { Job } from "@downloader/shared";
import { jobSchema } from "@downloader/shared";

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
    if (parsedJob.success) jobs.push(parsedJob.data);
  }
  return sortJobs(jobs).slice(0, MAX_PERSISTED_JOBS);
}

export function saveJobs(storage: StorageLike, jobs: readonly Job[]): void {
  const trimmed = sortJobs(jobs).slice(0, MAX_PERSISTED_JOBS);
  try {
    storage.setItem(JOBS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded or storage disabled. Losing persistence is survivable;
    // failing the render is not.
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
