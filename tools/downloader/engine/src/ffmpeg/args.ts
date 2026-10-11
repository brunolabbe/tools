/**
 * ffmpeg argument construction.
 *
 * Kept pure and separate from the spawn so the flags — which are the part that
 * costs an afternoon each when wrong — can be asserted on directly.
 *
 * Ordering rules ffmpeg does not forgive:
 *  - options that configure an input must precede that input's `-i`;
 *  - options that configure the output must follow every `-i` and precede the
 *    output path;
 *  - `-headers` and `-user_agent` are per-input, so a second input (a separate
 *    audio rendition) needs its own copy. Segments are gated too.
 */

import type { RequestContext } from "@downloader/contract";
import { buildRequestContextArgs } from "./headers.ts";

/**
 * `-nostdin` matters: without it ffmpeg reads the parent's stdin and a service
 * with an inherited terminal ends up consuming keystrokes. `-y` because the
 * destination is a path we just created inside our own tmp dir.
 *
 * **`warning`, not `error`, and that one word is load-bearing.** Since dl-27 the
 * egress proxy verifies each origin itself and refuses a bad one by answering
 * the `CONNECT` with `502 TLS certificate verification failed (<code>)`. ffmpeg
 * logs a proxy's status line verbatim — `[httpproxy] HTTP error 502 <phrase>` —
 * **at `AV_LOG_WARNING`**, so at `error` the reason is dropped on the floor and
 * an intercepted CDN arrives as `Invalid data found when processing input`,
 * indistinguishable from a corrupt stream. Measured both ways in dl-27, on the
 * manifest connection and on the segment connections, which is the case that has
 * no other channel at all: dl-21 established that no certificate semantics reach
 * ffmpeg from a segment fetch by any other route.
 *
 * The noise it buys is nil where it was measured — a clean HLS download over the
 * terminating proxy emits **zero** bytes of stderr at this level — and what does
 * arrive goes to `logger.debug` and to a failure's stderr tail.
 *
 * **Asked for as `level+info`, and read as `warning`** (dl-96). The input's
 * `Duration:` line is an info message, and on a source the probe could not
 * time it is the only thing that turns an indeterminate bar into a percent —
 * ffmpeg has read the duration before its first output byte, `moov` at the end
 * or not. `level` tags every message, and the runner's `StderrLevels` routes
 * the `[info]` ones to `onInfoLine` alone, so `onStderrLine`, the tail and
 * every pattern above still see exactly what `warning` wrote.
 */
export const GLOBAL_ARGS: readonly string[] = [
  "-hide_banner",
  "-nostdin",
  "-loglevel",
  "level+info",
  "-y",
];

/**
 * Machine-readable progress, and no human status line, on descriptor 3:
 * stdout is the media itself since dl-53, and `streamFfmpeg` opens the
 * descriptor. The stdout form went with the last run that wrote to a file.
 */
export const STREAM_PROGRESS_ARGS: readonly string[] = ["-progress", "pipe:3", "-nostats"];

/**
 * Protocols a *remote* manifest is allowed to reference.
 *
 * `file` is deliberately absent. A manifest is attacker-influenced data, and an
 * HLS playlist whose segment URI is `file:///etc/passwd` would otherwise be
 * remuxed straight into the user's download.
 *
 * `httpproxy` is what libavformat opens an HTTPS target through when a proxy is
 * set, and leaving it out does not make anything safer — it makes proxied HTTPS
 * fail with `Invalid argument` before the proxy is ever contacted, which is what
 * it did until dl-11. Every egress now goes through the guarded proxy anyway, so
 * a manifest naming `httpproxy://` reaches the same check as everything else.
 */
export const REMOTE_PROTOCOL_WHITELIST = "http,https,httpproxy,tcp,tls,crypto,data";

/** Local assembly (the concat demuxer) reads a list file we wrote ourselves. */
export const LOCAL_PROTOCOL_WHITELIST = "file,crypto,data";

export interface NetworkInputOptions {
  requestContext?: RequestContext | undefined;
  /**
   * Check the certificate on the other end. Defaults to **on**, which is not
   * libavformat's default — `tls_verify` is `0` there, so an unset flag means
   * every manifest and every segment is encrypted to a certificate nobody
   * looked at (dl-14 measured this; dl-19 turned it on).
   *
   * Off is an operator's explicit choice for a TLS-intercepting corporate
   * proxy, and it is loud where it is made — never a debugging shortcut here.
   */
  tlsVerify?: boolean;
  /**
   * A CA bundle to trust instead of the system store, for an operator whose
   * chain ends at a private root — and for the fixture suites, which is how the
   * verification above is proved rather than asserted.
   */
  tlsCaFile?: string | undefined;
  /** Survive a dropped connection mid-stream instead of failing the whole job. */
  reconnect?: boolean;
  /** Socket read/write stall timeout. ffmpeg wants microseconds. */
  readTimeoutMs?: number;
  /** HLS only: segment URIs with unusual or absent extensions are common. */
  hlsAllowAllExtensions?: boolean;
  /** Extra per-input options appended before `-i`. */
  extraArgs?: readonly string[];
}

const DEFAULT_READ_TIMEOUT_MS = 30_000;

/**
 * Whether this input will open the `tls` protocol at the top level, and so
 * whether `-tls_verify` will be consumed.
 *
 * It has to be asked, because **`avformat_open_input` treats an option nothing
 * consumed as a fatal error.** Give `-tls_verify 1` to an `http://` manifest and
 * ffmpeg fetches the playlist, fetches the first segment, and then exits
 * non-zero with `Option tls_verify not found` — a download that failed for a
 * flag rather than for anything about the stream. Measured in dl-19, on both
 * builds; the ticket did not know about it and the plain-HTTP e2e origin is
 * exactly what it would have broken.
 *
 * A malformed URL is treated as HTTPS: the flag is harmless where TLS is opened
 * and the alternative is guessing "no verification" from a parse failure.
 */
function opensTls(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return true;
  }
}

/** Everything for one remote input, terminated by `-i <url>`. */
export function buildNetworkInputArgs(url: string, options: NetworkInputOptions = {}): string[] {
  const args: string[] = ["-protocol_whitelist", REMOTE_PROTOCOL_WHITELIST];

  // Written out even when off. `-tls_verify 0` is libavformat's own default, so
  // omitting it would be equivalent — but then "verification is off" is the
  // absence of a flag, which is invisible in a logged argv and indistinguishable
  // from the bug this replaced.
  //
  // A plain-HTTP input gets neither, per `opensTls`. Nothing is lost by it: a
  // manifest fetched in the clear can be rewritten in flight by anyone who could
  // also have substituted a segment, so authenticating the segments it names
  // would be a lock on a door with no wall.
  if (opensTls(url)) {
    args.push("-tls_verify", options.tlsVerify === false ? "0" : "1");
    if (options.tlsCaFile !== undefined && options.tlsCaFile.length > 0) {
      args.push("-ca_file", options.tlsCaFile);
    }
  }

  if (options.hlsAllowAllExtensions === true) {
    args.push("-allowed_extensions", "ALL");
  }

  if (options.reconnect !== false) {
    args.push(
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_on_network_error",
      "1",
      "-reconnect_delay_max",
      "10",
    );
  }

  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  if (readTimeoutMs > 0) {
    args.push("-rw_timeout", String(readTimeoutMs * 1000));
  }

  args.push(...buildRequestContextArgs(options.requestContext));
  if (options.extraArgs !== undefined) args.push(...options.extraArgs);

  args.push("-i", url);
  return args;
}

/**
 * What ffmpeg may open behind `parallel-ranges.ts`'s loopback server (dl-98):
 * plain HTTP to it, and nothing else. The loopback never redirects.
 */
export const LOOPBACK_PROTOCOL_WHITELIST = "http,tcp";

/**
 * A progressive input read through the engine's own loopback range server
 * (dl-98) rather than from its origin.
 *
 * **`-http_proxy ""` is what keeps the loopback off the egress proxy**, and it
 * is per input: the runner exports the guarded proxy as `http_proxy`, which
 * would send this request to the proxy, which refuses a loopback address. An
 * empty value overrides the variable for this input alone, measured on ffmpeg
 * 6.1.1 and 7.0.2 (an inherited proxy saw the request without it, and none
 * with it); `no_proxy` would have been process-wide, and so would have let any
 * other input that names a loopback address go around the guard.
 *
 * No `-headers` and no `-user_agent`: the replayed context is the feeder's to
 * send to the origin, and the loopback has no use for a cookie. Reconnect stays
 * on, because a cut the feeder passes on is healed the way an origin's is.
 */
export function buildLoopbackInputArgs(
  url: string,
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
): string[] {
  return [
    "-protocol_whitelist",
    LOOPBACK_PROTOCOL_WHITELIST,
    "-http_proxy",
    "",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_delay_max",
    "10",
    ...(readTimeoutMs > 0 ? ["-rw_timeout", String(readTimeoutMs * 1000)] : []),
    "-i",
    url,
  ];
}

/** Local input, used by the concat-demuxer fallback path. */
export function buildLocalInputArgs(filePath: string, extraArgs: readonly string[] = []): string[] {
  return ["-protocol_whitelist", LOCAL_PROTOCOL_WHITELIST, ...extraArgs, "-i", filePath];
}

/**
 * `-t` limits *output* duration, so it belongs with the output options. This is
 * the only way to bound a live manifest, which by definition has no end.
 */
export function buildDurationLimitArgs(seconds: number | null | undefined): string[] {
  return seconds !== null && seconds !== undefined && seconds > 0 ? ["-t", String(seconds)] : [];
}
