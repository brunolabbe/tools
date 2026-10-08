import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { fetchHeaders, fetchManifest } from "../../src/browser/manifest-fetch.ts";
import type { HeadersFetchResult, ManifestFetchResult } from "../../src/browser/manifest-fetch.ts";
import {
  MAX_PLAYLIST_BYTES,
  createRequestSizeProbe,
  createSizeRequest,
} from "../../src/browser/size-probe.ts";
import type { BodyRequest, HeadersRequest, SizeRequestLike } from "../../src/browser/size-probe.ts";

/**
 * Gate 1 finding B: this probe used to live inline in `browser.ts`, where the
 * only way to reach it was to launch a browser — and no test did, because the
 * suite's fake parsers never set a `bitrateBps`, so the sampler never chose a
 * reference. Extracting it behind a seam is what makes the call shape checkable
 * without Playwright; since dl-101 the seam is `SizeRequestLike`, and the second
 * half of this file drives the real client behind it against loopback servers.
 */

interface Call {
  kind: "headers" | "body";
  url: string;
  method?: "HEAD" | "GET";
  headers: Record<string, string>;
  timeoutMs: number;
  maxBodyBytes?: number;
}

function headersAnswer(
  init: { status?: number; headers?: Record<string, string> } = {},
): HeadersFetchResult {
  return { outcome: "headers", status: init.status ?? 200, headers: init.headers ?? {} };
}

const REFUSED: HeadersFetchResult = { outcome: "status", status: 403 };

function stubRequest(handlers: {
  headers?: (call: Call) => HeadersFetchResult;
  body?: (call: Call) => ManifestFetchResult;
}): { request: SizeRequestLike; calls: Call[] } {
  const calls: Call[] = [];
  const request: SizeRequestLike = {
    headers: async (url: string, options: HeadersRequest) => {
      const call: Call = { kind: "headers", url, ...options };
      calls.push(call);
      return await Promise.resolve((handlers.headers ?? (() => headersAnswer()))(call));
    },
    body: async (url: string, options: BodyRequest) => {
      const call: Call = { kind: "body", url, ...options };
      calls.push(call);
      return await Promise.resolve(
        (handlers.body ?? (() => ({ outcome: "ok", text: "" }) as const))(call),
      );
    },
  };
  return { request, calls };
}

const HEADERS = { Cookie: "session=abc", Referer: "https://example.net/" };
const FAR = Date.now() + 60_000;
const URL_UNDER_TEST = "https://cdn.example.net/v/seg-00001.m4s";

describe("contentLength over the browser tier's client", () => {
  test("reads the Content-Length of a HEAD that answers", async () => {
    const { request, calls } = stubRequest({
      headers: () => headersAnswer({ headers: { "content-length": "4096" } }),
    });

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      4096,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("HEAD");
    expect(calls[0]?.headers).toEqual(HEADERS);
  });

  test("falls back to a ranged GET and trusts only Content-Range", async () => {
    const { request, calls } = stubRequest({
      headers: (call) =>
        call.method === "HEAD"
          ? REFUSED
          : headersAnswer({
              status: 206,
              headers: { "content-length": "1", "content-range": "bytes 0-0/4096" },
            }),
    });

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      4096,
    );
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
    expect(calls[1]?.headers["Range"]).toBe("bytes=0-0");
    // The replay headers survive alongside the Range.
    expect(calls[1]?.headers["Cookie"]).toBe("session=abc");
  });

  test("a refusal, a missing Content-Range and a throw are all just unmeasured", async () => {
    const refusing = stubRequest({ headers: () => REFUSED });
    expect(
      await createRequestSizeProbe(refusing.request, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();

    const noRange = stubRequest({
      headers: (call) => (call.method === "HEAD" ? REFUSED : headersAnswer()),
    });
    expect(
      await createRequestSizeProbe(noRange.request, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();

    const refusedByTheClient = stubRequest({
      headers: () => ({ outcome: "refused", reason: "untrusted-certificate" }),
    });
    expect(
      await createRequestSizeProbe(refusedByTheClient.request, HEADERS, FAR).contentLength(
        URL_UNDER_TEST,
      ),
    ).toBeUndefined();

    const throwing: SizeRequestLike = {
      headers: async () => await Promise.reject(new Error("socket hang up")),
      body: async () => await Promise.reject(new Error("socket hang up")),
    };
    expect(
      await createRequestSizeProbe(throwing, HEADERS, FAR).contentLength(URL_UNDER_TEST),
    ).toBeUndefined();
  });

  test("a HEAD that answers 200 with no length still falls through to the range", async () => {
    const { calls, request } = stubRequest({
      headers: (call) =>
        call.method === "HEAD"
          ? headersAnswer()
          : headersAnswer({ status: 206, headers: { "content-range": "bytes 0-0/77" } }),
    });

    expect(await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST)).toBe(
      77,
    );
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  test("never asks for a body to weigh a rendition", async () => {
    const { calls, request } = stubRequest({
      headers: (call) =>
        call.method === "HEAD"
          ? REFUSED
          : headersAnswer({ status: 206, headers: { "content-range": "bytes 0-0/77" } }),
    });

    await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST);

    expect(calls.map((call) => call.kind)).toEqual(["headers", "headers"]);
  });
});

describe("text over the browser tier's client", () => {
  test("returns a playlist body and nothing on a refusal", async () => {
    const ok = stubRequest({ body: () => ({ outcome: "ok", text: "#EXTM3U\n" }) });
    expect(await createRequestSizeProbe(ok.request, HEADERS, FAR).text("u")).toBe("#EXTM3U\n");
    expect(ok.calls[0]?.headers).toEqual(HEADERS);

    const refused = stubRequest({ body: () => ({ outcome: "status", status: 403 }) });
    expect(await createRequestSizeProbe(refused.request, HEADERS, FAR).text("u")).toBeUndefined();
  });

  test("asks for no more than the playlist cap, and treats a refusal past it as unmeasured", async () => {
    const tooLarge = stubRequest({
      body: (call) => ({
        outcome: "too-large",
        limitBytes: call.maxBodyBytes ?? 0,
        readBytes: (call.maxBodyBytes ?? 0) + 1,
      }),
    });

    expect(await createRequestSizeProbe(tooLarge.request, HEADERS, FAR).text("u")).toBeUndefined();
    expect(tooLarge.calls[0]?.maxBodyBytes).toBe(MAX_PLAYLIST_BYTES);
  });

  test("a throw is just unmeasured", async () => {
    const throwing: SizeRequestLike = {
      headers: async () => await Promise.reject(new Error("socket hang up")),
      body: async () => await Promise.reject(new Error("socket hang up")),
    };
    expect(await createRequestSizeProbe(throwing, HEADERS, FAR).text("u")).toBeUndefined();
  });
});

describe("the caller's deadline", () => {
  test("spends nothing once too little of it is left to be worth a request", async () => {
    const spent = stubRequest({
      headers: () => headersAnswer({ headers: { "content-length": "4096" } }),
    });
    const probe = createRequestSizeProbe(spent.request, HEADERS, Date.now() + 100);

    expect(await probe.contentLength(URL_UNDER_TEST)).toBeUndefined();
    expect(await probe.text(URL_UNDER_TEST)).toBeUndefined();
    expect(spent.calls).toEqual([]);
  });

  test("what is left of it becomes the request timeout", async () => {
    const { request, calls } = stubRequest({
      headers: () => headersAnswer({ headers: { "content-length": "4096" } }),
    });

    await createRequestSizeProbe(request, HEADERS, FAR).contentLength(URL_UNDER_TEST);

    // Capped rather than handed the whole 60 s that remains.
    expect(calls[0]?.timeoutMs).toBe(4000);
  });
});

/**
 * The real client behind the seam, against loopback servers (dl-101). The proxy
 * guard, the terminating proxy and the pinned root are `api`'s; what is proved
 * here is what the probe asks of a server and how little of the answer it reads.
 */

interface Origin {
  origin: string;
  requests: { method: string; url: string; range: string | undefined }[];
  close(): Promise<void>;
}

const origins: Origin[] = [];

afterEach(async () => {
  await Promise.all(origins.splice(0).map(async (origin) => await origin.close()));
});

async function serve(handler: http.RequestListener): Promise<Origin> {
  const requests: Origin["requests"] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      method: request.method ?? "",
      url: request.url ?? "",
      range: request.headers.range,
    });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin: Origin = {
    origin: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  origins.push(origin);
  return origin;
}

function realProbe(): ReturnType<typeof createRequestSizeProbe> {
  return createRequestSizeProbe(
    createSizeRequest({
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      maxRedirects: 20,
    }),
    {},
    Date.now() + 60_000,
  );
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

describe("a playlist's text over the real client (dl-101)", () => {
  test("refuses a gzip playlist that inflates past the cap, inflating no more than a chunk past it", async () => {
    const bomb = await gzipBomb(64);
    expect(bomb.length).toBeLessThan(100 * 1024);
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" }).end(bomb);
    });

    // The seam is also where a test sees what the client reported.
    const reported: ManifestFetchResult[] = [];
    const real = createSizeRequest({
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      maxRedirects: 20,
    });
    const watching: SizeRequestLike = {
      headers: real.headers,
      body: async (url, request) => {
        const result = await real.body(url, request);
        reported.push(result);
        return result;
      },
    };

    const text = await createRequestSizeProbe(watching, {}, Date.now() + 60_000).text(
      `${origin.origin}/media.m3u8`,
    );

    expect(text).toBeUndefined();
    const [result] = reported;
    expect(result?.outcome).toBe("too-large");
    if (result?.outcome !== "too-large") return;
    expect(result.limitBytes).toBe(MAX_PLAYLIST_BYTES);
    // Of the 64 MiB the body would have become, the cap and one decoder chunk.
    expect(result.readBytes).toBeGreaterThan(MAX_PLAYLIST_BYTES);
    expect(result.readBytes).toBeLessThanOrEqual(MAX_PLAYLIST_BYTES + 64 * 1024);
  });

  test("reads a playlist inside the cap", async () => {
    const playlist = "#EXTM3U\n#EXTINF:4,\nseg-0.ts\n#EXT-X-ENDLIST\n";
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" }).end(zlib.gzipSync(playlist));
    });

    expect(await realProbe().text(`${origin.origin}/media.m3u8`)).toBe(playlist);
  });
});

describe("a rendition's size over the real client (dl-101)", () => {
  test("reads a HEAD's Content-Length", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200, { "content-length": "123456" }).end();
    });

    expect(await realProbe().contentLength(`${origin.origin}/seg.m4s`)).toBe(123456);
    expect(origin.requests.map((request) => request.method)).toEqual(["HEAD"]);
  });

  test("a ranged GET answered 200 with a large body reads none of it", async () => {
    // Rejects HEAD, ignores Range, and would stream 512 MiB if anyone listened.
    const BLOCK = Buffer.alloc(1024 * 1024, 0x61);
    const total = 512;
    let written = 0;
    let finished = false;
    const origin = await serve((request, response) => {
      if (request.method === "HEAD") {
        response.writeHead(405).end();
        return;
      }
      response.writeHead(200, { "content-length": String(total * BLOCK.length) });
      const pump = (): void => {
        while (written < total && !response.destroyed) {
          written += 1;
          if (!response.write(BLOCK)) {
            response.once("drain", pump);
            return;
          }
        }
        finished = true;
      };
      pump();
    });

    const length = await realProbe().contentLength(`${origin.origin}/seg.m4s`);

    // A 200 carries no Content-Range, so the total is unknown, as before.
    expect(length).toBeUndefined();
    expect(origin.requests.map((request) => request.method)).toEqual(["HEAD", "GET"]);
    expect(origin.requests[1]?.range).toBe("bytes=0-0");
    // Backpressure stops the server after the socket buffers fill; had the
    // client read the body, `written` would have reached the whole 512.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(finished).toBe(false);
    expect(written).toBeLessThan(64);
  });

  test("reads the total off a 206's Content-Range", async () => {
    const origin = await serve((request, response) => {
      if (request.method === "HEAD") {
        response.writeHead(405).end();
        return;
      }
      response
        .writeHead(206, { "content-range": "bytes 0-0/9876", "content-length": "1" })
        .end("a");
    });

    expect(await realProbe().contentLength(`${origin.origin}/seg.m4s`)).toBe(9876);
  });
});

describe("fetchHeaders (dl-101)", () => {
  test("answers a final status outside 2xx as that status", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(404).end();
    });

    const result = await fetchHeaders(`${origin.origin}/x`, {
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      maxRedirects: 20,
      headers: {},
      timeoutMs: 5000,
    });

    expect(result).toEqual({ outcome: "status", status: 404 });
  });

  test("follows a redirect and answers the final response's lower-cased headers", async () => {
    const origin = await serve((request, response) => {
      if (request.url === "/start") {
        response.writeHead(302, { location: "/end" }).end();
        return;
      }
      response.writeHead(200, { "Content-Length": "42", "X-Repeated": "a" }).end();
    });

    const result = await fetchHeaders(`${origin.origin}/start`, {
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      maxRedirects: 20,
      headers: {},
      timeoutMs: 5000,
    });

    expect(result.outcome).toBe("headers");
    if (result.outcome !== "headers") return;
    expect(result.status).toBe(200);
    expect(result.headers["content-length"]).toBe("42");
    expect(result.headers["x-repeated"]).toBe("a");
  });

  test("leaves fetchManifest answering what it always did", async () => {
    const origin = await serve((_request, response) => {
      response.writeHead(200).end("#EXTM3U\n");
    });

    const result = await fetchManifest(`${origin.origin}/m.m3u8`, {
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      maxRedirects: 20,
      headers: {},
      timeoutMs: 5000,
      maxBodyBytes: MAX_PLAYLIST_BYTES,
    });

    expect(result).toEqual({ outcome: "ok", text: "#EXTM3U\n" });
  });
});
