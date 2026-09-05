/**
 * The certificates ffmpeg's egress proxy issues, tested where the mistakes are.
 *
 * `two-origin-tls.test.ts` proves the mechanism end to end with real ffmpeg.
 * What it cannot reach is the pair of settings dl-27's brief calls out as the
 * ones that fail closed on every public origin if they are the wrong way round,
 * because **every fixture origin in this repo chains to a private root** — a
 * proxy that threw the system store away would pass every suite here and refuse
 * the entire internet. That one is asserted on the composition rather than on a
 * handshake, since a handshake against a public CA would be a live network call.
 *
 * Nothing here touches the network or the disk outside a temp dir.
 */

import { createHash, X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import forge from "node-forge";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  certificateRejectionCode,
  createTlsInterception,
  positiveDerIntegerHex,
} from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { createFixtureCertificate } from "./helpers/tls-origin.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function interception(operatorCa?: string): Promise<TlsInterception> {
  const intercept = await createTlsInterception(operatorCa === undefined ? {} : { operatorCa });
  cleanups.push(() => intercept.close());
  return intercept;
}

function leafOf(intercept: TlsInterception, host: string): X509Certificate {
  const pem = intercept.leafFor(host).cert;
  const end = pem.indexOf("-----END CERTIFICATE-----");
  return new X509Certificate(pem.slice(0, end + "-----END CERTIFICATE-----".length));
}

describe("the trust store the proxy verifies origins against", () => {
  test("the operator's root is added to the system store, not substituted for it", async () => {
    // **The trap dl-27 names.** `-ca_file` replaces ffmpeg's store, and Node's
    // `ca` option replaces its own the same way — so handing this the
    // operator's root alone would leave a deployment able to reach its own
    // internal CDN and nothing else, with the symptom being every public origin
    // refused on trust. A mutation that made this `[operatorCa]` survived every
    // other suite in this repo, because every fixture origin here chains to a
    // private root.
    const fixture = await createFixtureCertificate({ ipAddresses: ["127.0.0.1"] });
    cleanups.push(() => fixture.cleanup());
    const intercept = await interception(fixture.ca);

    // The system store is really there to be kept — if this were empty the
    // assertion below would be vacuous.
    expect(tls.rootCertificates.length).toBeGreaterThan(20);
    expect(intercept.originCa).toHaveLength(tls.rootCertificates.length + 1);
    expect(intercept.originCa).toContain(tls.rootCertificates[0]);
    expect(intercept.originCa?.at(-1)).toBe(fixture.ca);
  });

  test("with no operator root it stays undefined, which is Node's own system store", async () => {
    // Not an empty array, which would trust nothing at all.
    const intercept = await interception();
    expect(intercept.originCa).toBeUndefined();
    expect(intercept.verifyOrigins).toBe(true);
  });

  test("FFMPEG_ALLOW_UNVERIFIED_TLS reaches here and nowhere else it matters", async () => {
    const intercept = await createTlsInterception({ verifyOrigins: false });
    cleanups.push(() => intercept.close());
    expect(intercept.verifyOrigins).toBe(false);
  });
});

describe("the generated root", () => {
  test("its private key is never written anywhere", async () => {
    // A root key on disk is a machine-wide licence to impersonate every origin
    // this service downloads from, for as long as the file lives. Only the
    // certificate — the public half — is written, because ffmpeg's `-ca_file`
    // takes a path.
    const intercept = await interception();
    const dir = path.dirname(intercept.rootCaPath);
    const files = await fs.readdir(dir);
    // Two files since dl-37, and the assertion is still that the set is closed:
    // whatever is added here has to be argued for one file at a time.
    expect(files.toSorted()).toEqual(
      [path.basename(intercept.rootCaPath), path.basename(intercept.trustBundlePath)].toSorted(),
    );
    for (const name of files) {
      expect(await fs.readFile(path.join(dir, name), "utf8")).not.toContain("PRIVATE KEY");
    }

    const written = await fs.readFile(intercept.rootCaPath, "utf8");
    expect(written).toBe(intercept.rootCaPem);
    expect(new X509Certificate(written).subject).toContain("downloader egress proxy root");
  });

  /**
   * dl-37, Done-when 3, on the yt-dlp half: `SSL_CERT_FILE` **replaces**
   * OpenSSL's default file rather than adding to it, so a bundle carrying only
   * the generated root would fail every public origin the moment anything went
   * around the proxy. dl-31 met the identical trap on the undici side.
   */
  test("the tiers' trust bundle merges the public roots rather than replacing them", async () => {
    const intercept = await interception();
    const bundle = await fs.readFile(intercept.trustBundlePath, "utf8");

    // Vacuous if the store were empty, which is why this is asserted first.
    expect(tls.rootCertificates.length).toBeGreaterThan(20);
    const count = bundle.match(/-----BEGIN CERTIFICATE-----/gu)?.length ?? 0;
    expect(count).toBe(tls.rootCertificates.length + 1);
    expect(bundle).toContain((tls.rootCertificates[0] ?? "").trim());
    expect(bundle).toContain(intercept.rootCaPem.trim());

    // A bundle OpenSSL will not parse is the same failure wearing a different
    // hat, so it is loaded rather than only counted.
    expect(() => tls.createSecureContext({ ca: bundle })).not.toThrow();
  });

  /**
   * dl-37: Chromium takes a hash of the root's SPKI, not the root, and it has
   * to be the hash BoringSSL computes or the flag silently does nothing.
   */
  test("the root's SPKI hash is over the SubjectPublicKeyInfo, base64", async () => {
    const intercept = await interception();

    const expected = createHash("sha256")
      .update(
        new X509Certificate(intercept.rootCaPem).publicKey.export({
          type: "spki",
          format: "der",
        }),
      )
      .digest("base64");
    expect(intercept.rootSpkiSha256).toBe(expected);
    // 32 bytes, base64. A hex digest here would be accepted by Chromium's
    // parser as a name it never matches, which is the silent-failure shape.
    expect(intercept.rootSpkiSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/u);

    // Two processes must not share one, since what bounds the flag is that the
    // key never leaves the process that made it.
    const other = await interception();
    expect(other.rootSpkiSha256).not.toBe(intercept.rootSpkiSha256);
  });

  test("closing takes the directory with it", async () => {
    const intercept = await createTlsInterception({});
    const dir = path.dirname(intercept.rootCaPath);
    await intercept.close();
    await expect(fs.stat(dir)).rejects.toThrow();
  });
});

describe("the leaf issued per CONNECT target", () => {
  test("a named target gets a DNS name and a numeric one gets an address", async () => {
    // **An IP has no SNI** — RFC 6066 forbids it — so a leaf minted for a
    // numeric target has to carry the address in `subjectAltName` or nothing
    // matches it, and Node's failure for that reads like a network error rather
    // than a trust one.
    const intercept = await interception();

    const named = leafOf(intercept, "cdn.example.test");
    expect(named.subjectAltName).toBe("DNS:cdn.example.test");

    const numeric = leafOf(intercept, "203.0.113.7");
    expect(numeric.subjectAltName).toBe("IP Address:203.0.113.7");

    const v6 = leafOf(intercept, "2001:db8::1");
    expect(v6.subjectAltName).toContain("IP Address:");
  });

  test("it chains to the root, which is what a client with only the root can check", async () => {
    // The chain is what broke first and silently: forge resolves
    // `authorityKeyIdentifier: true` against the certificate being signed, so a
    // leaf carrying its own key's identifier makes OpenSSL report
    // `UNABLE_TO_VERIFY_LEAF_SIGNATURE` on a perfectly good signature.
    const intercept = await interception();
    const leaf = leafOf(intercept, "cdn.example.test");
    const root = new X509Certificate(intercept.rootCaPem);

    expect(leaf.issuer).toBe(root.subject);
    expect(leaf.verify(root.publicKey)).toBe(true);
    expect(leaf.checkIssued(root)).toBe(true);
    expect(leaf.ca).toBe(false);
    // Leaf then root, so a client that has neither can still build the chain.
    expect(intercept.leafFor("cdn.example.test").cert.match(/BEGIN CERTIFICATE/gu)).toHaveLength(2);
  });

  test("two targets get two certificates and one key", async () => {
    // Reissuing per host is a signature; regenerating a key per host would be
    // an RSA keygen in front of every download.
    const intercept = await interception();
    const a = intercept.leafFor("a.example.test");
    const b = intercept.leafFor("b.example.test");

    expect(a.key).toBe(b.key);
    expect(a.cert).not.toBe(b.cert);
    expect(intercept.leafFor("a.example.test").cert).toBe(a.cert);
    // Distinct serials, which a trust store and a log both care about.
    expect(leafOf(intercept, "a.example.test").serialNumber).not.toBe(
      leafOf(intercept, "b.example.test").serialNumber,
    );
  });
});

/**
 * dl-33's defect, forced rather than waited for.
 *
 * Every sighting in that ticket is `ERR_OSSL_ASN1_ILLEGAL_PADDING`, and it was
 * read as contention because it only ever turned up on a busy machine. It is
 * **not** contention and it is not the test fixtures: `newSerial()` used to put
 * an unconditional `00` in front of sixteen random bytes, and a DER `INTEGER`
 * forbids that leading zero when the byte after it has its high bit clear.
 * forge normalises by exactly one byte, so the draw that survives normalisation
 * illegal is `00` **then a byte under `0x80`** — `1/256 × 1/2 = 1/512`, against
 * the 133 serials one `--project downloader` run issues.
 *
 * What made it look like load is the *shape of the symptom*, not its cause: the
 * throw lands in `egress-proxy.ts`'s `secureConnect` handler, so the CONNECT
 * never completes, ffmpeg waits, and the run pays a 120 s test timeout plus a
 * 60 s hook timeout. That is the 182-second file in the ticket's sighting 3 —
 * the failure *is* the slowness, not a consequence of it.
 *
 * Stubbing the draw is what makes this a test rather than a lottery: 520 leaf
 * generations on a quiet machine failed to reproduce it (dl-29), and they never
 * could have at that sample size.
 */
/** Sixteen bytes, as forge hands them over: a binary string, `hex` then filler. */
function draw(hex: string): string {
  return forge.util.hexToBytes(hex.padEnd(32, "c"));
}

describe("a serial number OpenSSL will actually parse (dl-33)", () => {
  // `expected` is what `X509Certificate.serialNumber` prints: the value in
  // uppercase hex, without the DER sign byte, which Node does not display.
  const CASES: readonly { hex: string; expected: string; why: string }[] = [
    {
      hex: "007b",
      expected: `7B${"CC".repeat(14)}`,
      why: "the defect: a first byte of 00 and a second under 0x80",
    },
    {
      hex: "00ab",
      expected: `AB${"CC".repeat(14)}`,
      why: "a first byte of 00 and a second at or over 0x80: legal, and the shape dl-29 picked",
    },
    {
      hex: "0000007b",
      expected: `7B${"CC".repeat(12)}`,
      why: "several leading zeros, which forge's one-byte strip cannot rescue either",
    },
    {
      hex: "ff",
      expected: `FF${"CC".repeat(15)}`,
      why: "the high bit set, where the 00 is required and dropping it would make the serial negative",
    },
    {
      hex: "7f",
      expected: `7F${"CC".repeat(15)}`,
      why: "the high bit clear, where a 00 would be redundant",
    },
  ];

  test("the leaf the proxy arms a socket with parses, for every shape of draw", async () => {
    // The root takes the first draw and each leaf the next, so the defect shape
    // is exercised on both halves of the chain.
    const queue = [draw("007b"), ...CASES.map((c) => draw(c.hex))];
    const real = forge.random.getBytesSync.bind(forge.random);
    const spy = vi
      .spyOn(forge.random, "getBytesSync")
      .mockImplementation((count: number) => queue.shift() ?? real(count));

    try {
      const intercept = await interception();

      // The leaves before the root, deliberately: the leaf is the production
      // hot path, so an unfixed `newSerial()` has to fail *there* rather than
      // on a convenience assertion about the root.
      for (const [index, testCase] of CASES.entries()) {
        const host = `h${String(index)}.example.test`;
        const leaf = intercept.leafFor(host);
        // **The production call site**, verbatim from `egress-proxy.ts`: this
        // is a synchronous throw inside a `secureConnect` handler, which is why
        // the symptom is a hang and four unhandled errors rather than a failed
        // download. Before the fix it threw
        // `ERR_OSSL_ASN1_ILLEGAL_PADDING` with the exact OpenSSL stack the
        // ticket records — `PEM routines::ASN1 lib`, then two nested ASN.1
        // errors.
        expect(() => tls.createSecureContext({ cert: leaf.cert, key: leaf.key })).not.toThrow();
        expect(leafOf(intercept, host).serialNumber, testCase.why).toBe(testCase.expected);
      }

      // A root that will not parse is a `-ca_file` ffmpeg refuses outright, and
      // it takes the first draw — so the defect shape is covered on both halves
      // of the chain.
      expect(new X509Certificate(intercept.rootCaPem).serialNumber).toBe(CASES[0]?.expected);
      expect(queue).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  test("the encoding is minimal and positive, including where the draw is all zeros", () => {
    // Minimal *and* idempotent: forge strips one redundant leading byte on its
    // way to DER, so an encoding that is already minimal has to survive that
    // pass unchanged, which is the property the round-trip above rests on.
    expect(positiveDerIntegerHex(forge.util.hexToBytes("00".repeat(16)))).toBe("00");
    expect(positiveDerIntegerHex(forge.util.hexToBytes("0080"))).toBe("0080");
    expect(positiveDerIntegerHex(forge.util.hexToBytes("007f"))).toBe("7f");
    expect(positiveDerIntegerHex(forge.util.hexToBytes("0001"))).toBe("01");
    expect(positiveDerIntegerHex(forge.util.hexToBytes("8000"))).toBe("008000");
  });
});

describe("the verify code that travels in a status line", () => {
  test("it is passed through when it is already safe", () => {
    expect(certificateRejectionCode({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe(
      "DEPTH_ZERO_SELF_SIGNED_CERT",
    );
  });

  test("anything that could split a response is not", () => {
    // It reaches an HTTP reason phrase. A code carrying CRLF would be response
    // splitting rather than a diagnostic.
    expect(certificateRejectionCode({ code: "BAD\r\nX-Injected: 1" })).toBe("BAD__X-Injected__1");
    expect(certificateRejectionCode({ code: "x".repeat(200) })).toHaveLength(64);
    expect(certificateRejectionCode({})).toBe("UNKNOWN");
    expect(certificateRejectionCode(null)).toBe("UNKNOWN");
  });
});
