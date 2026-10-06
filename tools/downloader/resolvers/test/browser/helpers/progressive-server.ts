/**
 * A loopback origin for the progressive-file shapes the static fixture server
 * cannot make (dl-78): a multi-megabyte body generated in memory rather than
 * committed, and a server that answers every `Range` request with a short `206`.
 *
 * The body is zeros, not a decodable video. The sniffer classifies on the
 * response headers, which exist before Chromium reads a byte of it, so the
 * player failing to demux afterwards changes nothing these tests measure.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const PROGRESSIVE_FILE_BYTES = 5 * 1024 * 1024;
export const RANGE_CHUNK_BYTES = 256 * 1024;

const BODY = Buffer.alloc(PROGRESSIVE_FILE_BYTES);

/** Pages keyed by pathname, each a bare `<video>` pointing at one media path. */
const PAGES: Record<string, string> = {
  "/named.html": "/media/clip-720.mp4",
  "/ranged.html": "/media/lecture.mp4",
};

/** Media paths whose `Range` answers are cut to `RANGE_CHUNK_BYTES`. */
const SHORT_RANGES: ReadonlySet<string> = new Set(["/media/lecture.mp4"]);

export interface ProgressiveServer {
  origin: string;
  url(pathname: string): string;
  /** `[pathname, range header]` per media request, so a test can say what the browser asked. */
  requests: Array<{ pathname: string; range: string | undefined }>;
  close(): Promise<void>;
}

function page(src: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Progressive file</title></head>
  <body>
    <video id="v" width="640" height="360" muted playsinline controls preload="auto" src="${src}"></video>
  </body>
</html>
`;
}

function parseRange(header: string | undefined): { start: number; end: number | undefined } {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match) return { start: 0, end: undefined };
  const start = match[1] === "" ? 0 : Number(match[1]);
  const end = match[2] === "" ? undefined : Number(match[2]);
  return { start, end };
}

function serveMedia(
  pathname: string,
  request: IncomingMessage,
  response: ServerResponse,
  log: ProgressiveServer["requests"],
): void {
  const rangeHeader = request.headers.range;
  log.push({ pathname, range: rangeHeader });

  if (rangeHeader === undefined) {
    response.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": String(BODY.byteLength),
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    response.end(BODY);
    return;
  }

  const { start, end: asked } = parseRange(rangeHeader);
  const last = BODY.byteLength - 1;
  const cap = SHORT_RANGES.has(pathname) ? start + RANGE_CHUNK_BYTES - 1 : last;
  const end = Math.min(asked ?? last, cap, last);
  const chunk = BODY.subarray(start, end + 1);
  response.writeHead(206, {
    "content-type": "video/mp4",
    "content-length": String(chunk.byteLength),
    "content-range": `bytes ${start}-${end}/${BODY.byteLength}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  response.end(chunk);
}

export async function startProgressiveServer(): Promise<ProgressiveServer> {
  const requests: ProgressiveServer["requests"] = [];
  const server: Server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const src = PAGES[pathname];
    if (src !== undefined) {
      const body = page(src);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      });
      response.end(body);
      return;
    }
    if (pathname.startsWith("/media/")) {
      serveMedia(pathname, request, response, requests);
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    requests,
    url: (pathname: string) => new URL(pathname, origin).toString(),
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
