/**
 * dl-90: the chunk sniff without a browser. What a head of bytes says, and how
 * the bounded walk over candidates spends its reads. The end-to-end behaviour
 * through a real Chromium is `chunk-streams.test.ts`.
 */

import { describe, expect, test } from "vitest";
import {
  MAX_SNIFF_READS,
  SNIFF_HEAD_BYTES,
  SNIFF_TOTAL_BUDGET_MS,
  isSniffCandidate,
  sniffHead,
  withoutFragments,
} from "../../src/browser/chunk-sniff.ts";
import type { HeadReader } from "../../src/browser/chunk-sniff.ts";
import type { NetworkHit } from "../../src/browser/types.ts";
import {
  ascii,
  box,
  boxDeclaring,
  concat,
  faststartMp4,
  initSegment,
  mediaSegment,
  tailMoovMp4,
  trak,
  zeros,
} from "../helpers/mp4.ts";

const TRACKS = [trak("vide", "avc1"), trak("soun", "mp4a")];

function hit(url: string, kind: NetworkHit["kind"] = "progressive"): NetworkHit {
  return { url, key: url, kind, headers: {}, seq: 0, confirmed: true };
}

function head(file: Uint8Array): Uint8Array {
  return file.subarray(0, SNIFF_HEAD_BYTES);
}

describe("what a head of bytes says (dl-90)", () => {
  test("a media segment is a fragment: its moof is the evidence", () => {
    expect(sniffHead(head(mediaSegment(2_000_000)))).toBe("fragment");
  });

  test("an init segment is a fragment: a moov that holds an mvex, though it has no moof", () => {
    const init = initSegment();
    // The premise of the rule: there is no `moof` anywhere in it.
    expect(Buffer.from(init).includes("moof")).toBe(false);
    expect(sniffHead(init)).toBe("fragment");
  });

  test("a faststart file is not: its moov has no mvex", () => {
    const file = faststartMp4({ brands: ["isom", "mp41"], tracks: TRACKS, mdatBytes: 1_000_000 });
    expect(sniffHead(head(file))).toBe("unknown");
  });

  test("a file whose moov is after its mdat is not read as a chunk for lacking a moov yet", () => {
    const file = tailMoovMp4({ brands: ["isom"], tracks: TRACKS, mdatBytes: 3 * SNIFF_HEAD_BYTES });
    expect(sniffHead(head(file))).toBe("unknown");
  });

  test("a moov larger than the head is unknown, not a verdict", () => {
    const hugeMoov = boxDeclaring("moov", 5_000_000, zeros(SNIFF_HEAD_BYTES));
    expect(sniffHead(head(concat(box("ftyp", ascii("isom")), hugeMoov)))).toBe("unknown");
  });

  test.each([
    ["an empty body", new Uint8Array()],
    ["an all-zero body", zeros(SNIFF_HEAD_BYTES)],
    ["a WebM header", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])],
    ["text", ascii("<html><body>403 Forbidden</body></html>")],
    ["a box with a nonsense type", box("\u0001\u0002\u0003\u0004", zeros(16))],
  ])("%s is unknown", (_name, body) => {
    expect(sniffHead(body)).toBe("unknown");
  });
});

describe("which hits the sniff may read (dl-90)", () => {
  test.each([
    ["https://cdn.example.net/n/00001.mp4", true],
    ["https://cdn.example.net/media/clip-720.mp4", true],
    ["https://cdn.example.net/v/3.m4a", true],
    // A name that is not numbered says nothing the sniff is for.
    ["https://cdn.example.net/media/lecture.mp4", false],
    // Not an ISO BMFF container: there is no `moof` to look for.
    ["https://cdn.example.net/n/00001.webm", false],
  ])("%s -> %s", (url, expected) => {
    expect(isSniffCandidate(hit(url))).toBe(expected);
  });

  test("a manifest is not a candidate whatever its name", () => {
    expect(isSniffCandidate(hit("https://cdn.example.net/n/00001.mp4", "hls"))).toBe(false);
  });
});

function reader(bodies: Record<string, Uint8Array | undefined>): HeadReader & { reads: string[] } {
  const reads: string[] = [];
  const read: HeadReader = async (candidate) => {
    reads.push(candidate.url);
    return await Promise.resolve(bodies[candidate.url]);
  };
  return Object.assign(read, { reads });
}

const other = (index: number): string => `https://cdn.example.net/media/${String(index)}.mp4`;

describe("the bounded walk over candidates (dl-90)", () => {
  const FAR = Date.now() + 60_000;

  const dir = "https://cdn.example.net/n/";
  const chunk = (index: number): string => `${dir}${String(index).padStart(5, "0")}.mp4`;

  test("one proven fragment drops its whole directory and the rest are never requested", async () => {
    const files = Array.from({ length: 20 }, (_, index) => hit(chunk(index)));
    const read = reader(Object.fromEntries(files.map((file) => [file.url, mediaSegment()])));

    expect(await withoutFragments(files, read, FAR)).toEqual([]);
    expect(read.reads).toEqual([chunk(0)]);
  });

  test("a directory with no proof keeps everything, and reads no more than the cap", async () => {
    const files = Array.from({ length: 20 }, (_, index) => hit(chunk(index)));
    const whole = faststartMp4({ brands: ["isom"], tracks: TRACKS, mdatBytes: 1024 });
    const read = reader(Object.fromEntries(files.map((file) => [file.url, whole])));

    expect(await withoutFragments(files, read, FAR)).toEqual(files);
    expect(read.reads).toHaveLength(MAX_SNIFF_READS);
  });

  test("proof in one directory leaves another directory's numbered files alone", async () => {
    const chunks = [hit(chunk(1)), hit(chunk(2))];
    const wholes = [hit(other(1)), hit(other(2))];
    const whole = faststartMp4({ brands: ["isom"], tracks: TRACKS, mdatBytes: 1024 });
    const read = reader({
      [chunk(1)]: mediaSegment(),
      [other(1)]: whole,
      [other(2)]: whole,
    });

    expect(await withoutFragments([...chunks, ...wholes], read, FAR)).toEqual(wholes);
  });

  test("a read that finds nothing, or throws, offers the file", async () => {
    const files = [hit(chunk(1)), hit(chunk(2)), hit(chunk(3))];
    const read: HeadReader = async (candidate) => {
      if (candidate.url === chunk(1)) return await Promise.resolve(undefined);
      if (candidate.url === chunk(2)) throw new Error("socket hang up");
      return await Promise.resolve(zeros(SNIFF_HEAD_BYTES));
    };

    expect(await withoutFragments(files, read, FAR)).toEqual(files);
  });

  test("a hit the sniff has nothing to say about is passed through unread", async () => {
    const files = [
      hit("https://cdn.example.net/media/lecture.mp4"),
      hit("https://cdn.example.net/n/00001.webm"),
    ];
    const read = reader({});

    expect(await withoutFragments(files, read, FAR)).toEqual(files);
    expect(read.reads).toEqual([]);
  });

  test("no budget left reads nothing and offers everything", async () => {
    const files = [hit(chunk(1)), hit(chunk(2))];
    const read = reader({ [chunk(1)]: mediaSegment() });

    // A deadline already inside the minimum useful budget.
    expect(await withoutFragments(files, read, Date.now() + 100)).toEqual(files);
    expect(read.reads).toEqual([]);
  });

  test("each read is handed no more time than the whole sniff has", async () => {
    const budgets: number[] = [];
    const read: HeadReader = async (_candidate, timeoutMs) => {
      budgets.push(timeoutMs);
      return await Promise.resolve(undefined);
    };

    await withoutFragments([hit(chunk(1))], read, Date.now() + 10 * SNIFF_TOTAL_BUDGET_MS);

    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toBeLessThanOrEqual(SNIFF_TOTAL_BUDGET_MS);
  });
});
