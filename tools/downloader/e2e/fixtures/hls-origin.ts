/**
 * A local origin serving a genuine HLS stream.
 *
 * "Genuine" matters. A hand-written playlist pointing at fake segments would
 * exercise the plumbing and prove nothing about the thing the product does:
 * ffmpeg has to actually pull the segments, and the result has to actually be
 * a playable file. So the clip is generated with the same ffmpeg the engine
 * uses, segmented into real `.ts` files with a real master playlist.
 *
 * The same server also serves `/watch`, an MSE player page over the same
 * stream. That is the sniffer suite's entry point: the `<video>` element there
 * carries a `blob:` URL and the page's markup never spells the manifest's
 * path, so the only way to the stream is to watch the network. See
 * `e2e/sniffer/mse-page.spec.ts` and dl-16.
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
  /** The MSE player page. Nothing in its markup names `masterUrl`. */
  watchUrl: string;
  /** Every request the download made, for asserting the segments were fetched. */
  requests: string[];
  close(): Promise<void>;
}

/** What the player asks for, in order. The master first, so it outranks the media playlist. */
const PLAYER_PATHS: readonly string[] = ["/master.m3u8", "/index.m3u8", "/seg000.ts"];

const WATCH_PATH = "/watch";

/**
 * The MSE player page, and the reason the sniffer suite can claim anything.
 *
 * Two properties have to hold together, and each one alone would prove nothing:
 *
 *  - `<video>.src` is a `blob:` URL, so the DOM carries no media address. The
 *    page writes the scheme into `document.title`, which the probe reads and
 *    the UI renders — so "it really was a blob" is assertable from outside.
 *  - the manifest's path appears nowhere in the markup. It is base64 here and
 *    decoded at run time, which is not obfuscation for its own sake: a fixture
 *    that spelled `/master.m3u8` in a script tag could still be solved by
 *    reading the HTML, and then this suite would pass for the wrong reason.
 *
 * Modelled on `resolvers/test/fixtures/pages/mse.html`, which is the same idea
 * against static fixture segments; this one has to point at a stream ffmpeg
 * generated on an ephemeral port, so it is built here rather than copied.
 */
function watchPage(): string {
  const encoded = PLAYER_PATHS.map((value) => Buffer.from(value, "utf8").toString("base64"));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture player</title>
  </head>
  <body>
    <h1>Fixture player</h1>
    <video id="v" width="640" height="360" muted playsinline controls></video>
    <p id="status">idle</p>
    <script>
      (function () {
        var PATHS = ${JSON.stringify(encoded)}.map(function (value) {
          return atob(value);
        });
        var video = document.getElementById("v");
        var status = document.getElementById("status");
        var mediaSource = new MediaSource();
        var fetching = false;

        function announceSource() {
          var scheme = String(video.src || "none").split(":")[0];
          document.title = "Fixture player [" + scheme + "]";
          status.textContent = "video.src scheme: " + scheme;
        }

        function loadEverything() {
          if (fetching) return;
          fetching = true;
          // Strictly sequential: the master has to cross the network before the
          // media playlist it names, or the sniffer's "earlier wins" tiebreak
          // between two equally-scored playlists is being decided by a race.
          fetch(PATHS[0])
            .then(function (response) {
              return response.text();
            })
            .then(function () {
              return fetch(PATHS[1]);
            })
            .then(function (response) {
              return response.text();
            })
            .then(function () {
              return fetch(PATHS[2]);
            })
            .then(function (response) {
              return response.arrayBuffer();
            })
            .then(function (buffer) {
              status.textContent += " · segments fetched";
              try {
                var sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42c01e"');
                sourceBuffer.appendBuffer(buffer);
              } catch (error) {
                // MPEG-TS is not an MSE format. Appending is not the point; the
                // requests crossing the network are.
              }
            })
            .catch(function () {});
        }

        mediaSource.addEventListener("sourceopen", function () {
          announceSource();
          loadEverything();
        });
        video.addEventListener("play", loadEverything);
        video.src = URL.createObjectURL(mediaSource);
        announceSource();
      })();
    </script>
  </body>
</html>
`;
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
  const html = watchPage();
  const server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    requests.push(url);

    if (new URL(url, "http://x").pathname === WATCH_PATH) {
      const body = Buffer.from(html, "utf8");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(body.length),
      });
      response.end(body);
      return;
    }

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
    watchUrl: `${origin}${WATCH_PATH}`,
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
