/**
 * dl-90: the chunk sniff reads a captured file's first bytes with the manifest
 * re-fetch's client, so it meets the same guard. A numbered file the page loaded
 * is a URL a page influenced; if the sniff's request is answered with a redirect
 * to an address the guard refuses, the hop must never be made, and the file is
 * offered, as any unreadable sniff leaves it.
 *
 * The guard and the proxy are `api`'s, which is why this lives here and not in
 * `resolvers`. The `Range` header is what tells the sniff's request from the
 * page's own: the page fetches the file whole.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ProbeResult } from "@downloader/contract";
import { BrowserResolver } from "@downloader/resolvers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createSsrfGuard } from "../src/ssrf.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;
const FIXTURE_HOST = "fixture.test";
const CHUNK = Buffer.alloc(1024 * 1024);

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

const PAGE = `<!doctype html><title>fixture</title><body><script>
  fetch("/n/00001.mp4").then((r) => r.arrayBuffer()).catch(() => {});
</script></body>`;

interface Origin {
  port: number;
  requests: Array<{ url: string; range: string | undefined }>;
  close(): Promise<void>;
}

async function startOrigin(handler: http.RequestListener): Promise<Origin> {
  const requests: Origin["requests"] = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url ?? "", range: request.headers.range });
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

describe("the chunk sniff behind the egress proxy (dl-90)", () => {
  let resolver: BrowserResolver;
  let proxy: EgressProxy;
  let secret: Origin;
  let fixture: Origin;

  beforeAll(async () => {
    // Something on loopback that no request of this probe is entitled to reach.
    secret = await startOrigin((_request, response) => response.end("root:x:0:0"));
    fixture = await startOrigin((request, response) => {
      if (request.url === "/n/00001.mp4") {
        // The page's own fetch has no Range; the sniff's does, and is sent away.
        if (request.headers.range !== undefined) {
          response
            .writeHead(302, {
              location: `http://127.0.0.1:${String(secret.port)}/latest/meta-data`,
            })
            .end();
          return;
        }
        response
          .writeHead(200, {
            "content-type": "video/mp4",
            "content-length": String(CHUNK.byteLength),
          })
          .end(CHUNK);
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
    });
    // The fixture host is exempt by name; the literal loopback address is not.
    const guard = createSsrfGuard({
      allowHosts: [FIXTURE_HOST],
      lookup: async () => ["127.0.0.1"],
    });
    proxy = await startEgressProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    resolver = new BrowserResolver({ maxConcurrentBrowsers: 1, headless: true, quietMs: 1200 });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await fixture.close();
    await secret.close();
  });

  test(
    "a sniff redirected to an address the guard refuses never makes the hop, and the file is offered",
    async () => {
      const result: ProbeResult = await resolver.resolve(
        new URL(`http://${FIXTURE_HOST}:${String(fixture.port)}/page.html`),
        { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
      );

      // The sniff really ran, or "never reached" proves nothing.
      expect(fixture.requests.some((request) => request.range === "bytes=0-65535")).toBe(true);
      expect(secret.requests).toEqual([]);
      expect(result.variants.map((variant) => variant.url)).toEqual([
        `http://${FIXTURE_HOST}:${String(fixture.port)}/n/00001.mp4`,
      ]);
    },
    TEST_TIMEOUT_MS,
  );
});
