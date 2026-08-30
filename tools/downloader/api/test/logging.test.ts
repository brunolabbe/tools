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

import { ROUTES } from "@downloader/contract";
import type { Job, JobResponse, RequestContext } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";
import { createLogger } from "../src/logger.ts";
import type { AppLogger } from "../src/logger.ts";
import { requestIdFrom } from "../src/request-log.ts";

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
