// @vitest-environment jsdom

/**
 * One job, rendered in every state the FSM can put it in — plus the list around it.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than a
 * vitest project of its own.
 *
 * **The clock is faked with `vi.setSystemTime`, not with `helpers.ts`'s fake clock.**
 * dl-15's brief points at `createFakeClock` and it does not reach here: that fake
 * implements the injectable `Clock` from `src/lib/clock.ts`, which `job-stream`
 * takes as an option, while `useNow` and `useElapsed` call `Date.now()` and
 * `setInterval` directly and take no clock at all. The retention countdown on a
 * finished job is a function of `Date.now()`, so without a fixed system time this
 * file would pass until the fixture's `expiresAt` slipped into the past — the
 * delay fuse the brief is warning about, just armed by a different mechanism.
 *
 * Queried by role and accessible name throughout, the way `e2e/download.spec.ts`
 * queries: a test that matched on `.job--failed` would stay green while the e2e
 * suite went red, which is the worst of both.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Job } from "@downloader/contract";
import { JobCard } from "../src/components/JobCard.tsx";
import { JobList } from "../src/components/JobList.tsx";
import { UNKNOWN } from "../src/lib/format.ts";
import type { StreamState } from "../src/lib/job-stream.ts";
import { NOW, SOURCE_URL, job, result, variant } from "./fixtures.ts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Handlers {
  onCancel: ReturnType<typeof vi.fn<(id: string) => void>>;
  onRemove: ReturnType<typeof vi.fn<(id: string) => void>>;
  onRetry: ReturnType<typeof vi.fn<(job: Job) => void>>;
}

function handlers(): Handlers {
  return {
    onCancel: vi.fn<(id: string) => void>(),
    onRemove: vi.fn<(id: string) => void>(),
    onRetry: vi.fn<(job: Job) => void>(),
  };
}

// `streamState` is `StreamState | undefined` and **required** on the props, not
// optional — so it is passed every time rather than spread in conditionally,
// which under `exactOptionalPropertyTypes` would make it an optional property
// the component does not declare.
function mount(value: Job, streamState?: StreamState): Handlers {
  const spies = handlers();
  render(
    <ul>
      <JobCard
        job={value}
        streamState={streamState}
        onCancel={spies.onCancel}
        onRemove={spies.onRemove}
        onRetry={spies.onRetry}
      />
    </ul>,
  );
  return spies;
}

/** The card's own accessible name for the bar, which encodes the stage and the figure. */
function barLabel(): string {
  return screen.getByRole("progressbar").getAttribute("aria-label") ?? "";
}

/**
 * One row of the stats list, by its label. Several of them render the same em
 * dash when they have nothing, so "is there a dash on the card" proves nothing —
 * the assertion has to name which figure it is looking at.
 */
function stat(label: string): string {
  const term = screen.getByText(label);
  return term.nextElementSibling?.textContent ?? "";
}

// ---------------------------------------------------------------------------
// The rule: an unknown total is never a number
// ---------------------------------------------------------------------------

test("an unknown total says so, and shows no percentage anywhere", () => {
  mount(job("downloading", { progress: { percent: null, totalBytes: null } }));

  expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  expect(barLabel()).toBe("Downloading: in progress, total unknown");

  // The figure the card would otherwise print. "unknown total" is the whole
  // point: not "0%", not "0.0%", and not a bar that looks finished-ish.
  expect(screen.getByText("unknown total")).toBeDefined();
  expect(screen.queryByText(/%/u)).toBeNull();
  expect(screen.queryByText("0.0%")).toBeNull();
});

test("a known total is rendered as a figure and a determinate bar", () => {
  mount(
    job("downloading", {
      progress: {
        percent: 41.6,
        totalBytes: 420_000_000,
        speedBps: 13_000_000,
        etaSec: 90,
        segmentsDone: 120,
        segmentsTotal: 300,
      },
    }),
  );

  const bar = screen.getByRole("progressbar") as HTMLProgressElement;
  expect(bar.value).toBeCloseTo(41.6);
  expect(screen.getByText("41.6%")).toBeDefined();
  expect(screen.getByText("120 / 300")).toBeDefined();
  expect(barLabel()).toMatch(/42 percent, 12 MB\/s/u);
});

// ---------------------------------------------------------------------------
// The statuses
// ---------------------------------------------------------------------------

test("an unenumerated segment count is a dash, not the word null", () => {
  // The twin of the branch below, and the one nearly every card in this suite
  // takes: `fixtures.ts` defaults `segmentsDone` to null, so this is the
  // *default* render. Collapsing the null arm left all 162 tests green while
  // the row read "Segmentsnull" — nothing was looking at the cell that almost
  // every fixture exercised.
  mount(job("downloading", { progress: { segmentsDone: null, segmentsTotal: null } }));

  expect(stat("Segments")).toBe(UNKNOWN);
  expect(stat("Segments")).not.toContain("null");
});

test("a half-known segment count shows what is done, not a count against null", () => {
  // Swept up with the audio-codec branch: every fixture set `segmentsDone` and
  // `segmentsTotal` together or set neither, so the middle case never rendered
  // and collapsing it to `${done} / ${total}` left the suite green — printing
  // the literal string "null" at a user. An HLS manifest that has not been
  // enumerated yet is exactly this shape.
  mount(
    job("downloading", {
      progress: { segmentsDone: 120, segmentsTotal: null },
    }),
  );

  expect(stat("Segments")).toBe("120");
  expect(screen.queryByText(/null/u)).toBeNull();
});

test("a finished file of unknown duration is described without a trailing dash", () => {
  mount(job("completed", { result: result({ durationSec: null }) }));

  // `399 MB · MP4`, and nothing after it — the separator only earns its place
  // when there is a duration to follow it.
  expect(screen.getByText("399 MB · MP4")).toBeDefined();
  expect(screen.queryByText(/MP4 · —/u)).toBeNull();
});

test("each active status names itself and says why the job is sitting there", () => {
  const cases = [
    ["queued", "Queued", "Waiting for a free worker slot."],
    ["probing", "Re-analysing", "Fetching fresh stream links — signed URLs expire within minutes."],
    ["downloading", "Downloading", "Pulling the video data."],
    ["muxing", "Assembling", "Joining audio and video into a playable file."],
  ] as const;

  for (const [status, label, hint] of cases) {
    mount(job(status));
    expect(barLabel()).toMatch(new RegExp(`^${label}:`, "u"));
    expect(screen.getByText(hint)).toBeDefined();
    // The pipeline is spelled out for an active job, in FSM order.
    const steps = within(screen.getByRole("list", { name: "Pipeline" })).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "Queued",
      "Re-analysing",
      "Downloading",
      "Assembling",
      "Ready",
    ]);
    // `active` is one expression covering four statuses, so it is asserted for
    // each of them rather than only for `downloading`: a job still running can
    // always be stopped.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    cleanup();
  }
});

test("a terminal job offers nothing to cancel and no pipeline to watch", () => {
  // The other side of `active`, for all three terminal statuses. Hard-code it
  // either way and one of these two tests goes red.
  for (const status of ["completed", "failed", "canceled"] as const) {
    mount(job(status));
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Pipeline" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    // Removing it from the list is the one action that survives.
    expect(screen.getByRole("button", { name: "Remove from list" })).toBeDefined();
    cleanup();
  }
});

test("the downloading → probing back edge keeps the work, and is not an error", () => {
  // dl-9 made this transition legal: a signed URL that expired mid-download
  // sends the job back to `probing` rather than failing it. What must not
  // happen is the card reading as a reset — the bytes already fetched are still
  // reported, and nothing on screen claims something went wrong.
  const carried = { percent: null, downloadedBytes: 41_000_000 };
  const downloading = job("downloading", { progress: carried });
  const reprobing = job("probing", { progress: carried, attempts: 2 });

  mount(downloading);
  expect(screen.getByText("39 MB")).toBeDefined();
  cleanup();

  mount(reprobing);
  expect(screen.getByText("39 MB")).toBeDefined();
  expect(
    screen.getByText("Fetching fresh stream links — signed URLs expire within minutes."),
  ).toBeDefined();
  expect(barLabel()).toBe("Re-analysing: in progress, total unknown");
  // Not a failure, and not finished: no notice of either kind is on screen.
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("link", { name: "Download file" })).toBeNull();
});

test("a forward-running job marks the steps behind it done and the current one active", () => {
  // The positive half of the step list, which nothing asserted: both predicates
  // in `JobCard`'s className ternary could be replaced with `false` — every step
  // rendering as plain, unmarked text — and all 162 tests stayed green. Only the
  // *pending* class was ever asserted, by the characterization test below.
  //
  // On class name for the same reason that one is: done, active and pending are
  // CSS-only, with no accessible counterpart. dl-18 changes that, and a job that
  // has only ever moved forward renders identically under its high-water mark,
  // so this test survives it unchanged.
  mount(job("muxing"));

  const steps = within(screen.getByRole("list", { name: "Pipeline" })).getAllByRole("listitem");
  expect(steps.map((step) => [step.textContent, step.className])).toEqual([
    ["Queued", "steps__item steps__item--done"],
    ["Re-analysing", "steps__item steps__item--done"],
    ["Downloading", "steps__item steps__item--done"],
    ["Assembling", "steps__item steps__item--active"],
    ["Ready", "steps__item"],
  ]);
});

test("CHARACTERIZATION (dl-18): the step list walks backwards on a re-probe", () => {
  // **This pins today's behaviour, and today's behaviour is the bug.** The
  // progress figures survive the back edge — the test above proves that — but
  // the pipeline list does not: "Downloading" loses its done marker while the
  // job re-probes, so a user watching the card sees the job go backwards.
  // dl-18 specifies a high-water mark, and when it lands this test inverts:
  // `--done` becomes the expected class for a step already passed.
  //
  // Asserted on `className` rather than by role, deliberately and only here.
  // The step list conveys its state through CSS alone — no `aria-current`, no
  // accessible name that changes — so there is nothing role-shaped to query.
  // That absence is itself part of dl-18's brief.
  const reprobing = job("probing", {
    progress: { percent: null, downloadedBytes: 41_000_000 },
  });
  mount(reprobing);

  const steps = within(screen.getByRole("list", { name: "Pipeline" })).getAllByRole("listitem");
  const downloadingStep = steps.find((step) => step.textContent === "Downloading");
  expect(downloadingStep).toBeDefined();
  expect(downloadingStep?.className).toBe("steps__item");
  expect(downloadingStep?.className).not.toContain("steps__item--done");
});

// ---------------------------------------------------------------------------
// What the card calls the job
// ---------------------------------------------------------------------------
//
// `variant?.label ?? result?.filename ?? sourceUrl`, and all three branches are
// live in production. The API inserts `variant_json` as `NULL`, so a job has no
// variant at all until the probe fills one in — which means the *last* branch is
// the one a queued card actually takes, and it was the one nothing reached: with
// a variant on every fixture, replacing the whole expression with
// `job.variant?.label ?? "untitled"` left every web test green.

test("a job with a variant is titled by the rendition the user chose", () => {
  mount(job("downloading", { variant: variant({ label: "1080p · H.264 + AAC" }) }));
  expect(screen.getByRole("heading", { name: "1080p · H.264 + AAC" })).toBeDefined();
});

test("a job with no variant but a finished file is titled by the filename", () => {
  // The middle branch: a job whose probe never landed a variant snapshot, but
  // which produced a file anyway.
  mount(job("completed", { variant: null, variantId: null }));

  expect(screen.getByRole("heading", { name: "a-sample-recording.mp4" })).toBeDefined();
  expect(screen.queryByRole("heading", { name: /1080p/u })).toBeNull();
});

test("a queued job, which has neither, is titled by the address it came from", () => {
  // The branch every real job starts on, and the one a user sees for as long as
  // the queue is busy.
  const queued = job("queued");
  expect(queued.variant).toBeNull();
  expect(queued.result).toBeNull();

  mount(queued);
  expect(screen.getByRole("heading", { name: SOURCE_URL })).toBeDefined();
});

test("a completed job offers the file, its size and how long it will be kept", () => {
  mount(job("completed"));

  const link = screen.getByRole("link", { name: "Download file" });
  expect(link.getAttribute("href")).toBe("/api/files/opaque-token/a-sample-recording.mp4");
  expect(link.getAttribute("download")).toBe("a-sample-recording.mp4");
  expect(screen.getByText("expires in 2 h 0 min")).toBeDefined();
  expect(screen.getByText(/^399 MB · MP4 · 12:34$/u)).toBeDefined();
  // Terminal: no bar, no pipeline, nothing to cancel.
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

test("a completed job past its retention window offers the reason, not a dead link", () => {
  mount(job("completed", { result: result({ expiresAt: "2026-08-20T11:00:00.000Z" }) }));

  expect(screen.queryByRole("link", { name: "Download file" })).toBeNull();
  // `FILE_EXPIRED` is not `final` in the presentation table, so it is an alert
  // rather than a status — the file is gone and there is nothing to click.
  const notice = screen.getByRole("alert");
  expect(within(notice).getByRole("heading", { name: "File removed" })).toBeDefined();
  expect(within(notice).getByText("FILE_EXPIRED")).toBeDefined();
});

test("a failed job explains itself and offers a retry that carries the job back", () => {
  const failed = job("failed");
  const spies = mount(failed);

  const notice = screen.getByRole("alert");
  expect(within(notice).getByRole("heading", { name: "Download failed" })).toBeDefined();
  fireEvent.click(within(notice).getByRole("button", { name: "Analyse and retry" }));
  expect(spies.onRetry).toHaveBeenCalledWith(failed);
});

test("a canceled job is presented as an answer, not an alarm", () => {
  mount(job("canceled"));

  // `final` in the presentation table: role="status", no retry affordance.
  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Canceled" })).toBeDefined();
  expect(within(notice).queryByRole("button")).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});

test("a reconnecting stream is announced without disturbing the job's own state", () => {
  mount(job("downloading"), "reconnecting");

  expect(screen.getByRole("status")).toHaveProperty("textContent", "reconnecting…");
  expect(screen.getByRole("progressbar")).toBeDefined();
});

test("a healthy stream shows no pill at all", () => {
  // Last round proved `JobList` looks the state up by job id. It did not prove
  // `JobCard` compares it to anything: `streamState !== undefined` passed all
  // 162 tests, because after that fix no test supplied a *healthy* state any
  // more. Closing one seam removed the fixture that exercised the other.
  //
  // `useJobs` writes every `StreamState` into that record, so a healthy value is
  // the common case. Under the mutant every job with a working stream wears a
  // permanent orange pill and the suite says nothing.
  for (const healthy of ["idle", "connecting", "open", "closed"] as const) {
    mount(job("downloading"), healthy);
    expect(screen.queryByText("reconnecting…")).toBeNull();
    // Still rendering — this is not passing because the pill row vanished.
    expect(screen.getByRole("progressbar")).toBeDefined();
    cleanup();
  }

  // And with no state recorded for the job at all.
  mount(job("downloading"));
  expect(screen.queryByText("reconnecting…")).toBeNull();
});

test("cancel and remove report the job they were pressed on", () => {
  const spies = mount(job("downloading"));

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(spies.onCancel).toHaveBeenCalledWith("job-1");

  fireEvent.click(screen.getByRole("button", { name: "Remove from list" }));
  expect(spies.onRemove).toHaveBeenCalledWith("job-1");
});

// ---------------------------------------------------------------------------
// The list around it
// ---------------------------------------------------------------------------

test("an empty job list renders nothing at all", () => {
  const { container } = render(
    <JobList
      jobs={[]}
      streamStates={{}}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      onClearFinished={vi.fn()}
    />,
  );
  expect(container.innerHTML).toBe("");
});

test("the list counts what has finished and offers to clear only those", () => {
  const onClearFinished = vi.fn<() => void>();
  render(
    <JobList
      jobs={[
        job("downloading", { id: "job-1", variant: variant({ label: "Still going" }) }),
        job("completed", { id: "job-2", variant: variant({ label: "Finished" }) }),
        job("failed", { id: "job-3", variant: variant({ label: "Gave up" }) }),
      ]}
      streamStates={{ "job-1": "reconnecting" }}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      onClearFinished={onClearFinished}
    />,
  );

  for (const title of ["Still going", "Finished", "Gave up"]) {
    expect(screen.getByRole("heading", { name: title })).toBeDefined();
  }
  fireEvent.click(screen.getByRole("button", { name: "Clear 2 finished" }));
  expect(onClearFinished).toHaveBeenCalledOnce();
});

test("each card is handed its own stream state, looked up by job id", () => {
  // `streamStates[job.id]` was proven by nothing: the old fixture said
  // `{ "job-1": "open" }`, and `"open"` is the one value that renders nothing —
  // only `"reconnecting"` produces a pill. So `streamState={undefined}` passed
  // the whole suite. The value has to be the visible one, and it has to be
  // wrong for the *other* card, or a lookup keyed by array index still passes.
  render(
    <JobList
      jobs={[
        job("downloading", { id: "job-1", variant: variant({ label: "First" }) }),
        job("downloading", { id: "job-2", variant: variant({ label: "Second" }) }),
      ]}
      streamStates={{ "job-2": "reconnecting" }}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      onClearFinished={vi.fn()}
    />,
  );

  const cards = screen.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
  const [first, second] = cards;
  expect(cards).toHaveLength(2);
  expect(within(first as HTMLElement).getByRole("heading", { name: "First" })).toBeDefined();
  expect(within(second as HTMLElement).getByRole("heading", { name: "Second" })).toBeDefined();

  // In the second card, and only there.
  expect(within(second as HTMLElement).getByText("reconnecting…")).toBeDefined();
  expect(within(first as HTMLElement).queryByText("reconnecting…")).toBeNull();
});

test("a list with nothing finished offers no clear button", () => {
  render(
    <JobList
      jobs={[job("downloading")]}
      streamStates={{}}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      onClearFinished={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /Clear/u })).toBeNull();
});
