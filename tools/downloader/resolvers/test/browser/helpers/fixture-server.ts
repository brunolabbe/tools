/**
 * Static server for the browser-sniffer fixtures.
 *
 * Real sites change, rate-limit and geo-vary, which makes CI failures
 * meaningless — so every page these tests drive is served from disk on an
 * ephemeral loopback port.
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../../fixtures/pages", import.meta.url)));

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl",
  ".mpd": "application/dash+xml",
  ".mp4": "video/mp4",
  ".m4s": "video/iso.segment",
  ".png": "image/png",
};

/** Pages served with a deliberate non-2xx, so classification has something to read. */
const STATUS_OVERRIDES: Record<string, number> = {
  "/challenge.html": 403,
};

export interface FixtureServer {
  origin: string;
  url(pathname: string): string;
  close(): Promise<void>;
}

function resolveWithin(pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(ROOT, `.${path.posix.normalize(decoded)}`);
  // Never serve outside the fixture directory, even from a test server.
  return resolved === ROOT || resolved.startsWith(ROOT + path.sep) ? resolved : undefined;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");
      const pathname = requestUrl.pathname;

      // A login wall reached by redirect, which is the shape real sites use.
      if (pathname === "/gated") {
        response.writeHead(302, { location: "/login.html" });
        response.end();
        return;
      }

      // Extensionless, signed manifest: only Content-Type identifies it.
      const filePath =
        pathname === "/media/dash/stream"
          ? path.join(ROOT, "media", "dash", "manifest.mpd")
          : resolveWithin(pathname);

      if (filePath === undefined) {
        response.writeHead(400).end("bad path");
        return;
      }

      try {
        const body = await readFile(filePath);
        const extension = path.extname(filePath).toLowerCase();
        response.writeHead(STATUS_OVERRIDES[pathname] ?? 200, {
          "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
          "content-length": String(body.byteLength),
          "cache-control": "no-store",
        });
        response.end(body);
      } catch {
        response.writeHead(404, { "content-type": "text/plain" }).end("not found");
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    url: (pathname: string) => new URL(pathname, origin).toString(),
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
