/**
 * A fixture origin that serves TLS, which nothing in this repo did before dl-14.
 *
 * ## Why it is here and not in `engine/test/helpers/`
 *
 * What dl-14 covers is a *combination*: real ffmpeg (engine) fetching through
 * the real guarded proxy (api) over a real TLS handshake. `api` is the only
 * package that depends on both, so it is the only place the combination can be
 * assembled without either an engine test reaching into `@downloader/api` — the
 * wrong way round the dependency graph — or one package's tests importing
 * another's test helper, which dl-13 named as the one import not to make easy.
 *
 * `engine/test/helpers/http.ts` stays as it is, plain HTTP: the engine's own
 * suites have no proxy in them and no reason to pay for a handshake. This file
 * is a second HLS fixture rather than a reuse of that one for the same reason,
 * and the duplication is bounded to the ffmpeg invocation below.
 *
 * ## The certificate is generated, and by `node-forge`
 *
 * Generated per run rather than checked in, because a checked-in certificate
 * expires — on a Tuesday, eighteen months from now, in someone else's CI run.
 *
 * Node's own `crypto` cannot make one: it generates keys and parses X.509, but
 * writes no certificate. That leaves spawning `openssl` or taking a dependency,
 * and **`ci.yml` runs `npm test` on `windows-latest` as well as ubuntu** — a
 * fixture that needs `openssl` on `PATH` is a suite that is red on half the
 * matrix, for a reason that has nothing to do with the code under test. So a
 * dependency, on the same principle as `ffmpeg-static`: the binary a test needs
 * comes from `node_modules`, not from the machine.
 *
 * `node-forge` rather than `selfsigned`, which is the more obvious package:
 * `selfsigned@5` brings 19 transitive packages (`@peculiar/x509`, `pkijs`,
 * `asn1js` and the `@peculiar/asn1-*` family) where forge is one with no
 * dependencies of its own, and the twenty lines it saves are the twenty below.
 * Both are dev-only and neither reaches an image.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import https from "node:https";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

/** What a test asserts the peer certificate's subject is, and nothing else. */
export const CERTIFICATE_COMMON_NAME = "downloader-fixture";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
}

export interface FixtureCertificate {
  /** PEM text, for undici's `ca` connect option. */
  ca: string;
  /** The same PEM on disk, for ffmpeg's `-ca_file`. */
  caPath: string;
  key: string;
  cert: string;
  cleanup(): Promise<void>;
}

export interface TlsOrigin {
  port: number;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** Runs a binary with an argument array. Never a shell — see the root CLAUDE.md. */
function run(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error(`${command} could not be started; this fixture generates its clip with it.`)
          : error,
      );
    });
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** `subjectAltName` type numbers, from RFC 5280 §4.2.1.6. */
const SAN_DNS = 2;
const SAN_IP = 7;

let serialCounter = 0;

/**
 * A self-signed certificate for the names a test will actually use.
 *
 * Both forms are needed and for different reasons. `dnsNames` covers the
 * proxied path, where the client names a host and the proxy resolves it — the
 * certificate has to match the *name*, since that is all the client ever saw.
 * `ipAddresses` covers a direct connection to the fixture, and Node refuses a
 * bare-IP certificate without an IP entry in `subjectAltName`, with an error
 * that reads like a network failure rather than a trust one.
 *
 * It is its own issuer, so the same PEM is both the server certificate and the
 * CA a client is pointed at — which is all a one-hop fixture chain needs.
 */
export async function createFixtureCertificate(names: {
  dnsNames?: readonly string[];
  ipAddresses?: readonly string[];
  /**
   * Defaults to `CERTIFICATE_COMMON_NAME`, which is what the single-origin
   * suites assert on. **A test that puts two of these in one CA bundle must
   * give them different names**, and dl-21 found out the hard way: a trust
   * store is indexed by subject, so two self-signed certificates sharing a
   * subject collide and only the first is ever used. The bundle then verifies
   * one origin, silently refuses the other, and reads as a network failure.
   */
  commonName?: string;
}): Promise<FixtureCertificate> {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Defence in depth, and **not** what fixes the collision — a mutation run
  // proved it: reverting this to a constant `01` while keeping distinct common
  // names leaves every test green. A trust store indexes by subject, so the
  // subject is the load-bearing half. Distinct serials are kept because two
  // certificates sharing one is wrong on its own terms, not because anything
  // here depends on them.
  serialCounter += 1;
  cert.serialNumber = serialCounter.toString(16).padStart(2, "0");
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  // Short-lived on purpose: it exists for one test run, and a fixture key that
  // outlives the run is a key somebody could be tempted by.
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const attributes = [{ name: "commonName", value: names.commonName ?? CERTIFICATE_COMMON_NAME }];
  cert.setSubject(attributes);
  cert.setIssuer(attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true, keyCertSign: true },
    {
      name: "subjectAltName",
      altNames: [
        ...(names.dnsNames ?? []).map((value) => ({ type: SAN_DNS, value })),
        ...(names.ipAddresses ?? []).map((ip) => ({ type: SAN_IP, ip })),
      ],
    },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-tls-fixture-"));
  // On disk as well as in memory: ffmpeg's `-ca_file` takes a path, and undici
  // takes the text.
  const certPath = path.join(dir, "cert.pem");
  await fs.writeFile(certPath, certPem, "utf8");

  return {
    ca: certPem,
    caPath: certPath,
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: certPem,
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

export type FixtureHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void | Promise<void>;

/** The plain-HTTP fixture server's shape, over TLS. Loopback, ephemeral port. */
export async function startTlsOrigin(
  certificate: FixtureCertificate,
  handler: FixtureHandler,
): Promise<TlsOrigin> {
  const requests: RecordedRequest[] = [];

  const server = https.createServer(
    { key: certificate.key, cert: certificate.cert },
    (request, response) => {
      requests.push({
        method: request.method ?? "GET",
        url: request.url ?? "/",
        headers: request.headers,
      });
      void (async () => {
        try {
          await handler(request, response);
        } catch {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        }
      })();
    },
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/**
 * A real HLS stream on disk: synthetic video and a tone, segmented into `.ts`
 * with a media and a master playlist.
 *
 * Kept to the same shape as `engine/test/hls-e2e.test.ts`'s generator so the two
 * stay comparable; what differs there is only that its origin speaks plain HTTP.
 */
export async function generateHlsClip(
  ffmpegPath: string,
  dir: string,
  seconds: number,
): Promise<void> {
  await run(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=320x240:rate=15:duration=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-g",
    "15",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "0",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    path.join(dir, "seg%03d.ts"),
    path.join(dir, "index.m3u8"),
  ]);

  await fs.writeFile(
    path.join(dir, "master.m3u8"),
    [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240,CODECS="avc1.42c01e,mp4a.40.2"',
      "index.m3u8",
      "",
    ].join("\n"),
    "utf8",
  );
}

/**
 * Moves the clip's segments to a second directory and repoints the media
 * playlist at them by absolute URL — the shape a real CDN has and the one
 * dl-21 exists for.
 *
 * A single-origin fixture cannot express the question dl-21 asks: the manifest
 * connection and the segment connections have to be able to *disagree about
 * trust* before the difference between them is observable at all. So the
 * playlist stays on the origin serving `clipDir` and every `#EXTINF` line below
 * it names `segmentBaseUrl`, which is a different origin with a different
 * certificate.
 *
 * `segmentBaseUrl` has no trailing slash and is the second origin's root
 * (`https://127.0.0.1:<port>`), so the second origin must already be listening
 * when this is called. That is harmless: it serves `segmentDir` lazily, so it
 * can be started before there is anything in it.
 */
export async function splitHlsClip(
  clipDir: string,
  segmentDir: string,
  segmentBaseUrl: string,
): Promise<{ segmentNames: string[] }> {
  await fs.mkdir(segmentDir, { recursive: true });
  const segmentNames: string[] = [];
  for (const name of await fs.readdir(clipDir)) {
    if (!name.endsWith(".ts")) continue;
    await fs.rename(path.join(clipDir, name), path.join(segmentDir, name));
    segmentNames.push(name);
  }
  if (segmentNames.length === 0) throw new Error("the clip has no .ts segments to split off");

  const playlist = path.join(clipDir, "index.m3u8");
  const text = await fs.readFile(playlist, "utf8");
  const rewritten = text
    .split("\n")
    .map((line) => (line.endsWith(".ts") ? `${segmentBaseUrl}/${line}` : line))
    .join("\n");
  await fs.writeFile(playlist, rewritten, "utf8");

  segmentNames.sort();
  return { segmentNames };
}

/**
 * One PEM file holding several fixture CAs.
 *
 * ffmpeg's `-ca_file` takes **one** bundle and **replaces** the system store
 * rather than adding to it, so "trust both origins" is one file with both
 * certificates in it — never verification switched off, which is the trap dl-14,
 * dl-19 and dl-21 all carry.
 */
export async function createCaBundle(
  certificates: readonly FixtureCertificate[],
): Promise<{ path: string; cleanup(): Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-tls-bundle-"));
  const bundlePath = path.join(dir, "bundle.pem");
  await fs.writeFile(bundlePath, certificates.map((c) => c.ca.trim()).join("\n") + "\n", "utf8");
  return { path: bundlePath, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const CONTENT_TYPES: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
};

/** Serves a generated clip from `dir`, and nothing else. */
export function serveHlsFrom(dir: string): FixtureHandler {
  return async (request, response) => {
    const name = path.basename(new URL(request.url ?? "/", "https://x").pathname);
    let body: Buffer;
    try {
      body = await fs.readFile(path.join(dir, name));
    } catch {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(name)] ?? "application/octet-stream",
      "content-length": String(body.length),
    });
    response.end(body);
  };
}

/** Re-reads a produced file with ffmpeg; a non-zero exit means unplayable. */
export async function assertDecodable(ffmpegPath: string, file: string): Promise<void> {
  await run(ffmpegPath, [
    "-hide_banner",
    "-nostdin",
    "-loglevel",
    "error",
    "-xerror",
    "-i",
    file,
    "-f",
    "null",
    "-",
  ]);
}
