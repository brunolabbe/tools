import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AppError,
  ERROR_CODES,
  RETRYABLE_CODES,
  ROUTES,
  canTransition,
  createJobRequestSchema,
  jobEventSchema,
  jobSchema,
  jobOptionsSchema,
  probeRequestSchema,
  sourceUrlSchema,
} from "@downloader/contract";
import type { ErrorCode, Job, JobEvent, JobOptions } from "@downloader/contract";
import { createMockClient } from "../src/api/mock.ts";
import { SCENARIOS, baseProbeResult, findScenario, scenarioUrl } from "../src/api/scenarios.ts";
import type { ApiClient } from "../src/api/types.ts";

import { applyJobEvents } from "../src/lib/job-reducer.ts";
import { pickDefaultVariantId } from "../src/lib/variants.ts";

let api: ApiClient;

beforeEach(() => {
  vi.useFakeTimers();
  api = createMockClient();
});

afterEach(() => {
  vi.useRealTimers();
});

interface Run {
  job: Job;
  events: JobEvent[];
  errors: number;
  opens: number;
}

async function run(url: string, options: JobOptions = {}, ms = 40_000): Promise<Run> {
  const { job } = await api.createJob({ url, options });
  const events: JobEvent[] = [];
  let errors = 0;
  let opens = 0;
  const stream = api.openJobEvents(job.id, {
    onOpen: () => {
      opens += 1;
    },
    onEvent: (event) => events.push(event),
    onError: () => {
      errors += 1;
    },
  });
  await vi.advanceTimersByTimeAsync(ms);
  stream.close();
  return { job, events, errors, opens };
}

async function expectRejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected the call to reject");
}

describe("request validation against the shared zod schemas", () => {
  test("the probe request the UI sends parses", () => {
    const request = { url: scenarioUrl("") };
    expect(probeRequestSchema.safeParse(request).success).toBe(true);
  });

  test("the mock rejects what the schema rejects", async () => {
    const error = await expectRejection(api.probe({ url: "not-a-url" }));
    expect(error.code).toBe("INVALID_URL");

    const scheme = await expectRejection(api.probe({ url: "file:///etc/passwd" }));
    expect(scheme.code).toBe("INVALID_URL");
  });

  test("the option set the picker produces satisfies jobOptionsSchema", async () => {
    const probePromise = api.probe({ url: scenarioUrl("") });
    await vi.advanceTimersByTimeAsync(5_000);
    const { probe } = await probePromise;

    const options: JobOptions = {
      variantId: pickDefaultVariantId(probe.variants) ?? undefined,
      container: "mp4",
      audioOnly: false,
      embedSubtitles: true,
      subtitleLanguages: [...new Set(probe.subtitles.map((track) => track.language))],
    };
    expect(jobOptionsSchema.safeParse(options).success).toBe(true);
    expect(createJobRequestSchema.safeParse({ url: probe.sourceUrl, options }).success).toBe(true);
  });
});

describe("probe results", () => {
  test("are internally consistent and use real URLs", async () => {
    const promise = api.probe({ url: scenarioUrl("") });
    await vi.advanceTimersByTimeAsync(5_000);
    const { probe, cached } = await promise;

    expect(cached).toBe(false);
    expect(sourceUrlSchema.safeParse(probe.sourceUrl).success).toBe(true);
    expect(probe.variants.length).toBeGreaterThan(0);
    expect(new Set(probe.variants.map((variant) => variant.id)).size).toBe(probe.variants.length);
    for (const variant of probe.variants) {
      expect(sourceUrlSchema.safeParse(variant.url).success).toBe(true);
      expect(variant.label.length).toBeGreaterThan(0);
      if (variant.filesizeIsEstimate) expect(typeof variant.filesizeBytes).toBe("number");
    }
    expect(probe.drm.protected).toBe(false);
    expect(Object.keys(probe.requestContext.headers)).toContain("Referer");
    expect(Number.isFinite(Date.parse(probe.probedAt))).toBe(true);
  });

  test("every probe-time scenario rejects with its declared code", async () => {
    for (const scenario of SCENARIOS) {
      if (!scenario.probeError) continue;
      const promise = api.probe({ url: scenarioUrl(scenario.keyword) });
      const rejection = expectRejection(promise);
      await vi.advanceTimersByTimeAsync(scenario.probeDelayMs + 100);
      expect((await rejection).code).toBe(scenario.probeError);
    }
  });

  test("DRM is reported as non-retryable with evidence", async () => {
    const promise = api.probe({ url: scenarioUrl("drm") });
    const rejection = expectRejection(promise);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await rejection;
    expect(error.code).toBe("DRM_PROTECTED");
    expect(error.toPayload().retryable).toBe(false);
    expect(error.details?.["systems"]).toEqual(["widevine"]);
  });
});

describe("job event streams", () => {
  test("a happy-path run emits well-formed frames and folds to the server's job", async () => {
    const { job, events, errors } = await run(scenarioUrl(""));

    expect(errors).toBe(0);
    expect(events.length).toBeGreaterThan(5);
    for (const event of events) expect(jobEventSchema.safeParse(event).success).toBe(true);
    expect(events.some((event) => event.type === "heartbeat")).toBe(true);
    expect(events.some((event) => event.type === "probed")).toBe(true);

    // Every status frame is a legal FSM transition from the one before it.
    let status = job.status;
    for (const event of events) {
      if (event.type !== "status") continue;
      expect(canTransition(status, event.status)).toBe(true);
      status = event.status;
    }

    const folded = applyJobEvents(job, events);
    const server = (await api.getJob(job.id)).job;
    expect(jobSchema.safeParse(server).success).toBe(true);
    expect(folded).toEqual(server);
    expect(server.status).toBe("completed");
    expect(server.result).not.toBeNull();
    expect(server.result?.downloadUrl.startsWith(ROUTES.file(""))).toBe(true);
    expect(Date.parse(server.result?.expiresAt ?? "")).toBeGreaterThan(Date.now());
  });

  test("determinate progress is monotonic and reaches 100", async () => {
    const { events } = await run(scenarioUrl(""));
    const percents = events
      .filter((event) => event.type === "progress" && event.progress.stage === "downloading")
      .map((event) => (event.type === "progress" ? event.progress.percent : null));

    expect(percents.length).toBeGreaterThan(0);
    let previous = -1;
    for (const percent of percents) {
      expect(percent).not.toBeNull();
      expect(percent!).toBeGreaterThanOrEqual(previous);
      previous = percent!;
    }
    expect(previous).toBe(100);
  });

  test("the indeterminate scenario never reports a percentage", async () => {
    const { events } = await run(scenarioUrl("indeterminate"));
    const progress = events.filter((event) => event.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (const event of progress) {
      if (event.type !== "progress") continue;
      expect(event.progress.percent).toBeNull();
      expect(event.progress.totalBytes).toBeNull();
      expect(event.progress.etaSec).toBeNull();
      // Bytes and speed are still real measurements; only the total is unknown.
      expect(event.progress.downloadedBytes).toBeGreaterThanOrEqual(0);
    }
  });

  test("a dropped stream loses frames, and the refetch is what repairs the state", async () => {
    const { job, events, errors } = await run(scenarioUrl("flaky"));
    expect(errors).toBeGreaterThan(0);

    const folded = applyJobEvents(job, events);
    const server = (await api.getJob(job.id)).job;
    expect(server.status).toBe("completed");
    // The client that only listened is behind; reconciliation is not optional.
    expect(folded.status).not.toBe(server.status);
  });

  test("every job-time failure scenario ends failed with its declared code", async () => {
    for (const scenario of SCENARIOS) {
      if (!scenario.job.failWith) continue;
      const { job } = await run(scenarioUrl(scenario.keyword));
      const server = (await api.getJob(job.id)).job;
      expect(server.status).toBe("failed");
      expect(server.error?.code).toBe(scenario.job.failWith);
      expect(server.error?.retryable).toBe(RETRYABLE_CODES.has(scenario.job.failWith));
      expect(server.finishedAt).not.toBeNull();
    }
  });

  test("the expired scenario publishes a result already past its retention window", async () => {
    const { job } = await run(scenarioUrl("expired"));
    const server = (await api.getJob(job.id)).job;
    expect(server.status).toBe("completed");
    expect(Date.parse(server.result?.expiresAt ?? "")).toBeLessThan(Date.now());
  });
});

describe("live streams", () => {
  test("refuse to start without a recording duration", async () => {
    const error = await expectRejection(api.createJob({ url: scenarioUrl("live") }));
    expect(error.code).toBe("LIVE_STREAM_UNSUPPORTED");
  });

  test("run with indeterminate progress once a duration is given", async () => {
    const { job } = await run(scenarioUrl("live"), { liveDurationSec: 300 });
    const server = (await api.getJob(job.id)).job;
    expect(server.status).toBe("completed");
    expect(server.progress.percent).toBeNull();
  });
});

describe("job lifecycle", () => {
  test("cancel moves the job to canceled and stops the timeline", async () => {
    const { job } = await api.createJob({ url: scenarioUrl(""), options: {} });
    const events: JobEvent[] = [];
    api.openJobEvents(job.id, {
      onOpen: () => undefined,
      onEvent: (event) => events.push(event),
      onError: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    const canceled = (await api.cancelJob(job.id)).job;
    expect(canceled.status).toBe("canceled");
    expect(canceled.finishedAt).not.toBeNull();

    const before = events.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(events).toHaveLength(before);
  });

  test("an unknown job id is JOB_NOT_FOUND, and its stream simply fails", async () => {
    const error = await expectRejection(api.getJob("does-not-exist"));
    expect(error.code).toBe("JOB_NOT_FOUND");

    let errors = 0;
    api.openJobEvents("does-not-exist", {
      onOpen: () => undefined,
      onEvent: () => undefined,
      onError: () => {
        errors += 1;
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(errors).toBe(1);
  });

  test("a completed job's link is on getJob, now the only way to reach one", async () => {
    // What survives dl-32 from the pair this used to be. The mock carried a
    // list method beside `getJob`, mirroring the API route both are gone with,
    // so `getJob` is the whole of how the UI reaches a finished job. There is
    // no assertion here that the list is absent: `ApiClient` no longer declares
    // it, so a mock that grew one back would not compile.
    const { job } = await run(scenarioUrl(""));

    const served = (await api.getJob(job.id)).job;
    expect(served.status).toBe("completed");
    expect(served.result?.downloadUrl.startsWith(ROUTES.file(""))).toBe(true);
    expect(jobSchema.safeParse(served).success).toBe(true);
  });
});

describe("scenario coverage", () => {
  test("path-segment matching does not hijack ordinary URLs", () => {
    expect(findScenario("https://news.example.com/deliver/story").keyword).toBe("");
    expect(findScenario("https://videos.example.com/watch/live").keyword).toBe("live");
    expect(findScenario("not a url").keyword).toBe("");
  });

  test("the base probe carries a preview and at least one scenario carries none", () => {
    // "No preview" is the path that must not break and the common case for a
    // resolver that found nothing, so the table has to be able to show both.
    // `thumbnailPath`, never `thumbnailUrl`: the real API strips the origin URL
    // and sends only its own path, and a mock carrying the other field would let
    // a component work against a shape the server never sends.
    const base = baseProbeResult(scenarioUrl(""), "2026-08-20T12:00:00.000Z");
    expect(base.thumbnailPath).toBeDefined();
    expect(base.thumbnailUrl).toBeUndefined();

    const withoutPreview = SCENARIOS.filter(
      (scenario) => scenario.probe?.(base).thumbnailPath === undefined,
    );
    expect(withoutPreview.map((scenario) => scenario.keyword)).toContain("nopreview");
  });

  test("every ErrorCode is demonstrable", () => {
    const fromScenarios = new Set<ErrorCode>();
    for (const scenario of SCENARIOS) {
      if (scenario.probeError) fromScenarios.add(scenario.probeError);
      if (scenario.job.failWith) fromScenarios.add(scenario.job.failWith);
    }
    // Reachable through interaction rather than a scenario URL.
    const fromInteraction: ErrorCode[] = [
      "INVALID_URL",
      "JOB_CANCELED",
      "JOB_NOT_FOUND",
      "FILE_EXPIRED",
      "LIVE_STREAM_UNSUPPORTED",
    ];
    for (const code of fromInteraction) fromScenarios.add(code);

    // Not demonstrable here, and not a gap: the mock answers the routes it
    // implements, so nothing it can be asked for produces a route miss. The
    // real server raises this one, and only for a URL it has no handler for.
    //
    // `THUMBNAIL_NOT_FOUND` joins it for a related reason: a preview is fetched
    // by the browser's own `<img>` against `/api/thumbnail/:token`, which is a
    // route the mock has no way to serve — its scenarios carry an inline
    // `data:` URI instead. A miss there reaches `Preview`'s `onError`, never
    // this transport. `api/test/routes.test.ts` is where the code is proven.
    const notReachableInTheMock: ErrorCode[] = ["NOT_FOUND", "THUMBNAIL_NOT_FOUND"];
    for (const code of notReachableInTheMock) fromScenarios.add(code);

    const missing = ERROR_CODES.filter((code) => !fromScenarios.has(code));
    expect(missing).toEqual([]);
  });
});
