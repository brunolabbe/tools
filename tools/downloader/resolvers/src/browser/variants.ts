/**
 * Variants built from network evidence alone.
 *
 * Used when a manifest could not be parsed (the parser is unavailable or the
 * manifest is a shape it does not know) and for progressive files, where there
 * is nothing to parse in the first place. Fields are only populated when they
 * were observed — a guessed resolution is worse than no resolution.
 */

import type { MediaVariant, StreamProtocol } from "@downloader/contract";
import type { NetworkHit } from "./types.ts";

const CONTAINER_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".mp4": "mp4",
  ".m4v": "mp4",
  ".m4a": "m4a",
  ".webm": "webm",
  ".mkv": "mkv",
  ".mov": "mov",
  ".ogv": "ogg",
  ".mp3": "mp3",
  ".flv": "flv",
};

function containerOf(hit: NetworkHit): string | undefined {
  const type = hit.contentType?.split(";")[0]?.trim().toLowerCase();
  if (type === "video/mp4") return "mp4";
  if (type === "video/webm") return "webm";
  if (type === "audio/mp4") return "m4a";
  if (type === "audio/mpeg") return "mp3";
  let path: string;
  try {
    path = new URL(hit.url).pathname.toLowerCase();
  } catch {
    return undefined;
  }
  for (const [extension, container] of Object.entries(CONTAINER_BY_EXTENSION)) {
    if (path.endsWith(extension)) return container;
  }
  return undefined;
}

function isAudioOnly(hit: NetworkHit): boolean {
  return hit.contentType?.toLowerCase().startsWith("audio/") ?? false;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A manifest we could not enumerate. ffmpeg reads the playlist itself and picks
 * a rendition, so this is a usable answer — just one without a quality picker.
 */
export function opaqueManifestVariant(hit: NetworkHit, id: string): MediaVariant {
  const protocol: StreamProtocol = hit.kind === "dash" ? "dash" : "hls";
  return {
    id,
    protocol,
    url: hit.url,
    hasVideo: true,
    hasAudio: true,
    label: `${protocol.toUpperCase()} stream · quality selected during download`,
  };
}

export function progressiveVariants(hits: readonly NetworkHit[]): MediaVariant[] {
  return hits.map((hit, index) => {
    const container = containerOf(hit);
    const audioOnly = isAudioOnly(hit);
    const size = hit.contentLength;
    const parts = [container?.toUpperCase() ?? "Direct file"];
    if (audioOnly) parts.push("audio only");
    if (size !== undefined && size > 0) parts.push(formatBytes(size));
    return {
      id: `browser-file-${index}`,
      protocol: "progressive" as const,
      url: hit.url,
      hasVideo: !audioOnly,
      hasAudio: true,
      ...(container === undefined ? {} : { container }),
      ...(size !== undefined && size > 0 ? { filesizeBytes: size, filesizeIsEstimate: false } : {}),
      label: parts.join(" · "),
    };
  });
}
