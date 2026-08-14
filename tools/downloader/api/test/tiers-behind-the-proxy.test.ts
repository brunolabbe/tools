/**
 * dl-12: the browser and yt-dlp tiers fetch through the guarded egress proxy.
 *
 * dl-11 proved the mechanism on ffmpeg. What has to be proved here is different
 * in kind, because Chromium is: ffmpeg fetched the URIs one manifest named, and
 * a browser fetches whatever a hostile page names. So the test that matters
 * drives a **real** Chromium against a page that asks for something it should
 * not have, and checks the target never heard from it.
 *
 * Everything is on loopback and nothing is on DNS: the fixture origin is only
 * reachable *through* the proxy, which is itself the point — a browser that had
 * gone around the proxy could not have loaded the page at all.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { BrowserResolver } from "@downloader/resolvers";
import type { ProbeResult } from "@downloader/contract";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import { createHarness, probeResult, StubResolver, waitFor } from "./helpers.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

interface Origin {
  port: number;
  hits: string[];
  close(): Promise<void>;
}

async function startOrigin(handler: http.RequestListener): Promise<Origin> {
  const hits: string[] = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url ?? "");
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    hits,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe("the browser tier behind the proxy", () => {
  /** The host the page is served as. Not in DNS: only the proxy can reach it. */
  const FIXTURE_HOST = "fixture.test";

  let resolver: BrowserResolver;
  let proxy: EgressProxy;
  let fixture: Origin;
  let secret: Origin;
  /** Hostnames the proxy was asked to resolve — proof a fetch came through it. */
  let resolved: string[];

  beforeAll(async () => {
    resolved = [];

    // Something on loopback that no page is entitled to read — an internal API,
    // in the shape it takes on a real deployment.
    secret = await startOrigin((_request, response) => response.end("root:x:0:0"));

    fixture = await startOrigin((request, response) => {
      if (request.url === "/master.m3u8") {
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(
            [
              "#EXTM3U",
              "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
              "low.m3u8",
              "",
            ].join("\n"),
          );
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        `<!doctype html><title>fixture</title><body><video></video><script>
           // What the sniffer is here to catch.
           fetch("/master.m3u8").catch(() => {});
           // What a hostile page would ask for, and must not get.
           fetch("http://127.0.0.1:${String(secret.port)}/etc/passwd").catch(() => {});
         </script></body>`,
      );
    });

    // `fixture.test` is exempt by name, so the page loads. The literal loopback
    // address is not, so the second fetch is refused — the guard's ordinary
    // policy, applied to a URL that exists only inside the page.
    const guard = createSsrfGuard({
      allowHosts: [FIXTURE_HOST],
      lookup: async () => ["127.0.0.1"],
    });
    proxy = await startEgressProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: async (hostname) => {
        resolved.push(hostname);
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });

    resolver = new BrowserResolver({ maxConcurrentBrowsers: 1, headless: true });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await fixture.close();
    await secret.close();
  });

  test(
    "a page's own fetches go through the guard, and a blocked one never lands",
    async () => {
      const probe = await resolver.resolve(
        new URL(`http://${FIXTURE_HOST}:${String(fixture.port)}/page.html`),
        {
          timeoutMs: PROBE_TIMEOUT_MS,
          signal: new AbortController().signal,
          proxyUrl: proxy.url,
        },
      );

      // The tier still does its job through the proxy — the point is not to
      // break the thing being guarded.
      expect(probe.variants.length).toBeGreaterThan(0);

      // The page loaded, which is only possible through the proxy: `fixture.test`
      // is in no resolver but this one.
      expect(resolved).toContain(FIXTURE_HOST);
      expect(fixture.hits).toContain("/page.html");

      // And the request the page had no business making got nowhere. Chromium
      // does not proxy loopback unless told to; Playwright passes
      // `--proxy-bypass-list=<-loopback>` for us, and this is the assertion that
      // notices if that ever stops being true.
      expect(secret.hits).toEqual([]);

      // It is also nowhere in the answer, so `assertAllAllowed` never had a
      // chance to catch it — which is exactly why the check has to be here.
      expect(JSON.stringify(probe)).not.toContain(String(secret.port));
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the manifest re-fetch is proxied too",
    async () => {
      // `#loadManifest` re-fetches the chosen manifest with `context.request`,
      // from this process rather than from the page — an attacker-influenced URL
      // whose body reaches a parser. It inherits the context's proxy, which is
      // the only reason that fetch is checked at all, so it is worth pinning
      // against Playwright itself rather than against our wrapper.
      const browser = await chromium.launch({ headless: true, proxy: { server: proxy.url } });
      try {
        const context = await browser.newContext();
        const response = await context.request.get("http://internal.test/master.m3u8", {
          timeout: 10_000,
          failOnStatusCode: false,
        });

        expect(response.status()).toBe(403);
      } finally {
        await browser.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("what the API hands the tiers", () => {
  test("the probe route passes the loopback proxy, not PROXY_URL", async () => {
    const stub = new StubResolver(probeResult());
    const harness = await createHarness({
      resolver: stub,
      config: { proxyUrl: "http://operator.proxy.internal:3128" },
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: "/api/probe",
        payload: { url: "https://site.example/watch/42" },
      });

      expect(response.statusCode).toBe(200);
      expect(stub.lastOptions?.proxyUrl).toBe(harness.app.context.egressProxyUrl);
      expect(stub.lastOptions?.proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    } finally {
      await harness.dispose();
    }
  });

  test("so does the orchestrator's re-probe", async () => {
    const stub = new StubResolver(probeResult());
    const harness = await createHarness({
      resolver: stub,
      config: { proxyUrl: "http://operator.proxy.internal:3128" },
    });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: "/api/jobs",
        payload: { url: "https://site.example/watch/42" },
      });
      expect(response.statusCode).toBe(201);

      // The job re-probes on its own thread of control, and that re-probe is the
      // only thing that resolves here — the intake route does not.
      await waitFor(
        () => stub.calls,
        (calls) => calls > 0,
        { label: "the job's re-probe" },
      );

      expect(stub.lastOptions?.proxyUrl).toBe(harness.app.context.egressProxyUrl);
    } finally {
      await harness.dispose();
    }
  });

  test("the loopback proxy is not reported back to the client", async () => {
    // Every resolver echoes the proxy it was handed into the RequestContext.
    // That value is now an ephemeral port on this host: useless to a client,
    // wrong after a restart, and nobody's business.
    const probe: ProbeResult = probeResult({
      requestContext: { headers: { Referer: "https://site.example/" }, proxyUrl: "http://x:1" },
    });
    const harness = await createHarness({ resolver: new StubResolver(probe) });
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: "/api/probe",
        payload: { url: "https://site.example/watch/42" },
      });

      const body = response.json<{ probe: ProbeResult }>();
      expect(body.probe.requestContext.proxyUrl).toBeUndefined();
      expect(body.probe.requestContext.headers["Referer"]).toBe("https://site.example/");
    } finally {
      await harness.dispose();
    }
  });
});
