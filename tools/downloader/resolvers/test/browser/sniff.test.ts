/**
 * Recognising a manifest from its body (dl-79).
 *
 * No browser: the collector is handed a context that only records its
 * listeners, and responses that count how often their body is read. "Never
 * read" is the property that matters for the large and non-`fetch`/`xhr` cases,
 * and a real page cannot say how many times Playwright was asked for a body.
 */

import { AppError } from "@downloader/contract";
import type { BrowserContext, Response } from "playwright";
import { describe, expect, test } from "vitest";
import { classifyFailure, SEGMENTS_WITHOUT_MANIFEST } from "../../src/browser/classify.ts";
import { HitCollector } from "../../src/browser/intercept.ts";
import {
  isSniffable,
  MAX_SNIFF_BODY_BYTES,
  MAX_SNIFF_ENCODED_BYTES,
  MAX_SNIFFS_PER_PROBE,
  sniffManifestKind,
} from "../../src/browser/sniff.ts";
import type { SniffCandidate } from "../../src/browser/sniff.ts";

const MPD = `<?xml version="1.0" encoding="utf-8"?>
<!-- generated -->
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period/></MPD>
`;
const M3U8 = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg-1.ts\n#EXT-X-ENDLIST\n";

function candidate(overrides: Partial<SniffCandidate> = {}): SniffCandidate {
  return {
    url: "https://site.example/api/playlist?id=1",
    status: 200,
    resourceType: "fetch",
    contentType: "text/plain; charset=utf-8",
    contentLength: 512,
    ...overrides,
  };
}

describe("sniffManifestKind", () => {
  test("a body beginning <MPD is dash, with or without a prolog and comments", () => {
    expect(sniffManifestKind(MPD)).toBe("dash");
    expect(sniffManifestKind('<MPD type="static">')).toBe("dash");
    expect(sniffManifestKind('<ns:MPD xmlns:ns="urn:mpeg:dash:schema:mpd:2011">')).toBe("dash");
  });

  test("a body beginning #EXTM3U is hls, past a byte-order mark and blank lines", () => {
    expect(sniffManifestKind(M3U8)).toBe("hls");
    expect(sniffManifestKind(`\uFEFF\n  ${M3U8}`)).toBe("hls");
  });

  test("anything else is not a manifest, including text that merely mentions one", () => {
    expect(sniffManifestKind("")).toBeUndefined();
    expect(sniffManifestKind('{"playlist":"#EXTM3U"}')).toBeUndefined();
    expect(sniffManifestKind("<html><body>#EXTM3U</body></html>")).toBeUndefined();
    expect(sniffManifestKind("<MPDX>")).toBeUndefined();
    expect(sniffManifestKind("This endpoint answers with plain text.")).toBeUndefined();
  });
});

describe("isSniffable", () => {
  test("a small fetch/xhr 200 with no type, text/plain or octet-stream is read", () => {
    expect(isSniffable(candidate())).toBe(true);
    expect(isSniffable(candidate({ resourceType: "xhr" }))).toBe(true);
    expect(isSniffable(candidate({ contentType: undefined }))).toBe(true);
    expect(isSniffable(candidate({ contentType: "application/octet-stream" }))).toBe(true);
    expect(isSniffable(candidate({ contentType: "Text/Plain" }))).toBe(true);
  });

  test.each(["document", "script", "media", "image", "stylesheet", "other"])(
    "a %s response is never read",
    (resourceType) => {
      expect(isSniffable(candidate({ resourceType }))).toBe(false);
    },
  );

  test("a body over the cap is never read", () => {
    expect(isSniffable(candidate({ contentLength: MAX_SNIFF_BODY_BYTES }))).toBe(true);
    expect(isSniffable(candidate({ contentLength: MAX_SNIFF_BODY_BYTES + 1 }))).toBe(false);
  });

  test("a compressed body is held to the smaller cap, since it inflates", () => {
    const gzip = { contentEncoding: "gzip" };
    expect(isSniffable(candidate({ ...gzip, contentLength: MAX_SNIFF_ENCODED_BYTES }))).toBe(true);
    expect(isSniffable(candidate({ ...gzip, contentLength: MAX_SNIFF_ENCODED_BYTES + 1 }))).toBe(
      false,
    );
    expect(
      isSniffable(
        candidate({ contentEncoding: "identity", contentLength: MAX_SNIFF_ENCODED_BYTES + 1 }),
      ),
    ).toBe(true);
  });

  test("a body of unknown or zero length is never read, because it cannot be bounded", () => {
    expect(isSniffable(candidate({ contentLength: undefined }))).toBe(false);
    expect(isSniffable(candidate({ contentLength: 0 }))).toBe(false);
  });

  test("a type that names what the body is, or any status but 200, is never read", () => {
    expect(isSniffable(candidate({ contentType: "application/json" }))).toBe(false);
    expect(isSniffable(candidate({ contentType: "text/html" }))).toBe(false);
    expect(isSniffable(candidate({ status: 206 }))).toBe(false);
    expect(isSniffable(candidate({ status: 404 }))).toBe(false);
  });

  test("an ad or analytics url is never read", () => {
    expect(isSniffable(candidate({ url: "https://ad.doubleclick.net/pagead/x" }))).toBe(false);
    expect(isSniffable(candidate({ url: "https://site.example/ads/playlist" }))).toBe(false);
  });
});

interface Probe {
  response: Response;
  reads: () => number;
}

function response(
  options: {
    url?: string;
    status?: number;
    resourceType?: string;
    headers?: Record<string, string>;
    body?: string;
    /** Declared length; defaults to the real one. */
    declared?: number | null;
    /** A body read that never settles, like a `fetch()` the page abandoned. */
    hangs?: boolean;
  } = {},
): Probe {
  const url = options.url ?? "https://site.example/api/playlist?id=1";
  const body = Buffer.from(options.body ?? M3U8);
  const declared = options.declared === undefined ? body.byteLength : options.declared;
  let reads = 0;
  const headers: Record<string, string> = {
    "content-type": "text/plain; charset=utf-8",
    ...(declared === null ? {} : { "content-length": String(declared) }),
    ...options.headers,
  };
  const request = {
    url: () => url,
    headers: () => ({ referer: "https://site.example/watch" }),
    allHeaders: async () => ({ referer: "https://site.example/watch" }),
    resourceType: () => options.resourceType ?? "fetch",
    frame: () => ({ url: () => "https://site.example/watch" }),
  };
  const fake = {
    url: () => url,
    status: () => options.status ?? 200,
    headers: () => headers,
    request: () => request,
    body: async () => {
      reads += 1;
      if (options.hangs === true) await new Promise<never>(() => {});
      return body;
    },
    text: async () => {
      reads += 1;
      return body.toString("utf8");
    },
  };
  return { response: fake as unknown as Response, reads: () => reads };
}

async function collect(...probes: Probe[]): Promise<HitCollector> {
  return await collectWithin(2000, ...probes);
}

async function collectWithin(settleMs: number, ...probes: Probe[]): Promise<HitCollector> {
  const listeners = new Map<string, (arg: unknown) => void>();
  const context = {
    on: (event: string, listener: (arg: unknown) => void) => {
      listeners.set(event, listener);
    },
  } as unknown as BrowserContext;
  const collector = new HitCollector();
  collector.attach(context);
  for (const probe of probes) listeners.get("response")?.(probe.response);
  await collector.settle(settleMs);
  return collector;
}

describe("HitCollector reads an untyped body only when it may", () => {
  test("an untyped HLS playlist becomes an hls hit and keeps its body", async () => {
    const probe = response();
    const collector = await collect(probe);

    expect(collector.hits).toHaveLength(1);
    expect(collector.hits[0]).toMatchObject({
      kind: "hls",
      confirmed: true,
      status: 200,
      contentType: "text/plain; charset=utf-8",
    });
    expect(collector.bodyFor(collector.hits[0]?.key ?? "")).toBe(M3U8);
    expect(probe.reads()).toBe(1);
  });

  test("an untyped, extensionless body beginning <MPD is a dash hit", async () => {
    const collector = await collect(
      response({ body: MPD, headers: { "content-type": "application/octet-stream" } }),
    );

    expect(collector.hits.map((hit) => hit.kind)).toEqual(["dash"]);
  });

  test("a response over the cap is not read", async () => {
    const probe = response({ declared: MAX_SNIFF_BODY_BYTES + 1 });
    const collector = await collect(probe);

    expect(probe.reads()).toBe(0);
    expect(collector.hits).toEqual([]);
  });

  test.each(["document", "script", "media", "image", "websocket"])(
    "a %s response is not read",
    async (resourceType) => {
      const probe = response({ resourceType });
      const collector = await collect(probe);

      expect(probe.reads()).toBe(0);
      expect(collector.hits).toEqual([]);
    },
  );

  test("a response with no declared length is not read", async () => {
    const probe = response({ declared: null });
    const collector = await collect(probe);

    expect(probe.reads()).toBe(0);
    expect(collector.hits).toEqual([]);
  });

  test("a body longer than it declared is read once and then dropped", async () => {
    const probe = response({ declared: 100, body: `${M3U8}${"x".repeat(MAX_SNIFF_BODY_BYTES)}` });
    const collector = await collect(probe);

    expect(probe.reads()).toBe(1);
    expect(collector.hits).toEqual([]);
  });

  test("a body that is not a manifest leaves no hit", async () => {
    const probe = response({ body: '{"id":1}', headers: { "content-type": "text/plain" } });
    const collector = await collect(probe);

    expect(probe.reads()).toBe(1);
    expect(collector.hits).toEqual([]);
  });

  test("a url fetched again is read once", async () => {
    const first = response({ body: "not a manifest" });
    const second = response({ body: "not a manifest" });
    await collect(first, second);

    expect(first.reads() + second.reads()).toBe(1);
  });

  test("no more than MAX_SNIFFS_PER_PROBE bodies are read in one probe", async () => {
    const probes = Array.from({ length: MAX_SNIFFS_PER_PROBE + 10 }, (_, index) =>
      response({ url: `https://site.example/api/poll?n=${index}`, body: "not a manifest" }),
    );
    await collect(...probes);

    expect(probes.reduce((sum, probe) => sum + probe.reads(), 0)).toBe(MAX_SNIFFS_PER_PROBE);
  });

  test("a response the type already places is not sniffed", async () => {
    const probe = response({
      url: "https://site.example/media/master.m3u8",
      headers: { "content-type": "application/vnd.apple.mpegurl" },
    });
    await collect(probe);

    // Read once, by the existing typed-manifest capture, as `text()` and not by the sniff.
    expect(probe.reads()).toBe(1);
  });
});

describe("a sniff never holds the probe up (dl-79)", () => {
  test("a body that never arrives is abandoned when settle()'s budget runs out", async () => {
    const probe = response({ hangs: true });
    const startedAt = Date.now();
    const collector = await collectWithin(100, probe);

    expect(probe.reads()).toBe(1);
    expect(collector.hits).toEqual([]);
    // Bounded by the budget it was given, not by the page's own patience.
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });
});

describe("classifyFailure with segments and no manifest (dl-79)", () => {
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

  test("names the reason and the count on the NO_MEDIA_FOUND", () => {
    const error = classifyFailure({ ...base, segmentCount: 3 });
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("NO_MEDIA_FOUND");
    expect(error.details).toMatchObject({ reason: SEGMENTS_WITHOUT_MANIFEST, segmentCount: 3 });
  });

  test("adds nothing when no segment was seen", () => {
    expect(classifyFailure({ ...base, segmentCount: 0 }).details?.["reason"]).toBeUndefined();
    expect(classifyFailure(base).details?.["reason"]).toBeUndefined();
  });

  test("never outranks a more fundamental verdict", () => {
    expect(
      classifyFailure({ ...base, segmentCount: 3, status: 403, title: "Just a moment..." }),
    ).toMatchObject({ code: "BOT_CHALLENGE" });
    expect(classifyFailure({ ...base, segmentCount: 3, quietReached: false }).code).toBe("TIMEOUT");
  });
});
