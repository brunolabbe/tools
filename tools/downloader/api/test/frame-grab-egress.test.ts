/**
 * dl-56: the preview-frame grab goes out through the **ffmpeg egress proxy**.
 *
 * This is the trap the ticket names first. The probe's SSRF sweep vets the
 * manifest URL, and nothing else: the segments, the init segment and the key
 * are URLs the manifest names, which only ffmpeg ever reads. A grab spawned
 * with no `proxyUrl` passes every test that does not look, and fetches a
 * segment from any address a hostile manifest cares to name — dl-11's hole.
 *
 * Two halves, because each alone proves less than it looks:
 *
 * - **What ffmpeg is handed**, from the real `createApp` wiring, recorded by a
 *   stand-in binary: `http_proxy` is `context.ffmpegProxyUrl` — which, with
 *   `FFMPEG_TLS_INTERCEPT` on, is *not* the tiers' proxy — and `-ca_file` is
 *   the root that proxy issues under. A grab on `tierProxy` would pass the
 *   second half below and fail this one.
 * - **What that stops**, with a real ffmpeg: a manifest on an allowed address
 *   whose segments sit on a blocked one produces no preview and **no request at
 *   the blocked address**, while the same stream with its segments on the
 *   allowed address produces a frame. The positive control is what makes the
 *   negative mean "refused" rather than "broken".
 *
 * Everything is loopback. The blocked host is `localhost`: it resolves to the
 * same socket as the allowed `127.0.0.1`, so the only thing that differs between
 * the two manifests is whether the guard lets the name through.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { ROUTES } from "@downloader/contract";
import type { ProbeResponse, ProbeResult } from "@downloader/contract";
import { resolveFfmpegPath } from "@downloader/engine";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { probeResult, StubResolver, variant } from "./helpers.ts";

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

const CLIP_SECONDS = 4;

describe.skipIf(process.platform === "win32")("what the grab hands ffmpeg", () => {
  let root: string;
  let app: App;
  let recordPath: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-grab-wiring-"));
    recordPath = path.join(root, "record.json");
    // A stand-in that writes down its environment and argv, then fails the way
    // a refused stream would. The shebang is this node, not `env node`, so PATH
    // has no say in what runs.
    const fake = path.join(root, "fake-ffmpeg.mjs");
    await fs.writeFile(
      fake,
      [
        `#!${process.execPath}`,
        `import fs from "node:fs";`,
        `fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({`,
        `  argv: process.argv.slice(2),`,
        `  httpProxy: process.env.http_proxy ?? null,`,
        `  httpsProxy: process.env.https_proxy ?? null,`,
        `}));`,
        `process.exit(1);`,
        "",
      ].join("\n"),
    );
    await fs.chmod(fake, 0o755);

    app = await createApp({
      startGc: false,
      logger: NOOP_LOGGER,
      config: {
        databasePath: ":memory:",
        storageDir: path.join(root, "storage"),
        ffmpegPath: fake,
        // Fictional hosts; the guard is not what this half is about.
        ssrfAllowPrivateAddresses: true,
        enableBrowserResolver: false,
        enableYtdlpResolver: false,
        // On, which is the default, and the case where the two proxies differ.
        ffmpegTlsIntercept: true,
        rateLimitProbePerMinute: 0,
      },
    });
    app.context.registry.register(
      new StubResolver(
        probeResult({
          variants: [variant({ url: "https://cdn.example/low.m3u8", bitrateBps: 300_000 })],
        }),
      ),
    );
  }, 60_000);

  afterAll(async () => {
    await app?.shutdown();
    await fs.rm(root, { recursive: true, force: true });
  });

  test("the ffmpeg egress proxy and its root, never the tiers' proxy, with the context replayed", async () => {
    const response = await app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "https://site.example/watch/42" },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as ProbeResponse).probe.thumbnailPath).toBeUndefined();

    const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as {
      argv: string[];
      httpProxy: string | null;
      httpsProxy: string | null;
    };

    // Precondition, or the assertion after it proves nothing.
    expect(app.context.ffmpegProxyUrl).not.toBe(app.context.egressProxyUrl);
    expect(record.httpProxy).toBe(app.context.ffmpegProxyUrl);
    expect(record.httpsProxy).toBe(app.context.ffmpegProxyUrl);

    const { argv } = record;
    expect(argv[argv.indexOf("-i") + 1]).toBe("https://cdn.example/low.m3u8");
    expect(argv[argv.indexOf("-tls_verify") + 1]).toBe("1");
    const caFile = argv[argv.indexOf("-ca_file") + 1] ?? "";
    // The root the terminating proxy issues under, which the engine is given
    // too — not an operator file, since none is configured here.
    expect(app.context.engine.config.tlsCaFile).toBe(caFile);
    expect(caFile.length).toBeGreaterThan(0);
    expect(argv[argv.indexOf("-headers") + 1]).toContain("cookie: session=super-secret");
  }, 60_000);
});

function generate(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveFfmpegPath(), args, {
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
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

describe("what the ffmpeg egress proxy stops", () => {
  let root: string;
  let clipDir: string;
  let app: App;
  let origin: http.Server;
  let port: number;
  const hits: string[] = [];
  let current: ProbeResult;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "frame-grab-egress-"));
    clipDir = path.join(root, "clip");
    await fs.mkdir(clipDir);
    await generate([
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=320x240:rate=15:duration=${CLIP_SECONDS}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "15",
      "-f",
      "hls",
      "-hls_time",
      "2",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_filename",
      path.join(clipDir, "seg%03d.ts"),
      path.join(clipDir, "index.m3u8"),
    ]);
    const playlist = await fs.readFile(path.join(clipDir, "index.m3u8"), "utf8");

    origin = http.createServer((request, response) => {
      const url = request.url ?? "/";
      hits.push(url);
      // `/<host>.m3u8` is the clip's playlist with every segment made absolute
      // on that host: the manifest is always on the allowed address, and only
      // where it sends ffmpeg next differs.
      const manifest = /^\/(?<host>127\.0\.0\.1|localhost)\.m3u8$/u.exec(url);
      if (manifest?.groups !== undefined) {
        const host = manifest.groups["host"] as string;
        const body = playlist.replaceAll(
          /^(seg\d+\.ts)$/gmu,
          `http://${host}:${String(port)}/${host}/$1`,
        );
        response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(body);
        return;
      }
      const segment = /^\/(?:127\.0\.0\.1|localhost)\/(?<name>seg\d+\.ts)$/u.exec(url);
      if (segment?.groups !== undefined) {
        void fs.readFile(path.join(clipDir, segment.groups["name"] as string)).then(
          (body) => response.writeHead(200, { "content-type": "video/mp2t" }).end(body),
          () => response.writeHead(404).end(),
        );
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    port = (origin.address() as AddressInfo).port;

    app = await createApp({
      startGc: false,
      logger: NOOP_LOGGER,
      config: {
        databasePath: ":memory:",
        storageDir: path.join(root, "storage"),
        // The one exemption: the literal address. `localhost` reaches the same
        // socket and is not exempt, so the guard's ordinary policy refuses it.
        ssrfAllowHosts: ["127.0.0.1"],
        enableBrowserResolver: false,
        enableYtdlpResolver: false,
        rateLimitProbePerMinute: 0,
      },
    });
    app.context.registry.register(new StubResolver(async () => current));
  }, 60_000);

  afterAll(async () => {
    await app?.shutdown();
    await new Promise<void>((resolve) => {
      origin?.closeAllConnections();
      origin?.close(() => resolve());
    });
    await fs.rm(root, { recursive: true, force: true });
  });

  async function probeSegmentsOn(host: "127.0.0.1" | "localhost"): Promise<ProbeResponse> {
    current = probeResult({
      sourceUrl: `http://127.0.0.1:${String(port)}/watch/${host}`,
      durationSec: CLIP_SECONDS,
      variants: [
        variant({
          id: host,
          url: `http://127.0.0.1:${String(port)}/${host}.m3u8`,
          hasAudio: false,
          bitrateBps: 300_000,
        }),
      ],
      requestContext: { headers: {} },
    });
    const response = await app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: `http://127.0.0.1:${String(port)}/watch/${host}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as ProbeResponse;
  }

  test("segments on an allowed address: the grab produces a frame (the control)", async () => {
    const body = await probeSegmentsOn("127.0.0.1");
    expect(hits).toContain("/127.0.0.1.m3u8");
    expect(hits.some((hit) => hit.startsWith("/127.0.0.1/seg"))).toBe(true);
    expect(body.probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);

    const served = await app.server.inject({ method: "GET", url: body.probe.thumbnailPath ?? "" });
    expect(served.headers["content-type"]).toBe("image/jpeg");
    expect([...served.rawPayload.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  }, 60_000);

  test("segments on a blocked address: no preview, and not one request reaches it", async () => {
    const body = await probeSegmentsOn("localhost");
    // The grab ran — the manifest the probe vetted was fetched…
    expect(hits).toContain("/localhost.m3u8");
    // …and what it named next was refused at the proxy, before a socket opened.
    expect(hits.filter((hit) => hit.startsWith("/localhost/"))).toEqual([]);
    expect(body.probe.thumbnailPath).toBeUndefined();
  }, 60_000);
});
