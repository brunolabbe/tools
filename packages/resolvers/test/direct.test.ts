import { readFileSync } from "node:fs";
import { AppError } from "@downloader/shared";
import type { ResolveOptions } from "@downloader/shared";
import { describe, expect, test } from "vitest";
import { classify, DirectUrlResolver } from "../src/resolvers/direct.ts";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/manifests/${name}`, import.meta.url), "utf8");
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

interface Stub {
  fetch: typeof globalThis.fetch;
  calls: Call[];
}

function stubFetch(handler: (call: Call) => Response): Stub {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key] = String(value);
    }
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers };
    calls.push(call);
    return await Promise.resolve(handler(call));
  };
  return { fetch, calls };
}

function options(overrides: Partial<ResolveOptions> = {}): ResolveOptions {
  return { timeoutMs: 5000, signal: AbortSignal.timeout(5000), ...overrides };
}

describe("content-type and extension classification", () => {
  test("prefers Content-Type", () => {
    expect(classify("application/vnd.apple.mpegurl", undefined)).toBe("hls");
    expect(classify("application/x-mpegURL; charset=utf-8", undefined)).toBe("hls");
    expect(classify("application/dash+xml", undefined)).toBe("dash");
    expect(classify("video/mp4", undefined)).toBe("progressive");
  });

  test("falls back to the path extension when the CDN says octet-stream", () => {
    expect(classify("application/octet-stream", "m3u8")).toBe("hls");
    expect(classify("application/octet-stream", "mpd")).toBe("dash");
    expect(classify("text/plain", "mp4")).toBe("progressive");
    expect(classify("binary/octet-stream", "webm")).toBe("progressive");
  });

  test("gives up when neither says anything", () => {
    expect(classify("text/html", undefined)).toBeUndefined();
    expect(classify("text/html", "html")).toBeUndefined();
  });
});

describe("HLS manifest URLs", () => {
  test("fetches and parses the playlist into variants", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/vnd.apple.mpegurl" } })
        : new Response(fixture("hls-master-multibitrate.m3u8"), {
            headers: { "content-type": "application/vnd.apple.mpegurl" },
          }),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(
      new URL("https://cdn.example.com/hls/2026/master.m3u8"),
      options(),
    );

    expect(probe.resolver).toBe("direct");
    expect(probe.variants).toHaveLength(5);
    expect(probe.variants[0]?.height).toBe(1080);
    expect(probe.title).toBe("master");
    expect(probe.drm.protected).toBe(false);
    expect(stub.calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  test("replays the caller's cookie and locale on every request", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/x-mpegURL" } })
        : new Response(fixture("hls-media-aes128.m3u8"), {
            headers: { "content-type": "application/x-mpegURL" },
          }),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    await resolver.resolve(
      new URL("https://cdn.example.com/courses/lesson-42/index.m3u8"),
      options({ cookieHeader: "session=abc123", locale: "fr-CA" }),
    );

    for (const call of stub.calls) {
      expect(call.headers["Cookie"]).toBe("session=abc123");
      expect(call.headers["Accept-Language"]).toBe("fr-CA");
      expect(call.headers["Referer"]).toBe("https://cdn.example.com/");
      expect(call.headers["User-Agent"]).toContain("Mozilla/5.0");
    }
  });

  test("strips CRLF out of caller-supplied header values", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/x-mpegURL" } })
        : new Response(fixture("hls-media-aes128.m3u8")),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    await resolver.resolve(
      new URL("https://cdn.example.com/a/index.m3u8"),
      options({ cookieHeader: "a=1\r\nX-Injected: yes" }),
    );

    expect(stub.calls[0]?.headers["Cookie"]).toBe("a=1 X-Injected: yes");
  });

  test("the request context handed on for download carries those headers", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/x-mpegURL" } })
        : new Response(fixture("hls-media-aes128.m3u8")),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(
      new URL("https://cdn.example.com/a/index.m3u8"),
      options({ cookieHeader: "session=abc123", proxyUrl: "http://proxy.internal:3128" }),
    );

    expect(probe.requestContext.headers["Cookie"]).toBe("session=abc123");
    expect(probe.requestContext.proxyUrl).toBe("http://proxy.internal:3128");
  });
});

describe("DASH manifest URLs", () => {
  test("parses an MPD served as application/dash+xml", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/dash+xml" } })
        : new Response(fixture("dash-number-template.mpd"), {
            headers: { "content-type": "application/dash+xml" },
          }),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(
      new URL("https://cdn.example.com/vod/tears-of-steel/manifest.mpd"),
      options(),
    );

    expect(probe.variants).toHaveLength(4);
    expect(probe.durationSec).toBeCloseTo(634.6, 3);
    expect(probe.isLive).toBe(false);
  });

  test("a Widevine MPD stops the chain with DRM_PROTECTED", async () => {
    const stub = stubFetch((call) =>
      call.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "application/dash+xml" } })
        : new Response(fixture("dash-widevine.mpd")),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    await expect(
      resolver.resolve(new URL("https://drm.example.net/wv/manifest.mpd"), options()),
    ).rejects.toMatchObject({ code: "DRM_PROTECTED" });
  });
});

describe("progressive files", () => {
  test("builds one variant with the measured size and a decoded title", async () => {
    const stub = stubFetch(
      () =>
        new Response(null, {
          headers: { "content-type": "video/mp4", "content-length": "734003200" },
        }),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(
      new URL("https://files.example.com/talks/Keynote%20Recording_2026.mp4"),
      options(),
    );

    expect(probe.title).toBe("Keynote Recording 2026");
    expect(probe.variants).toHaveLength(1);
    expect(probe.variants[0]).toMatchObject({
      protocol: "progressive",
      container: "mp4",
      filesizeBytes: 734_003_200,
      filesizeIsEstimate: false,
      hasVideo: true,
    });
    expect(probe.variants[0]?.label).toBe("700 MB");
    expect(stub.calls).toHaveLength(1);
  });

  test("an audio-only content type is reported as audio-only", async () => {
    const stub = stubFetch(
      () =>
        new Response(null, {
          headers: { "content-type": "audio/mpeg", "content-length": "5242880" },
        }),
    );
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(new URL("https://files.example.com/ep12.mp3"), options());
    expect(probe.variants[0]?.hasVideo).toBe(false);
    expect(probe.variants[0]?.label).toBe("Audio only · 5 MB");
  });
});

describe("fallthrough and failure mapping", () => {
  test("an HTML page is NO_MEDIA_FOUND so the chain can continue", async () => {
    const stub = stubFetch(() => new Response(null, { headers: { "content-type": "text/html" } }));
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    await expect(
      resolver.resolve(new URL("https://news.example.com/story"), options()),
    ).rejects.toMatchObject({ code: "NO_MEDIA_FOUND" });
  });

  test("a server that rejects HEAD is retried with a one-byte ranged GET", async () => {
    const stub = stubFetch((call) => {
      if (call.method === "HEAD") return new Response(null, { status: 405 });
      if (call.headers["Range"] === "bytes=0-0") {
        return new Response("x", {
          status: 206,
          headers: {
            "content-type": "application/octet-stream",
            "content-range": "bytes 0-0/104857600",
          },
        });
      }
      return new Response("unexpected", { status: 500 });
    });
    const resolver = new DirectUrlResolver({ fetch: stub.fetch });

    const probe = await resolver.resolve(new URL("https://cdn.example.com/a/clip.mp4"), options());
    expect(probe.variants[0]?.filesizeBytes).toBe(104_857_600);
    expect(stub.calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  test("401 is AUTH_REQUIRED and 429 is RATE_LIMITED", async () => {
    const unauthorised = new DirectUrlResolver({
      fetch: stubFetch(() => new Response(null, { status: 401 })).fetch,
    });
    await expect(
      unauthorised.resolve(new URL("https://x.example/a.m3u8"), options()),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    const throttled = new DirectUrlResolver({
      fetch: stubFetch(() => new Response(null, { status: 429 })).fetch,
    });
    await expect(
      throttled.resolve(new URL("https://x.example/a.m3u8"), options()),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("a transport failure is UNREACHABLE", async () => {
    const resolver = new DirectUrlResolver({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await expect(
      resolver.resolve(new URL("https://nowhere.example/a.m3u8"), options()),
    ).rejects.toMatchObject({ code: "UNREACHABLE" });
  });

  test("an aborted fetch is a TIMEOUT, not an internal error", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const resolver = new DirectUrlResolver({ fetch: () => Promise.reject(abortError) });
    const error = await resolver
      .resolve(new URL("https://slow.example/a.m3u8"), options())
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("TIMEOUT");
  });

  test("only http(s) is handled", () => {
    const resolver = new DirectUrlResolver();
    expect(resolver.canHandle(new URL("https://example.com/a.m3u8"))).toBe(true);
    expect(resolver.canHandle(new URL("http://example.com/a.m3u8"))).toBe(true);
    expect(resolver.canHandle(new URL("file:///etc/passwd"))).toBe(false);
    expect(resolver.canHandle(new URL("data:text/plain,hi"))).toBe(false);
    expect(resolver.priority).toBe(90);
  });
});
