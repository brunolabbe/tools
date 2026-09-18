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

import fsp from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import nodePath from "node:path";
import { AppError, ROUTES } from "@downloader/contract";
import type { Job, JobResponse, ProbeResponse, ProbeResult } from "@downloader/contract";
import { Storage } from "@downloader/engine";
import { afterEach, describe, expect, test } from "vitest";
import { createGuardedFetch } from "../src/guarded-fetch.ts";
import { createLogger } from "../src/logger.ts";
import { probeForClient } from "../src/probe-out.ts";
import { createSsrfGuard } from "../src/ssrf.ts";
import type { SsrfGuard } from "../src/ssrf.ts";
import { ConcurrencyGate } from "@webtools/core/rate-limit";
import {
  captureThumbnail,
  limitFrameGrabs,
  persistThumbnail,
  readPersistedThumbnail,
  ThumbnailStore,
  withThumbnailPath,
} from "../src/thumbnails.ts";
import type { CapturedThumbnail, FrameGrabber, FrameGrabRequest } from "../src/thumbnails.ts";
import {
  createHarness,
  probeResult,
  SOURCE_URL,
  StubResolver,
  variant,
  waitFor,
} from "./helpers.ts";
import type { Harness } from "./helpers.ts";

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
  const captured = await captureThumbnail({
    probe: probeWithThumbnail(url),
    guard,
    fetchImpl: createGuardedFetch(guard),
    store,
    logger,
    ...(overrides.maxBytes === undefined ? {} : { maxBytes: overrides.maxBytes }),
    ...(overrides.timeoutMs === undefined ? {} : { timeoutMs: overrides.timeoutMs }),
  });
  // `captureThumbnail` returns the bytes as well since dl-44, so the job
  // pipeline can persist them long after the store's TTL. These tests are about
  // the capture itself, so they go on reading the path they always did.
  return { path: captured?.path ?? null, store };
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

describe("the copy that goes on disk", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) await fsp.rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function storage(): Promise<Storage> {
    root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "downloader-thumb-"));
    const store = new Storage({ storageDir: root, fileRetentionHours: 6 });
    await store.init();
    return store;
  }

  test("the bytes land inside the job's own out directory, which is what the sweep deletes", async () => {
    // The whole retention design in one assertion: the path is under
    // `out/<jobId>/`, so `Storage.removeJob` and `Storage.collectGarbage` both
    // already take it and nothing new has to know when to.
    const store = await storage();
    const written = await persistThumbnail({
      storage: store,
      jobId: "job-7",
      thumbnail: { contentType: "image/gif", bytes: GIF },
    });

    expect(written).toBe(nodePath.join(store.outDir("job-7"), "preview.gif"));
    expect(await readPersistedThumbnail(store, written)).toEqual(GIF);

    await store.removeJob("job-7");
    expect(await readPersistedThumbnail(store, written)).toBeNull();
  });

  test("a path outside the storage root is refused rather than answered", async () => {
    // A row naming somewhere else was not written by this process, so "no
    // preview" would be the wrong answer — it would hide the bug. `files.ts`
    // re-confines its own recorded path at the point of use for the same reason.
    const store = await storage();
    const outside = nodePath.join(store.root, "..", "escape.gif");
    await expect(readPersistedThumbnail(store, outside)).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  test("a content type outside the allowlist is refused rather than given an extension", async () => {
    // Unreachable through `captureThumbnail`, which allowlists before storing.
    // Asserted so the two lists cannot drift into writing an unnamed file.
    const store = await storage();
    await expect(
      persistThumbnail({
        storage: store,
        jobId: "job-8",
        thumbnail: { contentType: "image/svg+xml", bytes: GIF },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
  });
});

/**
 * dl-56: a frame grabbed from the stream, for a source that names no image.
 *
 * The grab is injected here, so these are about *when* it is asked and what
 * becomes of its answer. That it really runs ffmpeg, with the context replayed
 * and bounded in time, is `engine/test/preview-frame.test.ts`; that it goes out
 * through the ffmpeg egress proxy is `frame-grab-egress.test.ts`.
 */

/** Starts `FF D8 FF`, which is all the fallback checks; decoding is ffmpeg's side. */
const FRAME = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

function spyGrab(answer: () => Promise<Buffer | null> = async () => FRAME): {
  grab: FrameGrabber;
  calls: FrameGrabRequest[];
} {
  const calls: FrameGrabRequest[] = [];
  return {
    calls,
    grab: async (request) => {
      calls.push(request);
      return await answer();
    },
  };
}

/** A ladder in no particular order, with an audio-only rung cheaper than any video. */
function ladder(): ProbeResult {
  return probeResult({
    variants: [
      variant({ id: "1080p", bitrateBps: 5_000_000 }),
      variant({ id: "audio", hasVideo: false, bitrateBps: 64_000 }),
      variant({ id: "240p", bitrateBps: 300_000 }),
    ],
  });
}

describe("the frame fallback, when the source names no image (dl-56)", () => {
  async function captureWith(
    probe: ProbeResult,
    grab: FrameGrabber,
    signal?: AbortSignal,
  ): Promise<{ captured: CapturedThumbnail | null; store: ThumbnailStore }> {
    const guard = permissiveGuard();
    const store = new ThumbnailStore();
    const captured = await captureThumbnail({
      probe,
      guard,
      fetchImpl: createGuardedFetch(guard),
      store,
      logger,
      grabFrame: grab,
      ...(signal === undefined ? {} : { signal }),
    });
    return { captured, store };
  }

  test("no image URL at all: one grab, from the cheapest rendition with video, stored as image/jpeg", async () => {
    const { grab, calls } = spyGrab();
    const probe = ladder();
    const controller = new AbortController();
    const { captured, store } = await captureWith(probe, grab, controller.signal);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.variant.id).toBe("240p");
    expect(calls[0]?.probe).toBe(probe);
    expect(calls[0]?.signal).toBe(controller.signal);

    expect(captured?.source).toBe("frame");
    expect(captured?.path).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    expect(store.get(captured?.token ?? "")).toEqual({ contentType: "image/jpeg", bytes: FRAME });
  });

  test("an image URL that loads is used, and nothing is grabbed", async () => {
    fixture = await startFixture(() => ({ contentType: "image/gif" }));
    const { grab, calls } = spyGrab();
    const { captured } = await captureWith(
      { ...ladder(), thumbnailUrl: `${fixture.origin}/og.gif` },
      grab,
    );
    expect(captured?.source).toBe("page");
    expect(calls).toEqual([]);
  });

  test("an image URL that fails to fetch stays no preview, and nothing is grabbed", async () => {
    fixture = await startFixture(() => ({ status: 404, contentType: "text/plain" }));
    const { grab, calls } = spyGrab();
    const { captured, store } = await captureWith(
      { ...ladder(), thumbnailUrl: `${fixture.origin}/gone.jpg` },
      grab,
    );
    expect(fixture.requests.map((request) => request.path)).toEqual(["/gone.jpg"]);
    expect(captured).toBeNull();
    expect(calls).toEqual([]);
    expect(store.size).toBe(0);
  });

  test("a live probe grabs nothing", async () => {
    const { grab, calls } = spyGrab();
    const { captured } = await captureWith({ ...ladder(), isLive: true }, grab);
    expect(captured).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a probe with no rendition that has video grabs nothing", async () => {
    const { grab, calls } = spyGrab();
    const { captured } = await captureWith(
      probeResult({ variants: [variant({ id: "audio", hasVideo: false })] }),
      grab,
    );
    expect(captured).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a grab that answers null, throws, or hands back a non-JPEG or an oversized one is no preview", async () => {
    const answers: (() => Promise<Buffer | null>)[] = [
      async () => null,
      async () => {
        throw new AppError("TIMEOUT");
      },
      async () => {
        throw new Error("spawn failed");
      },
      async () => GIF,
      async () => Buffer.concat([FRAME, Buffer.alloc(512 * 1024)]),
    ];
    for (const answer of answers) {
      const { grab, calls } = spyGrab(answer);
      // oxlint-disable-next-line no-await-in-loop
      const { captured, store } = await captureWith(ladder(), grab);
      expect(calls).toHaveLength(1);
      expect(captured).toBeNull();
      expect(store.size).toBe(0);
    }
  });

  describe("through the routes", () => {
    let harness: Harness | undefined;

    afterEach(async () => {
      await harness?.dispose();
      harness = undefined;
    });

    test("a grabbed frame is served by /api/thumbnail/:token as image/jpeg", async () => {
      const { grab, calls } = spyGrab();
      harness = await createHarness({ resolver: new StubResolver(ladder()), grabFrame: grab });

      const body = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        })
      ).json() as ProbeResponse;
      expect(calls).toHaveLength(1);
      expect(body.probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);

      const served = await harness.app.server.inject({
        method: "GET",
        url: body.probe.thumbnailPath ?? "",
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/jpeg");
      expect(served.rawPayload.equals(FRAME)).toBe(true);
    });

    test("a grab that throws or answers null leaves the response exactly as with no preview", async () => {
      const probe = ladder();
      const expected = probeForClient(withThumbnailPath(probe, null));
      const failing: FrameGrabber[] = [
        async () => null,
        async () => {
          throw new AppError("DOWNLOAD_FAILED");
        },
      ];
      for (const grab of failing) {
        let called = 0;
        // oxlint-disable-next-line no-await-in-loop
        harness = await createHarness({
          resolver: new StubResolver(probe),
          grabFrame: async (request) => {
            called += 1;
            return await grab(request);
          },
        });
        // oxlint-disable-next-line no-await-in-loop
        const response = await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        });
        expect(called).toBe(1);
        expect(response.statusCode).toBe(200);
        const body = response.json() as ProbeResponse;
        expect(body).toEqual({ probe: expected, cached: false });
        expect(body.probe.thumbnailPath).toBeUndefined();
        // oxlint-disable-next-line no-await-in-loop
        await harness.dispose();
        harness = undefined;
      }
    });

    test("a job's re-probe takes its preview from the grab too", async () => {
      const { grab, calls } = spyGrab();
      harness = await createHarness({ resolver: new StubResolver(ladder()), grabFrame: grab });
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      });
      const { id } = (response.json() as JobResponse).job;
      const finished = await waitFor(
        () => harness?.app.context.store.get(id) as Job,
        (job) => job.status === "completed" || job.status === "failed",
        { label: "job to finish" },
      );
      expect(finished.status).toBe("completed");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // The job's own signal, so a cancel reaches the grab's ffmpeg.
      expect(calls.at(-1)?.signal).toBeInstanceOf(AbortSignal);
      expect(finished.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    });

    test("the probe complete line says where the preview came from", async () => {
      const sources: unknown[] = [];
      const lineFor = async (probe: ProbeResult, grab: FrameGrabber): Promise<void> => {
        const raw: string[] = [];
        harness = await createHarness({
          logger: createLogger({ level: "info", write: (line) => void raw.push(line) }),
          resolver: new StubResolver(probe),
          grabFrame: grab,
        });
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        });
        const complete = raw.filter((line) => line.includes('"msg":"probe complete"'));
        expect(complete).toHaveLength(1);
        sources.push(
          (JSON.parse(complete[0] ?? "{}") as { previewSource?: unknown }).previewSource,
        );
        await harness.dispose();
        harness = undefined;
      };

      await lineFor(ladder(), async () => FRAME);
      await lineFor(ladder(), async () => null);
      fixture = await startFixture(() => ({ contentType: "image/gif" }));
      await lineFor({ ...ladder(), thumbnailUrl: `${fixture.origin}/og.gif` }, async () => FRAME);

      expect(sources).toEqual(["frame", null, "page"]);
    });
  });
});

/**
 * dl-56's open decision, answered by the owner on 2026-09-17: grabs get their
 * own server-wide cap. Measured before it existed — twelve clients probing at
 * once produced twelve concurrent ffmpeg grabs against a `maxConcurrentProbes`
 * of eight — because `probeGate` is released before the capture runs.
 */
describe("the server-wide cap on frame grabs (dl-56)", () => {
  /** A grab that parks until released, so several can be in flight at once. */
  function blockingGrab(): {
    grab: FrameGrabber;
    started: number;
    inFlight: () => number;
    release: () => void;
  } {
    let started = 0;
    let inFlight = 0;
    const waiters: (() => void)[] = [];
    return {
      get started() {
        return started;
      },
      inFlight: () => inFlight,
      release: () => {
        for (const resume of waiters.splice(0)) resume();
      },
      grab: async () => {
        started += 1;
        inFlight += 1;
        await new Promise<void>((resolve) => waiters.push(resolve));
        inFlight -= 1;
        return FRAME;
      },
    };
  }

  test("past the cap the grab is skipped rather than queued, and the inner grabber never runs", async () => {
    const inner = blockingGrab();
    const gate = new ConcurrencyGate(2);
    const limited = limitFrameGrabs(inner.grab, gate, logger);
    const probe = ladder();
    const request = {
      probe,
      variant: probe.variants[2] as NonNullable<(typeof probe.variants)[0]>,
    };

    const pending = Array.from({ length: 5 }, async () => await limited(request));
    // The two that acquired are parked inside the inner grabber; the other
    // three must already have answered null rather than be waiting for a slot.
    await waitFor(
      () => inner.inFlight(),
      (count) => count === 2,
      { label: "two grabs in flight" },
    );
    expect(gate.inFlight).toBe(2);
    inner.release();
    const results = await Promise.all(pending);

    expect(inner.started).toBe(2);
    expect(results.filter((bytes) => bytes !== null)).toHaveLength(2);
    expect(results.filter((bytes) => bytes === null)).toHaveLength(3);
    // Released on the way out, so the next probe is not refused forever.
    expect(gate.inFlight).toBe(0);
  });

  test("a slot is released even when the grab throws", async () => {
    const gate = new ConcurrencyGate(1);
    const limited = limitFrameGrabs(
      async () => {
        throw new AppError("TIMEOUT");
      },
      gate,
      logger,
    );
    const probe = ladder();
    const request = {
      probe,
      variant: probe.variants[0] as NonNullable<(typeof probe.variants)[0]>,
    };
    await expect(limited(request)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(gate.inFlight).toBe(0);
  });

  test("concurrent probes past the cap answer without a preview, and none waits for a slot", async () => {
    const inner = blockingGrab();
    const harness = await createHarness({
      resolver: new StubResolver(ladder()),
      grabFrame: inner.grab,
      config: { maxConcurrentFrameGrabs: 1 },
    });
    try {
      expect(harness.app.context.frameGrabGate.limit).toBe(1);
      const responses = Array.from({ length: 3 }, async () =>
        harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        }),
      );
      // Two of the three probes must answer while the first grab is still
      // parked. Without the cap all three would be inside the grabber.
      await waitFor(
        () => inner.inFlight(),
        (count) => count === 1,
        { label: "one grab in flight" },
      );
      inner.release();

      const bodies = (await Promise.all(responses)).map(
        (response) => (response.json() as ProbeResponse).probe.thumbnailPath,
      );
      expect(inner.started).toBe(1);
      expect(bodies.filter((path) => path !== undefined)).toHaveLength(1);
      expect(bodies.filter((path) => path === undefined)).toHaveLength(2);
      expect(harness.app.context.frameGrabGate.inFlight).toBe(0);
    } finally {
      inner.release();
      await harness.dispose();
    }
  });
});
