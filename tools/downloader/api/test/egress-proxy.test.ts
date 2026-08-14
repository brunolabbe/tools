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
import { createSsrfGuard } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";

const NOOP_LOGGER = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
};

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

/** Sends an absolute-form GET, the way ffmpeg addresses a proxy over plain HTTP. */
function getThrough(proxyPort: number, url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers: { host: "x" } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.once("end", () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.once("error", reject);
    request.end();
  });
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

describe("it is not a general-purpose proxy", () => {
  test("a method other than GET or HEAD is refused", async () => {
    const guard = createSsrfGuard({ allowHosts: ["allowed.test"] });
    const proxy = await startProxy({ guard, logger: NOOP_LOGGER });

    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: proxy.port,
          method: "POST",
          path: "http://allowed.test/upload",
        },
        (response) => resolve(response.statusCode ?? 0),
      );
      request.once("error", reject);
      request.end("payload");
    });

    expect(status).toBe(405);
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
