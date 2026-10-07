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
 * Progress comes from `-progress pipe:3`, a descriptor of its own, because
 * stdout is the media itself (`streamFfmpeg`, dl-53); stderr is kept as a
 * bounded tail so a failure carries evidence without unbounded memory or a log
 * flood.
 *
 * **Everything downstream of stderr sees what `-loglevel warning` wrote.**
 * `GLOBAL_ARGS` asks for `level+info` so the input's `Duration:` line arrives
 * (dl-96), and `StderrLevels` takes it back out: an `[info]` message goes to
 * `onInfoLine` and nowhere else, and a `[warning]` or `[error]` one loses its
 * tag. Every pattern read off stderr here was measured at `warning`, and an
 * info message carries the source's own metadata — a title is somebody else's
 * text, and must not be able to read as a rejected certificate.
 */

import { spawn } from "node:child_process";
import process from "node:process";
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import { AppError, redactUrl } from "@downloader/contract";
import type { Logger } from "../logger.ts";
import { NOOP_LOGGER } from "../logger.ts";
import { IS_WINDOWS, killProcessTree } from "./kill.ts";
import type { FfmpegProgressSnapshot } from "./progress.ts";
import { FfmpegProgressParser } from "./progress.ts";

/**
 * What a non-zero exit is reported as. Only one since dl-53: every ffmpeg run
 * fetches its own input, so any failure it has is a failure to download.
 */
export type FfmpegFailureCode = "DOWNLOAD_FAILED";

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
  /** A warning or worse, with ffmpeg's level tag removed. */
  onStderrLine?: ((line: string) => void) | undefined;
  /** An info message, which nothing else is shown: see `StderrLevels`. */
  onInfoLine?: ((line: string) => void) | undefined;
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
 *
 * Case-insensitive (dl-58, D3): also reused by `api/src/logger.ts` for every
 * logged string, and a caller there need not have lower-cased its URL first.
 * `new URL()` already normalises an upper-case scheme; this only widens which
 * substring the matcher recognises. A scheme-less `//host/path` still is not
 * matched — no known caller produces one, and closing that is undecided.
 */
export function redactUrlsInText(text: string): string {
  return text.replaceAll(/https?:\/\/\S+/giu, (match) => redactUrl(match));
}

function tail(text: string, maxBytes: number): string {
  return text.length <= maxBytes ? text : text.slice(text.length - maxBytes);
}

/**
 * The tag ffmpeg's `level` log flag writes, after the `[component @ address] `
 * prefix when there is one. Measured on 2026-10-07 on both builds this repo
 * runs, 6.1.1 and `ffmpeg-static`'s 7.0.2:
 * `[http @ 0x5569fb8a5540] [warning] HTTP error 404 Not Found`.
 */
const LEVEL_TAG = /^((?:\[[^\]]*\] )?)\[(trace|debug|verbose|info|warning|error|fatal|panic)\] /u;
const BELOW_WARNING: ReadonlySet<string> = new Set(["trace", "debug", "verbose", "info"]);

/**
 * Sorts one ffmpeg stderr line by its level, and strips the tag.
 *
 * **A line with no tag continues the message above it** and takes that
 * message's level: ffmpeg tags a message where it starts, so a metadata value
 * holding a newline arrives as an `[info]` line followed by an untagged one,
 * and the second is the source's text as much as the first. Before any tag has
 * been seen — a stand-in binary, or a build that ignores the flag — a line is
 * passed through, which is what every line was before dl-96.
 */
export class StderrLevels {
  #level: string | null = null;

  read(line: string): { info: boolean; text: string } {
    const match = LEVEL_TAG.exec(line);
    if (match === null) {
      return { info: this.#level !== null && BELOW_WARNING.has(this.#level), text: line };
    }
    const level = match[2] as string;
    this.#level = level;
    return {
      info: BELOW_WARNING.has(level),
      text: `${match[1] ?? ""}${line.slice(match[0].length)}`,
    };
  }
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
 *
 * Since dl-27 it also has to catch a sentence ffmpeg did not write: the egress
 * proxy verifies each origin itself and refuses a bad one with
 * `502 TLS certificate verification failed (<code>)`, which ffmpeg echoes as
 * `[httpproxy] HTTP error 502 …`. That is the **only** channel for a refused
 * *segment* origin — dl-21 measured that nothing else about the certificate
 * reaches ffmpeg — and it is why `GLOBAL_ARGS` asks for `-loglevel warning`.
 * Both halves match it as written, which is not an accident.
 */
const CERTIFICATE_MENTIONED = /certificate/iu;
const VERIFICATION_FAILED =
  /verif|not trusted|untrusted|self[- ]signed|has expired|does not match hostname|unable to get/iu;

/** Exported for tests: does this stderr tail describe a rejected certificate? */
export function isTlsVerificationFailure(stderr: string): boolean {
  return CERTIFICATE_MENTIONED.test(stderr) && VERIFICATION_FAILED.test(stderr);
}

/**
 * A running ffmpeg whose **output is its stdout** (dl-53).
 *
 * `stdout` carries the media and nothing else, so the caller's args must send
 * `-progress` somewhere other than `pipe:1` — `STREAM_PROGRESS_ARGS` puts it on
 * descriptor 3, which this opens. Backpressure is the pipe's own: a reader that
 * stops reading fills the pipe, ffmpeg blocks on its write, and stops reading
 * its input — measured on 2026-09-27 at a flat ~59 MB of ffmpeg RSS whether the
 * reader drained 70 MB at full speed or at 1 MB/s (dl-53's Log).
 */
export interface FfmpegStream {
  stdout: Readable;
  /**
   * Settles once ffmpeg has exited and stdout has been drained. Rejects with
   * `AppError`: `JOB_CANCELED` on abort, `TIMEOUT` past `timeoutMs`,
   * `SIZE_LIMIT_EXCEEDED` past `maxOutputBytes`, `INTERNAL` when the binary is
   * missing, `TLS_VERIFICATION_FAILED` when any stderr line says a certificate
   * was rejected, and `DOWNLOAD_FAILED` on any other non-zero exit.
   */
  completion: Promise<FfmpegRunResult>;
  /** Kills the process tree and rejects `completion` with `error`. Idempotent. */
  terminate(error: AppError): void;
}

export function streamFfmpeg(options: FfmpegRunOptions): FfmpegStream {
  const launched = launch(options);
  if (launched.stdout === null) {
    // Unreachable: `launch` only returns without stdout when it rejected
    // before spawning, and then `completion` already carries the reason.
    const stdout = new PassThrough();
    stdout.end();
    return { stdout, completion: launched.completion, terminate: launched.terminate };
  }
  return {
    stdout: launched.stdout,
    completion: launched.completion,
    terminate: launched.terminate,
  };
}

interface Launched {
  completion: Promise<FfmpegRunResult>;
  stdout: Readable | null;
  terminate(error: AppError): void;
}

function launch(options: FfmpegRunOptions): Launched {
  const logger = options.logger ?? NOOP_LOGGER;
  const failureCode: FfmpegFailureCode = options.failureCode ?? "DOWNLOAD_FAILED";
  const stderrTailBytes = options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES;
  let stdout: Readable | null = null;
  // Null only when the signal had already fired: nothing was spawned to kill.
  let terminateRef: ((error: AppError) => void) | null = null;

  const completion = new Promise<FfmpegRunResult>((resolve, reject) => {
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
      // A fourth descriptor, because stdout is the media: see `FfmpegStream`.
      stdio: ["ignore", "pipe", "pipe", "pipe"],
      env,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    });
    const progressSource = child.stdio[3] as Readable | null;
    stdout = child.stdout;

    const parser = new FfmpegProgressParser();
    let stderrBuffer = "";
    let stderrLineBuffer = "";
    const levels = new StderrLevels();
    let sawCertificateRejection = false;
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
    terminateRef = terminate;

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

    progressSource?.setEncoding("utf8");
    progressSource?.on("data", (chunk: string) => {
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

    const readStderrLine = (raw: string): void => {
      if (raw.length === 0) return;
      const { info, text } = levels.read(raw);
      if (info) {
        options.onInfoLine?.(redactUrlsInText(text));
        return;
      }
      stderrBuffer = tail(`${stderrBuffer}${text}\n`, stderrTailBytes);
      // Sticky, and read off the whole stream rather than off the tail: a
      // playlist whose every segment is refused logs three lines per segment,
      // so on a stream of any length the certificate lines scroll out of the
      // 4 KB tail long before ffmpeg exits and the run is filed as a plain
      // download failure. dl-19's tail check stays below as well — it can
      // still match across two lines, which this cannot.
      if (!sawCertificateRejection) sawCertificateRejection = isTlsVerificationFailure(text);
      options.onStderrLine?.(redactUrlsInText(text));
    };

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrLineBuffer += chunk;
      let newlineAt = stderrLineBuffer.indexOf("\n");
      while (newlineAt !== -1) {
        const line = stderrLineBuffer.slice(0, newlineAt).trimEnd();
        stderrLineBuffer = stderrLineBuffer.slice(newlineAt + 1);
        newlineAt = stderrLineBuffer.indexOf("\n");
        readStderrLine(line);
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
      // A last line with no newline: a killed ffmpeg's final words often are.
      readStderrLine(stderrLineBuffer.trimEnd());
      stderrLineBuffer = "";
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
        const code =
          sawCertificateRejection || isTlsVerificationFailure(stderrTail)
            ? "TLS_VERIFICATION_FAILED"
            : failureCode;
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

  return { completion, stdout, terminate: (error) => terminateRef?.(error) };
}
