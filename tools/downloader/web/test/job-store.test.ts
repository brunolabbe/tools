import { describe, expect, test } from "vitest";
import type { Job } from "@downloader/contract";
import {
  JOBS_STORAGE_KEY,
  MAX_PERSISTED_JOBS,
  clearJobs,
  loadJobs,
  saveJobs,
} from "../src/lib/job-store.ts";
import { createMemoryStorageStub } from "./helpers.ts";

function job(id: string, createdAt: string, status: Job["status"] = "downloading"): Job {
  return {
    id,
    sourceUrl: "https://videos.example.com/watch/sample",
    variantId: "hls-720p",
    variant: null,
    status,
    progress: {
      stage: status,
      percent: 12.5,
      downloadedBytes: 1024,
      totalBytes: 8192,
      segmentsDone: 3,
      segmentsTotal: 24,
      speedBps: 512,
      etaSec: 14,
      processedSec: 7,
    },
    result: null,
    error: null,
    attempts: 1,
    createdAt,
    updatedAt: createdAt,
    finishedAt: null,
  };
}

describe("job persistence", () => {
  test("round-trips a job list unchanged", () => {
    const storage = createMemoryStorageStub();
    const jobs = [job("a", "2026-08-05T10:00:00.000Z"), job("b", "2026-08-05T09:00:00.000Z")];
    saveJobs(storage, jobs);
    expect(loadJobs(storage)).toEqual(jobs);
  });

  test("returns newest first regardless of input order", () => {
    const storage = createMemoryStorageStub();
    saveJobs(storage, [
      job("old", "2026-08-01T00:00:00.000Z"),
      job("new", "2026-08-05T00:00:00.000Z"),
    ]);
    expect(loadJobs(storage).map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  test("caps the stored list", () => {
    const storage = createMemoryStorageStub();
    const many = Array.from({ length: MAX_PERSISTED_JOBS + 10 }, (_unused, index) =>
      job(`job-${index}`, new Date(1_700_000_000_000 + index * 1000).toISOString()),
    );
    saveJobs(storage, many);
    expect(loadJobs(storage)).toHaveLength(MAX_PERSISTED_JOBS);
  });

  test("survives absent, corrupt and non-array payloads", () => {
    const storage = createMemoryStorageStub();
    expect(loadJobs(storage)).toEqual([]);
    storage.setItem(JOBS_STORAGE_KEY, "{not json");
    expect(loadJobs(storage)).toEqual([]);
    storage.setItem(JOBS_STORAGE_KEY, '{"jobs":[]}');
    expect(loadJobs(storage)).toEqual([]);
  });

  test("drops entries that do not match the Job contract but keeps the rest", () => {
    const storage = createMemoryStorageStub();
    const good = job("good", "2026-08-05T10:00:00.000Z");
    storage.setItem(
      JOBS_STORAGE_KEY,
      JSON.stringify([
        good,
        { id: "no-progress", status: "queued" },
        { ...good, id: "bad-status", status: "teleporting" },
        { ...good, id: "bad-error", error: { code: "NOT_A_CODE", message: "x", retryable: false } },
        null,
        "nope",
      ]),
    );
    expect(loadJobs(storage).map((entry) => entry.id)).toEqual(["good"]);
  });

  test("a throwing storage never breaks load or save", () => {
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadJobs(hostile)).toEqual([]);
    expect(() => saveJobs(hostile, [job("a", "2026-08-05T10:00:00.000Z")])).not.toThrow();
    expect(() => clearJobs(hostile)).not.toThrow();
  });

  test("clearJobs empties the slot", () => {
    const storage = createMemoryStorageStub();
    saveJobs(storage, [job("a", "2026-08-05T10:00:00.000Z")]);
    clearJobs(storage);
    expect(loadJobs(storage)).toEqual([]);
  });

  test("a preview path survives the round trip", () => {
    const storage = createMemoryStorageStub();
    const withPreview: Job = {
      ...job("a", "2026-08-05T10:00:00.000Z"),
      thumbnailPath: "/api/thumbnail/abc123",
    };
    saveJobs(storage, [withPreview]);
    expect(loadJobs(storage)[0]?.thumbnailPath).toBe("/api/thumbnail/abc123");
  });

  test("a record written before the field existed still loads", () => {
    // **The one that matters.** `thumbnailPath` is new, so every record already
    // in a browser under `downloader:jobs:v1` lacks the key — and `loadJobs`
    // silently keeps only what parses. Spelled `.nullable()` alone in
    // `jobSchema`, zod rejects a missing key outright and this would return
    // `[]`: every user's downloads list emptied on their first load after
    // deploy, with no error and no version bump to explain it.
    //
    // Written as a raw v1-shaped object rather than by deleting a key from a
    // `Job`, because that is the shape actually sitting in storage today.
    const storage = createMemoryStorageStub();
    const { thumbnailPath: _absent, ...v1Shaped } = {
      ...job("a", "2026-08-05T10:00:00.000Z"),
      thumbnailPath: undefined,
    };
    expect("thumbnailPath" in v1Shaped).toBe(false);
    storage.setItem(JOBS_STORAGE_KEY, JSON.stringify([v1Shaped]));

    const loaded = loadJobs(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe("a");
    // Absent, not invented: nothing may fabricate a token that was never minted.
    expect(loaded[0]?.thumbnailPath).toBeUndefined();
  });

  test("an explicit null preview is preserved, and is not the same as absent", () => {
    // The server writes `null` when a probe found no image. Both spellings have
    // to survive, which is why the schema is `.nullable().optional()` and not
    // one or the other.
    const storage = createMemoryStorageStub();
    saveJobs(storage, [{ ...job("a", "2026-08-05T10:00:00.000Z"), thumbnailPath: null }]);
    expect(loadJobs(storage)[0]?.thumbnailPath).toBeNull();
  });
});
