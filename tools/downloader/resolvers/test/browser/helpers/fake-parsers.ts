/**
 * Stand-ins for the WP-1 manifest parsers.
 *
 * The resolver takes them as constructor options, so these tests pin the
 * sniffer's behaviour — capture, ranking, header replay — without depending on
 * a parser landing first, and without the assertions moving when it does.
 */

import type { DashParser, HlsParser, ParsedManifest } from "../../../src/manifest/types.ts";

export interface ParserCall {
  text: string;
  baseUrl: string;
}

export interface RecordingParser<T> {
  parser: T;
  calls: ParserCall[];
}

function emptyManifest(): ParsedManifest {
  return { variants: [], subtitles: [], drm: { protected: false, systems: [] }, isLive: false };
}

/** Produces one variant per `#EXT-X-STREAM-INF`, so master vs media is visible. */
export function recordingHlsParser(): RecordingParser<HlsParser> {
  const calls: ParserCall[] = [];
  const parser: HlsParser = (text, baseUrl) => {
    calls.push({ text, baseUrl });
    const streamInfs = text.match(/#EXT-X-STREAM-INF/g)?.length ?? 0;
    const count = Math.max(1, streamInfs);
    return {
      ...emptyManifest(),
      // A master playlist has no EXT-X-ENDLIST of its own; only a media playlist
      // can say whether the stream is live.
      isLive: streamInfs === 0 && !text.includes("#EXT-X-ENDLIST"),
      durationSec: 8,
      variants: Array.from({ length: count }, (_, index) => ({
        id: `fake-hls-${index}`,
        protocol: "hls" as const,
        url: baseUrl,
        hasVideo: true,
        hasAudio: true,
        label: `fake variant ${index}`,
      })),
    };
  };
  return { parser, calls };
}

export function recordingDashParser(): RecordingParser<DashParser> {
  const calls: ParserCall[] = [];
  const parser: DashParser = (xml, baseUrl) => {
    calls.push({ text: xml, baseUrl });
    const representations = xml.match(/<Representation\b/g)?.length ?? 0;
    return {
      ...emptyManifest(),
      isLive: xml.includes('type="dynamic"'),
      durationSec: 630,
      variants: Array.from({ length: Math.max(1, representations) }, (_, index) => ({
        id: `fake-dash-${index}`,
        protocol: "dash" as const,
        url: baseUrl,
        hasVideo: true,
        hasAudio: true,
        label: `fake dash variant ${index}`,
      })),
    };
  };
  return { parser, calls };
}

/** Stands in for a parser that has not been written yet, or that chokes. */
export const throwingHlsParser: HlsParser = () => {
  throw new Error("parser unavailable");
};

export const throwingDashParser: DashParser = () => {
  throw new Error("parser unavailable");
};

/** A manifest whose DRM verdict must stop the pipeline. */
export const drmHlsParser: HlsParser = () => ({
  variants: [],
  subtitles: [],
  drm: {
    protected: true,
    systems: ["fairplay"],
    evidence: 'EXT-X-KEY METHOD=SAMPLE-AES URI="skd://…"',
  },
  isLive: false,
});
