/**
 * The queue and graceful shutdown, plus the resolver composition that finally
 * makes **M2** demonstrable.
 *
 * The M2 acceptance criterion from `tools/downloader/docs/02-ROADMAP.md` is not "the sniffer
 * works" — it is that the system resolves *without the extractor tier*. So the
 * expendability invariant is tested here, at the layer that actually composes
 * the chain, rather than asserted in prose.
 */

import path from "node:path";
import { AppError, ROUTES } from "@downloader/contract";
import type { JobResponse } from "@downloader/contract";
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

  test("an unusable PROXY_URL stops the process at boot", () => {
    // It now configures a ProxyAgent rather than only reaching subprocesses, and
    // a service that silently egresses from the wrong address is precisely what
    // the setting exists to prevent.
    expect(() => loadApiConfig({}, { PROXY_URL: "not a url" })).toThrow(AppError);
    // socks5 is the common mistake: ProxyAgent speaks HTTP to the proxy, so
    // this would otherwise fail at the first fetch rather than at startup.
    expect(() => loadApiConfig({}, { PROXY_URL: "socks5://127.0.0.1:1080" })).toThrow(AppError);
  });

  test("a stock deployment verifies certificates, and both TLS settings read env and override", () => {
    // The regression this pins is the one dl-19 exists to prevent, and it is a
    // one-character one: flip this default and every deployment that never
    // heard of the setting silently goes back to downloading video over
    // connections nobody authenticated. The whole suite stayed green under
    // exactly that mutation until this test.
    expect(loadApiConfig({}, {}).ffmpegAllowUnverifiedTls).toBe(false);
    expect(loadApiConfig({}, {}).egressCaFile).toBeUndefined();
    expect(loadApiConfig({}, {}).egressCaFileVar).toBeUndefined();

    // Read from the environment...
    expect(
      loadApiConfig({}, { FFMPEG_ALLOW_UNVERIFIED_TLS: "true" }).ffmpegAllowUnverifiedTls,
    ).toBe(true);
    // `optionalPath` resolves what it reads, so the expectation has to resolve
    // too or this asserts a POSIX separator: on Windows the same input comes
    // back as `D:\etc\corp\root.pem`. What is being pinned is that the variable
    // is *read*, not the shape of the path — `path.resolve` of an absolute path
    // is the identity on POSIX and re-roots it on Windows, so both agree here.
    expect(loadApiConfig({}, { EGRESS_CA_FILE: "/etc/corp/root.pem" }).egressCaFile).toBe(
      path.resolve("/etc/corp/root.pem"),
    );

    // dl-31 renamed it and kept the old spelling working, because the failure
    // of silently ignoring a deployed `FFMPEG_CA_FILE` is a service that
    // refuses the operator's own origins. `egressCaFileVar` is what `server.ts`
    // warns from, so the fallback and the warning cannot drift apart.
    const legacy = loadApiConfig({}, { FFMPEG_CA_FILE: "/etc/corp/root.pem" });
    expect(legacy.egressCaFile).toBe(path.resolve("/etc/corp/root.pem"));
    expect(legacy.egressCaFileVar).toBe("FFMPEG_CA_FILE");

    // The new name wins when both are set, rather than the last one parsed.
    const both = loadApiConfig(
      {},
      { EGRESS_CA_FILE: "/etc/new.pem", FFMPEG_CA_FILE: "/etc/old.pem" },
    );
    expect(both.egressCaFile).toBe(path.resolve("/etc/new.pem"));
    expect(both.egressCaFileVar).toBe("EGRESS_CA_FILE");

    // ...and from an explicit override, which is what `createApp` passes and
    // what every test that builds a config uses.
    expect(loadApiConfig({ ffmpegAllowUnverifiedTls: true }, {}).ffmpegAllowUnverifiedTls).toBe(
      true,
    );
    expect(loadApiConfig({ egressCaFile: "/tmp/fixture.pem" }, {}).egressCaFile).toBe(
      "/tmp/fixture.pem",
    );

    // A value that is neither `true` nor `false` must not be read as consent.
    expect(
      loadApiConfig({}, { FFMPEG_ALLOW_UNVERIFIED_TLS: "ture" }).ffmpegAllowUnverifiedTls,
    ).toBe(false);
  });

  test("interception is on unless it is switched off in so many words", () => {
    // dl-27's default, and the same one-character regression as the test above
    // pointing the other way: this flag defaults to **true**, so flipping the
    // default puts every deployment that never heard of it back on dl-21's
    // unverified segment connections.
    expect(loadApiConfig({}, {}).ffmpegTlsIntercept).toBe(true);

    expect(loadApiConfig({}, { FFMPEG_TLS_INTERCEPT: "false" }).ffmpegTlsIntercept).toBe(false);
    expect(loadApiConfig({ ffmpegTlsIntercept: false }, {}).ffmpegTlsIntercept).toBe(false);

    // **The typo case matters more here than on the flag above, and in the
    // opposite direction.** `FFMPEG_ALLOW_UNVERIFIED_TLS` defaults to off, so an
    // unparseable value there falls back to the safe state by luck of the
    // default. This one defaults to *on*, so the same fallback is what keeps a
    // fat-fingered value from quietly reopening the hole — it is the default
    // that makes the parser's behaviour correct, not the parser.
    expect(loadApiConfig({}, { FFMPEG_TLS_INTERCEPT: "flase" }).ffmpegTlsIntercept).toBe(true);
    expect(loadApiConfig({}, { FFMPEG_TLS_INTERCEPT: "" }).ffmpegTlsIntercept).toBe(true);
    // And the spellings that are meant to work, do.
    expect(loadApiConfig({}, { FFMPEG_TLS_INTERCEPT: "0" }).ffmpegTlsIntercept).toBe(false);
    expect(loadApiConfig({}, { FFMPEG_TLS_INTERCEPT: "OFF" }).ffmpegTlsIntercept).toBe(false);
  });

  test("a usable PROXY_URL survives verbatim, credentials and all", () => {
    // Round-tripping the URL through `new URL().href` would normalise the path
    // and re-encode the credentials, which is not this function's business.
    const raw = "http://user:p%40ss@proxy.internal:3128";
    expect(loadApiConfig({}, { PROXY_URL: raw }).proxyUrl).toBe(raw);
    expect(loadApiConfig({}, { PROXY_URL: "  " }).proxyUrl).toBeUndefined();
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
