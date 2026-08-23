/**
 * Spawning ffmpeg.
 *
 * Two invariants live here and nowhere else:
 *
 *  - **No shell, ever.** Source URLs and titles reach this argv. `shell: false`
 *    is explicit rather than relied upon as the default, so the property is
 *    greppable and testable.
 *  - **Process-tree kill on abort.** See `kill.ts` for why a bare `child.kill()`
 *    is not enough.
 *
 * Progress comes from `-progress pipe:1` on stdout; stderr is kept as a bounded
 * tail so a failure carries evidence without unbounded memory or a log flood.
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { AppError, redactUrl } from "@downloader/contract";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import { IS_WINDOWS, killProcessTree } from "./kill.ts";
import type { FfmpegProgressSnapshot } from "./progress.ts";
import { FfmpegProgressParser } from "./progress.ts";

/** Which failure a non-zero exit means depends on what ffmpeg was doing. */
export type FfmpegFailureCode = "MUX_FAILED" | "DOWNLOAD_FAILED";

export interface FfmpegRunOptions {
  ffmpegPath: string;
  /** Complete argv after the binary. Never joined into a string. */
  args: readonly string[];
  signal?: AbortSignal | undefined;
  /** Hard ceiling on the invocation. Exceeding it is `TIMEOUT`, not a failure. */
  timeoutMs?: number | undefined;
  cwd?: string | undefined;
  /** Exported to ffmpeg as `http_proxy`/`https_proxy`; its http protocol honours both. */
  proxyUrl?: string | undefined;
  onProgress?: ((snapshot: FfmpegProgressSnapshot) => void) | undefined;
  onStderrLine?: ((line: string) => void) | undefined;
  /**
   * Abort with `SIZE_LIMIT_EXCEEDED` once the output passes this. The pre-flight
   * estimate in `estimate.ts` catches the common case; this catches the one
   * where the bitrate was unknown or lied about.
   */
  maxOutputBytes?: number | undefined;
  failureCode?: FfmpegFailureCode | undefined;
  stderrTailBytes?: number | undefined;
  logger?: Logger | undefined;
}

export interface FfmpegRunResult {
  exitCode: number;
  /** Tail of stderr, query strings stripped. */
  stderrTail: string;
  lastSnapshot: FfmpegProgressSnapshot | null;
}

const DEFAULT_STDERR_TAIL_BYTES = 4096;

/**
 * ffmpeg echoes input URLs in its diagnostics, and a signed URL's query string
 * is a credential. Keep the shape, drop the secret.
 */
export function redactUrlsInText(text: string): string {
  return text.replaceAll(/https?:\/\/\S+/gu, (match) => redactUrl(match));
}

function tail(text: string, maxBytes: number): string {
  return text.length <= maxBytes ? text : text.slice(text.length - maxBytes);
}

/**
 * What a rejected certificate looks like on ffmpeg's stderr.
 *
 * There is no exit code for it — libavformat turns every TLS failure into
 * `Input/output error` — so the text is the only signal, and without reading it
 * a MITM in front of a CDN arrives as `DOWNLOAD_FAILED`, indistinguishable from
 * a dead link. That is the ambiguity dl-11 wrote up, in the place it matters
 * most.
 *
 * Matched as two halves rather than as a list of sentences, because **the
 * sentence belongs to whichever TLS backend ffmpeg was built against** and this
 * repo already runs two ffmpeg builds on three platforms. dl-19 measured what
 * gnutls says — `Peer certificate failed verification` and `The certificate's
 * owner does not match hostname <host>`, from both the distribution build and
 * `ffmpeg-static` — and the second half covers the wordings OpenSSL, SChannel
 * and SecureTransport use for the same conditions, which were not measured. A
 * build nobody measured must not fall through to "the download failed".
 */
const CERTIFICATE_MENTIONED = /certificate/iu;
const VERIFICATION_FAILED =
  /verif|not trusted|untrusted|self[- ]signed|has expired|does not match hostname|unable to get/iu;

/** Exported for tests: does this stderr tail describe a rejected certificate? */
export function isTlsVerificationFailure(stderr: string): boolean {
  return CERTIFICATE_MENTIONED.test(stderr) && VERIFICATION_FAILED.test(stderr);
}

/**
 * Runs ffmpeg to completion.
 *
 * Rejects with `AppError`: `JOB_CANCELED` on abort, `TIMEOUT` past
 * `timeoutMs`, `SIZE_LIMIT_EXCEEDED` past `maxOutputBytes`, `INTERNAL` when the
 * binary is missing, `TLS_VERIFICATION_FAILED` when the stderr tail says a
 * certificate was rejected, and `failureCode` (default `MUX_FAILED`) on any
 * other non-zero exit.
 */
export function runFfmpeg(options: FfmpegRunOptions): Promise<FfmpegRunResult> {
  const logger = options.logger ?? NOOP_LOGGER;
  const failureCode: FfmpegFailureCode = options.failureCode ?? "MUX_FAILED";
  const stderrTailBytes = options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES;

  return new Promise<FfmpegRunResult>((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new AppError("JOB_CANCELED"));
      return;
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.proxyUrl !== undefined && options.proxyUrl.length > 0) {
      env["http_proxy"] = options.proxyUrl;
      env["https_proxy"] = options.proxyUrl;
    }

    const child = spawn(options.ffmpegPath, [...options.args], {
      shell: false,
      windowsHide: true,
      // POSIX process groups only exist if we ask for one; see kill.ts.
      detached: !IS_WINDOWS,
      stdio: ["ignore", "pipe", "pipe"],
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });

    const parser = new FfmpegProgressParser();
    let stderrBuffer = "";
    let stderrLineBuffer = "";
    let lastSnapshot: FfmpegProgressSnapshot | null = null;
    let settled = false;
    let terminationError: AppError | null = null;
    let timer: NodeJS.Timeout | undefined;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    // Best effort: if the kill fails the `close` handler still settles the
    // promise, and a stuck ffmpeg is bounded by the stage timeout above it.
    const killQuietly = async (targetPid: number): Promise<void> => {
      try {
        await killProcessTree(targetPid, { logger });
      } catch {
        logger.warn("could not kill the ffmpeg process tree", { pid: targetPid });
      }
    };

    const terminate = (error: AppError): void => {
      if (terminationError !== null || settled) return;
      terminationError = error;
      const pid = child.pid;
      if (pid === undefined) {
        finish(() => reject(error));
        return;
      }
      void killQuietly(pid);
    };

    function onAbort(): void {
      terminate(new AppError("JOB_CANCELED"));
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        terminate(
          new AppError("TIMEOUT", undefined, {
            details: { stage: "ffmpeg", timeoutMs: options.timeoutMs },
          }),
        );
      }, options.timeoutMs);
      timer.unref?.();
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const snapshot of parser.push(chunk)) {
        lastSnapshot = snapshot;
        if (
          options.maxOutputBytes !== undefined &&
          snapshot.totalSize !== null &&
          snapshot.totalSize > options.maxOutputBytes
        ) {
          terminate(
            new AppError("SIZE_LIMIT_EXCEEDED", undefined, {
              details: { writtenBytes: snapshot.totalSize, limitBytes: options.maxOutputBytes },
            }),
          );
          return;
        }
        options.onProgress?.(snapshot);
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer = tail(stderrBuffer + chunk, stderrTailBytes);
      if (options.onStderrLine === undefined) return;
      stderrLineBuffer += chunk;
      let newlineAt = stderrLineBuffer.indexOf("\n");
      while (newlineAt !== -1) {
        const line = stderrLineBuffer.slice(0, newlineAt).trimEnd();
        stderrLineBuffer = stderrLineBuffer.slice(newlineAt + 1);
        newlineAt = stderrLineBuffer.indexOf("\n");
        if (line.length > 0) options.onStderrLine(redactUrlsInText(line));
      }
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      const code =
        error.code === "ENOENT"
          ? new AppError("INTERNAL", "The ffmpeg binary could not be started.", {
              cause: error,
              details: { ffmpegPath: options.ffmpegPath, errno: error.code },
            })
          : new AppError("INTERNAL", "ffmpeg failed to start.", { cause: error });
      finish(() => reject(code));
    });

    child.once("close", (exitCode, signalName) => {
      const flushed = parser.flush();
      if (flushed !== null) lastSnapshot = flushed;
      const stderrTail = redactUrlsInText(stderrBuffer).trim();

      finish(() => {
        if (terminationError !== null) {
          reject(terminationError);
          return;
        }
        if (exitCode === 0) {
          resolve({ exitCode: 0, stderrTail, lastSnapshot });
          return;
        }
        const code = isTlsVerificationFailure(stderrTail) ? "TLS_VERIFICATION_FAILED" : failureCode;
        reject(
          new AppError(code, undefined, {
            details: {
              exitCode,
              ...(signalName === null ? {} : { signal: signalName }),
              stderr: stderrTail,
            },
          }),
        );
      });
    });
  });
}
