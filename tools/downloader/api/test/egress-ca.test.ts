/**
 * `EGRESS_CA_FILE` reaching the undici dispatcher — dl-31.
 *
 * The premise this file was written against was **inferred from the wiring and
 * never observed**, so the first two tests are the observation, in the order
 * that makes the rest able to fail: an origin signed by a private root is
 * refused with no trust anchor, and reached with one. Delete the wiring in
 * `server.ts` and the app-level pair below goes red; delete the merge in
 * `operator-ca.ts` and only the array test does, which is why both are here.
 *
 * **What the symptom actually looked like, measured rather than reasoned.** The
 * dispatcher's rejection is `DEPTH_ZERO_SELF_SIGNED_CERT`, and it reaches
 * `fetch` as a bare `TypeError: fetch failed` with the code hidden on `cause`.
 * Nothing in `guarded-fetch.ts` unwraps that — `unwrapCause` re-throws only an
 * `AppError` — so the client is answered `502 UNREACHABLE`, "The site could not
 * be reached", `retryable: true`. An operator with a private root is therefore
 * told their CDN is down, on a retryable code, while an ffmpeg download of the
 * same origin succeeds. That is worse than the ticket's "fails on trust" and is
 * the reason the pair below asserts the status code rather than an exception.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
import { AppError, ROUTES } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { ApiConfig } from "../src/config.ts";
import { createEgressDispatcher } from "../src/dispatcher.ts";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { withSystemRoots } from "../src/operator-ca.ts";
import { createApp } from "../src/server.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { AppLogger } from "../src/logger.ts";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";
import type { FixtureCertificate, FixtureHandler, TlsOrigin } from "./helpers/tls-origin.ts";

/** A master playlist, so the direct resolver has something to resolve. */
const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:3",
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240,CODECS="avc1.42c01e,mp4a.40.2"',
  "index.m3u8",
  "",
].join("\n");

/** Origin A, standing in for the operator's internal CDN. */
let operatorCertificate: FixtureCertificate;
let operatorOrigin: TlsOrigin;
/** Origin B, signed by a *second* private root. Stands in for "everything else". */
let otherCertificate: FixtureCertificate;
let otherOrigin: TlsOrigin;

const cleanups: Array<() => Promise<unknown>> = [];

const playlist: FixtureHandler = (_request, response) => {
  response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" }).end(MASTER);
};

beforeAll(async () => {
  // Distinct common names: a trust store is indexed by subject, and dl-21 paid
  // for finding that out. These two end up in one bundle below.
  operatorCertificate = await createFixtureCertificate({
    ipAddresses: ["127.0.0.1"],
    commonName: "dl31-operator-root",
  });
  otherCertificate = await createFixtureCertificate({
    ipAddresses: ["127.0.0.1"],
    commonName: "dl31-other-root",
  });
  operatorOrigin = await startTlsOrigin(operatorCertificate, playlist);
  otherOrigin = await startTlsOrigin(otherCertificate, playlist);
});

afterAll(async () => {
  for (const cleanup of cleanups.toReversed()) await cleanup();
  await operatorOrigin.close();
  await otherOrigin.close();
  await operatorCertificate.cleanup();
  await otherCertificate.cleanup();
});

/**
 * The dispatcher exactly as `server.ts` builds it, with and without the anchor.
 *
 * No proxy, which is the *default* deployment and the one the ticket's Build
 * step missed: `requestTls` was proxy-only, so wiring only that would have left
 * every deployment without `PROXY_URL` exactly as broken as before.
 */
async function fetchThrough(
  url: string,
  originTls?: { ca: string | string[] },
): Promise<number | string> {
  const guard = createSsrfGuard({ allowHosts: ["127.0.0.1"] });
  const egress = createEgressDispatcher({
    guard,
    ...(originTls === undefined ? {} : { originTls }),
  });
  const guardedFetch = createGuardedFetch(guard, globalThis.fetch, {
    dispatcher: egress.dispatcher,
  });
  try {
    return (await guardedFetch(url)).status;
  } catch (error) {
    return String((error as { cause?: { code?: string } })?.cause?.code ?? error);
  } finally {
    await egress.close();
  }
}

/** The code a `guardedFetch` failure carries, or the status if it succeeded. */
async function classify(url: string, ca?: string | string[]): Promise<string> {
  const guard = createSsrfGuard({ allowHosts: ["127.0.0.1"] });
  const egress = createEgressDispatcher({
    guard,
    ...(ca === undefined ? {} : { originTls: { ca } }),
  });
  const guardedFetch = createGuardedFetch(guard, globalThis.fetch, {
    dispatcher: egress.dispatcher,
  });
  try {
    return `status ${String((await guardedFetch(url)).status)}`;
  } catch (error) {
    if (!(error instanceof AppError)) return `unclassified ${String(error)}`;
    // The verify code comes back too, so a test can pin *which* failure it
    // provoked rather than trusting a comment that says they differ.
    const reason = error.details?.["reason"];
    return typeof reason === "string" ? `${error.code}/${reason}` : error.code;
  } finally {
    await egress.close();
  }
}

/** A port nothing is listening on: bind, read it back, close. */
async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("the dispatcher's trust anchors", () => {
  test("the control: with no anchor the private-root origin is refused", async () => {
    // This is the reproduction, kept. Every claim below is "the fetch
    // succeeded", and a fixture whose certificate happened to be trusted would
    // report the same green.
    await expect(
      fetchThrough(`https://127.0.0.1:${operatorOrigin.port}/master.m3u8`),
    ).resolves.toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test("with the operator's root merged in, the same origin is reached", async () => {
    await expect(
      fetchThrough(`https://127.0.0.1:${operatorOrigin.port}/master.m3u8`, {
        ca: withSystemRoots(operatorCertificate.ca),
      }),
    ).resolves.toBe(200);
  });

  test("undici really does take an array on `connect.ca`, and honours all of it", async () => {
    // The Build step said to confirm rather than assume, and this is the
    // confirmation: `withSystemRoots` hands over ~150 PEMs and the operator's,
    // and if undici took only the first or only the last the test above would
    // pass for the wrong reason. Two fixture roots, both origins reached from
    // one array, is the smallest thing that can tell those apart.
    const both = [otherCertificate.ca, operatorCertificate.ca];
    await expect(
      fetchThrough(`https://127.0.0.1:${operatorOrigin.port}/master.m3u8`, { ca: both }),
    ).resolves.toBe(200);
    await expect(
      fetchThrough(`https://127.0.0.1:${otherOrigin.port}/master.m3u8`, { ca: both }),
    ).resolves.toBe(200);
  });

  test("the merge keeps the public roots, which is the regression a fix causes", async () => {
    // **This is as far as an offline suite can honestly go, and the gap is
    // named rather than papered over.** Done-when 2 asks that a *public* origin
    // still verifies with the variable set; no test here may touch one
    // (fixtures, not live network), and no public root's private key is
    // available to sign a fixture with. So the claim is split in two: the array
    // above proves nothing is dropped from a multi-entry `ca`, and this proves
    // the array `server.ts` passes still contains the whole system store. What
    // is *not* measured here is an actual handshake against a publicly-signed
    // origin.
    const merged = withSystemRoots(operatorCertificate.ca);
    expect(merged.length).toBe(tls.rootCertificates.length + 1);
    expect(merged.slice(0, -1)).toEqual([...tls.rootCertificates]);
    expect(merged.at(-1)).toBe(operatorCertificate.ca);
    // A sanity floor on the store itself: were `tls.rootCertificates` empty,
    // "merged keeps the public roots" would be a tautology.
    expect(tls.rootCertificates.length).toBeGreaterThan(50);
  });
});

/** A `createApp` differing from the next only in whether the anchor is set. */
async function wiredApp(
  label: string,
  overrides: Partial<ApiConfig>,
  logger?: AppLogger,
): Promise<Awaited<ReturnType<typeof createApp>>> {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), `dl31-${label}-`));
  // Registered before the call, because two of these tests are about
  // `createApp` *rejecting* and the directory outlives the rejection.
  cleanups.push(() => fs.rm(storageDir, { recursive: true, force: true }));
  const app = await createApp({
    startGc: false,
    ...(logger === undefined ? {} : { logger }),
    config: {
      databasePath: ":memory:",
      storageDir,
      logLevel: "silent",
      ssrfAllowPrivateAddresses: true,
      enableBrowserResolver: false,
      enableYtdlpResolver: false,
      ...overrides,
    },
  });
  cleanups.push(() => app.shutdown());
  return app;
}

async function probe(
  app: Awaited<ReturnType<typeof createApp>>,
  url: string,
): Promise<{ statusCode: number; json: () => unknown }> {
  return await app.server.inject({ method: "POST", url: ROUTES.probe, payload: { url } });
}

describe("the wiring, through a real `createApp`", () => {
  const url = (): string => `https://127.0.0.1:${operatorOrigin.port}/master.m3u8`;

  test("unset: the probe fails, and says the certificate is why", async () => {
    // Two claims in one, and they were separate defects.
    //
    // Done-when 3 is the first: no anchor passed, so the system store and
    // nothing else, and this fixture is refused. A dispatcher that quietly
    // gained a `ca` would answer 200.
    //
    // The second is what this branch's first round *measured and shipped
    // anyway*: the answer used to be `UNREACHABLE` / "The site could not be
    // reached" / `retryable: true`, because nothing between undici and the
    // client classified a refused certificate. An operator with a private root
    // was told their CDN was down, on a retryable code — the one diagnosis that
    // never leads to a trust setting. `retryable` is asserted rather than
    // implied: it is the field that decides whether a client keeps asking.
    const app = await wiredApp("unset", {});
    const response = await probe(app, url());
    const error = (response.json() as { error: { code: string; retryable: boolean } }).error;

    expect(response.statusCode).toBe(502);
    expect(error.code).toBe("TLS_VERIFICATION_FAILED");
    expect(error.retryable).toBe(false);
  });

  test("set: the same probe against the same origin succeeds", async () => {
    // The mutation this catches is deleting one spread in `server.ts`, which
    // nothing else in the suite sees: every other TLS test builds its own
    // dispatcher or its own proxy.
    const app = await wiredApp("set", { egressCaFile: operatorCertificate.caPath });
    const response = await probe(app, url());

    expect(response.statusCode).toBe(200);
  });

  test("the deprecated name still works, and says so once at boot", async () => {
    const warnings: string[] = [];
    const capturing: AppLogger = {
      debug: () => {},
      info: () => {},
      warn: (message: string) => {
        warnings.push(message);
      },
      error: () => {},
      child: () => capturing,
    };
    const app = await wiredApp(
      "alias",
      { egressCaFile: operatorCertificate.caPath, egressCaFileVar: "FFMPEG_CA_FILE" },
      capturing,
    );

    expect((await probe(app, url())).statusCode).toBe(200);
    expect(warnings.filter((line) => line.startsWith("FFMPEG_CA_FILE is deprecated"))).toHaveLength(
      1,
    );
  });
});

describe("an unreadable anchor", () => {
  // dl-19 recorded that a typo'd path was discovered one download at a time and
  // dl-27 made it fatal — but only on the path where the interception proxy
  // read the file, so `FFMPEG_TLS_INTERCEPT=false` still discovered it one
  // download at a time, and nothing asserted either half. Reading it once in
  // `server.ts` covers both, and this is the pair that says so.
  const missing = path.join(os.tmpdir(), "dl31-there-is-no-such-file.pem");

  for (const ffmpegTlsIntercept of [true, false]) {
    test(`refuses to boot with FFMPEG_TLS_INTERCEPT=${String(ffmpegTlsIntercept)}`, async () => {
      await expect(
        wiredApp(`unreadable-${String(ffmpegTlsIntercept)}`, {
          egressCaFile: missing,
          ffmpegTlsIntercept,
        }),
      ).rejects.toMatchObject({ code: "INTERNAL" });
    });
  }
});

describe("a refused certificate is a trust failure, not a transport one", () => {
  /**
   * The verify codes, **produced rather than listed**.
   *
   * `guarded-fetch.ts` matches on a closed set of OpenSSL codes, and a set is
   * exactly the kind of thing that is written once against the one case the
   * author had in front of them. Every fixture in this repo is self-signed, so
   * a classifier keyed on `DEPTH_ZERO_SELF_SIGNED_CERT` alone would pass a
   * suite built only from them. These three are different codes from three
   * different causes, and each one was read off a real handshake here before
   * being written down.
   */
  test("self-signed, expired and wrong-name all arrive as TLS_VERIFICATION_FAILED", async () => {
    const expired = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      commonName: "dl31-expired",
      expired: true,
    });
    const expiredOrigin = await startTlsOrigin(expired, playlist);
    // No IP in `subjectAltName`, so a connection to 127.0.0.1 fails the *name*
    // check rather than the chain check — Node's own error, not OpenSSL's.
    const wrongName = await createFixtureCertificate({
      dnsNames: ["not-this-host.example"],
      commonName: "dl31-wrong-name",
    });
    const wrongNameOrigin = await startTlsOrigin(wrongName, playlist);
    cleanups.push(
      () => expiredOrigin.close(),
      () => expired.cleanup(),
    );
    cleanups.push(
      () => wrongNameOrigin.close(),
      () => wrongName.cleanup(),
    );

    // Each certificate is trusted for its own case, so only the property under
    // test can fail — otherwise all three would just be "untrusted issuer"
    // wearing three names, and the set would be no better tested than by one.
    await expect(classify(`https://127.0.0.1:${operatorOrigin.port}/x`)).resolves.toBe(
      "TLS_VERIFICATION_FAILED/DEPTH_ZERO_SELF_SIGNED_CERT",
    );
    await expect(
      classify(`https://127.0.0.1:${expiredOrigin.port}/x`, withSystemRoots(expired.ca)),
    ).resolves.toBe("TLS_VERIFICATION_FAILED/CERT_HAS_EXPIRED");
    await expect(
      classify(`https://127.0.0.1:${wrongNameOrigin.port}/x`, withSystemRoots(wrongName.ca)),
    ).resolves.toBe("TLS_VERIFICATION_FAILED/ERR_TLS_CERT_ALTNAME_INVALID");
  });

  test("a connection that never got a certificate is left alone, and stays UNREACHABLE", async () => {
    // The control, and the one that keeps the fix from being "call everything a
    // trust failure". Under-matching is the safe direction: a missed verify code
    // stays retryable, which is merely today's behaviour, while a network blip
    // wrongly classified here would fail a job that the next attempt would have
    // completed.
    //
    // Two levels, because they are two different answers and both matter.
    // `guardedFetch` deliberately does *not* classify a genuine connection
    // failure — it re-throws the bare `TypeError`, which is what it did before
    // this branch — and `direct.ts` is what turns that into `UNREACHABLE`. So
    // the fetch-level assertion is "untouched" and the route-level one is "still
    // the transport code, still retryable".
    const dead = await freePort();
    await expect(classify(`https://127.0.0.1:${dead}/x`)).resolves.toBe(
      "unclassified TypeError: fetch failed",
    );

    const app = await wiredApp("refused", {});
    const response = await probe(app, `https://127.0.0.1:${dead}/master.m3u8`);
    const error = (response.json() as { error: { code: string; retryable: boolean } }).error;
    expect(error.code).toBe("UNREACHABLE");
    expect(error.retryable).toBe(true);
  });

  test("the guard's own BLOCKED_TARGET survives the direct resolver", async () => {
    // Same defect, second victim, and it is why fixing `guarded-fetch.ts` alone
    // would have changed nothing at the route: `direct.ts`'s `#request` caught
    // *any* non-abort failure into a blanket `UNREACHABLE`, including an
    // `AppError` the fetch had already classified.
    //
    // **It has to be a redirect, and the first draft of this test did not know
    // that.** `routes/probe.ts` runs `guard.assertAllowed` on the submitted URL
    // before any resolver sees it, so a directly-blocked address never reaches
    // `#request` and a test that submits one passes on the pre-flight check
    // without exercising anything. The mutation proved it: deleting the
    // passthrough left that version green. A *redirect* to a blocked address is
    // the case only `guardedFetch` can catch — it re-checks every hop — and it
    // is the one the blanket catch was swallowing.
    const redirector = await startTlsOrigin(operatorCertificate, (_request, response) => {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    });
    cleanups.push(() => redirector.close());

    const app = await wiredApp("blocked", {
      egressCaFile: operatorCertificate.caPath,
      // Not `ssrfAllowPrivateAddresses`, which exempts every host and would let
      // the metadata address through: the fixture is named instead.
      ssrfAllowPrivateAddresses: false,
      ssrfAllowHosts: ["127.0.0.1"],
    });
    const response = await probe(app, `https://127.0.0.1:${redirector.port}/master.m3u8`);
    const error = (response.json() as { error: { code: string; retryable: boolean } }).error;

    expect(error.code).toBe("BLOCKED_TARGET");
    expect(error.retryable).toBe(false);
  });
});
