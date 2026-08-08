/**
 * The global storage quota.
 *
 * Distinct from the per-job size cap (`estimate.test.ts`) and from the free
 * space check: those bound one download and protect the volume. This one bounds
 * the service as a whole, which is what stops a stream of individually
 * reasonable downloads filling a disk that other things share.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "@downloader/shared";
import type { MediaVariant, RequestContext } from "@downloader/shared";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createEngine } from "../src/index.ts";
import { Storage } from "../src/storage.ts";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-quota-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const MB = 1024 * 1024;

/** Writes `sizeBytes` into `<root>/<kind>/<jobId>/data.bin`, optionally aged. */
async function writeJobDir(
  kind: "out" | "tmp",
  jobId: string,
  sizeBytes: number,
  ageMs = 0,
): Promise<string> {
  const dir = path.join(root, kind, jobId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "data.bin");
  await fs.writeFile(file, Buffer.alloc(sizeBytes));

  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    // The file first: writing it is what stamps the directory, so ageing the
    // directory before the file would be undone immediately.
    await fs.utimes(file, when, when);
    await fs.utimes(dir, when, when);
  }
  return dir;
}

const REQUEST_CONTEXT: RequestContext = { headers: { Referer: "https://site.example/" } };

function variant(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "progressive-720p",
    protocol: "progressive",
    url: "https://cdn.example/video.mp4",
    hasVideo: true,
    hasAudio: true,
    filesizeBytes: 1 * MB,
    ...overrides,
  };
}

/** An engine that never spawns anything: every fetch answers from this table. */
function engineWith(options: {
  maxTotalStorageBytes: number;
  fileRetentionHours?: number;
  status?: number;
}) {
  return createEngine({
    storageDir: root,
    maxTotalStorageBytes: options.maxTotalStorageBytes,
    fileRetentionHours: options.fileRetentionHours ?? 6,
    // Never resolved: the quota check runs before anything is spawned, and the
    // download path below is served entirely by `fetchImpl`.
    ffmpegPath: "/nonexistent/ffmpeg",
    maxAttempts: 1,
    fetchImpl: async () => new Response(null, { status: options.status ?? 404 }),
  });
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

describe("Storage.usedBytes", () => {
  test("counts working files as well as finished ones", async () => {
    const storage = new Storage({ storageDir: root, fileRetentionHours: 6 });
    await storage.init();
    expect(await storage.usedBytes()).toBe(0);

    await writeJobDir("out", "done", 3 * MB);
    // `tmp/` is included deliberately: a job part-way through has already taken
    // the space, and a quota that ignored it would admit work it cannot hold.
    await writeJobDir("tmp", "running", 2 * MB);

    expect(await storage.usedBytes()).toBe(5 * MB);
  });

  test("an empty storage directory reads as zero rather than failing", async () => {
    const storage = new Storage({
      storageDir: path.join(root, "never-created"),
      fileRetentionHours: 6,
    });
    expect(await storage.usedBytes()).toBe(0);
  });
});

describe("the quota", () => {
  test("refuses a download that would take the service over it", async () => {
    await writeJobDir("out", "existing", 6 * MB);
    const engine = engineWith({ maxTotalStorageBytes: 6 * MB });

    const code = await codeOf(
      engine.download({ jobId: "new", variant: variant(), requestContext: REQUEST_CONTEXT }),
    );
    // The configured cap, not the volume: `DISK_FULL` would send an operator
    // looking at a disk that has plenty of room.
    expect(code).toBe("SIZE_LIMIT_EXCEEDED");
  });

  test("sweeps expired downloads before refusing, and keeps the live ones", async () => {
    const expired = await writeJobDir("out", "old", 5 * MB, 3 * 3_600_000);
    const fresh = await writeJobDir("out", "recent", 5 * MB);

    // Under quota only if *both* go; the sweep may legitimately take only one.
    const engine = engineWith({ maxTotalStorageBytes: 4 * MB, fileRetentionHours: 1 });
    const code = await codeOf(
      engine.download({ jobId: "new", variant: variant(), requestContext: REQUEST_CONTEXT }),
    );

    expect(code).toBe("SIZE_LIMIT_EXCEEDED");
    // Everything past its retention window was already promised to the sweep,
    // so failing a download while still holding it would be self-inflicted.
    await expect(fs.stat(expired)).rejects.toThrow();
    // ...and nothing else was touched to make room.
    await expect(fs.stat(fresh)).resolves.toBeDefined();
  });

  test("lets a download through once the sweep has made room", async () => {
    await writeJobDir("out", "old", 5 * MB, 3 * 3_600_000);
    const engine = engineWith({ maxTotalStorageBytes: 4 * MB, fileRetentionHours: 1 });

    // Past the quota, so it reaches the transfer and fails on the stubbed 404.
    // A `SIZE_LIMIT_EXCEEDED` here would mean the sweep was not consulted.
    expect(
      await codeOf(
        engine.download({ jobId: "new", variant: variant(), requestContext: REQUEST_CONTEXT }),
      ),
    ).toBe("VARIANT_GONE");
  });

  test("zero disables it", async () => {
    await writeJobDir("out", "existing", 20 * MB);
    const engine = engineWith({ maxTotalStorageBytes: 0 });

    expect(
      await codeOf(
        engine.download({ jobId: "new", variant: variant(), requestContext: REQUEST_CONTEXT }),
      ),
    ).toBe("VARIANT_GONE");
  });

  test("an unknown size still counts what is already stored", async () => {
    // No `filesizeBytes` and no bitrate: the estimate is `unknown`, which must
    // not be read as "costs nothing" when the disk is already over the cap.
    await writeJobDir("out", "existing", 8 * MB);
    const engine = engineWith({ maxTotalStorageBytes: 4 * MB });

    expect(
      await codeOf(
        engine.download({
          jobId: "new",
          variant: variant({ filesizeBytes: undefined }),
          requestContext: REQUEST_CONTEXT,
        }),
      ),
    ).toBe("SIZE_LIMIT_EXCEEDED");
  });
});
