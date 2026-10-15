/**
 * dl-90: a segmented stream whose playlist was never captured as a manifest must
 * not offer its numbered chunks, and a numbered whole file must still be offered.
 *
 * Its own file, with its own pooled Chromium, so the real-MP4 bodies and the
 * server that serves them stay out of `browser-resolver.test.ts`. The bodies are
 * real boxes (`test/helpers/mp4.ts`) wherever a verdict depends on what the sniff
 * reads: an all-zero body has no box, and the sniff drops only on positive
 * evidence of a fragment.
 *
 * Three probes stay: the one page whose playlist was never captured (dl-90's
 * end-to-end claim), the gallery whose head reads really happen over HTTP, and
 * the abort. The other eight were demoted by dl-113, each to the unit test that
 * made the same assertion on the same bodies, in `chunk-sniff.test.ts`: twelve
 * chunks cost one head read ("one proven fragment drops its whole directory and
 * the rest are never requested"), twelve whole files cost at most the cap ("a
 * directory with no proof keeps everything, and reads no more than the cap"), a
 * whole file read first survives later chunks ("a file read and found whole is
 * kept when a fragment beside it is proven later"), an all-zero body, or a read
 * that finds nothing, is offered ("a read that finds nothing, or throws, offers
 * the file" and "an all-zero body is unknown"), a boxes-but-not-a-movie body is
 * offered ("a free box, then zeros is unknown"), a lone movie written as
 * fragmented MP4 is offered, alone or beside two whole files ("a whole movie
 * written as fragmented MP4 ... is not a chunk"), and clip-720.mp4 with
 * clip-1080.mp4 stay whole ("a faststart file is not: its moov has no mvex" and
 * the numbered-name rows of "which hits the sniff may read").
 */

import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserPool } from "../../src/browser/pool.ts";
import { BrowserResolver } from "../../src/resolvers/browser.ts";
import { startChunkServer } from "./helpers/chunk-server.ts";
import type { ChunkServer } from "./helpers/chunk-server.ts";
import { STREAM_WAITS } from "./helpers/stream-waits.ts";

const TEST_TIMEOUT_MS = 90_000;
/** The resolver's default `minWaitMs` (1200), so a page that must find nothing does not wait the longer floor. */
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

function resolver(
  waits: { quietMs: number; minWaitMs?: number } = { quietMs: 1200 },
): BrowserResolver {
  return new BrowserResolver({ pool, ...waits, emptyMinWaitMs: NO_EMPTY_FLOOR_MS });
}

// Only a probe that expects a stream may wait less (dl-115).
async function probe(
  pathname: string,
  waits?: { quietMs: number; minWaitMs?: number },
): Promise<ProbeResult> {
  files.requests.length = 0;
  return await resolver(waits).resolve(new URL(files.url(pathname)), {
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
});

describe("numbered whole files are still offered (dl-90)", () => {
  test(
    "three whole files in one directory are all offered, one with its moov after its mdat",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const result = await probe("/gallery.html", STREAM_WAITS);

      expect(urls(result).toSorted()).toEqual([
        files.url("/media/1.mp4"),
        files.url("/media/2.mp4"),
        files.url("/media/3.mp4"),
      ]);
      // The sniff really read each one, or "offered" proves only that it did not run.
      expect(files.headReads()).toHaveLength(3);
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
