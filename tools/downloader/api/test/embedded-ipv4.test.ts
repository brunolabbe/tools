/**
 * dl-60. An IPv6 address that embeds an IPv4 address is that IPv4 address in
 * effect, so it is judged by the IPv4 rules — whatever it is spelled like.
 *
 * The spelling is the whole defect. WHATWG `URL` canonicalises the embedded
 * address into hex groups (`[::ffff:127.0.0.1]` becomes `[::ffff:7f00:1]`), and
 * the guard used to recognise only the dotted tail, so the one spelling a URL
 * can actually reach it in was the one it did not know.
 *
 * There are two layers now, and the tests are arranged so each can be removed
 * without the other going unnoticed: the pre-flight check in `ssrf.ts`, and a
 * connect-time literal check in `dispatcher.ts` and `egress-proxy.ts`, which
 * exists because `net.connect` skips `lookup` for an IP literal. A test that
 * names one layer bypasses the other; a test that says "both layers" passes
 * with either one removed and fails only with both gone.
 */

import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { AppError, ROUTES } from "@downloader/contract";
import type { Job } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { blockedLiteral, createEgressDispatcher } from "../src/dispatcher.ts";
import { startEgressProxy } from "../src/egress-proxy.ts";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";
import { createSsrfGuard, isBlockedAddress } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { captureThumbnail, ThumbnailStore } from "../src/thumbnails.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, variant } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const logger = createLogger({ level: "silent" });

const MAPPED_LOOPBACK = "::ffff:127.0.0.1";

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

/**
 * A guard whose pre-flight check has been fooled: it waves every URL through.
 * Only the connect-time check can stop a request made under it.
 */
function foolingGuard(exempt: readonly string[] = []): SsrfGuard {
  return {
    assertAllowed: async (raw) => new URL(raw),
    assertAllAllowed: async () => undefined,
    isExemptHost: (host) => exempt.includes(host),
  };
}

/** The connector's resolver: any call means a literal went down the name path. */
async function noResolution(hostname: string): Promise<never> {
  throw new Error(`the pinning lookup ran for ${hostname}`);
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

/** The `AppError` a fetch failed with, unwrapped from undici's `TypeError`. */
async function appErrorOf(work: Promise<unknown>): Promise<AppError | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    if (error instanceof AppError) return error;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof AppError ? cause : undefined;
  }
}

function recordingLogger(): { logger: AppLogger; warnings: Record<string, unknown>[] } {
  const warnings: Record<string, unknown>[] = [];
  const recording: AppLogger = {
    debug: () => {},
    info: () => {},
    warn: (_msg, fields) => {
      warnings.push(fields ?? {});
    },
    error: () => {},
    child: () => recording,
  };
  return { logger: recording, warnings };
}

const cleanups: (() => Promise<void>)[] = [];
let harness: Harness | undefined;

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await harness?.dispose();
  harness = undefined;
});

interface Origin {
  port: number;
  /** HTTP request paths that reached the origin. */
  hits: string[];
  /** TCP connections that reached it, which a CONNECT tunnel makes without a request. */
  connections: () => number;
}

/** An HTTP server bound to IPv4 loopback **only**. */
async function loopbackOrigin(
  handler: http.RequestListener = (_request, response) => {
    response.writeHead(200, { "content-type": "image/gif" }).end("reached loopback");
  },
): Promise<Origin> {
  const hits: string[] = [];
  let connections = 0;
  const server = http.createServer((request, response) => {
    hits.push(request.url ?? "");
    handler(request, response);
  });
  server.on("connection", () => {
    connections++;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { port: (server.address() as AddressInfo).port, hits, connections: () => connections };
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

  test("well-known NAT64 (64:ff9b::/96) is judged by what it embeds", () => {
    for (const address of ["64:ff9b::7f00:1", "64:ff9b::127.0.0.1", "64:FF9B::A9FE:A9FE"]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
    for (const address of ["64:ff9b::808:808", "64:ff9b::8.8.8.8"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  test("Teredo, 6to4 and local-use NAT64 are refused whatever they embed", () => {
    // The owner's decision on dl-60: refused outright, public payload or not.
    for (const address of [
      "2001:0:4136:e378:8000:63bf:80ff:fffe", // Teredo, client 127.0.0.1
      "2001:0:4136:e378:8000:63bf:f7f7:f7f7", // Teredo, client 8.8.8.8
      "2001::1",
      "2001:0:ffff:ffff:ffff:ffff:ffff:ffff",
      "2002:7f00:1::", // 6to4 of 127.0.0.1
      "2002:808:808::1", // 6to4 of 8.8.8.8
      "2002::",
      "2002:FFFF:FFFF::1",
      "64:ff9b:1::a00:1", // local-use NAT64 of 10.0.0.1
      "64:ff9b:1::808:808", // local-use NAT64 of 8.8.8.8
      "64:ff9b:1:ffff::1",
      "64:ff9b:1::8.8.8.8",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  test("the neighbours of those ranges are not caught by them", () => {
    // 2001:200::/23 is past Teredo (dl-63 took all of 2001::/23), 2003::/16 is
    // not 6to4, 64:ff9b::/96 is not local-use: a public address in each stays.
    for (const address of ["2001:200::1", "2003::1", "2001:4860:4860::8888", "64:ff9b::808:808"]) {
      expect(isBlockedAddress(address), address).toBe(false);
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
      "::ffff:808:808%eth0",
      "::ffff:5db8:d822", // 93.184.216.34
      "::808:808",
      "::ffff:0:808:808",
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
    ]) {
      // oxlint-disable-next-line no-await-in-loop
      expect(await codeOf(guard.assertAllowed(url)), url).toBe("BLOCKED_TARGET");
    }
  });

  test("refuses a Teredo, 6to4 or local-use NAT64 literal even when it embeds a public address", async () => {
    const guard = literalOnlyGuard();
    for (const url of [
      "http://[2002:808:808::1]/",
      "http://[2001:0:4136:e378:8000:63bf:f7f7:f7f7]/",
      "http://[64:ff9b:1::8.8.8.8]/",
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

describe("the connect-time literal check", () => {
  test("blockedLiteral refuses a blocked literal and nothing else", () => {
    const guard = literalOnlyGuard({ allowHosts: ["::ffff:7f00:2"] });
    for (const host of ["[::ffff:7f00:1]", "::ffff:127.0.0.1", "127.0.0.1", "[2002:808:808::1]"]) {
      const refusal = blockedLiteral(guard, host);
      expect(refusal?.code, host).toBe("BLOCKED_TARGET");
      expect(refusal?.details, host).toMatchObject({ reason: "blocked-literal-at-connect" });
    }
    // A name is the lookup's to judge, a public literal is allowed, and the
    // guard's own exemptions hold here exactly as they do in `assertAllowed`.
    for (const host of ["cdn.example", "[::ffff:808:808]", "8.8.8.8", "[::ffff:7f00:2]"]) {
      expect(blockedLiteral(guard, host), host).toBeNull();
    }
  });

  test("the bare pinned dispatcher refuses the literal, with no pre-flight check at all", async () => {
    const origin = await loopbackOrigin();
    const target = `http://[${MAPPED_LOOPBACK}]:${origin.port}/`;

    // The control, and what makes the refusal below mean something: the same
    // production dispatcher reaches this loopback-only server through this
    // literal once the guard exempts it. So the socket path is live here, and a
    // refusal is the connector's and not a sandbox without dual-stack sockets.
    const exempt = createEgressDispatcher({
      guard: literalOnlyGuard({ allowHosts: ["::ffff:7f00:1"] }),
      resolve: noResolution,
    });
    cleanups.push(() => exempt.close());
    const reached = await fetch(target, { dispatcher: exempt.dispatcher });
    expect(reached.status).toBe(200);
    await reached.body?.cancel();
    expect(origin.hits).toHaveLength(1);

    const egress = createEgressDispatcher({ guard: literalOnlyGuard(), resolve: noResolution });
    cleanups.push(() => egress.close());
    const refusal = await appErrorOf(fetch(target, { dispatcher: egress.dispatcher }));
    expect(refusal?.code).toBe("BLOCKED_TARGET");
    // Not the lookup path's reason: `noResolution` would have produced
    // UNREACHABLE, and the pre-flight check never ran.
    expect(refusal?.details).toMatchObject({ reason: "blocked-literal-at-connect" });
    expect(origin.connections()).toBe(1);
  });

  test("both layers: a guarded fetch through the pinned dispatcher", async () => {
    // Passes with either layer removed, fails with both gone.
    const origin = await loopbackOrigin();
    const guard = literalOnlyGuard();
    const egress = createEgressDispatcher({ guard, resolve: noResolution });
    cleanups.push(() => egress.close());
    const guarded = createGuardedFetch(guard, globalThis.fetch, { dispatcher: egress.dispatcher });

    const refusal = await appErrorOf(guarded(`http://[${MAPPED_LOOPBACK}]:${origin.port}/`));
    expect(refusal?.code).toBe("BLOCKED_TARGET");
    expect(origin.connections()).toBe(0);
  });

  test("the egress proxy refuses the literal at connect when its pre-flight check was fooled", async () => {
    const origin = await loopbackOrigin();
    const { logger: recording, warnings } = recordingLogger();
    const proxy = await startEgressProxy({
      guard: foolingGuard(["127.0.0.1"]),
      logger: recording,
      resolve: noResolution,
    });
    cleanups.push(() => proxy.close());
    const proxyPort = Number(new URL(proxy.url).port);

    // The control: under the same fooled guard, an exempt literal is tunnelled,
    // so this proxy really connects when nothing refuses.
    const control = await connectThrough(proxyPort, `127.0.0.1:${origin.port}`);
    expect(control.status).toBe(200);
    const before = origin.connections();
    expect(before).toBe(1);

    const tunnel = await connectThrough(proxyPort, `[${MAPPED_LOOPBACK}]:${origin.port}`);
    expect(tunnel.status).toBe(403);
    const plain = await getThrough(proxyPort, `http://[${MAPPED_LOOPBACK}]:${origin.port}/`);
    expect(plain.status).toBe(403);

    expect(origin.connections()).toBe(before);
    expect(warnings.map((fields) => (fields["details"] as { reason?: string }).reason)).toEqual([
      "blocked-literal-at-connect",
      "blocked-literal-at-connect",
    ]);
  });
});

describe("every entry point refuses a mapped-loopback URL", () => {
  const privateRefused = {
    ssrfAllowPrivateAddresses: false,
    ssrfAllowHosts: ["site.example", "cdn.example"],
  };

  test("POST /api/probe", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver, config: privateRefused });

    const refused = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: `http://[${MAPPED_LOOPBACK}]/` },
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
      config: privateRefused,
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "BLOCKED_TARGET" } });
  });

  test("POST /api/jobs", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver, config: privateRefused });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: `http://[${MAPPED_LOOPBACK}]/` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "BLOCKED_TARGET" } });
    expect(resolver.calls).toBe(0);
  });

  test("the orchestrator's re-check, for a row that never went through the route", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver, config: privateRefused });
    const { context } = harness.app;
    const job = context.store.create({
      id: "dl-60-mapped-loopback",
      sourceUrl: `http://[${MAPPED_LOOPBACK}]/`,
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

  test("the orchestrator's check on the re-probe's own output", async () => {
    // The second attack surface: a benign page whose resolver names the
    // mapped literal. Only the orchestrator's `assertAllAllowed` on the fresh
    // probe stands between that and the engine.
    const resolver = new StubResolver(
      probeResult({ variants: [variant({ url: `http://[${MAPPED_LOOPBACK}]:1/evil.m3u8` })] }),
    );
    harness = await createHarness({ resolver, config: privateRefused });
    const { context } = harness.app;
    const job = context.store.create({
      id: "dl-60-mapped-media",
      sourceUrl: SOURCE_URL,
      options: {},
      variantId: null,
      createdAt: context.now().toISOString(),
    });

    await context.orchestrator.run(job.id, new AbortController().signal);

    const finished: Job = context.store.get(job.id);
    expect(finished.status).toBe("failed");
    expect(finished.error?.code).toBe("BLOCKED_TARGET");
    expect(resolver.calls).toBe(1);
    expect(harness.engine.calls).toBe(0);
  });

  test("a redirect hop in guarded-fetch, with no dispatcher behind it", async () => {
    // No dispatcher, so the per-hop check is the only thing in the way.
    const origin = await loopbackOrigin((request, response) => {
      if (request.url === "/go") {
        const { port } = request.socket.address() as AddressInfo;
        response.writeHead(302, { location: `http://[${MAPPED_LOOPBACK}]:${port}/secret` }).end();
        return;
      }
      response.writeHead(200).end("the secret");
    });
    // Only the literal `127.0.0.1` is exempt — the fixture's first hop. The
    // redirect names the same socket in another spelling, which is the attack.
    const guard = literalOnlyGuard({ allowHosts: ["127.0.0.1"] });
    const guarded = createGuardedFetch(guard);

    const refusal = await appErrorOf(guarded(`http://127.0.0.1:${origin.port}/go`));
    expect(refusal?.code).toBe("BLOCKED_TARGET");
    expect(origin.hits).toEqual(["/go"]);
  });

  test("both layers: a redirect hop through the pinned dispatcher", async () => {
    const origin = await loopbackOrigin((request, response) => {
      if (request.url === "/go") {
        const { port } = request.socket.address() as AddressInfo;
        response.writeHead(302, { location: `http://[${MAPPED_LOOPBACK}]:${port}/secret` }).end();
        return;
      }
      response.writeHead(200).end("the secret");
    });
    const guard = literalOnlyGuard({ allowHosts: ["127.0.0.1"] });
    const egress = createEgressDispatcher({ guard, resolve: noResolution });
    cleanups.push(() => egress.close());
    const guarded = createGuardedFetch(guard, globalThis.fetch, { dispatcher: egress.dispatcher });

    const refusal = await appErrorOf(guarded(`http://127.0.0.1:${origin.port}/go`));
    expect(refusal?.code).toBe("BLOCKED_TARGET");
    expect(origin.hits).toEqual(["/go"]);
  });

  test("the egress proxy's pre-flight check, chained, where there is no connect-time check", async () => {
    // In chained mode the upstream connects, so the literal check is not in
    // play and the pre-flight check is the only thing between ffmpeg and it.
    const seen: string[] = [];
    const upstream = http.createServer((request, response) => {
      seen.push(`GET ${request.url ?? ""}`);
      response.writeHead(200).end();
    });
    upstream.on("connect", (request, socket) => {
      seen.push(`CONNECT ${request.url ?? ""}`);
      socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          upstream.closeAllConnections();
          upstream.close(() => resolve());
        }),
    );
    const proxy = await startEgressProxy({
      guard: literalOnlyGuard(),
      logger,
      upstreamProxyUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    });
    cleanups.push(() => proxy.close());
    const proxyPort = Number(new URL(proxy.url).port);

    expect((await connectThrough(proxyPort, `[${MAPPED_LOOPBACK}]:443`)).status).toBe(403);
    expect((await getThrough(proxyPort, `http://[${MAPPED_LOOPBACK}]/`)).status).toBe(403);
    expect(seen).toEqual([]);
  });

  test("both layers: the egress proxy, CONNECT and absolute-form, which ffmpeg uses", async () => {
    const origin = await loopbackOrigin();
    const proxy = await startEgressProxy({
      guard: literalOnlyGuard(),
      logger,
      resolve: noResolution,
    });
    cleanups.push(() => proxy.close());
    const proxyPort = Number(new URL(proxy.url).port);

    const tunnel = await connectThrough(proxyPort, `[${MAPPED_LOOPBACK}]:${origin.port}`);
    expect(tunnel.status).toBe(403);
    const plain = await getThrough(proxyPort, `http://[${MAPPED_LOOPBACK}]:${origin.port}/`);
    expect(plain.status).toBe(403);
    expect(origin.connections()).toBe(0);
  });

  test("thumbnails", async () => {
    const origin = await loopbackOrigin();
    const asked: string[] = [];
    // An unguarded fetch that would succeed, so only the capture's own guard
    // can produce a null — the pattern `thumbnails.test.ts` explains.
    const captured = await captureThumbnail({
      probe: probeResult({ thumbnailUrl: `http://[${MAPPED_LOOPBACK}]:${origin.port}/og.gif` }),
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
