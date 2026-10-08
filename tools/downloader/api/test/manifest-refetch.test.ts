/**
 * dl-97: the browser tier's manifest re-fetch, now its own streaming client,
 * still goes where `context.request` went — through the guarded egress proxy,
 * with the context's cookies, trusting the proxy's generated root.
 *
 * ## Why here
 *
 * The guard and the proxy are `api`'s, and what has to be proved is that a real
 * `BrowserResolver` re-fetch meets them: a redirect the guard refuses is never
 * followed, a cookie reaches the hop that needs it, and an origin behind the
 * terminating proxy answers the re-fetch rather than only the page.
 *
 * ## How a test tells the re-fetch's answer from the captured one
 *
 * Every origin here answers `/master.m3u8` twice. The first request is the
 * page's own, which the collector captures; its manifest names `captured.m3u8`.
 * The second is the re-fetch, and what it ends at names `refetched.m3u8`. So a
 * probe whose variants name `refetched` parsed the re-fetch, and one that names
 * `captured` fell back to the captured body.
 */

import { spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { redactUrl } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { BrowserResolver, fetchManifest } from "@downloader/resolvers";
import type { ManifestFetchResult } from "@downloader/resolvers";
import forge from "node-forge";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";
import type { FixtureCertificate, TlsOrigin } from "./helpers/tls-origin.ts";

const PROBE_TIMEOUT_MS = 25_000;
const TEST_TIMEOUT_MS = 90_000;

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

function manifest(name: string): string {
  return ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360", name, ""].join("\n");
}

const PAGE = `<!doctype html><title>fixture</title><body><video></video><script>
  fetch("/master.m3u8").catch(() => {});
</script></body>`;

/** A signed manifest URL, so the refusal log has a credential to redact (gate 1, F6). */
const SIGNED_PAGE = PAGE.replace("/master.m3u8", "/master.m3u8?token=s3cr3t-signature");

interface Recorded {
  url: string;
  cookie: string | undefined;
}

interface Origin {
  port: number;
  requests: Recorded[];
  close(): Promise<void>;
}

async function startOrigin(handler: http.RequestListener): Promise<Origin> {
  const requests: Recorded[] = [];
  const server = http.createServer((request, response) => {
    // The path only: a test asks which resource was hit, never with which query.
    requests.push({ url: (request.url ?? "").split("?")[0] ?? "", cookie: request.headers.cookie });
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function variantUrls(probe: ProbeResult): string {
  return probe.variants.map((variant) => variant.url).join(" ");
}

/** `#EXTM3U` then `mebibytes` of spaces, gzipped a block at a time. */
async function gzipBomb(mebibytes: number): Promise<Buffer> {
  const gzip = zlib.createGzip({ level: 9 });
  const chunks: Buffer[] = [];
  gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => gzip.once("end", () => resolve()));
  gzip.write("#EXTM3U\n");
  const block = Buffer.alloc(1024 * 1024, 0x20);
  for (let index = 0; index < mebibytes; index++) {
    // oxlint-disable-next-line no-await-in-loop
    if (!gzip.write(block)) await new Promise<void>((resolve) => gzip.once("drain", resolve));
  }
  gzip.end();
  await done;
  return Buffer.concat(chunks);
}

describe("the manifest re-fetch behind the egress proxy (dl-97)", () => {
  /** Not in DNS: only the proxy can reach these, so a hit on either came through it. */
  const FIXTURE_HOST = "fixture.test";
  const OTHER_HOST = "cdn.test";

  let resolver: BrowserResolver;
  let proxy: EgressProxy;
  let secret: Origin;
  let other: Origin;
  /** What `/master.m3u8` does the second time it is asked, per test. */
  let onRefetch: (response: http.ServerResponse) => void;
  let fixture: Origin;
  const warnings: { message: string; fields?: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    // Something on loopback no re-fetch is entitled to reach.
    secret = await startOrigin((_request, response) => response.end("root:x:0:0"));
    other = await startOrigin((_request, response) => {
      response
        .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
        .end(manifest("refetched.m3u8"));
    });

    let masterCalls = 0;
    fixture = await startOrigin((request, response) => {
      if (request.url?.split("?")[0] === "/master.m3u8") {
        masterCalls += 1;
        if (masterCalls % 2 === 0) {
          onRefetch(response);
          return;
        }
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest("captured.m3u8"));
        return;
      }
      if (request.url === "/gated/master.m3u8") {
        // A CDN that wants the session on the hop it redirected to.
        if (request.headers.cookie?.includes("session=s3cr3t") !== true) {
          response.writeHead(403).end();
          return;
        }
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest("refetched.m3u8"));
        return;
      }
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "session=s3cr3t; Path=/",
        })
        .end(SIGNED_PAGE);
    });

    // The fixture hosts are exempt by name; the literal loopback address is not,
    // so a hop to it is the guard's ordinary refusal.
    const guard = createSsrfGuard({
      allowHosts: [FIXTURE_HOST, OTHER_HOST],
      lookup: async () => ["127.0.0.1"],
    });
    proxy = await startEgressProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    resolver = new BrowserResolver({
      maxConcurrentBrowsers: 1,
      headless: true,
      quietMs: 1200,
      logger: {
        warn: (message, fields) => {
          warnings.push({ message, ...(fields === undefined ? {} : { fields }) });
        },
      },
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await fixture.close();
    await secret.close();
    await other.close();
  });

  async function probe(): Promise<ProbeResult> {
    return await resolver.resolve(
      new URL(`http://${FIXTURE_HOST}:${String(fixture.port)}/page.html`),
      { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
    );
  }

  function masterRequests(): number {
    return fixture.requests.filter((request) => request.url === "/master.m3u8").length;
  }

  test(
    "a redirect to an address the guard refuses is not followed",
    async () => {
      const before = masterRequests();
      onRefetch = (response) => {
        response
          .writeHead(302, { location: `http://127.0.0.1:${String(secret.port)}/latest/meta-data` })
          .end();
      };

      const result = await probe();

      // The re-fetch happened, and it was answered with the redirect.
      expect(masterRequests() - before).toBe(2);
      // Its target never heard from anyone: the proxy refused the hop.
      expect(secret.requests).toEqual([]);
      // And the probe still has its manifest, the one the page loaded.
      expect(variantUrls(result)).toContain("captured.m3u8");
      expect(variantUrls(result)).not.toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "the session cookie reaches the re-fetch, on a hop it was redirected to as well",
    async () => {
      onRefetch = (response) => {
        response.writeHead(302, { location: "/gated/master.m3u8" }).end();
      };

      const result = await probe();

      const refetch = fixture.requests.findLast((request) => request.url === "/master.m3u8");
      expect(refetch?.cookie).toContain("session=s3cr3t");
      // The second hop carries no replayed cookie header; this one is the jar's.
      const gated = fixture.requests.findLast((request) => request.url === "/gated/master.m3u8");
      expect(gated?.cookie).toContain("session=s3cr3t");
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hop to another host is not handed this host's session",
    async () => {
      const before = other.requests.length;
      onRefetch = (response) => {
        response
          .writeHead(302, {
            location: `http://${OTHER_HOST}:${String(other.port)}/cdn/master.m3u8`,
          })
          .end();
      };

      const result = await probe();

      expect(other.requests.length - before).toBe(1);
      expect(other.requests.at(-1)?.cookie).toBeUndefined();
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "refuses a body that inflates past the cap, logs it as a refusal and falls back",
    async () => {
      // 256 MiB of spaces from about 255 KB on the wire.
      const bomb = await gzipBomb(256);
      const before = masterRequests();
      warnings.length = 0;
      onRefetch = (response) => {
        response
          .writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
            "content-encoding": "gzip",
          })
          .end(bomb);
      };

      const result = await probe();

      expect(masterRequests() - before).toBe(2);
      expect(variantUrls(result)).toContain("captured.m3u8");
      expect(warnings).toEqual([
        {
          message: "manifest re-fetch refused: its body passed the cap",
          fields: {
            url: redactUrl(
              `http://${FIXTURE_HOST}:${String(fixture.port)}/master.m3u8?token=s3cr3t-signature`,
            ),
            limitBytes: 4 * 1024 * 1024,
          },
        },
      ]);
      // The signature is the credential; the log line must not carry it.
      expect(JSON.stringify(warnings)).not.toContain("s3cr3t-signature");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "parses a compressed manifest inside the cap through the same path",
    async () => {
      warnings.length = 0;
      onRefetch = (response) => {
        response
          .writeHead(200, {
            "content-type": "application/vnd.apple.mpegurl",
            "content-encoding": "gzip",
          })
          .end(zlib.gzipSync(manifest("refetched.m3u8")));
      };

      const result = await probe();

      expect(variantUrls(result)).toContain("refetched.m3u8");
      expect(warnings).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});

describe("the manifest re-fetch behind the proxy that terminates its TLS (dl-97)", () => {
  let certificate: FixtureCertificate;
  let origin: TlsOrigin;
  let intercept: TlsInterception;
  let proxy: EgressProxy;
  let resolver: BrowserResolver;

  beforeAll(async () => {
    certificate = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      commonName: "operator-origin",
    });
    let masterCalls = 0;
    origin = await startTlsOrigin(certificate, (request, response) => {
      if (request.url === "/master.m3u8") {
        masterCalls += 1;
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest(masterCalls === 1 ? "captured.m3u8" : "refetched.m3u8"));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE);
    });
    intercept = await createTlsInterception({ operatorCa: certificate.ca, verifyOrigins: true });
    proxy = await startEgressProxy({
      guard: createSsrfGuard({ allowHosts: ["127.0.0.1"], allowPrivateAddresses: true }),
      logger: NOOP_LOGGER,
      interceptTls: intercept,
    });
    // How `buildRegistry` builds it when the tiers' proxy terminates TLS.
    resolver = new BrowserResolver({
      maxConcurrentBrowsers: 1,
      headless: true,
      quietMs: 1200,
      proxyRootSpkiSha256: intercept.rootSpkiSha256,
      proxyRootCaPem: intercept.rootCaPem,
    });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await resolver.dispose();
    await proxy.close();
    await intercept.close();
    await origin.close();
    await certificate.cleanup();
  });

  test(
    "trusts the proxy's root it was handed, so the re-fetch is answered",
    async () => {
      const result = await resolver.resolve(
        new URL(`https://127.0.0.1:${String(origin.port)}/watch`),
        { timeoutMs: PROBE_TIMEOUT_MS, signal: new AbortController().signal, proxyUrl: proxy.url },
      );

      const masters = origin.requests.filter((request) => request.url === "/master.m3u8");
      expect(masters).toHaveLength(2);
      expect(variantUrls(result)).toContain("refetched.m3u8");
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "and refuses the proxy's leaf when it was not handed the proxy's root",
    async () => {
      // The page is plain HTTP so it loads whatever either side trusts; only its
      // manifest is HTTPS. Chromium records the hit when it asks, before the
      // handshake it then fails, so the re-fetch is still attempted: and with no
      // `proxyRootCaPem`, only Node's own store to verify against, it must fail
      // too. What a chain that *does* carry the root must still prove — signer,
      // host, validity — is the minted-chain suite below.
      const page = await startOrigin((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
          `<!doctype html><title>fixture</title><body><video></video><script>
             fetch("https://127.0.0.1:${String(origin.port)}/master.m3u8").catch(() => {});
           </script></body>`,
        );
      });
      const mispinned = new BrowserResolver({
        maxConcurrentBrowsers: 1,
        headless: true,
        quietMs: 1200,
        proxyRootSpkiSha256: createHash("sha256").update("not the proxy's root").digest("base64"),
      });
      const before = origin.requests.length;
      try {
        const result = await mispinned.resolve(
          new URL(`http://127.0.0.1:${String(page.port)}/page.html`),
          {
            timeoutMs: PROBE_TIMEOUT_MS,
            signal: new AbortController().signal,
            proxyUrl: proxy.url,
          },
        );

        // Nothing reached the origin: not the page's fetch, not the re-fetch.
        expect(origin.requests.length - before).toBe(0);
        // So the probe has only the manifest's address to offer.
        expect(variantUrls(result)).toBe(`https://127.0.0.1:${String(origin.port)}/master.m3u8`);
      } finally {
        await mispinned.dispose();
        await page.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * dl-97 gate 1, F2 and F3: the client's TLS rules against chains minted here,
 * with `fetchManifest` driven directly, no proxy and no Chromium, so that what
 * accepts or refuses a chain is the client alone.
 *
 * - **F2**, a chain that *carries* the proxy's root is still refused unless that
 *   root signed the leaf and the leaf names the host: one leaf signed by another
 *   key under the root's name and key identifier, sent beside the real root; one
 *   the real root signed for another host.
 * - **F4**, validity: a leaf that root signed is refused when expired or not yet
 *   valid.
 * - **F3**, identity for an IP literal. Node's own verification needs a CA Node
 *   trusts, and the only way in from outside is `NODE_EXTRA_CA_CERTS`, which is
 *   read at start-up, so those two run the client in a child process.
 */
describe("the re-fetch's TLS rules against minted chains (dl-97)", () => {
  /** This package's directory, where `@downloader/resolvers` resolves. */
  const API_DIR = fileURLToPath(new URL("..", import.meta.url));
  const IP_HOST = "127.0.0.1";

  let intercept: TlsInterception;

  beforeAll(async () => {
    intercept = await createTlsInterception({ verifyOrigins: true });
  }, TEST_TIMEOUT_MS);

  afterAll(async () => {
    await intercept.close();
  });

  /** An HTTPS origin on loopback serving `cert` (leaf first) under `key`. */
  async function serveChain(key: string, cert: string): Promise<TlsOrigin> {
    return await startTlsOrigin(
      { ca: "", caPath: "", key, cert, cleanup: async () => {} },
      (_request, response) => {
        response
          .writeHead(200, { "content-type": "application/vnd.apple.mpegurl" })
          .end(manifest("refetched.m3u8"));
      },
    );
  }

  async function fetchTrustingRoot(port: number): Promise<ManifestFetchResult> {
    return await fetchManifest(`https://${IP_HOST}:${String(port)}/master.m3u8`, {
      headers: {},
      cookieFor: async () => undefined,
      storeCookies: async () => {},
      proxyRootCaPem: intercept.rootCaPem,
      maxBodyBytes: 1024 * 1024,
      maxRedirects: 0,
      timeoutMs: 5000,
    });
  }

  test("accepts a leaf the proxy's root signed for this host", async () => {
    // The control for the two below: same root, an honest leaf.
    const leaf = intercept.leafFor(IP_HOST);
    const origin = await serveChain(leaf.key, leaf.cert);
    try {
      expect(await fetchTrustingRoot(origin.port)).toEqual({
        outcome: "ok",
        text: manifest("refetched.m3u8"),
      });
      expect(origin.requests).toHaveLength(1);
    } finally {
      await origin.close();
    }
  });

  test(
    "refuses a leaf another key signed under the proxy root's name, sent beside that root",
    async () => {
      // Everything a name-based check looks at is copied from the real root —
      // issuer name, authority key identifier — and the real root certificate
      // rides along in the chain, so the trusted key is *present*. Only the
      // signature is wrong.
      const root = forge.pki.certificateFromPem(intercept.rootCaPem);
      const attacker = forge.pki.rsa.generateKeyPair({ bits: 2048 });
      const leaf = forge.pki.createCertificate();
      leaf.publicKey = attacker.publicKey;
      leaf.serialNumber = "0badc0de";
      leaf.validity.notBefore = new Date(Date.now() - 60_000);
      leaf.validity.notAfter = new Date(Date.now() + 60 * 60 * 1000);
      leaf.setSubject([{ name: "commonName", value: IP_HOST }]);
      leaf.setIssuer(root.subject.attributes);
      leaf.setExtensions([
        { name: "basicConstraints", cA: false, critical: true },
        { name: "keyUsage", critical: true, digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 7, ip: IP_HOST }] },
        {
          name: "authorityKeyIdentifier",
          keyIdentifier: root.generateSubjectKeyIdentifier().getBytes(),
        },
      ]);
      leaf.sign(attacker.privateKey, forge.md.sha256.create());

      const origin = await serveChain(
        forge.pki.privateKeyToPem(attacker.privateKey),
        `${forge.pki.certificateToPem(leaf).trim()}\n${intercept.rootCaPem.trim()}\n`,
      );
      try {
        expect(await fetchTrustingRoot(origin.port)).toEqual({
          outcome: "refused",
          reason: "untrusted-certificate",
        });
        expect(origin.requests).toEqual([]);
      } finally {
        await origin.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  test("refuses a leaf the proxy's root signed for another host", async () => {
    const leaf = intercept.leafFor("other.example");
    const origin = await serveChain(leaf.key, leaf.cert);
    try {
      expect(await fetchTrustingRoot(origin.port)).toEqual({
        outcome: "refused",
        reason: "untrusted-certificate",
      });
      expect(origin.requests).toEqual([]);
    } finally {
      await origin.close();
    }
  });

  /**
   * A root and leaves of our own, for validity periods `leafFor` never issues.
   * The proxy's root key never leaves `createTlsInterception`, so these stand in
   * for it: to the client, a root is whatever PEM it was handed.
   */
  function mintRoot(): { pem: string; cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey } {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = forge.pki.privateKeyFromPem(
      pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    );
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(
      pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + 60 * 60 * 1000);
    const name = [{ name: "commonName", value: "dl-97 stand-in proxy root" }];
    cert.setSubject(name);
    cert.setIssuer(name);
    cert.setExtensions([
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", critical: true, keyCertSign: true, cRLSign: true },
      { name: "subjectKeyIdentifier" },
    ]);
    cert.sign(key, forge.md.sha256.create());
    return { pem: forge.pki.certificateToPem(cert), cert, key };
  }

  function mintLeaf(
    root: ReturnType<typeof mintRoot>,
    validity: { notBefore: Date; notAfter: Date },
  ): { key: string; cert: string } {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const leaf = forge.pki.createCertificate();
    leaf.publicKey = forge.pki.publicKeyFromPem(
      pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    );
    leaf.serialNumber = "02";
    leaf.validity.notBefore = validity.notBefore;
    leaf.validity.notAfter = validity.notAfter;
    leaf.setSubject([{ name: "commonName", value: IP_HOST }]);
    leaf.setIssuer(root.cert.subject.attributes);
    leaf.setExtensions([
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", critical: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 7, ip: IP_HOST }] },
      {
        name: "authorityKeyIdentifier",
        keyIdentifier: root.cert.generateSubjectKeyIdentifier().getBytes(),
      },
    ]);
    leaf.sign(root.key, forge.md.sha256.create());
    return {
      key: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      cert: `${forge.pki.certificateToPem(leaf).trim()}\n${root.pem.trim()}\n`,
    };
  }

  async function answerFor(validity: { notBefore: Date; notAfter: Date }): Promise<{
    answer: ManifestFetchResult;
    requests: number;
  }> {
    const root = mintRoot();
    const leaf = mintLeaf(root, validity);
    const origin = await serveChain(leaf.key, leaf.cert);
    try {
      const answer = await fetchManifest(`https://${IP_HOST}:${String(origin.port)}/master.m3u8`, {
        headers: {},
        cookieFor: async () => undefined,
        storeCookies: async () => {},
        proxyRootCaPem: root.pem,
        maxBodyBytes: 1024 * 1024,
        maxRedirects: 0,
        timeoutMs: 5000,
      });
      return { answer, requests: origin.requests.length };
    } finally {
      await origin.close();
    }
  }

  const HOUR = 60 * 60 * 1000;

  test(
    "accepts a current leaf the given root signed (the control for the two below)",
    async () => {
      expect(
        await answerFor({
          notBefore: new Date(Date.now() - HOUR),
          notAfter: new Date(Date.now() + HOUR),
        }),
      ).toEqual({ answer: { outcome: "ok", text: manifest("refetched.m3u8") }, requests: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "refuses an expired leaf the given root signed",
    async () => {
      expect(
        await answerFor({
          notBefore: new Date(Date.now() - 2 * HOUR),
          notAfter: new Date(Date.now() - HOUR),
        }),
      ).toEqual({ answer: { outcome: "refused", reason: "untrusted-certificate" }, requests: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "refuses a not-yet-valid leaf the given root signed",
    async () => {
      expect(
        await answerFor({
          notBefore: new Date(Date.now() + HOUR),
          notAfter: new Date(Date.now() + 2 * HOUR),
        }),
      ).toEqual({ answer: { outcome: "refused", reason: "untrusted-certificate" }, requests: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  /** The child's whole program: one re-fetch of `TARGET_URL`, its answer on stdout. */
  const CHILD = `
    const { fetchManifest } = await import("@downloader/resolvers");
    let answer;
    try {
      answer = await fetchManifest(process.env.TARGET_URL, {
        headers: {},
        cookieFor: async () => undefined,
        storeCookies: async () => {},
        maxBodyBytes: 1048576,
        maxRedirects: 0,
        timeoutMs: 5000,
      });
    } catch (error) {
      answer = { error: String(error?.code ?? error) };
    }
    process.stdout.write(JSON.stringify(answer));
  `;

  /** Runs the client in a Node whose trust store holds `caPath` too. */
  async function fetchTrusting(url: string, caPath: string): Promise<unknown> {
    const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], {
      cwd: API_DIR,
      env: { ...process.env, NODE_EXTRA_CA_CERTS: caPath, TARGET_URL: url },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    return JSON.parse(stdout) as unknown;
  }

  /** A self-signed origin on loopback, which is its own CA, and the answer a child trusting it gets. */
  async function trustedOriginAnswer(names: {
    dnsNames?: readonly string[];
    ipAddresses?: readonly string[];
    commonName: string;
  }): Promise<{ answer: unknown; requests: number }> {
    const certificate = await createFixtureCertificate(names);
    const origin = await serveChain(certificate.key, certificate.cert);
    try {
      const answer = await fetchTrusting(
        `https://${IP_HOST}:${String(origin.port)}/master.m3u8`,
        certificate.caPath,
      );
      return { answer, requests: origin.requests.length };
    } finally {
      await origin.close();
      await certificate.cleanup();
    }
  }

  test(
    "refuses a trusted certificate naming only localhost for an IP-literal target",
    async () => {
      expect(
        await trustedOriginAnswer({ dnsNames: ["localhost"], commonName: "localhost-only" }),
      ).toEqual({ answer: { outcome: "refused", reason: "untrusted-certificate" }, requests: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "accepts a trusted certificate whose IP SAN is the IP-literal target",
    async () => {
      expect(
        await trustedOriginAnswer({ ipAddresses: [IP_HOST], commonName: "ip-origin" }),
      ).toEqual({ answer: { outcome: "ok", text: manifest("refetched.m3u8") }, requests: 1 });
    },
    TEST_TIMEOUT_MS,
  );
});
