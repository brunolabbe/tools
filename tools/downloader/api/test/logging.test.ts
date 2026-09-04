/**
 * The logger and the request-id correlation it exists to serve.
 *
 * Two things are worth testing here and nothing else is. The first is
 * redaction: a captured `RequestContext` carries a live session cookie, and a
 * redactor that silently stops working is indistinguishable from one that
 * works until the day someone reads the logs. The second is correlation — the
 * point of the request id is that one line ties an HTTP call to a job that
 * fails minutes later on a queue worker, so that line is asserted directly.
 */

import { REDACTED, ROUTES } from "@downloader/contract";
import type { Job, JobResponse, RequestContext } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";
import { createFixtureCertificate } from "./helpers/tls-origin.ts";
import type { FixtureCertificate } from "./helpers/tls-origin.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";
import { redactLoggedUrl, requestIdFrom } from "../src/request-log.ts";

interface Line {
  level: string;
  time: string;
  msg: string;
  [key: string]: unknown;
}

/** A logger writing into an array, so assertions read the real serialised line. */
function capturing(level: "debug" | "info" = "debug"): { logger: AppLogger; lines: Line[] } {
  const lines: Line[] = [];
  const logger = createLogger({
    level,
    write: (line) => {
      lines.push(JSON.parse(line) as Line);
    },
  });
  return { logger, lines };
}

const CREDENTIALED: RequestContext = {
  headers: {
    Cookie: "session=super-secret",
    Authorization: "Bearer super-secret",
    Referer: "https://example.com/watch",
  },
};

describe("the logger", () => {
  test("writes one JSON line per call, with a string level and an ISO timestamp", () => {
    const { logger, lines } = capturing();
    logger.info("hello", { answer: 42 });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe("info");
    expect(lines[0]?.msg).toBe("hello");
    expect(lines[0]?.answer).toBe(42);
    // ISO rather than epoch ms: these logs are read raw far more than piped.
    expect(String(lines[0]?.time)).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
  });

  test("drops lines below the configured level", () => {
    const { logger, lines } = capturing("info");
    logger.debug("invisible");
    logger.warn("visible");

    expect(lines.map((line) => line.msg)).toEqual(["visible"]);
  });

  test("silent writes nothing at all", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "silent", write: (line) => void lines.push(line) });
    logger.error("not even errors");

    expect(lines).toEqual([]);
  });

  test("child bindings are stamped on every line, and compose", () => {
    const { logger, lines } = capturing();
    const job = logger.child({ jobId: "job-1" }).child({ requestId: "req-1" });
    job.info("working");

    expect(lines[0]?.jobId).toBe("job-1");
    expect(lines[0]?.requestId).toBe("req-1");
  });

  test("redacts a RequestContext's credentials but keeps the rest", () => {
    const { logger, lines } = capturing();
    logger.info("probed", { requestContext: CREDENTIALED });

    const context = lines[0]?.["requestContext"] as { headers: Record<string, string> };
    expect(context.headers["Cookie"]).toBe("[redacted]");
    expect(context.headers["Authorization"]).toBe("[redacted]");
    // Referer is the header that makes replay work; redacting it would make
    // the log useless for the failure it is most often read for.
    expect(context.headers["Referer"]).toBe("https://example.com/watch");
    expect(JSON.stringify(lines[0])).not.toContain("super-secret");
  });

  test("redacts a header bag that arrived under some other name", () => {
    const { logger, lines } = capturing();
    // The structural pass only recognises `requestContext`. This is what the
    // second layer, pino's own redact paths, is for.
    logger.info("upstream", { headers: { cookie: "session=super-secret" } });

    expect(JSON.stringify(lines[0])).not.toContain("super-secret");
  });

  test("the path layer is case-sensitive, which is what bounds it — not nesting", () => {
    // The obvious guess is that pino's `*.headers.cookie` fails on depth. It does
    // not: three levels deep is fine as long as the segment names match exactly.
    const lower = capturing();
    lower.logger.info("upstream", { any: { headers: { cookie: "session=super-secret" } } });
    expect(JSON.stringify(lower.lines[0])).not.toContain("super-secret");

    // What it cannot do is match HTTP casing, which is exactly what a
    // `RequestContext` carries — see `contract/src/media.ts:121`. Not at depth
    // three, and not at depth two either, so this is about the name and nothing
    // else. `safeFields` is what covers the real shape; this layer never did.
    const upper = capturing();
    upper.logger.info("upstream", { any: { headers: { Cookie: "session=super-secret" } } });
    expect(JSON.stringify(upper.lines[0])).toContain("super-secret");
  });

  test("known limitation: a RequestContext nested under another key is not redacted", () => {
    // **This test asserts the gap, on purpose.** `safeFields` matches the literal
    // key `requestContext` at the top level of `fields` and nowhere else, and
    // `REDACT_PATHS` cannot help because the keys are HTTP-cased. Every call site
    // in the tool passes it at the top level, so nothing leaks today.
    //
    // It is pinned rather than left implicit so that widening `safeFields` — the
    // right fix if a call site ever needs to nest — turns this red and sends
    // whoever did it to the caveat in `logger.ts` that this documents.
    const nested = capturing();
    nested.logger.info("probed", { details: { requestContext: CREDENTIALED } });
    expect(JSON.stringify(nested.lines[0])).toContain("super-secret");

    const inArray = capturing();
    inArray.logger.info("probed", { items: [CREDENTIALED] });
    expect(JSON.stringify(inArray.lines[0])).toContain("super-secret");

    // The same context at the top level *is* redacted, so the two assertions
    // above are about position and not about the fixture.
    const top = capturing();
    top.logger.info("probed", { requestContext: CREDENTIALED });
    expect(JSON.stringify(top.lines[0])).not.toContain("super-secret");
  });

  test("a field that will not serialise does not take the process down", () => {
    const { logger, lines } = capturing();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() =>
      logger.error("boom", {
        cyclic,
        big: 1n,
        hostile: {
          get exploding(): never {
            throw new Error("nope");
          },
        },
      }),
    ).not.toThrow();

    // The message is what the line was written for; it survives regardless.
    expect(lines[0]?.msg).toBe("boom");
    expect(lines[0]?.["fieldsDropped"]).toBe(true);
  });
});

describe("request ids", () => {
  test("an inbound X-Request-Id is honoured so a trace survives the hop", () => {
    expect(requestIdFrom({ headers: { "x-request-id": "trace-abc.123" } })).toBe("trace-abc.123");
  });

  test("a hostile or oversized id is replaced rather than logged", () => {
    // Echoed in a response header and written to every log line, so an
    // unbounded client-controlled string is header injection plus log bloat.
    const injected = requestIdFrom({ headers: { "x-request-id": "abc\r\nX-Evil: 1" } });
    expect(injected).not.toContain("\r");
    expect(injected).toMatch(/^[\w-]{36}$/u);

    const long = requestIdFrom({ headers: { "x-request-id": "a".repeat(200) } });
    expect(long).toHaveLength(36);
  });

  test("a missing id becomes a fresh uuid", () => {
    expect(requestIdFrom({ headers: {} })).not.toBe(requestIdFrom({ headers: {} }));
  });
});

describe("correlation, end to end", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("the id is echoed back, and the job it created carries it to the worker", async () => {
    const { logger, lines } = capturing();
    harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      logger,
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      headers: { "x-request-id": "req-under-test" },
      payload: { url: SOURCE_URL },
    });
    expect(response.statusCode).toBe(201);
    // Quotable by a user reporting a failure.
    expect(response.headers["x-request-id"]).toBe("req-under-test");

    const job = (response.json() as JobResponse).job;
    await waitFor(
      () => harness?.app.context.store.get(job.id) as Job,
      (current) => current.status === "completed" || current.status === "failed",
      { label: "job to finish" },
    );

    const correlated = lines.filter((line) => line["requestId"] === "req-under-test");
    // The acceptance line ties the two ids together...
    expect(correlated.some((line) => line.msg === "job accepted" && line["jobId"] === job.id)).toBe(
      true,
    );
    // ...and the orchestrator's own lines, written after the response was
    // sent, still carry both.
    expect(
      correlated.filter((line) => line["jobId"] === job.id && line.msg !== "job accepted").length,
    ).toBeGreaterThan(0);
  });

  /**
   * The two lines that carry a whole `RequestContext`, driven end to end.
   *
   * These assert on the **raw serialised string**, not on a parsed field. That
   * is the difference between "the shape we expected was redacted" and "the
   * secret is not in the bytes", and only the second is the property worth
   * having — a credential that escaped under some other key would satisfy the
   * first and fail the second.
   *
   * dl-29 is why they exist. The redaction predates it and is not its work, but
   * this branch made those exact headers newly load-bearing as an *outbound*
   * credential: `captureThumbnail` replays them to a page-chosen origin. A
   * redaction protecting them was being carried by `safeFields` alone, with
   * nothing pinning it at either call site.
   */
  test("a session cookie in a probe's context never reaches the probe route's log line", async () => {
    const raw: string[] = [];
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
      resolver: new StubResolver(probeResult({ requestContext: CREDENTIALED })),
    });

    await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: SOURCE_URL },
    });

    // Not one line, anywhere, at any level.
    expect(raw.filter((line) => line.includes("super-secret"))).toEqual([]);
    // And the line that carries the context is present and redacted, so this is
    // not passing because nothing was logged at all.
    const complete = raw.filter((line) => line.includes('"msg":"probe complete"'));
    expect(complete).toHaveLength(1);
    expect(complete[0]).toContain(REDACTED);
    // The non-secret header survives: redaction, not deletion.
    expect(complete[0]).toContain("https://example.com/watch");
  });

  test("nor the orchestrator's, whose re-probe fetches the preview with those headers", async () => {
    const raw: string[] = [];
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
      resolver: new StubResolver(probeResult({ requestContext: CREDENTIALED })),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    });
    const job = (response.json() as JobResponse).job;
    await waitFor(
      () => harness?.app.context.store.get(job.id) as Job,
      (current) => current.status === "completed" || current.status === "failed",
      { label: "job to finish" },
    );

    expect(raw.filter((line) => line.includes("super-secret"))).toEqual([]);
    const reprobe = raw.filter((line) => line.includes('"msg":"re-probe complete"'));
    expect(reprobe.length).toBeGreaterThan(0);
    expect(reprobe[0]).toContain(REDACTED);
  });

  test("the health check is logged at debug, so a liveness probe cannot bury the log", async () => {
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger });

    await harness.app.server.inject({ method: "GET", url: ROUTES.health });

    expect(lines.filter((line) => line.msg === "request")).toEqual([]);
  });
});

/**
 * dl-21, rewritten by dl-27. The property is unchanged and it is the reason
 * these exist: **there is always exactly one of these lines**, so a deployment
 * is either told that nothing is verified or told how the verification is
 * achieved, and is never left to infer a guarantee from silence.
 *
 * What changed is which fact is surprising. Until dl-27 the line said the
 * segments were not covered, because they were not. They are now — the egress
 * proxy terminates ffmpeg's TLS and verifies each origin itself — and the fact
 * an operator will not otherwise have is the shape of that: dl-14 chose a
 * tunnel so ffmpeg would see the origin's own certificate, and this reverses it.
 */
describe("what boot says about how far TLS verification reaches", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("a verifying deployment is told the proxy is what verifies, and what that costs", async () => {
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger });

    const warnings = lines.filter((line) => line.level === "warn");
    const terminating = warnings.filter((line) => /terminates TLS/u.test(line.msg));
    expect(terminating).toHaveLength(1);
    // Both halves of it. An operator who reads only "we verify the segments"
    // has not been told that every media byte now crosses this process in the
    // clear, which is the half dl-14 chose the other way round.
    expect(terminating[0]?.msg).toMatch(/segment origin/u);
    expect(String(terminating[0]?.["hint"])).toMatch(/plaintext/u);
    // And not both lines at once, which would say two contradictory things.
    expect(warnings.some((line) => /FFMPEG_ALLOW_UNVERIFIED_TLS/u.test(line.msg))).toBe(false);
  });

  test("the proxy that ffmpeg gets is the terminating one, and the tiers' is not", async () => {
    // The two are told apart nowhere else: pointing Chromium at the terminating
    // proxy would break every HTTPS page it loads, and pointing ffmpeg at the
    // tunnelling one silently restores dl-21's hole with every test still green.
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger });

    const configured = lines.filter((line) => line.msg === "egress configured");
    expect(configured).toHaveLength(1);
    expect(configured[0]?.["ffmpegProxyTls"]).toBe("terminate");
    // Two proxies, and ffmpeg is not on the tiers' one.
    expect(harness.app.context.ffmpegProxyUrl).not.toBe(harness.app.context.egressProxyUrl);
  });

  test("FFMPEG_TLS_INTERCEPT=false puts ffmpeg back on the tiers' proxy, and says so", async () => {
    // The third operator state. **Its own line, not a quieter version of the
    // other two**: it is narrower than `FFMPEG_ALLOW_UNVERIFIED_TLS` and it is
    // not free, and an operator who reads "interception off" without reading
    // "the segments are unverified" has kept something they did not.
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger, config: { ffmpegTlsIntercept: false } });

    const warnings = lines.filter((line) => line.level === "warn");
    const off = warnings.filter((line) => /FFMPEG_TLS_INTERCEPT is off/u.test(line.msg));
    expect(off).toHaveLength(1);
    expect(off[0]?.msg).toMatch(/not checked at all/u);
    // The cost, in the operator's own terms rather than as a reference.
    expect(String(off[0]?.["hint"])).toMatch(/substitute/u);
    expect(String(off[0]?.["hint"])).toMatch(/dl-21/u);

    // Still exactly one line about how far verification reaches.
    expect(warnings.some((line) => /terminates TLS/u.test(line.msg))).toBe(false);
    expect(warnings.some((line) => /FFMPEG_ALLOW_UNVERIFIED_TLS/u.test(line.msg))).toBe(false);

    // And there is genuinely no second proxy — the same tunnel serves both,
    // rather than an identical listener started to no end.
    const configured = lines.filter((line) => line.msg === "egress configured");
    expect(configured[0]?.["ffmpegProxyTls"]).toBe("tunnel");
    expect(harness.app.context.ffmpegProxyUrl).toBe(harness.app.context.egressProxyUrl);
  });

  test("turning verification off outranks the interception knob", async () => {
    // Both knobs at once is a state an operator can reach, and it must not
    // produce two lines saying different-sized things about the same deployment.
    // `FFMPEG_ALLOW_UNVERIFIED_TLS` is the larger fact and wins.
    const { logger, lines } = capturing("info");
    harness = await createHarness({
      logger,
      config: { ffmpegAllowUnverifiedTls: true, ffmpegTlsIntercept: false },
    });

    const warnings = lines.filter((line) => line.level === "warn");
    expect(warnings.filter((line) => /FFMPEG_ALLOW_UNVERIFIED_TLS/u.test(line.msg))).toHaveLength(
      1,
    );
    expect(warnings.some((line) => /FFMPEG_TLS_INTERCEPT is off/u.test(line.msg))).toBe(false);
  });

  test("a deployment with verification off gets dl-19's louder line instead", async () => {
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger, config: { ffmpegAllowUnverifiedTls: true } });

    const warnings = lines.filter((line) => line.level === "warn");
    expect(warnings.filter((line) => /FFMPEG_ALLOW_UNVERIFIED_TLS/u.test(line.msg))).toHaveLength(
      1,
    );
    // Telling a deployment that verifies nothing at all how its verification
    // works would read as a guarantee it does not have.
    expect(warnings.some((line) => /terminates TLS/u.test(line.msg))).toBe(false);
  });
});

/**
 * dl-34, step 3. Same property as the block above and a different axis of it:
 * an operator who set a trust anchor is told **which halves of the pipeline it
 * reaches**, at boot rather than at the first failed probe.
 *
 * It is worth a line because the documentation said the opposite until this
 * commit — `.env.example` and `01-ARCHITECTURE.md` both claimed that everything
 * meeting an origin is given it. Two things are not, and they are the two that
 * load the page.
 */
describe("what boot says about how far the operator's CA reaches", () => {
  let harness: Harness | undefined;
  let certificate: FixtureCertificate | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
    await certificate?.cleanup();
    certificate = undefined;
  });

  async function bootWithCa(config: Record<string, unknown> = {}): Promise<{ lines: Line[] }> {
    certificate = await createFixtureCertificate({ ipAddresses: ["127.0.0.1"] });
    const { logger, lines } = capturing("info");
    harness = await createHarness({
      logger,
      config: { egressCaFile: certificate.caPath, ...config },
    });
    return { lines };
  }

  test("names the tiers it does not reach, and what it does", async () => {
    const { lines } = await bootWithCa();

    const warnings = lines.filter((line) => line.level === "warn");
    const reach = warnings.filter((line) => /does not reach the browser or yt-dlp/u.test(line.msg));
    expect(reach).toHaveLength(1);
    // The variable by the name the operator actually typed, so a deployment on
    // the deprecated spelling is not told about one it never set.
    expect(reach[0]?.msg).toMatch(/^EGRESS_CA_FILE/u);
    expect(reach[0]?.["doesNotReach"]).toEqual(["chromium", "yt-dlp"]);
    // And the half that is working, so the line reads as a boundary rather
    // than as "your setting does nothing".
    expect(String(reach[0]?.["reaches"])).toMatch(/ffmpeg/u);
    expect(String(reach[0]?.["hint"])).toMatch(/TLS_VERIFICATION_FAILED/u);
  });

  test("says ffmpeg is reached through the proxy, or directly, whichever it is", async () => {
    // The two arrangements dl-27 leaves, and the line has to be true in both:
    // with interception on, the operator's root goes to the proxy that verifies
    // for ffmpeg; with it off, it goes to ffmpeg's own `-ca_file`.
    const intercepting = await bootWithCa();
    expect(
      String(
        intercepting.lines.find((line) => /does not reach the browser/u.test(line.msg))?.[
          "reaches"
        ],
      ),
    ).toMatch(/egress proxy/u);

    await harness?.dispose();
    harness = undefined;
    await certificate?.cleanup();

    const tunnelling = await bootWithCa({ ffmpegTlsIntercept: false });
    expect(
      String(
        tunnelling.lines.find((line) => /does not reach the browser/u.test(line.msg))?.["reaches"],
      ),
    ).toMatch(/-ca_file/u);
  });

  test("the deprecated spelling is the one echoed back", async () => {
    const { lines } = await bootWithCa({ egressCaFileVar: "FFMPEG_CA_FILE" });

    const reach = lines.filter((line) => /does not reach the browser or yt-dlp/u.test(line.msg));
    expect(reach).toHaveLength(1);
    expect(reach[0]?.msg).toMatch(/^FFMPEG_CA_FILE/u);
  });

  test("an operator who set nothing is not told about a setting they do not have", async () => {
    // The line is targeted, not a standing disclaimer: without a CA file there
    // is no expectation to correct, and a per-boot warning about an unused
    // variable is how the other four lines in this file lose their audience.
    const { logger, lines } = capturing("info");
    harness = await createHarness({ logger });

    expect(lines.some((line) => /does not reach the browser or yt-dlp/u.test(line.msg))).toBe(
      false,
    );
  });
});

/** Runs a job to completion and returns the link and its bare token. */
async function issuedToken(current: Harness): Promise<{ url: string; token: string }> {
  const created = (
    await current.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    })
  ).json() as JobResponse;
  const finished = await waitFor(
    () => current.app.context.store.get(created.job.id),
    (job) => job.status === "completed" || job.status === "failed",
    { label: "job to finish" },
  );
  const url = finished.result?.downloadUrl ?? "";
  return { url, token: url.slice(url.lastIndexOf("/") + 1) };
}

/**
 * A file token is a credential, and it travels in the *path*.
 *
 * `/api/files/:token` is the only URL in this service whose path segment is a
 * secret rather than an identifier — `jobs/tokens.ts` says so outright: the
 * token *is* the authorisation, and job ids deliberately are not. Two hooks log
 * `request.url` for every route: the `onResponse` line in `request-log.ts` and
 * the error handler in `server.ts`. Both wrote the token verbatim until dl-23.
 *
 * These tests exist to go red if either call site loses `redactLoggedUrl`, and
 * the last one exists so the cure is not worse than the disease — a redactor
 * that flattened every URL would take the diagnostic value of the request log
 * with it.
 */
describe("a file token never reaches a log line", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("not when the file is served, and not when the request is refused", async () => {
    // One test covering both call sites: a 200 goes through the `onResponse`
    // hook only, and the 429 behind it goes through the error handler as well.
    const { logger, lines } = capturing();
    harness = await createHarness({
      logger,
      resolver: new StubResolver(probeResult()),
      config: { rateLimitFilesPerMinute: 1 },
    });

    const { url, token } = await issuedToken(harness);
    expect(token).toHaveLength(43);

    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(200);
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(429);

    const serialised = lines.map((line) => JSON.stringify(line));
    // The lines are genuinely there — otherwise this passes by logging nothing.
    expect(serialised.filter((line) => line.includes("/api/files/")).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(serialised.filter((line) => line.includes(token))).toEqual([]);

    const served = lines.find((line) => line.msg === "request" && line.status === 200);
    expect(served?.url).toBe(`/api/files/${REDACTED}`);
    const refused = lines.find((line) => line.msg === "request rejected");
    expect(refused?.url).toBe(`/api/files/${REDACTED}`);
  });

  test("nor when the link has expired, which is the ordinary 410", async () => {
    // The pre-existing error paths on this route, which leaked the token long
    // before there was a rate limiter on it.
    const { logger, lines } = capturing();
    harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });

    const { url, token } = await issuedToken(harness);
    const record = harness.app.context.store.findToken(token);
    harness.app.context.store.deleteToken(token);
    harness.app.context.store.saveToken({ ...record!, expiresAt: "2020-01-01T00:00:00.000Z" });

    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(410);
    expect(lines.map((line) => JSON.stringify(line)).filter((l) => l.includes(token))).toEqual([]);
  });

  test("but every other URL is logged exactly as it arrived", async () => {
    // The failure mode of the cure. `redactUrl` from core would have produced
    // `[unparsable-url]` for all of these, since it parses an absolute URL and
    // redacts the query string — the wrong half of the wrong shape.
    const { logger, lines } = capturing();
    harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });

    const created = (
      await harness.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;
    await harness.app.server.inject({ method: "GET", url: `${ROUTES.jobs}?limit=5` });
    await harness.app.server.inject({ method: "GET", url: ROUTES.job(created.job.id) });

    const urls = lines.filter((line) => line.msg === "request").map((line) => line.url);
    expect(urls).toContain(ROUTES.jobs);
    // The query string is diagnostic here, not a credential, and it survives.
    expect(urls).toContain(`${ROUTES.jobs}?limit=5`);
    // A job id is an identifier the client already holds; it is not redacted,
    // and the request log would be useless if it were.
    expect(urls).toContain(ROUTES.job(created.job.id));
  });
});

describe("redactLoggedUrl", () => {
  test("replaces the capability segment and nothing else", () => {
    expect(redactLoggedUrl(ROUTES.file("abc"))).toBe(`/api/files/${REDACTED}`);
    expect(redactLoggedUrl(`${ROUTES.file("abc")}?x=1`)).toBe(`/api/files/${REDACTED}?x=1`);
    expect(redactLoggedUrl(`${ROUTES.file("abc")}/extra`)).toBe(`/api/files/${REDACTED}/extra`);
  });

  test("leaves identifiers alone", () => {
    expect(redactLoggedUrl(ROUTES.jobs)).toBe(ROUTES.jobs);
    expect(redactLoggedUrl(ROUTES.job("job-1"))).toBe("/api/jobs/job-1");
    expect(redactLoggedUrl(ROUTES.jobEvents("job-1"))).toBe("/api/jobs/job-1/events");
    expect(redactLoggedUrl(ROUTES.health)).toBe(ROUTES.health);
  });

  test("the awkward shapes a token can arrive in", () => {
    // Verified by hand during gate C and pinned here, because for
    // credential-handling code "someone checked once" is not a guarantee.
    const prefix = ROUTES.file("");

    // A trailing slash: the segment ends, the slash survives.
    expect(redactLoggedUrl(`${ROUTES.file("abc")}/`)).toBe(`${prefix}${REDACTED}/`);
    // Percent-encoded: still one segment, and still replaced whole.
    expect(redactLoggedUrl(ROUTES.file("a%2Fb"))).toBe(`${prefix}${REDACTED}`);
    // Empty token. Fastify will not route it, but the hooks log what arrived.
    expect(redactLoggedUrl(prefix)).toBe(`${prefix}${REDACTED}`);
    // A double slash — the token is empty and the rest is kept as it came.
    expect(redactLoggedUrl(`${prefix}/abc`)).toBe(`${prefix}${REDACTED}/abc`);
    // Regex metacharacters in the token. `startsWith` and `slice` are used
    // rather than a constructed pattern precisely so this cannot matter.
    expect(redactLoggedUrl(ROUTES.file(".*+^${}()|[]\\"))).toBe(`${prefix}${REDACTED}`);
    // With a `?` among them the cut lands at the query delimiter, which is
    // right: a real token is base64url, so `?` `#` and `/` are never part of
    // one, and treating them as delimiters is what the router does too. The
    // path segment is still replaced whole, which is the property that matters.
    expect(redactLoggedUrl(ROUTES.file("ab?cd"))).toBe(`${prefix}${REDACTED}?cd`);
    // A fragment, which a server never sees but a log line might be handed.
    expect(redactLoggedUrl(`${ROUTES.file("abc")}#frag`)).toBe(`${prefix}${REDACTED}#frag`);
  });

  test("a traversal attempt is redacted, not resolved", () => {
    // Whatever this means to the router, the segment after the prefix is
    // replaced and nothing downstream sees a token. The route's own
    // `assertRealPathInside` is what answers traversal; this only has to not
    // leak while it happens.
    expect(redactLoggedUrl(`${ROUTES.file("..")}/etc/passwd`)).toBe(
      `${ROUTES.file("")}${REDACTED}/etc/passwd`,
    );
  });

  test("a path that merely looks like the route is not treated as one", () => {
    // `startsWith` on a prefix ending in `/` cannot match `/api/filesomething`.
    expect(redactLoggedUrl("/api/filesomething")).toBe("/api/filesomething");
  });
});
