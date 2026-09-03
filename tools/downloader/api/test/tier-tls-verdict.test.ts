/**
 * dl-34, half two, end to end for the browser tier: a **real Chromium** meeting
 * a certificate it cannot verify, and the verdict that comes back.
 *
 * ## Why it is here and not in `resolvers/test/browser/`
 *
 * The same reason `helpers/tls-origin.ts` is here at all, one package further
 * along. What this needs is a combination — the sniffer (`resolvers`) against a
 * TLS origin whose certificate is generated at run time (`node-forge`, which
 * only `api` depends on) — and `api` is the only workspace that has both. The
 * alternatives are a `node-forge` devDependency in `resolvers` for one fixture,
 * or `resolvers/test` importing another package's test helper, which dl-13
 * named as the one import not to make easy.
 *
 * ## Why a real browser rather than the message it produces
 *
 * `capture-rules.test.ts` pins `classifyNavigationError` against Chromium's
 * exact message, which is the cheap and fast half. It cannot show that the
 * message still *arrives* in that form: `navigate()` in `browser.ts` swallows a
 * navigation failure whose message matches `/timeout/i` before the classifier
 * sees it, and Playwright is free to reword what it re-throws at any version
 * bump. This file is the one that would go red for either.
 *
 * yt-dlp has no equivalent here on purpose. Its half is proven through the
 * stand-in binary in `resolvers/test`, which carries the real stderr verbatim,
 * because no CI runner in this repo installs yt-dlp — a test that skipped when
 * the binary is absent would be green everywhere and prove nothing anywhere.
 */

import type { AppError, ResolveOptions } from "@downloader/contract";
import { createBrowserResolver } from "@downloader/resolvers";
import type { BrowserResolver } from "@downloader/resolvers";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";

const TEST_TIMEOUT_MS = 90_000;

let certificate: FixtureCertificate;
let origin: TlsOrigin;
let resolver: BrowserResolver;

beforeAll(async () => {
  // Self-signed and never handed to anyone: the point is that nothing in this
  // process or in Chromium's store has ever heard of the issuer, which is
  // exactly the shape of the private-root deployment the ticket is about.
  certificate = await createFixtureCertificate({ ipAddresses: ["127.0.0.1"] });
  origin = await startTlsOrigin(certificate, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body><video src='/clip.mp4'></video></body></html>");
  });
  resolver = createBrowserResolver({ maxConcurrentBrowsers: 1, headless: true });
});

afterAll(async () => {
  await resolver.dispose();
  await origin.close();
  await certificate.cleanup();
});

function options(): ResolveOptions {
  return { timeoutMs: 25_000, signal: new AbortController().signal };
}

describe("the browser tier meeting a certificate it cannot verify", () => {
  async function probeError(): Promise<AppError> {
    const url = new URL(`https://127.0.0.1:${String(origin.port)}/watch`);
    try {
      await resolver.resolve(url, options());
    } catch (error) {
      return error as AppError;
    }
    throw new Error("the navigation was expected to fail on the certificate");
  }

  test(
    "says TLS_VERIFICATION_FAILED, where it used to say UNREACHABLE",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const error = await probeError();

      expect(error.code).toBe("TLS_VERIFICATION_FAILED");
      // Named rather than implied. `UNREACHABLE` is what this returned on
      // `origin/main`, and it is in `CORE_RETRYABLE_CODES` — so the operator was
      // told their CDN was down and to try again, for a trust problem that an
      // identical retry gets an identical answer to.
      expect(error.code).not.toBe("UNREACHABLE");
      expect(error.retryable).toBe(false);
    },
  );

  test(
    "carries Chromium's own name for the cause, not a paraphrase",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const error = await probeError();

      // This is the assertion that would catch Playwright rewording what it
      // re-throws: the classifier reads the `net::ERR_CERT_*` token out of the
      // message, so a version that stopped emitting one would come back
      // `UNREACHABLE` and this line, not the unit test, is where it shows.
      expect(error.details?.["reason"]).toBe("ERR_CERT_AUTHORITY_INVALID");
      // The operator-facing half, in `details` where the log gets it and the
      // client does not — `hint` is absent from `CLIENT_SAFE_DETAIL_KEYS`.
      expect(String(error.details?.["hint"])).toContain("EGRESS_CA_FILE");
      expect(error.message).not.toContain("EGRESS_CA_FILE");
    },
  );
});
