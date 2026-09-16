import type { MediaVariant } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import {
  describeProgressiveTracks,
  HEAD_WINDOW_BYTES,
  MAX_MOOV_BYTES,
  readMp4Tracks,
} from "../src/mp4-header.ts";
import { createFetchSizeProbe } from "../src/size-probe.ts";
import type { SizeProbe } from "../src/size-sample.ts";
import {
  box,
  boxDeclaring,
  concat,
  faststartMp4,
  ftyp,
  largeBox,
  memoryReader,
  moov,
  servingFiles,
  tailMoovMp4,
  trak,
  zeros,
} from "./helpers/mp4.ts";

const H264_AAC = [trak("vide", "avc1"), trak("soun", "mp4a")];
const AV1_AAC = [trak("vide", "av01"), trak("soun", "mp4a")];

describe("finding moov (dl-64)", () => {
  test("a faststart file larger than the first read takes one read sized from moov's header", async () => {
    const file = faststartMp4({ brands: ["isom", "mp41"], tracks: H264_AAC, moovPadding: 200_000 });
    const { read, reads } = memoryReader(file);

    expect(await readMp4Tracks(read, { totalBytes: file.byteLength })).toEqual({
      videoCodec: "avc1",
      audioCodec: "mp4a",
      hasAudio: true,
    });
    expect(reads).toHaveLength(2);
    expect(reads[0]).toEqual({ start: 0, endInclusive: HEAD_WINDOW_BYTES - 1 });
    // The second read is moov exactly: it starts where ftyp ends.
    const moovSize = moov({ brands: [], tracks: H264_AAC, moovPadding: 200_000 }).byteLength;
    const ftypSize = ftyp(["isom", "mp41"]).byteLength;
    expect(reads[1]).toEqual({ start: ftypSize, endInclusive: ftypSize + moovSize - 1 });
  });

  test("a tail moov behind a leading mdat is found in no more than two reads beyond the first", async () => {
    // mdat alone is three first-reads long, so moov cannot arrive by accident.
    const file = tailMoovMp4({
      brands: ["isom", "av01"],
      tracks: AV1_AAC,
      mdatBytes: 3 * HEAD_WINDOW_BYTES,
      moovPadding: 100_000,
    });

    for (const totalBytes of [file.byteLength, undefined]) {
      const { read, reads } = memoryReader(file);
      // oxlint-disable-next-line no-await-in-loop -- two independent cases
      const tracks = await readMp4Tracks(read, { totalBytes });

      expect(tracks).toEqual({ videoCodec: "av01", audioCodec: "mp4a", hasAudio: true });
      expect(reads.length - 1).toBeLessThanOrEqual(2);
      // Nothing of the media itself was read beyond the first window.
      const mdatEnd =
        file.byteLength - moov({ brands: [], tracks: AV1_AAC, moovPadding: 100_000 }).byteLength;
      for (const later of reads.slice(1)) expect(later.start).toBeGreaterThanOrEqual(mdatEnd);
    }
  });

  test("a largesize mdat and a moov running to the end of the file are both walked", async () => {
    const tracks = moov({ brands: [], tracks: H264_AAC });
    // `size == 0` on the tail moov: "to the end of the file".
    const toEnd = concat(new Uint8Array([0, 0, 0, 0]), tracks.subarray(4));
    const file = concat(
      ftyp(["isom"]),
      largeBox("mdat", undefined, zeros(2 * HEAD_WINDOW_BYTES)),
      toEnd,
    );
    const { read } = memoryReader(file);

    expect(await readMp4Tracks(read, { totalBytes: file.byteLength })).toEqual({
      videoCodec: "avc1",
      audioCodec: "mp4a",
      hasAudio: true,
    });
  });
});

describe("a brand is not a codec (dl-64)", () => {
  test("an AV1 file listing avc1 among its brands reports av01", async () => {
    const file = tailMoovMp4({ brands: ["isom", "iso2", "avc1", "mp41"], tracks: AV1_AAC });
    const { read } = memoryReader(file);
    expect((await readMp4Tracks(read))?.videoCodec).toBe("av01");
  });

  test("an H.264 file listing no avc1 brand, and av01 instead, reports avc1", async () => {
    const file = faststartMp4({ brands: ["isom", "iso6", "av01"], tracks: H264_AAC });
    const { read } = memoryReader(file);
    expect((await readMp4Tracks(read))?.videoCodec).toBe("avc1");
  });
});

describe("what a parsed moov says about audio (dl-64)", () => {
  test("no audio track in a fully read moov is hasAudio false", async () => {
    const file = faststartMp4({
      brands: ["isom"],
      tracks: [trak("vide", "hvc1"), trak("subt", "stpp")],
    });
    const { read } = memoryReader(file);
    expect(await readMp4Tracks(read)).toEqual({ videoCodec: "hvc1", hasAudio: false });
  });

  test("a track that cannot be classified leaves audio unknown rather than absent", async () => {
    const file = faststartMp4({
      brands: ["isom"],
      tracks: [trak("vide", "avc1"), box("trak", box("tkhd", zeros(84)))],
    });
    const { read } = memoryReader(file);
    expect(await readMp4Tracks(read)).toEqual({ videoCodec: "avc1" });
  });

  test("a protected sample entry is audio present with no codec named", async () => {
    const file = faststartMp4({
      brands: ["isom"],
      tracks: [trak("vide", "encv"), trak("soun", "enca")],
    });
    const { read } = memoryReader(file);
    expect(await readMp4Tracks(read)).toEqual({ hasAudio: true });
  });

  test("something that is not an MP4 is one read and no answer", async () => {
    // An EBML header, which is how a WebM starts.
    const file = concat(
      new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81]),
      zeros(4096),
    );
    const { read, reads } = memoryReader(file);
    expect(await readMp4Tracks(read, { totalBytes: file.byteLength })).toBeUndefined();
    expect(reads).toHaveLength(1);
  });
});

function everyReadWithinCap(reads: ReadonlyArray<{ start: number; endInclusive: number }>): void {
  for (const { start, endInclusive } of reads) {
    expect(endInclusive - start + 1).toBeLessThanOrEqual(MAX_MOOV_BYTES);
  }
}

describe("sizes a file declares are not trusted (dl-64)", () => {
  test("a moov declaring four gigabytes is not fetched", async () => {
    const file = concat(
      ftyp(["isom"]),
      boxDeclaring("moov", 0xff_ff_ff_f0, zeros(2 * HEAD_WINDOW_BYTES)),
    );
    for (const totalBytes of [file.byteLength, 0xff_ff_ff_ff, undefined]) {
      const { read, reads } = memoryReader(file);
      // oxlint-disable-next-line no-await-in-loop -- independent cases
      expect(await readMp4Tracks(read, { totalBytes })).toBeUndefined();
      expect(reads).toHaveLength(1);
      everyReadWithinCap(reads);
    }
  });

  test("a moov one byte over the cap is not fetched either", async () => {
    const file = concat(ftyp(["isom"]), boxDeclaring("moov", MAX_MOOV_BYTES + 1, zeros(64)));
    const { read, reads } = memoryReader(file);
    expect(await readMp4Tracks(read, { totalBytes: 0x7f_ff_ff_ff })).toBeUndefined();
    expect(reads).toHaveLength(1);
  });

  test("an mdat declaring an end past the file places no read out there", async () => {
    const lying32 = concat(ftyp(["isom"]), boxDeclaring("mdat", 0xff_ff_ff_00, zeros(1024)));
    const lying64 = concat(ftyp(["isom"]), largeBox("mdat", 2n ** 62n, zeros(1024)));

    for (const file of [lying32, lying64]) {
      const known = memoryReader(file);
      // oxlint-disable-next-line no-await-in-loop -- independent cases
      expect(await readMp4Tracks(known.read, { totalBytes: file.byteLength })).toBeUndefined();
      expect(known.reads).toHaveLength(1);

      // With no total from the caller, the first read's own answer supplies one.
      const unknown = memoryReader(file);
      // oxlint-disable-next-line no-await-in-loop -- independent cases
      expect(await readMp4Tracks(unknown.read)).toBeUndefined();
      expect(unknown.reads).toHaveLength(1);
      everyReadWithinCap(unknown.reads);
    }
  });

  test("a reader that never says the total still stops, within the cap and the read budget", async () => {
    const file = concat(ftyp(["isom"]), largeBox("mdat", 2n ** 62n, zeros(1024)));
    const reads: Array<{ start: number; endInclusive: number }> = [];
    const blind = async (start: number, endInclusive: number) => {
      reads.push({ start, endInclusive });
      return await Promise.resolve(
        start < file.byteLength
          ? { bytes: file.slice(start, endInclusive + 1), totalBytes: undefined }
          : undefined,
      );
    };
    expect(await readMp4Tracks(blind)).toBeUndefined();
    everyReadWithinCap(reads);
    expect(reads.every((entry) => Number.isSafeInteger(entry.start))).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(4);
  });

  test("the probe's own ranged read is never asked for more than the cap", async () => {
    const file = concat(ftyp(["isom"]), boxDeclaring("moov", MAX_MOOV_BYTES + 1, zeros(64)));
    const served = servingFiles(new Map([["https://media.example.com/a.mp4", file]]));
    const probe = createFetchSizeProbe({ fetch: served.fetch, headers: {} });
    const bytes = probe.bytes.bind(probe);

    await readMp4Tracks(
      async (start, end) => await bytes("https://media.example.com/a.mp4", start, end),
    );

    for (const call of served.calls) {
      const [, from, to] = /^bytes=(\d+)-(\d+)$/u.exec(call.range ?? "") ?? [];
      expect(Number(to) - Number(from) + 1).toBeLessThanOrEqual(MAX_MOOV_BYTES);
    }
  });
});

describe("abandoning a read (dl-64)", () => {
  test("an abort after the first read sends no second", async () => {
    const file = tailMoovMp4({
      brands: ["isom"],
      tracks: AV1_AAC,
      mdatBytes: 2 * HEAD_WINDOW_BYTES,
    });
    const controller = new AbortController();
    const { read, reads } = memoryReader(file);
    const aborting = async (start: number, end: number) => {
      const answer = await read(start, end);
      controller.abort();
      return answer;
    };

    expect(await readMp4Tracks(aborting, { signal: controller.signal })).toBeUndefined();
    expect(reads).toHaveLength(1);
  });
});

describe("describeProgressiveTracks (dl-64)", () => {
  const URL_A = "https://media.example.com/clip/a.mp4";
  const base: MediaVariant = {
    id: "a",
    protocol: "progressive",
    url: URL_A,
    hasVideo: true,
    height: 480,
    container: "mp4",
    label: "480p",
  };

  function probeFor(file: Uint8Array): SizeProbe & { calls: number } {
    const served = servingFiles(new Map([[URL_A, file]]));
    const inner = createFetchSizeProbe({ fetch: served.fetch, headers: {} });
    return {
      get calls() {
        return served.calls.length;
      },
      contentLength: inner.contentLength.bind(inner),
      text: inner.text.bind(inner),
      bytes: inner.bytes.bind(inner),
    };
  }

  test("a codec, an audio answer and a label are filled from the file", async () => {
    const probe = probeFor(faststartMp4({ brands: ["isom"], tracks: H264_AAC }));
    const [described] = await describeProgressiveTracks([base], probe);
    expect(described).toMatchObject({
      videoCodec: "avc1",
      audioCodec: "mp4a",
      hasAudio: true,
      label: "480p · H.264 + AAC",
    });
  });

  test("a codec, an audio answer or a size already reported is kept", async () => {
    const probe = probeFor(faststartMp4({ brands: ["isom"], tracks: AV1_AAC }));
    const reported: MediaVariant = {
      ...base,
      videoCodec: "av1",
      hasAudio: false,
      filesizeBytes: 5,
      filesizeIsEstimate: true,
    };
    const [described] = await describeProgressiveTracks([reported], probe);
    // Video was known and audio was declared absent: nothing was missing.
    expect(described).toEqual(reported);
    expect(probe.calls).toBe(0);

    const [partial] = await describeProgressiveTracks([{ ...base, videoCodec: "av1" }], probe);
    expect(partial).toMatchObject({ videoCodec: "av1", audioCodec: "mp4a", hasAudio: true });
  });

  test("a file that is not ISO BMFF, a split rendition, or a probe without ranged reads is left alone", async () => {
    const probe = probeFor(faststartMp4({ brands: ["isom"], tracks: H264_AAC }));
    const webm = { ...base, container: "webm" };
    const split = { ...base, audioUrl: "https://media.example.com/clip/a.m4a" };
    expect(await describeProgressiveTracks([webm, split], probe)).toEqual([webm, split]);
    expect(probe.calls).toBe(0);

    const noRanges: SizeProbe = { contentLength: probe.contentLength, text: probe.text };
    expect(await describeProgressiveTracks([base], noRanges)).toEqual([base]);
  });
});
