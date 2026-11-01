/**
 * A refusal for asking too often carries the `Retry-After` header's wait as
 * `retryAfterSec` in the error's details (lg-92): the queue of receipt photos
 * waits as long as the header says.
 */

import { afterEach, expect, test, vi } from "vitest";
import { AppError } from "@ledger/contract";
import { requestJson } from "../src/api/client.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function refuse(status: number, code: string, headers: Record<string, string>, details?: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code, message: "No.", retryable: true, details } }),
          { status, headers },
        ),
    ),
  );
}

async function caught(): Promise<AppError> {
  try {
    await requestJson("/api/receipts/3/read", { method: "POST" });
  } catch (error: unknown) {
    return AppError.from(error);
  }
  throw new Error("the request was not refused");
}

test("a 429 carries the Retry-After header's seconds, over the body's copy", async () => {
  refuse(429, "RATE_LIMITED", { "retry-after": "42" }, { scope: "receipt-read", retryAfterSec: 5 });

  const error = await caught();

  expect(error.code).toBe("RATE_LIMITED");
  expect(error.details).toEqual({ scope: "receipt-read", retryAfterSec: 42 });
});

test("a 429 with no header keeps the body's details as they came", async () => {
  refuse(429, "RATE_LIMITED", {}, { scope: "receipt-read", retryAfterSec: 9 });

  expect((await caught()).details).toEqual({ scope: "receipt-read", retryAfterSec: 9 });
});

test("another refusal is not given a wait", async () => {
  refuse(500, "INTERNAL", { "retry-after": "42" });

  expect((await caught()).details).toBeUndefined();
});

// lg-97: Cloudflare's rate limiting rule answers 429 with an HTML page, which
// read as "The API answered 429." until the status alone was enough.
function edgeRefuse(headers: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<!DOCTYPE html><title>Access denied | Error 1015</title>", {
          status: 429,
          headers: { "content-type": "text/html", ...headers },
        }),
    ),
  );
}

test("an edge 429 with no body of ours reads as RATE_LIMITED, with the header's wait (lg-97)", async () => {
  edgeRefuse({ "retry-after": "10" });

  const error = await caught();

  expect(error.code).toBe("RATE_LIMITED");
  expect(error.message).toBe("Too many requests. Try again shortly.");
  expect(error.details).toEqual({ retryAfterSec: 10 });
});

test("an edge 429 with no header carries no wait (lg-97)", async () => {
  edgeRefuse({});

  const error = await caught();

  expect(error.code).toBe("RATE_LIMITED");
  expect(error.details).toBeUndefined();
});

test("another status with no body of ours still names the status (lg-97)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html></html>", { status: 502 })),
  );

  const error = await caught();

  expect(error.code).toBe("INTERNAL");
  expect(error.message).toBe("The API answered 502.");
});
