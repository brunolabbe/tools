import { describe, expect, test } from "vitest";
import { AppError } from "@downloader/contract";
import { mapWithConcurrency } from "../src/download/pool.ts";
import { buildConcatList } from "../src/download/segments.ts";

describe("mapWithConcurrency", () => {
  test("preserves input order regardless of completion order", async () => {
    const results = await mapWithConcurrency(
      [30, 5, 20, 1],
      async (delay, index) => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return `${index}:${delay}`;
      },
      { concurrency: 4 },
    );

    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1"]);
  });

  test("never exceeds the bound — this is what keeps an origin from 429ing", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
      },
      { concurrency: 3 },
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test("stops handing out work after the first failure", async () => {
    let started = 0;

    await expect(
      mapWithConcurrency(
        Array.from({ length: 50 }, (_, index) => index),
        async (index) => {
          started += 1;
          await new Promise((resolve) => setTimeout(resolve, 2));
          if (index === 1) throw new AppError("DOWNLOAD_FAILED");
          return index;
        },
        { concurrency: 2 },
      ),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });

    expect(started).toBeLessThan(10);
  });

  test("aborts promptly", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      mapWithConcurrency([1, 2, 3], async (value) => value, {
        concurrency: 2,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "JOB_CANCELED" });
  });

  test("reports progress as items settle", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4], async (value) => value, {
      concurrency: 1,
      onSettled: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  test("handles an empty list", async () => {
    await expect(mapWithConcurrency([], async () => 1, { concurrency: 4 })).resolves.toEqual([]);
  });
});

describe("buildConcatList", () => {
  test("uses forward slashes so ffmpeg's own parser reads Windows paths", () => {
    expect(buildConcatList(["C:\\storage\\tmp\\j\\000000.ts"])).toBe(
      "file 'C:/storage/tmp/j/000000.ts'\n",
    );
  });

  test("escapes a quote so it cannot terminate the entry early", () => {
    expect(buildConcatList(["/tmp/it's.ts"])).toBe("file '/tmp/it'\\''s.ts'\n");
  });

  test("emits one line per segment, in order", () => {
    expect(buildConcatList(["/a/0.ts", "/a/1.ts"])).toBe("file '/a/0.ts'\nfile '/a/1.ts'\n");
  });
});
