/**
 * dl-37, end to end for the browser tier: **a real Chromium reaching an origin
 * signed by a root only the operator has**, through the proxy that terminates
 * its TLS.
 *
 * ## Why a real browser, and why here
 *
 * The same combination argument `tier-tls-verdict.test.ts` makes: this needs the
 * sniffer (`resolvers`) against a TLS origin whose certificate is generated at
 * run time (`node-forge`, which only `api` depends on) *and* the egress proxy
 * (`api`), and `api` is the only workspace that has all three.
 *
 * A real browser rather than a unit test on the flag, because the claim being
 * made is about Chromium's behaviour rather than about our argv.
 * `--ignore-certificate-errors-spki-list` is not a documented API, it is a
 * command-line flag that Chromium prints an "unsupported" banner for, and
 * dl-34 established that the obvious mechanisms — a trust store, `SSL_CERT_FILE`
 * — reach Chromium not at all in this image. An assertion that we passed the
 * flag would prove nothing about whether the page loads.
 *
 * ## What each test is the proof of
 *
 * - **Done-when 1** — the tier succeeds against an operator-root origin. Its
 *   red is the same resolver with the flag withheld, which names what the flag
 *   buys rather than implying it.
 * - **Done-when 2** — a certificate that genuinely does not verify still comes
 *   back `TLS_VERIFICATION_FAILED`. This is the one dl-37 could have regressed
 *   silently: the proxy now meets the certificate, and Chromium is told only
 *   `net::ERR_TUNNEL_CONNECTION_FAILED`, which classifies as `UNREACHABLE` —
 *   "The site could not be reached", retryable, for a trust problem. Its red is
 *   the same registry built without `tierEgress`, and it asserts that old
 *   verdict by name.
 * - **Done-when 3** — the merge, not the replacement. Chromium's mechanism adds
 *   an exemption for one key rather than replacing a store, so the proof is
 *   that everything *else* still fails verification with the flag in place. The
 *   public-origin half of that line is a network call and is a measurement in
 *   the ticket's Log rather than a test here.
 *
 * The registries are built through `buildRegistry` rather than by constructing
 * a `BrowserResolver` directly, so what is under test is the composition — the
 * flag reaching the pool and the verdict wrapper reaching the tier — and not a
 * second wiring written for the test.
 */

import type { AppError } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadApiConfig } from "../src/config.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import type { GuardedFetch } from "../src/guarded-fetch.ts";
import { buildRegistry } from "../src/resolvers.ts";
import type { RegistryBuild } from "../src/resolvers.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { TlsRejectionLog } from "../src/tls-rejections.ts";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";
import type { FixtureCertificate, FixtureHandler, TlsOrigin } from "./helpers/tls-origin.ts";

const TEST_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 30_000;

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

/** A page whose player asks for a manifest, so the sniffer has something to find. */
function page(): string {
  return `<!doctype html><title>fixture</title><body><video></video><script>
    fetch("/master.m3u8").catch(() => {});
  </script></body>`;
}

const serve: FixtureHandler = (_request, response) => {
  if (response.req.url === "/master.m3u8") {
    response
      .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
      .end(
        ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360", "low.m3u8", ""].join(
          "\n",
        ),
      );
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
};

/**
 * A registry holding the browser tier only.
 *
 * `tierEgress` present is the dl-37 arrangement; absent is what the tier does
 * with no help at all, which is what every red below is.
 */
function registryFor(
  intercept: TlsInterception | null,
  rejections: TlsRejectionLog,
): RegistryBuild {
  return buildRegistry({
    config: loadApiConfig(
      {
        enableBrowserResolver: true,
        enableYtdlpResolver: false,
        enableDirectResolver: false,
        maxConcurrentBrowsers: 1,
      },
      {},
    ),
    logger: NOOP_LOGGER,
    // The browser tier never calls it; the direct and yt-dlp tiers are off.
    fetchImpl: globalThis.fetch as GuardedFetch,
    ...(intercept === null
      ? {}
      : {
          tierEgress: {
            rootSpkiSha256: intercept.rootSpkiSha256,
            trustBundlePath: intercept.trustBundlePath,
            rejections,
          },
        }),
  });
}

let operatorCert: FixtureCertificate;
let rogueCert: FixtureCertificate;
let operatorOrigin: TlsOrigin;
let rogueOrigin: TlsOrigin;
let intercept: TlsInterception;
let proxy: EgressProxy;
let rejections: TlsRejectionLog;
/** The dl-37 arrangement. */
let wired: RegistryBuild;
/** The same tier with nothing done for it — every red below. */
let bare: RegistryBuild;

beforeAll(async () => {
  // Self-signed, so it is its own root: the shape of an origin chaining to an
  // anchor only the operator has, which is exactly what `EGRESS_CA_FILE` is for.
  operatorCert = await createFixtureCertificate({
    ipAddresses: ["127.0.0.1"],
    commonName: "operator-origin",
  });
  // A second one the proxy was never told about, standing in for a certificate
  // that genuinely does not verify.
  rogueCert = await createFixtureCertificate({
    ipAddresses: ["127.0.0.1"],
    commonName: "rogue-origin",
  });
  operatorOrigin = await startTlsOrigin(operatorCert, serve);
  rogueOrigin = await startTlsOrigin(rogueCert, serve);

  rejections = new TlsRejectionLog();
  intercept = await createTlsInterception({
    // What `EGRESS_CA_FILE` becomes on this path: the proxy is the side that
    // meets the origin, so the operator's root goes here.
    operatorCa: operatorCert.ca,
    verifyOrigins: true,
  });
  proxy = await startEgressProxy({
    guard: createSsrfGuard({ allowHosts: ["127.0.0.1"], allowPrivateAddresses: true }),
    logger: NOOP_LOGGER,
    interceptTls: intercept,
    onCertificateRejected: (host, code) => {
      rejections.record(host, code);
    },
  });

  wired = registryFor(intercept, rejections);
  bare = registryFor(null, rejections);
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await wired.registry.dispose();
  await bare.registry.dispose();
  await proxy.close();
  await intercept.close();
  await operatorOrigin.close();
  await rogueOrigin.close();
  await operatorCert.cleanup();
  await rogueCert.cleanup();
});

async function resolveError(build: RegistryBuild, url: URL, proxyUrl?: string): Promise<AppError> {
  try {
    await build.registry.resolve(url, {
      timeoutMs: PROBE_TIMEOUT_MS,
      signal: new AbortController().signal,
      ...(proxyUrl === undefined ? {} : { proxyUrl }),
    });
  } catch (error) {
    return error as AppError;
  }
  throw new Error("the probe was expected to fail");
}

describe("the browser tier behind a proxy that terminates its TLS", () => {
  test(
    "reaches an origin signed by the operator's root — dl-37 Done-when 1",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const probe = await wired.registry.resolve(
        new URL(`https://127.0.0.1:${String(operatorOrigin.port)}/watch`),
        {
          timeoutMs: PROBE_TIMEOUT_MS,
          signal: new AbortController().signal,
          proxyUrl: proxy.url,
        },
      );

      // The tier did its job, not merely "did not throw".
      expect(probe.variants.length).toBeGreaterThan(0);
      // Through the proxy, which is the only path to this origin the browser
      // has: the proxy is what holds the operator's root.
      expect(operatorOrigin.requests.map((request) => request.url)).toContain("/master.m3u8");
    },
  );

  test(
    "and could not before the generated root was given to it",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The red for the test above, named rather than implied. Same origin,
      // same proxy, same everything except the SPKI Chromium was told about —
      // which is the whole of what dl-37 adds on this side.
      const error = await resolveError(
        bare,
        new URL(`https://127.0.0.1:${String(operatorOrigin.port)}/watch`),
        proxy.url,
      );

      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      // Chromium refusing the leaf, not the proxy refusing the origin: the
      // proxy was perfectly happy, and this is what "terminating a tier's TLS
      // without giving it the root breaks every page it loads" looks like.
      expect(error.details?.["reason"]).toBe("ERR_CERT_AUTHORITY_INVALID");
    },
  );

  test(
    "still refuses a certificate the proxy could not verify — dl-37 Done-when 2",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const error = await resolveError(
        wired,
        new URL(`https://127.0.0.1:${String(rogueOrigin.port)}/watch`),
        proxy.url,
      );

      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      expect(error.retryable).toBe(false);
      // OpenSSL's verdict, reached here and reattached, rather than a Chromium
      // token: the browser never saw this certificate.
      expect(error.details?.["reason"]).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
      // The operator-facing half, in `details` where the log gets it and the
      // client does not — `hint` is absent from `CLIENT_SAFE_DETAIL_KEYS`.
      expect(String(error.details?.["hint"])).toContain("EGRESS_CA_FILE");
      expect(error.message).not.toContain("EGRESS_CA_FILE");
      // The page never loaded, so this is a refusal and not a probe that
      // succeeded and was relabelled.
      expect(rogueOrigin.requests).toEqual([]);
    },
  );

  test(
    "and without the side channel that verdict would be a retryable network error",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The red for the test above. Chromium collapses every non-200 CONNECT
      // response to one token, so with nothing reattaching the proxy's verdict
      // the operator is told their CDN is down, on a retryable code, for a
      // trust problem — which is the sentence dl-34's `## Why` calls the worst
      // available one.
      const error = await resolveError(
        bare,
        new URL(`https://127.0.0.1:${String(rogueOrigin.port)}/watch`),
        proxy.url,
      );

      expect(error.code).toBe("UNREACHABLE");
      expect(error.retryable).toBe(true);
      expect(String(error.details?.["reason"])).toContain("ERR_TUNNEL_CONNECTION_FAILED");
    },
  );

  test(
    "the flag exempts one key, it does not switch verification off — dl-37 Done-when 3",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      // The trap dl-31 hit on the undici side, in Chromium's dialect. An
      // operator root handed over as a *replacement* fails every public origin;
      // this mechanism cannot fail that way because it replaces nothing, and
      // this is the assertion that says so — the same browser, carrying the
      // generated root's SPKI, meeting a certificate that is not it.
      //
      // Directly rather than through the proxy, because through the proxy
      // Chromium would never see this certificate: the proxy would refuse it
      // first, which is the previous test.
      const error = await resolveError(
        wired,
        new URL(`https://127.0.0.1:${String(rogueOrigin.port)}/watch`),
      );

      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      expect(error.details?.["reason"]).toBe("ERR_CERT_AUTHORITY_INVALID");
    },
  );
});
