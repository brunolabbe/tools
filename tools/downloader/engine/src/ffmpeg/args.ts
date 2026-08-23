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
 */
export const GLOBAL_ARGS: readonly string[] = [
  "-hide_banner",
  "-nostdin",
  "-loglevel",
  "error",
  "-y",
];

/** Machine-readable progress on stdout; suppress the human status line. */
export const PROGRESS_ARGS: readonly string[] = ["-progress", "pipe:1", "-nostats"];

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
