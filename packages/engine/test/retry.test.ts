import { afterEach, describe, expect, test, vi } from "vitest";
import { AppError } from "@downloader/shared";
import { SYSTEM_CLOCK } from "../src/config.ts";
import {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  parseRetryAfter,
  resolveRetryPolicy,
  withRetry,
} from "../src/download/retry.ts";

/** Deterministic stand-in for Math.random, cycling through fixed values. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length] as number;
    index += 1;
    return value;
  };
}

describe("backoffDelayMs", () => {
  test("doubles from the base delay", () => {
    const policy = resolveRetryPolicy({ baseMs: 100, maxMs: 10_000, jitter: 0, random: () => 0 });

    expect(backoffDelayMs(1, policy)).toBe(100);
    expect(backoffDelayMs(2, policy)).toBe(200);
    expect(backoffDelayMs(3, policy)).toBe(400);
    expect(backoffDelayMs(4, policy)).toBe(800);
  });

  test("caps at maxMs instead of growing without bound", () => {
    const policy = resolveRetryPolicy({ baseMs: 1000, maxMs: 5000, jitter: 0, random: () => 0 });
    expect(backoffDelayMs(10, policy)).toBe(5000);
    expect(backoffDelayMs(50, policy)).toBe(5000);
  });

  test("jitter spreads the delay so simultaneous failures do not resynchronise", () => {
    const policy = resolveRetryPolicy({
      baseMs: 1000,
      maxMs: 60_000,
      jitter: 0.5,
      random: sequence([0, 0.5, 1]),
    });

    // With jitter 0.5 the delay lands in [50%, 100%] of the computed backoff.
    expect(backoffDelayMs(1, policy)).toBe(500);
    expect(backoffDelayMs(1, policy)).toBe(750);
    expect(backoffDelayMs(1, policy)).toBe(1000);
  });

  test("full jitter reaches zero", () => {
    const policy = resolveRetryPolicy({ baseMs: 1000, jitter: 1, random: () => 0 });
    expect(backoffDelayMs(3, policy)).toBe(0);
  });

  test("the default policy actually randomises", () => {
    expect(DEFAULT_RETRY_POLICY.jitter).toBeGreaterThan(0);
    expect(DEFAULT_RETRY_POLICY.random).toBe(Math.random);
  });
});

describe("parseRetryAfter", () => {
  test("reads delta-seconds", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
    expect(parseRetryAfter("0", 0)).toBe(0);
  });

  test("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-08-05T12:00:00Z");
    expect(parseRetryAfter("Wed, 05 Aug 2026 12:00:30 GMT", now)).toBe(30_000);
  });

  test("never returns a negative delay for a date in the past", () => {
    const now = Date.parse("2026-08-05T12:00:00Z");
    expect(parseRetryAfter("Wed, 05 Aug 2026 11:59:00 GMT", now)).toBe(0);
  });

  test("ignores absent and unparsable values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("   ")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

/** Instant sleep that records what it was asked to wait for. */
const recordingSleep =
  (into: number[]) =>
  async (ms: number): Promise<void> => {
    into.push(ms);
  };

describe("withRetry", () => {
  test("retries retryable failures and reports the backoff sequence", async () => {
    const delays: number[] = [];
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new AppError("DOWNLOAD_FAILED");
        return "ok";
      },
      {
        policy: { maxAttempts: 5, baseMs: 100, maxMs: 10_000, jitter: 0, random: () => 0 },
        sleep: recordingSleep(delays),
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  test("gives up after maxAttempts and rethrows the last error", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new AppError("DOWNLOAD_FAILED");
        },
        {
          policy: { maxAttempts: 3, baseMs: 10, jitter: 0, random: () => 0 },
          sleep: recordingSleep(delays),
        },
      ),
    ).rejects.toMatchObject({ code: "DOWNLOAD_FAILED" });

    expect(attempts).toBe(3);
    expect(delays).toHaveLength(2);
  });

  test("does not retry a terminal code — VARIANT_GONE needs a re-probe, not a repeat", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new AppError("SIZE_LIMIT_EXCEEDED");
        },
        { policy: { maxAttempts: 5 }, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({
      code: "SIZE_LIMIT_EXCEEDED",
    });
    expect(attempts).toBe(1);
  });

  test("never retries a cancellation", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new AppError("JOB_CANCELED");
        },
        { policy: { maxAttempts: 5 }, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({
      code: "JOB_CANCELED",
    });
    expect(attempts).toBe(1);
  });

  test("Retry-After overrides the computed backoff", async () => {
    const delays: number[] = [];
    let attempts = 0;

    await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new AppError("RATE_LIMITED", undefined, {
            retryable: true,
            details: { retryAfterMs: 4500 },
          });
        }
        return "ok";
      },
      {
        policy: { maxAttempts: 3, baseMs: 100, jitter: 0, random: () => 0 },
        sleep: recordingSleep(delays),
      },
    );

    expect(delays).toEqual([4500]);
  });

  test("stops before the first attempt when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts += 1;
          return "never";
        },
        { signal: controller.signal, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({
      code: "JOB_CANCELED",
    });
    expect(attempts).toBe(0);
  });
});

describe("SYSTEM_CLOCK.sleep", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("waits the requested time on the real timer wheel", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const pending = SYSTEM_CLOCK.sleep(5000).then(() => {
      resolved = true;
      return resolved;
    });

    await vi.advanceTimersByTimeAsync(4999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(resolved).toBe(true);
  });

  test("rejects with JOB_CANCELED when aborted mid-sleep", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = SYSTEM_CLOCK.sleep(60_000, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: "JOB_CANCELED" });

    controller.abort();
    await assertion;
  });

  test("a retry loop driven by the real clock respects fake timers end to end", async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const pending = withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new AppError("DOWNLOAD_FAILED");
        return attempts;
      },
      {
        policy: { maxAttempts: 4, baseMs: 1000, jitter: 0, random: () => 0 },
        sleep: (ms, signal) => SYSTEM_CLOCK.sleep(ms, signal),
      },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toBe(3);
  });
});
