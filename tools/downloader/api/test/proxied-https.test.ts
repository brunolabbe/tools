/**
 * dl-14: the proxied-HTTPS path, which had shipped broken and had no test.
 *
 * dl-11 found `httpproxy` missing from ffmpeg's `-protocol_whitelist` — the
 * protocol libavformat opens an HTTPS target through when a proxy is set — so
 * every proxied HTTPS download failed with `Invalid argument` before the proxy
 * was contacted at all. What let that ship is that **no test in this repo served
 * TLS**, and the two paths through the proxy are not the same code:
 *
 *  - plain HTTP is an absolute-form request the proxy forwards;
 *  - HTTPS is a `CONNECT` tunnel, and on ffmpeg's side it is `httpproxy`.
 *
 * Only the first was ever exercised. Everything here is the second.
 *
 * Nothing reaches the network: the origin is a generated TLS fixture on
 * loopback, its certificate is generated per run, and the clip it serves is made
 * by ffmpeg at `beforeAll`.
 */

import { X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import {
  buildManifestDownloadArgs,
  createEngine,
  isTlsVerificationFailure,
  resolveFfmpegPath,
  runFfmpeg,
} from "@downloader/engine";
import type { DownloadRequest } from "@downloader/engine";
import { AppError } from "@downloader/contract";
import type { RequestContext } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AddressResolver } from "../src/dispatcher.ts";
import { createEgressDispatcher } from "../src/dispatcher.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";
import {
  assertDecodable,
  CERTIFICATE_COMMON_NAME,
  createFixtureCertificate,
  generateHlsClip,
  serveHlsFrom,
  startTlsOrigin,
} from "./helpers/tls-origin.ts";

const FFMPEG = resolveFfmpegPath();
const CLIP_SECONDS = 6;

/** The name the client asks for. It is never resolved by the client — see below. */
const ORIGIN_HOST = "allowed.test";
/** A name the guard refuses, resolving to the cloud metadata service. */
const BLOCKED_HOST = "metadata.test";

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

const CONTEXT: RequestContext = {
  headers: { Referer: "https://player.example/watch/42", "User-Agent": "Mozilla/5.0 (Fixture)" },
};

let certificate: FixtureCertificate;
let clipDir: string;
let storageDir: string;
let origin: TlsOrigin;

const cleanups: (() => Promise<void>)[] = [];

/** Every name in this suite answers loopback, and only the proxy ever asks. */
const resolveToLoopback: AddressResolver = async () => [{ address: "127.0.0.1", family: 4 }];

function guardAllowingOrigin(): ReturnType<typeof createSsrfGuard> {
  return createSsrfGuard({
    allowHosts: [ORIGIN_HOST],
    lookup: async (hostname) =>
      hostname === BLOCKED_HOST ? ["169.254.169.254"] : ["93.184.216.34"],
  });
}

async function startProxy(
  options: Parameters<typeof startEgressProxy>[0],
): Promise<EgressProxy & { port: number }> {
  const proxy = await startEgressProxy(options);
  cleanups.push(() => proxy.close());
  return { ...proxy, port: Number(new URL(proxy.url).port) };
}

/** The pinned proxy this suite proxies through, unless a test wants its own. */
async function startPinnedProxy(): Promise<EgressProxy & { port: number }> {
  return startProxy({
    guard: guardAllowingOrigin(),
    logger: NOOP_LOGGER,
    resolve: resolveToLoopback,
  });
}

function masterUrl(): string {
  return `https://${ORIGIN_HOST}:${origin.port}/master.m3u8`;
}

beforeAll(async () => {
  certificate = await createFixtureCertificate({
    dnsNames: [ORIGIN_HOST, BLOCKED_HOST],
    ipAddresses: ["127.0.0.1"],
  });
  clipDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tls-clip-"));
  storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-tls-storage-"));
  await generateHlsClip(FFMPEG, clipDir, CLIP_SECONDS);
  origin = await startTlsOrigin(certificate, serveHlsFrom(clipDir));
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await origin?.close();
  await certificate?.cleanup();
  await fs.rm(clipDir, { recursive: true, force: true });
  await fs.rm(storageDir, { recursive: true, force: true });
});

/** Top-level MP4 box names in file order — `ftyp` first, `moov` before `mdat`. */
async function topLevelBoxes(file: string): Promise<string[]> {
  const buffer = await fs.readFile(file);
  const names: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset);
    const name = buffer.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = buffer.length - offset;
    }
    if (size < headerSize) break;
    names.push(name);
    offset += size;
  }
  return names;
}

/**
 * Opens a `CONNECT` tunnel and hands back the raw socket, without wrapping it in
 * TLS — so a test can decide whether a handshake happens at all.
 */
function connectTunnel(
  proxyPort: number,
  target: string,
): Promise<{ status: number; socket: net.Socket }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("latin1");
      const end = buffer.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.removeListener("data", onData);
      const status = Number(/^HTTP\/1\.[01] (\d{3})/u.exec(buffer)?.[1] ?? 0);
      const leftover = Buffer.from(buffer.slice(end + 4), "latin1");
      if (leftover.length > 0) socket.unshift(leftover);
      resolve({ status, socket });
    };
    socket.on("data", onData);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error("the proxy never answered the CONNECT"));
    });
    socket.once("error", reject);
    socket.once("close", () => {
      // A refusal ends the socket without a tunnel; report the status anyway.
      const status = Number(/^HTTP\/1\.[01] (\d{3})/u.exec(buffer)?.[1] ?? 0);
      resolve({ status, socket });
    });
  });
}

/**
 * A full HTTPS GET through the proxy, verifying the origin's certificate
 * against the fixture CA.
 *
 * `rejectUnauthorized` stays on and the CA is passed explicitly: the point of
 * tunnelling rather than intercepting is that the chain is the origin's own, and
 * a test that turned verification off could not tell the difference.
 */
async function getThroughTunnel(
  proxyPort: number,
  host: string,
  port: number,
  requestPath: string,
): Promise<{ body: string; peerCertificate: tls.PeerCertificate }> {
  const { status, socket } = await connectTunnel(proxyPort, `${host}:${port}`);
  if (status !== 200) {
    socket.destroy();
    throw new Error(`the proxy refused the tunnel with ${status}`);
  }

  const secure = tls.connect({
    socket,
    servername: host,
    ca: certificate.ca,
    rejectUnauthorized: true,
  });

  const body = await new Promise<string>((resolve, reject) => {
    secure.once("error", reject);
    secure.once("secureConnect", () => {
      secure.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    let raw = "";
    secure.setEncoding("utf8");
    secure.on("data", (chunk: string) => {
      raw += chunk;
    });
    secure.once("end", () => {
      const end = raw.indexOf("\r\n\r\n");
      resolve(end === -1 ? "" : raw.slice(end + 4));
    });
  });

  const peerCertificate = secure.getPeerCertificate();
  secure.destroy();
  socket.destroy();
  return { body, peerCertificate };
}

/** An engine wired to the fixture proxy, with dl-19's TLS settings on top. */
async function startEngine(
  proxyUrl: string,
  tlsOptions: { tlsVerify?: boolean; tlsCaFile?: string } = {},
): Promise<ReturnType<typeof createEngine>> {
  const engine = createEngine({
    storageDir,
    proxyUrl,
    maxFileSizeBytes: 256 * 1024 * 1024,
    ...tlsOptions,
  });
  await engine.init();
  return engine;
}

/** The same HLS job every download test in this file runs. */
function downloadRequest(jobId: string, url: string = masterUrl()): DownloadRequest {
  return {
    jobId,
    variant: {
      id: "v0",
      protocol: "hls",
      url,
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
    title: "proxied over TLS",
    durationSec: CLIP_SECONDS,
  };
}

describe("a proxied HTTPS download, which is what every real site is", () => {
  test("real ffmpeg fetches an HTTPS manifest through the guarded proxy and writes a playable MP4", async () => {
    const proxy = await startPinnedProxy();
    // `tlsCaFile` since dl-19: ffmpeg now verifies, and the fixture's
    // certificate chains to nothing a machine trusts. Pointing it at the CA is
    // the whole difference between this test and the one below it.
    const engine = await startEngine(proxy.url, { tlsCaFile: certificate.caPath });

    const before = origin.requests.length;
    const outcome = await engine.download(downloadRequest("proxied-https"));

    expect(outcome.container).toBe("mp4");
    expect(outcome.sizeBytes).toBeGreaterThan(10_000);

    const boxes = await topLevelBoxes(outcome.path);
    expect(boxes[0]).toBe("ftyp");
    expect(boxes.indexOf("moov")).toBeLessThan(boxes.indexOf("mdat"));
    await assertDecodable(FFMPEG, outcome.path);

    // The bytes came from the fixture over TLS, and the segments did too — a
    // download that only fetched the playlist would not have produced a file.
    const served = origin.requests.slice(before);
    expect(served.some((request) => request.url.endsWith("master.m3u8"))).toBe(true);
    expect(served.filter((request) => request.url.endsWith(".ts")).length).toBeGreaterThan(1);
    // Replayed through the tunnel as well: the proxy does not touch the request.
    expect(served.every((request) => request.headers.referer === CONTEXT.headers["Referer"])).toBe(
      true,
    );
  });

  test("the same fetch fails when httpproxy leaves the protocol whitelist", async () => {
    // The regression dl-11 fixed, held in place by construction rather than by
    // memory: the argv is the real one, with the one protocol removed.
    const proxy = await startPinnedProxy();
    const destPath = path.join(storageDir, "whitelist-check.mp4");

    const { args } = buildManifestDownloadArgs({
      url: masterUrl(),
      destPath,
      container: "mp4",
      protocol: "hls",
      requestContext: CONTEXT,
      hasVideo: true,
      hasAudio: true,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
    });

    const whitelistAt = args.indexOf("-protocol_whitelist") + 1;
    const whitelist = args[whitelistAt];
    if (whitelist === undefined) throw new Error("no -protocol_whitelist in the manifest argv");
    expect(whitelist).toContain("httpproxy");

    const withoutHttpProxy = [...args];
    withoutHttpProxy[whitelistAt] = whitelist
      .split(",")
      .filter((protocol) => protocol !== "httpproxy")
      .join(",");

    const failure = await runFfmpeg({
      ffmpegPath: FFMPEG,
      args: withoutHttpProxy,
      proxyUrl: proxy.url,
      failureCode: "DOWNLOAD_FAILED",
    }).then(
      () => null,
      (error: unknown) => AppError.from(error),
    );

    expect(failure?.code).toBe("DOWNLOAD_FAILED");
    // And for dl-11's reason rather than some other one: ffmpeg refuses the
    // protocol before opening a socket, which is why the proxy logged nothing
    // when this shipped broken.
    expect(String(failure?.details?.["stderr"] ?? "")).toMatch(/invalid argument|protocol/iu);
    await expect(fs.stat(destPath)).rejects.toThrow();
  });

  test("ffmpeg verifies the origin's own certificate through the tunnel", async () => {
    // dl-14 spliced `-tls_verify 1 -ca_file` into the argv by hand, because
    // `buildManifestDownloadArgs` did not emit them. It does now, so this is the
    // production argv unedited — the certificate that survives to ffmpeg is the
    // origin's, which is the property a proxy that intercepted TLS would break.
    const proxy = await startPinnedProxy();
    const destPath = path.join(storageDir, "verified.mp4");

    const { args } = buildManifestDownloadArgs({
      url: masterUrl(),
      destPath,
      container: "mp4",
      protocol: "hls",
      requestContext: CONTEXT,
      hasVideo: true,
      hasAudio: true,
      durationSec: CLIP_SECONDS,
      ffmpegPath: FFMPEG,
      tlsCaFile: certificate.caPath,
    });
    expect(args[args.indexOf("-tls_verify") + 1]).toBe("1");

    const result = await runFfmpeg({
      ffmpegPath: FFMPEG,
      args,
      proxyUrl: proxy.url,
      failureCode: "DOWNLOAD_FAILED",
    });

    expect(result.exitCode).toBe(0);
    expect((await fs.stat(destPath)).size).toBeGreaterThan(10_000);
  });
});

/**
 * dl-19. The suite above proves ffmpeg *can* verify; these prove it *does*, and
 * that the failure says which kind of failure it was.
 *
 * The origin is the same self-signed fixture, so "not given the CA" is a real
 * untrusted chain rather than a simulated one — and every case here runs real
 * ffmpeg rather than reading an argv.
 */
describe("ffmpeg verifies the certificates it is encrypting to", () => {
  test("a download from an origin ffmpeg has no CA for fails, as a certificate problem", async () => {
    const proxy = await startPinnedProxy();
    const engine = await startEngine(proxy.url);

    const before = origin.requests.length;
    const failure = await engine.download(downloadRequest("untrusted-chain")).then(
      () => null,
      (error: unknown) => AppError.from(error),
    );

    expect(failure?.code).toBe("TLS_VERIFICATION_FAILED");
    expect(failure?.retryable).toBe(false);
    // ffmpeg's own words, verbatim, not a paraphrase of them: an assertion on
    // "it failed" would pass just as happily with the origin switched off,
    // which is the failure this one exists to be distinguished from.
    // The real line on this machine is `Peer certificate failed verification`,
    // five times over — once per reconnect attempt. Asserted as the word rather
    // than the sentence because the sentence is the TLS backend's, and CI runs
    // a second ffmpeg build on Windows; `code` above is the strict half.
    expect(String(failure?.details?.["stderr"] ?? "")).toMatch(/certificate/iu);
    // And it failed at the handshake: the manifest was never served.
    expect(origin.requests.length).toBe(before);
  });

  test("the same download succeeds when the fixture CA is passed", async () => {
    // The other half of the pair. Same origin, same argv, one setting apart —
    // so the failure above is about trust and not about the fixture.
    const proxy = await startPinnedProxy();
    const engine = await startEngine(proxy.url, { tlsCaFile: certificate.caPath });

    const outcome = await engine.download(downloadRequest("trusted-chain"));

    expect(outcome.sizeBytes).toBeGreaterThan(10_000);
    await assertDecodable(FFMPEG, outcome.path);
  });

  test("a 404 is still a download failure, and not mistaken for a certificate one", async () => {
    // The `Done when` line this answers: the certificate failure must be
    // distinguishable from a dead link, in both directions.
    const proxy = await startPinnedProxy();
    const engine = await startEngine(proxy.url, { tlsCaFile: certificate.caPath });

    const failure = await engine
      .download(
        downloadRequest("missing-manifest", `https://${ORIGIN_HOST}:${origin.port}/no.m3u8`),
      )
      .then(
        () => null,
        (error: unknown) => AppError.from(error),
      );

    expect(failure?.code).toBe("DOWNLOAD_FAILED");
  });

  test("the escape hatch really turns it off, argv and behaviour both", async () => {
    // An operator behind a TLS-intercepting proxy needs this, and the point of
    // testing it against the untrusted fixture is that nothing else in the run
    // changes: the download that failed on trust above now succeeds.
    const proxy = await startPinnedProxy();
    const engine = await startEngine(proxy.url, { tlsVerify: false });

    const outcome = await engine.download(downloadRequest("verification-off"));
    expect(outcome.sizeBytes).toBeGreaterThan(10_000);

    const { args } = buildManifestDownloadArgs({
      url: masterUrl(),
      destPath: path.join(storageDir, "argv-only.mp4"),
      container: "mp4",
      protocol: "hls",
      hasVideo: true,
      hasAudio: true,
      ffmpegPath: FFMPEG,
      tlsVerify: false,
    });
    expect(args[args.indexOf("-tls_verify") + 1]).toBe("0");
  });

  test("the stderr classifier reads ffmpeg's real words, not a paraphrase", () => {
    // The first two came out of real runs in dl-19, from the distribution build
    // and from `ffmpeg-static`: gnutls's two verification messages. The rest are
    // the other backends' wordings for the same conditions, which is what the
    // matcher is loose enough to cover and narrow enough to exclude below.
    expect(isTlsVerificationFailure("[tls @ 0x1] Peer certificate failed verification")).toBe(true);
    expect(
      isTlsVerificationFailure(
        "[tls @ 0x1] The certificate's owner does not match hostname x.test",
      ),
    ).toBe(true);
    expect(isTlsVerificationFailure("error:0A000086:SSL routines::certificate verify failed")).toBe(
      true,
    );
    expect(isTlsVerificationFailure("unable to get local issuer certificate")).toBe(true);
    expect(isTlsVerificationFailure("Server certificate verification failed")).toBe(true);
    // A dead link, a bad manifest and a refused protocol must not be dressed up
    // as trust failures — this half is what keeps the code meaningful.
    expect(isTlsVerificationFailure("Server returned 404 Not Found")).toBe(false);
    expect(isTlsVerificationFailure("Error opening input: Invalid data found")).toBe(false);
    expect(isTlsVerificationFailure("Protocol not found: Invalid argument")).toBe(false);
    expect(isTlsVerificationFailure("")).toBe(false);
  });
});

describe("the CONNECT tunnel, end to end", () => {
  test("an allowed target's certificate reaches the client unaltered", async () => {
    const proxy = await startPinnedProxy();

    const { body, peerCertificate } = await getThroughTunnel(
      proxy.port,
      ORIGIN_HOST,
      origin.port,
      "/master.m3u8",
    );

    expect(body).toContain("#EXTM3U");
    // Not merely "some TLS happened": this is the fixture's own key, so nothing
    // in the middle re-issued it.
    expect(peerCertificate.subject.CN).toBe(CERTIFICATE_COMMON_NAME);
    expect(peerCertificate.fingerprint256).toBe(
      new X509Certificate(certificate.cert).fingerprint256,
    );
  });

  test("a blocked target is refused before any handshake", async () => {
    const proxy = await startPinnedProxy();
    const before = origin.requests.length;

    const { status, socket } = await connectTunnel(proxy.port, `${BLOCKED_HOST}:${origin.port}`);
    socket.destroy();

    expect(status).toBe(403);
    // No handshake, so nothing arrived at the origin — a refusal after the
    // tunnel opened would leave a request here.
    expect(origin.requests.length).toBe(before);
  });
});

describe("guardedFetch through the proxy the deployment configures", () => {
  test("a body comes back over TLS, through the dispatcher production builds", async () => {
    const proxy = await startPinnedProxy();
    const guard = guardAllowingOrigin();
    const dispatcher = createEgressDispatcher({
      guard,
      proxyUrl: proxy.url,
      requestTls: { ca: certificate.ca },
    });
    cleanups.push(() => dispatcher.close());
    expect(dispatcher.mode).toBe("proxy");

    const fetchThroughProxy = createGuardedFetch(guard, globalThis.fetch, {
      dispatcher: dispatcher.dispatcher,
    });
    const response = await fetchThroughProxy(masterUrl());

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("#EXTM3U");
  });

  test("without the fixture CA the same fetch fails on trust, so verification is really on", async () => {
    // Guards the test above: if undici were somehow not verifying, that one
    // would pass whether the CA reached it or not, and would be proving nothing.
    const proxy = await startPinnedProxy();
    const guard = guardAllowingOrigin();
    const dispatcher = createEgressDispatcher({ guard, proxyUrl: proxy.url });
    cleanups.push(() => dispatcher.close());

    const fetchThroughProxy = createGuardedFetch(guard, globalThis.fetch, {
      dispatcher: dispatcher.dispatcher,
    });

    await expect(fetchThroughProxy(masterUrl())).rejects.toThrow();
  });

  test("the guard still refuses a blocked host before the proxy is asked", async () => {
    const proxy = await startPinnedProxy();
    const guard = guardAllowingOrigin();
    const dispatcher = createEgressDispatcher({
      guard,
      proxyUrl: proxy.url,
      requestTls: { ca: certificate.ca },
    });
    cleanups.push(() => dispatcher.close());

    const fetchThroughProxy = createGuardedFetch(guard, globalThis.fetch, {
      dispatcher: dispatcher.dispatcher,
    });

    await expect(
      fetchThroughProxy(`https://${BLOCKED_HOST}:${origin.port}/creds`),
    ).rejects.toMatchObject({ code: "BLOCKED_TARGET" });
  });
});

describe("chained mode, which is what PROXY_URL actually describes", () => {
  test("bytes move through two real proxies to an HTTPS origin", async () => {
    const upstream = await startPinnedProxy();
    const chained = await startProxy({
      // In chained mode this process's DNS view is not the one that matters, so
      // the pre-flight check is all that applies — the trade dl-8 documents.
      guard: createSsrfGuard({ allowPrivateAddresses: true }),
      logger: NOOP_LOGGER,
      upstreamProxyUrl: upstream.url,
    });

    expect(chained.mode).toBe("chained");
    const { body } = await getThroughTunnel(chained.port, ORIGIN_HOST, origin.port, "/master.m3u8");

    expect(body).toContain("#EXTM3U");
  });
});
