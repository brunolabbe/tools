/**
 * dl-138: a probe or job request that never settles used to keep its slot for
 * the life of the page. `ApiClient.probe` and `ApiClient.createJob` now carry a
 * client timeout, and only those two: `request()` gives every other call none.
 *
 * `fetch` is stubbed to a promise that never settles, which is the stall a
 * dead connection gives, and the clock is fake, so a 90-second bound costs
 * nothing to read.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ROUTES } from "@downloader/contract";
import { createHttpClient } from "../src/api/http.ts";
import type { HumanCheckFactory } from "../src/lib/human-check.ts";

const PROBE_TIMEOUT_MS = 90_000;
const CREATE_JOB_TIMEOUT_MS = 30_000;

const PENDING = Symbol("pending");

/** What a call has settled to, or `PENDING`: reading it never waits on the call. */
function watch(call: Promise<unknown>): () => unknown {
  let outcome: unknown = PENDING;
  call.then(
    (value) => {
      outcome = { resolved: value };
    },
    (error: unknown) => {
      outcome = error;
    },
  );
  return () => outcome;
}

function stallingFetch(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function signalOf(fetchSpy: ReturnType<typeof vi.fn>, path: string): AbortSignal | undefined {
  const call = fetchSpy.mock.calls.find(([target]) => target === path) as
    | [string, RequestInit | undefined]
    | undefined;
  return call?.[1]?.signal ?? undefined;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a probe is still pending just before 90 s and rejects with TIMEOUT at 90 s", async () => {
  const fetchSpy = stallingFetch();
  const outcome = watch(createHttpClient().probe({ url: "https://example.com/watch" }));

  await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
  expect(outcome()).toBe(PENDING);
  expect(signalOf(fetchSpy, ROUTES.probe)?.aborted).not.toBe(true);

  await vi.advanceTimersByTimeAsync(1);
  expect(outcome()).toMatchObject({ code: "TIMEOUT" });
  expect(signalOf(fetchSpy, ROUTES.probe)?.aborted).toBe(true);
});

test("a probe's 90 s runs from the fetch: the human-check wait before it is not counted", async () => {
  const fetchSpy = stallingFetch();
  const slowCheck: HumanCheckFactory = () => ({
    next: () => new Promise((resolve) => setTimeout(() => resolve("token"), 20_000)),
  });
  const outcome = watch(
    createHttpClient({ humanCheck: slowCheck }).probe({ url: "https://example.com/watch" }),
  );

  // The check holds the call for 20 s with no fetch out and no bound running.
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetchSpy).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
  expect(outcome()).toBe(PENDING);

  await vi.advanceTimersByTimeAsync(1);
  expect(outcome()).toMatchObject({ code: "TIMEOUT" });
});

test("a createJob is still pending just before 30 s and rejects with TIMEOUT at 30 s", async () => {
  const fetchSpy = stallingFetch();
  const outcome = watch(createHttpClient().createJob({ url: "https://example.com/watch" }));

  await vi.advanceTimersByTimeAsync(CREATE_JOB_TIMEOUT_MS - 1);
  expect(outcome()).toBe(PENDING);
  expect(signalOf(fetchSpy, ROUTES.jobs)?.aborted).not.toBe(true);

  await vi.advanceTimersByTimeAsync(1);
  expect(outcome()).toMatchObject({ code: "TIMEOUT" });
  expect(signalOf(fetchSpy, ROUTES.jobs)?.aborted).toBe(true);
});

test("a fetch that honours its signal rejects as TIMEOUT too, not as UNREACHABLE", async () => {
  // A real fetch rejects with an AbortError the moment the signal fires, and
  // `request()` maps any fetch rejection to UNREACHABLE: the bound has to say
  // which of the two it was.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_path: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    ),
  );
  const outcome = watch(createHttpClient().createJob({ url: "https://example.com/watch" }));

  await vi.advanceTimersByTimeAsync(CREATE_JOB_TIMEOUT_MS);
  expect(outcome()).toMatchObject({ code: "TIMEOUT" });
});

test("an answer inside the bound is returned, and nothing is left to abort it later", async () => {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ nope: true }), { status: 500 })),
  );
  vi.stubGlobal("fetch", fetchSpy);

  await expect(
    createHttpClient().createJob({ url: "https://example.com/watch" }),
  ).rejects.toMatchObject({ code: "INTERNAL" });

  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
  expect(signalOf(fetchSpy as ReturnType<typeof vi.fn>, ROUTES.jobs)?.aborted).toBe(false);
});

test("the other calls gain no bound: request() is unchanged", async () => {
  const fetchSpy = stallingFetch();
  const client = createHttpClient();
  const calls = [client.getJob("job-1"), client.cancelJob("job-1")].map(watch);

  await vi.advanceTimersByTimeAsync(30 * 60_000);
  for (const outcome of calls) expect(outcome()).toBe(PENDING);
  expect(signalOf(fetchSpy, ROUTES.job("job-1"))).toBeUndefined();
});
