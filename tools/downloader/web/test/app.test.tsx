// @vitest-environment jsdom

/**
 * The app shell: the things about it that only exist at this level — the
 * mock-build banner, the boxes and the queue in front of them (dl-133), and
 * what `useJobs` folds and `JobCard` reads three components down (a refusal, a
 * page title, a saved job), so no test of either end can see whether it makes
 * the trip.
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
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type {
  AppError,
  Job,
  JobEvent,
  JobResponse,
  ProbeEvent,
  ProbeResponse,
} from "@downloader/contract";
import type { ApiClient } from "../src/api/types.ts";
import type { EventStreamHandlers } from "../src/lib/event-stream.ts";
import { JOBS_STORAGE_KEY } from "../src/lib/job-store.ts";
import { JOB_WAITING, PROBE_STAGE_PENDING, PROBE_WAITING } from "../src/lib/probe-stages.ts";
import { LINK, NOW, SOURCE_URL, job, probe, variant } from "./fixtures.ts";

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

async function mountApp(usingMock: boolean, overrides: Partial<ApiClient> = {}): Promise<Fake> {
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
    cancelJob: vi.fn(unused("JOB_NOT_FOUND")),
    openJobEvents: vi.fn(() => ({ close: vi.fn() })),
    openProbeEvents: vi.fn(() => ({ close: vi.fn() })),
    openLink: vi.fn(),
    // The job-stream cases below need a client that answers; the probe cases
    // need one that rejects loudly on anything they did not mean to reach. The
    // two live in one harness because the module-registry dance above is the
    // expensive part and there is no reason to have two of it.
    ...overrides,
  };

  vi.doMock("../src/api/client.ts", () => ({ USING_MOCK_API: usingMock, api: client }));
  const { App } = await import("../src/App.tsx");
  render(<App />);
  return { client, probes, AppError: Errors };
}

/** Lets the pending promise chains inside an analysis run, with no timer involved. */
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

/** The boxes on the page, top first (dl-133). */
function boxes(): HTMLElement[] {
  const list = screen.queryByRole("list", { name: "Analyses" });
  if (list === null) return [];
  return Array.from(list.querySelectorAll<HTMLElement>(":scope > li"));
}

function box(index: number): HTMLElement {
  const found = boxes()[index];
  if (found === undefined) throw new Error(`no box at ${String(index)}`);
  return found;
}

/** The line under a box's bar: its stage, or what it is waiting for. */
function lineIn(element: HTMLElement): string {
  return element.querySelector(".stage")?.textContent ?? "";
}

async function answer(fake: Fake, index: number, response: ProbeResponse): Promise<void> {
  await act(async () => {
    fake.probes[index]?.resolve(response);
    await Promise.resolve();
  });
  await settle();
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
// One box per analysis (dl-133)
// ---------------------------------------------------------------------------

test("two answers that arrive out of order each land in their own box", async () => {
  // `probeToken` was one per page: a second analysis abandoned the first. Each
  // box owns its token now, so both run, and the first one's late answer must
  // reach the first box — not the second, and not nowhere.
  const fake = await mountApp(false);

  analyse("https://videos.example.com/watch/first");
  await settle();
  analyse("https://videos.example.com/watch/second");
  await settle();
  expect(fake.probes).toHaveLength(2);

  await answer(fake, 1, { probe: probe({ title: "The second page" }), cached: false });
  // Newest first: the second analysis is the top box.
  expect(within(box(0)).getByRole("heading", { name: "The second page" })).toBeDefined();
  expect(within(box(1)).getByRole("heading", { name: "Analysing" })).toBeDefined();

  await answer(fake, 0, { probe: probe({ title: "The first page" }), cached: false });
  expect(within(box(1)).getByRole("heading", { name: "The first page" })).toBeDefined();
  expect(within(box(0)).getByRole("heading", { name: "The second page" })).toBeDefined();
  expect(boxes()).toHaveLength(2);
});

test("a rejection reaches only the box it answers", async () => {
  const fake = await mountApp(false);

  analyse("https://videos.example.com/watch/first");
  await settle();
  analyse("https://videos.example.com/watch/second");
  await settle();

  await act(async () => {
    fake.probes[0]?.reject(new fake.AppError("UNREACHABLE", "The first page did not answer."));
    await Promise.resolve();
  });
  await settle();

  // The older box failed, with its own address beside the error; the newer one
  // is still analysing.
  expect(within(box(1)).getByText("UNREACHABLE")).toBeDefined();
  expect(within(box(1)).getByText("https://videos.example.com/watch/first")).toBeDefined();
  expect(within(box(0)).queryByText("UNREACHABLE")).toBeNull();
  expect(within(box(0)).getByRole("heading", { name: "Analysing" })).toBeDefined();
});

test("a rejection that arrives after the wait was abandoned raises nothing", async () => {
  // The per-box guard, reached by "Stop waiting": the box is closed, and the
  // page must not sprout an error for work nobody is waiting on.
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
  expect(boxes()).toHaveLength(0);

  await answer(fake, 0, { probe: probe({ title: "Too late" }), cached: false });

  expect(screen.queryByRole("heading", { name: "Too late" })).toBeNull();
  expect(boxes()).toHaveLength(0);
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
  // `sourceUrlSchema` decided, so nothing was asked of the server, and nothing
  // was analysed for a box to hold.
  expect(fake.client.probe).not.toHaveBeenCalled();
  expect(boxes()).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// The live event stream
// ---------------------------------------------------------------------------

/**
 * Mounts the app over a restored `downloading` job and hands back the stream
 * handlers `useJobs` attached to it.
 *
 * The job arrives through `localStorage` because that is the shortest honest
 * route to a client that is already watching one — the alternative is driving
 * the probe form and `createJob`, which proves nothing extra here.
 */
async function watchOneJob(
  restored: Job,
  /** One snapshot per `getJob` call, in order; the last one answers any extra. */
  snapshots: readonly Job[],
): Promise<{ fake: Fake; listeners: EventStreamHandlers[] }> {
  globalThis.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([restored]));
  const listeners: EventStreamHandlers[] = [];
  let fetched = 0;
  const fake = await mountApp(false, {
    getJob: vi.fn(() => {
      const snapshot = snapshots[Math.min(fetched, snapshots.length - 1)];
      fetched += 1;
      return Promise.resolve({ job: snapshot as Job });
    }),
    openJobEvents: vi.fn((_jobId: string, handlers: EventStreamHandlers) => {
      listeners.push(handlers);
      return { close: vi.fn() };
    }),
  });
  await settle();
  return { fake, listeners };
}

// ---------------------------------------------------------------------------
// The probe stage channel (dl-43)
// ---------------------------------------------------------------------------

/** The channel opened by the analysis in flight, and the id it was opened under. */
interface Channel {
  probeId: string;
  handlers: EventStreamHandlers<ProbeEvent>;
  closed: boolean;
}

function channelSpy(channels: Channel[]): Partial<ApiClient> {
  return {
    openProbeEvents: vi.fn((probeId: string, handlers: EventStreamHandlers<ProbeEvent>) => {
      const channel: Channel = { probeId, handlers, closed: false };
      channels.push(channel);
      return {
        close: () => {
          channel.closed = true;
        },
      };
    }),
  };
}

function stageLine(): string {
  return document.querySelector(".stage")?.textContent ?? "";
}

function stageFrame(channel: Channel | undefined, stage: string, resolver = "browser"): void {
  act(() => {
    channel?.handlers.onEvent({
      type: "stage",
      probeId: channel.probeId,
      stage,
      resolver,
      at: "2026-09-07T10:00:00.000Z",
    } as ProbeEvent);
  });
}

test("the channel is opened under the same id the probe is sent with", async () => {
  const channels: Channel[] = [];
  const fake = await mountApp(true, channelSpy(channels));

  analyse(SOURCE_URL);
  await settle();

  // Opened *before* the POST is answered, because the first stages happen while
  // it is still in flight — there is no later moment at which subscribing would
  // still catch the beginning.
  expect(channels).toHaveLength(1);
  const opened = channels[0]?.probeId ?? "";
  expect(opened).toMatch(/^[a-f0-9]{32}$/u);
  expect(fake.client.probe).toHaveBeenCalledWith({ url: SOURCE_URL, probeId: opened });
});

test("a stage frame becomes the line on screen", async () => {
  const channels: Channel[] = [];
  await mountApp(true, channelSpy(channels));

  analyse(SOURCE_URL);
  await settle();
  expect(stageLine()).toBe(PROBE_STAGE_PENDING);

  stageFrame(channels[0], "network-quiet");

  expect(stageLine()).toBe("Waiting for the network to go quiet");
});

test("the channel is closed when the answer arrives, and again when abandoned", async () => {
  const channels: Channel[] = [];
  const fake = await mountApp(true, channelSpy(channels));

  analyse(SOURCE_URL);
  await settle();
  expect(channels[0]?.closed).toBe(false);

  await answer(fake, 0, { probe: probe(), cached: false });
  // Leaving it open would hold an `EventSource` per analysis for the life of
  // the tab, on a channel that will never say anything again.
  expect(channels[0]?.closed).toBe(true);

  analyse(SOURCE_URL);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
  await settle();
  expect(channels[1]?.closed).toBe(true);
});

test("a frame from a closed box's channel cannot resurrect it", async () => {
  // A stale stream that outlived its box must not put a stage back on screen.
  // The channel is closed with the box, and the frame is dropped by the box's
  // own token even if the transport delivers it anyway.
  const channels: Channel[] = [];
  await mountApp(true, channelSpy(channels));

  analyse(SOURCE_URL);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
  await settle();

  stageFrame(channels[0], "page-load");

  expect(screen.queryByRole("heading", { name: "Analysing" })).toBeNull();
  expect(boxes()).toHaveLength(0);
});

test("a channel that drops leaves the analysis running and the last line standing", async () => {
  const channels: Channel[] = [];
  const fake = await mountApp(true, channelSpy(channels));

  analyse(SOURCE_URL);
  await settle();
  stageFrame(channels[0], "page-load");
  act(() => {
    channels[0]?.handlers.onError();
  });

  // Narration is decoration over a request that is still in flight. Unlike the
  // job stream there is nothing to reconcile, so losing it changes nothing but
  // the line stops moving.
  expect(stageLine()).toBe("Loading the page");
  await answer(fake, 0, { probe: probe({ title: "Answered anyway" }), cached: false });
  expect(screen.getByRole("heading", { name: "Answered anyway" })).toBeDefined();
});

test("a cancel the server refused leaves the card following the job it could not stop", async () => {
  // dl-65. The cancel request failed while the download kept running on the
  // server. Before the fix the card was marked failed with the request's error
  // and its stream dropped, so the page showed a dead job and a live one held
  // the client's slot out of sight.
  const downloading = job("downloading", { id: "job-1" });
  const { fake, listeners } = await watchOneJob(downloading, [downloading]);
  (fake.client.cancelJob as ReturnType<typeof vi.fn>).mockImplementation(() =>
    Promise.reject(new fake.AppError("INTERNAL", "Something went wrong on our end.")),
  );

  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await settle();
  await settle();

  expect(fake.client.cancelJob).toHaveBeenCalledWith("job-1");
  expect(screen.queryByText("Something went wrong")).toBeNull();
  expect(screen.getByRole("button", { name: "Stop" })).toBeDefined();

  // Still attached: a frame from the server still lands on the card.
  act(() => {
    listeners[0]?.onEvent({
      type: "canceled",
      jobId: "job-1",
      error: { code: "JOB_CANCELED", message: "The download was canceled.", retryable: false },
      at: "2026-09-07T10:00:05.000Z",
    });
  });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a cancel the server refused for a job that has since finished shows how it finished", async () => {
  const downloading = job("downloading", { id: "job-1" });
  const completed = job("completed", { id: "job-1" });
  const { fake } = await watchOneJob(downloading, [downloading, completed]);
  (fake.client.cancelJob as ReturnType<typeof vi.fn>).mockImplementation(() =>
    Promise.reject(new fake.AppError("INTERNAL", "Something went wrong on our end.")),
  );

  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await settle();
  await settle();

  expect(screen.queryByText("Something went wrong")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByText(/^Saved by your browser — /u)).toBeDefined();
});

test("a cancel the server accepted before the job stopped keeps following it to canceled", async () => {
  // The cancel route answers before the orchestrator's abort unwinds, so a job
  // canceled mid-probe comes back still running. Detaching on that answer
  // closed the only stream that would carry its `canceled` frame, and the card
  // sat on its last step until a reload.
  const probing = job("probing", { id: "job-1" });
  const { fake, listeners } = await watchOneJob(probing, [probing]);
  (fake.client.cancelJob as ReturnType<typeof vi.fn>).mockImplementation(() =>
    Promise.resolve({ job: probing }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await settle();

  act(() => {
    listeners[0]?.onEvent({
      type: "canceled",
      jobId: "job-1",
      error: { code: "JOB_CANCELED", message: "The download was canceled.", retryable: false },
      at: "2026-09-07T10:00:05.000Z",
    });
  });
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getAllByText("Canceled").length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// A refused link (dl-77)
// ---------------------------------------------------------------------------

const REFUSED: JobEvent = {
  type: "refused",
  jobId: "job-1",
  error: {
    code: "RATE_LIMITED",
    message: "You already have as many downloads running or waiting as this server allows.",
    retryable: true,
    details: { retryAfterSec: 30 },
  },
  at: "2026-08-20T11:59:30.000Z",
};

test("a refused frame reaches the card, stays until the link is followed, and goes when the job leaves the queue", async () => {
  // Through the real `useJobs`: the frame has to be folded in the hook and read
  // three components down, and neither end can see whether it makes the trip.
  const queued = job("queued", { id: "job-1" });
  const { listeners } = await watchOneJob(queued, [queued]);
  expect(screen.queryByRole("alert")).toBeNull();

  act(() => {
    listeners[0]?.onOpen();
    listeners[0]?.onEvent(REFUSED);
  });
  const notice = screen.getByRole("alert");
  expect(within(notice).getByText(/as many downloads running or waiting/u)).toBeDefined();
  expect(within(notice).getByText("Wait 30 s before trying again.")).toBeDefined();
  // Still a queued job with a link it can use.
  expect(screen.getByRole("link", { name: "Download" })).toBeDefined();
  expect(screen.getAllByText("Starting").length).toBeGreaterThan(0);

  // Following the link starts a new attempt, and the answer to the last one is
  // no longer what the card should say. jsdom does not navigate an anchor, so
  // this is the click handler and nothing else.
  fireEvent.click(screen.getByRole("link", { name: "Download" }));
  expect(screen.queryByRole("alert")).toBeNull();

  // A second refusal shows again.
  act(() => {
    listeners[0]?.onEvent({ ...REFUSED, at: "2026-08-20T11:59:45.000Z" });
  });
  expect(screen.getByRole("alert")).toBeDefined();

  // The attempt that followed is accepted: the job leaves the queue, and the
  // card stops offering a link or a refusal.
  act(() => {
    listeners[0]?.onEvent({
      type: "status",
      jobId: "job-1",
      status: "probing",
      at: "2026-08-20T11:59:50.000Z",
    });
  });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
});

test("a refusal that arrives after the job has moved on is not shown", async () => {
  const queued = job("queued", { id: "job-1" });
  const { listeners } = await watchOneJob(queued, [queued]);

  act(() => {
    listeners[0]?.onOpen();
    // The accepted attempt's frame first, then the earlier attempt's refusal
    // arriving behind it.
    listeners[0]?.onEvent({
      type: "status",
      jobId: "job-1",
      status: "probing",
      at: "2026-08-20T11:59:50.000Z",
    });
    listeners[0]?.onEvent(REFUSED);
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

// ---------------------------------------------------------------------------
// One press starts the download
// ---------------------------------------------------------------------------

/** Analyses, answers the probe, and presses the box's Download. */
async function pressDownload(fake: Fake): Promise<void> {
  analyse(SOURCE_URL);
  await settle();
  await answer(fake, 0, { probe: probe(), cached: false });
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await settle();
}

test("the panel's Download opens the created job's link once its stream listens", async () => {
  // Creating a job only hands out a single-use link (dl-53). The visitor used to
  // press Download a second time, on the card, before anything happened.
  const listeners: EventStreamHandlers[] = [];
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
    openJobEvents: vi.fn((_jobId: string, handlers: EventStreamHandlers) => {
      listeners.push(handlers);
      return { close: vi.fn() };
    }),
  });

  await pressDownload(fake);

  // Not yet: the server keeps no replay log, so a refusal sent before the
  // stream listens would never reach the card (dl-77).
  expect(listeners).toHaveLength(1);
  expect(fake.client.openLink).not.toHaveBeenCalled();

  act(() => listeners[0]?.onOpen());
  expect(fake.client.openLink).toHaveBeenCalledTimes(1);
  expect(fake.client.openLink).toHaveBeenCalledWith(LINK.url);
  // Still offered on the card, for a browser that blocked the automatic one.
  expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(LINK.url);

  // Once: a reconnect is not a second press.
  act(() => listeners[0]?.onError());
  expect(fake.client.openLink).toHaveBeenCalledTimes(1);
});

test("a stream that cannot connect does not hold the download back", async () => {
  const listeners: EventStreamHandlers[] = [];
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
    openJobEvents: vi.fn((_jobId: string, handlers: EventStreamHandlers) => {
      listeners.push(handlers);
      return { close: vi.fn() };
    }),
  });

  await pressDownload(fake);
  act(() => listeners[0]?.onError());

  expect(fake.client.openLink).toHaveBeenCalledWith(LINK.url);
});

test("a job that could not be created opens nothing, and the box offers Download again", async () => {
  const fake = await mountApp(false);

  await pressDownload(fake);

  expect(fake.client.createJob).toHaveBeenCalledTimes(1);
  expect(fake.client.openLink).not.toHaveBeenCalled();
  expect(within(box(0)).getByRole("alert")).toBeDefined();
  expect(within(box(0)).getByRole("button", { name: "Download" })).toBeDefined();
});

test("a job's page title survives a reload, through the hook's own storage", async () => {
  const started = job("downloading", { id: "job-1" });
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
    getJob: vi.fn(() => Promise.resolve({ job: started })),
  });
  await pressDownload(fake);
  cleanup();

  // A fresh mount reads only what `useJobs` saved: the job and, beside it, its title.
  await mountApp(false, { getJob: vi.fn(() => Promise.resolve({ job: started })) });
  await settle();
  expect(screen.getByRole("heading", { level: 2, name: "A sample recording" })).toBeDefined();
});

// ---------------------------------------------------------------------------
// The re-probe's stages (dl-110)
// ---------------------------------------------------------------------------

/** The card's progress messages, in order. */
function cardMessages(): string[] {
  return screen
    .getAllByRole("listitem")
    .filter((item) => item.classList.contains("job__message"))
    .map((item) => item.textContent ?? "");
}

function frame(event: Record<string, unknown>, second: number): JobEvent {
  return {
    jobId: "job-1",
    at: `2026-08-20T12:00:${String(second).padStart(2, "0")}.000Z`,
    ...event,
  } as JobEvent;
}

test("a re-analysing card narrates the latest stage as its line, and drops it when the job moves on", async () => {
  // Through the real `useJobs`: the frame is folded in the hook and read three
  // components down, as a refusal is.
  const queued = job("queued", { id: "job-1" });
  const { listeners } = await watchOneJob(queued, [queued]);

  act(() => {
    listeners[0]?.onOpen();
    listeners[0]?.onEvent(frame({ type: "status", status: "probing" }, 1));
  });
  // Before any stage: the pending line, as the analysing panel shows it.
  expect(cardMessages()).toEqual([PROBE_STAGE_PENDING]);

  act(() => {
    listeners[0]?.onEvent(
      frame({ type: "stage", stage: "resolver-start", resolver: "browser" }, 2),
    );
  });
  expect(cardMessages()).toEqual(["Trying a real browser"]);

  act(() => {
    listeners[0]?.onEvent(frame({ type: "stage", stage: "page-load", resolver: "browser" }, 3));
  });
  expect(cardMessages()).toEqual(["Loading the page"]);

  act(() => {
    listeners[0]?.onEvent(frame({ type: "status", status: "downloading" }, 4));
  });
  expect(screen.queryByText("Loading the page")).toBeNull();

  // The back-edge: a fresh re-probe starts from the pending line, not from the
  // first attempt's last stage.
  act(() => {
    listeners[0]?.onEvent(frame({ type: "status", status: "probing" }, 5));
  });
  expect(cardMessages()).toEqual([PROBE_STAGE_PENDING]);
});

test("a stage sent back to back with the probing status is not lost to the render between them", async () => {
  const queued = job("queued", { id: "job-1" });
  const { listeners } = await watchOneJob(queued, [queued]);

  // One act: the hook sees both frames before the list re-renders, so a stage
  // judged against the job as last rendered would be judged against `queued`.
  act(() => {
    listeners[0]?.onOpen();
    listeners[0]?.onEvent(frame({ type: "status", status: "probing" }, 1));
    listeners[0]?.onEvent(frame({ type: "stage", stage: "direct-head", resolver: "direct" }, 1));
  });
  expect(cardMessages()).toEqual(["Checking the address directly"]);
});

// ---------------------------------------------------------------------------
// The box just turned into a job is brought into view; a restored one is not
// ---------------------------------------------------------------------------

test("a reload scrolls to no box, and pressing Download scrolls to that box only", async () => {
  // jsdom has no layout, so the calls are what is asserted, not an offset.
  const scrolled: Element[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  try {
    const restored = job("queued", { id: "job-old" });
    globalThis.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([restored]));
    const fake = await mountApp(false, {
      getJob: vi.fn(() => Promise.resolve({ job: restored })),
      createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
    });
    await settle();
    expect(boxes()).toHaveLength(1);
    expect(scrolled).toEqual([]);

    await pressDownload(fake);
    // The new job is the one named by the page's title; the restored job has none.
    const card = screen.getByRole("heading", { name: "A sample recording" }).closest(".job");
    expect(scrolled).toEqual([card]);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  } finally {
    // @ts-expect-error -- jsdom has none, and a later test must not inherit the stub.
    delete Element.prototype.scrollIntoView;
  }
});

// ---------------------------------------------------------------------------
// A failed analysis retries its own address
// ---------------------------------------------------------------------------

test("Analyse again retries the page that failed, even after the field was cleared", async () => {
  const fake = await mountApp(false);
  analyse(SOURCE_URL);
  await settle();
  await act(async () => {
    fake.probes[0]?.reject(new fake.AppError("UNREACHABLE", "The page did not answer."));
    await Promise.resolve();
  });
  await settle();

  fireEvent.click(screen.getByRole("button", { name: "Clear address" }));
  expect((screen.getByLabelText("Page address") as HTMLInputElement).value).toBe("");

  fireEvent.click(screen.getByRole("button", { name: "Analyse again" }));
  await settle();
  expect(fake.client.probe).toHaveBeenCalledTimes(2);
  expect(fake.client.probe).toHaveBeenLastCalledWith(expect.objectContaining({ url: SOURCE_URL }));
  // Not the invalid-address answer an empty field would have given, and in the
  // same box rather than a second one.
  expect(screen.queryByText(/full http:\/\/ or https:\/\/ address/u)).toBeNull();
  expect(boxes()).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// dl-133's Done when, one case per line
// ---------------------------------------------------------------------------

test("two analyses run at once, each box showing only its own stage line (Done when 1)", async () => {
  const channels: Channel[] = [];
  const fake = await mountApp(false, channelSpy(channels));

  // One after the other, without waiting for the first.
  analyse("https://videos.example.com/watch/first");
  await settle();
  analyse("https://videos.example.com/watch/second");
  await settle();

  expect(fake.client.probe).toHaveBeenCalledTimes(2);
  expect(channels).toHaveLength(2);
  // Two ids, one per box, each sent with its own probe.
  expect(channels[0]?.probeId).not.toBe(channels[1]?.probeId);
  expect(fake.client.probe).toHaveBeenNthCalledWith(1, {
    url: "https://videos.example.com/watch/first",
    probeId: channels[0]?.probeId,
  });

  // Newest first: the second analysis is the top box, on the second channel.
  const [second, first] = boxes();
  expect(within(first as HTMLElement).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(within(second as HTMLElement).getByRole("heading", { name: "Analysing" })).toBeDefined();

  // Interleaved: second, first, second.
  stageFrame(channels[1], "page-load");
  expect(lineIn(second as HTMLElement)).toBe("Loading the page");
  expect(lineIn(first as HTMLElement)).toBe(PROBE_STAGE_PENDING);

  stageFrame(channels[0], "direct-head", "direct");
  expect(lineIn(first as HTMLElement)).toBe("Checking the address directly");
  expect(lineIn(second as HTMLElement)).toBe("Loading the page");

  stageFrame(channels[1], "network-quiet");
  expect(lineIn(second as HTMLElement)).toBe("Waiting for the network to go quiet");
  expect(lineIn(first as HTMLElement)).toBe("Checking the address directly");
});

test("a third analysis waits in its box with no request sent, and starts when one ends (Done when 2)", async () => {
  const channels: Channel[] = [];
  const fake = await mountApp(false, channelSpy(channels));

  analyse("https://videos.example.com/watch/first");
  await settle();
  analyse("https://videos.example.com/watch/second");
  await settle();
  analyse("https://videos.example.com/watch/third");
  await settle();

  expect(boxes()).toHaveLength(3);
  // The server lets one client hold two probes (`maxProbesPerClient`): the
  // third is not sent, and no channel is opened for it.
  expect(fake.client.probe).toHaveBeenCalledTimes(2);
  expect(channels).toHaveLength(2);
  const third = box(0);
  expect(within(third).getByRole("heading", { name: "Waiting" })).toBeDefined();
  expect(lineIn(third)).toBe(PROBE_WAITING);
  expect(within(third).getByText("https://videos.example.com/watch/third")).toBeDefined();

  // One of the first two ends: the third starts itself.
  await answer(fake, 0, { probe: probe({ title: "The first page" }), cached: false });

  expect(fake.client.probe).toHaveBeenCalledTimes(3);
  expect(fake.client.probe).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: "https://videos.example.com/watch/third" }),
  );
  expect(within(box(0)).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(lineIn(box(0))).toBe(PROBE_STAGE_PENDING);
});

test("a waiting analysis can be closed, and then is never sent", async () => {
  const fake = await mountApp(false);
  analyse("https://videos.example.com/watch/first");
  await settle();
  analyse("https://videos.example.com/watch/second");
  await settle();
  analyse("https://videos.example.com/watch/third");
  await settle();

  fireEvent.click(within(box(0)).getByRole("button", { name: "Stop waiting" }));
  await settle();
  expect(boxes()).toHaveLength(2);

  await answer(fake, 0, { probe: probe(), cached: false });
  expect(fake.client.probe).toHaveBeenCalledTimes(2);
});

test("a third Download waits in its box with no request sent, and starts when a job ends (Done when 2)", async () => {
  const listeners = new Map<string, EventStreamHandlers>();
  let created = 0;
  const fake = await mountApp(false, {
    createJob: vi.fn(() => {
      created += 1;
      return Promise.resolve<JobResponse>({
        job: job("queued", { id: `job-${String(created)}` }),
      });
    }),
    openJobEvents: vi.fn((jobId: string, handlers: EventStreamHandlers) => {
      listeners.set(jobId, handlers);
      return { close: vi.fn() };
    }),
  });

  // Three analysed boxes: the third analysis waits for a probe slot first.
  for (const name of ["first", "second", "third"]) {
    analyse(`https://videos.example.com/watch/${name}`);
    await settle();
  }
  await answer(fake, 0, { probe: probe({ title: "First" }), cached: false });
  await answer(fake, 1, { probe: probe({ title: "Second" }), cached: false });
  await answer(fake, 2, { probe: probe({ title: "Third" }), cached: false });

  const downloadIn = async (title: string): Promise<HTMLElement> => {
    const found = boxes().find((candidate) => within(candidate).queryByText(title) !== null);
    if (found === undefined) throw new Error(`no box titled ${title}`);
    fireEvent.click(within(found).getByRole("button", { name: "Download" }));
    await settle();
    return found;
  };

  await downloadIn("First");
  await downloadIn("Second");
  expect(fake.client.createJob).toHaveBeenCalledTimes(2);

  // Both job slots taken (`maxJobsPerClient`): the third waits, unsent.
  const third = await downloadIn("Third");
  expect(fake.client.createJob).toHaveBeenCalledTimes(2);
  expect(lineIn(third)).toBe(JOB_WAITING);
  // The table and the options are gone already; the head stays.
  expect(within(third).queryByRole("table")).toBeNull();
  expect(within(third).queryByRole("group", { name: "Output" })).toBeNull();
  expect(within(third).getByRole("heading", { name: "Third" })).toBeDefined();
  expect(within(third).getByRole("progressbar")).toBeDefined();

  // One of the first two jobs ends: the third starts itself.
  act(() => {
    listeners.get("job-1")?.onEvent({
      type: "canceled",
      jobId: "job-1",
      error: { code: "JOB_CANCELED", message: "The download was canceled.", retryable: false },
      at: "2026-08-20T12:00:05.000Z",
    });
  });
  await settle();

  expect(fake.client.createJob).toHaveBeenCalledTimes(3);
  expect(fake.client.createJob).toHaveBeenLastCalledWith(
    expect.objectContaining({ url: "https://videos.example.com/watch/third" }),
  );
  expect(lineIn(third)).not.toBe(JOB_WAITING);
});

test("Download turns the same box into the job: title and preview stay, table and options go (Done when 3)", async () => {
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
  });

  analyse(SOURCE_URL);
  await settle();
  await answer(fake, 0, {
    probe: probe({ thumbnailPath: "/api/thumbnail/from-analysis" }),
    cached: false,
  });
  const before = box(0);
  expect(within(before).getByRole("table")).toBeDefined();
  expect(within(before).getByRole("group", { name: "Output" })).toBeDefined();

  fireEvent.click(within(before).getByRole("button", { name: "Download" }));
  await settle();

  // One box, the same element, holding both the title and the bar.
  expect(boxes()).toHaveLength(1);
  const after = box(0);
  expect(after).toBe(before);
  expect(
    within(after).getByRole("heading", { level: 2, name: "A sample recording" }),
  ).toBeDefined();
  expect(within(after).getByRole("progressbar")).toBeDefined();
  expect(after.querySelector(".card__head .preview img")?.getAttribute("src")).toBe(
    "/api/thumbnail/from-analysis",
  );
  expect(within(after).queryByRole("table")).toBeNull();
  expect(within(after).queryByRole("group", { name: "Output" })).toBeNull();
  // No second card in a list of its own.
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "Downloads" })).toBeNull();
  expect(screen.getAllByRole("list", { name: "Analyses" })).toHaveLength(1);
});

test("the field keeps its address after Analyse, and a new box lands above the older ones (Done when 4)", async () => {
  await mountApp(false);

  analyse("https://videos.example.com/watch/older");
  await settle();
  expect((screen.getByLabelText("Page address") as HTMLInputElement).value).toBe(
    "https://videos.example.com/watch/older",
  );

  analyse("https://videos.example.com/watch/newer");
  await settle();
  expect((screen.getByLabelText("Page address") as HTMLInputElement).value).toBe(
    "https://videos.example.com/watch/newer",
  );
  expect(within(box(0)).getByText("https://videos.example.com/watch/newer")).toBeDefined();
  expect(within(box(1)).getByText("https://videos.example.com/watch/older")).toBeDefined();
  // Directly under the field: the list follows the form in the document.
  const form = screen.getByRole("heading", { name: "Analyse a page" });
  expect(form.compareDocumentPosition(box(0)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a saved box stays across a new analysis until its own Dismiss (Done when 5)", async () => {
  const kept = [
    job("downloading", { id: "job-live", variant: variant({ label: "Live one" }) }),
    job("failed", { id: "job-failed", variant: variant({ label: "Failed one" }) }),
  ];
  const saved = job("completed", { id: "job-saved" });
  // A completed job is never persisted, so it arrives the way it does in use:
  // through the job's own stream, on a box this tab is following.
  globalThis.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify(kept));
  const listeners = new Map<string, EventStreamHandlers>();
  await mountApp(false, {
    getJob: vi.fn((id: string) =>
      Promise.resolve({ job: kept.find((candidate) => candidate.id === id) as Job }),
    ),
    openJobEvents: vi.fn((jobId: string, handlers: EventStreamHandlers) => {
      listeners.set(jobId, handlers);
      return { close: vi.fn() };
    }),
  });
  await settle();
  act(() => {
    listeners.get("job-live")?.onEvent({
      type: "completed",
      jobId: "job-live",
      result: saved.result as NonNullable<Job["result"]>,
      at: "2026-08-20T12:00:30.000Z",
    });
  });
  expect(screen.getByText(/^Saved by your browser — /u)).toBeDefined();

  // dl-109 cleared it here; dl-133 decision 5 keeps it.
  analyse(SOURCE_URL);
  await settle();
  expect(screen.getByText(/^Saved by your browser — /u)).toBeDefined();
  expect(boxes()).toHaveLength(3);

  const savedBox = screen.getByText(/^Saved by your browser — /u).closest("li") as HTMLElement;
  fireEvent.click(within(savedBox).getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText(/^Saved by your browser — /u)).toBeNull();
  expect(boxes()).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Failed one" })).toBeDefined();
});

test("a reload restores running and failed jobs as boxes, and no analysed-only box (Done when 6)", async () => {
  // A page with an analysed box that was never downloaded, a running job and a
  // failed one. The analysed box is not saved anywhere (decision 6): its probe's
  // signed links would have expired by the time anyone came back to it.
  const running = job("downloading", { id: "job-run", variant: variant({ label: "Running" }) });
  const failed = job("failed", { id: "job-fail", variant: variant({ label: "Failed" }) });
  const snapshots = new Map([
    [running.id, running],
    [failed.id, failed],
  ]);
  const fake = await mountApp(false, {
    getJob: vi.fn((id: string) => Promise.resolve({ job: snapshots.get(id) as Job })),
  });
  analyse(SOURCE_URL);
  await settle();
  await answer(fake, 0, { probe: probe({ title: "Analysed only" }), cached: false });
  expect(screen.getByRole("heading", { name: "Analysed only" })).toBeDefined();
  // The jobs reach storage the way `useJobs` keeps them.
  globalThis.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([running, failed]));
  cleanup();

  await mountApp(false, {
    getJob: vi.fn((id: string) => Promise.resolve({ job: snapshots.get(id) as Job })),
  });
  await settle();

  expect(boxes()).toHaveLength(2);
  expect(screen.queryByRole("heading", { name: "Analysed only" })).toBeNull();
  expect(within(box(0)).getByRole("heading", { name: "Running" })).toBeDefined();
  expect(within(box(0)).getByRole("progressbar")).toBeDefined();
  expect(within(box(1)).getByRole("heading", { name: "Failed" })).toBeDefined();
  expect(within(box(1)).getByRole("alert")).toBeDefined();
});

test("restored boxes go below every box made in this page's life", async () => {
  const running = job("downloading", { id: "job-run", variant: variant({ label: "Restored" }) });
  globalThis.localStorage.setItem(JOBS_STORAGE_KEY, JSON.stringify([running]));
  await mountApp(false, { getJob: vi.fn(() => Promise.resolve({ job: running })) });
  await settle();

  analyse(SOURCE_URL);
  await settle();

  expect(within(box(0)).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(within(box(1)).getByRole("heading", { name: "Restored" })).toBeDefined();
});

test("a failed job's retry analyses its address again in the same box", async () => {
  const listeners: EventStreamHandlers[] = [];
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: job("queued", { id: "job-1" }) })),
    openJobEvents: vi.fn((_jobId: string, handlers: EventStreamHandlers) => {
      listeners.push(handlers);
      return { close: vi.fn() };
    }),
  });
  await pressDownload(fake);
  act(() => {
    listeners[0]?.onEvent({
      type: "failed",
      jobId: "job-1",
      error: { code: "DOWNLOAD_FAILED", message: "The download failed.", retryable: true },
      at: "2026-08-20T12:00:05.000Z",
    });
  });
  const before = box(0);
  expect(within(before).getByRole("alert")).toBeDefined();

  fireEvent.click(within(before).getByRole("button", { name: "Analyse and retry" }));
  await settle();

  expect(boxes()).toHaveLength(1);
  expect(box(0)).toBe(before);
  expect(within(before).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(fake.client.probe).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// dl-133 round 1: gate 1's findings and the owner's answers
// ---------------------------------------------------------------------------

test("a closed analysis holds its slot until its POST settles, as the server holds its own (F1)", async () => {
  // The server's per-client gate is taken when the POST arrives and released
  // when its handler ends (`routes/probe.ts`); the page never aborts the POST.
  // So the fake models that rule: a slot per unsettled POST, a third refused.
  // Freed on the close itself, the page started the waiting box straight into
  // that refusal.
  let held = 0;
  const posts: Deferred<ProbeResponse>[] = [];
  let Errors: AppErrorClass | undefined;
  const fake = await mountApp(false, {
    probe: vi.fn(() => {
      if (held >= 2) {
        return Promise.reject(
          new (Errors as AppErrorClass)(
            "RATE_LIMITED",
            "You already have as many analyses running as this server allows per client.",
          ),
        );
      }
      held += 1;
      const next = deferred<ProbeResponse>();
      posts.push(next);
      const free = (): void => {
        held -= 1;
      };
      next.promise.then(free, free);
      return next.promise;
    }),
  });
  Errors = fake.AppError;

  for (const name of ["first", "second", "third"]) {
    analyse(`https://videos.example.com/watch/${name}`);
    await settle();
  }
  expect(fake.client.probe).toHaveBeenCalledTimes(2);

  // The oldest running box is closed while its POST is still out.
  fireEvent.click(within(box(2)).getByRole("button", { name: "Stop waiting" }));
  await settle();
  expect(boxes()).toHaveLength(2);

  // The third still waits: the server still holds the closed box's slot.
  expect(fake.client.probe).toHaveBeenCalledTimes(2);
  expect(within(box(0)).getByRole("heading", { name: "Waiting" })).toBeDefined();
  expect(lineIn(box(0))).toBe(PROBE_WAITING);

  // The abandoned POST settles, its answer going nowhere: now the slot is free.
  await act(async () => {
    posts[0]?.resolve({ probe: probe({ title: "Nobody is waiting" }), cached: false });
    await Promise.resolve();
  });
  await settle();

  expect(fake.client.probe).toHaveBeenCalledTimes(3);
  expect(within(box(0)).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(within(box(0)).queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Nobody is waiting" })).toBeNull();
});

/** Three analysed boxes, two jobs in flight, and the third box's Download waiting. */
async function waitingDownload(): Promise<{
  fake: Fake;
  third: HTMLElement;
  listeners: Map<string, EventStreamHandlers>;
}> {
  const listeners = new Map<string, EventStreamHandlers>();
  let created = 0;
  const fake = await mountApp(false, {
    createJob: vi.fn(() => {
      created += 1;
      return Promise.resolve<JobResponse>({
        job: job("queued", { id: `job-${String(created)}` }),
      });
    }),
    openJobEvents: vi.fn((jobId: string, handlers: EventStreamHandlers) => {
      listeners.set(jobId, handlers);
      return { close: vi.fn() };
    }),
  });
  for (const name of ["first", "second", "third"]) {
    analyse(`https://videos.example.com/watch/${name}`);
    await settle();
  }
  await answer(fake, 0, { probe: probe({ title: "First" }), cached: false });
  await answer(fake, 1, { probe: probe({ title: "Second" }), cached: false });
  await answer(fake, 2, { probe: probe({ title: "Third" }), cached: false });
  const titled = (title: string): HTMLElement => {
    const found = boxes().find((candidate) => within(candidate).queryByText(title) !== null);
    if (found === undefined) throw new Error(`no box titled ${title}`);
    return found;
  };
  for (const title of ["First", "Second"]) {
    fireEvent.click(within(titled(title)).getByRole("button", { name: "Download" }));
    await settle();
  }
  const third = titled("Third");
  // A rendition other than the default, so the return can be seen to keep it.
  const radios = within(third).getAllByRole("radio");
  fireEvent.click(radios[radios.length - 1] as HTMLElement);
  fireEvent.click(within(third).getByRole("button", { name: "Download" }));
  await settle();
  expect(lineIn(third)).toBe(JOB_WAITING);
  return { fake, third, listeners };
}

test("Stop waiting on a waiting Download returns the box to its options, as chosen (owner, decision 2)", async () => {
  const { fake, third, listeners } = await waitingDownload();

  fireEvent.click(within(third).getByRole("button", { name: "Stop waiting" }));
  await settle();

  // The same box, back on its table and options, with Download and Dismiss.
  expect(boxes()).toHaveLength(3);
  expect(boxes()).toContain(third);
  expect(within(third).getByRole("table")).toBeDefined();
  expect(within(third).getByRole("group", { name: "Output" })).toBeDefined();
  expect(within(third).getByRole("button", { name: "Download" })).toBeDefined();
  expect(within(third).getByRole("button", { name: "Dismiss" })).toBeDefined();
  const radios = within(third).getAllByRole("radio") as HTMLInputElement[];
  expect(radios[radios.length - 1]?.checked).toBe(true);
  expect(lineIn(third)).toBe("");

  // No longer waiting: a slot that frees now starts nothing.
  act(() => {
    listeners.get("job-1")?.onEvent({
      type: "canceled",
      jobId: "job-1",
      error: { code: "JOB_CANCELED", message: "The download was canceled.", retryable: false },
      at: "2026-08-20T12:00:05.000Z",
    });
  });
  await settle();
  expect(fake.client.createJob).toHaveBeenCalledTimes(2);
});

test("a waiting box's bar does not announce work in progress (F5)", async () => {
  // Nothing has been sent for it, so "in progress" is not true yet.
  const { third } = await waitingDownload();
  const label = within(third).getByRole("progressbar").getAttribute("aria-label") ?? "";
  expect(label).not.toContain("in progress");
  expect(label).toBe("Waiting to download: not started yet");
});

// ---------------------------------------------------------------------------
// dl-133 gate 2, N1 and N4
// ---------------------------------------------------------------------------

/**
 * The server's per-client rule as `routes/probe.ts` holds it, as the F1 case
 * above models it: a slot per unsettled POST, a third refused. Handed back with
 * the POSTs in the order they were made and a count of the slots held.
 */
function capped(errors: () => AppErrorClass): {
  overrides: Partial<ApiClient>;
  posts: Deferred<ProbeResponse>[];
  held: () => number;
} {
  let held = 0;
  const posts: Deferred<ProbeResponse>[] = [];
  const overrides: Partial<ApiClient> = {
    probe: vi.fn(() => {
      if (held >= 2) {
        return Promise.reject(
          new (errors())(
            "RATE_LIMITED",
            "You already have as many analyses running as this server allows per client.",
          ),
        );
      }
      held += 1;
      const next = deferred<ProbeResponse>();
      posts.push(next);
      const free = (): void => {
        held -= 1;
      };
      next.promise.then(free, free);
      return next.promise;
    }),
  };
  return { overrides, posts, held: () => held };
}

test("a closed analysis's POST that fails gives its slot back as well (gate 2, N1)", async () => {
  // The F1 case above ends the abandoned POST with an answer. A rejection is a
  // second way out, and a count released only on an answer leaves the next
  // analysis waiting for a slot that nothing will free.
  let Errors: AppErrorClass | undefined;
  const server = capped(() => Errors as AppErrorClass);
  const fake = await mountApp(false, server.overrides);
  Errors = fake.AppError;

  for (const name of ["first", "second", "third"]) {
    analyse(`https://videos.example.com/watch/${name}`);
    await settle();
  }
  fireEvent.click(within(box(2)).getByRole("button", { name: "Stop waiting" }));
  await settle();
  expect(fake.client.probe).toHaveBeenCalledTimes(2);

  await act(async () => {
    server.posts[0]?.reject(new fake.AppError("UNREACHABLE", "The page could not be reached."));
    await Promise.resolve();
  });
  await settle();

  expect(fake.client.probe).toHaveBeenCalledTimes(3);
  expect(within(box(0)).getByRole("heading", { name: "Analysing" })).toBeDefined();
  expect(within(box(0)).queryByRole("alert")).toBeNull();
});

test("dismissing an answered box leaves no slot held, so two analyses start at once (gate 2, N1)", async () => {
  // An answered box's POST is over. Left in the page's record of what is out,
  // it would count as a slot the server no longer holds, and nothing would
  // ever release it.
  let Errors: AppErrorClass | undefined;
  const server = capped(() => Errors as AppErrorClass);
  const fake = await mountApp(false, server.overrides);
  Errors = fake.AppError;

  analyse("https://videos.example.com/watch/first");
  await settle();
  await act(async () => {
    server.posts[0]?.resolve({ probe: probe({ title: "First" }), cached: false });
    await Promise.resolve();
  });
  await settle();
  fireEvent.click(within(box(0)).getByRole("button", { name: "Dismiss" }));
  await settle();
  expect(boxes()).toHaveLength(0);

  for (const name of ["second", "third", "fourth"]) {
    analyse(`https://videos.example.com/watch/${name}`);
    await settle();
  }

  // One call before, then two at once, the fourth waiting.
  expect(fake.client.probe).toHaveBeenCalledTimes(3);
  expect(server.held()).toBe(2);
});

test("the node pressed as Stop waiting is not Download when pressed again (gate 2, N4)", async () => {
  // Waiting and options return the same section with the actions row in the
  // same place, so React kept the button that was pressed and turned it into
  // Download. A held Enter or a quick second press then started the wait over.
  const { third } = await waitingDownload();

  const stop = within(third).getByRole("button", { name: "Stop waiting" });
  fireEvent.click(stop);
  await settle();
  expect(within(third).getByRole("table")).toBeDefined();

  fireEvent.click(stop);
  await settle();

  expect(within(third).getByRole("table")).toBeDefined();
  expect(lineIn(third)).toBe("");
  expect(within(third).queryByRole("button", { name: "Stop waiting" })).toBeNull();
});
