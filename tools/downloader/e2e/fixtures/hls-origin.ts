/**
 * A local origin serving a genuine HLS stream.
 *
 * "Genuine" matters. A hand-written playlist pointing at fake segments would
 * exercise the plumbing and prove nothing about the thing the product does:
 * ffmpeg has to actually pull the segments, and the result has to actually be
 * a playable file. So the clip is generated with the same ffmpeg the engine
 * uses, segmented into real `.ts` files with a real master playlist.
 *
 * Nothing here touches a third-party site. Real sites change, rate-limit and
 * geo-vary, which makes a CI failure against one meaningless.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { resolveFfmpegPath } from "@downloader/engine";

/** Short enough that a CI run is not waiting on it, long enough to have segments. */
export const CLIP_SECONDS = 6;

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

export interface HlsOrigin {
  /** `http://127.0.0.1:<port>` — the SSRF guard must be told to allow it. */
  origin: string;
  masterUrl: string;
  /** Every request the download made, for asserting the segments were fetched. */
  requests: string[];
  close(): Promise<void>;
}

function runFfmpeg(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Argument array, `shell: false` — the repo-wide rule, and this file is
    // scanned by `spawn-safety.test.ts` along with everything else.
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${String(code)}: ${stderr.slice(-2000)}`));
    });
  });
}

async function generate(dir: string): Promise<void> {
  const ffmpeg = resolveFfmpegPath();
  await runFfmpeg(ffmpeg, [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=320x240:rate=15:duration=${String(CLIP_SECONDS)}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=44100:duration=${String(CLIP_SECONDS)}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "15",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(dir, "seg%03d.ts"),
    path.join(dir, "index.m3u8"),
  ]);

  // Two renditions pointing at the same media playlist. One variant would let
  // a UI that ignores the selection pass, which is half of what the variant
  // table exists to do.
  await fs.writeFile(
    path.join(dir, "master.m3u8"),
    [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x480,CODECS="avc1.42c01e,mp4a.40.2"',
      "index.m3u8",
      '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=320x240,CODECS="avc1.42c01e,mp4a.40.2"',
      "index.m3u8",
      "",
    ].join("\n"),
    "utf8",
  );
}

export async function startHlsOrigin(): Promise<HlsOrigin> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-e2e-hls-"));
  await generate(dir);

  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    requests.push(url);

    void (async () => {
      // `path.basename` on the parsed pathname: the directory is a temp dir
      // full of nothing, but a fixture that could be walked out of would be a
      // bad habit to check in.
      const name = path.basename(new URL(url, "http://x").pathname);
      try {
        const body = await fs.readFile(path.join(dir, name));
        response.writeHead(200, {
          "content-type": CONTENT_TYPES[path.extname(name)] ?? "application/octet-stream",
          "content-length": String(body.length),
        });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${String(port)}`;

  return {
    origin,
    masterUrl: `${origin}/master.m3u8`,
    requests,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
