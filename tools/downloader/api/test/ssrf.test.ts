/**
 * The SSRF guard is the one component here where a gap is a live
 * vulnerability rather than a bug, so the tests are written as attacks rather
 * than as feature coverage. Every case below is a real, documented technique.
 */

import { AppError } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createSsrfGuard, isBlockedAddress, urlsInProbeResult } from "../src/ssrf.ts";

/** A resolver that answers from a table, so no test touches DNS. */
function stubLookup(table: Record<string, string[]>) {
  return async (hostname: string): Promise<string[]> => {
    const answer = table[hostname];
    if (answer === undefined) throw new Error(`no such host: ${hostname}`);
    return answer;
  };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

describe("isBlockedAddress", () => {
  test("blocks every address family the payload lists use", () => {
    const blocked = [
      "127.0.0.1",
      "127.1.1.1",
      "0.0.0.0",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // AWS/Azure instance metadata
      "169.254.170.2", // ECS task metadata
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1", // link-local
      "fd00::1", // unique-local
      "ff02::1", // multicast
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:169.254.169.254",
      "64:ff9b::7f00:1", // NAT64-embedded loopback
    ];
    for (const address of blocked) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("allows ordinary public addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700::1111"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  test("anything that is not an IP is refused rather than assumed safe", () => {
    // Fail closed: a parse failure here must never mean "probably fine".
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("999.999.999.999")).toBe(true);
  });
});

describe("assertAllowed", () => {
  const guard = createSsrfGuard({
    lookup: stubLookup({
      "site.example": ["93.184.216.34"],
      "evil.example": ["127.0.0.1"],
      "split.example": ["93.184.216.34", "169.254.169.254"],
      "v6.example": ["::1"],
    }),
  });

  test("allows a public host", async () => {
    await expect(guard.assertAllowed("https://site.example/watch")).resolves.toBeInstanceOf(URL);
  });

  test("rejects a literal loopback or metadata address", async () => {
    expect(await codeOf(guard.assertAllowed("http://127.0.0.1:8080/"))).toBe("BLOCKED_TARGET");
    expect(await codeOf(guard.assertAllowed("http://localhost/"))).toBe("UNREACHABLE");
    expect(await codeOf(guard.assertAllowed("http://169.254.169.254/latest/meta-data/"))).toBe(
      "BLOCKED_TARGET",
    );
    expect(await codeOf(guard.assertAllowed("http://[::1]/"))).toBe("BLOCKED_TARGET");
  });

  test("rejects a public name that resolves somewhere private", async () => {
    // The whole reason the check is on addresses and not on names.
    expect(await codeOf(guard.assertAllowed("https://evil.example/"))).toBe("BLOCKED_TARGET");
    expect(await codeOf(guard.assertAllowed("https://v6.example/"))).toBe("BLOCKED_TARGET");
  });

  test("rejects a name where only *one* record is private", async () => {
    // The multi-record rebinding trick: answer with a good address and a bad
    // one, and hope the checker looks at the first.
    expect(await codeOf(guard.assertAllowed("https://split.example/"))).toBe("BLOCKED_TARGET");
  });

  test("rejects schemes that are SSRF pivots", async () => {
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1:11211/", "data:text/html,x"]) {
      expect(await codeOf(guard.assertAllowed(url)), url).toBe("INVALID_URL");
    }
  });

  test("rejects input that is not a URL at all", async () => {
    expect(await codeOf(guard.assertAllowed("not a url"))).toBe("INVALID_URL");
    expect(await codeOf(guard.assertAllowed(""))).toBe("INVALID_URL");
  });

  test("decimal and octal IP spellings do not slip past", async () => {
    // `http://2130706433/` is 127.0.0.1. WHATWG URL normalises these to
    // dotted-quad, so the address check sees the real target.
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(await codeOf(guard.assertAllowed("http://2130706433/"))).toBe("BLOCKED_TARGET");
    expect(await codeOf(guard.assertAllowed("http://0177.0.0.1/"))).toBe("BLOCKED_TARGET");
  });

  test("an explicit allowlist entry is honoured, for the local fixture server", async () => {
    const permissive = createSsrfGuard({
      lookup: stubLookup({}),
      allowHosts: ["127.0.0.1"],
    });
    await expect(
      permissive.assertAllowed("http://127.0.0.1:4321/hls/master.m3u8"),
    ).resolves.toBeInstanceOf(URL);
  });
});

describe("assertAllAllowed", () => {
  const guard = createSsrfGuard({
    lookup: stubLookup({ "cdn.example": ["93.184.216.34"], "bad.example": ["10.0.0.5"] }),
  });

  test("one bad URL in a batch rejects the batch", async () => {
    expect(
      await codeOf(
        guard.assertAllAllowed(["https://cdn.example/a.m3u8", "https://bad.example/b.m3u8"]),
      ),
    ).toBe("BLOCKED_TARGET");
  });

  test("collects every URL a probe result would have the engine fetch", () => {
    const urls = urlsInProbeResult({
      variants: [
        { url: "https://cdn.example/v.m3u8", audioUrl: "https://cdn.example/a.m3u8" },
        { url: "https://cdn.example/v2.mp4" },
      ],
      // Subtitles are fetched with the same credentials, so they are the same
      // attack surface even though they are not "the video".
      subtitles: [{ url: "https://cdn.example/en.vtt" }],
    });
    expect(urls.mustPass).toEqual([
      "https://cdn.example/v.m3u8",
      "https://cdn.example/a.m3u8",
      "https://cdn.example/v2.mp4",
      "https://cdn.example/en.vtt",
    ]);
    expect(urls.bestEffort).toEqual([]);
  });

  test("the thumbnail is accounted for, and in `bestEffort` rather than with the media", () => {
    const urls = urlsInProbeResult({
      variants: [{ url: "https://cdn.example/v.m3u8" }],
      subtitles: [],
      thumbnailUrl: "http://192.168.1.1/admin?action=reboot",
    });
    // In the inventory at all — before dl-29 it was absent, which is what made
    // it unvetted.
    expect(urls.bestEffort).toEqual(["http://192.168.1.1/admin?action=reboot"]);
    // And *not* in the list both call sites feed to `assertAllAllowed`, which
    // throws: a blocked preview must not fail a downloadable video.
    expect(urls.mustPass).toEqual(["https://cdn.example/v.m3u8"]);
  });

  test("an empty thumbnail is nothing to fetch, not an empty URL to check", () => {
    expect(urlsInProbeResult({ variants: [], subtitles: [], thumbnailUrl: "" }).bestEffort).toEqual(
      [],
    );
    expect(urlsInProbeResult({ variants: [], subtitles: [] }).bestEffort).toEqual([]);
  });
});

async function alwaysRedirectsToSelf(): Promise<Response> {
  return new Response(null, { status: 302, headers: { location: "https://site.example/loop" } });
}

/** 302s `/a` to a relative `/b`, then answers 200. */
async function redirectOnce(input: string | URL | Request): Promise<Response> {
  if (String(input) === "https://site.example/a") {
    return new Response(null, { status: 302, headers: { location: "/b" } });
  }
  return new Response("done", { status: 200 });
}

describe("createGuardedFetch", () => {
  const guard = createSsrfGuard({
    lookup: stubLookup({ "site.example": ["93.184.216.34"], "evil.example": ["93.184.216.34"] }),
  });

  test("re-checks after a redirect, which is how a naive guard is defeated", async () => {
    const seen: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      seen.push(url);
      if (url.startsWith("https://evil.example")) {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return new Response("ok", { status: 200 });
    };

    const guarded = createGuardedFetch(guard, fetchImpl);
    expect(await codeOf(guarded("https://evil.example/go"))).toBe("BLOCKED_TARGET");
    // The first hop was fetched; the second never was.
    expect(seen).toEqual(["https://evil.example/go"]);
  });

  test("follows an allowed redirect and returns the final response", async () => {
    const guarded = createGuardedFetch(guard, redirectOnce);
    const response = await guarded("https://site.example/a");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("done");
  });

  test("gives up rather than looping on a redirect cycle", async () => {
    const guarded = createGuardedFetch(guard, alwaysRedirectsToSelf);
    expect(await codeOf(guarded("https://site.example/loop"))).toBe("UNREACHABLE");
  });

  test("a 303 drops the body and becomes a GET, matching platform fetch", async () => {
    const methods: string[] = [];
    const guarded = createGuardedFetch(guard, async (input, init) => {
      methods.push((init?.method ?? "GET").toUpperCase());
      if (String(input).endsWith("/post")) {
        return new Response(null, { status: 303, headers: { location: "/after" } });
      }
      return new Response("ok", { status: 200 });
    });
    await guarded("https://site.example/post", { method: "POST", body: "x" });
    expect(methods).toEqual(["POST", "GET"]);
  });
});
