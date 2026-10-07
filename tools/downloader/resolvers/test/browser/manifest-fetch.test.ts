/**
 * dl-97: the manifest re-fetch's streaming client, against loopback servers and
 * a fake proxy. No browser: what is under test is the reading, the redirects,
 * the cookies and the routing. The real guard, the real egress proxy and the
 * pinned TLS root are `api`'s, and `api/test/manifest-refetch.test.ts` drives
 * them with a real `BrowserResolver`.
 */

import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import zlib from "node:zlib";
import { AppError } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { fetchManifest } from "../../src/browser/manifest-fetch.ts";
import type { ManifestFetchOptions } from "../../src/browser/manifest-fetch.ts";

const CAP = 4 * 1024 * 1024;
const MANIFEST = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n";

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
}

interface Server {
  port: number;
  origin: string;
  seen: Seen[];
  close(): Promise<void>;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await server.close()));
});

async function serve(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  configure?: (server: http.Server, seen: Seen[]) => void,
): Promise<Server> {
  const seen: Seen[] = [];
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url ?? "", headers: request.headers });
    handler(request, response);
  });
  configure?.(server, seen);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const handle: Server = {
    port,
    origin: `http://127.0.0.1:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  servers.push(handle);
  return handle;
}

function options(overrides: Partial<ManifestFetchOptions> = {}): ManifestFetchOptions {
  return {
    headers: {},
    cookieFor: async () => undefined,
    storeCookies: async () => {},
    maxBodyBytes: CAP,
    maxRedirects: 20,
    timeoutMs: 5000,
    ...overrides,
  };
}

/** `#EXTM3U` then `mebibytes` of spaces, gzipped a block at a time. */
async function gzipBomb(mebibytes: number): Promise<Buffer> {
  const gzip = zlib.createGzip({ level: 9 });
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => gzip.once("end", () => resolve()));
  gzip.write("#EXTM3U\n");
  const block = Buffer.alloc(1024 * 1024, 0x20);
  for (let index = 0; index < mebibytes; index++) {
    // oxlint-disable-next-line no-await-in-loop
    if (!gzip.write(block)) await new Promise<void>((resolve) => gzip.once("drain", resolve));
  }
  gzip.end();
  await done;
  return Buffer.concat(chunks);
}

describe("the manifest re-fetch reads within a cap (dl-97)", () => {
  test("refuses a gzip body that inflates past the cap, having inflated no more than a chunk past it", async () => {
    const body = await gzipBomb(64);
    // A few KB on the wire, which is the whole point of the attack.
    expect(body.length).toBeLessThan(100 * 1024);
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" }).end(body);
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result.outcome).toBe("too-large");
    if (result.outcome !== "too-large") return;
    expect(result.limitBytes).toBe(CAP);
    expect(result.readBytes).toBeGreaterThan(CAP);
    // Of the 64 MiB the body would have become, the cap and one decoder chunk.
    expect(result.readBytes).toBeLessThanOrEqual(CAP + 64 * 1024);
  });

  test.each([
    ["gzip", zlib.gzipSync],
    ["deflate", zlib.deflateSync],
    ["br", zlib.brotliCompressSync],
  ] as const)("reads a %s body inside the cap", async (encoding, compress) => {
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": encoding }).end(compress(MANIFEST));
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result).toEqual({ outcome: "ok", text: MANIFEST });
    expect(origin.seen[0]?.headers["accept-encoding"]).toBe("gzip, deflate, br");
  });

  test("refuses a declared identity length past the cap without reading the body", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-length": String(CAP + 1) });
      response.write("#EXTM3U\n");
      // Never finished: a client that waited for the body would time out.
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result).toEqual({ outcome: "too-large", limitBytes: CAP, readBytes: 0 });
  });

  test("refuses an undeclared identity body once it passes the cap", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200);
      const block = Buffer.alloc(1024 * 1024, 0x20);
      for (let index = 0; index < 8; index++) response.write(block);
      response.end();
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result.outcome).toBe("too-large");
  });

  test("refuses an encoding it cannot decode rather than parse it raw", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": "zstd" }).end("not really zstd");
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result).toEqual({ outcome: "refused", reason: "unsupported-encoding" });
  });

  test("answers a final status outside 2xx as that status", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(404).end();
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, options());

    expect(result).toEqual({ outcome: "status", status: 404 });
  });

  test("gives up at the deadline on a server that never answers", async () => {
    const origin = await serve(() => {
      // Holds the request open for ever.
    });

    const started = Date.now();
    const error: unknown = await fetchManifest(
      `${origin.origin}/m.m3u8`,
      options({ timeoutMs: 300 }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("TIMEOUT");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("the manifest re-fetch follows redirects itself (dl-97)", () => {
  test("follows them up to the limit and no further", async () => {
    const origin = await serve((request, response) => {
      const hop = Number(request.url?.split("/").at(-1));
      response.writeHead(302, { location: `/r/${String(hop + 1)}` }).end();
    });

    const result = await fetchManifest(`${origin.origin}/r/0`, options({ maxRedirects: 3 }));

    expect(result).toEqual({ outcome: "refused", reason: "too-many-redirects" });
    // The first request and three redirects followed.
    expect(origin.seen.map((seen) => seen.url)).toEqual(["/r/0", "/r/1", "/r/2", "/r/3"]);
  });

  test("sends the replayed cookie on the first hop and asks the jar for every later one", async () => {
    const asked: string[] = [];
    const stored: { url: string; setCookie: readonly string[] }[] = [];
    const origin = await serve((request, response) => {
      if (request.url === "/a") {
        response.writeHead(302, { location: "/b", "set-cookie": "handoff=1; Path=/" }).end();
        return;
      }
      response.writeHead(200).end(MANIFEST);
    });

    const result = await fetchManifest(
      `${origin.origin}/a`,
      options({
        headers: { Cookie: "replayed=1", Referer: "https://page.example/" },
        cookieFor: async (url) => {
          asked.push(url.pathname);
          return "jar=1; handoff=1";
        },
        storeCookies: async (url, setCookie) => {
          stored.push({ url: url.pathname, setCookie });
        },
      }),
    );

    expect(result).toEqual({ outcome: "ok", text: MANIFEST });
    expect(origin.seen[0]?.headers.cookie).toBe("replayed=1");
    expect(origin.seen[1]?.headers.cookie).toBe("jar=1; handoff=1");
    // Asked about the hop it was sending, and only that one.
    expect(asked).toEqual(["/b"]);
    expect(stored).toEqual([{ url: "/a", setCookie: ["handoff=1; Path=/"] }]);
    // Every other replayed header rides along on both hops.
    expect(origin.seen.map((seen) => seen.headers.referer)).toEqual([
      "https://page.example/",
      "https://page.example/",
    ]);
  });

  test("drops authorization on a hop to another origin, and does not restore it on the way back", async () => {
    let originUrl = "";
    const target = await serve((_request, response) => {
      response.writeHead(302, { location: `${originUrl}/back` }).end();
    });
    const origin = await serve((request, response) => {
      if (request.url === "/back") {
        response.writeHead(200).end(MANIFEST);
        return;
      }
      // `localhost` and `127.0.0.1` are the same socket and different origins.
      response.writeHead(302, { location: `http://localhost:${String(target.port)}/m` }).end();
    });
    originUrl = origin.origin;

    const result = await fetchManifest(
      `${origin.origin}/a`,
      options({ headers: { Authorization: "Bearer t" } }),
    );

    expect(result.outcome).toBe("ok");
    expect(origin.seen.map((seen) => [seen.url, seen.headers.authorization])).toEqual([
      ["/a", "Bearer t"],
      ["/back", undefined],
    ]);
    expect(target.seen[0]?.headers.authorization).toBeUndefined();
  });
});

describe("the manifest re-fetch goes through the proxy (dl-97)", () => {
  /** Records what it was asked for and forwards plain HTTP; refuses every CONNECT. */
  async function fakeProxy(): Promise<Server> {
    return await serve(
      (request, response) => {
        const target = new URL(request.url ?? "");
        const forward = http.request(
          {
            host: target.hostname,
            port: target.port,
            path: target.pathname,
            headers: request.headers,
          },
          (answer) => {
            response.writeHead(answer.statusCode ?? 502, answer.headers);
            answer.pipe(response);
          },
        );
        forward.on("error", () => response.writeHead(502).end());
        forward.end();
      },
      (server, seen) => {
        server.on("connect", (request: http.IncomingMessage, socket: Socket) => {
          seen.push({ url: `CONNECT ${request.url ?? ""}`, headers: request.headers });
          socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        });
      },
    );
  }

  test("sends every hop to the proxy, in absolute form", async () => {
    const origin = await serve((request, response) => {
      if (request.url === "/a") {
        response.writeHead(302, { location: "/b" }).end();
        return;
      }
      response.writeHead(200).end(MANIFEST);
    });
    const proxy = await fakeProxy();

    const result = await fetchManifest(`${origin.origin}/a`, options({ proxyUrl: proxy.origin }));

    expect(result).toEqual({ outcome: "ok", text: MANIFEST });
    expect(proxy.seen.map((seen) => seen.url)).toEqual([
      `${origin.origin}/a`,
      `${origin.origin}/b`,
    ]);
  });

  test("answers a refused CONNECT with its status and dials nothing itself", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200).end(MANIFEST);
    });
    const proxy = await fakeProxy();

    const result = await fetchManifest(
      `https://127.0.0.1:${String(origin.port)}/m.m3u8`,
      options({ proxyUrl: proxy.origin }),
    );

    expect(result).toEqual({ outcome: "status", status: 403 });
    expect(proxy.seen.map((seen) => seen.url)).toEqual([
      `CONNECT 127.0.0.1:${String(origin.port)}`,
    ]);
    expect(origin.seen).toEqual([]);
  });

  test("refuses a proxy it cannot speak instead of going around it", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200).end(MANIFEST);
    });

    const result = await fetchManifest(
      `${origin.origin}/m.m3u8`,
      options({ proxyUrl: "socks5://127.0.0.1:1080" }),
    );

    expect(result).toEqual({ outcome: "refused", reason: "unsupported-proxy" });
    expect(origin.seen).toEqual([]);
  });
});
