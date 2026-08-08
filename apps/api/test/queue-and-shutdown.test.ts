/**
 * The queue and graceful shutdown, plus the resolver composition that finally
 * makes **M2** demonstrable.
 *
 * The M2 acceptance criterion from `docs/02-ROADMAP.md` is not "the sniffer
 * works" — it is that the system resolves *without the extractor tier*. So the
 * expendability invariant is tested here, at the layer that actually composes
 * the chain, rather than asserted in prose.
 */

import { AppError, ROUTES } from "@downloader/shared";
import type { JobResponse } from "@downloader/shared";
import { afterEach, describe, expect, test } from "vitest";
import { loadApiConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import { InProcessJobQueue } from "../src/jobs/queue.ts";
import { buildRegistry } from "../src/resolvers.ts";
import { createHarness, probeResult, SOURCE_URL, StubResolver, waitFor } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

const silent = createLogger({ level: "silent" });

describe("resolver composition (M2)", () => {
  function build(overrides: Parameters<typeof loadApiConfig>[0]) {
    return buildRegistry({
      config: loadApiConfig(overrides, {}),
      logger: silent,
      fetchImpl: globalThis.fetch,
    });
  }

  test("with yt-dlp disabled the chain is still usable — coverage does not depend on it", () => {
    const { registry, resolverNames } = build({
      enableYtdlpResolver: false,
      enableBrowserResolver: true,
      enableDirectResolver: true,
    });
    expect(resolverNames).not.toContain("yt-dlp");
    // The browser sniffer is the foundation; the extractor tier is a latency
    // optimisation layered on top of it.
    expect(resolverNames).toContain("browser");
    expect(registry.resolvers.length).toBeGreaterThan(0);
  });

  test("the chain is ordered cheapest-first", () => {
    const { registry } = build({
      enableYtdlpResolver: true,
      enableBrowserResolver: true,
      enableDirectResolver: true,
    });
    const priorities = registry.resolvers.map((resolver) => resolver.priority);
    expect(priorities).toEqual(priorities.toSorted((a, b) => a - b));
    // yt-dlp (20) before the browser (50) before direct (90).
    expect(registry.resolvers.map((resolver) => resolver.name)).toEqual([
      "yt-dlp",
      "browser",
      "direct",
    ]);
  });

  test("a configuration with every tier disabled is refused at boot", () => {
    // Otherwise the API would answer NO_MEDIA_FOUND for every URL on earth,
    // which looks like broken coverage rather than a misconfiguration.
    expect(() =>
      loadApiConfig(
        {
          enableYtdlpResolver: false,
          enableBrowserResolver: false,
          enableDirectResolver: false,
        },
        {},
      ),
    ).toThrow(AppError);
  });

  test("the probe cache TTL is capped no matter what the environment asks for", () => {
    // A cache that outlives the signed URLs inside it is worse than no cache.
    const config = loadApiConfig({}, { PROBE_CACHE_TTL_MS: "999999" });
    expect(config.probeCacheTtlMs).toBe(60_000);
  });
});

describe("InProcessJobQueue", () => {
  test("runs at most `concurrency` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const queue = new InProcessJobQueue({ concurrency: 2 });
    const done: Promise<void>[] = [];

    for (let index = 0; index < 6; index++) {
      const settled = new Promise<void>((resolve) => {
        queue.enqueue({
          jobId: `job-${index}`,
          run: async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((tick) => setTimeout(tick, 10));
            active--;
            resolve();
          },
        });
      });
      done.push(settled);
    }

    await Promise.all(done);
    expect(peak).toBe(2);
    await queue.close();
  });

  test("cancelling a waiting task stops it ever running", async () => {
    const ran: string[] = [];
    const queue = new InProcessJobQueue({ concurrency: 1 });
    const blocker = new Promise<void>((resolve) => setTimeout(resolve, 20));

    queue.enqueue({
      jobId: "first",
      run: async () => {
        ran.push("first");
        await blocker;
      },
    });
    queue.enqueue({
      jobId: "second",
      run: async () => {
        ran.push("second");
      },
    });

    expect(queue.cancel("second")).toBe(true);
    await blocker;
    await queue.close();
    expect(ran).toEqual(["first"]);
  });

  test("cancelling a running task aborts it with a typed reason", async () => {
    const queue = new InProcessJobQueue({ concurrency: 1 });
    let reason: unknown;
    let started: (() => void) | undefined;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });

    const finished = new Promise<void>((resolve) => {
      queue.enqueue({
        jobId: "job",
        run: async (signal) => {
          started?.();
          await new Promise<void>((settle) => {
            signal.addEventListener("abort", () => {
              reason = signal.reason;
              settle();
            });
          });
          resolve();
        },
      });
    });

    await hasStarted;
    expect(queue.cancel("job")).toBe(true);
    await finished;
    // A typed reason survives every layer that re-wraps an abort, so the
    // orchestrator does not have to guess why it was stopped.
    expect(reason).toBeInstanceOf(AppError);
    expect((reason as AppError).code).toBe("JOB_CANCELED");
    await queue.close();
  });

  test("cancelling an unknown job is false, not an error", () => {
    const queue = new InProcessJobQueue({ concurrency: 1 });
    // A job that finished a millisecond ago is legitimately absent.
    expect(queue.cancel("never-existed")).toBe(false);
  });

  test("after close it refuses new work", async () => {
    const queue = new InProcessJobQueue({ concurrency: 1 });
    await queue.close();
    expect(() => queue.enqueue({ jobId: "late", run: async () => undefined })).toThrow(AppError);
  });
});

describe("graceful shutdown", () => {
  test("stops intake, cancels the running job and disposes resolvers", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = new StubResolver(async () => {
      await held;
      return probeResult();
    });

    const current = await createHarness({ resolver });
    const created = (
      await current.app.server.inject({
        method: "POST",
        url: ROUTES.jobs,
        payload: { url: SOURCE_URL },
      })
    ).json() as JobResponse;

    await waitFor(
      () => current.app.context.store.get(created.job.id),
      (job) => job.status === "probing",
      { label: "job to start probing" },
    );

    const shutdown = current.app.shutdown();
    release?.();
    await shutdown;

    // Resolvers must be disposed or a browser pool leaks for the lifetime of
    // the process.
    expect(resolver.disposed).toBe(1);
    expect(current.app.context.queue.running).toBe(0);

    await current.dispose();
  });

  test("shutdown is idempotent", async () => {
    harness = await createHarness({ resolver: new StubResolver(probeResult()) });
    await harness.app.shutdown();
    await expect(harness.app.shutdown()).resolves.toBeUndefined();
  });
});
