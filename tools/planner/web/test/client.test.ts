/**
 * pl-67: Cloudflare's rate limiting rule on `/api/` answers 429 with an HTML
 * page, which read as "The API answered 429." until the status alone was enough.
 */

import { afterEach, expect, test, vi } from "vitest";
import { AppError } from "@planner/contract";
import { requestJson } from "../src/api/client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function edgeAnswer(status: number, headers: Record<string, string> = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<!DOCTYPE html><title>Access denied | Error 1015</title>", {
          status,
          headers: { "content-type": "text/html", ...headers },
        }),
    ),
  );
}

async function caught(): Promise<AppError> {
  try {
    await requestJson("/api/plans");
  } catch (error: unknown) {
    return AppError.from(error);
  }
  throw new Error("the request was not refused");
}

test("an edge 429 with no body of ours reads as RATE_LIMITED, with the header's wait", async () => {
  edgeAnswer(429, { "retry-after": "10" });

  const error = await caught();

  expect(error.code).toBe("RATE_LIMITED");
  expect(error.message).toBe("Too many requests. Try again shortly.");
  expect(error.details).toEqual({ retryAfterSec: 10 });
});

test("an edge 429 with no header carries no wait", async () => {
  edgeAnswer(429);

  const error = await caught();

  expect(error.code).toBe("RATE_LIMITED");
  expect(error.details).toBeUndefined();
});

test("another status with no body of ours still names the status", async () => {
  edgeAnswer(502);

  const error = await caught();

  expect(error.code).toBe("INTERNAL");
  expect(error.message).toBe("The API answered 502.");
});
