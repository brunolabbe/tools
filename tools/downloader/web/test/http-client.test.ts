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

/**
 * Just enough of `EventSource` for `openJobEvents`: jsdom has none, and the
 * transport touches only `addEventListener` and `close`.
 */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  readonly url: string;
  closed = false;
  readonly #listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  send(data: unknown): void {
    for (const listener of this.#listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data: JSON.stringify(data) }));
    }
  }
}

test("a frame of a type this bundle does not know is dropped, and the stream carries on (dl-110)", () => {
  // What a tab opened before a deploy meets when the server learns a new frame,
  // as `stage` was new in dl-110: if this reconnected or failed the job, every
  // old tab would break for the length of the deploy.
  vi.stubGlobal("EventSource", FakeEventSource);
  const handlers = { onOpen: vi.fn(), onEvent: vi.fn(), onError: vi.fn() };

  createHttpClient().openJobEvents("job-1", handlers);
  const source = FakeEventSource.last;
  expect(source?.url).toBe(ROUTES.jobEvents("job-1"));

  const at = "2026-10-12T12:00:00.000Z";
  source?.send({ type: "from-the-future", jobId: "job-1", at });
  // A known type carrying a value outside this bundle's vocabulary, as a stage
  // added to `PROBE_STAGES` after it was built would be.
  source?.send({ type: "stage", jobId: "job-1", stage: "teleport", resolver: "browser", at });
  expect(handlers.onEvent).not.toHaveBeenCalled();
  expect(handlers.onError).not.toHaveBeenCalled();
  expect(source?.closed).toBe(false);

  // The control: the same stream still delivers a frame it does know.
  source?.send({ type: "status", jobId: "job-1", status: "probing", at });
  expect(handlers.onEvent).toHaveBeenCalledTimes(1);
  expect(handlers.onEvent).toHaveBeenCalledWith({
    type: "status",
    jobId: "job-1",
    status: "probing",
    at,
  });
});
