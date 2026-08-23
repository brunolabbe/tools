// @vitest-environment jsdom

/**
 * The app shell: the two things about it that only exist at this level.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than
 * a vitest project of its own.
 *
 * **The fake is `src/api/client.ts`, never `fetch` and never `EventSource`.**
 * That module is the whole mock-to-real switch — it exports the chosen transport
 * and the `USING_MOCK_API` flag that came with it — so replacing it replaces
 * everything the app knows about the outside world in one place. It is also the
 * only way to vary `USING_MOCK_API`, which is a module-level const computed from
 * `import.meta.env` at build time. `job-stream.test.ts` deals with jsdom having
 * no `EventSource` by injecting the stream factory rather than faking the global,
 * and this file inherits that: `openJobEvents` is a stub on the fake client.
 *
 * Because the flag is decided when the module is evaluated, each case resets the
 * registry and imports `App` afresh — `vi.mock` at the top of the file could only
 * express one answer, and this file needs both.
 *
 * The trap this file exists to avoid is testing the mock transport as though it
 * were the product. Nothing here imports `src/api/mock.ts`; `mock-api.test.ts`
 * owns that.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AppError, ProbeResponse } from "@downloader/contract";
import type { ApiClient } from "../src/api/types.ts";
import { NOW, probe } from "./fixtures.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type AppErrorClass = typeof AppError;

interface Fake {
  client: ApiClient;
  probes: Deferred<ProbeResponse>[];
  /**
   * The contract's `AppError` **from the same module registry the app is using.**
   * `vi.resetModules()` means a statically imported one is a different class
   * object, `instanceof` fails inside `AppError.from`, and every rejection this
   * file raised would reach the screen as `INTERNAL` — a test that looks like it
   * is asserting the taxonomy while asserting the fallback.
   */
  AppError: AppErrorClass;
}

async function mountApp(usingMock: boolean): Promise<Fake> {
  vi.resetModules();
  const { AppError: Errors } = await import("@downloader/contract");
  const probes: Deferred<ProbeResponse>[] = [];
  const unused = (code: "INTERNAL" | "JOB_NOT_FOUND") => () =>
    Promise.reject(new Errors(code, "not exercised by this suite"));
  const client: ApiClient = {
    probe: vi.fn(() => {
      const next = deferred<ProbeResponse>();
      probes.push(next);
      return next.promise;
    }),
    createJob: vi.fn(unused("INTERNAL")),
    getJob: vi.fn(unused("JOB_NOT_FOUND")),
    listJobs: vi.fn(() => Promise.resolve({ jobs: [], total: 0 })),
    cancelJob: vi.fn(unused("JOB_NOT_FOUND")),
    openJobEvents: vi.fn(() => ({ close: vi.fn() })),
  };

  vi.doMock("../src/api/client.ts", () => ({ USING_MOCK_API: usingMock, api: client }));
  const { App } = await import("../src/App.tsx");
  render(<App />);
  return { client, probes, AppError: Errors };
}

/** Lets the pending promise chains inside `analyse` run, with no timer involved. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  globalThis.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.doUnmock("../src/api/client.ts");
  vi.resetModules();
});

function analyse(url: string): void {
  fireEvent.change(screen.getByLabelText("Page address"), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
}

// ---------------------------------------------------------------------------
// The mock banner
// ---------------------------------------------------------------------------

test("a mocked build admits it, and offers the scenarios that reach every branch", async () => {
  await mountApp(true);

  // `e2e/download.spec.ts` asserts a *built* bundle carries no admission of being
  // mocked; nothing until now asserted the admission appears when it should, so a
  // banner deleted by accident would have failed neither suite.
  expect(screen.getByText("mock API")).toBeDefined();
  expect(screen.getByRole("heading", { name: "Demo scenarios" })).toBeDefined();
});

test("a real build carries no mention of a mock anywhere on the page", async () => {
  await mountApp(false);

  // The same query the e2e spec runs against the built bundle, one second
  // instead of one browser.
  expect(screen.queryAllByText(/mock/iu)).toHaveLength(0);
  expect(screen.queryByRole("heading", { name: "Demo scenarios" })).toBeNull();
});

// ---------------------------------------------------------------------------
// The probe race
// ---------------------------------------------------------------------------

test("a late response from an abandoned analysis never overwrites the current one", async () => {
  // `probeToken` in App.tsx guards this and had no test. Two analyses are started
  // back to back; the first one's response arrives last, which is exactly the
  // ordering a slow site produces after the user has given up and pasted another.
  const fake = await mountApp(true);

  const scenarios = screen.getAllByRole("button", { name: /Happy path|Slow probe/u });
  fireEvent.click(scenarios[0] as HTMLButtonElement);
  await settle();
  fireEvent.click(scenarios[1] as HTMLButtonElement);
  await settle();

  expect(fake.probes).toHaveLength(2);

  // The abandoned one answers first, and must be dropped on the floor.
  await act(async () => {
    fake.probes[0]?.resolve({ probe: probe({ title: "Abandoned analysis" }), cached: false });
    await Promise.resolve();
  });
  await settle();

  expect(screen.queryByRole("heading", { name: "Abandoned analysis" })).toBeNull();
  // Still waiting on the current one, rather than having been knocked to a result.
  expect(screen.getByRole("heading", { name: "Analysing" })).toBeDefined();

  await act(async () => {
    fake.probes[1]?.resolve({ probe: probe({ title: "Current analysis" }), cached: false });
    await Promise.resolve();
  });
  await settle();

  expect(screen.getByRole("heading", { name: "Current analysis" })).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Abandoned analysis" })).toBeNull();
});

test("a late *rejection* from an abandoned analysis is dropped too", async () => {
  // The other half of the same guard, and the more likely half: a slow site is
  // far more likely to time out than to succeed late, so the `catch` arm is the
  // one a real abandoned probe usually takes. It was unproven — deleting the
  // guard at the top of `catch` alone left the whole suite green, because both
  // race tests only ever resolved.
  //
  // Unguarded, this late rejection runs `setPhase({ kind: "idle" })` and
  // `setProbeError(...)`: the analysis the user is actually waiting on vanishes
  // and is replaced by an error belonging to the one they walked away from.
  const fake = await mountApp(true);

  const scenarios = screen.getAllByRole("button", { name: /Happy path|Slow probe/u });
  fireEvent.click(scenarios[0] as HTMLButtonElement);
  await settle();
  fireEvent.click(scenarios[1] as HTMLButtonElement);
  await settle();
  expect(fake.probes).toHaveLength(2);

  await act(async () => {
    fake.probes[0]?.reject(new fake.AppError("TIMEOUT", "The abandoned page never answered."));
    await Promise.resolve();
  });
  await settle();

  // No error panel, and the current analysis is still running.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("TIMEOUT")).toBeNull();
  expect(screen.getByRole("heading", { name: "Analysing" })).toBeDefined();

  // And the live one still lands.
  await act(async () => {
    fake.probes[1]?.resolve({ probe: probe({ title: "Current analysis" }), cached: false });
    await Promise.resolve();
  });
  await settle();
  expect(screen.getByRole("heading", { name: "Current analysis" })).toBeDefined();
});

test("a rejection that arrives after the wait was abandoned raises nothing", async () => {
  // Same guard, reached the other way: the user pressed "Stop waiting", which
  // bumps the token without starting a second probe. The idle page must stay
  // idle rather than sprouting an error for work nobody is waiting on.
  const fake = await mountApp(true);

  analyse("https://videos.example.com/watch/slow");
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
  await settle();

  await act(async () => {
    fake.probes[0]?.reject(new fake.AppError("UNREACHABLE", "Gave up on the abandoned page."));
    await Promise.resolve();
  });
  await settle();

  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("UNREACHABLE")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Analysing" })).toBeNull();
});

test("abandoning the wait also abandons the response that follows it", async () => {
  const fake = await mountApp(true);

  analyse("https://videos.example.com/watch/slow");
  await settle();
  expect(screen.getByRole("heading", { name: "Analysing" })).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
  await settle();

  await act(async () => {
    fake.probes[0]?.resolve({ probe: probe({ title: "Too late" }), cached: false });
    await Promise.resolve();
  });
  await settle();

  expect(screen.queryByRole("heading", { name: "Too late" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Analysing" })).toBeNull();
});

// ---------------------------------------------------------------------------
// Rejections reaching the screen
// ---------------------------------------------------------------------------

test("an address the contract refuses is rejected here, without a request", async () => {
  const fake = await mountApp(false);

  analyse("ftp://videos.example.com/clip.mp4");
  await settle();

  // Two alerts, and both are wanted: the field's own inline message, and the
  // panel that names the code. The inline one is advice while typing; the panel
  // is the answer to the submit.
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(screen.getByText("Enter a full http:// or https:// address.")).toBeDefined();
  expect(screen.getByRole("heading", { name: "That address will not work" })).toBeDefined();
  expect(screen.getByText("INVALID_URL")).toBeDefined();
  // `sourceUrlSchema` decided, so nothing was asked of the server.
  expect(fake.client.probe).not.toHaveBeenCalled();
});

test("a probe that fails is reported with the taxonomy's own copy", async () => {
  const fake = await mountApp(false);

  analyse("https://videos.example.com/watch/protected");
  await settle();

  await act(async () => {
    fake.probes[0]?.reject(new fake.AppError("DRM_PROTECTED", "This video is DRM protected."));
    await Promise.resolve();
  });
  await settle();

  // `final` in the presentation table: a status, and no retry to press.
  const notice = screen.getByRole("status");
  expect(notice.textContent).toContain("Protected by DRM");
  expect(screen.queryByRole("heading", { name: "Analysing" })).toBeNull();
});
