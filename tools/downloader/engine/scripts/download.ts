/**
 * Engine CLI — milestone M1.
 *
 * ```
 * npx tsx packages/engine/scripts/download.ts <media-url> [options]
 * ```
 *
 * Takes a manifest or media URL plus the headers a probe captured, and streams
 * it through the engine into a local file — the engine itself writes nothing
 * (dl-53); this script is the reader, standing where a visitor's browser
 * stands. The whole engine exercised end to end without the API in front of it.
 *
 * Writes to stderr directly rather than through `console` — the repo bans
 * `console`, and a CLI's progress belongs on stderr anyway so stdout can carry
 * the one thing a caller might want to pipe: the resulting path.
 */

import { createWriteStream } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import type {
  JobProgress,
  MediaVariant,
  RequestContext,
  StreamProtocol,
} from "@downloader/contract";
import { AppError } from "@downloader/contract";
import { createEngine } from "../src/index.ts";
import type { Logger } from "../src/logger.ts";

const USAGE = `
Usage: npx tsx packages/engine/scripts/download.ts <media-url> [options]

  --out <file>           Where to write the stream (default: ./<title>.<ext>)
  --job <id>             Job id, for the log lines
  --title <text>         Output filename stem (default: "video")
  --protocol <p>         hls | dash | progressive | other (default: guessed)
  --container <c>        mp4 | mkv | webm (default: mp4)
  --audio-url <url>      Separate audio rendition to mux in
  --header "N: v"        Header to replay; repeatable
  --referer <url>        Shorthand for --header "Referer: <url>"
  --user-agent <ua>      Shorthand for --header "User-Agent: <ua>"
  --duration <seconds>   Capture limit; required for a live source
  --live                 Treat the source as live
  --audio-only           Discard video
  --max-mb <n>           Per-job size cap (default: 4096)
  --no-video             The variant carries no video track
  --no-audio             The variant carries no audio track
  --verbose              Log engine debug output
  -h, --help
`.trimStart();

interface ParsedArgs {
  url: string;
  values: Map<string, string[]>;
  flags: Set<string>;
}

const VALUE_OPTIONS = new Set([
  "out",
  "job",
  "title",
  "protocol",
  "container",
  "audio-url",
  "header",
  "referer",
  "user-agent",
  "duration",
  "max-mb",
]);

function parseArgs(argv: readonly string[]): ParsedArgs {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  let url = "";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith("--")) {
      if (url.length === 0) url = token;
      continue;
    }
    const name = token.slice(2);
    if (VALUE_OPTIONS.has(name)) {
      const value = argv[index + 1];
      if (value === undefined) throw new AppError("INVALID_URL", `--${name} needs a value.`);
      const list = values.get(name) ?? [];
      list.push(value);
      values.set(name, list);
      index += 1;
    } else {
      flags.add(name);
    }
  }

  return { url, values, flags };
}

function guessProtocol(url: string): StreamProtocol {
  if (/\.m3u8(\?|#|$)/iu.test(url)) return "hls";
  if (/\.mpd(\?|#|$)/iu.test(url)) return "dash";
  return "progressive";
}

function buildRequestContext(parsed: ParsedArgs): RequestContext {
  const headers: Record<string, string> = {};
  for (const raw of parsed.values.get("header") ?? []) {
    const colonAt = raw.indexOf(":");
    if (colonAt <= 0) throw new AppError("INVALID_URL", `Malformed --header: ${raw}`);
    headers[raw.slice(0, colonAt).trim()] = raw.slice(colonAt + 1).trim();
  }
  const referer = parsed.values.get("referer")?.[0];
  if (referer !== undefined) headers["Referer"] = referer;
  const userAgent = parsed.values.get("user-agent")?.[0];
  if (userAgent !== undefined) headers["User-Agent"] = userAgent;
  return { headers };
}

function renderProgress(progress: JobProgress): string {
  const percent =
    progress.percent === null ? "  --%" : `${progress.percent.toFixed(1).padStart(5)}%`;
  const megabytes = (progress.downloadedBytes / 1024 / 1024).toFixed(1);
  const speed =
    progress.speedBps === null ? "" : ` · ${(progress.speedBps / 1024 / 1024).toFixed(2)} MB/s`;
  const eta = progress.etaSec === null ? "" : ` · eta ${Math.round(progress.etaSec)}s`;
  return `[${progress.stage}] ${percent} · ${megabytes} MB${speed}${eta}`;
}

function makeLogger(verbose: boolean): Logger {
  const write = (level: string, message: string, fields?: Record<string, unknown>): void => {
    if (!verbose && level === "debug") return;
    const suffix = fields === undefined ? "" : ` ${JSON.stringify(fields)}`;
    process.stderr.write(`  ${level}: ${message}${suffix}\n`);
  };
  return {
    debug: (message, fields) => {
      write("debug", message, fields);
    },
    info: (message, fields) => {
      write("info", message, fields);
    },
    warn: (message, fields) => {
      write("warn", message, fields);
    },
    error: (message, fields) => {
      write("error", message, fields);
    },
  };
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.flags.has("help") || parsed.url.length === 0 || process.argv.includes("-h")) {
    process.stderr.write(USAGE);
    return parsed.url.length === 0 ? 1 : 0;
  }

  const first = (name: string): string | undefined => parsed.values.get(name)?.[0];
  const protocol = (first("protocol") as StreamProtocol | undefined) ?? guessProtocol(parsed.url);
  const durationRaw = first("duration");
  const durationSec = durationRaw === undefined ? null : Number(durationRaw);
  const maxMb = Number(first("max-mb") ?? 4096);

  const variant: MediaVariant = {
    id: "cli",
    protocol,
    url: parsed.url,
    ...(first("audio-url") === undefined ? {} : { audioUrl: first("audio-url") as string }),
    hasVideo: !parsed.flags.has("no-video") && !parsed.flags.has("audio-only"),
    hasAudio: !parsed.flags.has("no-audio"),
    label: "cli",
  };

  const engine = createEngine({
    maxFileSizeBytes: maxMb * 1024 * 1024,
    logger: makeLogger(parsed.flags.has("verbose")),
  });

  const controller = new AbortController();
  const onSignal = (): void => {
    process.stderr.write("\ninterrupted; killing the ffmpeg process tree...\n");
    controller.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let lastLine = "";
  const started = Date.now();

  try {
    const media = await engine.stream({
      jobId: first("job") ?? `cli-${Date.now().toString(36)}`,
      variant,
      requestContext: buildRequestContext(parsed),
      title: first("title") ?? "video",
      durationSec,
      isLive: parsed.flags.has("live"),
      options: {
        ...(first("container") === undefined
          ? {}
          : { container: first("container") as "mp4" | "mkv" | "webm" }),
        audioOnly: parsed.flags.has("audio-only"),
        ...(durationSec === null || !parsed.flags.has("live")
          ? {}
          : { liveDurationSec: durationSec }),
      },
      signal: controller.signal,
      onProgress: (progress) => {
        const line = renderProgress(progress);
        if (line === lastLine) return;
        lastLine = line;
        process.stderr.write(`\r${line.padEnd(72)}`);
      },
    });

    const target = path.resolve(first("out") ?? media.filename);
    await pipeline(media.body, createWriteStream(target));
    const outcome = await media.done;

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    process.stderr.write(
      `\n\ndone in ${elapsed}s — ${(outcome.bytes / 1024 / 1024).toFixed(1)} MB, ` +
        `${outcome.durationSec === null ? "unknown" : outcome.durationSec.toFixed(1)}s of media\n`,
    );
    // stdout carries the path and nothing else, so it can be piped.
    process.stdout.write(`${target}\n`);
    return 0;
  } catch (error: unknown) {
    const appError = AppError.from(error);
    process.stderr.write(`\n\nfailed: ${appError.code} — ${appError.message}\n`);
    if (appError.details !== undefined) {
      process.stderr.write(`${JSON.stringify(appError.details, null, 2)}\n`);
    }
    return 1;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

process.exitCode = await main();
