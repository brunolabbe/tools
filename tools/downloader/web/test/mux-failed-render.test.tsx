// @vitest-environment jsdom

/**
 * A job record stored before dl-74 that carries `error.code: "MUX_FAILED"`, read
 * back from `downloader:jobs:v1` and drawn, once through `loadJobs` and
 * `JobCard` and once through the whole `App`.
 *
 * Gate 1 found that the code crashed the page: it had no `ERROR_PRESENTATION`
 * entry, so `presentError` threw while rendering. The read-side schema now maps
 * it to `DOWNLOAD_FAILED`, and what this file proves is that the record is still
 * *shown*, with that code's presentation, rather than dropped by the schema or
 * thrown at by the render. A test that only asserted "no throw" would stay green
 * for a dropped record.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock, and
 * `app.test.tsx` for why `App` is imported afresh over a faked
 * `src/api/client.ts`: the fake is replaced here and unmocked after each case.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { JobCard } from "../src/components/JobCard.tsx";
import { loadJobs } from "../src/lib/job-store.ts";
import type { StorageLike } from "../src/lib/job-store.ts";
import { job } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  vi.doUnmock("../src/api/client.ts");
  vi.resetModules();
  globalThis.localStorage.clear();
});

const muxError = {
  code: "MUX_FAILED",
  message: "The video could not be assembled into a playable file.",
  retryable: false,
};

const unused = () => Promise.reject(new Error("not exercised"));

function memory(raw: string): StorageLike {
  return { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
}

function renderCard(value: ReturnType<typeof job>): unknown {
  try {
    render(
      <ul>
        <JobCard
          job={value}
          streamState={undefined}
          watchedStep={undefined}
          onCancel={vi.fn()}
          onRemove={vi.fn()}
          onRetry={vi.fn()}
        />
      </ul>,
    );
    return null;
  } catch (error) {
    return error;
  }
}

describe("stored MUX_FAILED renders without crashing (dl-74)", () => {
  test("loadJobs loads MUX_FAILED record and JobCard renders it without throwing", () => {
    const record = { ...job("failed"), status: "failed", error: muxError };
    const loaded = loadJobs(memory(JSON.stringify([record])));
    const first = loaded[0];
    if (first === undefined) throw new Error("record dropped by schema");
    // The transform should convert MUX_FAILED to DOWNLOAD_FAILED, so the code should be DOWNLOAD_FAILED
    expect(first.error?.code).toBe("DOWNLOAD_FAILED");
    const thrown = renderCard(first);
    expect(thrown).toBeNull();
  });

  test("App shows the stored MUX_FAILED job as a download failure, not a dropped record", async () => {
    vi.resetModules();
    const client = {
      probe: vi.fn(unused),
      createJob: vi.fn(unused),
      getJob: vi.fn(unused),
      cancelJob: vi.fn(unused),
      openJobEvents: vi.fn(() => ({ close: vi.fn() })),
      openProbeEvents: vi.fn(() => ({ close: vi.fn() })),
    };
    vi.doMock("../src/api/client.ts", () => ({
      USING_MOCK_API: false,
      api: client,
    }));
    const record = { ...job("failed"), status: "failed", error: muxError };
    globalThis.localStorage.setItem("downloader:jobs:v1", JSON.stringify([record]));
    const { App } = await import("../src/App.tsx");
    render(<App />);
    // The job card is on the page, with DOWNLOAD_FAILED's own presentation. A
    // record the schema dropped would leave no card and no error panel at all.
    expect(screen.getByRole("heading", { name: "Download failed" })).toBeDefined();
    expect(screen.getByText("DOWNLOAD_FAILED")).toBeDefined();
    expect(screen.queryByText("MUX_FAILED")).toBeNull();
  });
});
