/**
 * dl-97: the browser tier's manifest re-fetch, now its own streaming client,
 * still goes where `context.request` went — through the guarded egress proxy,
 * with the context's cookies, trusting the proxy's generated root.
 *
 * ## Why here
 *
 * The guard and the proxy are `api`'s, and what has to be proved is that a real
 * `BrowserResolver` re-fetch meets them: a redirect the guard refuses is never
 * followed, a cookie reaches the hop that needs it, and an origin behind the
 * terminating proxy answers the re-fetch rather than only the page.
 *
 * ## How a test tells the re-fetch's answer from the captured one
 *
 * Every origin here answers `/master.m3u8` twice. The first request is the
 * page's own, which the collector captures; its manifest names `captured.m3u8`.
 * The second is the re-fetch, and what it ends at names `refetched.m3u8`. So a
 * probe whose variants name `refetched` parsed the re-fetch, and one that names
 * `captured` fell back to the captured body.
 */

import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import type { ProbeResult } from "@downloader/contract";
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

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

function manifest(name: string): string {
  return ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360", name, ""].join("\n");
}

const PAGE = `<!doctype html><title>fixture</title><body><video></video><script>
  fetch("/master.m3u8").catch(() => {});
</script></body>`;

interface Recorded {
  url: string;
  cookie: string | undefined;
}

interface Origin {
  port: number;
  requests: Recorded[];
  close(): Promise<void>;
}

async function startOrigin(handler: http.RequestListener): Promise<Origin> {
  const requests: Recorded[] = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url ?? "", cookie: request.headers.cookie });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function variantUrls(probe: ProbeResult): string {
  return probe.variants.map((variant) => variant.url).join(" ");
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

describe("the manifest re-fetch behind the egress proxy (dl-97)", () => {
  /** Not in DNS: only the proxy can reach these, so a hit on either came through it. */
  const FIXTURE_HOST = "fixture.test";
  const OTHER_HOST = "cdn.test";

  let resolver: BrowserResolver;
  let proxy: EgressProxy;
  let secret: Origin;
  let other: Origin;
  /** What `/master.m3u8` does the second time it is asked, per test. */
  let onRefetch: (response: http.ServerResponse) => void;
  let fixture: Origin;
  const warnings: { message: string; fields?: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    // Something on loopback no re-fetch is entitled to reach.
    secret = await startOrigin((_request, response) => response.end("root:x:0:0"));
    other = await startOrigin((_request, response) => {
      response
        .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
        .end(manifest("refetched.m3u8"));
    });

    let masterCalls = 0;
    fixture = await startOrigin((request, response) => {
      if (request.url === "/master.m3u8") {
        masterCalls += 1;
        if (masterCalls % 2 === 0) {
          onRefetch(response);
          return;
        }
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest("captured.m3u8"));
        return;
      }
      if (request.url === "/gated/master.m3u8") {
        // A CDN that wants the session on the hop it redirected to.
        if (request.headers.cookie?.includes("session=s3cr3t") !== true) {
          response.writeHead(403).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest("refetched.m3u8"));
        return;
      }
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "session=s3cr3t; Path=/",
        })
        .end(PAGE);
    });

    // The fixture hosts are exempt by name; the literal loopback address is not,
    // so a hop to it is the guard's ordinary refusal.
    const guard = createSsrfGuard({
      allowHosts: [FIXTURE_HOST, OTHER_HOST],
      lookup: async () => ["127.0.0.1"],
    });
    proxy = await startEgressProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    resolver = new BrowserResolver({
      maxConcurrentBrowsers: 1,
      headless: true,
      quietMs: 1200,
      logger: {
        warn: (message, fields) => {
          warnings.push({ message, ...(fields === undefined ? {} : { fields }) });
        },
      },
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await fixture.close();
    await secret.close();
    await other.close();
  });

  async function probe(): Promise<ProbeResult> {
    return await resolver.resolve(
      new URL(`http://${FIXTURE_HOST}:${String(fixture.port)}/page.html`),
      { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
    );
  }

  function masterRequests(): number {
    return fixture.requests.filter((request) => request.url === "/master.m3u8").length;
  }

  test(
    "a redirect to an address the guard refuses is not followed",
    async () => {
      const before = masterRequests();
      onRefetch = (response) => {
        response
          .writeHead(302, { location: `http://127.0.0.1:${String(secret.port)}/latest/meta-data` })
          .end();
      };

      const result = await probe();

      // The re-fetch happened, and it was answered with the redirect.
      expect(masterRequests() - before).toBe(2);
      // Its target never heard from anyone: the proxy refused the hop.
      expect(secret.requests).toEqual([]);
      // And the probe still has its manifest, the one the page loaded.
      expect(variantUrls(result)).toContain("captured.m3u8");
      expect(variantUrls(result)).not.toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the session cookie reaches the re-fetch, on a hop it was redirected to as well",
    async () => {
      onRefetch = (response) => {
        response.writeHead(302, { location: "/gated/master.m3u8" }).end();
      };

      const result = await probe();

      const refetch = fixture.requests.findLast((request) => request.url === "/master.m3u8");
      expect(refetch?.cookie).toContain("session=s3cr3t");
      // The second hop carries no replayed cookie header; this one is the jar's.
      const gated = fixture.requests.findLast((request) => request.url === "/gated/master.m3u8");
      expect(gated?.cookie).toContain("session=s3cr3t");
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hop to another host is not handed this host's session",
    async () => {
      const before = other.requests.length;
      onRefetch = (response) => {
        response
          .writeHead(302, {
            location: `http://${OTHER_HOST}:${String(other.port)}/cdn/master.m3u8`,
          })
          .end();
      };

      const result = await probe();

      expect(other.requests.length - before).toBe(1);
      expect(other.requests.at(-1)?.cookie).toBeUndefined();
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "refuses a body that inflates past the cap, logs it as a refusal and falls back",
    async () => {
      // 256 MiB of spaces from about 255 KB on the wire.
      const bomb = await gzipBomb(256);
      const before = masterRequests();
      warnings.length = 0;
      onRefetch = (response) => {
        response
          .writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
            "content-encoding": "gzip",
          })
          .end(bomb);
      };

      const result = await probe();

      expect(masterRequests() - before).toBe(2);
      expect(variantUrls(result)).toContain("captured.m3u8");
      expect(warnings).toEqual([
        {
          message: "manifest re-fetch refused: its body passed the cap",
          fields: {
            url: `http://${FIXTURE_HOST}:${String(fixture.port)}/master.m3u8`,
            limitBytes: 4 * 1024 * 1024,
          },
        },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "parses a compressed manifest inside the cap through the same path",
    async () => {
      warnings.length = 0;
      onRefetch = (response) => {
        response
          .writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
            "content-encoding": "gzip",
          })
          .end(zlib.gzipSync(manifest("refetched.m3u8")));
      };

      const result = await probe();

      expect(variantUrls(result)).toContain("refetched.m3u8");
      expect(warnings).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the manifest re-fetch behind the proxy that terminates its TLS (dl-97)", () => {
  let certificate: FixtureCertificate;
  let origin: TlsOrigin;
  let intercept: TlsInterception;
  let proxy: EgressProxy;
  let resolver: BrowserResolver;

  beforeAll(async () => {
    certificate = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      commonName: "operator-origin",
    });
    let masterCalls = 0;
    origin = await startTlsOrigin(certificate, (request, response) => {
      if (request.url === "/master.m3u8") {
        masterCalls += 1;
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest(masterCalls === 1 ? "captured.m3u8" : "refetched.m3u8"));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
    });
    intercept = await createTlsInterception({ operatorCa: certificate.ca, verifyOrigins: true });
    proxy = await startEgressProxy({
      guard: createSsrfGuard({ allowHosts: ["127.0.0.1"], allowPrivateAddresses: true }),
      logger: NOOP_LOGGER,
      interceptTls: intercept,
    });
    // How `buildRegistry` builds it when the tiers' proxy terminates TLS.
    resolver = new BrowserResolver({
      maxConcurrentBrowsers: 1,
      headless: true,
      quietMs: 1200,
      proxyRootSpkiSha256: intercept.rootSpkiSha256,
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await intercept.close();
    await origin.close();
    await certificate.cleanup();
  });

  test(
    "trusts the proxy's root by its pin, so the re-fetch is answered",
    async () => {
      const result = await resolver.resolve(
        new URL(`https://127.0.0.1:${String(origin.port)}/watch`),
        { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
      );

      const masters = origin.requests.filter((request) => request.url === "/master.m3u8");
      expect(masters).toHaveLength(2);
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "and refuses a leaf that a key other than the pinned one signed",
    async () => {
      // The page is plain HTTP so it loads whatever either side trusts; only its
      // manifest is HTTPS. Chromium records the hit when it asks, before the
      // handshake it then fails, so the re-fetch is still attempted: and with a
      // pin that is not the proxy's root, it must fail too.
      const page = await startOrigin((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
          `<!doctype html><title>fixture</title><body><video></video><script>
             fetch("https://127.0.0.1:${String(origin.port)}/master.m3u8").catch(() => {});
           </script></body>`,
        );
      });
      const mispinned = new BrowserResolver({
        maxConcurrentBrowsers: 1,
        headless: true,
        quietMs: 1200,
        proxyRootSpkiSha256: createHash("sha256").update("not the proxy's root").digest("base64"),
      });
      const before = origin.requests.length;
      try {
        const result = await mispinned.resolve(
          new URL(`http://127.0.0.1:${String(page.port)}/page.html`),
          {
            timeoutMs: PROBE_TIMEOUT_MS,
            signal: new AbortController().signal,
            proxyUrl: proxy.url,
          },
        );

        // Nothing reached the origin: not the page's fetch, not the re-fetch.
        expect(origin.requests.length - before).toBe(0);
        // So the probe has only the manifest's address to offer.
        expect(variantUrls(result)).toBe(`https://127.0.0.1:${String(origin.port)}/master.m3u8`);
      } finally {
        await mispinned.dispose();
        await page.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
