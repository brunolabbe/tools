// @vitest-environment jsdom

/**
 * The app shell: the things about it that only exist at this level — the
 * mock-build banner, the probe race, and (dl-20) the pipeline mark, which is
 * folded in `useJobs` and read three components down in `JobCard`, so no test of
 * either end can see whether it makes the trip.
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
import type { AppError, Job, JobEvent, ProbeResponse } from "@downloader/contract";
import type { ApiClient } from "../src/api/types.ts";
import type { EventStreamHandlers } from "../src/lib/event-stream.ts";
import { JOBS_STORAGE_KEY } from "../src/lib/job-store.ts";
import { NOW, SOURCE_URL, job, probe, progress, variant } from "./fixtures.ts";

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

// ---------------------------------------------------------------------------
// The live event stream, and the pipeline mark that rides on it (dl-20)
// ---------------------------------------------------------------------------
//
// These are here rather than in `job-card.test.tsx` because the thing they have
// to prove is not what the card renders for a given mark — that is asserted
// there — but that a mark is *produced* by the frames and *arrives* at the card.
// dl-18 shipped a correct rule that reached nobody watching a healthy stream,
// and only a render driven from the wire, through the real `useJobs`, could have
// said so. A component test cannot: it is handed the value whose journey is the
// thing in question.

/** The frames `#attempt` emits as it takes dl-9's `downloading → probing` edge. */
const BACK_EDGE: JobEvent[] = [
  { type: "status", jobId: "job-1", status: "probing", at: "2026-08-20T11:59:30.000Z" },
  {
    type: "progress",
    jobId: "job-1",
    // `initialProgress("probing")`: the abandoned attempt's bytes are not
    // progress towards this one, so the snapshot resets with the transition.
    progress: progress({ stage: "probing", percent: null, downloadedBytes: 0 }),
    at: "2026-08-20T11:59:31.000Z",
  },
];

/** The forward half of a run, as the orchestrator emits it before anything expires. */
const RUN_TO_DOWNLOADING: JobEvent[] = [
  { type: "status", jobId: "job-1", status: "probing", at: "2026-08-20T11:59:10.000Z" },
  { type: "status", jobId: "job-1", status: "downloading", at: "2026-08-20T11:59:20.000Z" },
  {
    type: "progress",
    jobId: "job-1",
    progress: progress({ stage: "downloading", downloadedBytes: 41_000_000 }),
    at: "2026-08-20T11:59:21.000Z",
  },
];

/** Each pipeline step as `[label, state]`, off the class the stylesheet keys on. */
function pipeline(): [string, string][] {
  return within(screen.getByRole("list", { name: "Pipeline" }))
    .getAllByRole("listitem")
    .map((step): [string, string] => {
      const modifier = [...step.classList].find((name) => name.startsWith("steps__item--"));
      return [step.textContent ?? "", modifier?.slice("steps__item--".length) ?? "pending"];
    });
}

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

test("a restored job driven over the back-edge by frames keeps Downloading marked done", async () => {
  // The user in dl-18's Why: a healthy stream, a 20-minute download, and a
  // signed URL that expired. Before dl-20 this render was byte-identical to a
  // first probe's — "Downloading" went pending and the progress indicator
  // retreated — because `attempts` is the only tell on a `Job` and no `JobEvent`
  // carries it.
  const downloading = job("downloading", { id: "job-1", attempts: 1 });
  const { fake, listeners } = await watchOneJob(downloading, [downloading]);

  expect(listeners).toHaveLength(1);
  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "done"],
    ["Downloading", "active"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);

  act(() => {
    // The first connect is not a reconnect, so `onOpen` reconciles nothing.
    listeners[0]?.onOpen();
    for (const event of BACK_EDGE) listeners[0]?.onEvent(event);
  });

  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "active"],
    ["Downloading", "done"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);
  // **This test does not prove the frames did it, and an earlier draft of this
  // comment claimed it did.** `restore` reconciles before it attaches, so the one
  // `getJob` below has already folded the restored `downloading` job into the
  // mark — `reachedStep` reads `attempts` only for `probing`, so a `downloading`
  // job returns step 2 whatever its counter says. The call asserted here as
  // ruling the refetch out *is* the refetch. What this test holds is the
  // restore-then-listen journey end to end; the frames carrying the mark on
  // their own is the test below, which starts a job in this tab and never
  // refetches at all.
  expect(fake.client.getJob).toHaveBeenCalledTimes(1);
});

test("a job started in this tab, never refetched, gets its mark from the frames alone", async () => {
  // The commonest journey there is: paste a URL, watch it run in the same tab.
  // It goes through `start()`, which upserts the created job and attaches the
  // stream — and never calls `mergeJob`. So `applyEvent`'s fold is the *only*
  // thing that can carry the mark here, which is what makes this the test dl-20
  // actually needed: with that fold neutralised, every other test in the repo
  // stays green, this one included until it existed.
  const created = job("queued", { id: "job-1" });
  const listeners: EventStreamHandlers[] = [];
  const fake = await mountApp(false, {
    createJob: vi.fn(() => Promise.resolve({ job: created })),
    openJobEvents: vi.fn((_jobId: string, handlers: EventStreamHandlers) => {
      listeners.push(handlers);
      return { close: vi.fn() };
    }),
  });

  analyse(SOURCE_URL);
  await settle();
  await act(async () => {
    fake.probes[0]?.resolve({ probe: probe(), cached: false });
    await Promise.resolve();
  });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Download" }));
  await settle();

  expect(listeners).toHaveLength(1);
  // Nothing was ever fetched: the job in the list is the one `createJob`
  // returned, and no reconcile has happened or will.
  expect(fake.client.getJob).not.toHaveBeenCalled();
  expect(pipeline()).toEqual([
    ["Queued", "active"],
    ["Re-analysing", "pending"],
    ["Downloading", "pending"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);

  act(() => {
    listeners[0]?.onOpen();
    // The forward run, then the edge — every step of it from the wire.
    for (const event of RUN_TO_DOWNLOADING) listeners[0]?.onEvent(event);
  });
  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "done"],
    ["Downloading", "active"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);

  act(() => {
    for (const event of BACK_EDGE) listeners[0]?.onEvent(event);
  });

  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "active"],
    ["Downloading", "done"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);
  // Still nothing refetched, so `attempts` has been `1` on every copy of this
  // job the client has ever held. The mark can only have come from the fold.
  expect(fake.client.getJob).not.toHaveBeenCalled();
});

test("a reconnect that slept through the download stage keeps the refetch's word for it", async () => {
  // dl-20's other half, and the one case where *neither* witness is redundant.
  // The client is watching a first probe when the connection drops; while it is
  // away the job downloads, the signed URL expires, and the server takes the
  // back-edge. So the only frame the reconnect brings is the channel's opening
  // snapshot — `status: probing` again — and this client never saw
  // `downloading` at all.
  //
  // The refetch that follows the reconnect knows `attempts: 2`. It also *loses*:
  // it was issued before the burst frame landed, so its snapshot is older and
  // `reconcileJob` keeps the local copy, discarding the counter with it. That is
  // the race dl-18's gate found and dl-20's Why records. What survives it is the
  // mark, which is folded from the reconciled job rather than from the copy that
  // won.
  const probing = job("probing", { id: "job-1", attempts: 1 });
  const refetched = job("probing", {
    id: "job-1",
    attempts: 2,
    // Older than the frame already folded in, so `reconcileJob` drops it...
    updatedAt: "2026-08-20T11:59:35.000Z",
    // ...and this is how the card says which copy it is rendering.
    variant: variant({ label: "Losing server copy" }),
  });
  const { fake, listeners } = await watchOneJob(probing, [probing, refetched]);

  act(() => {
    listeners[0]?.onOpen();
  });
  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "active"],
    ["Downloading", "pending"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);

  // Drop the connection and let the backoff bring it back, which is what makes
  // the second `onOpen` a reconnect and forces the refetch.
  act(() => {
    listeners[0]?.onError();
    vi.advanceTimersByTime(2_000);
  });
  expect(listeners).toHaveLength(2);
  await act(async () => {
    listeners[1]?.onOpen();
    // The burst beats the refetch it just triggered, which is what makes the
    // local copy the newer one.
    listeners[1]?.onEvent({
      type: "status",
      jobId: "job-1",
      status: "probing",
      at: "2026-08-20T11:59:40.000Z",
    });
    await Promise.resolve();
  });
  await settle();

  expect(fake.client.getJob).toHaveBeenCalledTimes(2);
  // The race was lost, which is the premise: the local copy won and the refetch
  // is not what is on screen.
  expect(screen.queryByRole("heading", { name: "Losing server copy" })).toBeNull();
  expect(screen.getByRole("heading", { name: "1080p · H.264 + AAC" })).toBeDefined();
  // And the discarded copy's `attempts: 2` came through it anyway.
  expect(pipeline()).toEqual([
    ["Queued", "done"],
    ["Re-analysing", "active"],
    ["Downloading", "done"],
    ["Assembling", "pending"],
    ["Ready", "pending"],
  ]);
});
