// @vitest-environment jsdom

/**
 * The cache's one retry (lg-98): a read refused as `RATE_LIMITED` is tried once
 * more after the wait the refusal names (lg-92, lg-97), capped at 15 s; any other
 * failure is shown at once, as it was before the cache. These run on the app's
 * own client, retries on, where every other suite turns them off.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { BucketsResponse } from "@ledger/contract";
import { fetchBuckets } from "../src/api/buckets.ts";
import { fetchMortgage, saveMortgage } from "../src/api/mortgage.ts";
import { Home } from "../src/home/Home.tsx";
import { useWrite } from "../src/writes.ts";
import {
  RATE_LIMIT_WAIT_DEFAULT_SEC,
  RATE_LIMIT_WAIT_MAX_SEC,
  createQueryClient,
  retryRead,
  retryReadDelay,
} from "../src/query.ts";
import { LIVE } from "./mortgage-fixtures.ts";
import { clientWrapper, renderWithClient } from "./render-with-client.tsx";

vi.mock("../src/api/buckets.ts", () => ({ fetchBuckets: vi.fn() }));
vi.mock("../src/api/mortgage.ts", () => ({ fetchMortgage: vi.fn(), saveMortgage: vi.fn() }));

const buckets = vi.mocked(fetchBuckets);

const FIGURES: BucketsResponse = {
  asOf: "2026-10-03",
  mortgage: { balanceCents: 0, own: [], lead: null },
  buffer: { balanceCents: 13000, contributions: [] },
  unclassified: 0,
};

function limited(retryAfterSec?: number): AppError {
  return new AppError(
    "RATE_LIMITED",
    undefined,
    retryAfterSec === undefined ? {} : { details: { retryAfterSec } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMortgage).mockResolvedValue(LIVE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test("a RATE_LIMITED read is retried once, and nothing else is (lg-98)", () => {
  expect(retryRead(0, limited(3))).toBe(true);
  expect(retryRead(1, limited(3))).toBe(false);
  for (const code of ["UNREACHABLE", "TIMEOUT", "INTERNAL", "FORBIDDEN"] as const) {
    expect(retryRead(0, new AppError(code))).toBe(false);
  }
  expect(retryRead(0, new Error("not ours"))).toBe(false);
});

test("the retry waits retryAfterSec, capped at 15 s, and 10 s when none is named (lg-98)", () => {
  expect(retryReadDelay(0, limited(3))).toBe(3_000);
  expect(retryReadDelay(0, limited(60))).toBe(RATE_LIMIT_WAIT_MAX_SEC * 1_000);
  expect(retryReadDelay(0, limited())).toBe(RATE_LIMIT_WAIT_DEFAULT_SEC * 1_000);
});

test("a screen whose read is rate limited reads again after retryAfterSec, and shows the answer (lg-98)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  buckets.mockRejectedValueOnce(limited(4)).mockResolvedValue(FIGURES);
  renderWithClient(<Home />, { client: createQueryClient() });

  await waitFor(() => expect(buckets).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(3_500);
  // Not before the wait the refusal named: still the one request, and still loading.
  expect(buckets).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Adding up the buckets…")).toBeTruthy();

  await vi.advanceTimersByTimeAsync(1_000);
  expect(await screen.findByText("130.00 $")).toBeTruthy();
  expect(buckets).toHaveBeenCalledTimes(2);
});

test("a read rate limited twice is shown as refused after its one retry (lg-98)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  buckets.mockRejectedValue(limited(2));
  renderWithClient(<Home />, { client: createQueryClient() });

  await waitFor(() => expect(buckets).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(2_500);

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Too many requests. Try again shortly.",
  );
  expect(buckets).toHaveBeenCalledTimes(2);
});

test.each([
  ["UNREACHABLE", "The ledger API is not answering."],
  ["INTERNAL", "The API answered 502."],
] as const)(
  "any other failure (%s) is shown at once, in its own words, with no retry (lg-98)",
  async (code, message) => {
    buckets.mockRejectedValue(new AppError(code, message));
    renderWithClient(<Home />, { client: createQueryClient() });

    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(buckets).toHaveBeenCalledTimes(1);
  },
);

// Gate 1's F4: a write appends, so a second copy sent on its own would be a second
// record. Refused for any reason, the rate limit included, it is sent once.
test.each([
  ["RATE_LIMITED", limited(1)],
  ["UNREACHABLE", new AppError("UNREACHABLE")],
] as const)(
  "a write refused as %s is never sent again on its own (lg-98)",
  async (_code, refusal) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.mocked(saveMortgage).mockRejectedValue(refusal);
    const { result } = renderHook(() => useWrite("saveMortgage"), {
      wrapper: clientWrapper(createQueryClient()),
    });

    let settled: Promise<unknown> = Promise.resolve();
    act(() => {
      settled = result.current({ state: "live" }).catch((error: unknown) => error);
    });
    // Past any wait a retry could take: the library's own backoff tops out at 30 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(await settled).toBe(refusal);
    expect(save).toHaveBeenCalledTimes(1);
  },
);
