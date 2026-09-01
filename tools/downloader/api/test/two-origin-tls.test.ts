/**
 * dl-21 pinned the defect here. dl-27 closes it, and this file is where the
 * difference is observable at all.
 *
 * dl-19 put `-tls_verify 1` on every remote input, and it verifies the
 * connection ffmpeg opens to the **manifest**. The HLS and DASH demuxers open
 * their own connections for segments, and libavformat copies only a fixed list
 * of options onto those — `headers`, `user_agent`, `cookies`, `http_proxy`,
 * `referer`, `rw_timeout`, `icy`, a compile-time array in
 * `ffio_copy_url_options` — with neither `tls_verify` nor `ca_file` in it. dl-21
 * measured sixteen candidate arguments against that and read the array out of
 * the binary: **there is no argv answer, and there is not going to be one.**
 *
 * One of the seven propagated options is `http_proxy`, and since dl-11 every
 * ffmpeg egress already goes through this service's loopback proxy. dl-27 makes
 * that proxy **terminate** those connections: it verifies the real origin itself
 * and re-encrypts to ffmpeg under a leaf it issued. ffmpeg checks that leaf on
 * the manifest, where `-tls_verify 1` reaches, and ignores it on the segments,
 * where it never could — and either way the origin has been verified.
 *
 * So the middle test below is the one that turned around. Until dl-27 it
 * asserted that the whole video arrived from an untrusted origin with exit 0;
 * it now asserts the download fails, carrying `TLS_VERIFICATION_FAILED`, with
 * the both-CAs case beside it still succeeding — the failure is about trust and
 * not about the second origin existing. dl-21's version is kept as the last test
 * in the file, against a **tunnelling** proxy, because the hole is still exactly
 * there for any client that takes that path: what changed is the mechanism, not
 * the fixture.
 *
 * `proxied-https.test.ts` cannot express any of this: it serves the playlist and
 * the segments from **one** origin with **one** certificate, so an untrusted
 * chain kills the run at the manifest. The two connections have to be able to
 * *disagree about trust* before the difference between them is observable. This
 * file is that fixture: origin A serves the playlists, origin B serves the
 * segments, and their certificates are unrelated.
 *
 * Nothing here reaches the network. Both origins are loopback, both certificates
 * are generated per run, and the clip is made by ffmpeg at `beforeAll`. Nothing
 * here turns verification off, either — "trust both" is one PEM holding both
 * certificates, because a trust store is replaced rather than added to.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createEngine, resolveFfmpegPath } from "@downloader/engine";
import type { DownloadRequest } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createApp } from "../src/server.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";
import {
  assertDecodable,
  createCaBundle,
  createFixtureCertificate,
  generateHlsClip,
  serveHlsFrom,
  splitHlsClip,
  startTlsOrigin,
} from "./helpers/tls-origin.ts";

const FFMPEG = resolveFfmpegPath();
const CLIP_SECONDS = 4;
/** Real ffmpeg, two TLS origins and a generated clip. Not a unit test's budget. */
const SLOW = 120_000;

const CONTEXT: RequestContext = {
  headers: { Referer: "https://player.example/watch/42", "User-Agent": "Mozilla/5.0 (Fixture)" },
};

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

/** Origin A: the playlists. Kilobytes of text. */
let manifestCertificate: FixtureCertificate;
let manifestOrigin: TlsOrigin;
/** Origin B: the segments. The entire video. Unrelated certificate, unrelated key. */
let segmentCertificate: FixtureCertificate;
let segmentOrigin: TlsOrigin;

let bothCas: { path: string; pem: string; cleanup(): Promise<void> };
let playlistDir: string;
let segmentDir: string;
let storageDir: string;

const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  // Distinct common names, and it is not cosmetic: a CA bundle is indexed by
  // subject, so two self-signed certificates sharing one collide and the bundle
  // silently trusts only the first. See `createFixtureCertificate`.
  [manifestCertificate, segmentCertificate] = await Promise.all([
    createFixtureCertificate({ ipAddresses: ["127.0.0.1"], commonName: "dl21-manifest-origin" }),
    createFixtureCertificate({ ipAddresses: ["127.0.0.1"], commonName: "dl21-segment-origin" }),
  ]);
  bothCas = await createCaBundle([manifestCertificate, segmentCertificate]);

  playlistDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-playlists-"));
  segmentDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-segments-"));
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-two-origin-storage-"));

  await generateHlsClip(FFMPEG, playlistDir, CLIP_SECONDS);

  // B first: the playlist has to name its port. It serves `segmentDir` lazily,
  // so it can be listening before anything has been put in there.
  segmentOrigin = await startTlsOrigin(segmentCertificate, serveHlsFrom(segmentDir));
  await splitHlsClip(playlistDir, segmentDir, `https://127.0.0.1:${segmentOrigin.port}`);
  manifestOrigin = await startTlsOrigin(manifestCertificate, serveHlsFrom(playlistDir));
}, SLOW);

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await manifestOrigin?.close();
  await segmentOrigin?.close();
  await manifestCertificate?.cleanup();
  await segmentCertificate?.cleanup();
  await bothCas?.cleanup();
  await fs.rm(playlistDir, { recursive: true, force: true });
  await fs.rm(segmentDir, { recursive: true, force: true });
  await fs.rm(storageDir, { recursive: true, force: true });
});

function masterUrl(): string {
  return `https://127.0.0.1:${manifestOrigin.port}/master.m3u8`;
}

/**
 * The proxy `server.ts` gives ffmpeg: it verifies each origin against
 * `operatorCa` and re-encrypts under a leaf it issued.
 *
 * The guard allows private addresses because both origins are on loopback and
 * this proxy is the only thing resolving anything — the same trade dl-8
 * documents for a deployment behind an operator proxy. It is not what is under
 * test here; trust is.
 */
async function startFfmpegProxy(
  operatorCa: string,
): Promise<EgressProxy & { intercept: TlsInterception }> {
  const intercept = await createTlsInterception({ operatorCa });
  cleanups.push(() => intercept.close());
  const proxy = await startEgressProxy({
    guard: createSsrfGuard({ allowPrivateAddresses: true }),
    logger: NOOP_LOGGER,
    interceptTls: intercept,
  });
  cleanups.push(() => proxy.close());
  return { ...proxy, intercept };
}

/** dl-14's proxy, which the browser and yt-dlp tiers still get. */
async function startTunnellingProxy(): Promise<EgressProxy> {
  const proxy = await startEgressProxy({
    guard: createSsrfGuard({ allowPrivateAddresses: true }),
    logger: NOOP_LOGGER,
  });
  cleanups.push(() => proxy.close());
  return proxy;
}

/** The production engine, verifying, trusting exactly the bundle it is given. */
async function startEngine(
  proxyUrl: string,
  caFile: string,
): Promise<ReturnType<typeof createEngine>> {
  const engine = createEngine({
    storageDir,
    maxFileSizeBytes: 256 * 1024 * 1024,
    proxyUrl,
    tlsCaFile: caFile,
  });
  await engine.init();
  return engine;
}

/**
 * A real `createApp`, differing between the two wiring tests **only** in the
 * flag under test.
 *
 * `EGRESS_CA_FILE` is origin A and nothing else in both, which is what makes the
 * pair comparable: the whole question is whether origin B gets checked, and the
 * two legitimate answers are opposite.
 */
async function wiredApp(
  label: string,
  overrides: { ffmpegTlsIntercept?: boolean },
): Promise<Awaited<ReturnType<typeof createApp>>> {
  const app = await createApp({
    startGc: false,
    logger: NOOP_LOGGER,
    config: {
      databasePath: ":memory:",
      storageDir: path.join(storageDir, label),
      ssrfAllowPrivateAddresses: true,
      enableBrowserResolver: false,
      enableYtdlpResolver: false,
      // Origin A only. The whole question is whether B is checked.
      egressCaFile: manifestCertificate.caPath,
      ...overrides,
    },
  });
  cleanups.push(() => app.shutdown());
  return app;
}

function downloadRequest(jobId: string): DownloadRequest {
  return {
    jobId,
    variant: {
      id: "v0",
      protocol: "hls",
      url: masterUrl(),
      hasVideo: true,
      hasAudio: true,
      videoCodec: "avc1.42c01e",
      audioCodec: "mp4a.40.2",
      width: 320,
      height: 240,
      durationSec: CLIP_SECONDS,
      label: "240p",
    },
    requestContext: CONTEXT,
    title: "segments on a second origin",
    durationSec: CLIP_SECONDS,
  };
}

/** A verified TLS handshake against one origin, using one CA. */
function handshake(port: number, ca: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      ca,
      // An IP has no SNI (RFC 6066), and the fixture certificate carries the
      // address in `subjectAltName` instead. Node matches on that.
      rejectUnauthorized: true,
    });
    socket.once("secureConnect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      socket.destroy();
      reject(error);
    });
  });
}

describe("the fixture itself, before anything is claimed about ffmpeg", () => {
  test("the two origins really do disagree about trust", async () => {
    // Without this, everything below is indistinguishable from a misconfigured
    // fixture: a fixture that trusted both origins by accident would produce
    // the same green run as one that measured nothing. This is the in-suite
    // form of dl-21's first control, which `openssl s_client -connect B
    // -CAfile a.crt` answers with `verify error:num=18:self-signed certificate`.
    await expect(handshake(manifestOrigin.port, manifestCertificate.ca)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, segmentCertificate.ca)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, manifestCertificate.ca)).rejects.toThrow();
    await expect(handshake(manifestOrigin.port, segmentCertificate.ca)).rejects.toThrow();
  });

  test("the playlist really does point off-origin", async () => {
    const playlist = await fs.readFile(path.join(playlistDir, "index.m3u8"), "utf8");
    const segments = playlist.split("\n").filter((line) => line.endsWith(".ts"));
    expect(segments.length).toBeGreaterThan(1);
    expect(
      segments.every((line) => line.startsWith(`https://127.0.0.1:${segmentOrigin.port}/`)),
    ).toBe(true);
  });

  test("the both-CAs bundle really holds both, and both origins verify against it", async () => {
    // `createCaBundle` needed its own proof when dl-21 wrote it, because the
    // download that used it could not give one — trusting A alone was already
    // enough while segments went unverified, so a mutation that dropped the
    // second certificate survived. dl-27 changes that: the both-CAs download
    // below now fails without B's certificate in this file. The assertion stays
    // anyway, because it is about the file rather than about ffmpeg, and it is
    // what tells a one-certificate bundle apart from two PEMs concatenated into
    // something no TLS stack will parse.
    const bundle = await fs.readFile(bothCas.path, "utf8");
    expect(bundle.match(/-----BEGIN CERTIFICATE-----/gu)).toHaveLength(2);
    await expect(handshake(manifestOrigin.port, bundle)).resolves.toBeUndefined();
    await expect(handshake(segmentOrigin.port, bundle)).resolves.toBeUndefined();
  });
});

describe("dl-27: the proxy verifies what ffmpeg cannot", () => {
  test(
    "the positive control: an untrusted manifest origin is refused before a byte is served",
    async () => {
      // **This runs first on purpose.** Every claim below is "the download was
      // refused", and a harness that could not produce a refusal at all would
      // report exactly the same green. So: same fixture, same wiring, one PEM
      // different — the proxy trusts B and meets A — and the run has to die at
      // the very first connection, with the reason surviving all the way to the
      // job's error code.
      const proxy = await startFfmpegProxy(segmentCertificate.ca);
      const engine = await startEngine(proxy.url, proxy.intercept.rootCaPath);

      const before = manifestOrigin.requests.length;
      const failure = await engine.download(downloadRequest("manifest-untrusted")).then(
        () => null,
        (error: unknown) => AppError.from(error),
      );

      expect(failure?.code).toBe("TLS_VERIFICATION_FAILED");
      expect(failure?.retryable).toBe(false);
      expect(String(failure?.details?.["stderr"] ?? "")).toMatch(/certificate/iu);
      // It failed at the handshake the proxy made: nothing was served.
      expect(manifestOrigin.requests.length).toBe(before);
    },
    SLOW,
  );

  test(
    "the segment origin is verified too: trusting only the manifest origin fails the download",
    async () => {
      // **The test dl-21 wrote to go red, turned around.** It asserted that the
      // whole video arrived from B over a certificate nobody checked, exit 0,
      // playable file, job reports success. The proxy checks it now, so the
      // same fixture and the same one-PEM difference produce a refusal — and
      // it is a refusal at the *segment* connections, which is the half no
      // ffmpeg argument has ever reached.
      const proxy = await startFfmpegProxy(manifestCertificate.ca);
      const engine = await startEngine(proxy.url, proxy.intercept.rootCaPath);

      const beforeManifest = manifestOrigin.requests.length;
      const beforeSegments = segmentOrigin.requests.length;
      const failure = await engine.download(downloadRequest("segments-untrusted")).then(
        () => null,
        (error: unknown) => AppError.from(error),
      );

      expect(failure?.code).toBe("TLS_VERIFICATION_FAILED");
      expect(failure?.retryable).toBe(false);
      // And it got as far as the manifest, which is what makes this a *segment*
      // refusal rather than the control above repeated: A was served, B was not.
      expect(manifestOrigin.requests.length).toBeGreaterThan(beforeManifest);
      expect(segmentOrigin.requests.slice(beforeSegments)).toEqual([]);
      // The reason travelled: dl-21 measured that a refused segment origin
      // reaches ffmpeg as `Invalid data found`, exit 183, with no certificate
      // wording anywhere. It carries the proxy's reason phrase now.
      expect(String(failure?.details?.["stderr"] ?? "")).toMatch(/certificate/iu);
    },
    SLOW,
  );

  test(
    "the same download succeeds when the proxy trusts both origins",
    async () => {
      // The other half, and what keeps the two above from being "this fixture
      // cannot download at all". One PEM with both certificates in it: a trust
      // store replaces rather than adds, so this is the only way to trust two
      // origins without turning verification off anywhere.
      const proxy = await startFfmpegProxy(bothCas.pem);
      const engine = await startEngine(proxy.url, proxy.intercept.rootCaPath);

      const before = segmentOrigin.requests.length;
      const outcome = await engine.download(downloadRequest("both-trusted"));

      expect(outcome.sizeBytes).toBeGreaterThan(10_000);
      await assertDecodable(FFMPEG, outcome.path);
      const served = segmentOrigin.requests.slice(before);
      expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    },
    SLOW,
  );

  test(
    "the wiring: a real `createApp` gives ffmpeg the terminating proxy and the generated root",
    async () => {
      // **Everything above builds its own proxy, so none of it can see a
      // `server.ts` that handed ffmpeg the wrong one** — and that mutation is
      // silent, restoring dl-21's hole with every other test green. It was
      // measured surviving before this test existed.
      //
      // It also pins the CA swap, which nothing else does. `EGRESS_CA_FILE` is
      // the *proxy's* trust store here and the engine's `-ca_file` is the
      // generated root; passing the operator's root to ffmpeg instead — the
      // arrangement dl-19 shipped — leaves ffmpeg unable to verify the one
      // certificate it is ever shown, and the download dies at the manifest
      // rather than at the segments, which is what the last two assertions
      // separate.
      const app = await wiredApp("wired-intercepting", {});
      expect(app.context.ffmpegProxyUrl).not.toBe(app.context.egressProxyUrl);

      const beforeManifest = manifestOrigin.requests.length;
      const beforeSegments = segmentOrigin.requests.length;
      const failure = await app.context.engine.download(downloadRequest("wired-untrusted")).then(
        () => null,
        (error: unknown) => AppError.from(error),
      );

      expect(failure?.code).toBe("TLS_VERIFICATION_FAILED");
      // Through the manifest and stopped at the segments, which is the shape
      // that says the terminating proxy was on the segment connections.
      expect(manifestOrigin.requests.length).toBeGreaterThan(beforeManifest);
      expect(segmentOrigin.requests.slice(beforeSegments)).toEqual([]);
    },
    SLOW,
  );

  test(
    "`FFMPEG_TLS_INTERCEPT=false` reopens the hole, and that is what it is for",
    async () => {
      // **The other half of the wiring pair, and the reason the pair exists.**
      // Adding the flag made "ffmpeg is on the tunnelling proxy" a *legitimate*
      // state, so no single test can any longer say "ffmpeg must never be
      // tunnelling" — that assertion would now fail on a correct deployment, and
      // the mutation that used to kill would be a false positive.
      //
      // What still separates the two causes is that the legitimate states have
      // **opposite** outcomes on this fixture, while both broken pairings have a
      // third outcome that is neither:
      //
      //   intercepting  + generated root  -> fails at the *segments*  (test above)
      //   tunnelling    + operator root   -> succeeds, B serves it all (this test)
      //   tunnelling    + generated root  -> fails at the *manifest*, A serves nothing
      //   intercepting  + operator root   -> fails at the *manifest*, A serves nothing
      //
      // So a split pair fails both tests and an operator-requested tunnel fails
      // neither. That is the discrimination, and it is why this test asserts
      // that origin A *was* served rather than only that the download worked.
      const app = await wiredApp("wired-tunnelling", { ffmpegTlsIntercept: false });
      // Same tunnel for everyone: no second proxy is started at all.
      expect(app.context.ffmpegProxyUrl).toBe(app.context.egressProxyUrl);

      const beforeManifest = manifestOrigin.requests.length;
      const beforeSegments = segmentOrigin.requests.length;
      const outcome = await app.context.engine.download(downloadRequest("wired-tunnelled"));

      // dl-21's hole, exactly: the whole video off an origin nobody checked.
      expect(outcome.sizeBytes).toBeGreaterThan(10_000);
      expect(manifestOrigin.requests.length).toBeGreaterThan(beforeManifest);
      const served = segmentOrigin.requests.slice(beforeSegments);
      expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    },
    SLOW,
  );

  test(
    "the hole is still exactly there through a tunnelling proxy, which is why the fix is the proxy",
    async () => {
      // dl-21's characterization test, kept as a control rather than deleted.
      // Same fixture, same argv, same untrusted B — and through the proxy the
      // tiers still use, the whole video arrives from B with exit 0. So what
      // the three tests above measure is the interception, not a fixture that
      // quietly stopped being able to reach origin B. It is also the shape of
      // the regression to fear: `server.ts` handing ffmpeg the tunnelling proxy
      // would restore this silently, which is why `logging.test.ts` pins
      // `ffmpegProxyTls`.
      const proxy = await startTunnellingProxy();
      const engine = await startEngine(proxy.url, manifestCertificate.caPath);

      const before = segmentOrigin.requests.length;
      const outcome = await engine.download(downloadRequest("tunnelled-untrusted"));

      expect(outcome.sizeBytes).toBeGreaterThan(10_000);
      const served = segmentOrigin.requests.slice(before);
      expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    },
    SLOW,
  );
});
