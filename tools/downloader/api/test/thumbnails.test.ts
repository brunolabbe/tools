/**
 * The preview-image capture and its store.
 *
 * Everything here runs against a **real HTTP server on loopback**, not a stubbed
 * `fetch`. The three defences worth having — a byte cap enforced while reading,
 * a `Content-Type` allowlist, a timeout — are all about what a hostile origin
 * puts on the wire, and a stub that returns a `Response` object built in-process
 * cannot lie about `Content-Length` or trickle bytes the way a socket can.
 *
 * The guard is stubbed rather than the network: an SSRF refusal is the one case
 * where no socket should be opened at all.
 */

import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AppError } from "@downloader/contract";
import type { ProbeResult } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createLogger } from "../src/logger.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { captureThumbnail, ThumbnailStore } from "../src/thumbnails.ts";
import { probeResult } from "./helpers.ts";

const logger = createLogger({ level: "silent" });

/** A 2×2 GIF. Small, real, and a member of the content-type allowlist. */
const GIF = Buffer.from("R0lGODlhAgACAIAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAIDRAJZADs=", "base64");

interface Fixture {
  origin: string;
  /** Every path the capture asked for, so a test can prove no request was made. */
  requests: { path: string; headers: Record<string, string | string[] | undefined> }[];
  close(): Promise<void>;
}

type Route = (path: string) => {
  status?: number;
  contentType?: string | null;
  /** Sent as-is; may deliberately disagree with what is actually written. */
  contentLength?: string;
  body?: Buffer;
  /** Writes `body` repeatedly, `repeat` times, for the oversize case. */
  repeat?: number;
  delayMs?: number;
};

async function startFixture(route: Route): Promise<Fixture> {
  const requests: Fixture["requests"] = [];
  const server: Server = createServer((request, response) => {
    requests.push({ path: request.url ?? "", headers: request.headers });
    const plan = route(request.url ?? "");
    const send = (): void => {
      response.writeHead(plan.status ?? 200, {
        ...(plan.contentType === null || plan.contentType === undefined
          ? {}
          : { "content-type": plan.contentType }),
        ...(plan.contentLength === undefined ? {} : { "content-length": plan.contentLength }),
      });
      const body = plan.body ?? GIF;
      for (let i = 0; i < (plan.repeat ?? 1); i++) response.write(body);
      response.end();
    };
    if (plan.delayMs === undefined) send();
    else setTimeout(send, plan.delayMs);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: async () =>
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Loopback is a blocked address, so the fixture host needs the escape hatch. */
const permissiveGuard = (): SsrfGuard => createSsrfGuard({ allowPrivateAddresses: true });

function probeWithThumbnail(url: string): ProbeResult {
  return probeResult({ thumbnailUrl: url });
}

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

async function capture(
  url: string,
  overrides: {
    guard?: SsrfGuard;
    store?: ThumbnailStore;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<{ path: string | null; store: ThumbnailStore }> {
  const guard = overrides.guard ?? permissiveGuard();
  const store = overrides.store ?? new ThumbnailStore();
  const path = await captureThumbnail({
    probe: probeWithThumbnail(url),
    guard,
    fetchImpl: createGuardedFetch(guard),
    store,
    logger,
    ...(overrides.maxBytes === undefined ? {} : { maxBytes: overrides.maxBytes }),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
  });
  return { path, store };
}

describe("captureThumbnail", () => {
  test("stores the bytes and returns a path on our own origin", async () => {
    fixture = await startFixture(() => ({ contentType: "image/gif" }));
    const { path, store } = await capture(`${fixture.origin}/thumb.gif`);

    expect(path).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]{43}$/u);
    const token = (path ?? "").split("/").pop() ?? "";
    expect(store.get(token)).toEqual({ contentType: "image/gif", bytes: GIF });
  });

  test("replays the source's credentials, which is why the fetch happens here", async () => {
    fixture = await startFixture(() => ({ contentType: "image/png" }));
    await capture(`${fixture.origin}/thumb.png`);

    // `probeResult()` carries a Referer and a Cookie. A CDN that gates the
    // manifest on them gates the image on them too, and `Job` has no
    // `requestContext` to replay them from later — see `thumbnails.ts`.
    expect(fixture.requests[0]?.headers["referer"]).toBe("https://site.example/watch/42");
    expect(fixture.requests[0]?.headers["cookie"]).toBe("session=super-secret");
  });

  test("a content type outside the allowlist is discarded", async () => {
    fixture = await startFixture(() => ({ contentType: "text/html" }));
    const { path } = await capture(`${fixture.origin}/not-an-image`);
    expect(path).toBeNull();
  });

  test("SVG is refused, because it is a document that can carry script", async () => {
    fixture = await startFixture(() => ({ contentType: "image/svg+xml" }));
    expect((await capture(`${fixture.origin}/x.svg`)).path).toBeNull();
  });

  test("parameters and case on the content type do not defeat the allowlist", async () => {
    fixture = await startFixture(() => ({ contentType: "IMAGE/JPEG; charset=binary" }));
    const { path, store } = await capture(`${fixture.origin}/thumb.jpg`);
    expect(path).not.toBeNull();
    expect(store.get((path ?? "").split("/").pop() ?? "")?.contentType).toBe("image/jpeg");
  });

  test("an oversized body is discarded, counted as it arrives", async () => {
    // No `Content-Length` at all, so Node sends it chunked — which is exactly
    // the case a cap read off a header cannot bound, and the reason `readBounded`
    // counts what actually arrives. 100 copies of the GIF against a 200-byte cap.
    fixture = await startFixture(() => ({ contentType: "image/gif", repeat: 100 }));
    const { path } = await capture(`${fixture.origin}/huge.gif`, { maxBytes: 200 });
    expect(path).toBeNull();
  });

  test("a Content-Length shorter than the body cannot smuggle bytes past the cap", async () => {
    // The other half: an origin announcing 62 bytes and writing 6,200. Undici
    // truncates at the declared length, so what reaches `readBounded` is one
    // GIF — under the cap, and therefore kept. Asserted rather than assumed,
    // because "the header was believed" and "the transfer was truncated" look
    // identical from the outside and only one of them is safe.
    fixture = await startFixture(() => ({
      contentType: "image/gif",
      contentLength: String(GIF.byteLength),
      repeat: 100,
    }));
    const { path, store } = await capture(`${fixture.origin}/liar.gif`, { maxBytes: 200 });
    expect(path).not.toBeNull();
    expect(store.get((path ?? "").split("/").pop() ?? "")?.bytes.byteLength).toBe(GIF.byteLength);
  });

  test("a body exactly at the cap is kept — the boundary is not off by one", async () => {
    fixture = await startFixture(() => ({ contentType: "image/gif" }));
    expect((await capture(`${fixture.origin}/t.gif`, { maxBytes: GIF.byteLength })).path).not.toBe(
      null,
    );
  });

  test("a 404 is not a preview and not an error", async () => {
    fixture = await startFixture(() => ({ status: 404, contentType: "text/plain" }));
    expect((await capture(`${fixture.origin}/gone.jpg`)).path).toBeNull();
  });

  test("a slow origin gives up on its own timeout, well under the probe's", async () => {
    fixture = await startFixture(() => ({ contentType: "image/gif", delayMs: 2_000 }));
    const started = Date.now();
    expect((await capture(`${fixture.origin}/slow.gif`, { timeoutMs: 120 })).path).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("a blocked address is refused before any socket is opened", async () => {
    // The whole point of the guard: a page naming a LAN address must not make
    // this service — nor, via an `<img src>`, the user's browser — fetch it.
    //
    // `fetchImpl` here is a plain spy rather than `createGuardedFetch`, and
    // deliberately: a guarded fetch would refuse on its own hop-0 check and this
    // test would pass with `captureThumbnail`'s own `assertAllowed` deleted.
    // Unguarded, the only thing that can stop the request is the check in
    // `captureThumbnail`, so removing it turns this red.
    const refusing: SsrfGuard = {
      assertAllowed: async (raw) => {
        throw new AppError("BLOCKED_TARGET", undefined, { details: { url: raw } });
      },
      assertAllAllowed: async () => undefined,
      isExemptHost: () => false,
    };
    const asked: string[] = [];
    const path = await captureThumbnail({
      probe: probeWithThumbnail("http://192.168.1.1/admin?action=reboot"),
      guard: refusing,
      fetchImpl: async (input) => {
        asked.push(String(input));
        return new Response(GIF, { headers: { "content-type": "image/gif" } });
      },
      store: new ThumbnailStore(),
      logger,
    });

    expect(path).toBeNull();
    // Not merely "no preview": no request was made at all.
    expect(asked).toEqual([]);
  });

  test("a 302 to a refused host is refused, which the pre-check alone cannot do", async () => {
    // The classic way round an SSRF guard: pass the check, then redirect. Only
    // `guardedFetch`'s per-hop re-check catches this.
    //
    // **The redirect target is a server that answers with a perfectly good
    // image**, and that is the point. An earlier draft of this test pointed at
    // `169.254.169.254`, and it passed with a plain unguarded `fetch` too —
    // because link-local is simply unreachable from here, so the fetch failed on
    // its own and the assertion measured the sandbox rather than the guard. With
    // a reachable target, only the guard can produce a null.
    fixture = await startFixture(() => ({ contentType: "image/gif" }));
    const target = new URL(fixture.origin);
    let hops = 0;
    const redirecting = createServer((_request, response) => {
      hops++;
      // Same address, a name the guard has not been told to allow.
      response.writeHead(302, { location: `http://localhost:${target.port}/thumb.gif` });
      response.end();
    });
    await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
    const { port } = redirecting.address() as AddressInfo;
    try {
      // Only the literal is exempt. `localhost` gets resolved, comes back
      // 127.0.0.1, and is blocked on its address like any other name would be.
      const guard = createSsrfGuard({ allowHosts: ["127.0.0.1"] });
      const path = await captureThumbnail({
        probe: probeWithThumbnail(`http://127.0.0.1:${port}/thumb.gif`),
        guard,
        fetchImpl: createGuardedFetch(guard),
        store: new ThumbnailStore(),
        logger,
      });
      expect(path).toBeNull();
      // The first hop *was* allowed and *was* made — so this is not the
      // pre-check passing by accident. The refusal is on the hop after it.
      expect(hops).toBe(1);
      // And the image behind the redirect was never fetched.
      expect(fixture?.requests).toEqual([]);
    } finally {
      redirecting.closeAllConnections();
      await new Promise<void>((resolve) => redirecting.close(() => resolve()));
    }
  });

  test("a malformed thumbnail URL is dropped rather than thrown", async () => {
    expect((await capture("not-a-url")).path).toBeNull();
  });

  test("a probe with no thumbnail asks for nothing", async () => {
    const store = new ThumbnailStore();
    const guard = permissiveGuard();
    const path = await captureThumbnail({
      probe: probeResult(),
      guard,
      fetchImpl: async () => {
        throw new Error("must not fetch");
      },
      store,
      logger,
    });
    expect(path).toBeNull();
    expect(store.size).toBe(0);
  });
});

describe("ThumbnailStore", () => {
  test("mints an unguessable token rather than accepting one", () => {
    const store = new ThumbnailStore();
    const a = store.put({ contentType: "image/gif", bytes: GIF });
    const b = store.put({ contentType: "image/gif", bytes: GIF });
    expect(a).not.toBe(b);
    // 32 bytes, base64url, unpadded — the same shape as a file token.
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  test("an entry past its TTL reads as absent", () => {
    let clock = 0;
    const store = new ThumbnailStore({ ttlMs: 1_000, now: () => clock });
    const token = store.put({ contentType: "image/png", bytes: GIF });

    clock = 999;
    expect(store.get(token)).not.toBeNull();
    clock = 1_000;
    expect(store.get(token)).toBeNull();
  });

  test("the TTL outlives the probe cache's ceiling, or a cache hit loses its preview", async () => {
    // `probe.ts` mints the token *before* it writes the probe cache, so a cache
    // hit up to `PROBE_CACHE_TTL_CEILING_MS` later hands out a token that must
    // still resolve. Read from the module rather than restated, so the two
    // cannot drift apart silently.
    const { PROBE_CACHE_TTL_CEILING_MS } = await import("../src/config.ts");
    let clock = 0;
    const store = new ThumbnailStore({ now: () => clock });
    const token = store.put({ contentType: "image/gif", bytes: GIF });
    clock = PROBE_CACHE_TTL_CEILING_MS;
    expect(store.get(token)).not.toBeNull();
  });

  test("bounded: the oldest entries are dropped rather than growing without limit", () => {
    const store = new ThumbnailStore({ maxEntries: 2 });
    const first = store.put({ contentType: "image/gif", bytes: GIF });
    store.put({ contentType: "image/gif", bytes: GIF });
    store.put({ contentType: "image/gif", bytes: GIF });

    expect(store.size).toBe(2);
    expect(store.get(first)).toBeNull();
  });
});
