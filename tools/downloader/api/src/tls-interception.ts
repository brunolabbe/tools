/**
 * The certificates the egress proxy needs to terminate TLS for ffmpeg.
 *
 * ## Why a proxy has to hold the certificate at all
 *
 * `dl-19` put `-tls_verify 1` on every remote input, and `dl-21` measured how
 * far that reaches: the manifest connection and nothing else. libavformat copies
 * a **compile-time** list of seven options onto the connections the HLS and DASH
 * demuxers open for segments (`ffio_copy_url_options`, `libavformat/aviobuf.c`)
 * and the TLS settings are not among them, so no argument, prefix or dictionary
 * puts them back. The manifest is kilobytes of text; the segments are the entire
 * video.
 *
 * One of those seven propagated options is `http_proxy` — and since `dl-11`
 * every ffmpeg egress already goes through this service's loopback guarded
 * proxy, unconditionally. So the proxy is on every segment connection today.
 * `dl-27` makes it **terminate** those connections rather than tunnel them:
 *
 * ```
 * ffmpeg --TLS(a leaf issued here)--> egress proxy --TLS(verified)--> origin
 * ```
 *
 * ffmpeg checks the leaf on the manifest, where `-tls_verify 1` reaches, and
 * ignores it on the segments, where it never could — and either way the real
 * origin has been verified, by us, on both.
 *
 * ## What this costs, stated rather than buried
 *
 * It reverses `dl-14`, which chose a CONNECT tunnel precisely so the certificate
 * reaching ffmpeg is the origin's own. Two things follow and neither is small:
 * ffmpeg never sees an origin certificate again, and **every media byte crosses
 * this process in plaintext**. The trade is that segment origins are verified at
 * all, which they were not. See `dl-27` and `00-ANALYSIS.md` §11.
 *
 * Only ffmpeg's proxy intercepts. Chromium and yt-dlp verify their own
 * connections without help, so the tiers keep a tunnelling proxy and keep seeing
 * origin certificates — `server.ts` starts one of each.
 *
 * ## Why `node-forge`
 *
 * Node's `crypto` generates keys and parses X.509 but **writes no certificate**,
 * so issuing one at runtime needs either a dependency or `openssl` on `PATH`,
 * and this service runs in a container that has no reason to carry it. forge was
 * already here as the TLS fixtures' devDependency; `dl-27` promotes it to a
 * runtime dependency of `@downloader/api`, which is what puts it past
 * `npm prune --omit=dev` and into the image.
 *
 * The keys are still Node's: `generateKeyPairSync` is native and takes
 * milliseconds where forge's pure-JS RSA keygen takes seconds, and boot pays for
 * two of them. forge only signs.
 */

import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import forge from "node-forge";

/** `subjectAltName` type numbers, from RFC 5280 §4.2.1.6. */
const SAN_DNS = 2;
const SAN_IP = 7;

/**
 * Both certificates outlive any process that could use them.
 *
 * The root's private key is generated per process and **never written
 * anywhere** — not to the temp file below, which holds the certificate only — so
 * what bounds the trust is the process, not `notAfter`. A short expiry would only
 * add a way for a long-running deployment to start failing every download on a
 * Tuesday, which is the failure mode a generated certificate exists to avoid.
 */
const VALIDITY_YEARS = 10;

export interface TlsInterceptionOptions {
  /**
   * The operator's private root, **merged with** the system store rather than
   * replacing it.
   *
   * This is where `FFMPEG_CA_FILE` goes now, and the side it goes to is the
   * change: ffmpeg's `-ca_file` replaces its store outright, so ffmpeg's bundle
   * has to become the generated root below and nothing else. The proxy is the
   * side that talks to real origins, so the proxy is the side that needs the
   * operator's root **and** the public roots. Getting these two backwards fails
   * closed on every public origin.
   */
  caFile?: string | undefined;
  /**
   * Off is `FFMPEG_ALLOW_UNVERIFIED_TLS`, and it now means what it says for the
   * first time: the party that checks origin certificates is this proxy, so
   * turning verification off turns *this* off. Interception is unaffected — the
   * plaintext hop through this process is there either way.
   */
  verifyOrigins?: boolean;
}

export interface InterceptionLeaf {
  key: string;
  /** Leaf then root, so a client that has neither can still build the chain. */
  cert: string;
}

export interface TlsInterception {
  /** The generated root, PEM on disk, for ffmpeg's `-ca_file`. */
  rootCaPath: string;
  rootCaPem: string;
  /** Trust anchors for the origin side; `undefined` means the system store. */
  originCa: readonly string[] | undefined;
  verifyOrigins: boolean;
  /** A server certificate for one CONNECT target's host. Cached per host. */
  leafFor(host: string): InterceptionLeaf;
  close(): Promise<void>;
}

function newSerial(): string {
  // A leading zero byte keeps the DER INTEGER positive; forge writes the hex as
  // given, and a serial with the high bit set is a negative number some stacks
  // reject outright.
  return `00${forge.util.bytesToHex(forge.random.getBytesSync(16))}`;
}

function generateRsaPem(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { privatePem: privateKey, publicPem: publicKey };
}

function validity(cert: forge.pki.Certificate): void {
  // Backdated: a container and an origin whose clocks disagree by a minute must
  // not produce a certificate that is not yet valid.
  cert.validity.notBefore = new Date(Date.now() - 5 * 60_000);
  cert.validity.notAfter = new Date(Date.now() + VALIDITY_YEARS * 365 * 24 * 3_600_000);
}

/**
 * Generates the root and the one leaf key every issued certificate shares.
 *
 * One key for every leaf rather than one per host is deliberate: the leaves are
 * issued on demand, in front of a download, and RSA keygen is the only expensive
 * part of issuing one. Reusing the key makes a leaf a signature rather than a
 * key generation, and costs nothing — every one of them is signed by the same
 * root, trusted by the same single client, for the lifetime of one process.
 */
export async function createTlsInterception(
  options: TlsInterceptionOptions = {},
): Promise<TlsInterception> {
  const rootKeys = generateRsaPem();
  const rootPrivate = forge.pki.privateKeyFromPem(rootKeys.privatePem);
  const rootPublic = forge.pki.publicKeyFromPem(rootKeys.publicPem);

  const root = forge.pki.createCertificate();
  root.publicKey = rootPublic;
  root.serialNumber = newSerial();
  validity(root);
  const rootName = [
    { name: "commonName", value: "downloader egress proxy root" },
    { name: "organizationName", value: "webtools downloader" },
  ];
  root.setSubject(rootName);
  root.setIssuer(rootName);
  root.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", critical: true, keyCertSign: true, cRLSign: true },
    { name: "subjectKeyIdentifier" },
  ]);
  root.sign(rootPrivate, forge.md.sha256.create());
  const rootCaPem = forge.pki.certificateToPem(root);
  const rootKeyIdentifier = root.generateSubjectKeyIdentifier().getBytes();

  const leafKeys = generateRsaPem();
  const leafPublic = forge.pki.publicKeyFromPem(leafKeys.publicPem);

  // 0700, and the file inside it is the certificate — the public half. The
  // private key stays in this process's memory: a root key on disk is a
  // machine-wide licence to impersonate every origin this service downloads
  // from, and nothing here needs it to be readable.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-egress-ca-"));
  const rootCaPath = path.join(dir, "egress-root.pem");
  await fs.writeFile(rootCaPath, rootCaPem, { encoding: "utf8", mode: 0o600 });

  const operatorCa =
    options.caFile === undefined || options.caFile === ""
      ? null
      : await fs.readFile(options.caFile, "utf8");

  const leaves = new Map<string, InterceptionLeaf>();

  function leafFor(host: string): InterceptionLeaf {
    const cached = leaves.get(host);
    if (cached !== undefined) return cached;

    const cert = forge.pki.createCertificate();
    cert.publicKey = leafPublic;
    cert.serialNumber = newSerial();
    validity(cert);
    // A CN is capped at 64 characters by the schema and is not what anything
    // matches on any more; `subjectAltName` below is.
    cert.setSubject([{ name: "commonName", value: host.slice(0, 64) }]);
    cert.setIssuer(root.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", critical: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        // **An IP has no SNI** (RFC 6066 forbids it), so a numeric CONNECT
        // target needs the address in `subjectAltName` rather than the name.
        // Node's failure for the wrong one here reads like a network error.
        altNames: [
          net.isIP(host) === 0 ? { type: SAN_DNS, value: host } : { type: SAN_IP, ip: host },
        ],
      },
      { name: "subjectKeyIdentifier" },
      // **`keyIdentifier: true` is the wrong answer here and fails in a way that
      // reads like a network problem.** forge resolves it against the
      // certificate *being signed*, so a leaf gets its own key's identifier
      // where the issuer's belongs; OpenSSL then matches the AKID against no
      // certificate it holds and reports `UNABLE_TO_VERIFY_LEAF_SIGNATURE` —
      // "unable to verify the first certificate" — even though the signature is
      // perfectly good and the issuer is in the store by name. Measured in
      // dl-27, on both a bare Node client and ffmpeg.
      { name: "authorityKeyIdentifier", keyIdentifier: rootKeyIdentifier },
    ]);
    cert.sign(rootPrivate, forge.md.sha256.create());

    const leaf: InterceptionLeaf = {
      key: leafKeys.privatePem,
      cert: `${forge.pki.certificateToPem(cert).trim()}\n${rootCaPem.trim()}\n`,
    };
    leaves.set(host, leaf);
    return leaf;
  }

  return {
    rootCaPath,
    rootCaPem,
    // `tls.rootCertificates` is the merge. Passing `ca` at all replaces the
    // system store in Node exactly as `-ca_file` does in ffmpeg, so an operator
    // root handed over on its own would fail every public origin.
    originCa: operatorCa === null ? undefined : [...tls.rootCertificates, operatorCa],
    verifyOrigins: options.verifyOrigins !== false,
    leafFor,
    close: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

/**
 * An origin certificate this proxy refused, marked as such by its type.
 *
 * It has to be a type rather than a shape, and finding that out cost a
 * measurement. Node's own error for a rejected chain carries **`code` and
 * nothing else** — `{ message: "self-signed certificate", code:
 * "DEPTH_ZERO_SELF_SIGNED_CERT" }`, one own key — which is the same shape an
 * `ECONNREFUSED` has, so nothing about the object distinguishes "we refused the
 * certificate" from "the network refused the packet". The peer certificate is
 * **not** attached; only `ERR_TLS_CERT_ALTNAME_INVALID` carries one. What does
 * say so reliably is the socket: `TLSSocket.authorizationError` is set before
 * the socket is destroyed, for both the chain check and the name check. So the
 * site holding the socket wraps, and `egress-proxy.ts` splits on the type —
 * the same move dl-26 made with `AppError`, for the same reason.
 */
export class OriginCertificateError extends Error {
  /** The OpenSSL verify code, e.g. `DEPTH_ZERO_SELF_SIGNED_CERT`. */
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OriginCertificateError";
    this.code = code;
  }
}

export function isCertificateRejection(error: unknown): error is OriginCertificateError {
  return error instanceof OriginCertificateError;
}

/**
 * The verify code, safe to put in an HTTP status line.
 *
 * The value reaches a reason phrase, and a phrase that could carry CRLF is a
 * response-splitting bug rather than a diagnostic. OpenSSL's codes are already
 * `[A-Z_]`; the filter is here because the alternative is trusting that forever.
 */
export function certificateRejectionCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== "string") return "UNKNOWN";
  const safe = code.replaceAll(/[^A-Za-z0-9_.-]/gu, "_");
  return safe.length === 0 ? "UNKNOWN" : safe.slice(0, 64);
}
