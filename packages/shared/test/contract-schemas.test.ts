/**
 * The response and event schemas guard boundaries where the bytes are not
 * already type-checked: SSE frames, rehydrated `localStorage`, and rows read
 * back out of the job database. What matters is not that they accept valid
 * data — the compiler already proves the shapes line up via `satisfies` — but
 * that they *reject* the malformed data those boundaries actually produce.
 */

import { describe, expect, test } from "vitest";
import {
  appErrorPayloadSchema,
  ERROR_CODES,
  JOB_STATUSES,
  jobEventSchema,
  jobSchema,
  parseJobEvent,
  probeResultSchema,
} from "../src/index.ts";
import type { Job, JobEvent, JobProgress, ProbeResult } from "../src/index.ts";

const AT = "2026-08-06T10:00:00.000Z";

function progress(): JobProgress {
  return {
    stage: "downloading",
    percent: 42,
    downloadedBytes: 1024,
    totalBytes: 2048,
    segmentsDone: null,
    segmentsTotal: null,
    speedBps: null,
    etaSec: null,
    processedSec: null,
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    sourceUrl: "https://site.example/watch",
    variantId: null,
    variant: null,
    status: "downloading",
    progress: progress(),
    result: null,
    error: null,
    attempts: 1,
    createdAt: AT,
    updatedAt: AT,
    finishedAt: null,
    ...overrides,
  };
}

function probe(): ProbeResult {
  return {
    sourceUrl: "https://site.example/watch",
    resolver: "browser",
    title: "A video",
    variants: [
      {
        id: "v1",
        protocol: "hls",
        url: "https://cdn.example/master.m3u8",
        hasVideo: true,
        hasAudio: true,
        label: "1080p",
      },
    ],
    subtitles: [],
    requestContext: { headers: { Referer: "https://site.example/watch" } },
    drm: { protected: false, systems: [] },
    isLive: false,
    probedAt: AT,
  };
}

describe("taxonomy coverage", () => {
  test("every status and error code the schemas accept comes from the shared list", () => {
    for (const status of JOB_STATUSES) {
      expect(jobSchema.safeParse(job({ status })).success).toBe(true);
    }
    for (const code of ERROR_CODES) {
      const parsed = appErrorPayloadSchema.safeParse({
        code,
        message: "x",
        retryable: false,
      });
      expect(parsed.success).toBe(true);
    }
  });

  test("a status or code this build does not know is rejected, not coerced", () => {
    expect(jobSchema.safeParse(job({ status: "uploading" as never })).success).toBe(false);
    expect(
      appErrorPayloadSchema.safeParse({ code: "KABOOM", message: "x", retryable: false }).success,
    ).toBe(false);
  });
});

describe("jobSchema", () => {
  test("accepts a well-formed job", () => {
    expect(jobSchema.safeParse(job()).success).toBe(true);
  });

  test("rejects the shapes a stale localStorage entry actually produces", () => {
    // Null where the contract requires an object: an older build that had no
    // `progress` field, or a half-written entry.
    expect(jobSchema.safeParse({ ...job(), progress: null }).success).toBe(false);
    // A missing key rather than an explicit null.
    const { finishedAt: _dropped, ...withoutFinishedAt } = job();
    expect(jobSchema.safeParse(withoutFinishedAt).success).toBe(false);
    // Empty id — would key UI state to nothing.
    expect(jobSchema.safeParse(job({ id: "" })).success).toBe(false);
    expect(jobSchema.safeParse(null).success).toBe(false);
    expect(jobSchema.safeParse([]).success).toBe(false);
  });

  test("nullable fields accept null but not undefined", () => {
    expect(jobSchema.safeParse(job({ result: null, error: null })).success).toBe(true);
    expect(jobSchema.safeParse({ ...job(), variantId: undefined }).success).toBe(false);
  });
});

describe("probeResultSchema", () => {
  test("accepts a resolver's output", () => {
    expect(probeResultSchema.safeParse(probe()).success).toBe(true);
  });

  test("rejects a variant missing the fields the picker and engine both read", () => {
    const broken = probe();
    const [variant] = broken.variants;
    if (variant === undefined) throw new Error("fixture has no variant");
    expect(
      probeResultSchema.safeParse({
        ...broken,
        variants: [{ ...variant, protocol: "carrier-pigeon" }],
      }).success,
    ).toBe(false);
    expect(
      probeResultSchema.safeParse({ ...broken, variants: [{ ...variant, hasVideo: "yes" }] })
        .success,
    ).toBe(false);
  });
});

describe("jobEventSchema", () => {
  const events: JobEvent[] = [
    { type: "status", jobId: "j", status: "probing", at: AT },
    { type: "progress", jobId: "j", progress: progress(), at: AT },
    { type: "probed", jobId: "j", probe: probe(), at: AT },
    {
      type: "completed",
      jobId: "j",
      result: {
        filename: "v.mp4",
        sizeBytes: 10,
        container: "mp4",
        durationSec: null,
        downloadUrl: "/api/files/abc",
        expiresAt: AT,
      },
      at: AT,
    },
    {
      type: "failed",
      jobId: "j",
      error: { code: "DOWNLOAD_FAILED", message: "no", retryable: true },
      at: AT,
    },
    {
      type: "canceled",
      jobId: "j",
      error: { code: "JOB_CANCELED", message: "stopped", retryable: false },
      at: AT,
    },
    { type: "heartbeat", at: AT },
  ];

  test("round-trips every frame in the union", () => {
    for (const event of events) {
      expect(jobEventSchema.safeParse(event).success).toBe(true);
      expect(parseJobEvent(JSON.stringify(event))).toEqual(event);
    }
  });

  test("the union covers every JobEvent variant", () => {
    // Adding a frame type without a test case here should be visible.
    const covered = new Set(events.map((event) => event.type));
    expect([...covered].toSorted()).toEqual([
      "canceled",
      "completed",
      "failed",
      "heartbeat",
      "probed",
      "progress",
      "status",
    ]);
  });

  test("a canceled frame carries the reason, so a listen-only client need not synthesise it", () => {
    const parsed = jobEventSchema.safeParse(events.find((event) => event.type === "canceled"));
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "canceled") {
      expect(parsed.data.error.code).toBe("JOB_CANCELED");
      expect(parsed.data.error.retryable).toBe(false);
    }
  });
});

describe("parseJobEvent", () => {
  test("returns null rather than throwing on the junk an SSE channel can deliver", () => {
    expect(parseJobEvent("{")).toBeNull();
    expect(parseJobEvent("")).toBeNull();
    expect(parseJobEvent("null")).toBeNull();
    expect(parseJobEvent(JSON.stringify({ type: "nope", at: AT }))).toBeNull();
    // Right type, wrong payload — the discriminated union catches it.
    expect(parseJobEvent(JSON.stringify({ type: "status", jobId: "j", at: AT }))).toBeNull();
    expect(
      parseJobEvent(JSON.stringify({ type: "status", jobId: "j", status: "flying", at: AT })),
    ).toBeNull();
    // Heartbeats carry no jobId, but they do carry a timestamp.
    expect(parseJobEvent(JSON.stringify({ type: "heartbeat" }))).toBeNull();
  });
});
