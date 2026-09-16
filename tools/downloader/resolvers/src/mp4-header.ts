/**
 * What an MP4 file says about its own tracks, read from its `moov` (dl-64).
 *
 * Some extractors describe a progressive file by its height and nothing else —
 * no codec, no audio — although the file itself says both in its sample
 * entries. This reads them over ranged requests, through the `SizeProbe` the
 * resolver already has, so every byte comes through the same SSRF-guarded,
 * header-replaying, time-limited fetch as the size probe's own `HEAD`.
 *
 * **Only the sample entry counts.** The fourcc of the first entry in
 * `moov/trak/mdia/minf/stbl/stsd` is the codec. The `ftyp` box's brands are
 * not read at all: a brand is a claim about compatibility, not a description of
 * the track. The H.264 files dl-64 measured carried `avc1` as a brand in their
 * first 32 bytes, which is exactly where a shortcut would look — and the same
 * shortcut would call any file listing that brand H.264, whatever it holds.
 *
 * **Where `moov` is decides the cost.** A faststart file has it straight after
 * `ftyp`: one read for the leading boxes, one sized by `moov`'s own header. A
 * file written without faststart has `mdat` first and `moov` at the tail: the
 * second read is placed at `mdat`'s declared end. Either is two reads when
 * `moov` fits the cap; the walk stops at `MAX_READS` whatever the file claims.
 *
 * **Every size in the file is attacker-controlled.** A `moov` declaring more
 * than `MAX_MOOV_BYTES` is not fetched; an `mdat` declaring an end past the
 * file's length ends the walk rather than placing a read out there; a 64-bit
 * size beyond what a JS number holds exactly is treated as infinite. The box
 * walk inside `moov` follows one fixed path six levels deep and never recurses
 * on what it finds, so depth is bounded by construction, and each level stops
 * after `MAX_CHILDREN` siblings.
 *
 * Like the size probe, nothing here throws: a file we could not read keeps
 * whatever the tier reported, which is where we started.
 */

import type { MediaVariant } from "@downloader/contract";
import { buildLabel } from "./common.ts";
import type { RangedBytes, SizeProbe } from "./size-sample.ts";
import { mapBounded, PER_FILE_CONCURRENCY } from "./size-sample.ts";

/** Leading bytes read first. Holds `ftyp`, and `mdat`'s or `moov`'s header after it. */
export const HEAD_WINDOW_BYTES = 64 * 1024;
/**
 * The largest `moov` fetched. The reported page's were 242–309 KiB for a 13
 * minute file; `moov` grows with sample count, so this covers several hours.
 */
export const MAX_MOOV_BYTES = 16 * 1024 * 1024;
/** Ranged reads per file: the leading window, then at most three more. */
export const MAX_READS = 4;
/** Top-level boxes walked before giving up on finding `moov`. */
const MAX_TOP_LEVEL_BOXES = 32;
/** Siblings examined at any one level inside `moov`. */
const MAX_CHILDREN = 1024;

/** Reads bytes `start`..`endInclusive` of one file. */
export type RangeReader = (start: number, endInclusive: number) => Promise<RangedBytes | undefined>;

export interface Mp4Tracks {
  /** The first video track's sample-entry fourcc, e.g. `avc1`, `hvc1`, `av01`. */
  videoCodec?: string | undefined;
  /** The first audio track's sample-entry fourcc, e.g. `mp4a`, `Opus`, `ac-3`. */
  audioCodec?: string | undefined;
  /**
   * `true` when an audio track was read; `false` only when every track in the
   * `moov` was read and none was audio; omitted when some track could not be.
   * The same three states as `MediaVariant.hasAudio`, for the same reason.
   */
  hasAudio?: boolean | undefined;
}

type Header =
  | { kind: "box"; type: string; headerBytes: number; size: number | "to-end" }
  | { kind: "short" }
  | { kind: "malformed" };

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(
    bytes[at] ?? 0,
    bytes[at + 1] ?? 0,
    bytes[at + 2] ?? 0,
    bytes[at + 3] ?? 0,
  );
}

/** Top-level box types are printable ASCII; anything else is not an MP4. */
function isPrintable(type: string): boolean {
  return /^[ -~]{4}$/u.test(type);
}

/** Reads the box header at `at`, answering `short` when `bytes` ends inside it. */
function readHeader(bytes: Uint8Array, at: number): Header {
  if (at < 0 || at + 8 > bytes.length) return { kind: "short" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size32 = view.getUint32(at);
  const type = fourcc(bytes, at + 4);
  if (size32 === 0) return { kind: "box", type, headerBytes: 8, size: "to-end" };
  if (size32 === 1) {
    if (at + 16 > bytes.length) return { kind: "short" };
    const large = view.getBigUint64(at + 8);
    const size = large > BigInt(Number.MAX_SAFE_INTEGER) ? Number.POSITIVE_INFINITY : Number(large);
    return size < 16 ? { kind: "malformed" } : { kind: "box", type, headerBytes: 16, size };
  }
  return size32 < 8 ? { kind: "malformed" } : { kind: "box", type, headerBytes: 8, size: size32 };
}

interface Child {
  type: string;
  body: number;
  end: number;
}

/** The boxes directly inside `start`..`end`, stopping at the first that does not fit. */
function childrenOf(bytes: Uint8Array, start: number, end: number): Child[] {
  const bounded = bytes.subarray(0, end);
  const found: Child[] = [];
  let at = start;
  while (at + 8 <= end && found.length < MAX_CHILDREN) {
    const header = readHeader(bounded, at);
    if (header.kind !== "box") break;
    const boxEnd = header.size === "to-end" ? end : at + header.size;
    if (boxEnd > end) break;
    found.push({ type: header.type, body: at + header.headerBytes, end: boxEnd });
    at = boxEnd;
  }
  return found;
}

function childOf(bytes: Uint8Array, parent: Child, type: string): Child | undefined {
  return childrenOf(bytes, parent.body, parent.end).find((child) => child.type === type);
}

/**
 * A protected sample entry names the scheme, not the codec — the original
 * format is inside `sinf/frma`, and a file carrying one is not ours to label.
 */
const PROTECTED_ENTRIES = new Set(["encv", "enca"]);

/** `stsd`: version and flags, an entry count, then the sample entries as boxes. */
function firstSampleEntry(bytes: Uint8Array, stsd: Child): string | undefined {
  if (stsd.body + 8 > stsd.end) return undefined;
  const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    stsd.body + 4,
  );
  if (count === 0) return undefined;
  const entry = childrenOf(bytes, stsd.body + 8, stsd.end)[0];
  if (entry === undefined || !isPrintable(entry.type) || PROTECTED_ENTRIES.has(entry.type)) {
    return undefined;
  }
  return entry.type;
}

/** `hdlr`: version and flags, `pre_defined`, then the handler type. */
function handlerOf(bytes: Uint8Array, hdlr: Child): string | undefined {
  if (hdlr.body + 12 > hdlr.end) return undefined;
  return fourcc(bytes, hdlr.body + 8);
}

/** Walks `moov/trak/mdia/{hdlr, minf/stbl/stsd}` for each track. */
function parseMoov(bytes: Uint8Array, headerBytes: number): Mp4Tracks | undefined {
  const moov: Child = { type: "moov", body: headerBytes, end: bytes.length };
  const traks = childrenOf(bytes, moov.body, moov.end).filter((child) => child.type === "trak");
  if (traks.length === 0) return undefined;

  let videoCodec: string | undefined;
  let audioCodec: string | undefined;
  let sawAudio = false;
  let complete = true;
  for (const trak of traks) {
    const mdia = childOf(bytes, trak, "mdia");
    const hdlr = mdia === undefined ? undefined : childOf(bytes, mdia, "hdlr");
    const handler = hdlr === undefined ? undefined : handlerOf(bytes, hdlr);
    if (mdia === undefined || handler === undefined) {
      // A track we cannot classify might be the audio one.
      complete = false;
      continue;
    }
    const minf = childOf(bytes, mdia, "minf");
    const stbl = minf === undefined ? undefined : childOf(bytes, minf, "stbl");
    const stsd = stbl === undefined ? undefined : childOf(bytes, stbl, "stsd");
    const entry = stsd === undefined ? undefined : firstSampleEntry(bytes, stsd);

    if (handler === "vide") {
      videoCodec ??= entry;
    } else if (handler === "soun") {
      sawAudio = true;
      audioCodec ??= entry;
    }
  }

  const hasAudio = sawAudio ? true : complete ? false : undefined;
  return {
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec }),
    ...(hasAudio === undefined ? {} : { hasAudio }),
  };
}

interface Window {
  start: number;
  bytes: Uint8Array;
}

/**
 * Finds `moov` by walking top-level boxes over ranged reads, and reads its
 * tracks. `undefined` for anything that is not a readable MP4 within budget.
 */
export async function readMp4Tracks(
  read: RangeReader,
  options: { totalBytes?: number | undefined; signal?: AbortSignal | undefined } = {},
): Promise<Mp4Tracks | undefined> {
  let total =
    options.totalBytes !== undefined && options.totalBytes > 0 ? options.totalBytes : undefined;
  let reads = 0;

  const fetchAt = async (start: number, length: number): Promise<Window | undefined> => {
    if (reads >= MAX_READS || options.signal?.aborted === true) return undefined;
    if (!Number.isSafeInteger(start) || start < 0 || length <= 0) return undefined;
    let end = start + length - 1;
    if (total !== undefined) {
      if (start >= total) return undefined;
      end = Math.min(end, total - 1);
    }
    reads += 1;
    try {
      const got = await read(start, end);
      if (got === undefined || got.bytes.length === 0) return undefined;
      total ??= got.totalBytes;
      return { start, bytes: got.bytes.subarray(0, end - start + 1) };
    } catch {
      return undefined;
    }
  };

  const headerAt = (window: Window, offset: number): Header =>
    offset < window.start ? { kind: "short" } : readHeader(window.bytes, offset - window.start);

  let window = await fetchAt(0, HEAD_WINDOW_BYTES);
  let offset = 0;
  for (let walked = 0; window !== undefined && walked < MAX_TOP_LEVEL_BOXES; walked += 1) {
    if (total !== undefined && offset >= total) return undefined;

    let header = headerAt(window, offset);
    if (header.kind === "short") {
      // Already reading from here and still short: the file ends inside a header.
      if (window.start === offset) return undefined;
      // When everything left fits the cap, one read takes it all — which is
      // what makes a tail `moov` behind `mdat` a single extra request.
      const remaining = total === undefined ? undefined : total - offset;
      const length =
        remaining !== undefined && remaining <= MAX_MOOV_BYTES ? remaining : HEAD_WINDOW_BYTES;
      // oxlint-disable-next-line no-await-in-loop -- each read is placed by the last
      window = await fetchAt(offset, length);
      if (window === undefined) return undefined;
      header = headerAt(window, offset);
    }
    if (header.kind !== "box" || !isPrintable(header.type)) return undefined;

    const size =
      header.size === "to-end" ? (total === undefined ? undefined : total - offset) : header.size;

    if (header.type === "moov") {
      if (size === undefined || size > MAX_MOOV_BYTES) return undefined;
      const local = offset - window.start;
      if (local + size <= window.bytes.length) {
        return parseMoov(window.bytes.subarray(local, local + size), header.headerBytes);
      }
      // oxlint-disable-next-line no-await-in-loop -- the loop ends here either way
      const whole = await fetchAt(offset, size);
      if (whole === undefined || whole.bytes.length < size) return undefined;
      return parseMoov(whole.bytes.subarray(0, size), header.headerBytes);
    }

    // A box running to the end of the file that is not `moov` leaves no room for one.
    if (size === undefined) return undefined;
    offset += size;
  }
  return undefined;
}

/** Containers that are ISO BMFF, and so have a `moov` to read. */
const ISO_BMFF_CONTAINERS = new Set(["mp4", "m4v", "m4a", "mov", "3gp", "3g2", "f4v"]);

/** A progressive file missing a codec or an audio answer that its `moov` could give. */
function needsTracks(variant: MediaVariant): boolean {
  if (variant.protocol !== "progressive") return false;
  // Its audio is another file; this one's lack of an audio track says nothing.
  if (variant.audioUrl !== undefined && variant.audioUrl !== "") return false;
  const container = variant.container?.toLowerCase();
  if (container !== undefined && !ISO_BMFF_CONTAINERS.has(container)) return false;
  const missingVideo = variant.hasVideo && variant.videoCodec === undefined;
  const missingAudio = variant.hasAudio !== false && variant.audioCodec === undefined;
  return missingVideo || missingAudio;
}

/** Fills only what the variant lacks. A reported value is never replaced. */
function withTracks(variant: MediaVariant, tracks: Mp4Tracks): MediaVariant {
  const videoCodec = variant.videoCodec ?? (variant.hasVideo ? tracks.videoCodec : undefined);
  const hasAudio = variant.hasAudio ?? tracks.hasAudio;
  const audioCodec = variant.audioCodec ?? (hasAudio === true ? tracks.audioCodec : undefined);
  if (
    videoCodec === variant.videoCodec &&
    audioCodec === variant.audioCodec &&
    hasAudio === variant.hasAudio
  ) {
    return variant;
  }
  return {
    ...variant,
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec }),
    ...(hasAudio === undefined ? {} : { hasAudio }),
    label: buildLabel({
      hasVideo: variant.hasVideo,
      height: variant.height,
      width: variant.width,
      fps: variant.fps,
      videoCodec,
      audioCodec,
      bitrateBps: variant.bitrateBps,
      filesizeBytes: variant.filesizeBytes,
      filesizeIsEstimate: variant.filesizeIsEstimate,
      durationSec: variant.durationSec,
      fallback: variant.label,
    }),
  };
}

/**
 * dl-64: reads the tracks of every progressive MP4 that is missing a codec or
 * an audio answer, and fills in what it finds.
 *
 * Run after sizing, so a file already sized exactly hands its length to the
 * reader and a tail `moov` is placed without first learning the file's end.
 * A probe without `bytes()` — the browser tier's — changes nothing.
 */
export async function describeProgressiveTracks(
  variants: readonly MediaVariant[],
  probe: SizeProbe,
  options: { signal?: AbortSignal | undefined } = {},
): Promise<MediaVariant[]> {
  if (probe.bytes === undefined || !variants.some(needsTracks)) return [...variants];
  return await mapBounded(
    variants,
    PER_FILE_CONCURRENCY,
    async (variant) => {
      if (!needsTracks(variant)) return variant;
      const read: RangeReader = async (start, end) =>
        await (probe.bytes?.(variant.url, start, end) ?? Promise.resolve(undefined));
      const tracks = await readMp4Tracks(read, {
        totalBytes: variant.filesizeIsEstimate === false ? variant.filesizeBytes : undefined,
        signal: options.signal,
      });
      return tracks === undefined ? variant : withTracks(variant, tracks);
    },
    (variant) => variant,
    options.signal,
  );
}
