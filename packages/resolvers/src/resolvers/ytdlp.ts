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
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "@downloader/shared";
import type {
  DrmInfo,
  MediaVariant,
  ProbeResult,
  RequestContext,
  Resolver,
  ResolveOptions,
  StreamProtocol,
  SubtitleTrack,
} from "@downloader/shared";
import { toAbortError } from "../abort.ts";
import { buildLabel, compareVariantQuality, optional, subtitleFormat } from "../common.ts";

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
}

export class YtDlpResolver implements Resolver {
  readonly name = "yt-dlp";
  readonly priority = 20;

  readonly #binaryArgs: readonly string[];
  /** Resolved once at construction — `canHandle` runs on every request and must not do I/O. */
  readonly #binaryPath: string | undefined;
  readonly #enabled: boolean;

  constructor(options: YtDlpResolverOptions = {}) {
    const env = options.env ?? process.env;
    this.#enabled = options.enabled ?? env["ENABLE_YTDLP_RESOLVER"] !== "false";
    this.#binaryArgs = options.binaryArgs ?? [];
    const requested = options.binaryPath ?? env["YTDLP_PATH"] ?? "yt-dlp";
    this.#binaryPath = this.#enabled ? findExecutable(requested) : undefined;
  }

  /** True only when the binary really exists; absence is a fallthrough, never an error. */
  get available(): boolean {
    return this.#binaryPath !== undefined;
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
    return probe;
  }
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
 */
function classifyFailure(stderr: string, code: number, url: URL): AppError {
  const text = stderr.toLowerCase();
  const details = { url: url.href, exitCode: code, stderr: stderr.slice(-500) };

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
