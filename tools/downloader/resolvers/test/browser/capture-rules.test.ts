/**
 * Unit tests for the pure parts of the sniffer: what counts as media, how hits
 * are ranked, what never reaches a log line, and the concurrency cap. No
 * browser, so these run in milliseconds and pin the rules the slow tests only
 * exercise incidentally.
 */

import { AppError, REDACTED, redactHeaders, redactUrl } from "@downloader/contract";
import type { BrowserContext } from "playwright";
import { describe, expect, test } from "vitest";
import {
  AGE_MARKERS,
  classifyFailure,
  classifyNavigationError,
} from "../../src/browser/classify.ts";
import { AGE_GATE_TEXT, AGE_NEGATIONS, AGE_NUMBER, CLOSE_TEXT } from "../../src/browser/provoke.ts";
import { DrmObserver, drmInitScript, toDrmSystem } from "../../src/browser/drm.ts";
import {
  classifyMedia,
  expiresAtFromUrl,
  isDeniedUrl,
  normaliseUrl,
  responseFileSize,
} from "../../src/browser/media-match.ts";
import { HitCollector } from "../../src/browser/intercept.ts";
import { Semaphore } from "../../src/browser/pool.ts";
import { rankHits } from "../../src/browser/rank.ts";
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
    // `00003.mp4` used to be asserted a segment here. A name alone cannot say so
    // (dl-78): it is `progressive` per request, and `rankHits` demotes it when the
    // capture holds evidence of segmented playback — see its describe at the end.
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

  test("redactUrl drops the signed query", () => {
    expect(redactUrl("https://cdn.example/v.m3u8?token=secret")).toBe(
      `https://cdn.example/v.m3u8?${REDACTED}`,
    );
    expect(redactUrl("https://cdn.example/v.m3u8")).toBe("https://cdn.example/v.m3u8");
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

describe("page-interaction labels (dl-48)", () => {
  const AGE_LABELS = [
    "I am 18 or older",
    "I'm over 18",
    "Yes, I am 18+",
    "I am 21 or older",
    "Мне уже есть 18",
    "Мне есть 18 лет",
    "Ich bin über 18",
    "J'ai plus de 18 ans",
    "Tengo más de 18 años",
    "Ho più di 18 anni",
    "Tenho mais de 18 anos",
    "Ik ben 18 jaar of ouder",
    "Jag är över 18",
    "Mam ukończone 18 lat",
  ];

  test.each(AGE_LABELS)("%s is an age label", (label) => {
    expect(AGE_GATE_TEXT.test(label)).toBe(true);
  });

  test.each([
    "18+",
    "18+ 12:21",
    "Watch now",
    "I am 17",
    "This video is for viewers who are 18 or older.",
  ])("%s is not", (label) => {
    expect(AGE_GATE_TEXT.test(label)).toBe(false);
  });

  test("no age label carries a marker, or every label would vouch for itself", () => {
    for (const label of AGE_LABELS) {
      const lower = label.toLowerCase();
      expect(AGE_MARKERS.filter((marker) => lower.includes(marker))).toEqual([]);
    }
  });

  test.each([
    "Close",
    "Close popup",
    "Close dialog",
    "×",
    "Закрыть попап",
    "Schließen",
    "No thanks",
  ])("%s is a close control", (label) => {
    expect(CLOSE_TEXT.test(label)).toBe(true);
  });

  test.each([
    "Watch now",
    "Смотреть",
    "Subscribe",
    "Closed captions",
    "Close account",
    "Close ticket",
  ])("%s is not a close control", (label) => {
    expect(CLOSE_TEXT.test(label)).toBe(false);
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
    ageGate: false,
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

  test("an age gate nobody pressed is named as such, with the marker that made it one", () => {
    const error = classifyFailure({
      ...base,
      ageGate: true,
      bodyText: "This video is for adults only.",
    });
    expect(error.code).toBe("AGE_CONFIRMATION_REQUIRED");
    expect(error.details?.["marker"]).toBe("adults only");
    expect(error.retryable).toBe(false);
  });

  test("a login wall in front of an age gate is the more fundamental answer", () => {
    expect(
      classifyFailure({ ...base, ageGate: true, finalUrl: "https://site.example/login" }).code,
    ).toBe("AUTH_REQUIRED");
  });

  test("a bot challenge in front of an age gate is the more fundamental answer", () => {
    expect(classifyFailure({ ...base, ageGate: true, title: "Just a moment..." }).code).toBe(
      "BOT_CHALLENGE",
    );
  });

  test("an age gate outranks a region marker on the same page", () => {
    expect(
      classifyFailure({ ...base, ageGate: true, bodyText: "Not available in your country." }).code,
    ).toBe("AGE_CONFIRMATION_REQUIRED");
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

describe("classifyNavigationError", () => {
  const URL_UNDER_TEST = "https://cdn.internal.example/watch";

  /**
   * Verbatim, and that matters. Produced on 2026-09-03 by launching the
   * Chromium this repo pins and navigating it to a self-signed loopback HTTPS
   * origin; the call log is part of what Playwright re-throws and is kept so
   * the ordering claim below is tested against the real shape rather than a
   * tidied one.
   */
  const CHROMIUM_MESSAGE =
    "page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://127.0.0.1:40799/page.html\n" +
    'Call log:\n  - navigating to "https://127.0.0.1:40799/page.html", waiting until "domcontentloaded"\n';

  test("a refused certificate is TLS_VERIFICATION_FAILED, not UNREACHABLE", () => {
    const error = classifyNavigationError(new Error(CHROMIUM_MESSAGE), URL_UNDER_TEST);
    expect(error.code).toBe("TLS_VERIFICATION_FAILED");
    // Named rather than merely asserted: `UNREACHABLE` is what this returned
    // before dl-34, and it is retryable, so the operator was told to try again
    // for a failure that will never change on its own.
    expect(error.code).not.toBe("UNREACHABLE");
    expect(error.retryable).toBe(false);
  });

  test("names the setting for the operator, in details rather than in the message", () => {
    const error = classifyNavigationError(new Error(CHROMIUM_MESSAGE), URL_UNDER_TEST);
    expect(error.details?.["hint"]).toContain("EGRESS_CA_FILE");
    expect(error.details?.["reason"]).toBe("ERR_CERT_AUTHORITY_INVALID");
    expect(error.message).not.toContain("EGRESS_CA_FILE");
    expect(error.details?.["url"]).toBe(redactUrl(URL_UNDER_TEST));
  });

  test("reads the family, not the one member a self-signed fixture can produce", () => {
    // An untrusted issuer is decided before expiry or a name mismatch, so every
    // certificate a fixture here can serve reports AUTHORITY_INVALID — measured,
    // across a self-signed, an expired and a wrong-SAN certificate. A classifier
    // keyed on that one string would pass the test above and miss the rest of
    // the family on a deployment where the root *is* trusted.
    for (const code of [
      "ERR_CERT_DATE_INVALID",
      "ERR_CERT_COMMON_NAME_INVALID",
      "ERR_CERT_REVOKED",
      "ERR_CERT_WEAK_SIGNATURE_ALGORITHM",
    ]) {
      const error = classifyNavigationError(new Error(`page.goto: net::${code} at …`), "https://x");
      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      expect(error.details?.["reason"]).toBe(code);
    }
  });

  test("a certificate error wins over the word timeout in the same message", () => {
    // Playwright appends a call log, so both can appear in one string. A message
    // naming an ERR_CERT_* is a certificate failure whatever else it says.
    const error = classifyNavigationError(
      new Error("page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://x\nCall log: timeout 30000"),
      URL_UNDER_TEST,
    );
    expect(error.code).toBe("TLS_VERIFICATION_FAILED");
  });

  test("leaves everything it did not recognise exactly where it was", () => {
    // The under-matching direction. These are the branches dl-34 must not move.
    expect(
      classifyNavigationError(new Error("Timeout 30000ms exceeded"), URL_UNDER_TEST).code,
    ).toBe("TIMEOUT");
    expect(
      classifyNavigationError(new Error("net::ERR_NAME_NOT_RESOLVED"), URL_UNDER_TEST).code,
    ).toBe("UNREACHABLE");
    expect(
      classifyNavigationError(new Error("net::ERR_CONNECTION_REFUSED"), URL_UNDER_TEST).code,
    ).toBe("UNREACHABLE");
    expect(
      classifyNavigationError(new Error("net::ERR_SSL_PROTOCOL_ERROR"), URL_UNDER_TEST).code,
    ).toBe("UNREACHABLE");
    // Deliberately excluded by the trailing underscore: a private root cannot
    // cause it, and the hint would be wrong advice.
    expect(
      classifyNavigationError(
        new Error("net::ERR_CERTIFICATE_TRANSPARENCY_REQUIRED"),
        URL_UNDER_TEST,
      ).code,
    ).toBe("UNREACHABLE");
  });

  test("an AppError still passes straight through", () => {
    const raised = new AppError("BLOCKED_TARGET", undefined, {});
    expect(classifyNavigationError(raised, URL_UNDER_TEST)).toBe(raised);
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
    await expect(queued).rejects.toMatchObject({ code: "CANCELED" });
    release();
    expect(semaphore.active).toBe(0);
  });

  test("a queued acquire that runs out of budget is a TIMEOUT, not a cancel", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    const queued = semaphore.acquire(AbortSignal.timeout(5));
    await expect(queued).rejects.toMatchObject({ code: "TIMEOUT" });
    release();
    expect(semaphore.active).toBe(0);
  });
});

describe("a progressive file is not a segment by its name or a ranged answer (dl-78)", () => {
  test("a numeric id or a resolution suffix does not classify a request as a segment", () => {
    for (const url of [
      "https://cdn.example/v/839201.mp4",
      "https://cdn.example/media/clip-720.mp4",
      "https://cdn.example/media/movie_1080.mp4",
      "https://cdn.example/v/00003.mp4",
    ]) {
      expect(classifyMedia({ url, contentType: "video/mp4", contentLength: 5_000_000 })).toBe(
        "progressive",
      );
    }
  });

  test("a name that says chunk still does, without any neighbour", () => {
    expect(classifyMedia({ url: "https://cdn.example/v/init.mp4", contentLength: 5_000_000 })).toBe(
      "segment",
    );
    expect(
      classifyMedia({ url: "https://cdn.example/v/seg-1.mp4", contentLength: 5_000_000 }),
    ).toBe("segment");
  });

  test("responseFileSize reads the total from Content-Range on a 206, not the chunk", () => {
    expect(
      responseFileSize(
        { "content-length": "262144", "content-range": "bytes 0-262143/5242880" },
        206,
      ),
    ).toBe(5_242_880);
    // The same chunk length with no total is unknown, not 256 KB.
    expect(
      responseFileSize({ "content-length": "262144", "content-range": "bytes 0-262143/*" }, 206),
    ).toBeUndefined();
    expect(responseFileSize({ "content-length": "262144" }, 206)).toBeUndefined();
  });

  test("responseFileSize still takes Content-Length from a plain 200", () => {
    expect(responseFileSize({ "content-length": "5242880" }, 200)).toBe(5_242_880);
    expect(responseFileSize({}, 200)).toBeUndefined();
    expect(responseFileSize({ "content-length": "nonsense" }, 200)).toBeUndefined();
  });

  test("a 206's chunk length does not decide the size demotion; its Content-Range total does", () => {
    const url = "https://cdn.example/media/lecture.mp4";
    const chunk = { "content-length": "262144", "content-range": "bytes 0-262143/5242880" };
    const whole = classifyMedia({
      url,
      contentType: "video/mp4",
      contentLength: responseFileSize(chunk, 206),
    });
    expect(whole).toBe("progressive");
    // The old reading of the same response, so the test can fail.
    expect(classifyMedia({ url, contentType: "video/mp4", contentLength: 262_144 })).toBe(
      "segment",
    );
    // A file that really is tiny is still demoted, by its total.
    const tiny = { "content-length": "1024", "content-range": "bytes 0-1023/1024" };
    expect(
      classifyMedia({ url, contentType: "video/mp4", contentLength: responseFileSize(tiny, 206) }),
    ).toBe("segment");
  });

  describe("rankHits with a numbered name", () => {
    const page = "https://site.example/watch";

    test("keeps a lone numbered file", () => {
      const ranked = rankHits(
        [
          hit({
            url: "https://cdn.example/media/clip-720.mp4",
            kind: "progressive",
            contentLength: 5_000_000,
          }),
        ],
        page,
      );
      expect(ranked.map((entry) => entry.url)).toEqual(["https://cdn.example/media/clip-720.mp4"]);
    });

    test("keeps two numbered files side by side, which are two qualities of one video", () => {
      const ranked = rankHits(
        [
          hit({ url: "https://cdn.example/media/clip-720.mp4", kind: "progressive", seq: 0 }),
          hit({ url: "https://cdn.example/media/clip-1080.mp4", kind: "progressive", seq: 1 }),
        ],
        page,
      );
      expect(ranked).toHaveLength(2);
    });

    test("drops a numbered chunk when a manifest is in the capture", () => {
      // The reason the rule exists: fMP4 segments served as `.mp4`.
      const ranked = rankHits(
        [
          hit({ url: "https://cdn.example/v/index.m3u8", kind: "hls", seq: 0 }),
          hit({ url: "https://cdn.example/v/00003.mp4", kind: "progressive", seq: 1 }),
        ],
        page,
      );
      expect(ranked.map((entry) => entry.kind)).toEqual(["hls"]);
    });

    test("drops a numbered chunk beside a chunk-named neighbour in its directory", () => {
      const ranked = rankHits(
        [
          hit({ url: "https://cdn.example/v/init.mp4", kind: "segment", seq: 0 }),
          hit({ url: "https://cdn.example/v/00003.mp4", kind: "progressive", seq: 1 }),
        ],
        page,
      );
      expect(ranked).toHaveLength(0);
    });

    test("keeps a numbered file whose chunk-named neighbour is in another directory", () => {
      const ranked = rankHits(
        [
          hit({ url: "https://cdn.example/ads/init.mp4", kind: "segment", seq: 0 }),
          hit({ url: "https://cdn.example/v/clip-720.mp4", kind: "progressive", seq: 1 }),
        ],
        page,
      );
      expect(ranked.map((entry) => entry.url)).toEqual(["https://cdn.example/v/clip-720.mp4"]);
    });
  });

  describe("HitCollector", () => {
    const FILE = "https://cdn.example/media/lecture.mp4";

    /** What `attach` subscribes to, and the two response shapes a ranged player produces. */
    function harness(): {
      collector: HitCollector;
      respond: (headers: Record<string, string>, status: number) => void;
    } {
      const handlers = new Map<string, (arg: unknown) => void>();
      // The collector reads four members of a context and a handful of a request
      // and a response; a structural stand-in is the whole of what it touches.
      const context = {
        on: (event: string, handler: (arg: unknown) => void) => {
          handlers.set(event, handler);
        },
      } as unknown as BrowserContext;
      const collector = new HitCollector();
      collector.attach(context);

      const request = {
        url: () => FILE,
        headers: () => ({ range: "bytes=0-" }),
        allHeaders: async () => ({ range: "bytes=0-" }),
        frame: () => ({ url: () => "https://site.example/watch" }),
      };
      return {
        collector,
        respond: (headers, status) => {
          handlers.get("response")?.({
            url: () => FILE,
            headers: () => headers,
            status: () => status,
            request: () => request,
            text: async () => "",
          });
        },
      };
    }

    test("a small response after a confirmed large one does not turn the file into a segment", () => {
      const { collector, respond } = harness();
      respond({ "content-type": "video/mp4", "content-length": "5242880" }, 200);
      expect(collector.hits[0]?.kind).toBe("progressive");

      // The same URL answered again, this time as a 200 with a tiny body: the
      // shape that reaches `#record` as `segment` whatever the header parsing says.
      respond({ "content-type": "video/mp4", "content-length": "1024" }, 200);

      expect(collector.hits).toHaveLength(1);
      expect(collector.hits[0]?.kind).toBe("progressive");
      expect(collector.hits[0]?.confirmed).toBe(true);
    });

    test("a first response that is small still demotes an unconfirmed request", () => {
      const { collector, respond } = harness();
      respond({ "content-type": "video/mp4", "content-length": "1024" }, 200);
      expect(collector.hits[0]?.kind).toBe("segment");
    });

    test("a 206 records the file's total from Content-Range as the hit's size", () => {
      const { collector, respond } = harness();
      respond(
        {
          "content-type": "video/mp4",
          "content-length": "262144",
          "content-range": "bytes 0-262143/5242880",
        },
        206,
      );
      expect(collector.hits[0]?.kind).toBe("progressive");
      expect(collector.hits[0]?.contentLength).toBe(5_242_880);
    });
  });
});

// The tokeniser `AGE_CHOOSE_FN` runs in-page, restated: a label's words,
// lowercased, split on anything that is not a letter or a digit.
function negated(label: string): boolean {
  return label
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => AGE_NEGATIONS.includes(word));
}

describe("structural age-gate rules (dl-83)", () => {
  test.each([
    "Ho 18 anni o più - Entra",
    "18+",
    "+18",
    "Enter (21+)",
    "Ich bin 18 Jahre oder älter",
    "I am 18 or older.",
    "Мне есть 18",
  ])("%s names an age", (label) => {
    expect(AGE_NUMBER.test(label)).toBe(true);
  });

  test.each([
    "Get 18% off",
    "€18 a month",
    "$21",
    "Since 2018",
    "Version 1.18",
    "Starts at 21:00",
    "Ends 18h30",
    "118 videos",
    "Page 180",
  ])("%s does not", (label) => {
    expect(AGE_NUMBER.test(label)).toBe(false);
  });

  // Every entry label the fixtures and dl-48 use must survive the negation
  // rule, or the press would drop the very control it exists to choose.
  test.each([
    "Ho 18 anni o più - Entra",
    "I am 18 or older - Enter",
    "I am 18 or older",
    "I'm over 18",
    "Yes, I am 18+",
    "I am 21 or older",
    "Мне уже есть 18",
    "Мне есть 18 лет",
    "Ich bin über 18",
    "J'ai plus de 18 ans",
    "Tengo más de 18 años",
    "Ho più di 18 anni",
    "Tenho mais de 18 anos",
    "Ik ben 18 jaar of ouder",
    "Jag är över 18",
    "Mam ukończone 18 lat",
  ])("%s is an entry", (label) => {
    expect(negated(label)).toBe(false);
  });

  test.each([
    "Ho meno di 18 anni - Esci",
    "I am under 18",
    "I'm not 18",
    "No, I am younger than 18",
    "Мне нет 18",
    "Мне меньше 18 лет",
    "Ich bin unter 18",
    "Ich bin nicht 18",
    "J'ai moins de 18 ans",
    "Je n'ai pas 18 ans",
    "Tengo menos de 18 años",
    "Soy menor de 18",
    "Não tenho 18 anos",
    "Ik ben jonger dan 18",
    "Jag är under 18",
    "Jag är inte 18",
    "Mam mniej niż 18 lat",
    "Nie mam 18 lat",
  ])("%s is an exit", (label) => {
    expect(negated(label)).toBe(true);
  });

  test("the negation list is lowercase single words, as the tokeniser compares them", () => {
    for (const word of AGE_NEGATIONS) {
      expect(word).toBe(word.toLowerCase());
      expect(word).toMatch(/^[\p{L}\p{N}]+$/u);
    }
  });
});
