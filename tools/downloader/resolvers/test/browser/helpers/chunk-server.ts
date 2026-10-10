/**
 * A loopback origin for the numbered-file shapes dl-90 is about: a "player" page
 * that fetches numbered `.mp4` files as an MSE player would, with real MP4 boxes
 * in the bodies (`test/helpers/mp4.ts`) where the chunk sniff reads them.
 *
 * Nothing here is playable. The sniff reads box headers, and the capture
 * classifies on response headers; what Chromium makes of the bytes afterwards
 * changes nothing these tests measure.
 *
 * The playlist route answers `text/plain` from an extensionless URL, chunked, so
 * `classifyMedia` gives it no kind and `sniffAsManifest` (dl-79) does not read
 * it: the capture never holds a manifest hit, which is the case dl-90 is about.
 */

import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  ascii,
  box,
  concat,
  faststartMp4,
  fragmentedMovie,
  initSegment,
  mediaSegment,
  tailMoovMp4,
  trak,
  zeros,
} from "../../helpers/mp4.ts";

const MB = 1024 * 1024;
const TRACKS = [trak("vide", "avc1"), trak("soun", "mp4a")];

interface Served {
  body: Uint8Array;
  /** Send no `Content-Length`, as a chunked response does. */
  chunked?: boolean;
  /** Answer the sniff's head range never: the page gets the file, the sniff waits. */
  slowHead?: boolean;
}

const HEAD_RANGE = "bytes=0-65535";

const wholeFaststart = (): Uint8Array =>
  faststartMp4({ brands: ["isom", "mp41"], tracks: TRACKS, mdatBytes: MB });
const wholeTailMoov = (): Uint8Array =>
  tailMoovMp4({ brands: ["isom", "mp41"], tracks: TRACKS, mdatBytes: MB });

const padded = (index: number): string => String(index).padStart(5, "0");

/** `00000.mp4` an init segment (chunked, so no declared length demotes it), the rest media segments. */
function segmented(directory: string, count: number): Array<[string, Served]> {
  return Array.from({ length: count }, (_, index): [string, Served] => [
    `${directory}${padded(index)}.mp4`,
    index === 0 ? { body: initSegment(), chunked: true } : { body: mediaSegment(2 * MB - 100_000) },
  ]);
}

const FILES = new Map<string, Served>([
  ...segmented("/n/", 3),
  // Many chunks: one proven fragment must settle the directory, not twelve reads.
  ...segmented("/many/", 12),
  // Whole files that look like a gallery: the last has its `moov` after `mdat`.
  ["/media/1.mp4", { body: wholeFaststart() }],
  ["/media/2.mp4", { body: wholeFaststart() }],
  ["/media/3.mp4", { body: wholeTailMoov() }],
  // Resolution suffixes: two whole files, one per layout.
  ["/res/clip-720.mp4", { body: wholeFaststart() }],
  ["/res/clip-1080.mp4", { body: wholeTailMoov() }],
  // Bodies the sniff cannot read: zeros, and an unrelated box layout.
  ["/zero/1.mp4", { body: zeros(MB) }],
  ["/zero/2.mp4", { body: zeros(MB) }],
  ["/other/1.mp4", { body: concat(box("free", ascii("not a movie")), zeros(MB)) }],
  ["/other/2.mp4", { body: concat(box("free", ascii("not a movie")), zeros(MB)) }],
  // A whole movie written as fragmented MP4, alone and beside whole files.
  ["/lf/839201.mp4", { body: fragmentedMovie(MB) }],
  ["/wf/1.mp4", { body: wholeFaststart() }],
  ["/wf/2.mp4", { body: wholeTailMoov() }],
  ["/wf/3.mp4", { body: fragmentedMovie(MB) }],
  // One directory, three kinds: the whole file is the biggest, so it is read first
  // (rank orders by size), proves nothing, and must survive the fragments after it.
  ["/mx/1.mp4", { body: faststartMp4({ brands: ["isom"], tracks: TRACKS, mdatBytes: 4 * MB }) }],
  ["/mx/2.mp4", { body: initSegment(), chunked: true }],
  ["/mx/3.mp4", { body: mediaSegment(2 * MB - 100_000) }],
  // Sniff reads that never finish.
  ...Array.from({ length: 8 }, (_, index): [string, Served] => [
    `/slow/${String(index + 1)}.mp4`,
    { body: wholeFaststart(), slowHead: true },
  ]),
  // More whole files than the sniff will read.
  ...Array.from({ length: 12 }, (_, index): [string, Served] => [
    `/many-whole/${String(index + 1).padStart(2, "0")}.mp4`,
    { body: wholeFaststart() },
  ]),
]);

const PLAYLIST = "/api/playlist?id=7";

/** Each page's "player" fetches these, in order. */
const PAGES: Record<string, string[]> = {
  "/nomanifest.html": [PLAYLIST, "/n/00000.mp4", "/n/00001.mp4", "/n/00002.mp4"],
  "/manychunks.html": Array.from({ length: 12 }, (_, index) => `/many/${padded(index)}.mp4`),
  "/gallery.html": ["/media/1.mp4", "/media/2.mp4", "/media/3.mp4"],
  "/resolutions.html": ["/res/clip-720.mp4", "/res/clip-1080.mp4"],
  "/zero.html": ["/zero/1.mp4", "/zero/2.mp4"],
  "/other.html": ["/other/1.mp4", "/other/2.mp4"],
  "/lonefrag.html": ["/lf/839201.mp4"],
  "/wholefrag.html": ["/wf/1.mp4", "/wf/2.mp4", "/wf/3.mp4"],
  "/mixed.html": ["/mx/1.mp4", "/mx/2.mp4", "/mx/3.mp4"],
  "/slow.html": Array.from({ length: 8 }, (_, index) => `/slow/${String(index + 1)}.mp4`),
  "/manywhole.html": Array.from(
    { length: 12 },
    (_, index) => `/many-whole/${String(index + 1).padStart(2, "0")}.mp4`,
  ),
};

export interface ChunkServer {
  origin: string;
  url(pathname: string): string;
  /** Every request for a file, so a test can say what asked for what. */
  requests: Array<{ pathname: string; range: string | undefined }>;
  /** The requests that asked for exactly the sniff's head range. */
  headReads(): Array<{ pathname: string; range: string | undefined }>;
  /** Called with the path of each head read of a `slowHead` file as it arrives. */
  onSlowHead: ((pathname: string) => void) | undefined;
  close(): Promise<void>;
}

function page(urls: readonly string[]): string {
  const script = `(async()=>{for(const u of ${JSON.stringify(urls)}){try{const r=await fetch(u);await r.arrayBuffer();}catch(e){}}})();`;
  return `<!doctype html><html><head><title>t</title></head><body><script>${script}</script></body></html>`;
}

function hlsPlaylist(): string {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:6",
    '#EXT-X-MAP:URI="/n/00000.mp4"',
    "#EXTINF:6,",
    "/n/00001.mp4",
    "#EXTINF:6,",
    "/n/00002.mp4",
    "#EXT-X-ENDLIST",
    "",
  ].join("\n");
}

/** `bytes=40-99` → `[40, 99]`; an open end runs to the last byte. */
function parseRange(header: string | undefined, last: number): [number, number] | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!match) return undefined;
  const start = match[1] === "" ? 0 : Number(match[1]);
  const end = match[2] === "" ? last : Math.min(Number(match[2]), last);
  return [start, end];
}

function serveFile(
  served: Served,
  request: IncomingMessage,
  response: ServerResponse,
  headers: Record<string, string>,
): void {
  const last = served.body.byteLength - 1;
  const range = parseRange(request.headers.range, last);
  if (range === undefined) {
    response.writeHead(200, {
      ...headers,
      ...(served.chunked === true ? {} : { "content-length": String(served.body.byteLength) }),
    });
    response.end(served.body);
    return;
  }
  const [start, end] = range;
  const slice = served.body.subarray(start, end + 1);
  response.writeHead(206, {
    ...headers,
    "content-length": String(slice.byteLength),
    "content-range": `bytes ${String(start)}-${String(end)}/${String(served.body.byteLength)}`,
  });
  response.end(slice);
}

export async function startChunkServer(): Promise<ChunkServer> {
  const requests: ChunkServer["requests"] = [];
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const pages = PAGES[url.pathname];
    if (pages !== undefined) {
      const body = page(pages);
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
        })
        .end(body);
      return;
    }
    if (url.pathname === "/api/playlist") {
      // No Content-Length: Node sends a string body chunked.
      response.writeHead(200, { "content-type": "text/plain" }).end(hlsPlaylist());
      return;
    }
    const served = FILES.get(url.pathname);
    if (served !== undefined) {
      requests.push({ pathname: url.pathname, range: request.headers.range });
      if (served.slowHead === true && request.headers.range === HEAD_RANGE) {
        // Never answered: the connection is closed when the server is.
        handle.onSlowHead?.(url.pathname);
        return;
      }
      serveFile(served, request, response, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

  const handle: ChunkServer = {
    origin,
    requests,
    onSlowHead: undefined,
    url: (pathname: string) => new URL(pathname, origin).toString(),
    headReads: () => requests.filter((entry) => entry.range === HEAD_RANGE),
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
  return handle;
}
