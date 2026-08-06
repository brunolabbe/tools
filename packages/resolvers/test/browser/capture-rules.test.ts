/**
 * Unit tests for the pure parts of the sniffer: what counts as media, how hits
 * are ranked, what never reaches a log line, and the concurrency cap. No
 * browser, so these run in milliseconds and pin the rules the slow tests only
 * exercise incidentally.
 */

import { describe, expect, test } from "vitest";
import { classifyFailure } from "../../src/browser/classify.ts";
import { DrmObserver, drmInitScript, toDrmSystem } from "../../src/browser/drm.ts";
import {
  classifyMedia,
  expiresAtFromUrl,
  isDeniedUrl,
  normaliseUrl,
} from "../../src/browser/media-match.ts";
import { Semaphore } from "../../src/browser/pool.ts";
import { rankHits } from "../../src/browser/rank.ts";
import { REDACTED, describeUrl, redactHeaders } from "../../src/browser/redact.ts";
import { buildRequestContext } from "../../src/browser/request-context.ts";
import type { NetworkHit } from "../../src/browser/types.ts";

function hit(overrides: Partial<NetworkHit> & Pick<NetworkHit, "url" | "kind">): NetworkHit {
  return {
    key: normaliseUrl(overrides.url),
    headers: {},
    seq: 0,
    confirmed: true,
    ...overrides,
  };
}

describe("classifyMedia", () => {
  test("matches manifests by extension", () => {
    expect(classifyMedia({ url: "https://cdn.example/x/master.m3u8" })).toBe("hls");
    expect(classifyMedia({ url: "https://cdn.example/x/manifest.mpd" })).toBe("dash");
  });

  test("matches manifests with no extension at all, by Content-Type", () => {
    // The case extension matching silently misses: signed, query-only URLs.
    expect(
      classifyMedia({
        url: "https://cdn.example/hls?token=abc&expires=123",
        contentType: "application/vnd.apple.mpegurl",
      }),
    ).toBe("hls");
    expect(
      classifyMedia({
        url: "https://cdn.example/stream/9f3a",
        contentType: "application/dash+xml; charset=utf-8",
      }),
    ).toBe("dash");
    expect(
      classifyMedia({ url: "https://cdn.example/x-mpegurl-thing", contentType: "audio/x-mpegurl" }),
    ).toBe("hls");
  });

  test("keeps a Content-Type verdict when the extension disagrees", () => {
    expect(
      classifyMedia({
        url: "https://cdn.example/playlist.m3u8",
        contentType: "application/octet-stream",
      }),
    ).toBe("hls");
  });

  test("demotes fMP4 chunks so they are never offered as a download", () => {
    expect(classifyMedia({ url: "https://cdn.example/v/init.mp4" })).toBe("segment");
    expect(classifyMedia({ url: "https://cdn.example/v/seg-00042.m4s" })).toBe("segment");
    expect(classifyMedia({ url: "https://cdn.example/v/chunk-9.mp4" })).toBe("segment");
    expect(classifyMedia({ url: "https://cdn.example/v/00003.mp4" })).toBe("segment");
    expect(classifyMedia({ url: "https://cdn.example/v/talk.mp4", contentLength: 900 })).toBe(
      "segment",
    );
    expect(
      classifyMedia({ url: "https://cdn.example/v/talk.mp4", contentLength: 80_000_000 }),
    ).toBe("progressive");
  });

  test("ignores everything that is not media", () => {
    expect(classifyMedia({ url: "https://example.com/app.js" })).toBeUndefined();
    expect(
      classifyMedia({ url: "https://example.com/a.png", contentType: "image/png" }),
    ).toBeUndefined();
    expect(classifyMedia({ url: "blob:https://example.com/6c1f0e2a" })).toBeUndefined();
  });
});

describe("isDeniedUrl", () => {
  test("drops ad networks and analytics beacons", () => {
    expect(isDeniedUrl("https://securepubads.g.doubleclick.net/gampad/ads?x=1")).toBe(true);
    expect(isDeniedUrl("https://www.google-analytics.com/collect")).toBe(true);
    expect(isDeniedUrl("https://imasdk.googleapis.com/js/sdkloader/ima3.js")).toBe(true);
    expect(isDeniedUrl("https://cdn.example.com/pagead/preroll.mp4")).toBe(true);
    expect(isDeniedUrl("https://cdn.example.com/video/master.m3u8")).toBe(false);
  });

  test("drops non-http schemes, blob: included", () => {
    expect(isDeniedUrl("blob:https://example.com/6c1f")).toBe(true);
    expect(isDeniedUrl("data:video/mp4;base64,AAAA")).toBe(true);
  });
});

describe("normaliseUrl", () => {
  test("keeps the signed query, which is part of the identity", () => {
    const signed = "https://cdn.example/v.m3u8?token=abc&expires=1";
    expect(normaliseUrl(signed)).toBe(signed);
  });

  test("collapses only what is genuinely equivalent", () => {
    expect(normaliseUrl("https://CDN.Example:443/v.m3u8#t=10")).toBe("https://cdn.example/v.m3u8");
  });
});

describe("expiresAtFromUrl", () => {
  test("reads a unix-seconds expiry", () => {
    expect(expiresAtFromUrl("https://cdn.example/v.m3u8?expires=4102444800")).toBe(
      "2100-01-01T00:00:00.000Z",
    );
  });

  test("reads an AWS presigned window", () => {
    expect(
      expiresAtFromUrl(
        "https://s3.example/v.mp4?X-Amz-Date=20260805T120000Z&X-Amz-Expires=300&X-Amz-Signature=ab",
      ),
    ).toBe("2026-08-05T12:05:00.000Z");
  });

  test("says nothing when there is nothing to say", () => {
    expect(expiresAtFromUrl("https://cdn.example/v.m3u8")).toBeUndefined();
    expect(expiresAtFromUrl("https://cdn.example/v.m3u8?expires=nonsense")).toBeUndefined();
  });
});

describe("rankHits", () => {
  const page = "https://site.example/watch";

  test("prefers the master playlist over the variant it names", () => {
    const ranked = rankHits(
      [
        hit({ url: "https://cdn.example/v/master.m3u8", kind: "hls", seq: 0 }),
        hit({ url: "https://cdn.example/v/720p.m3u8", kind: "hls", seq: 1 }),
      ],
      page,
    );
    expect(ranked[0]?.url).toBe("https://cdn.example/v/master.m3u8");
  });

  test("prefers an adaptive manifest over a progressive file", () => {
    const ranked = rankHits(
      [
        hit({
          url: "https://cdn.example/v/talk.mp4",
          kind: "progressive",
          seq: 0,
          contentLength: 900_000_000,
        }),
        hit({ url: "https://cdn.example/v/index.m3u8", kind: "hls", seq: 1 }),
      ],
      page,
    );
    expect(ranked[0]?.kind).toBe("hls");
  });

  test("prefers the larger file when only progressive files are on offer", () => {
    const ranked = rankHits(
      [
        hit({
          url: "https://cdn.example/trailer.mp4",
          kind: "progressive",
          seq: 0,
          contentLength: 2_000_000,
        }),
        hit({
          url: "https://cdn.example/feature.mp4",
          kind: "progressive",
          seq: 1,
          contentLength: 800_000_000,
        }),
      ],
      page,
    );
    expect(ranked[0]?.url).toBe("https://cdn.example/feature.mp4");
  });

  test("never offers a segment as a variant", () => {
    const ranked = rankHits(
      [hit({ url: "https://cdn.example/v/seg-1.m4s", kind: "segment", seq: 0 })],
      page,
    );
    expect(ranked).toHaveLength(0);
  });
});

describe("DRM detection", () => {
  test("maps every key system we can name", () => {
    expect(toDrmSystem("com.widevine.alpha")).toBe("widevine");
    expect(toDrmSystem("com.microsoft.playready.recommendation")).toBe("playready");
    expect(toDrmSystem("com.apple.fps.1_0")).toBe("fairplay");
    expect(toDrmSystem("org.w3.clearkey")).toBe("clearkey");
    expect(toDrmSystem("com.example.something")).toBe("unknown");
  });

  test("names the evidence and is not retryable", () => {
    const observer = new DrmObserver();
    observer.record("com.widevine.alpha");
    const error = observer.toError();
    expect(error.code).toBe("DRM_PROTECTED");
    expect(error.retryable).toBe(false);
    expect(observer.toDrmInfo().evidence).toContain("com.widevine.alpha");
  });

  test("ignores junk reported from the page", () => {
    const observer = new DrmObserver();
    observer.recordAll(["", null, 42, "x".repeat(500)]);
    expect(observer.detected).toBe(false);
  });

  test("the init script observes rather than blocks", () => {
    const script = drmInitScript();
    expect(script).toContain("requestMediaKeySystemAccess");
    // If this ever stops calling through, the page's player stops working and
    // the probe measures something that never happened.
    expect(script).toContain("return original(keySystem, configurations)");
  });
});

describe("redaction", () => {
  test("never lets a session credential reach a log line", () => {
    const redacted = redactHeaders({
      Cookie: "session=super-secret",
      Authorization: "Bearer abc.def",
      Referer: "https://site.example/watch",
    });
    expect(redacted["Cookie"]).toBe(REDACTED);
    expect(redacted["Authorization"]).toBe(REDACTED);
    expect(redacted["Referer"]).toBe("https://site.example/watch");
  });

  test("describeUrl drops the signed query", () => {
    expect(describeUrl("https://cdn.example/v.m3u8?token=secret")).toBe(
      "https://cdn.example/v.m3u8",
    );
  });
});

describe("buildRequestContext", () => {
  test("keeps what the CDN checks and drops what describes the socket", () => {
    const context = buildRequestContext({
      hit: hit({
        url: "https://cdn.example/v/master.m3u8",
        kind: "hls",
        headers: {
          referer: "https://site.example/watch",
          cookie: "sid=1",
          host: "cdn.example",
          "accept-encoding": "gzip, br",
          "content-length": "0",
          ":authority": "cdn.example",
        },
      }),
      pageUrl: "https://site.example/watch",
      userAgent: "UA/1.0",
      acceptLanguage: "en-US,en;q=0.8",
    });

    expect(context.headers["Referer"]).toBe("https://site.example/watch");
    expect(context.headers["Cookie"]).toBe("sid=1");
    expect(context.headers["User-Agent"]).toBe("UA/1.0");
    // Cross-origin media request, so Origin is supplied.
    expect(context.headers["Origin"]).toBe("https://site.example");
    expect(context.headers["Host"]).toBeUndefined();
    expect(context.headers["Accept-Encoding"]).toBeUndefined();
    expect(context.headers["Content-Length"]).toBeUndefined();
    expect(context.headers[":authority"]).toBeUndefined();
  });

  test("supplies a Referer when the capture had none", () => {
    const context = buildRequestContext({
      hit: hit({ url: "https://site.example/v.mp4", kind: "progressive" }),
      pageUrl: "https://site.example/watch",
      userAgent: "UA/1.0",
      acceptLanguage: "en-US",
      proxyUrl: "http://proxy.local:8080",
    });
    expect(context.headers["Referer"]).toBe("https://site.example/watch");
    expect(context.proxyUrl).toBe("http://proxy.local:8080");
  });
});

describe("classifyFailure", () => {
  const base = {
    finalUrl: "https://site.example/watch",
    title: "",
    bodyText: "",
    html: "",
    hasPasswordInput: false,
    hasPlayerElement: true,
    quietReached: true,
  };

  test("only NO_MEDIA_FOUND lets the registry fall through", () => {
    expect(classifyFailure(base).code).toBe("NO_MEDIA_FOUND");
  });

  test("an interstitial outranks the status code", () => {
    expect(classifyFailure({ ...base, status: 403, title: "Just a moment..." }).code).toBe(
      "BOT_CHALLENGE",
    );
  });

  test("a login route is a fact about the source", () => {
    expect(
      classifyFailure({ ...base, finalUrl: "https://site.example/login?next=/watch" }).code,
    ).toBe("AUTH_REQUIRED");
  });

  test("a password field where the player should be is a login wall", () => {
    expect(classifyFailure({ ...base, hasPasswordInput: true, hasPlayerElement: false }).code).toBe(
      "AUTH_REQUIRED",
    );
  });

  test("a sign-in box next to a working player is not", () => {
    expect(classifyFailure({ ...base, hasPasswordInput: true }).code).toBe("NO_MEDIA_FOUND");
  });

  test("region refusal is named as such", () => {
    expect(
      classifyFailure({ ...base, bodyText: "This video is not available in your country." }).code,
    ).toBe("GEO_BLOCKED");
  });

  test("still loading at the deadline is a timeout, not an absence", () => {
    expect(classifyFailure({ ...base, quietReached: false }).code).toBe("TIMEOUT");
  });

  test("a plain non-2xx is unreachable", () => {
    expect(classifyFailure({ ...base, status: 500 }).code).toBe("UNREACHABLE");
  });
});

describe("Semaphore", () => {
  test("caps concurrency and hands the slot to the next waiter", async () => {
    const semaphore = new Semaphore(2);
    const first = await semaphore.acquire();
    const second = await semaphore.acquire();
    expect(semaphore.active).toBe(2);

    let thirdHeld = false;
    const third = semaphore.acquire().then((release) => {
      thirdHeld = true;
      return release;
    });
    await Promise.resolve();
    expect(thirdHeld).toBe(false);

    first();
    const releaseThird = await third;
    expect(thirdHeld).toBe(true);
    expect(semaphore.active).toBe(2);

    second();
    releaseThird();
    expect(semaphore.active).toBe(0);
  });

  test("a queued acquire gives up when the caller aborts", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    const controller = new AbortController();
    const queued = semaphore.acquire(controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: "TIMEOUT" });
    release();
    expect(semaphore.active).toBe(0);
  });
});
