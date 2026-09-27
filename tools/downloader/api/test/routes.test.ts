/**
 * The HTTP surface: validation, status mapping, the probe cache, SSE framing
 * and file serving. The pipeline itself is covered in `pipeline.test.ts`.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { AppError, jobResponseSchema, parseJobEvent, ROUTES } from "@downloader/contract";
import type { JobResponse, ProbeResponse, ProbeResult } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { formatSseFrame } from "../src/routes/events.ts";
import { contentDisposition } from "../src/routes/files.ts";
import { statusForCode, toErrorResponse } from "../src/http-errors.ts";
import type { HealthResponse } from "../src/routes/health.ts";
import {
  createHarness,
  openLink,
  probeResult,
  SOURCE_URL,
  StubResolver,
  waitFor,
} from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

/** A 1×1 PNG. Real bytes, so a content-type assertion means something. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("POST /api/probe", () => {
  test("returns the probe and reports it uncached", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProbeResponse;
    expect(body.cached).toBe(false);
    expect(body.probe.variants).toHaveLength(1);
  });

  test("serves the double-click from cache, and `refresh` bypasses it", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver });

    const send = async (payload: Record<string, unknown>) =>
      (
        await (harness as Harness).app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload,
        })
      ).json() as ProbeResponse;

    expect((await send({ url: SOURCE_URL })).cached).toBe(false);
    expect((await send({ url: SOURCE_URL })).cached).toBe(true);
    expect(resolver.calls).toBe(1);

    expect((await send({ url: SOURCE_URL, refresh: true })).cached).toBe(false);
    expect(resolver.calls).toBe(2);
  });

  test("a zero TTL disables the cache entirely", async () => {
    const resolver = new StubResolver(probeResult());
    harness = await createHarness({ resolver, config: { probeCacheTtlMs: 0 } });
    for (let index = 0; index < 2; index++) {
      // oxlint-disable-next-line no-await-in-loop
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
    }
    expect(resolver.calls).toBe(2);
  });

  test("rejects a non-http URL with INVALID_URL, not a 500", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: "file:///etc/passwd" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "INVALID_URL" } });
  });

  test("a resolver's terminal verdict keeps its own status", async () => {
    harness = await createHarness({
      resolver: new StubResolver(async () => {
        throw new AppError("DRM_PROTECTED");
      }),
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });
    // 451 is the one status that means precisely this.
    expect(response.statusCode).toBe(451);
    expect(response.json()).toMatchObject({ error: { code: "DRM_PROTECTED", retryable: false } });
  });
});

describe("the preview image never lets the client name a URL", () => {
  /** A real origin on loopback, so the probe route's own `guardedFetch` runs. */
  async function imageOrigin(): Promise<{ origin: string; close: () => Promise<void> }> {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      origin: `http://127.0.0.1:${port}`,
      close: async () =>
        await new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  }

  test("the response carries our path and not the origin URL the page chose", async () => {
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const response = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });
      const body = response.json() as ProbeResponse;

      // Asserted on the body rather than by reading the code: an origin URL the
      // client is not allowed to fetch has no business reaching the client.
      expect(body.probe.thumbnailUrl).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(image.origin);
      expect(body.probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    } finally {
      await image.close();
    }
  });

  test("that path serves the bytes, typed from an allowlist and with nosniff", async () => {
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const probe = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.probe,
          payload: { url: SOURCE_URL },
        })
      ).json() as ProbeResponse;

      const served = await harness.app.server.inject({
        method: "GET",
        url: probe.probe.thumbnailPath ?? "",
      });
      expect(served.statusCode).toBe(200);
      expect(served.headers["content-type"]).toBe("image/png");
      // Without this a browser may overrule the type on a body whose first bytes
      // a hostile origin chose.
      expect(served.headers["x-content-type-options"]).toBe("nosniff");
      expect(served.rawPayload.equals(PNG)).toBe(true);
    } finally {
      await image.close();
    }
  });

  test("a cache hit hands back a token that still resolves", async () => {
    // The token is minted before the probe cache is written, so the second
    // (cached) answer carries the first answer's token. That only works while
    // the thumbnail store outlives `PROBE_CACHE_TTL_CEILING_MS`.
    const image = await imageOrigin();
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${image.origin}/og.png` })),
      });
      const send = async (): Promise<ProbeResponse> =>
        (
          await (harness as Harness).app.server.inject({
            method: "POST",
            url: ROUTES.probe,
            payload: { url: SOURCE_URL },
          })
        ).json() as ProbeResponse;

      const first = await send();
      const second = await send();
      expect(second.cached).toBe(true);
      expect(second.probe.thumbnailPath).toBe(first.probe.thumbnailPath);
      expect(
        (
          await harness.app.server.inject({
            method: "GET",
            url: second.probe.thumbnailPath ?? "",
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await image.close();
    }
  });

  test("a thumbnail on a blocked address costs the preview, not the probe", async () => {
    // A real guard, not a stub. Private addresses are refused, and only the two
    // fictional media hosts are exempted — so `169.254.169.254` is blocked on
    // its address without any DNS being consulted.
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({ thumbnailUrl: "http://169.254.169.254/latest/meta-data/" }),
      ),
      config: {
        ssrfAllowPrivateAddresses: false,
        ssrfAllowHosts: ["site.example", "cdn.example"],
      },
    });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });

    // The video is still downloadable, which is the whole point of `bestEffort`.
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProbeResponse;
    expect(body.probe.variants).toHaveLength(1);
    expect(body.probe.thumbnailPath).toBeUndefined();
    expect(body.probe.thumbnailUrl).toBeUndefined();
  });

  test("a probe with no thumbnail is unchanged", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const body = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      })
    ).json() as ProbeResponse;
    expect(body.probe.thumbnailPath).toBeUndefined();
    expect(body.probe.variants).toHaveLength(1);
  });

  test("an unknown token is THUMBNAIL_NOT_FOUND, 404 — not JOB_NOT_FOUND and not a 500", async () => {
    harness = await createHarness();
    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.thumbnail("a".repeat(43)),
    });
    expect(response.statusCode).toBe(404);
    // Its own code: this names neither a job nor a route, and reusing
    // `JOB_NOT_FOUND` would need its copy rewritten here — the tell that the
    // code is wrong.
    expect(response.json()).toMatchObject({
      error: { code: "THUMBNAIL_NOT_FOUND", retryable: false },
    });
  });
});

describe("the source's credentials never reach the client", () => {
  /**
   * `RequestContext.headers` is a live session for a third-party site — the
   * contract says "Typically Referer, Origin, User-Agent, Cookie,
   * Authorization" — and it was serialised into every probe response and every
   * `probed` frame in full. Nothing in `web/src` has ever read it.
   *
   * Every assertion here is on the **raw serialised body**. "The shape we
   * expected was emptied" and "the secret is not in the bytes" are different
   * claims and only the second is worth having: a credential that survived under
   * some other key satisfies the first.
   *
   * `probeResult()` carries `Cookie: session=super-secret` by default, so these
   * need no special fixture — which is also why the leak went unnoticed.
   */
  test("not in a fresh probe response", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });

    expect(response.body).not.toContain("super-secret");
    const body = response.json() as ProbeResponse;
    // Emptied, not removed: `headers` is required by `requestContextSchema`, so
    // the shape a client parses is unchanged and no contract edit is implied.
    expect(body.probe.requestContext.headers).toEqual({});
    // And the probe is otherwise intact, so this is not passing because the
    // response fell apart.
    expect(body.probe.variants).toHaveLength(1);
  });

  test("nor in the one served from cache, which returns before every other rewrite", async () => {
    // The seam most easily missed: this branch short-circuits above all of the
    // fresh path's rewriting.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const send = async () =>
      await (harness as Harness).app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: SOURCE_URL },
      });

    await send();
    const second = await send();

    expect((second.json() as ProbeResponse).cached).toBe(true);
    expect(second.body).not.toContain("super-secret");
    expect((second.json() as ProbeResponse).probe.requestContext.headers).toEqual({});
  });

  test("nor on the `probed` SSE frame", async () => {
    // The loopback image origin is what keeps the probe slow enough that the
    // `probed` frame is still ahead of us when we connect; without it the job
    // races past and the assertion passes for the wrong reason.
    const image = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => image.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(image.address() as AddressInfo).port}`;
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${origin}/og.png` })),
      });
      const created = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
        })
      ).json() as JobResponse;
      openLink(harness, created.job);

      const sse = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.jobEvents(created.job.id),
      });

      // Asserted first: without it, "no secret in the body" is satisfied by a
      // stream that never carried the frame at all.
      expect(sse.body).toContain('"type":"probed"');
      expect(sse.body).not.toContain("super-secret");
    } finally {
      image.closeAllConnections();
      await new Promise<void>((resolve) => image.close(() => resolve()));
    }
  });

  test("the server keeps them, because the download needs them", async () => {
    // The strip is a response-seam rewrite, not a mutation of what the server
    // holds. If it ever became the latter, every credentialed download would
    // break — quietly, since the engine would simply be refused by the CDN.
    //
    // **The fixture sets `proxyUrl` deliberately.** Without it
    // `withoutEgressProxy` takes its early return and the only server-side
    // rewrite on this path never runs, so the assertion below would pass
    // whatever that function did to `headers`. dl-29's third gate found exactly
    // that hole. With it set, this covers the operator-proxy deployment of dl-12
    // end to end: whichever layer widened a header strip, the engine is what
    // notices, and it notices here.
    const seen: string[] = [];
    harness = await createHarness({
      resolver: new StubResolver(
        probeResult({
          requestContext: {
            headers: { Referer: SOURCE_URL, Cookie: "session=super-secret" },
            proxyUrl: "http://127.0.0.1:1",
          },
        }),
      ),
      engineOptions: {
        onStream: (request) => {
          seen.push(JSON.stringify(request.requestContext.headers));
        },
      },
    });

    const posted = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;
    openLink(harness, posted.job);
    await waitFor(
      () => seen,
      (calls) => calls.length > 0,
      { label: "the engine to be handed a request" },
    );

    expect(seen[0]).toContain("super-secret");
  });
});

describe("job routes", () => {
  test("creating a job validates the body", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: "not a url" },
    });
    expect(response.statusCode).toBe(400);
  });

  test("an unknown job id is a 404", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.job("nope") });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });
});

/** Creates a job, so there is a real link token to leak. Not opened: see dl-53. */
async function createdLink(current: Harness): Promise<{ id: string; token: string }> {
  const response = (
    await current.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    })
  ).json() as JobResponse;
  const url = response.job.link?.url ?? "";
  return { id: response.job.id, token: url.slice(url.lastIndexOf("/") + 1) };
}

/**
 * There is no job list, and that is the fix rather than a gap in the tests.
 *
 * dl-23 stripped `downloadUrl` from the list because an endpoint that hands the
 * whole set out makes the token's entropy irrelevant — unguessable stops a
 * search, not a listing. What was left after that was not a capability but a
 * history: every page anyone pointed this service at, with a timestamp, a
 * title-derived filename and a media URL the contract says routinely carries a
 * signed credential. dl-32 answered who may read that with "nobody, because
 * this service cannot tell one caller from another", and removed the route.
 *
 * `GET /api/jobs/:id` stays, and the tests below are what keep that honest. The
 * trade holds because a job id is `randomUUID()` — 122 bits from a CSPRNG
 * (`routes/jobs.ts`, and the store never reassigns it) — and because that id
 * already buys the download, so the history behind it is not a further step. If
 * job ids were ever made sequential or timestamped, removing the list would have
 * moved the hole rather than closed it, and the single read would need real
 * authorisation.
 */
describe("a job list does not hand out capabilities", () => {
  test("GET /api/jobs is a route miss, with nothing supplied", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { id, token } = await createdLink(harness);
    expect(token).toHaveLength(43);

    // No id, no token, no credential of any kind — the enumeration case. The
    // query string is here because the route that used to answer read `limit`
    // and `offset`, so a handler left half-registered would answer one of these
    // and not the other.
    for (const url of [ROUTES.jobs, `${ROUTES.jobs}?limit=100&offset=0`]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await harness.app.server.inject({ method: "GET", url });

      // `NOT_FOUND` from core, which means a URL that matched no route — not
      // `JOB_NOT_FOUND`, which means a job the runner has no record of. There is
      // no job in this request to be missing, and re-wording the domain code at
      // the call site is the tell that it is the wrong one.
      expect(response.statusCode, url).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: "NOT_FOUND" } });

      // Nothing about the store it refused to read reaches the body: not the
      // capability, not the browsing history, not the media URL the contract
      // says routinely carries a signed credential of its own.
      expect(response.body, url).not.toContain(token);
      expect(response.body, url).not.toContain(id);
      expect(response.body, url).not.toContain(SOURCE_URL);
      expect(response.body, url).not.toContain("cdn.example");
      expect(response.body, url).not.toContain("video.mp4");
    }
  });

  test("the method was removed, not the path: POST /api/jobs still creates", async () => {
    // `ROUTES.jobs` carries the create route as well, so deleting the list is
    // the one edit that could plausibly take intake with it.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    });

    expect(response.statusCode).toBe(201);
    expect((response.json() as JobResponse).job.status).toBe("queued");
  });

  test("reading one job still carries it, because the app cannot work without it", async () => {
    // The guard against this cure becoming a disease. `JobCard.tsx` renders the
    // download button from `job.link` (dl-53), fed by `useJobs`'s `getJob`
    // poll — strip it there and the product stops doing the thing it is for.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { id, token } = await createdLink(harness);

    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.job(id) });
    expect(response.statusCode).toBe(200);
    const body = response.json() as JobResponse;
    expect(body.job.link?.url).toBe(ROUTES.file(token));
    expect(jobResponseSchema.safeParse(body).success).toBe(true);

    // And what makes the negative assertions in the first test mean something.
    // Each of those strings is absent from a 404 body; here is the same job
    // proving every one of them is a string this stack really does emit, so
    // `not.toContain` is measuring a redaction rather than a typo.
    expect(response.body).toContain(token);
    expect(response.body).toContain(id);
    expect(response.body).toContain(SOURCE_URL);
    expect(response.body).toContain("site.example");
  });

  test("a job id is not guessable, which is what makes the trade sound", async () => {
    // With the list gone the id is the whole of what stands in front of a job.
    // If this ever fails, `GET /api/jobs/:id` needs real authorisation and the
    // reasoning at the top of this block stops holding.
    // dl-51's per-client cap is a different concern from this test's — every
    // job here comes from the same simulated address and nothing waits for
    // one to finish before the next is created, so it is disabled rather than
    // sized around.
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { maxJobsPerClient: 0 },
    });
    const ids = new Set<string>();
    for (let index = 0; index < 5; index++) {
      // oxlint-disable-next-line no-await-in-loop
      const created = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
        })
      ).json() as JobResponse;
      ids.add(created.job.id);
      // RFC 4122 v4, variant 10xx: 122 bits from a CSPRNG.
      expect(created.job.id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u,
      );
    }
    expect(ids.size).toBe(5);
  });
});

describe("GET /api/health", () => {
  test("reports the resolver chain and queue depth", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(200);
    const body = response.json() as HealthResponse;
    expect(body.ok).toBe(true);
    expect(body.resolvers).toContain("stub");
    expect(body.jobs.maxConcurrent).toBe(2);
  });

  test("reports the tiers, the volume and the version an operator has to ask about", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const body = (
      await harness.app.server.inject({ method: "GET", url: ROUTES.health })
    ).json() as HealthResponse;

    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    // The harness disables both tiers, which must read as disabled rather than
    // as broken — "off" and "missing" are different operational answers.
    expect(body.ytdlp).toEqual({ enabled: false, available: false, path: null });
    expect(body.browser.enabled).toBe(false);
    expect(body.storage.dir).toBe(harness.storageRoot);
    // `statfs` answers on both CI platforms; null is the documented fallback.
    expect(body.storage.freeBytes === null || body.storage.freeBytes > 0).toBe(true);
  });

  test("a configured ffmpeg that is not actually there is 503, not a green light", async () => {
    // The failure this catches: `ffmpeg-static` hands out a confident path
    // inside node_modules whether or not its postinstall download ran, so a
    // container built with --omit=optional passes every other check and then
    // fails every single job.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    (harness.engine.config as { ffmpegPath: string }).ffmpegPath = path.join(
      harness.storageRoot,
      "no-such-ffmpeg",
    );

    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(503);
    const body = response.json() as HealthResponse;
    expect(body.ok).toBe(false);
    expect(body.ffmpeg.available).toBe(false);
  });
});

/** Creates a job and returns its id and its single-use link. */
async function link(current: Harness): Promise<{ id: string; url: string }> {
  const response = (
    await current.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    })
  ).json() as JobResponse;
  return { id: response.job.id, url: response.job.link?.url ?? "" };
}

describe("the link route (dl-53)", () => {
  test("a malformed token is rejected on shape before a database lookup", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.file("short") });
    expect(response.statusCode).toBe(404);
  });

  test("a used link is 410 Gone, not 404", async () => {
    // The distinction matters to a user staring at a link that worked a moment ago.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { url } = await link(harness);
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(200);
    const again = await harness.app.server.inject({ method: "GET", url });
    expect(again.statusCode).toBe(410);
    expect(again.json()).toMatchObject({ error: { code: "FILE_EXPIRED" } });
  });

  test("past its fifteen minutes an unopened link is 410, and its job canceled as expired", async () => {
    let clock = new Date("2026-09-27T10:00:00.000Z");
    harness = await createHarness({ resolver: new StubResolver(probeResult()), now: () => clock });
    const { id, url } = await link(harness);
    clock = new Date(clock.getTime() + 15 * 60_000 + 1);

    const response = await harness.app.server.inject({ method: "GET", url });
    expect(response.statusCode).toBe(410);
    expect(response.json()).toMatchObject({ error: { code: "FILE_EXPIRED" } });
    const job = harness.app.context.store.get(id);
    expect(job.status).toBe("canceled");
    expect(job.error).toMatchObject({ code: "JOB_CANCELED", details: { reason: "link-expired" } });
    expect(job.link).toBeNull();
    expect(harness.engine.calls).toBe(0);
  });

  test("a HEAD does not spend the link", async () => {
    // Fastify would answer a HEAD by running the GET handler, which would start
    // a download nobody reads and leave the visitor holding a spent link.
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { url } = await link(harness);
    const head = await harness.app.server.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(404);
    expect(harness.engine.calls).toBe(0);
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(200);
  });

  test("an unopened link canceled from the card is withdrawn with its job", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const { id, url } = await link(harness);
    const canceled = await harness.app.server.inject({ method: "POST", url: ROUTES.cancelJob(id) });
    expect((canceled.json() as JobResponse).job).toMatchObject({
      status: "canceled",
      link: null,
      error: { code: "JOB_CANCELED", details: { reason: "requested" } },
    });
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(410);
    expect(harness.engine.calls).toBe(0);
  });
});

describe("SSE", () => {
  test("streams the job to completion and ends on the terminal frame", async () => {
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { emitProgress: true },
    });
    const created = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;
    openLink(harness, created.job);

    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents(created.job.id),
    });

    expect(response.headers["content-type"]).toContain("text/event-stream");
    // Nginx buffers proxied responses by default, which would hold every frame
    // until the download finished.
    expect(response.headers["x-accel-buffering"]).toBe("no");

    const events = response.body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => parseJobEvent(chunk.slice("data: ".length)));

    // Every frame validates against the shared schema — the union is emitted
    // verbatim, with no envelope.
    expect(events.every((event) => event !== null)).toBe(true);
    expect(events.at(-1)?.type).toBe("completed");
  });

  test("the `probed` frame carries our path and not the origin URL", async () => {
    // **The second door.** This frame ships a whole `ProbeResult` to the client,
    // so rewriting only `POST /api/probe`'s body — which is all Done-when 5 asks
    // for — would have let the origin URL out by the other route. Asserted on
    // the raw frame text, not on a parsed field: "the shape we expected was
    // rewritten" and "the address is not in the bytes" are different claims and
    // only the second is the one worth having.
    const image = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(PNG);
    });
    await new Promise<void>((resolve) => image.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${(image.address() as AddressInfo).port}`;
    try {
      harness = await createHarness({
        resolver: new StubResolver(probeResult({ thumbnailUrl: `${origin}/og.png` })),
      });
      const created = (
        await harness.app.server.inject({
          method: "POST",
          url: ROUTES.jobs,
          payload: { url: SOURCE_URL },
        })
      ).json() as JobResponse;
      openLink(harness, created.job);

      const response = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.jobEvents(created.job.id),
      });

      expect(response.body).not.toContain(origin);
      const probed = response.body
        .split("\n\n")
        .filter((chunk) => chunk.startsWith("data: "))
        .map((chunk) => parseJobEvent(chunk.slice("data: ".length)))
        .find((event) => event?.type === "probed");

      // Present, so this is not passing because no frame was emitted.
      expect(probed).toBeDefined();
      const probe = (probed as { probe: ProbeResult }).probe;
      expect(probe.thumbnailUrl).toBeUndefined();
      expect(probe.thumbnailPath).toMatch(/^\/api\/thumbnail\/[A-Za-z0-9_-]+$/u);
    } finally {
      image.closeAllConnections();
      await new Promise<void>((resolve) => image.close(() => resolve()));
    }
  });

  test("a job that finished before the client connected still gets its result", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const created = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;
    openLink(harness, created.job);
    await waitFor(
      () => (harness as Harness).app.context.store.get(created.job.id),
      (job) => job.status === "completed",
      { label: "job to complete" },
    );

    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents(created.job.id),
    });
    const types = response.body
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data: "))
      .map((chunk) => parseJobEvent(chunk.slice("data: ".length))?.type);
    // Not left staring at `queued` waiting for an event that will never come.
    expect(types).toContain("completed");
  });

  test("events for an unknown job are a JSON 404, not an empty stream", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    const response = await harness.app.server.inject({
      method: "GET",
      url: ROUTES.jobEvents("nope"),
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });
});

describe("pure helpers", () => {
  test("formatSseFrame emits one JSON object terminated by a blank line", () => {
    const frame = formatSseFrame({ type: "heartbeat", at: "2026-08-06T10:00:00.000Z" });
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(parseJobEvent(frame.slice(6).trim())?.type).toBe("heartbeat");
  });

  test("contentDisposition survives a hostile filename", () => {
    const header = contentDisposition('e"vil\r\n.mp4');
    expect(header.startsWith("attachment;")).toBe(true);
    // No raw CR/LF, or the filename would inject a header.
    expect(header).not.toMatch(/[\r\n]/u);
  });
});

describe("error mapping", () => {
  test("client and source problems are 4xx; only our own failures are 5xx", () => {
    expect(statusForCode("INVALID_URL")).toBe(400);
    expect(statusForCode("DRM_PROTECTED")).toBe(451);
    expect(statusForCode("NO_MEDIA_FOUND")).toBe(422);
    expect(statusForCode("AGE_CONFIRMATION_REQUIRED")).toBe(422);
    expect(statusForCode("RATE_LIMITED")).toBe(429);
    expect(statusForCode("SIZE_LIMIT_EXCEEDED")).toBe(413);
    expect(statusForCode("FILE_EXPIRED")).toBe(410);
    expect(statusForCode("INTERNAL")).toBe(500);
    expect(statusForCode("DISK_FULL")).toBe(507);
  });

  test("internal details never cross the wire", () => {
    const { status, body } = toErrorResponse(
      new AppError("INTERNAL", "ENOENT: /home/deploy/storage/tmp/secret", {
        details: { stderr: "ffmpeg said something with /paths in it", status: 500 },
      }),
    );
    expect(status).toBe(500);
    // The message is replaced with the taxonomy's safe copy...
    expect(body.error.message).not.toContain("/home/deploy");
    // ...and only allowlisted detail keys survive.
    expect(body.error.details).toEqual({ status: 500 });
  });

  test("a non-AppError becomes INTERNAL rather than leaking a stack", () => {
    const { status, body } = toErrorResponse(new TypeError("x.y is not a function"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("is not a function");
  });

  /**
   * dl-66. Fastify's own content-type parser rejects a body it cannot parse
   * before any route handler runs, and the error it throws carries a
   * `statusCode` rather than being an `AppError` — `AppError.from` used to
   * turn that into `INTERNAL`, reporting a client's malformed request as a
   * server fault.
   */
  test("an unparsed Fastify body error becomes BAD_REQUEST, not INTERNAL", () => {
    expect(statusForCode("BAD_REQUEST")).toBe(400);

    const fastifyError = Object.assign(
      new Error("Body cannot be empty when content-type is set to 'application/json'"),
      { statusCode: 400, code: "FST_ERR_CTP_EMPTY_JSON_BODY" },
    );
    const { status, body } = toErrorResponse(fastifyError);
    expect(status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
    // The safe catalog message, never Fastify's own — consistent with how
    // INTERNAL is handled above.
    expect(body.error.message).not.toContain("content-type");
  });

  test("a Fastify-shaped 5xx statusCode still becomes INTERNAL", () => {
    const fastifyError = Object.assign(new Error("boom"), { statusCode: 500 });
    const { status, body } = toErrorResponse(fastifyError);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
  });
});

/**
 * dl-66's own reproduction, through the real Fastify pipeline rather than a
 * mock error shape — closing the gap the ticket's `Done when` names directly.
 */
describe("a request Fastify itself refuses is BAD_REQUEST, not INTERNAL", () => {
  // Reuses the file-level `harness` and its top-level `afterEach` disposal —
  // a second declaration here would shadow it. `createLogger` is loaded
  // dynamically rather than added to this file's top-of-file imports: a new
  // static import there shifts every later line number, which is exactly what
  // `dl-32-the-job-list-has-no-caller.md`'s gate record resolves its own
  // citations into this file against.
  test("POST .../cancel with an empty declared-JSON body: 400, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.cancelJob("does-not-exist"),
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    // The log line's own `code` field, not just the response body's — a
    // second, independent `AppError.from` in `registerErrorHandling` used to
    // leave this at `INTERNAL` while the response above already said
    // `BAD_REQUEST` (dl-66).
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });

  test("POST /api/jobs with malformed JSON: 400, logged at info", async () => {
    const { createLogger } = await import("../src/logger.ts");
    const raw: string[] = [];
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      headers: { "content-type": "application/json" },
      payload: "{not valid json",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect(raw.some((line) => line.includes('"msg":"request failed"'))).toBe(false);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('"level":"info"');
    expect(rejected[0]).toContain('"code":"BAD_REQUEST"');
  });
});
