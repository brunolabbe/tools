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
import { afterEach, describe, expect, test } from "vitest";
import type { AddressResolver, ResolvedAddress } from "../src/dispatcher.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import type { EgressProxy } from "../src/egress-proxy.ts";
import type { AppLogger } from "../src/logger.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { createTlsInterception } from "../src/tls-interception.ts";
import type { TlsInterception } from "../src/tls-interception.ts";
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
function recordingLogger(): { logger: AppLogger; warnings: Line[] } {
  const warnings: Line[] = [];
  const logger: AppLogger = {
    ...NOOP_LOGGER,
    warn: (msg, fields) => {
      warnings.push({ msg, fields: fields ?? {} });
    },
    child: () => logger,
  };
  return { logger, warnings };
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

async function interception(caFile?: string): Promise<TlsInterception> {
  const intercept = await createTlsInterception(caFile === undefined ? {} : { caFile });
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
    // public, the connector's resolver says loopback. A pass means the address
    // the socket reached was vetted by the connector, not by anything earlier.
    const guard = guardResolving({ "rebind.test": ["93.184.216.34"] });
    const proxy = await startProxy({
      guard,
      logger: NOOP_LOGGER,
      resolve: resolverFor([v4("127.0.0.1")]),
    });

    const result = await connectThrough(proxy.port, "rebind.test:443");

    expect(result.status).toBe(502);
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
