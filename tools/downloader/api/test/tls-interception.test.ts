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

import { X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import { afterEach, describe, expect, test } from "vitest";
import { certificateRejectionCode, createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { createFixtureCertificate } from "./helpers/tls-origin.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function interception(caFile?: string): Promise<TlsInterception> {
  const intercept = await createTlsInterception(caFile === undefined ? {} : { caFile });
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
    const intercept = await interception(fixture.caPath);

    // The system store is really there to be kept — if this were empty the
    // assertion below would be vacuous.
    expect(tls.rootCertificates.length).toBeGreaterThan(20);
    expect(intercept.originCa).toHaveLength(tls.rootCertificates.length + 1);
    expect(intercept.originCa).toContain(tls.rootCertificates[0]);
    expect(intercept.originCa?.at(-1)).toBe(await fs.readFile(fixture.caPath, "utf8"));
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
    expect(files).toEqual([path.basename(intercept.rootCaPath)]);

    const written = await fs.readFile(intercept.rootCaPath, "utf8");
    expect(written).toBe(intercept.rootCaPem);
    expect(written).not.toContain("PRIVATE KEY");
    expect(new X509Certificate(written).subject).toContain("downloader egress proxy root");
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
