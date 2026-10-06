/**
 * dl-77: a link the server refuses is published on the job's event stream.
 *
 * The link is a plain `<a download>` (dl-53), so a `429` reaches the browser as
 * a failed file and the page that offered the link hears nothing. The page does
 * follow the job's event stream, so the refusal is sent there as a `refused`
 * frame: the same payload the response carries, and nothing else changed — the
 * job stays `queued` and the link is not spent.
 *
 * Each case below subscribes to the job's frames *before* opening the link, which
 * is what the card's own stream does, and reads what arrived.
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { ROUTES } from "@downloader/contract";
import type { Job, JobEvent, JobResponse } from "@downloader/contract";
import { describe, expect, test } from "vitest";
import type { Harness } from "./helpers.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";

/** A resolver that blocks until released, so the job behind it stays in flight. */
function slowResolver(): { resolver: StubResolver; release: () => void } {
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const resolver = new StubResolver(async () => {
    await blocked;
    return probeResult();
  });
  return { resolver, release: () => release?.() };
}

async function post(harness: Harness, url: string, remoteAddress: string): Promise<Job> {
  const response = await harness.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url },
    remoteAddress,
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as JobResponse).job;
}

function tokenOf(job: Job): string {
  return (job.link?.url ?? "").split("/").at(-1) ?? "";
}

/** What the card's own stream would have been handed for this job, in order. */
function frames(harness: Harness, jobId: string): JobEvent[] {
  const seen: JobEvent[] = [];
  harness.app.context.events.subscribe(jobId, (event) => seen.push(event));
  return seen;
}

function refusals(seen: readonly JobEvent[]): Extract<JobEvent, { type: "refused" }>[] {
  return seen.filter((event): event is Extract<JobEvent, { type: "refused" }> => {
    return event.type === "refused";
  });
}

/** Opens a link and returns once it has been claimed, which is how "admitted" shows. */
async function admit(harness: Harness, job: Job, remoteAddress: string): Promise<void> {
  void harness.app.server
    .inject({ method: "GET", url: job.link?.url ?? "", remoteAddress })
    .catch(() => undefined);
  await waitFor(
    () => harness.app.context.store.findLink(tokenOf(job))?.usedAt ?? null,
    (usedAt) => usedAt !== null,
    { label: "the link to be claimed" },
  );
}

describe("a refused link says so on the job's stream (dl-77)", () => {
  test("the per-client cap: code, wait and message are the response's own, and the link is not spent", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1, maxQueuedJobs: 0 },
    });
    try {
      const client = "203.0.113.7";
      const holder = await post(harness, SOURCE_URL, client);
      const refused = await post(harness, `${SOURCE_URL}/2`, client);
      await admit(harness, holder, client);

      const seen = frames(harness, refused.id);
      const response = await harness.app.server.inject({
        method: "GET",
        url: refused.link?.url ?? "",
        remoteAddress: client,
      });

      expect(response.statusCode).toBe(429);
      const [frame, ...others] = refusals(seen);
      expect(others).toEqual([]);
      expect(frame?.jobId).toBe(refused.id);
      expect(frame?.error.code).toBe("RATE_LIMITED");
      expect(frame?.error.retryable).toBe(true);
      expect(frame?.error.details?.["retryAfterSec"]).toBe(Number(response.headers["retry-after"]));
      expect(frame?.error.details?.["retryAfterSec"]).toBeGreaterThan(0);
      // The frame is the response's body, so `scope` stays in our logs here too.
      expect(frame?.error.details?.["scope"]).toBeUndefined();
      expect(frame?.error.message).toBe(response.json().error.message);
      expect(frame?.error.message).toMatch(/per client/u);
      // Nothing but the refusal: no status change, no terminal frame.
      expect(seen.map((event) => event.type)).toEqual(["refused"]);

      // Not an outcome: the job still waits for its link, and the link is whole.
      expect(harness.app.context.store.get(refused.id).status).toBe("queued");
      expect(harness.app.context.store.findLink(tokenOf(refused))?.usedAt).toBeNull();

      // And usable: once the holder is done, the same link starts the job.
      release();
      await waitFor(
        () => harness.app.context.store.get(holder.id).status,
        (status) => status === "completed",
        { label: "the holder to finish" },
      );
      const retried = await harness.app.server.inject({
        method: "GET",
        url: refused.link?.url ?? "",
        remoteAddress: client,
      });
      expect(retried.statusCode).toBe(200);
      await waitFor(
        () => harness.app.context.store.get(refused.id).status,
        (status) => status === "completed",
        { label: "the retried job to finish" },
      );
      // Still exactly the one refusal: the accepted attempt did not publish another.
      expect(refusals(seen)).toHaveLength(1);
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("a full wait line: the same frame, with its own message", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0, maxQueuedJobs: 1 },
    });
    try {
      const running = await post(harness, SOURCE_URL, "203.0.113.1");
      const waiting = await post(harness, `${SOURCE_URL}/2`, "203.0.113.2");
      const refused = await post(harness, `${SOURCE_URL}/3`, "203.0.113.3");
      await admit(harness, running, "203.0.113.1");
      await admit(harness, waiting, "203.0.113.2");
      await waitFor(
        () => harness.app.context.queue.waiting,
        (waitingNow) => waitingNow === 1,
        { label: "the wait line to fill" },
      );

      const seen = frames(harness, refused.id);
      const response = await harness.app.server.inject({
        method: "GET",
        url: refused.link?.url ?? "",
        remoteAddress: "203.0.113.3",
      });

      expect(response.statusCode).toBe(429);
      const [frame] = refusals(seen);
      expect(frame?.error.code).toBe("RATE_LIMITED");
      expect(frame?.error.details?.["retryAfterSec"]).toBe(Number(response.headers["retry-after"]));
      expect(frame?.error.message).toMatch(/as many downloads as it can hold/u);
      expect(harness.app.context.store.findLink(tokenOf(refused))?.usedAt).toBeNull();
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("a wait for a slot that runs out: published after the link is given back", async () => {
    const { resolver, release } = slowResolver();
    // 49 s of probe timeout leaves two seconds of the tunnel budget to wait in.
    const harness = await createHarness({
      resolver,
      config: {
        maxConcurrentJobs: 1,
        maxJobsPerClient: 0,
        maxQueuedJobs: 0,
        probeTimeoutMs: 49_000,
      },
    });
    try {
      const running = await post(harness, SOURCE_URL, "203.0.113.1");
      const waiting = await post(harness, `${SOURCE_URL}/2`, "203.0.113.2");
      await admit(harness, running, "203.0.113.1");

      const seen = frames(harness, waiting.id);
      const response = await harness.app.server.inject({
        method: "GET",
        url: waiting.link?.url ?? "",
        remoteAddress: "203.0.113.2",
      });

      expect(response.statusCode).toBe(429);
      const [frame] = refusals(seen);
      expect(frame?.error.code).toBe("RATE_LIMITED");
      expect(frame?.error.message).toMatch(/slot is busy/u);
      expect(frame?.error.details?.["retryAfterSec"]).toBe(Number(response.headers["retry-after"]));
      // Given back before it was published, so the card's "Download" is true.
      const link = harness.app.context.store.findLink(tokenOf(waiting));
      expect(link?.usedAt).toBeNull();
      expect(harness.app.context.store.get(waiting.id).status).toBe("queued");
    } finally {
      release();
      await harness.dispose();
    }
  }, 20_000);

  test("shutdown: the link is refused with the response's INTERNAL, and published", async () => {
    const harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    try {
      const job = await post(harness, SOURCE_URL, "203.0.113.1");
      const seen = frames(harness, job.id);
      // `isShuttingDown` is the flag the handler reads; closing the server first
      // would answer `503` before the route runs and prove nothing about it.
      harness.app.context.isShuttingDown = () => true;

      const response = await harness.app.server.inject({
        method: "GET",
        url: job.link?.url ?? "",
        remoteAddress: "203.0.113.1",
      });

      expect(response.statusCode).toBe(500);
      const [frame] = refusals(seen);
      expect(frame?.error.code).toBe("INTERNAL");
      expect(frame?.error.message).toMatch(/shutting down/u);
      // A shutdown has no number to give, and the frame does not invent one.
      expect(frame?.error.details?.["retryAfterSec"]).toBeUndefined();
      expect(harness.app.context.store.findLink(tokenOf(job))?.usedAt).toBeNull();
    } finally {
      await harness.dispose();
    }
  });

  test("a link that was never admitted-or-refused publishes nothing: an unknown token, a spent link", async () => {
    const harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    try {
      const job = await post(harness, SOURCE_URL, "203.0.113.1");
      const seen = frames(harness, job.id);

      const unknown = await harness.app.server.inject({
        method: "GET",
        url: ROUTES.file("0".repeat(43)),
        remoteAddress: "203.0.113.1",
      });
      expect(unknown.statusCode).toBe(404);

      const opened = await harness.app.server.inject({
        method: "GET",
        url: job.link?.url ?? "",
        remoteAddress: "203.0.113.1",
      });
      expect(opened.statusCode).toBe(200);
      const again = await harness.app.server.inject({
        method: "GET",
        url: job.link?.url ?? "",
        remoteAddress: "203.0.113.1",
      });
      expect(again.statusCode).toBe(410);

      // `410` is an answer about the link, not a refusal to start a job that is
      // still waiting; the page already hears the outcome through `completed`.
      expect(refusals(seen)).toEqual([]);
    } finally {
      await harness.dispose();
    }
  });
});

describe("the frame travels the SSE route (dl-77)", () => {
  test("a client attached to the job's events receives it, as JSON on a data line", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1, maxQueuedJobs: 0 },
    });
    let request: http.ClientRequest | undefined;
    try {
      await harness.app.server.listen({ host: "127.0.0.1", port: 0 });
      const { port } = harness.app.server.server.address() as AddressInfo;
      const client = "127.0.0.1";
      const holder = await post(harness, SOURCE_URL, client);
      const refused = await post(harness, `${SOURCE_URL}/2`, client);
      await admit(harness, holder, client);

      let text = "";
      let attached = false;
      request = http.get(
        `http://127.0.0.1:${String(port)}${ROUTES.jobEvents(refused.id)}`,
        (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            text += chunk;
            attached = true;
          });
        },
      );
      request.on("error", () => undefined);
      await waitFor(
        () => attached,
        (value) => value,
        { label: "the event stream to open" },
      );

      const response = await harness.app.server.inject({
        method: "GET",
        url: refused.link?.url ?? "",
        remoteAddress: client,
      });
      expect(response.statusCode).toBe(429);

      await waitFor(
        () => text,
        (value) => value.includes('"type":"refused"'),
        { label: "the refused frame" },
      );
      const line = text.split("\n").find((entry) => entry.includes('"type":"refused"')) ?? "";
      expect(line.startsWith("data: ")).toBe(true);
      const parsed = JSON.parse(line.slice("data: ".length)) as JobEvent;
      expect(parsed.type).toBe("refused");
      if (parsed.type === "refused") {
        expect(parsed.jobId).toBe(refused.id);
        expect(parsed.error.code).toBe("RATE_LIMITED");
        expect(parsed.error.details?.["retryAfterSec"]).toBe(30);
      }
      // Not terminal: the stream is still open for the attempt that follows.
      expect(request.destroyed).toBe(false);
    } finally {
      request?.destroy();
      release();
      await harness.dispose();
    }
  });
});
