// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { JobCard } from "../src/components/JobCard.tsx";
import { loadJobs } from "../src/lib/job-store.ts";
import type { StorageLike } from "../src/lib/job-store.ts";
import { job } from "./fixtures.ts";

afterEach(cleanup);

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
    console.log("loaded.length =", loaded.length, "code =", loaded[0]?.error?.code);
    const first = loaded[0];
    if (first === undefined) throw new Error("record dropped by schema");
    // The transform should convert MUX_FAILED to DOWNLOAD_FAILED, so the code should be DOWNLOAD_FAILED
    expect(first.error?.code).toBe("DOWNLOAD_FAILED");
    const thrown = renderCard(first);
    console.log("JobCard render threw:", String(thrown));
    expect(thrown).toBeNull();
  });

  test("App renders with stored MUX_FAILED record without throwing", async () => {
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
    let thrown: unknown = null;
    try {
      render(<App />);
    } catch (error) {
      thrown = error;
    }
    console.log("App render threw:", String(thrown));
    expect(thrown).toBeNull();
  });
});
