/**
 * MPEG-DASH manifest parser — pure, offline, and the second DRM detector in the
 * system (see `tools/downloader/docs/00-ANALYSIS.md` §3).
 *
 * Unlike HLS there is no benign case here: DASH has no equivalent of an
 * in-manifest AES-128 key URI. A `<ContentProtection>` element always means
 * Common Encryption with a key held by a licence server, so any of them sets
 * `protected` and stops the pipeline.
 *
 * That includes ClearKey, which HLS treats as in scope when the key is one GET
 * away. DASH ClearKey is not that: the key comes from the `<clearkey:Laurl>`
 * licence endpoint via an EME licence request, and a `<cenc:pssh>` carries only
 * the key *id*, never the key. Both sides of that are a licence exchange, which
 * `CLAUDE.md` puts out of scope, so the boundary lands differently here purely
 * because the format offers no fetchable-key form to land on.
 *
 * Audio and video live in separate `AdaptationSet`s in almost every real MPD,
 * so muxing is the normal path rather than the exception.
 */

import { AppError } from "@downloader/contract";
import type { DrmInfo, DrmSystem, MediaVariant, SubtitleTrack } from "@downloader/contract";
import { XMLParser } from "fast-xml-parser";
import {
  buildLabel,
  compareVariantQuality,
  estimateSizeBytes,
  humanAudioCodec,
  optional,
  resolveUrl,
  splitCodecs,
  subtitleFormat,
} from "../common.ts";
import type { ParsedManifest } from "./types.ts";

const DRM_UUIDS: Readonly<Record<string, DrmSystem>> = {
  "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed": "widevine",
  "9a04f079-9840-4286-ab92-e65be0885f95": "playready",
  "94ce86fb-07ff-4f43-adb8-93d2fa968ca2": "fairplay",
  "e2719d58-a985-b3c9-781a-b030af78d30e": "clearkey",
};

/** Elements that may legitimately repeat; forcing arrays removes every `Array.isArray` check below. */
const ARRAY_ELEMENTS = new Set([
  "Period",
  "AdaptationSet",
  "Representation",
  "ContentProtection",
  "BaseURL",
  "Role",
  "S",
  "SegmentURL",
  "Accessibility",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Attribute values stay strings so `frameRate="30000/1001"` and
  // `id="01"` survive intact; every numeric read below is explicit.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as XmlNode)
    : undefined;
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  if (node === undefined) return undefined;
  const value = node[`@_${name}`];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Child elements by name. `isArray` above guarantees an array for the names we ask for. */
function childNodes(node: XmlNode | undefined, name: string): XmlNode[] {
  if (node === undefined) return [];
  const value = node[name];
  if (Array.isArray(value)) {
    return value.map(asNode).filter((child): child is XmlNode => child !== undefined);
  }
  const single = asNode(value);
  return single === undefined ? [] : [single];
}

function childNode(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return childNodes(node, name)[0];
}

/** Text content of the first `<name>` child. Handles both plain-text and attributed elements. */
function childText(node: XmlNode | undefined, name: string): string | undefined {
  if (node === undefined) return undefined;
  const value = node[name];
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate === "string") return candidate.trim() === "" ? undefined : candidate.trim();
  const asObject = asNode(candidate);
  const text = asObject?.["#text"];
  return typeof text === "string" && text.trim() !== "" ? text.trim() : undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** `30000/1001` → 29.97, `60` → 60. */
export function parseFrameRate(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const slash = value.indexOf("/");
  if (slash === -1) return toNumber(value);
  const numerator = toNumber(value.slice(0, slash));
  const denominator = toNumber(value.slice(slash + 1));
  if (numerator === undefined || denominator === undefined || denominator === 0) return undefined;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

const ISO_DURATION =
  /^-?P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** ISO-8601 duration → seconds. `PT1H2M3.5S` → 3723.5. */
export function parseIsoDuration(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const match = ISO_DURATION.exec(value.trim());
  if (match === null) return undefined;
  const [, years, months, weeks, days, hours, minutes, seconds] = match;
  const total =
    (Number(years ?? 0) * 365 +
      Number(months ?? 0) * 30 +
      Number(weeks ?? 0) * 7 +
      Number(days ?? 0)) *
      86_400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

interface DrmScan {
  systems: Set<DrmSystem>;
  evidence: string[];
}

/**
 * Whether a `ContentProtection` names a licence endpoint.
 *
 * Matched on the local name because the element is namespaced and the prefix
 * varies by authoring tool — `clearkey:Laurl`, `dashif:Laurl` and a bare
 * `Laurl` all appear in real manifests, and the parser keeps prefixes.
 * Diagnostic only: this changes the evidence string, never the verdict.
 */
function hasLicenceUrl(element: XmlNode): boolean {
  return Object.keys(element).some((key) => /(?:^|:)laurl$/i.test(key));
}

function scanContentProtection(node: XmlNode | undefined, scan: DrmScan): void {
  for (const element of childNodes(node, "ContentProtection")) {
    const scheme = (attr(element, "schemeIdUri") ?? "").toLowerCase();
    if (scheme === "") continue;
    const uuid = scheme.startsWith("urn:uuid:") ? scheme.slice("urn:uuid:".length) : undefined;
    const system = uuid === undefined ? undefined : DRM_UUIDS[uuid];
    if (system !== undefined) {
      scan.systems.add(system);
      if (system === "clearkey") {
        // Named explicitly so the hard stop is traceable to the licence
        // exchange rather than looking like a blanket ban on the key system.
        scan.evidence.push(
          `MPD ContentProtection ${scheme} (clearkey, ${
            hasLicenceUrl(element) ? "licence URL in manifest" : "key id only"
          } — licence exchange required)`,
        );
        continue;
      }
      scan.evidence.push(`MPD ContentProtection ${scheme} (${system})`);
      continue;
    }
    if (scheme === "urn:mpeg:dash:mp4protection:2011") {
      // Common Encryption signalling. It names no key system, but it does prove
      // the segments are encrypted with a key we have no way to obtain.
      scan.systems.add("unknown");
      scan.evidence.push(`MPD ContentProtection ${scheme} (Common Encryption)`);
      continue;
    }
    if (scheme.includes("playready")) {
      scan.systems.add("playready");
      scan.evidence.push(`MPD ContentProtection ${scheme} (playready)`);
      continue;
    }
    if (scheme.includes("widevine")) {
      scan.systems.add("widevine");
      scan.evidence.push(`MPD ContentProtection ${scheme} (widevine)`);
      continue;
    }
    scan.systems.add("unknown");
    scan.evidence.push(`MPD ContentProtection ${scheme}`);
  }
}

function toDrmInfo(scan: DrmScan): DrmInfo {
  if (scan.systems.size === 0) return { protected: false, systems: [] };
  return {
    protected: true,
    systems: [...scan.systems],
    evidence: [...new Set(scan.evidence)].join("; "),
  };
}

interface Representation {
  node: XmlNode;
  id: string;
  /** Base URL after the MPD → Period → AdaptationSet → Representation `<BaseURL>` chain. */
  baseUrl: string;
  /** Set only when this representation is one addressable file — see `fileUrl`. */
  fileUrl: string | undefined;
  mimeType: string | undefined;
  codecs: string | undefined;
  width: number | undefined;
  height: number | undefined;
  fps: number | undefined;
  bandwidth: number | undefined;
  lang: string | undefined;
}

interface AdaptationSet {
  kind: "video" | "audio" | "text" | "other";
  lang: string | undefined;
  representations: Representation[];
}

function applyBaseUrl(current: string, node: XmlNode | undefined): string {
  const declared = childText(node, "BaseURL");
  return declared === undefined ? current : resolveUrl(declared, current);
}

/** True when this level or any ancestor addresses segments by template or list. */
function hasSegmentAddressing(...nodes: Array<XmlNode | undefined>): boolean {
  return nodes.some(
    (node) =>
      node !== undefined &&
      (childNode(node, "SegmentTemplate") !== undefined ||
        childNode(node, "SegmentList") !== undefined),
  );
}

function classify(
  mimeType: string | undefined,
  contentType: string | undefined,
): AdaptationSet["kind"] {
  const hint = `${contentType ?? ""} ${mimeType ?? ""}`.toLowerCase();
  if (hint.includes("video")) return "video";
  if (hint.includes("audio")) return "audio";
  if (hint.includes("text") || hint.includes("ttml") || hint.includes("subtitle")) return "text";
  return "other";
}

function readAdaptationSet(
  node: XmlNode,
  periodBase: string,
  mpdUrl: string,
  scan: DrmScan,
): AdaptationSet {
  scanContentProtection(node, scan);
  const setBase = applyBaseUrl(periodBase, node);
  const setMime = attr(node, "mimeType");
  const setCodecs = attr(node, "codecs");
  const setLang = attr(node, "lang");
  const setFrameRate = attr(node, "frameRate");
  const setWidth = toNumber(attr(node, "width"));
  const setHeight = toNumber(attr(node, "height"));

  const representations: Representation[] = [];
  const nodes = childNodes(node, "Representation");
  for (const [index, repNode] of nodes.entries()) {
    scanContentProtection(repNode, scan);
    const repBase = applyBaseUrl(setBase, repNode);
    const templated = hasSegmentAddressing(node, repNode);
    // A representation is separately downloadable only when it is one file. With
    // SegmentTemplate/SegmentList the addressable unit is the MPD itself, which
    // ffmpeg expands on its own.
    const fileUrl = templated || repBase === mpdUrl ? undefined : repBase;
    representations.push({
      node: repNode,
      id: attr(repNode, "id") ?? `r${index}`,
      baseUrl: repBase,
      fileUrl,
      mimeType: attr(repNode, "mimeType") ?? setMime,
      codecs: attr(repNode, "codecs") ?? setCodecs,
      width: toNumber(attr(repNode, "width")) ?? setWidth,
      height: toNumber(attr(repNode, "height")) ?? setHeight,
      fps: parseFrameRate(attr(repNode, "frameRate") ?? setFrameRate),
      bandwidth: toNumber(attr(repNode, "bandwidth")),
      lang: attr(repNode, "lang") ?? setLang,
    });
  }

  return {
    kind: classify(setMime ?? representations[0]?.mimeType, attr(node, "contentType")),
    lang: setLang,
    representations,
  };
}

function bestAudio(sets: AdaptationSet[]): { set: AdaptationSet; rep: Representation } | undefined {
  let best: { set: AdaptationSet; rep: Representation } | undefined;
  for (const set of sets) {
    if (set.kind !== "audio") continue;
    for (const rep of set.representations) {
      if (best === undefined || (rep.bandwidth ?? 0) > (best.rep.bandwidth ?? 0)) {
        best = { set, rep };
      }
    }
  }
  return best;
}

function buildSubtitles(sets: AdaptationSet[]): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  for (const set of sets) {
    if (set.kind !== "text") continue;
    for (const rep of set.representations) {
      // Segment-templated subtitle tracks have no single fetchable URL, and
      // SubtitleTrack.url must be fetchable, so they are skipped rather than
      // pointed at the MPD.
      if (rep.fileUrl === undefined) continue;
      tracks.push({
        id: `dash-sub-${tracks.length}`,
        url: rep.fileUrl,
        language: rep.lang ?? set.lang ?? "und",
        label: rep.lang ?? set.lang ?? "Subtitles",
        format: subtitleFormat(`${rep.mimeType ?? ""} ${rep.codecs ?? ""} ${rep.fileUrl}`),
        autoGenerated: false,
      });
    }
  }
  return tracks;
}

function containerOf(mimeType: string | undefined): string | undefined {
  if (mimeType === undefined) return undefined;
  const slash = mimeType.indexOf("/");
  return slash === -1 ? undefined : mimeType.slice(slash + 1).toLowerCase();
}

/**
 * Parses a DASH MPD.
 *
 * @throws AppError `NO_MEDIA_FOUND` when the body is not an MPD at all.
 */
export function parseDash(xml: string, baseUrl: string): ParsedManifest {
  let root: XmlNode | undefined;
  try {
    root = asNode(parser.parse(xml));
  } catch (cause) {
    throw new AppError("NO_MEDIA_FOUND", "That URL did not return a readable DASH manifest.", {
      cause,
    });
  }

  const mpd = childNode(root, "MPD");
  if (mpd === undefined) {
    throw new AppError("NO_MEDIA_FOUND", "That URL did not return a DASH manifest.");
  }

  const isLive = (attr(mpd, "type") ?? "static").toLowerCase() === "dynamic";
  const durationSec = isLive ? undefined : parseIsoDuration(attr(mpd, "mediaPresentationDuration"));

  const scan: DrmScan = { systems: new Set<DrmSystem>(), evidence: [] };
  scanContentProtection(mpd, scan);

  const mpdBase = applyBaseUrl(baseUrl, mpd);
  const sets: AdaptationSet[] = [];
  for (const period of childNodes(mpd, "Period")) {
    scanContentProtection(period, scan);
    const periodBase = applyBaseUrl(mpdBase, period);
    for (const setNode of childNodes(period, "AdaptationSet")) {
      sets.push(readAdaptationSet(setNode, periodBase, baseUrl, scan));
    }
  }

  const drm = toDrmInfo(scan);
  const subtitles = buildSubtitles(sets);
  const audio = bestAudio(sets);
  const variants: MediaVariant[] = [];

  for (const set of sets) {
    if (set.kind !== "video") continue;
    for (const rep of set.representations) {
      const { video: videoCodec, audio: muxedAudioCodec } = splitCodecs(rep.codecs);
      const audioCodec =
        muxedAudioCodec ??
        (audio === undefined
          ? undefined
          : (splitCodecs(audio.rep.codecs).audio ?? audio.rep.codecs));
      const hasAudio = muxedAudioCodec !== undefined || audio !== undefined;

      // Two inputs only when both halves are individually addressable; otherwise
      // the MPD goes to ffmpeg whole and it maps the streams itself.
      const separable =
        rep.fileUrl !== undefined && (audio === undefined || audio.rep.fileUrl !== undefined);
      const url = separable ? (rep.fileUrl ?? baseUrl) : baseUrl;
      const audioUrl = separable && muxedAudioCodec === undefined ? audio?.rep.fileUrl : undefined;

      const bitrateBps =
        (rep.bandwidth ?? 0) + (muxedAudioCodec === undefined ? (audio?.rep.bandwidth ?? 0) : 0);
      const filesizeBytes = estimateSizeBytes(bitrateBps, durationSec);

      variants.push({
        id: `dash-${rep.id}`,
        protocol: "dash",
        url,
        hasVideo: true,
        hasAudio,
        label: buildLabel({
          hasVideo: true,
          height: rep.height,
          width: rep.width,
          fps: rep.fps,
          videoCodec,
          audioCodec,
          bitrateBps,
          filesizeBytes,
          filesizeIsEstimate: true,
          fallback: isLive ? "Live DASH stream" : "DASH stream",
        }),
        ...optional({
          audioUrl,
          container: containerOf(rep.mimeType),
          videoCodec,
          audioCodec,
          width: rep.width,
          height: rep.height,
          fps: rep.fps,
          bitrateBps: bitrateBps > 0 ? bitrateBps : undefined,
          durationSec,
          filesizeBytes,
          filesizeIsEstimate: filesizeBytes === undefined ? undefined : true,
          language: rep.lang,
        }),
      });
    }
  }

  // Audio-only sources (podcast-style MPDs) still deserve a variant.
  if (variants.length === 0 && audio !== undefined) {
    for (const set of sets) {
      if (set.kind !== "audio") continue;
      for (const rep of set.representations) {
        const filesizeBytes = estimateSizeBytes(rep.bandwidth, durationSec);
        const audioCodec = splitCodecs(rep.codecs).audio ?? rep.codecs;
        variants.push({
          id: `dash-${rep.id}`,
          protocol: "dash",
          url: rep.fileUrl ?? baseUrl,
          hasVideo: false,
          hasAudio: true,
          label: buildLabel({
            hasVideo: false,
            audioCodec: humanAudioCodec(audioCodec),
            bitrateBps: rep.bandwidth,
            filesizeBytes,
            filesizeIsEstimate: true,
            fallback: "DASH audio",
          }),
          ...optional({
            container: containerOf(rep.mimeType),
            audioCodec,
            bitrateBps: rep.bandwidth,
            durationSec,
            filesizeBytes,
            filesizeIsEstimate: filesizeBytes === undefined ? undefined : true,
            language: rep.lang,
          }),
        });
      }
    }
  }

  return {
    variants: variants.toSorted(compareVariantQuality),
    subtitles,
    drm,
    isLive,
    ...optional({ durationSec }),
  };
}
