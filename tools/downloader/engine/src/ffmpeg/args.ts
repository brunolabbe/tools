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
 */
export const REMOTE_PROTOCOL_WHITELIST = "http,https,tcp,tls,crypto,data";

/** Local assembly (the concat demuxer) reads a list file we wrote ourselves. */
export const LOCAL_PROTOCOL_WHITELIST = "file,crypto,data";

export interface NetworkInputOptions {
  requestContext?: RequestContext | undefined;
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

/** Everything for one remote input, terminated by `-i <url>`. */
export function buildNetworkInputArgs(url: string, options: NetworkInputOptions = {}): string[] {
  const args: string[] = ["-protocol_whitelist", REMOTE_PROTOCOL_WHITELIST];

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
