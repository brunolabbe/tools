/**
 * dl-54: which fields reach a log line, measured.
 *
 * The terms page says what the service records about a visitor. That sentence
 * is only true while these shapes are, so this pins them: a new field on one
 * of these lines, or a page URL turning up on a line it was not on, fails here
 * and sends whoever caused it to `web/public/terms.html`.
 *
 * Run at `info`, the level `compose.downloader.yaml` sets in production, and
 * over the whole route stack: a probe, a job, and the visitor opening its link.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { JobResponse } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import { createLogger } from "../src/logger.ts";
import { createHarness, probeResult, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const CLIENT = "203.0.113.9";
const PAGE = "http://127.0.0.1/watch/42?token=SECRETQ&t=7";

type Line = Record<string, unknown> & { msg: string };

/** pino's own bookkeeping, on every line and about nobody. */
const ENVELOPE = new Set(["level", "time", "pid", "hostname", "msg"]);

function fieldsOf(line: Line): string[] {
  return Object.keys(line)
    .filter((key) => !ENVELOPE.has(key))
    .toSorted();
}

function byMessage(lines: readonly Line[], msg: string): Line[] {
  return lines.filter((line) => line.msg === msg);
}

async function run(
  resolver: StubResolver,
  after: (harness: Harness) => Promise<void>,
): Promise<{ lines: Line[]; raw: string[] }> {
  const raw: string[] = [];
  const harness = await createHarness({
    resolver,
    logger: createLogger({ level: "info", write: (line) => raw.push(line) }),
  });
  let seen: string[] = [];
  try {
    // Startup lines describe the host's egress and resolvers, not a visitor.
    raw.length = 0;
    await after(harness);
    // Before `dispose`, whose own shutdown lines are not about a visitor either.
    seen = [...raw];
  } finally {
    await harness.dispose();
  }
  return { lines: seen.map((line) => JSON.parse(line) as Line), raw: seen };
}

async function visit(harness: Harness, url: string): Promise<JobResponse["job"]> {
  const headers = { "content-type": "application/json" };
  await harness.app.server.inject({
    method: "POST",
    url: ROUTES.probe,
    payload: { url },
    headers,
    remoteAddress: CLIENT,
  });
  const created = await harness.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url },
    headers,
    remoteAddress: CLIENT,
  });
  const job = (created.json() as JobResponse).job;
  await harness.app.server.inject({
    method: "GET",
    url: job.link?.url ?? "",
    remoteAddress: CLIENT,
  });
  return job;
}

describe("what one probe and one download write at info", () => {
  const resolver = (): StubResolver =>
    new StubResolver(
      probeResult({
        sourceUrl: PAGE,
        requestContext: { headers: { Referer: PAGE, Cookie: "session=s", "User-Agent": "UA/1" } },
      }),
    );

  test("the fields on each line are exactly these", async () => {
    const { lines } = await run(resolver(), async (harness) => {
      const job = await visit(harness, PAGE);
      await waitFor(
        () => harness.app.context.store.get(job.id).status,
        (status) => status === "completed",
      );
    });

    expect(lines.map((line) => line.msg).toSorted()).toEqual([
      "job accepted",
      "job completed",
      "probe complete",
      "request",
      "request",
      "request",
    ]);
    expect(fieldsOf(byMessage(lines, "request")[0] as Line)).toEqual([
      "durationMs",
      "ip",
      "method",
      "requestId",
      "status",
      "url",
    ]);
    expect(fieldsOf(byMessage(lines, "job accepted")[0] as Line)).toEqual([
      "jobId",
      "requestId",
      "variantId",
    ]);
    expect(fieldsOf(byMessage(lines, "job completed")[0] as Line)).toEqual([
      "attempts",
      "container",
      "jobId",
      "requestId",
      "sizeBytes",
      "transcodes",
    ]);
    // No `requestId` and no `ip`: the probe's page is on a line that cannot be
    // tied to an address by anything but its timestamp.
    expect(fieldsOf(byMessage(lines, "probe complete")[0] as Line)).toEqual([
      "drm",
      "preview",
      "previewSource",
      "requestContext",
      "resolver",
      "variants",
    ]);
  });

  test("the client address is on the request line and nowhere else", async () => {
    const { lines, raw } = await run(resolver(), async (harness) => {
      const job = await visit(harness, PAGE);
      await waitFor(
        () => harness.app.context.store.get(job.id).status,
        (status) => status === "completed",
      );
    });

    expect(byMessage(lines, "request").map((line) => line["ip"])).toEqual([CLIENT, CLIENT, CLIENT]);
    const elsewhere = lines.filter((line) => line.msg !== "request");
    expect(elsewhere.map((line) => JSON.stringify(line)).join("")).not.toContain(CLIENT);
    expect(raw.join("")).not.toContain("SECRETQ");
  });

  test("the page URL is on the probe line, with its query string gone, and on no request line", async () => {
    const { lines } = await run(resolver(), async (harness) => {
      const job = await visit(harness, PAGE);
      await waitFor(
        () => harness.app.context.store.get(job.id).status,
        (status) => status === "completed",
      );
    });

    const carrying = lines.filter((line) => JSON.stringify(line).includes("/watch/42"));
    expect(carrying.map((line) => line.msg)).toEqual(["probe complete"]);
    expect(JSON.stringify(carrying[0])).toContain("http://127.0.0.1/watch/42?[redacted]");
    // The request line's `url` is the API route the visitor called, which is
    // why the page is in the POST body and never in a log.
    expect(byMessage(lines, "request").map((line) => line["url"])).toEqual([
      "/api/probe",
      "/api/jobs",
      "/api/files/[redacted]",
    ]);
  });
});

describe("what a failed probe and a failed download write at info", () => {
  const failing = (): StubResolver =>
    new StubResolver(async () => {
      throw new AppError("UNREACHABLE", undefined, { details: { url: PAGE } });
    });

  test("the page's origin and path reach `details`, the query string does not, and the address stays on the request line", async () => {
    const { lines, raw } = await run(failing(), async (harness) => {
      const job = await visit(harness, PAGE);
      await waitFor(
        () => harness.app.context.store.get(job.id).status,
        (status) => status === "failed",
      );
    });

    const failures = byMessage(lines, "request failed");
    expect(failures.map((line) => line["details"])).toEqual([
      { url: "http://127.0.0.1/watch/42?[redacted]" },
      { url: "http://127.0.0.1/watch/42?[redacted]" },
    ]);
    // These carry a `requestId`, and the `request` line of the same request
    // carries the address: for a failure the two are joined, by that id.
    expect(fieldsOf(failures[0] as Line)).toEqual([
      "code",
      "details",
      "method",
      "requestId",
      "status",
      "url",
    ]);
    expect(lines.filter((line) => line["ip"] !== undefined).map((line) => line.msg)).toEqual([
      "request",
      "request",
      "request",
    ]);
    expect(raw.join("")).not.toContain("SECRETQ");
    expect(byMessage(lines, "job failed").map((line) => fieldsOf(line))).toEqual([
      ["code", "jobId", "requestId", "retryable"],
    ]);
  });
});
