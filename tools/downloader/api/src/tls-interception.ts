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
 * ## Who is behind an intercepting proxy
 *
 * ffmpeg since `dl-27`; **the browser and yt-dlp tiers as well since `dl-37`**,
 * on a second interception of their own. The tiers were left on a tunnel
 * originally because they verify their own connections without help — true, and
 * true against their *own* trust stores, which nothing in this repo writes to.
 * That is what made `EGRESS_CA_FILE` unable to reach the two tiers that load the
 * page. Terminating their TLS here hands them the operator's trust for free,
 * because this proxy is the side that meets the origin.
 *
 * Two interceptions rather than one shared root, and the reason is a flag:
 * `FFMPEG_ALLOW_UNVERIFIED_TLS` sets `verifyOrigins: false`, and it is named for
 * ffmpeg. A shared interception would carry that policy onto Chromium and
 * yt-dlp, silently widening the last-resort setting to the two tiers that read
 * pages. `server.ts` therefore builds one per client, and pays two extra RSA
 * keygens at boot for it — measured at 237 ms for four on this machine, and only
 * when a tier is actually registered.
 *
 * ## What each client needs from this to trust the leaf
 *
 * ffmpeg takes `rootCaPath` as `-ca_file`. The two tiers cannot: Chromium on
 * Linux reads NSS, which needs a `certutil` this image does not ship, and
 * yt-dlp's PyInstaller build carries its own `certifi` bundle that wins over
 * `SSL_CERT_FILE`. So they take `rootSpkiSha256` and `trustBundlePath` instead;
 * both are documented where they are declared, and both were measured rather
 * than assumed (`dl-37`).
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

import { createHash, generateKeyPairSync, X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";
import { withSystemRoots } from "./operator-ca.ts";

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
   * The operator's private root as **PEM text**, merged with the system store
   * rather than replacing it.
   *
   * This is where `EGRESS_CA_FILE` goes now, and the side it goes to is the
   * change dl-27 made: ffmpeg's `-ca_file` replaces its store outright, so
   * ffmpeg's bundle has to become the generated root below and nothing else. The
   * proxy is the side that talks to real origins, so the proxy is the side that
   * needs the operator's root **and** the public roots. Getting these two
   * backwards fails closed on every public origin.
   *
   * Text rather than a path since dl-31: the undici dispatcher needs the same
   * anchor and it is not created on this code path, so `server.ts` reads the
   * file once and hands both the result. Two reads of one path is how two
   * error behaviours grow.
   */
  operatorCa?: string | undefined;
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
  /**
   * Base64 SHA-256 of the root's DER `SubjectPublicKeyInfo` — the value
   * Chromium's `--ignore-certificate-errors-spki-list` takes, and the only way
   * measured to work in this image.
   *
   * **It says "ignore errors for chains carrying this key", not "trust this
   * root",** and the distinction is the whole of why it is safe here. What
   * bounds it is that the key is generated per process by `generateRsaPem`
   * above and **never written anywhere** — not to the temp directory, which
   * holds certificates only — so no chain outside this process can carry it.
   * A future that put the root's private key on disk would turn this flag into
   * a machine-wide licence to impersonate any origin to Chromium, and that is
   * the reason the key stays in memory rather than a tidiness preference.
   *
   * The root rather than the leaf, though `dl-37` measured both working
   * (Chromium matches against every SPKI in the chain it built, and the proxy
   * sends leaf-then-root). The root is the anchor whose trust is actually being
   * conveyed, it is the shape mitmproxy and Burp document so a reader
   * recognises it — and `leafFor` shares one key across every host today only
   * as an issuing optimisation, so pinning the leaf would break silently the
   * day somebody gives each host its own.
   */
  rootSpkiSha256: string;
  /**
   * The public roots **plus** the generated root, PEM on disk — yt-dlp's
   * `SSL_CERT_FILE`.
   *
   * Merged, not replaced, and that is not theoretical tidiness: `SSL_CERT_FILE`
   * replaces OpenSSL's default file exactly as ffmpeg's `-ca_file` replaces its
   * store, so the generated root handed over on its own would fail every public
   * origin the moment anything reached one directly. `dl-31` hit the identical
   * trap on the undici side and answered it with the same `withSystemRoots`.
   *
   * A separate file from `rootCaPath` because the two clients want opposite
   * things: ffmpeg is *only* ever talking to this proxy and its bundle must be
   * the generated root alone, while yt-dlp's must not fail closed if some code
   * path of its own goes around `--proxy`.
   *
   * The operator's own root is deliberately **not** in here. yt-dlp behind this
   * proxy never meets an origin certificate — it meets a leaf minted above — so
   * adding a private anchor to a client that cannot use it would widen trust
   * for nothing.
   */
  trustBundlePath: string;
  /** Trust anchors for the origin side; `undefined` means the system store. */
  originCa: readonly string[] | undefined;
  verifyOrigins: boolean;
  /** A server certificate for one CONNECT target's host. Cached per host. */
  leafFor(host: string): InterceptionLeaf;
  close(): Promise<void>;
}

/**
 * Sixteen random bytes as the hex of a **minimally-encoded positive** DER
 * `INTEGER`, which is what `cert.serialNumber` is fed straight into.
 *
 * The unconditional `00` prefix this replaced produced a certificate OpenSSL
 * refuses to parse at all, once in every 512 issued — the defect dl-33 was
 * filed for. A DER `INTEGER` is signed and two's-complement, so a leading `00`
 * is *required* when the first content byte has its high bit set and
 * **forbidden** when it does not: a redundant one is `ASN1_R_ILLEGAL_PADDING`.
 * forge does normalise, but by exactly one byte — `asn1.toDer` carries a `TODO:
 * should all leading bytes be stripped vs just one? .. ex '00 00 01' => '01'?`
 * — so `00` in front of a draw whose own first byte is `0x00` leaves one
 * redundant zero behind whenever the *second* byte's high bit is clear.
 * That is `1/256 × 1/2`, and a run of this tool's suite issues 133 serials.
 *
 * The failure is not in the test fixtures and not confined to them: it lands in
 * `egress-proxy.ts`, at the `new tls.TLSSocket({ cert })` that arms an
 * intercepted CONNECT, and it throws there synchronously inside a
 * `secureConnect` handler — so a download hangs rather than failing.
 *
 * Stripping first and then re-prefixing is what makes this idempotent under
 * forge's own one-byte strip: a minimal encoding survives it unchanged.
 *
 * Exported so the encoding can be asserted over draws a real run reaches once
 * in five hundred, without waiting for one.
 */
export function positiveDerIntegerHex(bytes: string): string {
  const hex = forge.util.bytesToHex(bytes).replace(/^(?:00)+/u, "");
  if (hex === "") return "00";
  return Number.parseInt(hex.slice(0, 2), 16) >= 0x80 ? `00${hex}` : hex;
}

function newSerial(): string {
  return positiveDerIntegerHex(forge.random.getBytesSync(16));
}

/**
 * Base64 SHA-256 over the certificate's DER `SubjectPublicKeyInfo`.
 *
 * Node's `X509Certificate` is doing the parsing rather than forge because this
 * has to agree byte-for-byte with what BoringSSL hashes inside Chromium, and
 * the round trip through a second ASN.1 implementation is one more place for
 * that to be subtly wrong. `export({ type: "spki" })` is the same encoding
 * Chromium hashes: the whole `SubjectPublicKeyInfo`, algorithm identifier
 * included, not the bare key bits.
 */
function spkiSha256(certificatePem: string): string {
  const spki = new X509Certificate(certificatePem).publicKey.export({
    type: "spki",
    format: "der",
  });
  return createHash("sha256").update(spki).digest("base64");
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
  // Same directory, so one `close()` takes both down. See `trustBundlePath` for
  // why it is a second file rather than the same one.
  const trustBundlePath = path.join(dir, "egress-trust-bundle.pem");
  await fs.writeFile(
    trustBundlePath,
    `${withSystemRoots(rootCaPem)
      .map((pem) => pem.trim())
      .join("\n")}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const operatorCa =
    options.operatorCa === undefined || options.operatorCa === "" ? null : options.operatorCa;

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
    rootSpkiSha256: spkiSha256(rootCaPem),
    trustBundlePath,
    // One merge, in `operator-ca.ts`, shared with the dispatcher — because
    // "passing `ca` replaces the store" is a trap each client would otherwise
    // have to be told about separately, and dl-31 added a second client.
    originCa: operatorCa === null ? undefined : withSystemRoots(operatorCa),
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
