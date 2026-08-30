/**
 * Turning a declared bitrate into a measured one.
 *
 * Every size that reaches the picker with a `~` on it is `bitrate × duration`,
 * and the bitrate is a number the manifest *declares*: DASH `@bandwidth` is
 * defined by the spec as the **maximum** over any window of the buffering
 * model, and yt-dlp's `tbr` for an adaptive format comes from the same
 * attribute. For VBR content that is a ceiling, not an estimate — measured at
 * 1.13× to 2.00× the delivered bytes across the three videos in dl-30's Why.
 *
 * So: measure one rendition, and scale the ladder by what the measurement says
 * the declaration was worth. One rendition, because the peak-to-average ratio
 * is a property of the encoder rather than of the rung — sampling every variant
 * would multiply the request count by the size of the ladder for no extra
 * information.
 *
 * **A rendition is measured in components, and that is not incidental.** A
 * variant with an `audioUrl` is two files, while its `bitrateBps` describes
 * both — so weighing only the video and dividing by the combined declaration
 * understates the factor by the audio's share, which is 4% of a 3 Mbps rung and
 * 18% of a 600 kbps one. Understating is the one direction that matters here,
 * because the same number feeds the pre-flight cap in
 * `engine/src/estimate.ts`. Both halves are weighed, or neither is.
 *
 * Two things this module will not do:
 *
 *  - **It never fetches directly.** The parsers are pure by contract
 *    (`manifest/types.ts`) and the resolvers own the network, along with the
 *    SSRF guard, the `RequestContext` replay and the proxy that go with it. A
 *    caller injects `SizeProbe`; a test injects a stub and touches nothing.
 *  - **It never fails a probe.** Every path out of here on an error, a timeout,
 *    a missing `Content-Length` or a suspect ratio returns the variants exactly
 *    as they were parsed. A size we could not measure is the state we were
 *    already in; a probe that dies trying to measure one is a regression.
 */

import type { MediaVariant } from "@downloader/contract";
import { buildLabel, urlExtension } from "./common.ts";
import type { MediaSegment } from "./manifest/hls.ts";
import { listMediaSegments } from "./manifest/hls.ts";

/**
 * The whole network dependency, so that the three resolvers can each supply the
 * fetch they already have — a `GuardedFetch`, a Playwright request context —
 * and the suite can supply neither.
 */
export interface SizeProbe {
  /**
   * Total bytes of a resource, or `undefined` when the server would not say.
   * Implementations HEAD; a `Range: bytes=0-0` GET is the usual fallback, and
   * its total comes from `Content-Range`, never from the `Content-Length` of
   * the range itself.
   */
  contentLength(url: string): Promise<number | undefined>;
  /** A playlist body, or `undefined` when it could not be fetched. */
  text(url: string): Promise<string | undefined>;
}

export interface SampleOptions {
  /** A live source has no length to measure; sampling is skipped outright. */
  isLive?: boolean | undefined;
  /** Used for any variant that does not carry its own `durationSec`. */
  durationSec?: number | undefined;
  /**
   * Segment lists a caller already holds, keyed by the URL they belong to.
   * yt-dlp's `http_dash_segments` formats arrive with every fragment and its
   * duration enumerated, which is what our own DASH parser cannot produce — it
   * does not expand `SegmentTemplate`. Keyed by URL rather than by variant id
   * so that a variant's `audioUrl` finds its segments by the same lookup.
   */
  segmentsByUrl?: ReadonlyMap<string, readonly MediaSegment[]> | undefined;
  signal?: AbortSignal | undefined;
}

/** Segments to weigh before believing a sample. Fewer is a sample of an outlier. */
const MIN_SAMPLED_SEGMENTS = 2;
/** Seconds to cover before believing a sample. A 3 s GOP is not a bitrate. */
const MIN_SAMPLED_SECONDS = 6;
/** Segment reads per component. With its playlist body that is 4 requests. */
const MAX_SEGMENT_SAMPLES = 3;
/**
 * A measurement outside this band is discarded rather than clamped. Below 0.2
 * or above 1.5 the likely cause is that we measured the wrong thing — an error
 * page served as 200, a byte-range playlist, an init segment counted as media —
 * and a clamped wrong answer is indistinguishable downstream from a right one.
 */
const MIN_PLAUSIBLE_FACTOR = 0.2;
const MAX_PLAUSIBLE_FACTOR = 1.5;

const PLAYLIST_EXTENSIONS = new Set(["m3u8", "m3u"]);
const MANIFEST_EXTENSIONS = new Set(["m3u8", "m3u", "mpd"]);

/** One measured half of a rendition: the video file, or the audio beside it. */
interface Component {
  bytesPerSecond: number;
  /** Set only when the whole component was weighed, not sampled. */
  exactBytes: number | undefined;
  /**
   * What the segment list covers, when we read one. An HLS master carries no
   * duration anywhere — the media playlist is where it lives — so without this
   * the whole ladder would be unmeasurable for want of a number we just read.
   */
  durationSec: number | undefined;
}

function durationOf(variant: MediaVariant, options: SampleOptions): number | undefined {
  const duration = variant.durationSec ?? options.durationSec;
  return duration !== undefined && duration > 0 ? duration : undefined;
}

/**
 * Indices spread across a playlist, never the opening segment: the first
 * segments of an encode routinely carry the ramp-up of a rate controller and
 * are the least representative bytes in the file.
 */
export function spreadIndices(count: number, want: number): number[] {
  if (count <= 0 || want <= 0) return [];
  if (count <= want) return Array.from({ length: count }, (_, index) => index);
  const picked = new Set<number>();
  for (let step = 1; step <= want; step += 1) {
    picked.add(Math.floor((count * step) / (want + 1)));
  }
  return [...picked];
}

/** Weighs up to `MAX_SEGMENT_SAMPLES` segments and reports bytes per second of playback. */
async function measureSegments(
  segments: readonly MediaSegment[],
  probe: SizeProbe,
  signal: AbortSignal | undefined,
): Promise<Component | undefined> {
  let bytes = 0;
  let seconds = 0;
  let weighed = 0;

  for (const index of spreadIndices(segments.length, MAX_SEGMENT_SAMPLES)) {
    if (signal?.aborted === true) break;
    const segment = segments[index];
    if (segment === undefined) continue;
    // Sequential on purpose: three requests against a CDN that may rate-limit
    // us, on the probe path, are worth less than the latency they would save.
    // oxlint-disable-next-line no-await-in-loop
    const length = await probe.contentLength(segment.url);
    if (length === undefined || length <= 0) continue;
    bytes += length;
    seconds += segment.durationSec;
    weighed += 1;
  }

  if (weighed < MIN_SAMPLED_SEGMENTS || seconds < MIN_SAMPLED_SECONDS) return undefined;
  const covered = segments.reduce((total, segment) => total + segment.durationSec, 0);
  return {
    bytesPerSecond: bytes / seconds,
    exactBytes: undefined,
    durationSec: covered > 0 ? covered : undefined,
  };
}

/** How a URL could be weighed, if at all. */
type Approach =
  | { kind: "segments"; segments: readonly MediaSegment[] }
  | { kind: "playlist" }
  | { kind: "file" };

function approachFor(
  url: string,
  options: SampleOptions,
  assumeFile: boolean,
): Approach | undefined {
  const supplied = options.segmentsByUrl?.get(url);
  if (supplied !== undefined && supplied.length > 0)
    return { kind: "segments", segments: supplied };

  const extension = urlExtension(url);
  if (extension !== undefined && PLAYLIST_EXTENSIONS.has(extension)) return { kind: "playlist" };
  // An MPD is the one shape with no way in: our DASH parser does not expand
  // SegmentTemplate, so nothing here knows a single segment URL.
  if (extension !== undefined && MANIFEST_EXTENSIONS.has(extension)) return undefined;
  if (assumeFile || extension !== undefined) return { kind: "file" };
  return undefined;
}

async function measureComponent(
  url: string,
  probe: SizeProbe,
  options: SampleOptions,
  duration: number | undefined,
  assumeFile: boolean,
): Promise<Component | undefined> {
  const approach = approachFor(url, options, assumeFile);
  if (approach === undefined) return undefined;

  if (approach.kind === "segments") {
    return await measureSegments(approach.segments, probe, options.signal);
  }

  if (approach.kind === "playlist") {
    const body = await probe.text(url);
    if (body === undefined || body.trim() === "") return undefined;
    const segments = listMediaSegments(body, url);
    if (segments.length === 0) return undefined;
    return await measureSegments(segments, probe, options.signal);
  }

  // A whole file is a size, not a rate, until something says how long it plays.
  if (duration === undefined) return undefined;
  const total = await probe.contentLength(url);
  if (total === undefined || total <= 0) return undefined;
  return { bytesPerSecond: total / duration, exactBytes: total, durationSec: duration };
}

/**
 * True when both halves of the rendition — however many there are — can be
 * reached, and when a duration will exist by the time it is needed: a segment
 * list brings its own, a whole file has to have been told.
 */
function isSamplable(variant: MediaVariant, options: SampleOptions): boolean {
  const assumeFile = variant.protocol === "progressive";
  const video = approachFor(variant.url, options, assumeFile);
  if (video === undefined) return false;
  if (video.kind === "file" && durationOf(variant, options) === undefined) return false;
  if (variant.audioUrl === undefined || variant.audioUrl === "") return true;
  // The audio half is shaped like the video half — a progressive variant's
  // paired audio is another plain file, and yt-dlp's URLs carry their format in
  // a query string rather than an extension, so the protocol has to say so.
  return approachFor(variant.audioUrl, options, assumeFile) !== undefined;
}

/** Rebuilds a variant's size and the label that carries it. */
function withSize(variant: MediaVariant, bytes: number, isEstimate: boolean): MediaVariant {
  return {
    ...variant,
    filesizeBytes: bytes,
    filesizeIsEstimate: isEstimate,
    label: buildLabel({
      hasVideo: variant.hasVideo,
      height: variant.height,
      width: variant.width,
      fps: variant.fps,
      videoCodec: variant.videoCodec,
      audioCodec: variant.audioCodec,
      bitrateBps: variant.bitrateBps,
      filesizeBytes: bytes,
      filesizeIsEstimate: isEstimate,
      durationSec: variant.durationSec,
      fallback: variant.label,
    }),
  };
}

/**
 * Measures one rendition and rescales the ladder from what it found.
 *
 * Returns the variants untouched whenever it cannot do better than the
 * declaration it was given, which is most of the failure surface and all of the
 * error surface.
 */
export async function measureVariantSizes(
  variants: readonly MediaVariant[],
  probe: SizeProbe,
  options: SampleOptions = {},
): Promise<MediaVariant[]> {
  const unchanged = [...variants];
  if (options.isLive === true || variants.length === 0) return unchanged;

  try {
    // Best-first, and among equals by id, so the rendition we spend requests on
    // does not depend on the order a parser happened to emit.
    const reference = variants
      .filter((variant) => (variant.bitrateBps ?? 0) > 0 && isSamplable(variant, options))
      .toSorted(
        (a, b) =>
          (b.bitrateBps ?? 0) - (a.bitrateBps ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )[0];

    if (reference === undefined) return unchanged;
    if (options.signal?.aborted === true) return unchanged;

    const video = await measureComponent(
      reference.url,
      probe,
      options,
      durationOf(reference, options),
      reference.protocol === "progressive",
    );
    if (video === undefined) return unchanged;

    // The playlist may have been the only thing that knew how long this plays.
    const duration = durationOf(reference, options) ?? video.durationSec;
    if (duration === undefined) return unchanged;

    const split = reference.audioUrl !== undefined && reference.audioUrl !== "";
    const audio = split
      ? await measureComponent(
          reference.audioUrl ?? "",
          probe,
          options,
          duration,
          reference.protocol === "progressive",
        )
      : { bytesPerSecond: 0, exactBytes: 0, durationSec: duration };
    // Half a rendition weighed against a declaration covering both halves is
    // the understatement this module refuses to make.
    if (audio === undefined) return unchanged;

    const declaredBytesPerSecond = (reference.bitrateBps ?? 0) / 8;
    if (declaredBytesPerSecond <= 0) return unchanged;
    const factor = (video.bytesPerSecond + audio.bytesPerSecond) / declaredBytesPerSecond;
    if (
      !Number.isFinite(factor) ||
      factor < MIN_PLAUSIBLE_FACTOR ||
      factor > MAX_PLAUSIBLE_FACTOR
    ) {
      return unchanged;
    }

    const exactBytes =
      video.exactBytes === undefined || audio.exactBytes === undefined
        ? undefined
        : video.exactBytes + audio.exactBytes;

    return variants.map((variant) => {
      // The one rendition we weighed whole. Exact, so it loses its `~`.
      if (variant.id === reference.id && exactBytes !== undefined) {
        return withSize(variant, exactBytes, false);
      }
      // A rung we did not weigh is still an estimate: it is scaled by what
      // another rung's encoder did, which is a good guess and not a reading.
      if (variant.filesizeIsEstimate === true && (variant.filesizeBytes ?? 0) > 0) {
        return withSize(variant, Math.round((variant.filesizeBytes ?? 0) * factor), true);
      }
      if (variant.filesizeBytes !== undefined) return variant;

      // A rung that never carried a size at all — an HLS master variant — can
      // have one now, because the measurement is what it was missing. Rungs of
      // one ladder are one piece of content, so the reference's duration is
      // theirs when they do not carry their own.
      const variantDuration = durationOf(variant, options) ?? duration;
      const bitrate = variant.bitrateBps ?? 0;
      if (variantDuration === undefined || bitrate <= 0) return variant;
      return withSize(variant, Math.round((bitrate / 8) * variantDuration * factor), true);
    });
  } catch {
    return unchanged;
  }
}
