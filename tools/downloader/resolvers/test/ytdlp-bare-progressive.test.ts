/**
 * dl-64: a progressive ladder yt-dlp describes by height alone, through the
 * whole yt-dlp tier — the stand-in binary emits `extractor-null-fps.json`, and
 * a fake origin serves a synthetic MP4 at every URL in it.
 *
 * In its own file rather than at the end of `ytdlp.test.ts` because it needs
 * imports that one does not have, and an import added at the top of that file
 * would move every line a merged gate record cites.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { probeResultSchema } from "@downloader/contract";
import type { ProbeResult, ResolveOptions } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { compareVariantQuality } from "../src/common.ts";
import { ResolverRegistry } from "../src/registry.ts";
import { YtDlpResolver } from "../src/resolvers/ytdlp.ts";
import type { YtDlpInfo } from "../src/resolvers/ytdlp.ts";
import { HEAD_WINDOW_BYTES } from "../src/mp4-header.ts";
import { faststartMp4, servingFiles, tailMoovMp4, trak } from "./helpers/mp4.ts";
import type { ServedCall } from "./helpers/mp4.ts";

const FAKE_BINARY = fileURLToPath(new URL("./fixtures/ytdlp/fake-ytdlp.mjs", import.meta.url));
const SOURCE = new URL("https://vod.example.com/watch/clip");
const DURATION = 803;

const info = JSON.parse(
  readFileSync(new URL("./fixtures/ytdlp/extractor-null-fps.json", import.meta.url), "utf8"),
) as YtDlpInfo;
const FORMATS = (info.formats ?? []).map((format) => ({
  id: format.format_id ?? "",
  url: format.url ?? "",
  height: format.height ?? 0,
  isAv1: format.vcodec === "av1",
  userAgent: format.http_headers?.["User-Agent"] ?? "",
}));

/**
 * The two layouts measured on the reported page: H.264 written faststart, AV1
 * with `mdat` first and `moov` at the tail — the AV1 one behind more media than
 * the first read covers. The H.264 brands carry `av01` and no `avc1`, and the
 * AV1 brands carry `avc1`, so a reader taking a brand for a codec gets every
 * row wrong. Sizes differ per file so a size on the wrong row cannot pass.
 */
const FILES = new Map(
  FORMATS.map((format) => [
    format.url,
    format.isAv1
      ? tailMoovMp4({
          brands: ["isom", "iso2", "avc1", "mp41"],
          tracks: [trak("vide", "av01"), trak("soun", "mp4a")],
          mdatBytes: HEAD_WINDOW_BYTES + format.height * 40,
        })
      : faststartMp4({
          brands: ["isom", "iso6", "av01"],
          tracks: [trak("vide", "avc1"), trak("soun", "mp4a")],
          mdatBytes: 20_000 + format.height * 50,
          // The measured `moov`s were 242–309 KiB, past the first read.
          moovPadding: HEAD_WINDOW_BYTES + 1000,
        }),
  ]),
);

function resolverOver(fetch: typeof globalThis.fetch): YtDlpResolver {
  return new YtDlpResolver({
    binaryPath: process.execPath,
    binaryArgs: [FAKE_BINARY, "extractor-null-fps"],
    fetch,
  });
}

/** Every request stalls until its own signal fires, as a dead origin would. */
const stalling: typeof globalThis.fetch = async (_input, init) =>
  await new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal === null || signal === undefined) return;
    signal.addEventListener("abort", () => {
      reject(signal.reason as Error);
    });
  });

function options(signal: AbortSignal = new AbortController().signal): ResolveOptions {
  return { timeoutMs: 20_000, signal };
}

function variant(probe: ProbeResult, id: string) {
  const found = probe.variants.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no variant ${id}`);
  return found;
}

describe("a progressive ladder described only by height (dl-64)", () => {
  test("every row is sized exactly, given a measured bitrate, its codecs and its audio", async () => {
    const seenHeaders: Headers[] = [];
    const served = servingFiles(FILES);
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seenHeaders.push(new Headers(init?.headers));
      return await served.fetch(input, init);
    };

    const probe = await resolverOver(fetch).resolve(SOURCE, options());

    expect(probe.variants).toHaveLength(14);
    expect(probeResultSchema.safeParse(probe).error).toBeUndefined();
    for (const format of FORMATS) {
      const row = variant(probe, format.id);
      const bytes = FILES.get(format.url)?.byteLength ?? 0;
      expect(row.filesizeBytes).toBe(bytes);
      expect(row.filesizeIsEstimate).toBe(false);
      expect(row.bitrateBps).toBe(Math.round((bytes * 8) / DURATION));
      // yt-dlp's own `av1` is kept, not replaced with the fourcc.
      expect(row.videoCodec).toBe(format.isAv1 ? "av1" : "avc1");
      expect(row.audioCodec).toBe("mp4a");
      expect(row.hasAudio).toBe(true);
    }
    expect(variant(probe, "480p").label).toMatch(/^480p · H\.264 \+ AAC · /u);
    expect(variant(probe, "av1-480p").label).toMatch(/^480p · AV1 \+ AAC · /u);

    // Best-first still holds once bitrates exist to break ties within a height.
    expect(probe.variants).toEqual(probe.variants.toSorted(compareVariantQuality));

    // One HEAD per file, then two ranged reads per file: a faststart `moov`
    // larger than the first read and a tail `moov` behind `mdat` both take two.
    const heads = served.calls.filter((call) => call.method === "HEAD");
    const ranges = served.calls.filter((call) => call.range !== undefined);
    expect(heads).toHaveLength(14);
    expect(ranges).toHaveLength(28);

    // Every request replays the extractor's headers: the ranged reads go
    // through the size probe's fetch, not around it.
    const userAgent = FORMATS[0]?.userAgent ?? "";
    expect(userAgent).not.toBe("");
    expect(seenHeaders.every((headers) => headers.get("user-agent") === userAgent)).toBe(true);
  });

  test("a file refusing every request stays blank, the others are filled, the probe succeeds", async () => {
    const refused = FORMATS.find((format) => format.id === "360p")?.url ?? "";
    const served = servingFiles(FILES, { refuse: new Set([refused]) });

    const probe = await resolverOver(served.fetch).resolve(SOURCE, options());

    const blank = variant(probe, "360p");
    expect(blank).not.toHaveProperty("filesizeBytes");
    expect(blank).not.toHaveProperty("bitrateBps");
    expect(blank).not.toHaveProperty("videoCodec");
    expect(blank).not.toHaveProperty("hasAudio");
    expect(probe.variants.filter((row) => row.filesizeBytes !== undefined)).toHaveLength(13);
    expect(probe.variants.filter((row) => row.audioCodec === "mp4a")).toHaveLength(13);
  });
});

describe("an abort while measuring a bare ladder (dl-64)", () => {
  async function abortedRun(abortOn: (call: ServedCall) => boolean): Promise<{
    probe: ProbeResult | undefined;
    error: unknown;
    calls: ServedCall[];
    afterAbort: number;
  }> {
    const controller = new AbortController();
    let afterAbort = 0;
    const served = servingFiles(FILES, {
      onCall(call) {
        if (controller.signal.aborted) afterAbort += 1;
        if (abortOn(call)) controller.abort();
      },
    });
    const outcome = await resolverOver(served.fetch)
      .resolve(SOURCE, options(controller.signal))
      .then(
        (probe) => ({ probe, error: undefined }),
        (caught: unknown) => ({ probe: undefined, error: caught }),
      );
    return { ...outcome, calls: served.calls, afterAbort };
  }

  test("during sizing, starts no further request and does not reject", async () => {
    const { probe, error, calls, afterAbort } = await abortedRun((call) => call.method === "HEAD");

    // yt-dlp had already answered: the abort ends the measuring, not the probe.
    expect(error).toBeUndefined();
    expect(probe?.variants).toHaveLength(14);
    // No header read starts once the caller has gone; only the HEADs the four
    // workers had already started are ever sent.
    expect(calls.filter((call) => call.range !== undefined)).toEqual([]);
    expect(calls.filter((call) => call.method === "HEAD").length).toBeLessThanOrEqual(4);
    expect(afterAbort).toBeLessThanOrEqual(3);
  });

  test("during header reading, starts no further request and does not reject", async () => {
    const { probe, error, calls, afterAbort } = await abortedRun(
      (call) => call.range !== undefined,
    );

    expect(error).toBeUndefined();
    expect(probe?.variants).toHaveLength(14);
    expect(calls.filter((call) => call.method === "HEAD")).toHaveLength(14);
    // At most the files already in flight get their first read, and none a second.
    expect(calls.filter((call) => call.range !== undefined).length).toBeLessThanOrEqual(4);
    expect(afterAbort).toBeLessThanOrEqual(3);
  });

  test("through the registry, a deadline landing mid-measurement still returns yt-dlp's answer", async () => {
    const registry = new ResolverRegistry([resolverOver(stalling)]);

    const outcome = await registry
      // Under the size probe's own 4 s per-request limit, so the deadline is
      // what ends the stall; long enough that spawning the stand-in is not.
      .resolve(SOURCE, { timeoutMs: 2500, signal: new AbortController().signal })
      .then(
        (probe) => ({ probe, error: undefined }),
        (caught: unknown) => ({ probe: undefined, error: caught }),
      );

    expect(outcome.error).toBeUndefined();
    expect(outcome.probe?.variants).toHaveLength(14);
    expect(outcome.probe?.variants.some((row) => row.filesizeBytes !== undefined)).toBe(false);
  });
});
