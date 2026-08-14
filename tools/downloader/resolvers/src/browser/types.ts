/**
 * Internal vocabulary of the browser sniffer. None of this crosses a package
 * boundary — `@downloader/contract` owns everything that does.
 */

/**
 * What a captured request looks like it is.
 *
 * `segment` exists so that init/media chunks can be recorded (they are proof
 * that playback actually started) without ever being offered as a downloadable
 * variant — handing the engine `seg-00042.m4s` would produce a two-second file.
 */
export type MediaKind = "hls" | "dash" | "progressive" | "segment";

/** One deduplicated media request observed on the wire. */
export interface NetworkHit {
  /** URL exactly as requested, signed query intact — it is not interchangeable. */
  url: string;
  /** Normalised form used only as a dedupe key. */
  key: string;
  kind: MediaKind;
  /**
   * Full request headers. This is what becomes `RequestContext`, so it must keep
   * `Referer` — its absence is the single most common cause of a later 403.
   */
  headers: Record<string, string>;
  contentType?: string;
  contentLength?: number;
  status?: number;
  /** Arrival order. A master playlist is always requested before its variants. */
  seq: number;
  /** True once a response (not just a request) confirmed this hit. */
  confirmed: boolean;
  /** URL of the frame that issued the request; differs from the page for embeds. */
  frameUrl?: string;
}
