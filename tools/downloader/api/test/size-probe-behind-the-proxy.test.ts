/**
 * dl-101: the browser tier's size probe reaches an origin behind the proxy that
 * terminates the tiers' TLS.
 *
 * ## Why here
 *
 * It weighed renditions with Playwright's `context.request`, which verifies with
 * Node's own store; the pool trusts the proxy's generated root only in Chromium,
 * by SPKI pin (dl-37). So behind the default proxy every HTTPS size probe failed
 * its handshake, the origin never heard from it, and every variant kept its
 * declared size. The guard, the proxy and the root are `api`'s, and a real
 * `BrowserResolver` is what has to meet them.
 *
 * ## How a test tells the probe arrived
 *
 * The master names `media.m3u8`, a VOD playlist of six ten-second segments. The
 * size sampler reads that playlist with `text()` and then asks for the length of
 * segments, so the origin's request log shows a `GET /media.m3u8` and `HEAD`s of
 * segments if (and only if) the probe got through the handshake.
 */

import type http from "node:http";
import { BrowserResolver } from "@downloader/resolvers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;
const SEGMENT_BYTES = 800_000;
const SEGMENTS = 6;

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

const MASTER = [
  "#EXTM3U",
  "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720",
  "media.m3u8",
  "",
].join("\n");

const MEDIA = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  "#EXT-X-TARGETDURATION:10",
  ...Array.from({ length: SEGMENTS }, (_, index) => `#EXTINF:10.0,\nseg-${String(index)}.ts`),
  "#EXT-X-ENDLIST",
  "",
].join("\n");

const PAGE = `<!doctype html><title>fixture</title><body><video></video><script>
  fetch("/master.m3u8").catch(() => {});
</script></body>`;

function serveFixture(request: http.IncomingMessage, response: http.ServerResponse): void {
  const url = request.url ?? "";
  if (url === "/master.m3u8") {
    response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(MASTER);
  } else if (url === "/media.m3u8") {
    response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(MEDIA);
  } else if (url.startsWith("/seg-")) {
    response.writeHead(200, { "content-length": String(SEGMENT_BYTES) });
    // A HEAD has no body, so the length alone is what a probe can read.
    response.end(request.method === "HEAD" ? undefined : Buffer.alloc(SEGMENT_BYTES));
  } else {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
  }
}

describe("the size probe behind the proxy that terminates its TLS (dl-101)", () => {
  let certificate: FixtureCertificate;
  let origin: TlsOrigin;
  let intercept: TlsInterception;
  let proxy: EgressProxy;

  beforeAll(async () => {
    certificate = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      commonName: "operator-origin",
    });
    origin = await startTlsOrigin(certificate, serveFixture);
    intercept = await createTlsInterception({ operatorCa: certificate.ca, verifyOrigins: true });
    proxy = await startEgressProxy({
      guard: createSsrfGuard({ allowHosts: ["127.0.0.1"], allowPrivateAddresses: true }),
      logger: NOOP_LOGGER,
      interceptTls: intercept,
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await proxy.close();
    await intercept.close();
    await origin.close();
    await certificate.cleanup();
  });

  async function probe(resolver: BrowserResolver): Promise<{
    masterGets: number;
    mediaPlaylistGets: number;
    segmentHeads: number;
    measured: boolean;
  }> {
    const before = origin.requests.length;
    try {
      const result = await resolver.resolve(
        new URL(`https://127.0.0.1:${String(origin.port)}/watch`),
        { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
      );
      const seen = origin.requests.slice(before);
      return {
        masterGets: seen.filter((request) => request.url === "/master.m3u8").length,
        mediaPlaylistGets: seen.filter(
          (request) => request.method === "GET" && request.url === "/media.m3u8",
        ).length,
        segmentHeads: seen.filter(
          (request) => request.method === "HEAD" && request.url.startsWith("/seg-"),
        ).length,
        // Declared: 800 kbit/s over 60 s is 6 MB. Weighed: six segments of 800 kB.
        measured: result.variants.some(
          (variant) => variant.filesizeBytes === SEGMENT_BYTES * SEGMENTS,
        ),
      };
    } finally {
      await resolver.dispose();
    }
  }

  test(
    "trusts the proxy's root it was handed, so the origin is asked for the playlist and weighed",
    async () => {
      const resolver = new BrowserResolver({
        maxConcurrentBrowsers: 1,
        headless: true,
        quietMs: 1200,
        proxyRootSpkiSha256: intercept.rootSpkiSha256,
        proxyRootCaPem: intercept.rootCaPem,
      });

      const seen = await probe(resolver);

      expect(seen.mediaPlaylistGets).toBeGreaterThanOrEqual(1);
      expect(seen.segmentHeads).toBeGreaterThanOrEqual(2);
      expect(seen.measured).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "and does not reach the origin when it was not handed the proxy's root",
    async () => {
      // The pin gets Chromium through, so the page and the master load; with no
      // PEM, Node verifies against its own store and the probe fails its
      // handshake exactly as `context.request` did. This is the red state.
      const resolver = new BrowserResolver({
        maxConcurrentBrowsers: 1,
        headless: true,
        quietMs: 1200,
        proxyRootSpkiSha256: intercept.rootSpkiSha256,
      });

      const seen = await probe(resolver);

      // The control is only a control if the origin was reachable at all.
      expect(seen.masterGets).toBeGreaterThanOrEqual(1);
      expect(seen.mediaPlaylistGets).toBe(0);
      expect(seen.segmentHeads).toBe(0);
      expect(seen.measured).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );
});
