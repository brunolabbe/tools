/**
 * The guarded egress proxy, tested as the thing it exists to be: the check that
 * covers the URLs nothing else can see.
 *
 * The three tests that matter are the ones named after the holes in dl-11 — a
 * URL that never appeared in a `ProbeResult`, a redirect hop, and a name whose
 * answer changed after the pre-flight check. Each drives a real socket, because
 * a proxy that is not in the socket path is not a proxy.
 */

import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { afterEach, describe, expect, test } from "vitest";
import type { AddressResolver, ResolvedAddress } from "../src/dispatcher.ts";
import { startEgressProxy, withoutEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import type { AppLogger } from "../src/logger.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
import { isTlsVerificationFailure } from "@downloader/engine";
import type { ProbeResult } from "@downloader/contract";
import { probeResult } from "./helpers.ts";
import { createFixtureCertificate, startTlsOrigin } from "./helpers/tls-origin.ts";

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

interface Line {
  msg: string;
  fields: Record<string, unknown>;
}

/** A logger that keeps its warnings, for the tests that are about the log itself. */
function recordingLogger(): { logger: AppLogger; warnings: Line[]; errors: Line[] } {
  const warnings: Line[] = [];
  // Kept apart from `warnings`, because the severity is the assertion: the
  // three outcomes that describe what a *target* did are warnings, and the one
  // that describes what this service failed to do is not. See `connectFailed`.
  const errors: Line[] = [];
  const logger: AppLogger = {
    ...NOOP_LOGGER,
    warn: (msg, fields) => {
      warnings.push({ msg, fields: fields ?? {} });
    },
    error: (msg, fields) => {
      errors.push({ msg, fields: fields ?? {} });
    },
    child: () => logger,
  };
  return { logger, warnings, errors };
}

/** A port that was listening long enough to be allocated, and is not now. */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function v4(address: string): ResolvedAddress {
  return { address, family: 4 };
}

/** A guard whose pre-flight answer is whatever the test says it is. */
function guardResolving(map: Record<string, string[]>): SsrfGuard {
  return createSsrfGuard({
    lookup: async (hostname) => map[hostname] ?? ["93.184.216.34"],
  });
}

function resolverFor(records: ResolvedAddress[]): AddressResolver {
  return async () => records;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startProxy(
  options: Parameters<typeof startEgressProxy>[0],
): Promise<EgressProxy & { port: number }> {
  const proxy = await startEgressProxy(options);
  cleanups.push(() => proxy.close());
  return { ...proxy, port: Number(new URL(proxy.url).port) };
}

/** A plain TCP server that greets whoever reaches it — an origin, stripped bare. */
async function startEcho(greeting: string): Promise<{ port: number }> {
  const server = net.createServer((socket) => {
    socket.write(greeting);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port };
}

async function startOrigin(
  handler: http.RequestListener,
): Promise<{ port: number; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((request, response) => {
    hits.push(request.url ?? "");
    handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port, hits };
}

/** Sends a raw CONNECT and returns the status line plus whatever followed. */
function connectThrough(
  proxyPort: number,
  target: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(proxyPort, "127.0.0.1", () => {
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
    });
    let buffer = "";
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("timed out"));
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.once("error", reject);
    socket.once("close", () => {
      const status = Number(/^HTTP\/1\.[01] (\d{3})/u.exec(buffer)?.[1] ?? 0);
      const end = buffer.indexOf("\r\n\r\n");
      resolve({ status, body: end === -1 ? "" : buffer.slice(end + 4) });
    });
    // The tunnel stays open on success; close it once the greeting has landed.
    setTimeout(() => socket.end(), 300).unref();
  });
}

/**
 * Sends an absolute-form request — the way ffmpeg addresses a proxy over plain
 * HTTP, and the way Chromium sends a page's own `fetch()`.
 */
function sendThrough(
  proxyPort: number,
  method: string,
  url: string,
  options: { body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: proxyPort, method, path: url, headers: { host: "x" } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.once("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.once("error", reject);
    request.end(options.body);
  });
}

function getThrough(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return sendThrough(proxyPort, "GET", url);
}

/**
 * A TLS origin whose chain ends nowhere any store knows.
 *
 * The interception below it holds the **system store**, against which this
 * fixture is genuinely untrusted — nothing is simulated and nothing is switched
 * off, which is the trap dl-14, dl-19 and dl-21 all carry.
 */
async function startUntrustedTlsOrigin(): Promise<{ port: number }> {
  const certificate = await createFixtureCertificate({
    ipAddresses: ["127.0.0.1"],
    dnsNames: ["untrusted.test"],
    commonName: "dl27-egress-origin",
  });
  cleanups.push(() => certificate.cleanup());
  const origin = await startTlsOrigin(certificate, (_request, response) => {
    response.writeHead(200).end("the media");
  });
  cleanups.push(() => origin.close());
  return { port: origin.port };
}

async function interception(operatorCa?: string): Promise<TlsInterception> {
  const intercept = await createTlsInterception(operatorCa === undefined ? {} : { operatorCa });
  cleanups.push(() => intercept.close());
  return intercept;
}

describe("the holes dl-11 closes", () => {
  test("a segment URI that never reached a ProbeResult is refused", async () => {
    // The whole point: nothing vetted this URL earlier, because it did not
    // exist earlier. It came out of a manifest ffmpeg fetched for itself.
    const guard = guardResolving({ "segments.evil.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await connectThrough(proxy.port, "segments.evil.test:443");

    expect(result.status).toBe(403);
  });

  test("a redirect hop gets its own check", async () => {
    // ffmpeg follows the 302 itself, so the second hop arrives here as its own
    // request. That is the only reason it is checked at all.
    const guard = guardResolving({
      "public.test": ["93.184.216.34"],
      "internal.test": ["10.0.0.5"],
    });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const first = await connectThrough(proxy.port, "public.test:443");
    const second = await connectThrough(proxy.port, "internal.test:443");

    expect(first.status).not.toBe(403);
    expect(second.status).toBe(403);
  });

  test("a name that rebinds after the pre-flight check is refused at connect", async () => {
    // The dl-8 test, in this proxy's shape: the guard is told the name is
    // public, the connector's resolver says loopback.
    //
    // **The status code cannot carry this one.** Its two siblings above assert
    // `403`, which only `guard.assertAllowed` produces, so the code discriminates
    // for them. A rebind is caught by the pinning `lookup` and surfaces as a
    // socket error, so the proxy answers `502` — and `502` is also what a socket
    // that simply died produces, which is exactly what the loopback resolver
    // would cause on its own with the guard disabled. Asserting the status alone
    // passed whether or not anything vetted the address, which is the gap
    // repo-13's gate found. The refusal in the log is the only signal that
    // separates the two, the same reason dl-26 gives below.
    const { logger, warnings } = recordingLogger();
    const guard = guardResolving({ "rebind.test": ["93.184.216.34"] });
    const proxy = await startProxy({
      guard,
      logger,
      resolve: resolverFor([v4("127.0.0.1")]),
    });

    const result = await connectThrough(proxy.port, "rebind.test:443");

    expect(result.status).toBe(502);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe("refused a subprocess fetch");
    expect(warnings[0]?.fields["code"]).toBe("BLOCKED_TARGET");
    // The CONNECT path logs the authority it was given, port included.
    expect(warnings[0]?.fields["host"]).toBe("rebind.test:443");
  });
});

/**
 * dl-26. The log is the only account of a blocked fetch — a refusal here cannot
 * be attributed to a job, so nothing reaches the client but a generic failure.
 * That makes "which of these two happened" a property worth testing, not a
 * cosmetic detail: one sends the reader to `ssrf.ts` and the other to their
 * firewall.
 */
describe("what the log says happened", () => {
  test("a policy refusal names the rule, not an internal error", async () => {
    const { logger, warnings } = recordingLogger();
    const guard = guardResolving({ "segments.evil.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger });

    await connectThrough(proxy.port, "segments.evil.test:443");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe("refused a subprocess fetch");
    expect(warnings[0]?.fields["code"]).toBe("BLOCKED_TARGET");
  });

  test("an allowed host we cannot reach is not reported as a refusal", async () => {
    // The dl-26 case: the guard said yes and the network said nothing. Logging
    // this as "refused … INTERNAL" cost an afternoon in `ssrf.ts`.
    const { logger, warnings } = recordingLogger();
    const guard = createSsrfGuard({ allowHosts: ["unreachable.test"] });
    const proxy = await startProxy({ guard, logger, resolve: resolverFor([v4("127.0.0.1")]) });

    const result = await connectThrough(proxy.port, `unreachable.test:${await closedPort()}`);

    expect(result.status).toBe(502);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe("a subprocess fetch could not connect");
    expect(warnings[0]?.fields["errno"]).toBe("ECONNREFUSED");
    // The distinction is the point: nothing here refused anything.
    expect(warnings[0]?.msg).not.toContain("refused");
    expect(warnings[0]?.fields["code"]).toBeUndefined();
  });

  test("a rebind caught at connect stays a refusal, though it arrives as a socket error", async () => {
    // `createPinningLookup` reports through the socket's `error` event, so this
    // shares a call site with the case above and must not share its message.
    const { logger, warnings } = recordingLogger();
    const guard = guardResolving({ "rebind.test": ["93.184.216.34"] });
    const proxy = await startProxy({ guard, logger, resolve: resolverFor([v4("127.0.0.1")]) });

    await connectThrough(proxy.port, "rebind.test:443");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe("refused a subprocess fetch");
    expect(warnings[0]?.fields["code"]).toBe("BLOCKED_TARGET");
  });

  test("a certificate this proxy refused is neither a policy refusal nor a dead network", async () => {
    // **dl-27's third outcome on the socket dl-26 split in two.** A pinning
    // verdict, an `ETIMEDOUT` and a rejected origin certificate all arrive as
    // the same `error` event, and this one is the one whose only surviving
    // evidence is this line: dl-21 measured that no certificate semantics reach
    // ffmpeg from a refused segment fetch by any other route. Filed as
    // unreachable it reads as a flaky CDN; filed as a refusal it sends the
    // reader into `ssrf.ts` looking for a rule that never fired.
    const { logger, warnings } = recordingLogger();
    const origin = await startUntrustedTlsOrigin();
    const guard = createSsrfGuard({ allowHosts: ["untrusted.test"] });
    const proxy = await startProxy({
      guard,
      logger,
      resolve: resolverFor([v4("127.0.0.1")]),
      interceptTls: await interception(),
    });

    const result = await connectThrough(proxy.port, `untrusted.test:${origin.port}`);

    expect(result.status).toBe(502);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe(
      "refused a subprocess fetch: the origin's certificate did not verify",
    );
    // The verify code, so this log and ffmpeg's stderr name the same fact.
    expect(warnings[0]?.fields["code"]).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    // And neither of the other two verdicts, which is the whole point.
    expect(warnings[0]?.fields["errno"]).toBeUndefined();
    expect(warnings[0]?.msg).not.toContain("could not connect");
  });

  test("no message claims the fetch was ffmpeg's", async () => {
    // Since dl-12 this proxy serves Chromium and yt-dlp too, and the case that
    // prompted dl-26 was a browser probe's subresources.
    const { logger, warnings } = recordingLogger();
    const guard = guardResolving({ "segments.evil.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger });

    await connectThrough(proxy.port, "segments.evil.test:443");
    await getThrough(proxy.port, "http://segments.evil.test/seg.ts");

    expect(warnings).toHaveLength(2);
    for (const line of warnings) expect(line.msg).not.toContain("ffmpeg");
  });
});

describe("tunnelling", () => {
  test("an allowed CONNECT reaches the origin and passes bytes both ways", async () => {
    const origin = await startEcho("hello from the origin");
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
    });

    const result = await connectThrough(proxy.port, `allowed.test:${origin.port}`);

    expect(result.status).toBe(200);
    expect(result.body).toBe("hello from the origin");
  });

  test("an allowed plain-HTTP fetch is forwarded", async () => {
    const origin = await startOrigin((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" }).end("#EXTM3U");
    });
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
    });

    const result = await getThrough(proxy.port, `http://allowed.test:${origin.port}/master.m3u8`);

    expect(result.status).toBe(200);
    expect(result.body).toBe("#EXTM3U");
    expect(origin.hits).toEqual(["/master.m3u8"]);
  });

  test("a blocked plain-HTTP fetch never reaches the origin", async () => {
    const origin = await startOrigin((_request, response) => response.end("leaked"));
    const guard = guardResolving({ "metadata.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await getThrough(proxy.port, `http://metadata.test:${origin.port}/creds`);

    expect(result.status).toBe(403);
    expect(origin.hits).toEqual([]);
  });
});

describe("what a page sends, which ffmpeg never did", () => {
  test("an absolute-form POST reaches an allowed origin, body and all", async () => {
    // A page's `fetch()` and XHR arrive here exactly like this. Refusing them —
    // as this proxy did while it served ffmpeg alone — breaks a plain-HTTP page
    // in a way nothing in the logs explains. See dl-12.
    const bodies: string[] = [];
    const origin = await startOrigin((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => (body += chunk));
      request.once("end", () => {
        bodies.push(body);
        response.writeHead(200).end("accepted");
      });
    });
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
    });

    const result = await sendThrough(proxy.port, "POST", `http://allowed.test:${origin.port}/x`, {
      body: "q=1",
    });

    expect(result.status).toBe(200);
    expect(bodies).toEqual(["q=1"]);
  });

  test("a POST to a blocked target never reaches it", async () => {
    const origin = await startOrigin((_request, response) => response.end("leaked"));
    const guard = guardResolving({ "metadata.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await sendThrough(
      proxy.port,
      "POST",
      `http://metadata.test:${origin.port}/exfiltrate`,
      { body: "secret" },
    );

    expect(result.status).toBe(403);
    expect(origin.hits).toEqual([]);
  });
});

describe("it is not a general-purpose proxy", () => {
  test("a method no browser or media client sends is refused", async () => {
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await sendThrough(proxy.port, "TRACE", "http://allowed.test/upload");

    expect(result.status).toBe(405);
  });

  test("an origin-form request is refused", async () => {
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await getThrough(proxy.port, "/not-absolute");

    expect(result.status).toBe(400);
  });

  test("a malformed CONNECT target is refused", async () => {
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const result = await connectThrough(proxy.port, "not-an-authority");

    expect(result.status).toBe(400);
  });

  test("it binds loopback only", async () => {
    const guard = createSsrfGuard();
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
  });
});

describe("chaining to an operator proxy", () => {
  test("a tunnel is requested from the upstream, and its refusal is reported", async () => {
    const seen: string[] = [];
    const upstream = http.createServer();
    upstream.on("connect", (request, socket) => {
      seen.push(request.url ?? "");
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.close(() => resolve());
        }),
    );
    const upstreamPort = (upstream.address() as AddressInfo).port;

    // `allowPrivateAddresses` because in chained mode this process's DNS view is
    // not the one that matters — the same escape hatch dl-8 documents.
    const guard = createSsrfGuard({ allowPrivateAddresses: true });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      upstreamProxyUrl: `http://127.0.0.1:${upstreamPort}`,
    });

    expect(proxy.mode).toBe("chained");
    const result = await connectThrough(proxy.port, "origin.test:443");

    expect(seen).toEqual(["origin.test:443"]);
    expect(result.status).toBe(502);
  });

  test("terminating still verifies the origin when the tunnel is the operator's", async () => {
    // `PROXY_URL` and dl-27 together, which is a real deployment and a code path
    // nothing else reaches: the handshake this proxy verifies happens *inside*
    // the upstream's tunnel, after `chainConnect` has agreed it. Getting the
    // order wrong here would verify the operator's proxy instead of the origin
    // and nothing downstream would notice.
    const origin = await startUntrustedTlsOrigin();
    const upstream = http.createServer();
    upstream.on("connect", (request, socket, head) => {
      const port = Number((request.url ?? "").split(":").pop());
      const onward = net.connect(port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) onward.write(head);
        socket.pipe(onward);
        onward.pipe(socket);
      });
      onward.once("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.close(() => resolve());
        }),
    );

    const { logger, warnings } = recordingLogger();
    const proxy = await startProxy({
      guard: createSsrfGuard({ allowPrivateAddresses: true }),
      logger,
      upstreamProxyUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      interceptTls: await interception(),
    });

    expect(proxy.mode).toBe("chained");
    expect(proxy.tls).toBe("terminate");
    const result = await connectThrough(proxy.port, `untrusted.test:${origin.port}`);

    expect(result.status).toBe(502);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toContain("certificate did not verify");
  });

  test("an upstream that agrees produces a working tunnel", async () => {
    const origin = await startEcho("through two proxies");
    const upstream = http.createServer();
    upstream.on("connect", (request, socket, head) => {
      const port = Number((request.url ?? "").split(":").pop());
      const onward = net.connect(port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) onward.write(head);
        socket.pipe(onward);
        onward.pipe(socket);
      });
      onward.once("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.close(() => resolve());
        }),
    );

    const guard = createSsrfGuard({ allowPrivateAddresses: true });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      upstreamProxyUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    });

    const result = await connectThrough(proxy.port, `origin.test:${origin.port}`);

    expect(result.status).toBe(200);
    expect(result.body).toBe("through two proxies");
  });
});

/**
 * `withoutEgressProxy` — the *server-side* rewrite, and the one thing it must
 * not do.
 *
 * This function had no coverage at all until dl-29's third gate, and that gap is
 * why a response-body assertion in `tiers-behind-the-proxy.test.ts` was carrying
 * the weight of guarding it. A response-body assertion cannot carry it: since
 * dl-29, `probeForClient` empties `headers` at the response seam anyway, so the
 * body looks identical whether this function left them alone or destroyed them.
 * The gate proved that by making this function empty `headers` too and watching
 * all 897 downloader tests pass.
 *
 * The failure hiding behind that green suite is specific: an operator with
 * `config.proxyUrl` set — dl-12's documented case, and the only one where this
 * function does anything at all — loses the `Referer` and `Cookie` the engine
 * replays, and every download starts 403ing at the CDN for a reason nothing
 * reports.
 *
 * So these assert on the function directly. Nothing here goes near a response.
 */
const probeThroughProxy = (): ProbeResult =>
  probeResult({
    requestContext: {
      headers: { Referer: "https://site.example/", Cookie: "session=super-secret" },
      proxyUrl: "http://127.0.0.1:1",
      expiresAt: "2026-08-06T11:00:00.000Z",
    },
  });

describe("withoutEgressProxy keeps the credentials it is not there to touch", () => {
  test("drops the proxy and nothing else", () => {
    const out = withoutEgressProxy(probeThroughProxy());

    // The whole job of the function.
    expect(out.requestContext.proxyUrl).toBeUndefined();
    // And the whole of what it must leave alone. These are the credentials the
    // engine replays on every segment fetch; emptying them here is invisible on
    // the wire and fatal to a proxied deployment.
    expect(out.requestContext.headers).toEqual({
      Referer: "https://site.example/",
      Cookie: "session=super-secret",
    });
    // `expiresAt` is the other survivor — a client reads it to know its variant
    // URLs are going stale.
    expect(out.requestContext.expiresAt).toBe("2026-08-06T11:00:00.000Z");
  });

  test("returns the probe untouched when there is no proxy to drop", () => {
    // The early-return branch, which is every deployment without an operator
    // proxy — and the reason an integration test that does not set one never
    // exercises the branch above.
    const plain = probeResult();
    expect(withoutEgressProxy(plain)).toBe(plain);
  });

  test("leaves the rest of the probe alone", () => {
    const out = withoutEgressProxy(probeThroughProxy());
    expect(out.variants).toHaveLength(1);
    expect(out.title).toBe("A test video");
  });
});

/**
 * dl-33's second half: what happens when the leaf itself cannot be loaded.
 *
 * A CONNECT the proxy has decided to intercept reaches a point where the origin
 * handshake has succeeded and the only thing left is to arm the client side
 * with a certificate we issued. That construction is a **synchronous throw in
 * an event handler**, so before this guard it escaped the entire call stack to
 * `uncaughtException` — nothing refused the CONNECT, nothing logged, and ffmpeg
 * waited on a tunnel that was never going to open. dl-33 spent three sessions
 * reading the resulting timeout as machine contention.
 *
 * These drive real sockets rather than asserting the branch exists, because
 * "the guard is on the code path" and "the client gets an answer" are different
 * claims and only the second one is the defect.
 */
describe("a leaf this proxy cannot load (dl-33)", () => {
  /** An origin whose certificate the proxy will trust, so the run reaches the leaf. */
  async function startTrustedTlsOrigin(): Promise<{ port: number; ca: string }> {
    const certificate = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      dnsNames: ["trusted.test"],
      commonName: "dl33-egress-origin",
    });
    cleanups.push(() => certificate.cleanup());
    const origin = await startTlsOrigin(certificate, (_request, response) => {
      response.writeHead(200).end("the media");
    });
    cleanups.push(() => origin.close());
    return { port: origin.port, ca: certificate.ca };
  }

  /** A real interception with `leafFor` replaced — everything else genuine. */
  async function proxyWithLeaf(
    ca: string,
    leafFor: TlsInterception["leafFor"],
  ): Promise<{ port: number; warnings: Line[]; errors: Line[] }> {
    const { logger, warnings, errors } = recordingLogger();
    const real = await interception(ca);
    const proxy = await startProxy({
      guard: createSsrfGuard({ allowHosts: ["trusted.test"] }),
      logger,
      resolve: resolverFor([v4("127.0.0.1")]),
      interceptTls: { ...real, leafFor },
    });
    return { port: proxy.port, warnings, errors };
  }

  test("a certificate the runtime cannot load refuses the CONNECT rather than escaping", async () => {
    const origin = await startTrustedTlsOrigin();
    const proxy = await proxyWithLeaf(origin.ca, () => ({
      key: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----\n",
      cert: "-----BEGIN CERTIFICATE-----\nnot a certificate\n-----END CERTIFICATE-----\n",
    }));

    // Without the guard this does not fail an assertion — it times out, which
    // is the symptom the ticket chased for three sessions.
    const result = await connectThrough(proxy.port, `trusted.test:${origin.port}`);

    // **500, not the 502 the other refusals here use.** `http-errors.ts` maps
    // `INTERNAL` to 500 and 502 to "the source was unreachable, not us"; the
    // origin handshake had already succeeded, so blaming a gateway would be the
    // same misreport in status form that the phrase below avoids in words.
    expect(result.status).toBe(500);
    // Named as ours, at `error`, and not as one of the three things a *target*
    // can do — the misfiling that cost dl-33 those sessions.
    expect(proxy.errors).toHaveLength(1);
    expect(proxy.errors[0]?.msg).toBe("could not issue an interception certificate");
    expect(proxy.errors[0]?.fields["code"]).toBe("INTERNAL");
    expect(proxy.errors[0]?.fields["host"]).toBe(`trusted.test:${origin.port}`);
    // The OpenSSL reason survives into the log, which is the whole diagnostic.
    expect(String(proxy.errors[0]?.fields["reason"])).toContain("error:");
    expect(proxy.warnings).toEqual([]);
  });

  test("a mint that throws is caught too, so the guard is not about one error", async () => {
    // **Generality, asserted rather than argued.** The site has two fallible
    // steps — forge minting and OpenSSL loading — and dl-33's defect was only
    // ever in the second. A guard covering one would look identical here.
    const origin = await startTrustedTlsOrigin();
    const proxy = await proxyWithLeaf(origin.ca, () => {
      throw new Error("no leaf for you");
    });

    const result = await connectThrough(proxy.port, `trusted.test:${origin.port}`);

    expect(result.status).toBe(500);
    expect(proxy.errors).toHaveLength(1);
    expect(proxy.errors[0]?.fields["reason"]).toBe("no leaf for you");
  });

  test("the reason phrase does not tell ffmpeg the origin's certificate was rejected", () => {
    // The phrase is the only thing that travels: ffmpeg echoes a proxy's status
    // line and `isTlsVerificationFailure` reads it back out of stderr. dl-27
    // spends "TLS certificate verification failed" on a *refused origin*, and
    // this is not one — the origin verified fine and our own certificate did
    // not load. Matching that pattern here would file a service defect as a bad
    // CDN, so the phrase names a certificate without naming a verification.
    expect(
      isTlsVerificationFailure("[httpproxy] HTTP error 500 Proxy could not issue a certificate"),
    ).toBe(false);
    // And the pairing it must not be confused with still matches, so this is a
    // discrimination rather than a regex that quietly stopped working.
    expect(
      isTlsVerificationFailure(
        "[httpproxy] HTTP error 502 TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)",
      ),
    ).toBe(true);
  });
});

/**
 * dl-37: the measurement `tls-rejections.ts`'s whole design rests on, committed
 * rather than left as a docblock's paraphrase of it — a real Chromium, pointed
 * at a bare CONNECT proxy that answers with each status/reason this proxy can
 * actually produce, reports the identical `net::ERR_TUNNEL_CONNECTION_FAILED`
 * for every one of them. If a future Chromium ever started telling these
 * apart, this is the test that would go red and say so.
 */
describe("what Chromium reports for a refused CONNECT (dl-37)", () => {
  function startFixedStatusProxy(status: number, reason: string): Promise<{ url: string }> {
    const server = http.createServer((_request, response) => {
      response.writeHead(400).end();
    });
    server.on("connect", (_request, socket) => {
      socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\n\r\n`);
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        cleanups.push(
          () =>
            new Promise<void>((closed) => {
              server.close(() => closed());
            }),
        );
        resolve({ url: `http://127.0.0.1:${String(port)}` });
      });
    });
  }

  async function chromiumMessageFor(status: number, reason: string): Promise<string> {
    const proxy = await startFixedStatusProxy(status, reason);
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox"],
      proxy: { server: proxy.url },
    });
    try {
      const page = await browser.newPage();
      await page.goto("https://example.invalid/", { timeout: 10_000 });
      throw new Error("the navigation was expected to fail");
    } catch (error) {
      return (error as Error).message.split("\n")[0] ?? "";
    } finally {
      await browser.close();
    }
  }

  test(
    "a policy block, a leaf failure, a dead upstream and two certificate refusals are one message",
    { timeout: 60_000 },
    async () => {
      const messages = await Promise.all([
        chromiumMessageFor(403, "Blocked by egress policy"),
        chromiumMessageFor(500, "Proxy could not issue a certificate"),
        chromiumMessageFor(502, "Upstream connect failed"),
        chromiumMessageFor(
          502,
          "TLS certificate verification failed (DEPTH_ZERO_SELF_SIGNED_CERT)",
        ),
        chromiumMessageFor(502, "TLS certificate verification failed (CERT_HAS_EXPIRED)"),
      ]);

      for (const message of messages) {
        expect(message).toContain("net::ERR_TUNNEL_CONNECTION_FAILED");
      }
      // All five, not merely each individually — the point is that nothing in
      // any of them distinguishes one cause from another.
      expect(new Set(messages.map((message) => message.split(" at ")[0]))).toHaveLength(1);
    },
  );
});

/**
 * dl-37: `onOtherConnectFailure` exists because the measurement above is true —
 * Chromium collapses every refused or failed `CONNECT` to the identical
 * `net::ERR_TUNNEL_CONNECTION_FAILED`. What matters here is not that each of
 * those still refuses the tunnel — the tests above already cover that — but
 * that each one, and only the non-certificate ones, reaches this callback.
 * `tls-rejections.ts`'s `TlsRejectionLog` depends on the two being kept apart:
 * a cert rejection that also fired this one would poison itself, permanently
 * blocking its own reattachment.
 */
function recordingConnectCallbacks(): {
  certificateRejections: Array<{ host: string; code: string }>;
  otherFailures: string[];
  onCertificateRejected: (host: string, code: string) => void;
  onOtherConnectFailure: (host: string) => void;
} {
  const certificateRejections: Array<{ host: string; code: string }> = [];
  const otherFailures: string[] = [];
  return {
    certificateRejections,
    otherFailures,
    onCertificateRejected: (host, code) => {
      certificateRejections.push({ host, code });
    },
    onOtherConnectFailure: (host) => {
      otherFailures.push(host);
    },
  };
}

describe("onOtherConnectFailure (dl-37)", () => {
  test("a policy-blocked CONNECT fires it, with the target's host", async () => {
    const callbacks = recordingConnectCallbacks();
    const guard = guardResolving({ "segments.evil.test": ["169.254.169.254"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER, ...callbacks });

    await connectThrough(proxy.port, "segments.evil.test:443");

    expect(callbacks.otherFailures).toEqual(["segments.evil.test"]);
    expect(callbacks.certificateRejections).toEqual([]);
  });

  test("a dead upstream fires it", async () => {
    const callbacks = recordingConnectCallbacks();
    const guard = createSsrfGuard({ allowHosts: ["unreachable.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
      ...callbacks,
    });

    await connectThrough(proxy.port, `unreachable.test:${await closedPort()}`);

    expect(callbacks.otherFailures).toEqual(["unreachable.test"]);
    expect(callbacks.certificateRejections).toEqual([]);
  });

  test("a leaf this proxy could not issue fires it, not a certificate rejection", async () => {
    const callbacks = recordingConnectCallbacks();
    const certificate = await createFixtureCertificate({
      ipAddresses: ["127.0.0.1"],
      dnsNames: ["trusted.test"],
      commonName: "dl37-egress-origin",
    });
    cleanups.push(() => certificate.cleanup());
    const origin = await startTlsOrigin(certificate, (_request, response) => {
      response.writeHead(200).end("the media");
    });
    cleanups.push(() => origin.close());
    const real = await interception(certificate.ca);
    const proxy = await startProxy({
      guard: createSsrfGuard({ allowHosts: ["trusted.test"] }),
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
      interceptTls: {
        ...real,
        leafFor: () => {
          throw new Error("no leaf for you");
        },
      },
      ...callbacks,
    });

    await connectThrough(proxy.port, `trusted.test:${origin.port}`);

    expect(callbacks.otherFailures).toEqual(["trusted.test"]);
    expect(callbacks.certificateRejections).toEqual([]);
  });

  test("a genuine certificate rejection fires onCertificateRejected ONLY", async () => {
    // The critical negative: `onRejected` in `terminateTls` also calls the
    // shared `fail()` a policy block and a dead upstream go through, and if
    // `onOtherConnectFailure` were hooked into `fail()` itself rather than into
    // the five non-certificate call sites individually (the SSRF-policy catch,
    // `serverSocket`'s own `error`, `terminateTls`'s `onFailed` and
    // `onUnavailable`, and the chained-upstream refusal), every certificate
    // rejection would immediately record itself as ambiguous and
    // `TlsRejectionLog.since` would never reattach anything, ever.
    const callbacks = recordingConnectCallbacks();
    const origin = await startUntrustedTlsOrigin();
    const guard = createSsrfGuard({ allowHosts: ["untrusted.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
      interceptTls: await interception(),
      ...callbacks,
    });

    await connectThrough(proxy.port, `untrusted.test:${origin.port}`);

    expect(callbacks.certificateRejections).toEqual([
      { host: "untrusted.test", code: "DEPTH_ZERO_SELF_SIGNED_CERT" },
    ]);
    expect(callbacks.otherFailures).toEqual([]);
  });

  test("a non-certificate TLS handshake failure fires it too, via terminateTls's onFailed", async () => {
    // Distinct from the plain `serverSocket` error above: the TCP connect
    // succeeds here, and it is the TLS handshake itself that fails — with no
    // `authorizationError` set, which is what routes it to `onFailed` rather
    // than `onRejected` inside `terminateTls`. An origin that resets the
    // connection the instant it is open gives Node's TLS layer exactly that: a
    // socket error with no certificate ever having been offered. (A plain TCP
    // origin that stays open and never resets was tried first and hangs —
    // `tls.connect` has no handshake timeout of its own and simply waits for a
    // `ServerHello` that never comes, so it is not a usable fixture here.)
    const callbacks = recordingConnectCallbacks();
    const origin = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>((resolve) => origin.close(() => resolve())));
    const originPort = (origin.address() as AddressInfo).port;
    const guard = createSsrfGuard({ allowHosts: ["not-tls.test"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
      interceptTls: await interception(),
      ...callbacks,
    });

    await connectThrough(proxy.port, `not-tls.test:${originPort}`);

    expect(callbacks.otherFailures).toEqual(["not-tls.test"]);
    expect(callbacks.certificateRejections).toEqual([]);
  });

  test("a chained upstream's own refusal fires it", async () => {
    // The fifth call site: `upstream !== null` mode, where an *operator's*
    // proxy — not this one — refuses the tunnel. `upstreamRefused` logs it;
    // this is the assertion that it also reaches the same side channel.
    const callbacks = recordingConnectCallbacks();
    const upstream = http.createServer();
    upstream.on("connect", (_request, socket) => {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.close(() => resolve());
        }),
    );
    const proxy = await startProxy({
      guard: createSsrfGuard({ allowPrivateAddresses: true }),
      logger: NOOP_LOGGER,
      upstreamProxyUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      ...callbacks,
    });

    await connectThrough(proxy.port, "chained-refusal.test:443");

    expect(callbacks.otherFailures).toEqual(["chained-refusal.test"]);
    expect(callbacks.certificateRejections).toEqual([]);
  });
});
