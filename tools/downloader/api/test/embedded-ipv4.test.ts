/**
 * dl-60. An IPv6 address that embeds an IPv4 address is that IPv4 address in
 * effect, so it is judged by the IPv4 rules — whatever it is spelled like.
 *
 * The spelling is the whole defect. WHATWG `URL` canonicalises the embedded
 * address into hex groups (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`), and
 * the guard used to recognise only the dotted tail, so the one spelling a URL
 * can actually reach it in was the one it did not know. And for a literal, the
 * pre-flight check is the only check: `net.connect` skips `lookup` for an IP,
 * so the pinning connector in `dispatcher.ts` never sees one.
 *
 * Every entry point is exercised here rather than only the function, because
 * each one is a separate line that could be calling something else.
 */

import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { AppError, ROUTES } from "@downloader/contract";
import type { Job } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createEgressDispatcher } from "../src/dispatcher.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createLogger } from "../src/logger.ts";
import { createSsrfGuard, isBlockedAddress } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { captureThumbnail, ThumbnailStore } from "../src/thumbnails.ts";
import { createHarness, probeResult, StubResolver, variant } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const logger = createLogger({ level: "silent" });

/** Never consulted for a literal; throwing makes any accidental DNS use loud. */
function literalOnlyGuard(options: { allowHosts?: string[] } = {}): SsrfGuard {
  return createSsrfGuard({
    ...options,
    lookup: async (hostname) => {
      if (hostname === "site.example") return ["93.184.216.34"];
      throw new Error(`no DNS in this test: ${hostname}`);
    },
  });
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

const cleanups: (() => Promise<void>)[] = [];
let harness: Harness | undefined;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await harness?.dispose();
  harness = undefined;
});

/** An HTTP server bound to IPv4 loopback **only**, counting what reaches it. */
async function loopbackOrigin(
  handler: http.RequestListener = (_request, response) => {
    response.writeHead(200, { "content-type": "image/gif" }).end("reached loopback");
  },
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
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port, hits };
}

describe("isBlockedAddress judges the embedded IPv4 address, in every spelling", () => {
  test("IPv4-mapped (::ffff:0:0/96)", () => {
    for (const address of [
      "::ffff:7f00:1", // what `URL` hands the guard for [::ffff:127.0.0.1]
      "::ffff:127.0.0.1",
      "::FFFF:7F00:1",
      "0:0:0:0:0:ffff:7f00:1",
      "0000:0000:0000:0000:0000:ffff:7f00:0001",
      "0:0:0:0:0:ffff:127.0.0.1",
      "::ffff:7f00:1%eth0",
      "::ffff:127.0.0.1%1",
      "::ffff:a9fe:a9fe", // 169.254.169.254, cloud metadata
      "::ffff:169.254.169.254",
      "::ffff:a00:1", // 10.0.0.1
      "::ffff:ac10:1", // 172.16.0.1
      "::ffff:c0a8:101", // 192.168.1.1
      "::ffff:6440:1", // 100.64.0.1, CGNAT
      "::ffff:0:0", // 0.0.0.0
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("IPv4-compatible (::/96)", () => {
    for (const address of [
      "::7f00:1",
      "::127.0.0.1",
      "0:0:0:0:0:0:7f00:1",
      "::7F00:1",
      "::a9fe:a9fe",
      "::169.254.169.254",
      "::a00:1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("SIIT IPv4-translated (::ffff:0:0:0/96)", () => {
    for (const address of [
      "::ffff:0:7f00:1",
      "::ffff:0:127.0.0.1",
      "0:0:0:0:ffff:0:a9fe:a9fe",
      "::FFFF:0:A00:1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("NAT64 (64:ff9b::/96 and 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32)", () => {
    for (const address of [
      "64:ff9b::7f00:1",
      "64:ff9b::127.0.0.1",
      "64:ff9b::a9fe:a9fe",
      "64:ff9b:1::a00:1",
      "2002:7f00:1::", // 6to4 of 127.0.0.1
      "2002:a9fe:a9fe::1",
      "2002:c0a8:101:1::1", // 192.168.1.1
      // Teredo: server 65.54.227.120, client 127.0.0.1 stored bit-inverted.
      "2001:0:4136:e378:8000:63bf:80ff:fffe",
      // Teredo: server 127.0.0.1, client 8.8.8.8.
      "2001:0:7f00:1:8000:63bf:f7f7:f7f7",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("the native IPv6 rules are unchanged", () => {
    for (const address of ["::", "::1", "0:0:0:0:0:0:0:1", "fe80::1%eth0", "fd00::1", "ff02::1"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("a public embedded address stays allowed", () => {
    // The fix is to judge the value, not to refuse the shape: a mapped public
    // address is a public address.
    for (const address of [
      "::ffff:808:808",
      "::ffff:8.8.8.8",
      "::FFFF:808:808",
      "0:0:0:0:0:ffff:808:808",
      "::ffff:5db8:d822", // 93.184.216.34
      "::808:808",
      "::ffff:0:808:808",
      "64:ff9b::808:808",
      "2002:808:808::1",
      "2001:0:4136:e378:8000:63bf:f7f7:f7f7", // server 65.54.227.120, client 8.8.8.8
      "2606:4700::1111",
    ]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });
});

describe("assertAllowed, where the spelling is chosen by `URL` and not by the attacker", () => {
  test("`URL` canonicalises an embedded IPv4 address into hex groups", () => {
    // The reason a dotted-tail pattern could never have matched a URL.
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe("[::ffff:7f00:1]");
    expect(new URL("http://[::127.0.0.1]/").hostname).toBe("[::7f00:1]");
    expect(new URL("http://[0:0:0:0:0:FFFF:7F00:0001]/").hostname).toBe("[::ffff:7f00:1]");
  });

  test("refuses an IPv6 literal embedding a blocked IPv4 address", async () => {
    const guard = literalOnlyGuard();
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]:8080/",
      "http://[::ffff:169.254.169.254]/latest/meta-data/",
      "https://[::ffff:10.0.0.1]/",
      "http://[::127.0.0.1]/",
      "http://[0:0:0:0:0:FFFF:7F00:0001]/",
      "http://[::ffff:0:127.0.0.1]/",
      "http://[64:ff9b::127.0.0.1]/",
      "http://[2002:7f00:1::]/",
    ]) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await codeOf(guard.assertAllowed(url)), url).toBe("BLOCKED_TARGET");
    }
  });

  test("a zone id cannot reach the guard through a URL at all", async () => {
    // WHATWG `URL` rejects one, so this is INVALID_URL before any address rule.
    const guard = literalOnlyGuard();
    expect(await codeOf(guard.assertAllowed("http://[::ffff:127.0.0.1%25eth0]/"))).toBe(
      "INVALID_URL",
    );
  });

  test("a name whose AAAA answer is a mapped private address is refused", async () => {
    const guard = createSsrfGuard({ lookup: async () => ["::ffff:7f00:1"] });
    expect(await codeOf(guard.assertAllowed("https://mapped.example/"))).toBe("BLOCKED_TARGET");
  });

  test("allows an IPv6 literal embedding a public IPv4 address", async () => {
    const guard = literalOnlyGuard();
    for (const url of ["http://[::ffff:8.8.8.8]/", "https://[::ffff:808:808]/"]) {
      // oxlint-disable-next-line no-await-in-loop
      await expect(guard.assertAllowed(url), url).resolves.toBeInstanceOf(URL);
    }
  });
});

describe("through the real pinned dispatcher, to a server bound only to 127.0.0.1", () => {
  test("the connector cannot see a literal, so the pre-flight refusal is what stops it", async () => {
    const origin = await loopbackOrigin();
    const target = `http://[::ffff:127.0.0.1]:${origin.port}/`;
    const guard = literalOnlyGuard();
    const egress = createEgressDispatcher({
      guard,
      resolve: async (hostname) => {
        throw new Error(`the pinning lookup ran for ${hostname}`);
      },
    });
    cleanups.push(() => egress.close());

    // The control, and the reason this test can fail: the production dispatcher
    // on its own *does* reach loopback through this literal. Without it, a
    // refusal below could be the sandbox having no dual-stack socket, not the
    // guard. If a connect-time literal check is ever added (dl-60's open
    // decision), this line is the one that changes.
    const direct = await fetch(target, { dispatcher: egress.dispatcher });
    expect(direct.status).toBe(200);
    await direct.body?.cancel();
    expect(origin.hits).toHaveLength(1);

    const guarded = createGuardedFetch(guard, globalThis.fetch, { dispatcher: egress.dispatcher });
    const error = await guarded(target).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("BLOCKED_TARGET");
    expect(origin.hits).toHaveLength(1);
  });
});

describe("every entry point refuses a mapped-loopback URL", () => {
  test("POST /api/probe", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      config: { ssrfAllowPrivateAddresses: false, ssrfAllowHosts: ["site.example", "cdn.example"] },
    });

    const refused = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "http://[::ffff:127.0.0.1]/" },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: "BLOCKED_TARGET" } });
    expect(resolver.calls).toBe(0);

    // The same route still takes a mapped public address.
    const allowed = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "http://[::ffff:8.8.8.8]/" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(resolver.calls).toBe(1);
  });

  test("POST /api/probe, when the resolver's media URL is the mapped literal", async () => {
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({
          variants: [variant({ url: "http://[::ffff:169.254.169.254]/latest/meta-data/" })],
        }),
      ),
      config: { ssrfAllowPrivateAddresses: false, ssrfAllowHosts: ["site.example", "cdn.example"] },
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "https://site.example/watch/42" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "BLOCKED_TARGET" } });
  });

  test("POST /api/jobs", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      config: { ssrfAllowPrivateAddresses: false, ssrfAllowHosts: ["site.example", "cdn.example"] },
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: "http://[::ffff:127.0.0.1]/" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "BLOCKED_TARGET" } });
    expect(resolver.calls).toBe(0);
  });

  test("the orchestrator's re-check, for a row that never went through the route", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({
      resolver,
      config: { ssrfAllowPrivateAddresses: false, ssrfAllowHosts: ["site.example", "cdn.example"] },
    });
    const { context } = harness.app;
    const job = context.store.create({
      id: "dl-60-mapped-loopback",
      sourceUrl: "http://[::ffff:127.0.0.1]/",
      options: {},
      variantId: null,
      createdAt: context.now().toISOString(),
    });

    await context.orchestrator.run(job.id, new AbortController().signal);

    const finished: Job = context.store.get(job.id);
    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("BLOCKED_TARGET");
    expect(resolver.calls).toBe(0);
    expect(harness.engine.calls).toBe(0);
  });

  test("a redirect hop in guarded-fetch, over a real socket", async () => {
    const origin = await loopbackOrigin((request, response) => {
      if (request.url === "/go") {
        const { port } = request.socket.address() as AddressInfo;
        response.writeHead(302, { location: `http://[::ffff:127.0.0.1]:${port}/secret` }).end();
        return;
      }
      response.writeHead(200).end("the secret");
    });
    // Only the literal `127.0.0.1` is exempt — the fixture's first hop. The
    // redirect names the same socket in another spelling, which is the attack.
    const guard = literalOnlyGuard({ allowHosts: ["127.0.0.1"] });
    const egress = createEgressDispatcher({ guard });
    cleanups.push(() => egress.close());
    const guarded = createGuardedFetch(guard, globalThis.fetch, { dispatcher: egress.dispatcher });

    const error = await guarded(`http://127.0.0.1:${origin.port}/go`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("BLOCKED_TARGET");
    expect(origin.hits).toEqual(["/go"]);
  });

  test("the egress proxy's CONNECT path and its absolute-form path, which ffmpeg uses", async () => {
    const origin = await loopbackOrigin();
    const guard = literalOnlyGuard();
    const proxy = await startEgressProxy({
      guard,
      logger,
      resolve: async (hostname) => {
        throw new Error(`the pinning lookup ran for ${hostname}`);
      },
    });
    cleanups.push(() => proxy.close());
    const proxyPort = Number(new URL(proxy.url).port);

    const tunnel = await connectThrough(proxyPort, `[::ffff:127.0.0.1]:${origin.port}`);
    expect(tunnel.status).toBe(403);

    const plain = await getThrough(proxyPort, `http://[::ffff:127.0.0.1]:${origin.port}/`);
    expect(plain.status).toBe(403);
    expect(origin.hits).toEqual([]);
  });

  test("thumbnails", async () => {
    const origin = await loopbackOrigin();
    const asked: string[] = [];
    // An unguarded fetch that would succeed, so only the capture's own guard
    // can produce a null — the pattern `thumbnails.test.ts` explains.
    const captured = await captureThumbnail({
      probe: probeResult({ thumbnailUrl: `http://[::ffff:127.0.0.1]:${origin.port}/og.gif` }),
      guard: literalOnlyGuard(),
      fetchImpl: async (input) => {
        asked.push(String(input));
        return await fetch(input);
      },
      store: new ThumbnailStore(),
      logger,
    });
    expect(captured).toBeNull();
    expect(asked).toEqual([]);
    expect(origin.hits).toEqual([]);
  });
});

/** A raw CONNECT; resolves with the status line's code. */
function connectThrough(proxyPort: number, target: string): Promise<{ status: number }> {
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
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/u.exec(buffer)?.[1] ?? 0) });
    });
    setTimeout(() => socket.end(), 300).unref();
  });
}

/** An absolute-form GET, the way ffmpeg addresses a proxy over plain HTTP. */
function getThrough(proxyPort: number, url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: proxyPort, method: "GET", path: url, headers: { host: "x" } },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode ?? 0 }));
      },
    );
    request.once("error", reject);
    request.end();
  });
}
