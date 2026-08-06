/**
 * HLS playlist parser — pure, offline, and one of the two DRM detectors in the
 * system (see `docs/00-STREAM-CAPTURE-ANALYSIS.md` §3).
 *
 * The distinction this file exists to get right: `EXT-X-KEY:METHOD=AES-128`
 * with an in-manifest `URI` is *transport encryption*. There is no licence
 * server and no device binding; ffmpeg fetches the key itself and it is fully
 * in scope. Only a non-`identity` `KEYFORMAT` — FairPlay's
 * `com.apple.streamingkeydelivery`, a Widevine/PlayReady UUID, or an `skd://`
 * key URI — is EME DRM, and only that sets `protected`.
 */

import { AppError } from "@downloader/shared";
import type { DrmInfo, DrmSystem, MediaVariant, SubtitleTrack } from "@downloader/shared";
import {
  buildLabel,
  compareVariantQuality,
  optional,
  resolveUrl,
  splitCodecs,
  subtitleFormat,
  urlExtension,
} from "../common.ts";
import type { ParsedManifest } from "./types.ts";

/** `KEYFORMAT` values that identify an EME key system. Anything else non-identity is unknown DRM. */
const KEYFORMAT_SYSTEMS: ReadonlyArray<readonly [string, DrmSystem]> = [
  ["com.apple.streamingkeydelivery", "fairplay"],
  ["com.apple.fps", "fairplay"],
  ["urn:uuid:94ce86fb-07ff-4f43-adb8-93d2fa968ca2", "fairplay"],
  ["com.widevine.alpha", "widevine"],
  ["com.widevine", "widevine"],
  ["urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed", "widevine"],
  ["com.microsoft.playready", "playready"],
  ["urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95", "playready"],
  ["org.w3.clearkey", "clearkey"],
  ["urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e", "clearkey"],
];

const AUDIO_ONLY_EXTENSIONS = new Set(["aac", "mp3", "m4a", "ac3", "ec3", "eac3"]);

interface Tag {
  name: string;
  value: string;
}

interface StreamInf {
  attrs: Map<string, string>;
  uri: string;
  index: number;
}

interface Rendition {
  type: string;
  groupId: string;
  name: string;
  language: string | undefined;
  uri: string | undefined;
  isDefault: boolean;
  characteristics: string | undefined;
}

/**
 * Parses an `EXT-X-…` attribute list. Values may be quoted and quoted values
 * may contain commas (`CODECS="avc1.4d401f,mp4a.40.2"`), so this cannot be a
 * `split(",")`.
 */
export function parseAttributeList(input: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let cursor = 0;
  while (cursor < input.length) {
    const equals = input.indexOf("=", cursor);
    if (equals === -1) break;
    const key = input.slice(cursor, equals).trim().toUpperCase();
    cursor = equals + 1;
    let value: string;
    if (input[cursor] === '"') {
      cursor += 1;
      const close = input.indexOf('"', cursor);
      if (close === -1) {
        value = input.slice(cursor);
        cursor = input.length;
      } else {
        value = input.slice(cursor, close);
        const comma = input.indexOf(",", close + 1);
        cursor = comma === -1 ? input.length : comma + 1;
      }
    } else {
      const comma = input.indexOf(",", cursor);
      if (comma === -1) {
        value = input.slice(cursor);
        cursor = input.length;
      } else {
        value = input.slice(cursor, comma);
        cursor = comma + 1;
      }
    }
    if (key !== "") attrs.set(key, value.trim());
  }
  return attrs;
}

function parseTag(line: string): Tag | undefined {
  if (!line.startsWith("#EXT")) return undefined;
  const colon = line.indexOf(":");
  if (colon === -1) return { name: line.slice(1), value: "" };
  return { name: line.slice(1, colon), value: line.slice(colon + 1) };
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseResolution(value: string | undefined): {
  width: number | undefined;
  height: number | undefined;
} {
  if (value === undefined) return { width: undefined, height: undefined };
  const match = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(value.trim());
  if (match === null) return { width: undefined, height: undefined };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function parseRendition(attrs: Map<string, string>): Rendition {
  const uri = attrs.get("URI");
  return {
    type: (attrs.get("TYPE") ?? "").toUpperCase(),
    groupId: attrs.get("GROUP-ID") ?? "",
    name: attrs.get("NAME") ?? attrs.get("LANGUAGE") ?? "Default",
    language: attrs.get("LANGUAGE"),
    uri: uri === undefined || uri === "" ? undefined : uri,
    isDefault: (attrs.get("DEFAULT") ?? "NO").toUpperCase() === "YES",
    characteristics: attrs.get("CHARACTERISTICS"),
  };
}

/**
 * Classifies every `EXT-X-KEY` / `EXT-X-SESSION-KEY` in the playlist.
 *
 * A non-`identity` `KEYFORMAT` we do not recognise is still reported as
 * protected with system `unknown`: the default keyformat is the only one whose
 * key we can fetch ourselves, so anything else is by definition a key system we
 * cannot satisfy. That is positive evidence, not a guess.
 */
function inspectKeys(keys: Tag[]): DrmInfo {
  const systems = new Set<DrmSystem>();
  const evidence: string[] = [];
  let sawTransportEncryption = false;

  for (const key of keys) {
    const attrs = parseAttributeList(key.value);
    const method = (attrs.get("METHOD") ?? "NONE").toUpperCase();
    if (method === "NONE") continue;

    const keyFormat = (attrs.get("KEYFORMAT") ?? "identity").toLowerCase();
    const uri = attrs.get("URI") ?? "";

    if (uri.toLowerCase().startsWith("skd://")) {
      systems.add("fairplay");
      evidence.push(`${key.name} METHOD=${method} URI="skd://…" (FairPlay)`);
      continue;
    }

    if (keyFormat === "identity") {
      // AES-128 / SAMPLE-AES with a plain key URI: ffmpeg fetches the key over
      // HTTPS with the same request context. In scope. Analysis §3.
      sawTransportEncryption = true;
      continue;
    }

    const known = KEYFORMAT_SYSTEMS.find(([format]) => format === keyFormat);
    const system: DrmSystem = known?.[1] ?? "unknown";
    systems.add(system);
    evidence.push(`${key.name} METHOD=${method} KEYFORMAT="${keyFormat}" (${system})`);
  }

  if (systems.size > 0) {
    return { protected: true, systems: [...systems], evidence: evidence.join("; ") };
  }
  if (sawTransportEncryption) {
    return {
      protected: false,
      systems: [],
      evidence: "EXT-X-KEY with an in-manifest key URI — transport encryption, not DRM",
    };
  }
  return { protected: false, systems: [] };
}

function pickAudioRendition(group: Rendition[] | undefined): Rendition | undefined {
  if (group === undefined || group.length === 0) return undefined;
  return (
    group.find((r) => r.isDefault && r.uri !== undefined) ??
    group.find((r) => r.uri !== undefined) ??
    group[0]
  );
}

function buildSubtitles(renditions: Rendition[], baseUrl: string): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  let index = 0;
  for (const rendition of renditions) {
    if (rendition.type !== "SUBTITLES") continue;
    // CLOSED-CAPTIONS renditions are carried inside the video stream and have no
    // URI, so there is nothing to fetch; they are skipped by the type check.
    if (rendition.uri === undefined) continue;
    const url = resolveUrl(rendition.uri, baseUrl);
    const extension = urlExtension(url);
    // HLS subtitle renditions point at a playlist of WebVTT segments unless the
    // extension says otherwise, so `.m3u8` resolves to vtt rather than unknown.
    const format = extension === "m3u8" || extension === "m3u" ? "vtt" : subtitleFormat(extension);
    tracks.push({
      id: `hls-sub-${index}`,
      url,
      language: rendition.language ?? "und",
      label: rendition.name,
      format,
      autoGenerated: false,
    });
    index += 1;
  }
  return tracks;
}

/**
 * Parses an HLS master playlist or a single media playlist. Callers rarely know
 * which one they fetched — the difference is one tag — so both are handled here.
 *
 * @throws AppError `NO_MEDIA_FOUND` when the body is not an HLS playlist at all.
 */
export function parseHls(text: string, baseUrl: string): ParsedManifest {
  const body = text.replace(/^﻿/, "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines[0] !== "#EXTM3U") {
    throw new AppError("NO_MEDIA_FOUND", "That URL did not return an HLS playlist.", {
      details: { firstLine: lines[0]?.slice(0, 80) ?? "" },
    });
  }

  const keys: Tag[] = [];
  const renditions: Rendition[] = [];
  const streams: StreamInf[] = [];
  let pendingStream: Map<string, string> | undefined;
  let hasEndlist = false;
  let hasSegments = false;
  let playlistType: string | undefined;
  let totalDuration = 0;
  let firstSegmentUri: string | undefined;
  let pendingExtinf = false;

  for (const line of lines) {
    if (line.startsWith("#")) {
      const tag = parseTag(line);
      if (tag === undefined) continue;
      switch (tag.name) {
        case "EXT-X-KEY":
        case "EXT-X-SESSION-KEY": {
          keys.push(tag);
          break;
        }
        case "EXT-X-MEDIA": {
          renditions.push(parseRendition(parseAttributeList(tag.value)));
          break;
        }
        case "EXT-X-STREAM-INF": {
          pendingStream = parseAttributeList(tag.value);
          break;
        }
        case "EXTINF": {
          hasSegments = true;
          pendingExtinf = true;
          const duration = toNumber(tag.value.split(",")[0]);
          if (duration !== undefined) totalDuration += duration;
          break;
        }
        case "EXT-X-ENDLIST": {
          hasEndlist = true;
          break;
        }
        case "EXT-X-PLAYLIST-TYPE": {
          playlistType = tag.value.trim().toUpperCase();
          break;
        }
        case "EXT-X-TARGETDURATION": {
          hasSegments = true;
          break;
        }
        default:
          break;
      }
      continue;
    }

    // A bare URI line belongs to whichever tag preceded it.
    if (pendingStream !== undefined) {
      streams.push({ attrs: pendingStream, uri: line, index: streams.length });
      pendingStream = undefined;
    } else if (pendingExtinf) {
      firstSegmentUri ??= line;
      pendingExtinf = false;
    }
  }

  const drm = inspectKeys(keys);
  const audioGroups = new Map<string, Rendition[]>();
  for (const rendition of renditions) {
    if (rendition.type !== "AUDIO") continue;
    const group = audioGroups.get(rendition.groupId);
    if (group === undefined) audioGroups.set(rendition.groupId, [rendition]);
    else group.push(rendition);
  }
  const subtitles = buildSubtitles(renditions, baseUrl);

  if (streams.length > 0) {
    const variants = streams
      .map((stream) => buildMasterVariant(stream, audioGroups, baseUrl))
      .toSorted(compareVariantQuality);
    // A master playlist carries no ENDLIST of its own, so liveness is unknowable
    // here; it is decided by whichever media playlist gets fetched next.
    return { variants, subtitles, drm, isLive: false };
  }

  if (!hasSegments) {
    return { variants: [], subtitles, drm, isLive: false };
  }

  const isLive = !hasEndlist && playlistType !== "VOD";
  const durationSec = isLive || totalDuration <= 0 ? undefined : totalDuration;
  const segmentExtension =
    firstSegmentUri === undefined ? undefined : urlExtension(resolveUrl(firstSegmentUri, baseUrl));
  const hasVideo = segmentExtension === undefined || !AUDIO_ONLY_EXTENSIONS.has(segmentExtension);

  const variant: MediaVariant = {
    id: "hls-media",
    protocol: "hls",
    url: baseUrl,
    hasVideo,
    hasAudio: true,
    label: buildLabel({
      hasVideo,
      durationSec,
      fallback: isLive ? "Live HLS stream" : "HLS stream",
    }),
    ...optional({
      container: segmentExtension === "ts" ? "mpegts" : segmentExtension,
      durationSec,
    }),
  };

  return { variants: [variant], subtitles, drm, isLive, ...optional({ durationSec }) };
}

function buildMasterVariant(
  stream: StreamInf,
  audioGroups: Map<string, Rendition[]>,
  baseUrl: string,
): MediaVariant {
  const { attrs } = stream;
  const bitrateBps = toNumber(attrs.get("AVERAGE-BANDWIDTH")) ?? toNumber(attrs.get("BANDWIDTH"));
  const { width, height } = parseResolution(attrs.get("RESOLUTION"));
  const fps = toNumber(attrs.get("FRAME-RATE"));
  const codecsAttr = attrs.get("CODECS");
  const { video: videoCodec, audio: audioCodec } = splitCodecs(codecsAttr);

  const audioGroupId = attrs.get("AUDIO");
  const audioRendition = pickAudioRendition(
    audioGroupId === undefined ? undefined : audioGroups.get(audioGroupId),
  );
  // An EXT-X-MEDIA audio rendition without a URI means the audio is muxed into
  // this variant already; only a rendition with its own URI needs muxing.
  const audioUrl =
    audioRendition?.uri === undefined ? undefined : resolveUrl(audioRendition.uri, baseUrl);

  const hasVideo = height !== undefined || videoCodec !== undefined;
  // With no CODECS attribute at all, an HLS variant is conventionally muxed
  // audio+video; only an explicit CODECS list without an audio entry and
  // without an audio group proves the rendition is silent.
  const hasAudio =
    audioCodec !== undefined ||
    audioRendition !== undefined ||
    codecsAttr === undefined ||
    codecsAttr.trim() === "";

  return {
    id: `hls-${stream.index}`,
    protocol: "hls",
    url: resolveUrl(stream.uri, baseUrl),
    hasVideo,
    hasAudio,
    label: buildLabel({
      hasVideo,
      height,
      width,
      fps,
      videoCodec,
      audioCodec,
      bitrateBps,
      fallback: "HLS stream",
    }),
    ...optional({
      audioUrl,
      videoCodec,
      audioCodec,
      width,
      height,
      fps,
      bitrateBps,
      language: audioRendition?.language,
    }),
  };
}
