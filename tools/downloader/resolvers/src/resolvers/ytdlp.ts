/**
 * yt-dlp fast path — priority 20.
 *
 * This tier is a **latency optimisation, not a coverage mechanism** (analysis
 * §4). Everything it does, the browser sniffer can also do, only slower and with
 * poorer metadata. Two consequences are encoded here deliberately:
 *
 *  - A missing binary makes `canHandle()` return `false`. It is not an error,
 *    it is a fallthrough. Same for `ENABLE_YTDLP_RESOLVER=false`.
 *  - Any yt-dlp failure that is not a definite fact about the source
 *    (`DRM_PROTECTED`, `AUTH_REQUIRED`, `GEO_BLOCKED`) is reported as
 *    `NO_MEDIA_FOUND` so the chain degrades to the sniffer instead of failing.
 *    Extractors break constantly as sites redesign; that must cost latency, not
 *    coverage.
 *
 * The one exception to the second rule is `TLS_VERIFICATION_FAILED` (dl-34): it
 * is a fact about the *connection* rather than the source, and it is one the
 * sniffer would meet identically, so degrading to it costs a browser launch and
 * then reports the wrong thing. See `classifyFailure`.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "@downloader/contract";
import type {
  DrmInfo,
  MediaVariant,
  ProbeResult,
  RequestContext,
  Resolver,
  ResolveOptions,
  StreamProtocol,
  SubtitleTrack,
} from "@downloader/contract";
import { toAbortError } from "../abort.ts";
import {
  buildLabel,
  compareVariantQuality,
  optional,
  resolveUrl,
  subtitleFormat,
} from "../common.ts";
import type { MediaSegment } from "../manifest/hls.ts";
import { createFetchSizeProbe } from "../size-probe.ts";
import { measureVariantSizes } from "../size-sample.ts";
import { TIER_TRUST_STORE_HINT, ytdlpCertificateMarker } from "../tls-verification.ts";

/** yt-dlp JSON is far larger than a manifest; this is a memory bound, not a policy. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface YtDlpFormat {
  format_id?: string;
  url?: string;
  ext?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  tbr?: number;
  vbr?: number;
  abr?: number;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  language?: string;
  container?: string;
  has_drm?: boolean;
  http_headers?: Record<string, string>;
  /** `http_dash_segments` and some HLS formats arrive with their segments listed. */
  fragments?: YtDlpFragment[];
  /** What a fragment's `path` is relative to, when it has one. */
  fragment_base_url?: string;
}

/** One entry of a format's `fragments` list. Either `url` or `path` is set. */
export interface YtDlpFragment {
  url?: string;
  path?: string;
  duration?: number;
}

export interface YtDlpSubtitle {
  url?: string;
  ext?: string;
  name?: string;
}

export interface YtDlpInfo {
  id?: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
  is_live?: boolean;
  live_status?: string;
  webpage_url?: string;
  has_drm?: boolean;
  url?: string;
  ext?: string;
  protocol?: string;
  formats?: YtDlpFormat[];
  subtitles?: Record<string, YtDlpSubtitle[]>;
  automatic_captions?: Record<string, YtDlpSubtitle[]>;
  http_headers?: Record<string, string>;
  _type?: string;
  entries?: YtDlpInfo[];
}

export interface YtDlpResolverOptions {
  /** Defaults to `YTDLP_PATH`, then `yt-dlp` on `PATH`. */
  binaryPath?: string;
  /**
   * Arguments placed before yt-dlp's own, for installs that need an
   * interpreter (`python -m yt_dlp`). Never passed through a shell.
   */
  binaryArgs?: readonly string[];
  /** Defaults to `ENABLE_YTDLP_RESOLVER !== "false"`. */
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * Used only to weigh a rendition after extraction (dl-30), never to extract.
   * The API hands over the same `GuardedFetch` the direct tier gets. Omitted —
   * as it is everywhere but the API and its own tests — the resolver behaves
   * exactly as it did before: declared sizes, unsampled.
   */
  fetch?: typeof globalThis.fetch;
}

export class YtDlpResolver implements Resolver {
  readonly name = "yt-dlp";
  readonly priority = 20;

  readonly #binaryArgs: readonly string[];
  /** Resolved once at construction — `canHandle` runs on every request and must not do I/O. */
  readonly #binaryPath: string | undefined;
  readonly #enabled: boolean;
  readonly #fetch: typeof globalThis.fetch | undefined;

  constructor(options: YtDlpResolverOptions = {}) {
    const env = options.env ?? process.env;
    this.#enabled = options.enabled ?? env["ENABLE_YTDLP_RESOLVER"] !== "false";
    this.#binaryArgs = options.binaryArgs ?? [];
    this.#fetch = options.fetch;
    const requested = options.binaryPath ?? env["YTDLP_PATH"] ?? "yt-dlp";
    this.#binaryPath = this.#enabled ? findExecutable(requested) : undefined;
  }

  /** True only when the binary really exists; absence is a fallthrough, never an error. */
  get available(): boolean {
    return this.#binaryPath !== undefined;
  }

  /**
   * Where the binary was found, for `/api/health`.
   *
   * Worth reporting rather than just the boolean: "yt-dlp is missing" on a
   * machine where it is plainly installed is almost always a `PATH` that
   * differs between the shell and the service, and the resolved path is what
   * shows that at a glance.
   */
  get resolvedPath(): string | undefined {
    return this.#binaryPath;
  }

  canHandle(url: URL): boolean {
    if (!this.#enabled || this.#binaryPath === undefined) return false;
    return url.protocol === "http:" || url.protocol === "https:";
  }

  async resolve(url: URL, options: ResolveOptions): Promise<ProbeResult> {
    const binary = this.#binaryPath;
    if (binary === undefined) {
      throw new AppError("NO_MEDIA_FOUND", "yt-dlp is not installed.");
    }

    const args = [...this.#binaryArgs, "--dump-single-json", "--no-warnings", "--no-playlist"];
    if (options.proxyUrl !== undefined && options.proxyUrl !== "") {
      args.push("--proxy", options.proxyUrl);
    }
    if (options.cookieHeader !== undefined && options.cookieHeader !== "") {
      args.push("--add-header", `Cookie:${sanitiseHeaderValue(options.cookieHeader)}`);
    }
    if (options.locale !== undefined && options.locale !== "") {
      args.push("--add-header", `Accept-Language:${sanitiseHeaderValue(options.locale)}`);
    }
    args.push(url.href);

    const result = await runProcess(binary, args, options.signal);
    if (result.code !== 0) throw classifyFailure(result.stderr, result.code, url);

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (cause) {
      throw new AppError("NO_MEDIA_FOUND", "yt-dlp returned output we could not read.", { cause });
    }

    const info = firstEntry(parsed);
    if (info === undefined) {
      throw new AppError("NO_MEDIA_FOUND", undefined, { details: { url: url.href } });
    }

    const probe = mapYtDlpInfo(info, url.href, this.name, options);
    if (probe.drm.protected) {
      throw new AppError("DRM_PROTECTED", undefined, {
        details: {
          url: url.href,
          systems: probe.drm.systems,
          ...optional({ evidence: probe.drm.evidence }),
        },
      });
    }
    if (probe.variants.length === 0) {
      throw new AppError("NO_MEDIA_FOUND", undefined, { details: { url: url.href } });
    }

    const fetchImpl = this.#fetch;
    if (fetchImpl === undefined) return probe;

    // dl-30: `tbr` on an adaptive format is the manifest's declared bandwidth,
    // which is a ceiling rather than an average. Weigh one rendition against it.
    const variants = await measureVariantSizes(
      probe.variants,
      createFetchSizeProbe({
        fetch: fetchImpl,
        headers: probe.requestContext.headers,
        signal: options.signal,
      }),
      {
        isLive: probe.isLive,
        segmentsByUrl: fragmentSegments(info),
        signal: options.signal,
        ...optional({ durationSec: probe.durationSec }),
      },
    );
    return { ...probe, variants };
  }
}

/**
 * Segment lists yt-dlp already handed us, keyed by the format URL they belong
 * to — which is how a variant's `url` and its `audioUrl` both find theirs.
 *
 * A `http_dash_segments` format arrives with every fragment and its duration
 * enumerated, which is exactly what the sampler needs and what our own DASH
 * parser cannot produce — it does not expand `SegmentTemplate`. A format whose
 * fragments carry no durations is left out: without them the bytes weigh
 * nothing.
 */
export function fragmentSegments(info: YtDlpInfo): Map<string, MediaSegment[]> {
  const byUrl = new Map<string, MediaSegment[]>();
  for (const format of info.formats ?? []) {
    const fragments = format.fragments;
    if (fragments === undefined || fragments.length === 0) continue;

    const base = format.fragment_base_url ?? format.url;
    const segments: MediaSegment[] = [];
    for (const fragment of fragments) {
      const duration = fragment.duration;
      if (duration === undefined || duration <= 0) continue;
      const href =
        fragment.url ??
        (fragment.path === undefined || base === undefined
          ? undefined
          : resolveUrl(fragment.path, base));
      if (href === undefined || href === "") continue;
      segments.push({ url: href, durationSec: duration });
    }

    if (segments.length > 0 && format.url !== undefined && format.url !== "") {
      byUrl.set(format.url, segments);
    }
  }
  return byUrl;
}

function firstEntry(parsed: unknown): YtDlpInfo | undefined {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const info = parsed as YtDlpInfo;
  // --no-playlist still yields a playlist envelope on a few extractors.
  if (info["_type"] === "playlist") return info.entries?.[0];
  return info;
}

/** `"none"` is yt-dlp's way of saying "this stream is absent", not a codec name. */
function realCodec(codec: string | undefined): string | undefined {
  if (codec === undefined || codec === "" || codec === "none") return undefined;
  return codec;
}

export function mapProtocol(protocol: string | undefined): StreamProtocol {
  const value = (protocol ?? "").toLowerCase();
  if (value.startsWith("m3u8")) return "hls";
  if (value.startsWith("http_dash")) return "dash";
  if (value === "https" || value === "http") return "progressive";
  return "other";
}

interface Sized {
  bytes: number | undefined;
  isEstimate: boolean;
}

function formatSizeOf(format: YtDlpFormat, durationSec: number | undefined): Sized {
  if (typeof format.filesize === "number" && format.filesize > 0) {
    return { bytes: format.filesize, isEstimate: false };
  }
  if (typeof format.filesize_approx === "number" && format.filesize_approx > 0) {
    return { bytes: format.filesize_approx, isEstimate: true };
  }
  const bitrate = format.tbr ?? (format.vbr ?? 0) + (format.abr ?? 0);
  if (durationSec !== undefined && durationSec > 0 && bitrate > 0) {
    return { bytes: Math.round((bitrate * 1000 * durationSec) / 8), isEstimate: true };
  }
  return { bytes: undefined, isEstimate: true };
}

function bitrateOf(format: YtDlpFormat): number | undefined {
  const kbps = format.tbr ?? (format.vbr ?? 0) + (format.abr ?? 0);
  return kbps > 0 ? Math.round(kbps * 1000) : undefined;
}

function mapSubtitles(
  source: Record<string, YtDlpSubtitle[]> | undefined,
  autoGenerated: boolean,
  prefix: string,
): SubtitleTrack[] {
  if (source === undefined) return [];
  const tracks: SubtitleTrack[] = [];
  for (const [language, entries] of Object.entries(source)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    // One track per language: yt-dlp lists the same captions in half a dozen
    // serialisations and the picker only needs one we can actually parse.
    const chosen =
      entries.find((entry) => entry.ext === "vtt") ??
      entries.find((entry) => entry.ext === "srt") ??
      entries.find((entry) => entry.ext === "ttml") ??
      entries[0];
    if (chosen?.url === undefined || chosen.url === "") continue;
    tracks.push({
      id: `${prefix}-${language}`,
      url: chosen.url,
      language,
      label: chosen.name ?? language,
      format: subtitleFormat(chosen.ext ?? chosen.url),
      autoGenerated,
    });
  }
  return tracks;
}

/**
 * Pure JSON → `ProbeResult` mapping, split out from the process handling so it
 * can be tested against checked-in extractor output with no binary present.
 */
export function mapYtDlpInfo(
  info: YtDlpInfo,
  sourceUrl: string,
  resolverName: string,
  options: Pick<ResolveOptions, "cookieHeader" | "locale" | "proxyUrl">,
): ProbeResult {
  const durationSec =
    typeof info.duration === "number" && info.duration > 0 ? info.duration : undefined;
  const isLive = info.is_live === true || info.live_status === "is_live";

  // A single-format extraction result puts the stream on the info dict itself.
  const rawFormats =
    info.formats ??
    (info.url === undefined
      ? []
      : [{ url: info.url, ...optional({ ext: info.ext, protocol: info.protocol }) }]);

  const drmFormats: YtDlpFormat[] = [];
  const usable: YtDlpFormat[] = [];
  for (const format of rawFormats) {
    if (typeof format.url !== "string" || format.url === "") continue;
    const protocol = (format.protocol ?? "").toLowerCase();
    // Storyboards are JPEG mosaics dressed as formats.
    if (protocol === "mhtml") continue;
    const hasVideo = realCodec(format.vcodec) !== undefined || typeof format.height === "number";
    const hasAudio = realCodec(format.acodec) !== undefined || typeof format.abr === "number";
    if (!hasVideo && !hasAudio) continue;
    if (format.has_drm === true) drmFormats.push(format);
    else usable.push(format);
  }

  const drm = describeDrm(info, drmFormats, usable);

  const audioOnly = usable
    .filter(
      (format) => realCodec(format.vcodec) === undefined && realCodec(format.acodec) !== undefined,
    )
    .toSorted((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0));
  const bestAudio = audioOnly[0];

  const unsorted: MediaVariant[] = usable.map((format) => {
    const videoCodec = realCodec(format.vcodec);
    const ownAudioCodec = realCodec(format.acodec);
    const hasVideo = videoCodec !== undefined || typeof format.height === "number";
    // yt-dlp does not pair adaptive video-only and audio-only formats — that is
    // what `bestvideo+bestaudio` does at download time. We do it here so the
    // engine never produces a silent file.
    const pairedAudio = hasVideo && ownAudioCodec === undefined ? bestAudio : undefined;
    const audioCodec = ownAudioCodec ?? realCodec(pairedAudio?.acodec);

    const own = formatSizeOf(format, durationSec);
    const paired =
      pairedAudio === undefined
        ? { bytes: 0, isEstimate: false }
        : formatSizeOf(pairedAudio, durationSec);
    const filesizeBytes = own.bytes === undefined ? undefined : own.bytes + (paired.bytes ?? 0);
    const filesizeIsEstimate = own.isEstimate || paired.isEstimate;

    const bitrateBps =
      (bitrateOf(format) ?? 0) + (pairedAudio === undefined ? 0 : (bitrateOf(pairedAudio) ?? 0));

    return {
      id: format.format_id ?? format.url ?? "0",
      protocol: mapProtocol(format.protocol),
      url: format.url ?? "",
      hasVideo,
      hasAudio: audioCodec !== undefined,
      label: buildLabel({
        hasVideo,
        height: format.height,
        width: format.width,
        fps: format.fps,
        videoCodec,
        audioCodec,
        bitrateBps,
        filesizeBytes,
        filesizeIsEstimate,
        durationSec,
        fallback: format.format_note ?? format.format_id ?? "Stream",
      }),
      ...optional({
        audioUrl: pairedAudio?.url,
        container: format.container ?? format.ext,
        videoCodec,
        audioCodec,
        width: format.width,
        height: format.height,
        fps: format.fps,
        bitrateBps: bitrateBps > 0 ? bitrateBps : undefined,
        durationSec,
        filesizeBytes,
        filesizeIsEstimate: filesizeBytes === undefined ? undefined : filesizeIsEstimate,
        language: format.language,
      }),
    } satisfies MediaVariant;
  });

  const variants = unsorted.toSorted(compareVariantQuality);

  const headers: Record<string, string> = {
    ...info.http_headers,
    ...rawFormats.find((format) => format.http_headers !== undefined)?.http_headers,
  };
  if (options.locale !== undefined && options.locale !== "") {
    headers["Accept-Language"] = sanitiseHeaderValue(options.locale);
  }
  if (options.cookieHeader !== undefined && options.cookieHeader !== "") {
    headers["Cookie"] = sanitiseHeaderValue(options.cookieHeader);
  }
  const requestContext: RequestContext = {
    headers,
    ...optional({ proxyUrl: options.proxyUrl }),
  };

  return {
    sourceUrl: info.webpage_url ?? sourceUrl,
    resolver: resolverName,
    title: info.title ?? info.id ?? sourceUrl,
    variants,
    subtitles: [
      ...mapSubtitles(info.subtitles, false, "sub"),
      ...mapSubtitles(info.automatic_captions, true, "auto"),
    ],
    requestContext,
    drm,
    isLive,
    probedAt: new Date().toISOString(),
    ...optional({ durationSec, thumbnailUrl: info.thumbnail }),
  };
}

function describeDrm(info: YtDlpInfo, drmFormats: YtDlpFormat[], usable: YtDlpFormat[]): DrmInfo {
  const sawDrm = info.has_drm === true || drmFormats.length > 0;
  if (!sawDrm) return { protected: false, systems: [] };
  if (usable.length > 0) {
    // Some sites publish a DRM-free rendition alongside a protected one; the
    // free one is a real answer, so this is not a stop.
    return {
      protected: false,
      systems: [],
      evidence: `yt-dlp reported has_drm on ${drmFormats.length} of ${
        drmFormats.length + usable.length
      } formats`,
    };
  }
  // yt-dlp does not name the key system, only that EME is in play.
  return { protected: true, systems: ["unknown"], evidence: "yt-dlp reported has_drm" };
}

interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runProcess(
  binary: string,
  args: readonly string[],
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(binary, [...args], {
        // Never a shell: the URL and any operator-supplied cookie reach argv verbatim.
        shell: false,
        windowsHide: true,
        // A process group on POSIX is what makes a tree kill possible below.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      reject(new AppError("NO_MEDIA_FOUND", "yt-dlp could not be started.", { cause }));
      return;
    }

    const stdout: string[] = [];
    const stderr: string[] = [];
    let stdoutBytes = 0;
    let settled = false;

    const onAbort = (): void => {
      killTree(child);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      fn();
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        killTree(child);
        finish(() => {
          reject(
            new AppError("NO_MEDIA_FOUND", "yt-dlp produced an implausible amount of output."),
          );
        });
        return;
      }
      stdout.push(chunk);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      // Only the tail matters: yt-dlp puts the diagnosis on the last lines.
      if (stderr.length > 200) stderr.shift();
      stderr.push(chunk);
    });

    child.on("error", (cause) => {
      finish(() => {
        reject(new AppError("NO_MEDIA_FOUND", "yt-dlp could not be started.", { cause }));
      });
    });

    child.on("close", (code, signalName) => {
      finish(() => {
        if (signal.aborted) {
          reject(toAbortError(signal, "yt-dlp was stopped before it finished."));
          return;
        }
        resolve({
          code: code ?? (signalName === null ? 1 : 1),
          stdout: stdout.join(""),
          stderr: stderr.join(""),
        });
      });
    });

    if (signal.aborted) onAbort();
  });
}

/**
 * Kills the whole tree. yt-dlp spawns ffmpeg and helper processes; a bare
 * `child.kill()` leaves them running and holding the socket open.
 */
function killTree(child: ChildProcess): void {
  const { pid } = child;
  if (pid === undefined || child.killed) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => {
      child.kill("SIGKILL");
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Maps yt-dlp's stderr to the taxonomy. The default is `NO_MEDIA_FOUND` on
 * purpose: an extractor that broke overnight must degrade this source to the
 * browser sniffer, not fail the request.
 *
 * **A refused certificate is the one failure that does not take that default**,
 * and dl-34 is why. Degrading it hands the URL to the browser tier, which meets
 * the same private root with its own trust store and fails the same way — so
 * the fallthrough buys a browser launch and then reports "no downloadable video
 * stream was found on that page" for a trust-store problem. That sentence
 * points at the source, invites a retry, and hides the setting. Stopping the
 * chain here is a behaviour change on top of the copy: `registry.ts` falls
 * through on `NO_MEDIA_FOUND` and on nothing else.
 */
function classifyFailure(stderr: string, code: number, url: URL): AppError {
  const text = stderr.toLowerCase();
  const details = { url: url.href, exitCode: code, stderr: stderr.slice(-500) };

  // First, ahead of the four source-fact branches below, because a handshake
  // that failed means yt-dlp never read the page: no `drm`, `sign in`, `in your
  // country` or `429` in that stderr can be a fact about the source, and every
  // one of them is a looser match than this is.
  const certificateMarker = ytdlpCertificateMarker(text);
  if (certificateMarker !== undefined) {
    return new AppError("TLS_VERIFICATION_FAILED", undefined, {
      details: { ...details, reason: certificateMarker, hint: TIER_TRUST_STORE_HINT },
    });
  }

  if (text.includes("drm")) return new AppError("DRM_PROTECTED", undefined, { details });
  if (
    text.includes("sign in") ||
    text.includes("log in") ||
    text.includes("login required") ||
    text.includes("private video") ||
    text.includes("members-only") ||
    text.includes("subscribe to this channel")
  ) {
    return new AppError("AUTH_REQUIRED", undefined, { details });
  }
  if (
    text.includes("in your country") ||
    text.includes("in your location") ||
    text.includes("geo restricted") ||
    text.includes("geo-restricted") ||
    text.includes("not available from your")
  ) {
    return new AppError("GEO_BLOCKED", undefined, { details });
  }
  if (text.includes("http error 429") || text.includes("too many requests")) {
    return new AppError("RATE_LIMITED", undefined, { details });
  }
  return new AppError("NO_MEDIA_FOUND", undefined, { details });
}

/** Header values reach a network layer verbatim; CR/LF in them is request splitting. */
function sanitiseHeaderValue(value: string): string {
  return value.replaceAll(/[\r\n]+/g, " ").trim();
}

/**
 * Resolves an executable without a shell. `PATH` is searched by hand because
 * `spawn` with `shell: false` will not do it for us on Windows, and shelling out
 * to `which`/`where` is exactly what this project forbids.
 */
export function findExecutable(command: string): string | undefined {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? command : undefined;
  }
  const isWindows = process.platform === "win32";
  const entries = (process.env["PATH"] ?? "").split(isWindows ? ";" : ":");
  const extensions = isWindows
    ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const entry of entries) {
    if (entry === "") continue;
    for (const extension of extensions) {
      const candidate = join(entry.replaceAll('"', ""), command + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
