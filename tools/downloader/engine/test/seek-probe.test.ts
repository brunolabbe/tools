/**
 * dl-102: the seek probe on its own — the box walk that decides where a file's
 * index is, and the request that decides whether its origin honours `Range`.
 * `stream.test.ts` has the same probe end to end, with real ffmpeg.
 */

import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RequestContext } from "@downloader/contract";
import {
  indexPlacement,
  probeSeek,
  TopLevelBoxWalk,
  WALK_LIMIT_BYTES,
} from "../src/download/seek-probe.ts";
import type { FixtureServer } from "./helpers/http.ts";
import { startFixtureServer } from "./helpers/http.ts";

/** One box: a 32-bit size, a type, and `bodyBytes` of filler. */
function box(type: string, bodyBytes: number): Buffer {
  const out = Buffer.alloc(8 + bodyBytes, 0x2a);
  out.writeUInt32BE(8 + bodyBytes, 0);
  out.write(type, 4, "latin1");
  return out;
}

/** A box whose size is in the 64-bit field (`size == 1`). */
function largeBox(type: string, bodyBytes: number): Buffer {
  const out = Buffer.alloc(16 + bodyBytes, 0x2a);
  out.writeUInt32BE(1, 0);
  out.write(type, 4, "latin1");
  out.writeBigUInt64BE(BigInt(16 + bodyBytes), 8);
  return out;
}

const layouts = {
  // ffmpeg 6.1.1's own layout without +faststart (gate 1: 6 of 6 sources).
  tailFree: Buffer.concat([box("ftyp", 24), box("free", 0), box("mdat", 4000), box("moov", 900)]),
  // The same, with +faststart: `free` after the index.
  fastStart: Buffer.concat([box("ftyp", 24), box("moov", 900), box("free", 0), box("mdat", 4000)]),
  // QuickTime: no `ftyp` at all.
  quickTime: Buffer.concat([box("wide", 0), box("mdat", 4000), box("moov", 900)]),
  // Nothing between `ftyp` and `mdat`.
  tailBare: Buffer.concat([box("ftyp", 24), box("mdat", 4000), box("moov", 900)]),
  // A 64-bit `free` and a `uuid` before the index.
  wideFront: Buffer.concat([
    box("ftyp", 24),
    largeBox("free", 64),
    box("uuid", 40),
    box("moov", 900),
    largeBox("mdat", 4000),
  ]),
};

describe("dl-102: where the index is, from the top-level boxes", () => {
  test.each([
    ["ftyp,free,mdat,moov", layouts.tailFree, "end"],
    ["ftyp,moov,free,mdat", layouts.fastStart, "front"],
    ["wide,mdat,moov", layouts.quickTime, "end"],
    ["ftyp,mdat,moov", layouts.tailBare, "end"],
    ["ftyp,free(64-bit),uuid,moov,mdat(64-bit)", layouts.wideFront, "front"],
  ] as const)("%s is %s", (_name, bytes, expected) => {
    expect(indexPlacement(bytes)).toBe(expected);
  });

  test("fed a byte at a time, every layout reaches the same verdict", () => {
    for (const bytes of Object.values(layouts)) {
      const walk = new TopLevelBoxWalk();
      let verdict = null;
      for (let offset = 0; offset < bytes.length && verdict === null; offset += 1) {
        verdict = walk.push(bytes.subarray(offset, offset + 1));
      }
      expect(verdict).toBe(indexPlacement(bytes));
    }
  });

  test("the bytes of a box's body are never read as a header", () => {
    // `mdat` spelled inside `free`'s body, where a sniff that scanned for it
    // would find it.
    const free = box("free", 16);
    free.write("mdat", 12, "latin1");
    expect(indexPlacement(Buffer.concat([box("ftyp", 24), free, box("moov", 900)]))).toBe("front");
  });

  test("bytes that are not boxes are unknown, never a refusal", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42]);
    const html = Buffer.from("<!DOCTYPE html><html><body>not a video</body></html>");
    const ts = Buffer.alloc(376, 0xff);
    ts[0] = 0x47;
    ts[188] = 0x47;
    for (const bytes of [webm, html, ts]) expect(indexPlacement(bytes)).toBe("unknown");
  });

  test("a chain that ends, or runs past the limit, before moov or mdat is unknown", () => {
    expect(indexPlacement(box("ftyp", 24))).toBe("unknown");
    expect(indexPlacement(Buffer.concat([box("ftyp", 24), box("free", 2)]).subarray(0, 36))).toBe(
      "unknown",
    );
    const past = Buffer.concat([box("ftyp", 24), box("free", WALK_LIMIT_BYTES), box("mdat", 8)]);
    expect(indexPlacement(past)).toBe("unknown");
    // A box that claims to be smaller than its own header.
    const broken = box("ftyp", 24);
    broken.writeUInt32BE(4, 0);
    expect(indexPlacement(broken)).toBe("unknown");
  });
});

const CONTEXT: RequestContext = { headers: { Referer: "https://player.example/102" } };
const PROBE = { requestContext: CONTEXT, tlsVerify: true, tlsCaFile: undefined, env: {} };

describe("dl-102: the probe's request", () => {
  let origin: FixtureServer;
  let proxy: FixtureServer;

  beforeAll(async () => {
    origin = await startFixtureServer(async (request, response) => {
      const pathname = new URL(request.url ?? "/", "http://x").pathname;
      if (pathname === "/slow") await new Promise((resolve) => setTimeout(resolve, 2_000));
      const ranged = /^bytes=(\d+)-(\d+)$/u.exec(request.headers.range ?? "");
      const body = pathname.startsWith("/front") ? layouts.fastStart : layouts.tailFree;
      if (pathname.startsWith("/gone")) {
        response.writeHead(404).end();
      } else if (pathname.startsWith("/ranged") && ranged !== null) {
        const start = Number(ranged[1]);
        const end = Number(ranged[2]);
        response
          .writeHead(206, { "content-range": `bytes ${start}-${end}/${body.length}` })
          .end(body.subarray(start, end + 1));
      } else {
        response.writeHead(200, { "content-length": String(body.length) }).end(body);
      }
    });
    proxy = await startFixtureServer(async (request, response) => {
      await new Promise<void>((resolve) => {
        const upstream = http.request(
          new URL(request.url ?? ""),
          { headers: request.headers },
          (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
            answer.once("end", resolve);
          },
        );
        upstream.once("error", () => {
          response.writeHead(502).end();
          resolve();
        });
        upstream.end();
      });
    });
  });

  afterAll(async () => {
    await origin?.close();
    await proxy?.close();
  });

  test("a 206 is seekable, and a 200 is judged by its boxes", async () => {
    const direct = { ...PROBE, proxyUrl: undefined };
    expect(await probeSeek(`${origin.origin}/ranged`, direct)).toEqual({ kind: "seekable" });
    expect(await probeSeek(`${origin.origin}/tail`, direct)).toEqual({ kind: "unseekable" });
    expect(await probeSeek(`${origin.origin}/front`, direct)).toEqual({ kind: "index-first" });
  });

  test("it asks for one byte past the start, with the replayed headers", async () => {
    const before = origin.requests.length;
    await probeSeek(`${origin.origin}/ranged`, { ...PROBE, proxyUrl: undefined });
    const [asked] = origin.requests.slice(before);
    expect(asked?.headers.range).toBe("bytes=1-1");
    expect(asked?.headers.referer).toBe("https://player.example/102");
    expect(asked?.headers["accept-encoding"]).toBe("identity");
  });

  test("any other status, and a timeout, are unknown rather than a refusal", async () => {
    const direct = { ...PROBE, proxyUrl: undefined };
    expect(await probeSeek(`${origin.origin}/gone`, direct)).toEqual({
      kind: "unknown",
      reason: "status 404",
    });
    expect(await probeSeek(`${origin.origin}/slow`, { ...direct, timeoutMs: 200 })).toEqual({
      kind: "unknown",
      reason: "timeout",
    });
    expect(await probeSeek("http://127.0.0.1:1/closed", direct)).toEqual({
      kind: "unknown",
      reason: "ECONNREFUSED",
    });
  });

  test("the caller's cancel rejects, where a timeout does not", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      probeSeek(`${origin.origin}/slow`, {
        ...PROBE,
        proxyUrl: undefined,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "SeekProbeCanceled" });
  });

  test("it goes through the configured proxy, and through ffmpeg's inherited one otherwise", async () => {
    const url = `${origin.origin}/tail`;
    const before = proxy.requests.length;
    expect(await probeSeek(url, { ...PROBE, proxyUrl: proxy.origin })).toEqual({
      kind: "unseekable",
    });
    // What the runner gives ffmpeg when no proxy is configured: the inherited one.
    expect(
      await probeSeek(url, { ...PROBE, proxyUrl: undefined, env: { http_proxy: proxy.origin } }),
    ).toEqual({ kind: "unseekable" });
    expect(proxy.requests.slice(before).map((entry) => entry.url)).toEqual([url, url]);
  });

  test("a proxy it cannot speak to makes the verdict unknown, and nothing goes direct", async () => {
    const before = origin.requests.length;
    for (const proxyUrl of ["socks5://127.0.0.1:1080", "https://127.0.0.1:8443", "not a url"]) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await probeSeek(`${origin.origin}/tail`, { ...PROBE, proxyUrl })).toEqual({
        kind: "unknown",
        reason: "proxy-not-http",
      });
    }
    expect(origin.requests.length).toBe(before);
  });
});
