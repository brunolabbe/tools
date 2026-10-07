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

import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { AppError, REDACTED, ROUTES } from "@downloader/contract";
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
    // Since dl-53 the work runs on the link's request, so that is the id the
    // orchestrator's lines carry: the request a failed download happened on.
    await harness.app.server.inject({
      method: "GET",
      url: job.link?.url ?? "",
      headers: { "x-request-id": "req-link-opened" },
    });
    await waitFor(
      () => harness?.app.context.store.get(job.id) as Job,
      (current) => current.status === "completed" || current.status === "failed",
      { label: "job to finish" },
    );

    // The acceptance line ties the creating request to the job...
    const created = lines.filter((line) => line["requestId"] === "req-under-test");
    expect(created.some((line) => line.msg === "job accepted" && line["jobId"] === job.id)).toBe(
      true,
    );
    // ...and the orchestrator's own lines carry the job and the link's request.
    const worked = lines.filter((line) => line["requestId"] === "req-link-opened");
    expect(worked.filter((line) => line["jobId"] === job.id).length).toBeGreaterThan(0);
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
    await harness.app.server.inject({ method: "GET", url: job.link?.url ?? "" });
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

  test("says the tiers ARE reached when they are behind the terminating proxy", async () => {
    // dl-37's default arrangement, and the one this line said the opposite of
    // until it landed. A tier has to be registered for the interception to be
    // built at all — a generated root nobody will be given is attack surface
    // with no user.
    const { lines } = await bootWithCa({ enableBrowserResolver: true });

    const warnings = lines.filter((line) => line.level === "warn");
    const reach = warnings.filter((line) => /reaches the browser and yt-dlp/u.test(line.msg));
    expect(reach).toHaveLength(1);
    // The variable by the name the operator actually typed, so a deployment on
    // the deprecated spelling is not told about one it never set.
    expect(reach[0]?.msg).toMatch(/^EGRESS_CA_FILE/u);
    expect(reach[0]?.["doesNotReach"]).toEqual([]);
    expect(String(reach[0]?.["reaches"])).toMatch(/chromium and yt-dlp/u);
    // The cost, in the line that reports the coverage — an operator who learns
    // the tiers are covered is learning a page's traffic crosses this process.
    expect(String(reach[0]?.["hint"])).toMatch(/plaintext/u);
    // And never the sentence it replaced.
    expect(warnings.some((line) => /does not reach the browser/u.test(line.msg))).toBe(false);
  });

  test("says they are NOT reached when interception is off, and why", async () => {
    // dl-37 ties both proxies to one switch: `FFMPEG_TLS_INTERCEPT=false`
    // returns the tiers to a tunnel too, which is exactly dl-34's world, so
    // dl-34's sentence is what the operator must get back.
    const { lines } = await bootWithCa({
      enableBrowserResolver: true,
      ffmpegTlsIntercept: false,
    });

    const warnings = lines.filter((line) => line.level === "warn");
    const reach = warnings.filter((line) => /does not reach the browser or yt-dlp/u.test(line.msg));
    expect(reach).toHaveLength(1);
    expect(reach[0]?.["doesNotReach"]).toEqual(["chromium", "yt-dlp"]);
    // The half that is working, so the line reads as a boundary rather than as
    // "your setting does nothing".
    expect(String(reach[0]?.["reaches"])).toMatch(/ffmpeg/u);
    expect(String(reach[0]?.["hint"])).toMatch(/TLS_VERIFICATION_FAILED/u);
    // And the way back, which is the one actionable fact in the line.
    expect(String(reach[0]?.["hint"])).toMatch(/FFMPEG_TLS_INTERCEPT/u);
  });

  test("with no tier registered it says so rather than warning about tiers that do not exist", async () => {
    const { lines } = await bootWithCa();

    const warnings = lines.filter((line) => line.level === "warn");
    const reach = warnings.filter((line) => /does not reach the browser or yt-dlp/u.test(line.msg));
    expect(reach).toHaveLength(1);
    expect(String(reach[0]?.["hint"])).toMatch(/ENABLE_BROWSER_RESOLVER/u);
    // Not the private-root failure story: there is no tier to fail.
    expect(String(reach[0]?.["hint"])).not.toMatch(/TLS_VERIFICATION_FAILED/u);
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

/** Creates a job and returns its link and bare token (dl-53: the link is issued at once). */
async function issuedToken(current: Harness): Promise<{ url: string; token: string }> {
  const created = (
    await current.app.server.inject({
      method: "POST",
      url: ROUTES.jobs,
      payload: { url: SOURCE_URL },
    })
  ).json() as JobResponse;
  const url = created.job.link?.url ?? "";
  return { url, token: url.slice(url.lastIndexOf("/") + 1) };
}

/**
 * A file token is a credential, and it travels in the *path*.
 *
 * `/api/files/:token` is one of two URLs in this service whose path segment is a
 * secret rather than an identifier (the other is the thumbnail route, below) —
 * `jobs/tokens.ts` says so outright: the token *is* the authorisation, and job
 * ids deliberately are not. Two hooks log
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
    let clock = new Date("2026-09-27T10:00:00.000Z");
    harness = await createHarness({
      logger,
      resolver: new StubResolver(probeResult()),
      now: () => clock,
    });

    const { url, token } = await issuedToken(harness);
    // Past the link's fifteen minutes (dl-53).
    clock = new Date(clock.getTime() + 16 * 60_000);

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

/**
 * A thumbnail token is a credential too (dl-75).
 *
 * The contract and the route called it "the capability" and rate-limit it keyed
 * on the token, while the log wrote it verbatim. The owner answered on
 * 2026-10-04 that it is one, so it is redacted as the file token is. These read
 * the raw serialised line, as the file-token tests do, so a redactor that
 * changed the field name rather than its value would still be caught.
 */
describe("a thumbnail token never reaches a log line", () => {
  // A 2x2 GIF, as rate-limit.test.ts uses: small, real, in the allowlist.
  const GIF = Buffer.from("R0lGODlhAgACAIAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAIDRAJZADs=", "base64");

  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("not when the image is served, and not when the token misses", async () => {
    const { logger, lines } = capturing();
    harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });

    const token = harness.app.context.thumbnails.put({ contentType: "image/gif", bytes: GIF });
    // Well-formed and unknown: the route answers it with THUMBNAIL_NOT_FOUND,
    // which is the ordinary result after the ten minutes are up.
    const missed = "m".repeat(token.length);

    expect(
      (await harness.app.server.inject({ method: "GET", url: ROUTES.thumbnail(token) })).statusCode,
    ).toBe(200);
    expect(
      (await harness.app.server.inject({ method: "GET", url: ROUTES.thumbnail(missed) }))
        .statusCode,
    ).toBe(404);

    const serialised = lines.map((line) => JSON.stringify(line));
    // The lines are genuinely there — otherwise this passes by logging nothing.
    expect(serialised.filter((line) => line.includes("/api/thumbnail/"))).toHaveLength(3);
    expect(serialised.filter((line) => line.includes(token))).toEqual([]);
    expect(serialised.filter((line) => line.includes(missed))).toEqual([]);

    const served = lines.find((line) => line.msg === "request" && line.status === 200);
    expect(served?.url).toBe(`/api/thumbnail/${REDACTED}`);
    const rejected = lines.find((line) => line.msg === "request rejected");
    expect(rejected?.url).toBe(`/api/thumbnail/${REDACTED}`);
  });

  test("nor when the request is rate limited", async () => {
    const { logger, lines } = capturing();
    harness = await createHarness({
      logger,
      resolver: new StubResolver(probeResult()),
      config: { rateLimitThumbnailPerMinute: 1 },
    });

    const token = harness.app.context.thumbnails.put({ contentType: "image/gif", bytes: GIF });
    const url = ROUTES.thumbnail(token);
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(200);
    expect((await harness.app.server.inject({ method: "GET", url })).statusCode).toBe(429);

    expect(lines.map((line) => JSON.stringify(line)).filter((l) => l.includes(token))).toEqual([]);
  });
});

describe("redactLoggedUrl", () => {
  test("replaces the capability path and nothing else", () => {
    expect(redactLoggedUrl(ROUTES.file("abc"))).toBe(`/api/files/${REDACTED}`);
    expect(redactLoggedUrl(ROUTES.thumbnail("abc"))).toBe(`/api/thumbnail/${REDACTED}`);
    expect(redactLoggedUrl(`${ROUTES.thumbnail("abc")}?x=1`)).toBe(
      `/api/thumbnail/${REDACTED}?x=1`,
    );
    expect(redactLoggedUrl(`${ROUTES.file("abc")}?x=1`)).toBe(`/api/files/${REDACTED}?x=1`);
    // dl-76: the whole path after the prefix goes, not its first segment. It was
    // `…/[redacted]/extra`, which is what let `/api/files//<t>` keep its token.
    expect(redactLoggedUrl(`${ROUTES.file("abc")}/extra`)).toBe(`/api/files/${REDACTED}`);
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

    // A trailing slash is part of the path after the prefix, so it goes with it (dl-76).
    expect(redactLoggedUrl(`${ROUTES.file("abc")}/`)).toBe(`${prefix}${REDACTED}`);
    // Percent-encoded: still one segment, and still replaced whole.
    expect(redactLoggedUrl(ROUTES.file("a%2Fb"))).toBe(`${prefix}${REDACTED}`);
    // Empty token. Fastify will not route it, but the hooks log what arrived.
    expect(redactLoggedUrl(prefix)).toBe(`${prefix}${REDACTED}`);
    // A double slash. The first segment is empty and the token is the second,
    // so what follows goes too: it was `…/[redacted]/abc` until dl-76, which
    // is the shape that leaked.
    expect(redactLoggedUrl(`${prefix}/abc`)).toBe(`${prefix}${REDACTED}`);
    // Regex metacharacters in the token. Prefixes are compared as segments,
    // not built into a pattern, precisely so this cannot matter.
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
    // Whatever this means to the router, the whole remainder after the prefix
    // is replaced and nothing downstream sees a token. The route's own
    // `assertRealPathInside` is what answers traversal; this only has to not
    // leak while it happens.
    expect(redactLoggedUrl(`${ROUTES.file("..")}/etc/passwd`)).toBe(
      `${ROUTES.file("")}${REDACTED}`,
    );
  });

  test("a path that merely looks like the route is not treated as one", () => {
    // Segments are compared whole, so `/api/filesomething` is not `/api/files`.
    expect(redactLoggedUrl("/api/filesomething")).toBe("/api/filesomething");
  });
});

/**
 * dl-58. A failed probe's `AppError` routinely carries the page URL, query
 * string included, as `details.url` — `resolvers/src/registry.ts`'s
 * `NO_MEDIA_FOUND` and `resolvers/src/resolvers/ytdlp.ts`'s
 * `classifyFailure` both set it unredacted — and the error handler in
 * `server.ts` copies `details` into its log line as-is, on both branches: a
 * 4xx logs "request rejected" at `info`, a 5xx logs "request failed" at
 * `error`. A signed page URL is as sensitive as a cookie, per the root
 * `CLAUDE.md`, so that credential must never reach either line.
 */
describe("a failed probe never logs the page URL's credentials", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  /**
   * Both cases use a terminal code, not `NO_MEDIA_FOUND` — that one is a
   * fall-through, so with the real direct tier also registered (required for
   * the app to boot at all, see `assertUsable`) the chain would move on to it
   * and reach real DNS; `probe-outcomes.test.ts` documents the same
   * constraint. Registry-level chain exhaustion is covered with no real tier
   * involved in `resolvers/test/registry.test.ts`.
   */
  test("a 5xx: the error handler's 'request failed' line", async () => {
    // `ytdlp.ts`'s `classifyFailure` throws exactly this shape for
    // `TLS_VERIFICATION_FAILED` — `details: { url: url.href, ... }`,
    // unredacted — which is one of the sweep's sites; this stub reproduces it
    // without a real subprocess.
    const raw: string[] = [];
    const signedUrl = "https://cdn.example/watch?v=1&sig=SECRET123";
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
      resolver: new StubResolver(async () => {
        throw new AppError("TLS_VERIFICATION_FAILED", undefined, {
          details: { url: signedUrl },
        });
      }),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: signedUrl },
    });
    expect(response.statusCode).toBe(502);

    // Not one line, anywhere, at any level.
    expect(raw.filter((line) => line.includes("SECRET123"))).toEqual([]);

    // And the line is genuinely there, with the site that failed still
    // legible — this is redaction, not deletion.
    const failed = raw.filter((line) => line.includes('"msg":"request failed"'));
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("cdn.example");
    expect(failed[0]).toContain("/watch");
  });

  test("a 4xx: the error handler's 'request rejected' line — the ticket's own reproduction", async () => {
    // The exact shape the ticket reproduced against `createLogger` directly:
    // `NO_MEDIA_FOUND`, 422, `details: { url, attempts }`. Reproduced here
    // through the real Fastify server, closing the gap the ticket's own
    // reproduction left open ("that run exercised the logger, not a request
    // through Fastify").
    const raw: string[] = [];
    const signedUrl = "https://cdn.example/watch?v=1&sig=SECRET123";
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
      resolver: new StubResolver(async () => {
        throw new AppError("AUTH_REQUIRED", undefined, {
          details: { url: signedUrl },
        });
      }),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: signedUrl },
    });
    expect(response.statusCode).toBe(422);

    expect(raw.filter((line) => line.includes("SECRET123"))).toEqual([]);
    const rejected = raw.filter((line) => line.includes('"msg":"request rejected"'));
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain("cdn.example");
    expect(rejected[0]).toContain("/watch");
  });
});

/**
 * dl-58, at the unit level rather than through the whole server — the
 * mechanism itself (`redactUrlsDeep`, inside `safeFields`), not just one
 * caller of it exercised above.
 *
 * Widened once already (owner decision D1, after the first gate on this
 * ticket): the original version only walked `details`, and the gate found
 * two more leaks it missed — `egress-proxy.ts`'s top-level `host` field
 * (`egress-proxy.test.ts`'s own dl-58 describe block covers that one through
 * the real proxy), and a URL embedded *inside* a longer string rather than
 * being the whole of it (H2 below). The mechanism now walks every string
 * value in the whole `fields` object, however deeply nested, via
 * `redactUrlsInText` — the same matcher `engine/src/ffmpeg/runner.ts` already
 * used for ffmpeg's stderr — so `host`, `details.<key>` at any depth, and a
 * `Referer` inside `requestContext.headers` (see the describe block below)
 * are one mechanism, not three.
 */
describe("safeFields redacts a URL wherever it appears in a log line", () => {
  test("a query string inside details.<key> is redacted; the site stays legible", () => {
    const { logger, lines } = capturing();
    logger.warn("refused a subprocess fetch", {
      host: "cdn.example",
      code: "BLOCKED_TARGET",
      details: {
        url: "https://cdn.example/watch?v=1&sig=SECRET123",
        manifestUrl: "https://cdn.example/m.m3u8?sig=OTHER-SECRET",
      },
    });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SECRET123");
    expect(serialised).not.toContain("OTHER-SECRET");
    // Redaction, not deletion: the site is still legible.
    expect(serialised).toContain("cdn.example");
    expect(serialised).toContain("/watch");
    expect(serialised).toContain("/m.m3u8");
  });

  test("a relative path in details is left alone — it is not a credential", () => {
    const { logger, lines } = capturing();
    logger.info("probed", { details: { path: "/api/probe", note: "not a url at all" } });

    expect(lines[0]?.["details"]).toEqual({ path: "/api/probe", note: "not a url at all" });
  });

  test("non-URL details are untouched: numbers, arrays, nested objects", () => {
    const { logger, lines } = capturing();
    const details = {
      attempts: [{ resolver: "stub", code: "NO_MEDIA_FOUND", durationMs: 12 }],
      retryAfterSec: 10,
    };
    logger.info("probed", { details });

    expect(lines[0]?.["details"]).toEqual(details);
  });

  /**
   * H1 at the unit level (the end-to-end proof, through a real
   * `startEgressProxy`, is `egress-proxy.test.ts`'s own dl-58 block). A
   * top-level field named anything is covered, not only `details`.
   */
  test("a query string in a top-level field outside details is redacted too", () => {
    const { logger, lines } = capturing();
    logger.warn("refused a subprocess fetch", {
      host: "http://blocked.test/seg.ts?sig=SECRET_BLOCKED",
      code: "BLOCKED_TARGET",
    });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SECRET_BLOCKED");
    expect(serialised).toContain("blocked.test");
    expect(serialised).toContain("/seg.ts");
  });

  /**
   * H2. `ytdlp.ts`'s `classifyFailure` puts raw yt-dlp stderr in
   * `details.stderr`, and yt-dlp echoes the failing URL mid-sentence —
   * `ERROR: Unsupported URL: <url>` — not as the whole value of the field.
   * The pre-D1 mechanism parsed a value whole as a URL and left an embedded
   * one untouched; `redactUrlsInText`'s substring match does not have that
   * gap, which is the property this pins.
   */
  test("a URL embedded mid-sentence in a details field is redacted, not just a whole-string one", () => {
    const { logger, lines } = capturing();
    logger.info("request rejected", {
      method: "POST",
      url: "/api/probe",
      code: "DRM_PROTECTED",
      status: 422,
      details: {
        url: "http://127.0.0.1:18081/drm/watch?v=1&sig=SECRET123",
        exitCode: 1,
        stderr: "ERROR: Unsupported URL: http://127.0.0.1:18081/drm/watch?v=1&sig=SECRET123\n",
      },
    });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SECRET123");
    expect(serialised).toContain("127.0.0.1");
    expect(serialised).toContain("/drm/watch");
    expect(serialised).toContain("Unsupported URL");
  });
});

/**
 * H3. `resolvers/src/browser/request-context.ts:65`'s `??= input.pageUrl`
 * fills `Referer` with the full page URL when a probe's capture had none, and
 * — measured directly with a real headless Chromium via Playwright, logged in
 * this ticket's Log rather than only asserted here — that is not the only
 * source: Chromium's own captured `Referer`, in the ordinary case where the
 * capture is *not* empty, carries the same full URL for a same-origin fetch
 * under its default referrer policy. Both sources produce the identical
 * `requestContext.headers.Referer` shape asserted below, so one test at the
 * logger boundary covers both without a real browser in this suite —
 * `redactRequestContext` deliberately leaves `Referer` un-redacted (needed
 * for replay), so `probe.ts`'s `probe complete` line is what has to catch it,
 * via the same `redactUrlsDeep` pass H1 and H2 use.
 */
describe("the success-path Referer never reaches 'probe complete' with its query string (dl-58, H3)", () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  test("a Referer carrying the full signed page URL is redacted, host and path kept", async () => {
    const raw: string[] = [];
    const signedUrl = "https://referer.example/watch?v=1&sig=SECRET_REFERER";
    harness = await createHarness({
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
      resolver: new StubResolver(
        probeResult({ requestContext: { headers: { Referer: signedUrl } } }),
      ),
    });

    const response = await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      payload: { url: signedUrl },
    });
    expect(response.statusCode).toBe(200);

    expect(raw.filter((line) => line.includes("SECRET_REFERER"))).toEqual([]);
    const complete = raw.filter((line) => line.includes('"msg":"probe complete"'));
    expect(complete).toHaveLength(1);
    // Redaction, not deletion: the site is still legible.
    expect(complete[0]).toContain("referer.example");
    expect(complete[0]).toContain("/watch");
  });
});

/**
 * dl-58, gate 2, M1. `redactUrlsDeep`'s first cut tracked every object ever
 * visited anywhere in the line, not only the current chain — so a *second*
 * reference to a shared, non-cyclic object read as "already handled" and was
 * written raw. No live call site logs one object twice, which is exactly why
 * this belongs in the net rather than in a real reproduction: the shape is
 * legitimate (a caller building `{ a: probe, b: probe }` is not a bug) and
 * nothing here should depend on nobody ever writing it.
 */
describe("safeFields redacts every reference to a shared object, not only the first", () => {
  test("two fields pointing at the same object are both redacted", () => {
    const { logger, lines } = capturing();
    const shared = { url: "https://h.example/p?sig=SHARED" };
    logger.info("dag", { a: shared, b: shared });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SHARED");
    expect(serialised).toContain("h.example");
    expect(serialised).toContain("/p");
  });

  test("a shared object reached through details and through an array is redacted both times", () => {
    const { logger, lines } = capturing();
    const shared = { url: "https://h.example/p?sig=SHARED" };
    logger.info("dag2", { details: shared, again: [shared] });

    const serialised = JSON.stringify(lines[0]);
    expect(serialised).not.toContain("SHARED");
  });

  /**
   * dl-58, gate 3, M3. The first version of this test only asserted the line
   * survived, which passed even while the cycle's own fields leaked — pino's
   * `"[Circular]"` marker appears one level *past* the object that closes the
   * loop, not at it, so the object's own `url` was serialised verbatim before
   * pino ever saw the back edge. This asserts the secret is gone, not just
   * that something was written.
   */
  test("a genuine cycle does not hang, and its own fields are not leaked at the back edge", () => {
    const { logger, lines } = capturing();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    cyclic["url"] = "https://h.example/p?sig=CYCLE";

    logger.info("cyclic", { cyclic });

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).not.toContain("CYCLE");
    // Redaction, not deletion: pins that the line still has content, so this
    // is not passing because the whole field was dropped.
    expect(JSON.stringify(lines[0])).toContain("h.example");
  });

  test("a two-object cycle (parent references child references parent) does not leak either object's URL", () => {
    const { logger, lines } = capturing();
    const parent: Record<string, unknown> = { url: "https://h.example/p?sig=PARENT" };
    const child: Record<string, unknown> = { parent };
    parent["child"] = child;

    logger.info("parentchild", { details: parent });

    expect(lines).toHaveLength(1);
    expect(JSON.stringify(lines[0])).not.toContain("PARENT");
    expect(JSON.stringify(lines[0])).toContain("h.example");
  });
});

/** The percent-escape digits of a string's first character. */
function hex(text: string): string {
  return (text.codePointAt(0) ?? 0).toString(16);
}

/**
 * dl-76. A capability token must stay out of the log however its path is spelled.
 *
 * `redactLoggedUrl` used to prefix-match the raw `request.url`, but Fastify's
 * router matches after normalising, and a client (or a proxy) can spell the same
 * route in ways the raw prefix never matches: `/api/%74humbnail/<t>` served the
 * image and logged the token in full. Every shape here was measured against the
 * running app, on both routes, before the fix: some reach a handler, the rest
 * are 404s with the token still in the line. They read the raw serialised lines,
 * as the tests above do.
 */
describe("a capability token never reaches a log line, however its path is spelled", () => {
  const GIF = Buffer.from("R0lGODlhAgACAIAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAIDRAJZADs=", "base64");

  /** `name` is the route's own segment, `files` or `thumbnail`. */
  type Spelling = (name: string, token: string) => string;

  const SPELLINGS: Array<[string, Spelling]> = [
    ["canonical (control)", (n, t) => `/api/${n}/${t}`],
    ["an encoded first letter of the route", (n, t) => `/api/%${hex(n)}${n.slice(1)}/${t}`],
    ["an encoded first character of the token", (n, t) => `/api/${n}/%${hex(t)}${t.slice(1)}`],
    ["a doubled leading slash", (n, t) => `//api/${n}/${t}`],
    ["a doubled slash inside the prefix", (n, t) => `/api//${n}/${t}`],
    ["an encoded slash before the token", (n, t) => `/api/${n}%2F${t}`],
    ["an upper-cased route", (n, t) => `/API/${n.toUpperCase()}/${t}`],
    ["a doubled slash before the token", (n, t) => `/api/${n}//${t}`],
    ["an encoded query delimiter", (n, t) => `/api/${n}%3F${t}`],
    ["an encoded fragment delimiter", (n, t) => `/api/${n}%23${t}`],
    ["a twice-encoded route", (n, t) => `/api/%25${hex(n)}${n.slice(1)}/${t}`],
    ["a path parameter on the route segment", (n, t) => `/api/${n};x=1/${t}`],
    ["a trailing slash", (n, t) => `/api/${n}/${t}/`],
  ];

  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  async function tokens(current: Harness): Promise<{ files: string; thumbnail: string }> {
    return {
      files: (await issuedToken(current)).token,
      thumbnail: current.app.context.thumbnails.put({ contentType: "image/gif", bytes: GIF }),
    };
  }

  describe.each(["files", "thumbnail"] as const)("on /api/%s/:token", (name) => {
    test.each(SPELLINGS)("%s", async (_label, spell) => {
      const { logger, lines } = capturing();
      harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });
      const token = (await tokens(harness))[name];
      lines.length = 0;

      await harness.app.server.inject({ method: "GET", url: spell(name, token) });

      const serialised = lines.map((line) => JSON.stringify(line));
      // Genuinely logged, or this passes by writing nothing.
      expect(lines.filter((line) => line.msg === "request")).toHaveLength(1);
      // `slice(1)`: the encoded-first-character spelling never carries the whole token.
      expect(serialised.filter((line) => line.includes(token.slice(1)))).toEqual([]);
      // Redaction, not deletion: the line still says which route it was.
      for (const line of lines.filter((l) => l.url !== undefined)) {
        expect(line.url).toBe(`/api/${name}/${REDACTED}`);
      }
    });
  });

  test("the encoded spellings do reach a handler, which is what makes them an exposure", async () => {
    // Guards the premise: if Fastify stopped decoding the route, the cases above
    // would still pass by 404ing, and the exposure they stand for would be gone
    // without anyone noticing the tests had stopped meaning anything.
    const { logger } = capturing();
    harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });
    const issued = await tokens(harness);

    const image = await harness.app.server.inject({
      method: "GET",
      url: `/api/%74humbnail/${issued.thumbnail}`,
    });
    expect(image.statusCode).toBe(200);
    const file = await harness.app.server.inject({
      method: "GET",
      url: `/api/%66iles/${issued.files}`,
    });
    expect(file.statusCode).not.toBe(404);
  });

  /** Request targets `light-my-request` normalises before Fastify sees them, so they need a socket. */
  describe.each(["files", "thumbnail"] as const)("on a real socket, /api/%s/:token", (name) => {
    const WIRE: Array<[string, Spelling]> = [
      ["a dot segment", (n, t) => `/api/./${n}/${t}`],
      ["a dot-dot segment", (n, t) => `/api/x/../${n}/${t}`],
      ["an encoded dot segment", (n, t) => `/api/%2e/${n}/${t}`],
      ["a backslash for the slash", (n, t) => `/api\\${n}/${t}`],
      ["an absolute-form request target", (n, t) => `http://localhost/api/${n}/${t}`],
      ["a token followed by dot-dot segments", (n, t) => `/api/${n}/${t}/../..`],
    ];

    test.each(WIRE)("%s", async (_label, spell) => {
      const { logger, lines } = capturing();
      harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });
      const token = (await tokens(harness))[name];
      await harness.app.server.listen({ port: 0, host: "127.0.0.1" });
      const { port } = harness.app.server.server.address() as AddressInfo;
      lines.length = 0;

      await rawGet(port, spell(name, token));
      await waitFor(
        () => lines.some((line) => line.msg === "request"),
        (logged) => logged,
        { label: "the request line" },
      );

      expect(lines.map((line) => JSON.stringify(line)).filter((l) => l.includes(token))).toEqual(
        [],
      );
      for (const line of lines.filter((l) => l.url !== undefined)) {
        expect(line.url).toBe(`/api/${name}/${REDACTED}`);
      }
    });
  });
});

/** One GET with the request target written verbatim, which `inject` will not do. */
function rawGet(port: number, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", () => undefined);
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

describe("redactLoggedUrl, on spellings the router would not match", () => {
  const expected = `/api/files/${REDACTED}`;

  test("redacts the whole path after the prefix, not only its first segment", () => {
    // `/api/files//<t>` has an empty first segment and the token in the second.
    expect(redactLoggedUrl("/api/files//abc")).toBe(expected);
    expect(redactLoggedUrl("/api/files/abc/extra")).toBe(expected);
    expect(redactLoggedUrl("/api/files/abc/")).toBe(expected);
  });

  test("keeps the query string and the fragment, which are not the credential", () => {
    expect(redactLoggedUrl("/api/%66iles/abc?x=1")).toBe(`${expected}?x=1`);
    expect(redactLoggedUrl("//api//files//abc#frag")).toBe(`${expected}#frag`);
  });

  test("resolves what a normaliser would, without trusting it to hide a token", () => {
    expect(redactLoggedUrl("/api/x/../files/abc")).toBe(expected);
    // The token comes first and the dot-dots after it: resolving to the end
    // would land on `/api` and find nothing, which is why it is checked as it goes.
    expect(redactLoggedUrl("/api/files/abc/../../..")).toBe(expected);
    expect(redactLoggedUrl("/API/FILES/abc")).toBe(expected);
    expect(redactLoggedUrl("/api/files%2Fabc")).toBe(expected);
    expect(redactLoggedUrl("/api/files%3Fabc")).toBe(expected);
    expect(redactLoggedUrl("/api%5Cfiles%5Cabc")).toBe(expected);
  });

  test("leaves a malformed percent escape alone rather than throwing", () => {
    expect(redactLoggedUrl("/api/files/ab%zzc")).toBe(expected);
    expect(redactLoggedUrl("/api/jobs/%zz")).toBe("/api/jobs/%zz");
  });

  test("still leaves every other URL exactly as it arrived", () => {
    for (const url of [
      "/api/jobs",
      "/api/jobs?limit=5",
      "/api/jobs/job-1/events",
      "/api/health",
      "/api/filesomething",
      "/api/thumbnails/x",
      "/files/api/x",
      "/",
    ]) {
      expect(redactLoggedUrl(url)).toBe(url);
    }
  });

  test("a long run of escapes costs a bounded number of passes", () => {
    const url = `/api/jobs/${"%25".repeat(5000)}`;
    expect(redactLoggedUrl(url)).toBe(url);
  });
});

/**
 * A request Fastify's router refuses before any hook runs used to be answered and
 * never logged (dl-84). The target has to reach the router verbatim, so these go
 * over a real socket: `inject` normalises it first and never takes this path.
 */
describe("a request the router refuses before any hook runs", () => {
  const GIF = Buffer.from("R0lGODlhAgACAIAAAP///wAAACH5BAAAAAAALAAAAAACAAIAAAIDRAJZADs=", "base64");

  /** What follows the token: each is a percent escape Fastify cannot decode. */
  const MALFORMED: Array<[string, string]> = [
    ["a truncated escape", "%E0%A4%A"],
    ["a lone percent", "%"],
    ["a non-hex escape", "%zz"],
    ["an overlong encoding", "%C0%AF"],
  ];

  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.dispose();
    harness = undefined;
  });

  async function listening(): Promise<{
    port: number;
    lines: Line[];
    tokens: Record<"files" | "thumbnail", string>;
  }> {
    const { logger, lines } = capturing();
    harness = await createHarness({ logger, resolver: new StubResolver(probeResult()) });
    const tokens = {
      files: (await issuedToken(harness)).token,
      thumbnail: harness.app.context.thumbnails.put({ contentType: "image/gif", bytes: GIF }),
    };
    await harness.app.server.listen({ port: 0, host: "127.0.0.1" });
    const { port } = harness.app.server.server.address() as AddressInfo;
    lines.length = 0;
    return { port, lines, tokens };
  }

  describe.each(["files", "thumbnail"] as const)("on /api/%s/:token", (name) => {
    test.each(MALFORMED)(
      "%s is logged once, redacted, and still answered 400",
      async (_l, tail) => {
        const { port, lines, tokens } = await listening();
        const token = tokens[name];

        const response = await rawExchange(port, `/api/${name}/${token}${tail}`);

        // Asserted before the line is waited for, so a red run shows the answer was
        // already this one and only the log was missing.
        expect(response.status).toBe(400);
        expect(response.contentType).toBe("application/json");
        expect(JSON.parse(response.body)).toEqual({
          error: "Bad Request",
          code: "FST_ERR_BAD_URL",
          message: `'/api/${name}/${token}${tail}' is not a valid url component`,
          statusCode: 400,
        });
        await waitFor(
          () => lines.filter((line) => line.msg === "request").length,
          (count) => count >= 1,
          { label: "the request line" },
        );

        const logged = lines.filter((line) => line.msg === "request");
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({
          level: "info",
          method: "GET",
          url: `/api/${name}/${REDACTED}`,
          status: 400,
          code: "FST_ERR_BAD_URL",
        });
        expect(typeof logged[0]?.requestId).toBe("string");
        // Fastify records no start time for a refused request, so a figure here
        // would be a constant dressed as a measurement.
        expect(logged[0]).not.toHaveProperty("durationMs");
        // The token's own characters, not only the whole of it: the escape is
        // what is malformed, and a log of the decoded part would still leak.
        expect(
          lines.map((line) => JSON.stringify(line)).filter((l) => l.includes(token.slice(1))),
        ).toEqual([]);
      },
    );
  });

  test("a parameter longer than the router allows is logged too, and still 414", async () => {
    const { port, lines } = await listening();
    const target = `/api/files/${"a".repeat(200)}`;

    const response = await rawExchange(port, target);
    expect(response.status).toBe(414);
    expect(response.contentType).toBe("application/json");
    expect(JSON.parse(response.body)).toEqual({
      error: "Bad Request",
      code: "FST_ERR_MAX_PARAM_LENGTH",
      message: `'${target}' is exceeding the max param length`,
      statusCode: 414,
    });
    await waitFor(
      () => lines.filter((line) => line.msg === "request").length,
      (count) => count >= 1,
      { label: "the request line" },
    );

    const logged = lines.filter((line) => line.msg === "request");
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      url: `/api/files/${REDACTED}`,
      status: 414,
      code: "FST_ERR_MAX_PARAM_LENGTH",
    });
    expect(JSON.stringify(lines)).not.toContain("a".repeat(20));
  });

  /**
   * A malformed escape in or before the route, so the path cannot be read as a
   * capability route's and `redactLoggedUrl` leaves it whole. Before dl-84 these
   * wrote no line; the refusal's line cuts the path at the escape instead
   * (owner decision 2026-10-07, see the ticket).
   */
  const BEFORE_THE_TOKEN: Array<
    [
      label: string,
      spell: (name: string, token: string) => string,
      logged: (name: string) => string,
    ]
  > = [
    [
      "a lone percent inside the route",
      (n, t) => `/api/${n.slice(0, 2)}%${n.slice(2)}/${t}`,
      (n) => `/api/${n.slice(0, 2)}[truncated]`,
    ],
    [
      "a non-hex escape after the route",
      (n, t) => `/api/${n}%zz/${t}`,
      (n) => `/api/${n}[truncated]`,
    ],
    [
      "a non-hex segment before the route",
      (n, t) => `/api/%zz/${n}/${t}`,
      () => "/api/[truncated]",
    ],
    [
      "an overlong encoding before the route",
      (n, t) => `/api/%C0%AF/${n}/${t}`,
      () => "/api/[truncated]",
    ],
  ];

  describe.each(["files", "thumbnail"] as const)(
    "a malformed escape in or before /api/%s",
    (name) => {
      test.each(BEFORE_THE_TOKEN)("%s", async (_label, spell, expectedUrl) => {
        const { port, lines, tokens } = await listening();
        const token = tokens[name];
        const target = spell(name, token);

        const response = await rawExchange(port, target);
        expect(response.status).toBe(400);
        await waitFor(
          () => lines.filter((line) => line.msg === "request").length,
          (count) => count >= 1,
          { label: "the request line" },
        );

        const logged = lines.filter((line) => line.msg === "request");
        expect(logged).toHaveLength(1);
        expect(logged[0]).toMatchObject({ status: 400, code: "FST_ERR_BAD_URL" });
        // Cut where the escape is, and say so, rather than log what follows it.
        expect(logged[0]?.url).toBe(expectedUrl(name));
        // Every 8-character window of the token, so a partial leak fails too.
        const serialised = lines.map((line) => JSON.stringify(line)).join("\n");
        const windows = Array.from({ length: token.length - 7 }, (_u, i) => token.slice(i, i + 8));
        expect(windows.filter((window) => serialised.includes(window))).toEqual([]);
      });
    },
  );
});

/** One GET with the target written verbatim, and the whole answer read back. */
function rawExchange(
  port: number,
  target: string,
): Promise<{ status: number; contentType: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const [head = "", ...rest] = text.split("\r\n\r\n");
      const status = Number(/^HTTP\/1\.1 (\d{3})/u.exec(head)?.[1]);
      const contentType = /^content-type: (.*)$/imu.exec(head)?.[1];
      resolve({ status, contentType, body: rest.join("\r\n\r\n") });
    });
  });
}
