/**
 * The egress dispatcher, tested as the thing it exists to be: the check that
 * still holds when the pre-flight one has already been fooled.
 *
 * The case that matters is the last describe block. Everything above it
 * exercises the connector directly; those tests go through a real socket and a
 * real `fetch`, with a guard that has been *deliberately lied to*, so a pass
 * means the address the socket reached was vetted by the connector and not by
 * anything that ran earlier.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { AppError } from "@downloader/contract";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createEgressDispatcher, createPinningLookup } from "../src/dispatcher.ts";
import type { AddressResolver, ResolvedAddress } from "../src/dispatcher.ts";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createSsrfGuard } from "../src/ssrf.ts";

function resolverFor(records: ResolvedAddress[]): AddressResolver {
  return async () => records;
}

function v4(address: string): ResolvedAddress {
  return { address, family: 4 };
}

/** Drives the callback-style `lookup` as a promise so tests can await it. */
function runLookup(
  lookup: ReturnType<typeof createPinningLookup>,
  hostname: string,
  options: { all?: boolean; family?: number } = { all: true },
): Promise<{ error: Error | null; address: string | ResolvedAddress[]; family?: number }> {
  return new Promise((resolve) => {
    lookup(hostname, options, (error, address, family) => {
      resolve({
        error: error as Error | null,
        address: address as string | ResolvedAddress[],
        ...(family === undefined ? {} : { family }),
      });
    });
  });
}

const openGuard = createSsrfGuard({ lookup: async () => ["93.184.216.34"] });

describe("createPinningLookup", () => {
  test("refuses a name that resolves to a private address", async () => {
    const lookup = createPinningLookup(openGuard, resolverFor([v4("169.254.169.254")]));
    const { error } = await runLookup(lookup, "metadata.example");

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("BLOCKED_TARGET");
  });

  test("refuses when only *one* record is blocked", async () => {
    // The multi-record rebinding trick: answer with a good address and a bad
    // one, and hope the connector picks whichever it likes. Every record has to
    // be acceptable, exactly as `ssrf.ts` requires.
    const lookup = createPinningLookup(
      openGuard,
      resolverFor([v4("93.184.216.34"), v4("127.0.0.1")]),
    );
    const { error } = await runLookup(lookup, "half-hostile.example");

    expect((error as AppError).code).toBe("BLOCKED_TARGET");
    expect((error as AppError).details).toMatchObject({ address: "127.0.0.1" });
  });

  test("passes a public name through with its records intact", async () => {
    const records = [v4("93.184.216.34"), v4("1.1.1.1")];
    const lookup = createPinningLookup(openGuard, resolverFor(records));
    const { error, address } = await runLookup(lookup, "example.com");

    expect(error).toBeNull();
    expect(address).toEqual(records);
  });

  test("answers the single-address form when `all` is not set", async () => {
    const lookup = createPinningLookup(openGuard, resolverFor([v4("93.184.216.34")]));
    const { error, address, family } = await runLookup(lookup, "example.com", { all: false });

    expect(error).toBeNull();
    expect(address).toBe("93.184.216.34");
    expect(family).toBe(4);
  });

  test("a blocked record still refuses when the family filter would have dropped it", async () => {
    // The ordering this asserts is the whole point: filter first and a name
    // answering `1.2.3.4` over v4 and `::1` over v6 looks clean to a connector
    // that asked for v4, even though the name has just demonstrated that it
    // points at loopback.
    const lookup = createPinningLookup(
      openGuard,
      resolverFor([v4("93.184.216.34"), { address: "::1", family: 6 }]),
    );
    const { error } = await runLookup(lookup, "dual-stack-hostile.example", {
      all: true,
      family: 4,
    });

    expect((error as AppError).code).toBe("BLOCKED_TARGET");
  });

  test("honours the guard's own exemptions rather than keeping a second policy", async () => {
    // Without this, a fixture host that `assertAllowed` waves through would be
    // refused at connect time — the e2e suite's origin is exactly that host.
    const guard = createSsrfGuard({ allowHosts: ["fixture.local"], lookup: async () => [] });
    const lookup = createPinningLookup(guard, resolverFor([v4("127.0.0.1")]));

    const allowed = await runLookup(lookup, "fixture.local");
    expect(allowed.error).toBeNull();

    const other = await runLookup(lookup, "not-the-fixture.local");
    expect((other.error as AppError).code).toBe("BLOCKED_TARGET");
  });

  test("a resolution failure is UNREACHABLE, not a block", async () => {
    const lookup = createPinningLookup(openGuard, async () => {
      throw new Error("NXDOMAIN");
    });
    const { error } = await runLookup(lookup, "no-such-host.example");

    expect((error as AppError).code).toBe("UNREACHABLE");
  });

  test("an empty answer is refused rather than treated as unresolvable", async () => {
    const lookup = createPinningLookup(openGuard, resolverFor([]));
    const { error } = await runLookup(lookup, "empty.example");

    expect((error as AppError).code).toBe("BLOCKED_TARGET");
  });
});

describe("createEgressDispatcher", () => {
  test("pins by default", async () => {
    const egress = createEgressDispatcher({ guard: openGuard });
    expect(egress.mode).toBe("pinned");
    await egress.close();
  });

  test("switches to the proxy wholesale when one is configured", async () => {
    const egress = createEgressDispatcher({
      guard: openGuard,
      proxyUrl: "http://proxy.internal:3128",
    });
    expect(egress.mode).toBe("proxy");
    await egress.close();
  });

  test("an empty proxy string is not a proxy", async () => {
    const egress = createEgressDispatcher({ guard: openGuard, proxyUrl: "" });
    expect(egress.mode).toBe("pinned");
    await egress.close();
  });
});

/**
 * The TOCTOU itself, over a real socket.
 *
 * Each test gives the guard a lookup that answers with a public address — so
 * the pre-flight check passes — while the connector's resolver answers with
 * something else. That is a DNS rebind, reduced to its essentials: the answer
 * changed between the check and the connection.
 */
describe("a rebind between the check and the connection", () => {
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    server = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("reached the origin");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Passes the pre-flight check: every hostname looks like a public address. */
  const lyingGuard = createSsrfGuard({ lookup: async () => ["93.184.216.34"] });

  test("the connector refuses the address the pre-flight check never saw", async () => {
    const egress = createEgressDispatcher({
      guard: lyingGuard,
      // What DNS says the *second* time — the rebind.
      resolve: resolverFor([v4("127.0.0.1")]),
    });
    const guarded = createGuardedFetch(lyingGuard, globalThis.fetch, {
      dispatcher: egress.dispatcher,
    });

    // The guard is satisfied: `assertAllowed` resolved this host to a public
    // address. Only the connector is in a position to notice.
    await expect(
      lyingGuard.assertAllowed(`http://rebinding.example:${port}/`),
    ).resolves.toBeTruthy();

    const error = await guarded(`http://rebinding.example:${port}/`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("BLOCKED_TARGET");
    expect((error as AppError).details).toMatchObject({ address: "127.0.0.1" });

    await egress.close();
  });

  test("and connects normally when the pinned address is allowed", async () => {
    // The same setup with the host exempted, which is both the e2e fixture's
    // configuration and the proof that the dispatcher is genuinely in the
    // socket path rather than being ignored.
    const guard = createSsrfGuard({
      allowHosts: ["fixture.local"],
      lookup: async () => ["93.184.216.34"],
    });
    const egress = createEgressDispatcher({ guard, resolve: resolverFor([v4("127.0.0.1")]) });
    const guarded = createGuardedFetch(guard, globalThis.fetch, {
      dispatcher: egress.dispatcher,
    });

    const response = await guarded(`http://fixture.local:${port}/`);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("reached the origin");

    await egress.close();
  });

  test("https goes through the same connector, not around it", async () => {
    // undici builds TLS sockets on a different branch from plaintext ones, and
    // a `lookup` that reached only the second would leave every https:// URL —
    // which is to say nearly all of them — unpinned. The tell is the error
    // code: without the connector this would fail to resolve `.example` at all
    // and surface as a DNS error rather than as a refusal.
    const egress = createEgressDispatcher({
      guard: lyingGuard,
      resolve: resolverFor([v4("169.254.169.254")]),
    });
    const guarded = createGuardedFetch(lyingGuard, globalThis.fetch, {
      dispatcher: egress.dispatcher,
    });

    const error = await guarded("https://rebinding.example/").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("BLOCKED_TARGET");
    expect((error as AppError).details).toMatchObject({ address: "169.254.169.254" });

    await egress.close();
  });
});
