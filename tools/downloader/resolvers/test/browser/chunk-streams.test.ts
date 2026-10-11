/**
 * dl-90: a segmented stream whose playlist was never captured as a manifest must
 * not offer its numbered chunks, and a numbered whole file must still be offered.
 *
 * Its own file, with its own pooled Chromium, so the real-MP4 bodies and the
 * server that serves them stay out of `browser-resolver.test.ts`. The bodies are
 * real boxes (`test/helpers/mp4.ts`) wherever a verdict depends on what the sniff
 * reads: an all-zero body has no box, and the sniff drops only on positive
 * evidence of a fragment.
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { MAX_SNIFF_READS } from "../../src/browser/chunk-sniff.ts";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import { startChunkServer } from "./helpers/chunk-server.ts";
import type { ChunkServer } from "./helpers/chunk-server.ts";

const TEST_TIMEOUT_MS = 90_000;
/** The resolver's own `MIN_WAIT_MS`, so a page that must find nothing does not wait the longer floor. */
const NO_EMPTY_FLOOR_MS = 1200;

let files: ChunkServer;
let pool: BrowserPool;

beforeAll(async () => {
  files = await startChunkServer();
  pool = new BrowserPool({ maxConcurrent: 1, headless: true });
});

afterAll(async () => {
  await pool.close();
  await files.close();
});

function resolver(): BrowserResolver {
  return new BrowserResolver({ pool, quietMs: 1200, emptyMinWaitMs: NO_EMPTY_FLOOR_MS });
}

async function probe(pathname: string): Promise<ProbeResult> {
  files.requests.length = 0;
  return await resolver().resolve(new URL(files.url(pathname)), {
    timeoutMs: 25_000,
    signal: new AbortController().signal,
  });
}

async function probeError(pathname: string): Promise<AppError> {
  let caught: unknown;
  try {
    await probe(pathname);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  return caught as AppError;
}

function urls(result: ProbeResult): string[] {
  return result.variants.map((variant) => variant.url);
}

describe("numbered chunks with no captured manifest are not offered (dl-90)", () => {
  test(
    "an init segment and its media segments, with the playlist uncaptured, are not offered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const error = await probeError("/nomanifest.html");

      // The page really did fetch all three, or nothing was shown to be dropped.
      expect(files.requests.map((entry) => entry.pathname)).toEqual(
        expect.arrayContaining(["/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"]),
      );
      expect(error.code).toBe("NO_MEDIA_FOUND");
    },
  );

  test(
    "twelve chunks cost one head read, not twelve: a proven fragment settles its directory",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const error = await probeError("/manychunks.html");

      expect(error.code).toBe("NO_MEDIA_FOUND");
      expect(files.headReads()).toHaveLength(1);
    },
  );
});

describe("numbered whole files are still offered (dl-90)", () => {
  test(
    "three whole files in one directory are all offered, one with its moov after its mdat",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/gallery.html");

      expect(urls(result).toSorted()).toEqual([
        files.url("/media/1.mp4"),
        files.url("/media/2.mp4"),
        files.url("/media/3.mp4"),
      ]);
      // The sniff really read each one, or "offered" proves only that it did not run.
      expect(files.headReads()).toHaveLength(3);
    },
  );

  test(
    "clip-720.mp4 and clip-1080.mp4 stay whole files",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/resolutions.html");

      expect(urls(result).toSorted()).toEqual([
        files.url("/res/clip-1080.mp4"),
        files.url("/res/clip-720.mp4"),
      ]);
      expect(files.headReads()).toHaveLength(2);
    },
  );

  test(
    "an all-zero body is offered: no box is no evidence",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/zero.html");

      expect(urls(result).toSorted()).toEqual([files.url("/zero/1.mp4"), files.url("/zero/2.mp4")]);
      expect(files.headReads().length).toBeGreaterThan(0);
    },
  );

  test(
    "a body that is boxes but not a movie is offered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/other.html");

      expect(urls(result).toSorted()).toEqual([
        files.url("/other/1.mp4"),
        files.url("/other/2.mp4"),
      ]);
    },
  );

  test(
    "reads are capped: twelve whole files cost at most the cap and all twelve are offered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/manywhole.html");

      expect(result.variants).toHaveLength(12);
      expect(files.headReads().length).toBeGreaterThan(0);
      expect(files.headReads().length).toBeLessThanOrEqual(MAX_SNIFF_READS);
    },
  );
});

describe("a whole movie written as fragmented MP4 is offered (dl-90, owner 2026-10-10)", () => {
  test(
    "a lone numbered file with moov, mvex and then moof is offered, not dropped as a chunk",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/lonefrag.html");

      expect(urls(result)).toEqual([files.url("/lf/839201.mp4")]);
      // The sniff read it and let it go, rather than not looking.
      expect(files.headReads()).toHaveLength(1);
    },
  );

  test(
    "beside two whole files in one directory, all three are offered",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/wholefrag.html");

      expect(urls(result).toSorted()).toEqual([
        files.url("/wf/1.mp4"),
        files.url("/wf/2.mp4"),
        files.url("/wf/3.mp4"),
      ]);
    },
  );
});

describe("a file the sniff read and found whole is kept beside a fragment (dl-90)", () => {
  test(
    "the whole file, read first, survives the init and media segments that follow it",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/mixed.html");

      expect(urls(result)).toEqual([files.url("/mx/1.mp4")]);
      // It was read, which is what makes keeping it a decision and not an accident:
      // the media segment settled the directory only afterwards.
      expect(files.headReads().map((entry) => entry.pathname)).toContain("/mx/1.mp4");
    },
  );
});

describe("a cancelled probe stops sniffing (dl-90)", () => {
  test(
    "aborting while a head read is outstanding rejects with the abort, promptly, and reads no more",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const controller = new AbortController();
      let abortedAt = 0;
      let readsAtAbort = 0;
      files.onSlowHead = () => {
        if (abortedAt !== 0) return;
        abortedAt = Date.now();
        readsAtAbort = files.headReads().length;
        controller.abort();
      };
      files.requests.length = 0;

      let caught: unknown;
      try {
        await resolver().resolve(new URL(files.url("/slow.html")), {
          timeoutMs: 25_000,
          signal: controller.signal,
        });
      } catch (error) {
        caught = error;
      } finally {
        files.onSlowHead = undefined;
      }
      const settledAfterMs = Date.now() - abortedAt;

      expect(abortedAt).not.toBe(0);
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe("CANCELED");
      // Not the 3 s the read was allowed, and not the 6 s of the whole sniff.
      expect(settledAfterMs).toBeLessThan(2000);
      expect(files.headReads()).toHaveLength(readsAtAbort);
    },
  );
});
