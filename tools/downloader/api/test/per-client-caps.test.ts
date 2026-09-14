/**
 * Per-client admission caps: bounding how much of a running job slot, the
 * job wait line, or a browser probe any one client may hold at once (dl-51).
 *
 * Distinct from what `rate-limit.test.ts` already covers: the per-minute
 * buckets bound how *fast* a client may act, and `ConcurrencyGate` bounds how
 * much the *server* may do at once — neither stops one client from holding
 * every running slot indefinitely once admitted, which is what this file is
 * for. `queue-and-shutdown.test.ts`'s `onSettle` suite covers the release
 * mechanism at the queue layer; this file covers it end to end, through the
 * routes.
 */

import { AppError, ROUTES } from "@downloader/contract";
import type { JobResponse } from "@downloader/contract";
import { clientKey } from "@webtools/core/rate-limit";
import { describe, expect, test, vi } from "vitest";
import { PerClientConcurrencyGate } from "../src/per-client-gate.ts";
import type { Harness } from "./helpers.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";

describe("PerClientConcurrencyGate", () => {
  test("admits up to the limit and then refuses rather than queues", () => {
    const gate = new PerClientConcurrencyGate(2);
    expect(gate.tryAcquire("a")).not.toBeNull();
    expect(gate.tryAcquire("a")).not.toBeNull();
    expect(gate.tryAcquire("a")).toBeNull();
    expect(gate.count("a")).toBe(2);
  });

  test("releasing frees a slot, and releasing twice does not free two", () => {
    // Limit 2, two acquisitions, so a double release of only one of them has
    // somewhere to go wrong: at limit 1 the second release lands on the same
    // zero floor a correct single release would, and the assertion cannot
    // tell the two apart.
    const gate = new PerClientConcurrencyGate(2);
    const releaseFirst = gate.tryAcquire("a");
    gate.tryAcquire("a");
    releaseFirst?.();
    releaseFirst?.();
    expect(gate.count("a")).toBe(1);
    expect(gate.tryAcquire("a")).not.toBeNull();
    expect(gate.tryAcquire("a")).toBeNull();
  });

  test("clients have separate counts", () => {
    const gate = new PerClientConcurrencyGate(1);
    expect(gate.tryAcquire("a")).not.toBeNull();
    expect(gate.tryAcquire("a")).toBeNull();
    expect(gate.tryAcquire("b")).not.toBeNull();
  });

  test("a limit of zero disables it entirely", () => {
    const gate = new PerClientConcurrencyGate(0);
    expect(gate.enabled).toBe(false);
    for (let call = 0; call < 100; call++) expect(gate.tryAcquire("a")).not.toBeNull();
    expect(gate.count("a")).toBe(0);
  });
});

/** A resolver that blocks until released, so a probe (and the job behind it) stays in flight. */
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

async function createJob(harness: Harness, remoteAddress: string, url: string = SOURCE_URL) {
  return harness.app.server.inject({
    method: "POST",
    url: ROUTES.jobs,
    payload: { url },
    remoteAddress,
  });
}

describe("job admission (dl-51)", () => {
  test("one client cannot hold every running slot and queue behind it without bound", async () => {
    // The step-1 reproduction. Run against `origin/main` at `95c6403` (fetched
    // at intake), this test fails: all five of client A's jobs come back 201,
    // because MAX_CONCURRENT_JOBS bounds how many jobs *run* at once but
    // nothing bounded how many one client could *hold*, running and waiting
    // together. See the Log for that run's output.
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 2, maxQueuedJobs: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const results: number[] = [];
      for (let call = 0; call < 5; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const response = await createJob(harness, clientA, `${SOURCE_URL}/${String(call)}`);
        results.push(response.statusCode);
      }
      // Two admitted, filling both running slots under MAX_CONCURRENT_JOBS —
      // and the rest refused by the per-client cap, rather than all five
      // queuing behind them with no bound.
      expect(results).toEqual([201, 201, 429, 429, 429]);

      // A different client is not blocked by the first one ever having tried
      // to take everything: its job is admitted and only waits its turn.
      const clientB = "198.51.100.4";
      const other = await createJob(harness, clientB, `${SOURCE_URL}/other`);
      expect(other.statusCode).toBe(201);
      expect(
        (harness.app.context.store.get((other.json() as JobResponse).job.id) as { status: string })
          .status,
      ).toBe("queued");
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("a client over MAX_JOBS_PER_CLIENT gets a well-formed RATE_LIMITED, and a different client is admitted", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1, maxQueuedJobs: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      expect((await createJob(harness, clientA)).statusCode).toBe(201);

      const refused = await createJob(harness, clientA, `${SOURCE_URL}/2`);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(refused.json().error.retryable).toBe(true);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.retryAfterSec).toBeGreaterThan(0);
      // `scope` is for our logs; the allowlist in http-errors.ts keeps it there.
      expect(refused.json().error.details.scope).toBeUndefined();

      const clientB = "198.51.100.4";
      expect((await createJob(harness, clientB)).statusCode).toBe(201);
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("MAX_QUEUED_JOBS refuses a new job immediately once the wait line is full", async () => {
    const { resolver, release } = slowResolver();
    // Per-client cap disabled, so the only mechanism in play is the global
    // wait-line bound — each job below comes from its own address.
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0, maxQueuedJobs: 1 },
    });

    try {
      // Fills the one running slot.
      expect((await createJob(harness, "203.0.113.1")).statusCode).toBe(201);
      // Fills the one-deep wait line.
      expect((await createJob(harness, "203.0.113.2")).statusCode).toBe(201);
      await waitFor(
        () => harness.app.context.queue.waiting,
        (n) => n === 1,
        {
          label: "wait line to fill",
        },
      );

      // A third job would be the wait line's second entry: refused outright,
      // rather than accepted to wait up to JOB_TIMEOUT_MS.
      const refused = await createJob(harness, "203.0.113.3");
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(refused.json().error.details.scope).toBeUndefined();
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("0 disables MAX_QUEUED_JOBS, like every other cap here", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 0, maxQueuedJobs: 0 },
    });

    try {
      for (let call = 0; call < 10; call++) {
        // oxlint-disable-next-line no-await-in-loop
        const response = await createJob(harness, `203.0.113.${String(call)}`);
        expect(response.statusCode, `call ${call}`).toBe(201);
      }
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("the per-client slot is released after a job completes", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1 },
    });

    try {
      const clientA = "203.0.113.7";
      const created = (await createJob(harness, clientA)).json() as JobResponse;
      // Only "completed", not "failed" too — this test is titled "completes",
      // so a regression into failure must time this `waitFor` out rather than
      // pass as a terminal state that happens to also release the slot.
      await waitFor(
        () => harness.app.context.store.get(created.job.id),
        (job) => job.status === "completed",
        { label: "job to complete" },
      );
      await waitFor(
        () => harness.app.context.jobClientGate.count(clientKey(clientA)),
        (count) => count === 0,
        { label: "slot to be released" },
      );
      // The proof that matters to a caller: a second job from the same
      // client is admitted rather than refused.
      expect((await createJob(harness, clientA, `${SOURCE_URL}/2`)).statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("the per-client slot is released when admission itself throws, not just when the job later settles", async () => {
    // The slot is acquired before `store.create` and `queue.enqueue` run
    // (routes/jobs.ts); a throw from either must not leak it, since neither
    // one ever reaches the `onSettle` that normally releases it.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 2, rateLimitJobsPerMinute: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const failing = vi.spyOn(harness.app.context.store, "create").mockImplementation(() => {
        throw new AppError("DISK_FULL");
      });

      const first = await createJob(harness, clientA, `${SOURCE_URL}/1`);
      const second = await createJob(harness, clientA, `${SOURCE_URL}/2`);
      expect(first.statusCode).toBe(507);
      expect(second.statusCode).toBe(507);
      // Two throws against a cap of two: a leak here would show as a 429 on
      // the next attempt rather than as a count directly.
      expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(0);

      failing.mockRestore();
      const third = await createJob(harness, clientA, `${SOURCE_URL}/3`);
      expect(third.statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("the per-client slot is released after a job fails", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { failWith: () => new AppError("DOWNLOAD_FAILED") },
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1 },
    });

    try {
      const clientA = "203.0.113.7";
      const created = (await createJob(harness, clientA)).json() as JobResponse;
      await waitFor(
        () => harness.app.context.store.get(created.job.id),
        (job) => job.status === "failed",
        { label: "job to fail" },
      );
      await waitFor(
        () => harness.app.context.jobClientGate.count(clientKey(clientA)),
        (count) => count === 0,
        { label: "slot to be released" },
      );
      expect((await createJob(harness, clientA, `${SOURCE_URL}/2`)).statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("the per-client slot is released after a job times out", async () => {
    // The queue's `onSettle` does not distinguish *why* a task's `run` settled
    // — a timeout reaches the same release path as any other failure — but
    // this pins the specific code the Done-when line names, rather than
    // leaving it to a structural argument.
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      engineOptions: { failWith: () => new AppError("TIMEOUT") },
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1 },
    });

    try {
      const clientA = "203.0.113.7";
      const created = (await createJob(harness, clientA)).json() as JobResponse;
      const finished = await waitFor(
        () => harness.app.context.store.get(created.job.id),
        (job) => job.status === "failed",
        { label: "job to fail" },
      );
      expect(finished.error?.code).toBe("TIMEOUT");
      await waitFor(
        () => harness.app.context.jobClientGate.count(clientKey(clientA)),
        (count) => count === 0,
        { label: "slot to be released" },
      );
      expect((await createJob(harness, clientA, `${SOURCE_URL}/2`)).statusCode).toBe(201);
    } finally {
      await harness.dispose();
    }
  });

  test("the per-client slot is released when a running job is canceled", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 2, maxJobsPerClient: 1 },
    });

    try {
      const clientA = "203.0.113.7";
      const created = (await createJob(harness, clientA)).json() as JobResponse;
      await waitFor(
        () => harness.app.context.store.get(created.job.id),
        (job) => job.status === "probing",
        { label: "job to start probing" },
      );

      const canceled = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.cancelJob(created.job.id),
      });
      expect(canceled.statusCode).toBe(200);
      // The abort unwinds once the blocked resolver call returns.
      release();

      await waitFor(
        () => harness.app.context.store.get(created.job.id),
        (job) => job.status === "canceled",
        { label: "job to cancel" },
      );
      await waitFor(
        () => harness.app.context.jobClientGate.count(clientKey(clientA)),
        (count) => count === 0,
        { label: "slot to be released" },
      );
      expect((await createJob(harness, clientA, `${SOURCE_URL}/2`)).statusCode).toBe(201);
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("the per-client slot is released when a still-waiting job is canceled", async () => {
    const { resolver, release } = slowResolver();
    // One running slot, so client A's second job sits in the wait line rather
    // than running — and its own cap of 2 admits both.
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 2 },
    });

    try {
      const clientA = "203.0.113.7";
      await createJob(harness, clientA);
      const second = (await createJob(harness, clientA, `${SOURCE_URL}/2`)).json() as JobResponse;
      await waitFor(
        () => harness.app.context.queue.waiting,
        (n) => n === 1,
        {
          label: "second job to be waiting",
        },
      );
      expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(2);

      const canceled = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.cancelJob(second.job.id),
      });
      expect(canceled.statusCode).toBe(200);

      // Queue-level cancellation of a waiting task is synchronous (see
      // `queue-and-shutdown.test.ts`'s `onSettle` suite), so this needs no
      // `waitFor`.
      expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(1);

      // The freed slot is spendable: a third job from the same client is
      // admitted even though the first is still running.
      expect((await createJob(harness, clientA, `${SOURCE_URL}/3`)).statusCode).toBe(201);
    } finally {
      release();
      await harness.dispose();
    }
  });

  test("the per-client slot is released for every waiting job at shutdown", async () => {
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentJobs: 1, maxJobsPerClient: 2 },
    });

    try {
      const clientA = "203.0.113.7";
      await createJob(harness, clientA);
      await createJob(harness, clientA, `${SOURCE_URL}/2`);
      await waitFor(
        () => harness.app.context.queue.waiting,
        (n) => n === 1,
        {
          label: "second job to be waiting",
        },
      );
      expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(2);

      release();
      await harness.app.shutdown();
      expect(harness.app.context.jobClientGate.count(clientKey(clientA))).toBe(0);
    } finally {
      release();
      // `shutdown` above already closed everything `dispose` would; calling it
      // again is the idempotent no-op `queue-and-shutdown.test.ts` pins.
      await harness.dispose();
    }
  });
});

describe("probe admission (dl-51)", () => {
  test("a client over MAX_PROBES_PER_CLIENT gets a well-formed RATE_LIMITED, and a different client is admitted", async () => {
    // Only the first call blocks — client B's probe must resolve on its own
    // rather than deadlock behind client A's still-held slot.
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = new StubResolver(async (call) => {
      if (call === 0) await blocked;
      return probeResult();
    });
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentProbes: 4, maxProbesPerClient: 1, rateLimitProbePerMinute: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const first = harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/1` },
        remoteAddress: clientA,
      });
      await waitFor(
        () => harness.app.context.probeClientGate.count(clientKey(clientA)),
        (count) => count === 1,
        { label: "first probe to hold its slot" },
      );

      const refused = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/2` },
        remoteAddress: clientA,
      });
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe("RATE_LIMITED");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
      expect(refused.json().error.details.scope).toBeUndefined();

      const clientB = "198.51.100.4";
      const other = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/3` },
        remoteAddress: clientB,
      });
      expect(other.statusCode).toBe(200);

      release?.();
      expect((await first).statusCode).toBe(200);
    } finally {
      release?.();
      await harness.dispose();
    }
  });

  test("the per-client slot is released after a probe completes", async () => {
    const harness = await createHarness({
      resolver: new StubResolver(probeResult()),
      config: { maxProbesPerClient: 1, rateLimitProbePerMinute: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const first = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/1` },
        remoteAddress: clientA,
      });
      expect(first.statusCode).toBe(200);
      expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(0);

      const second = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/2` },
        remoteAddress: clientA,
      });
      expect(second.statusCode).toBe(200);
    } finally {
      await harness.dispose();
    }
  });

  test("the per-client slot is released after a failed probe", async () => {
    const resolver = new StubResolver(async () => {
      throw new Error("resolver exploded");
    });
    const harness = await createHarness({
      resolver,
      config: { maxProbesPerClient: 1, rateLimitProbePerMinute: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const first = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/1` },
        remoteAddress: clientA,
      });
      expect(first.statusCode).toBe(500);
      expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(0);

      const second = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/2` },
        remoteAddress: clientA,
      });
      // 500 again rather than 429: a leaked slot would turn this into a
      // refusal and the endpoint would be permanently dead for this client
      // after one bad page.
      expect(second.statusCode).toBe(500);
    } finally {
      await harness.dispose();
    }
  });

  test("a probe refused by the global gate does not leak its per-client slot", async () => {
    // The per-client slot is acquired before the global gate is even tried
    // (see `routes/probe.ts`), so a refusal there has to hand it back rather
    // than hold it for a probe that never ran.
    const { resolver, release } = slowResolver();
    const harness = await createHarness({
      resolver,
      config: { maxConcurrentProbes: 1, maxProbesPerClient: 5, rateLimitProbePerMinute: 0 },
    });

    try {
      const clientA = "203.0.113.7";
      const first = harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/1` },
        remoteAddress: clientA,
      });
      await waitFor(
        () => harness.app.context.probeGate.inFlight,
        (n) => n === 1,
        {
          label: "first probe to hold the global gate",
        },
      );

      const refused = await harness.app.server.inject({
        method: "POST",
        url: ROUTES.probe,
        payload: { url: `${SOURCE_URL}/2` },
        remoteAddress: clientA,
      });
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.details.scope).toBeUndefined();
      // Only the first probe's slot remains — the refused second one gave
      // its per-client slot straight back.
      expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(1);

      release();
      expect((await first).statusCode).toBe(200);
      expect(harness.app.context.probeClientGate.count(clientKey(clientA))).toBe(0);
    } finally {
      release();
      await harness.dispose();
    }
  });
});

describe("shipped defaults (dl-51)", () => {
  test("the per-client caps are on by default, and the queue depth follows MAX_CONCURRENT_JOBS", async () => {
    const harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    try {
      expect(harness.app.context.jobClientGate.enabled).toBe(true);
      expect(harness.app.context.probeClientGate.enabled).toBe(true);
      // Derived rather than a flat number — a queue exists to smooth a burst
      // behind the running slots, not to become a standing backlog. Pinned so
      // raising `maxConcurrentJobs` alone cannot silently balloon this too.
      expect(harness.app.context.config.maxQueuedJobs).toBe(
        harness.app.context.config.maxConcurrentJobs * 4,
      );
    } finally {
      await harness.dispose();
    }
  });
});
