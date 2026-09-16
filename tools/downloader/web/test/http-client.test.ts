/**
 * The real transport's request shape, against a stubbed `fetch`.
 *
 * dl-65: every request used to declare `Content-Type: application/json`,
 * including the body-less `POST` that cancels a job. Fastify refuses an empty
 * body declared as JSON before any route runs, and the error handler reports
 * that as `INTERNAL` — so cancel never reached the server's cancel route, and
 * the download it was meant to stop kept running.
 */

import { afterEach, expect, test, vi } from "vitest";
import { ROUTES } from "@downloader/contract";
import { createHttpClient } from "../src/api/http.ts";
import { job } from "./fixtures.ts";

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchSpy = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ job: job("canceled") }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function headersOf(fetchSpy: ReturnType<typeof vi.fn>): Headers {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("cancelling a job sends no body and declares none", async () => {
  const fetchSpy = stubFetch();

  await createHttpClient().cancelJob("job-1");

  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(fetchSpy.mock.calls[0]?.[0]).toBe(ROUTES.cancelJob("job-1"));
  expect(init?.method).toBe("POST");
  expect(init?.body).toBeUndefined();
  expect(headersOf(fetchSpy).has("Content-Type")).toBe(false);
});

test("a request with a body still declares it as JSON", async () => {
  const fetchSpy = stubFetch();

  await createHttpClient().createJob({ url: "https://example.com/watch" });

  expect(headersOf(fetchSpy).get("Content-Type")).toBe("application/json");
});
