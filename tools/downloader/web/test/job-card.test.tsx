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
 * `setInterval` directly and take no clock at all. The link countdown on a
 * queued job is a function of `Date.now()`, so without a fixed system time this
 * file would pass until the fixture's `expiresAt` slipped into the past.
 *
 * Queried by role and accessible name throughout, the way `e2e/download.spec.ts`
 * queries: a test that matched on `.job--failed` would stay green while the e2e
 * suite went red, which is the worst of both.
 *
 * **dl-109** took the four-step pipeline list off the card: the bar and the
 * progress messages under it are the progression now, so the high-water-mark
 * tests that guarded the list's back-edge went with it.
 */

import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppErrorPayload, Job, ProbeStageEvent } from "@downloader/contract";
import { JobCard } from "../src/components/JobCard.tsx";
import { JobList } from "../src/components/JobList.tsx";
import { reconcileJob } from "../src/lib/job-reducer.ts";
import { ProgressMessages } from "../src/components/ProgressMessages.tsx";
import { PROBE_STAGE_PENDING } from "../src/lib/probe-stages.ts";
import type { StreamState } from "../src/lib/job-stream.ts";
import { NOW, SOURCE_URL, errorPayload, job, result, variant } from "./fixtures.ts";

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
  onFollowLink: ReturnType<typeof vi.fn<(id: string) => void>>;
}

function handlers(): Handlers {
  return {
    onCancel: vi.fn<(id: string) => void>(),
    onRemove: vi.fn<(id: string) => void>(),
    onRetry: vi.fn<(job: Job) => void>(),
    onFollowLink: vi.fn<(id: string) => void>(),
  };
}

interface MountOptions {
  streamState?: StreamState;
  refusal?: AppErrorPayload;
  title?: string;
  stage?: ProbeStageEvent;
}

// `title`, `streamState` and `refusal` are `T | undefined` and **required** on
// the props, not optional — so they are passed every time rather than spread in
// conditionally, which under `exactOptionalPropertyTypes` would make them
// optional properties the component does not declare.
function mount(value: Job, options: MountOptions = {}): Handlers {
  const spies = handlers();
  render(
    <ul>
      <JobCard
        job={value}
        title={options.title}
        streamState={options.streamState}
        refusal={options.refusal}
        stage={options.stage}
        onFollowLink={spies.onFollowLink}
        onCancel={spies.onCancel}
        onRemove={spies.onRemove}
        onRetry={spies.onRetry}
      />
    </ul>,
  );
  return spies;
}

function renderList(jobs: readonly Job[], extra: Partial<Parameters<typeof JobList>[0]> = {}) {
  return render(
    <JobList
      jobs={jobs}
      titles={{}}
      streamStates={{}}
      refusals={{}}
      stages={{}}
      revealId={null}
      onFollowLink={vi.fn()}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      {...extra}
    />,
  );
}

/** The card's own accessible name for the bar, which encodes the stage and the figure. */
function barLabel(): string {
  return screen.getByRole("progressbar").getAttribute("aria-label") ?? "";
}

/** One row of the stats list, by its label, or `null` when the row is not rendered. */
function stat(label: string): string | null {
  const term = screen.queryByText(label, { selector: "dt" });
  return term === null ? null : (term.nextElementSibling?.textContent ?? "");
}

/** The progress messages under the bar, in order (dl-109). */
function messages(): string[] {
  return screen
    .getAllByRole("listitem")
    .filter((item) => item.classList.contains("job__message"))
    .map((item) => item.textContent ?? "");
}

// ---------------------------------------------------------------------------
// The rule: an unknown total is never a number
// ---------------------------------------------------------------------------

test("an unknown total says so, and shows no percentage anywhere", () => {
  mount(job("downloading", { progress: { percent: null, totalBytes: null } }));

  expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  expect(barLabel()).toBe("Downloading: in progress, total unknown");

  // Not "0%", not "0.0%", and not a bar that looks finished-ish.
  expect(screen.getByText("· total not known yet")).toBeDefined();
  expect(screen.queryByText(/%/u)).toBeNull();
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
  expect(screen.getByText("42%")).toBeDefined();
  expect(screen.getByText("of ~401 MB")).toBeDefined();
  expect(stat("Speed")).toBe("12 MB/s");
  expect(stat("Remaining")).toBe("2 min left");
  expect(stat("Segments")).toBe("120 / 300");
  expect(barLabel()).toMatch(/42 percent, 12 MB\/s/u);
});

// ---------------------------------------------------------------------------
// Only what is known (dl-109)
// ---------------------------------------------------------------------------

test("an unknown speed, time left or segment count is not rendered at all", () => {
  // The fixture's default: every one of them null. They used to render as a row
  // of dashes in a fixed grid of five; now the row is simply absent.
  mount(job("downloading"));

  expect(stat("Speed")).toBeNull();
  expect(stat("Remaining")).toBeNull();
  expect(stat("Segments")).toBeNull();
  expect(screen.queryByText("—")).toBeNull();
  expect(screen.queryByText(/null/u)).toBeNull();
});

test("a half-known segment count shows what is done, not a count against null", () => {
  // An HLS manifest that has not been enumerated yet is exactly this shape.
  mount(job("downloading", { progress: { segmentsDone: 120, segmentsTotal: null } }));

  expect(stat("Segments")).toBe("120");
  expect(screen.queryByText(/null/u)).toBeNull();
});

test("a preparing job shows how long it has waited, and its figure where the download's will be", () => {
  mount(job("probing", { progress: { downloadedBytes: 0, totalBytes: 100_307_911 } }));

  expect(stat("Waiting")).toBe("0 s");
  // The figure heads the bar from the start, so nothing moves when bytes flow;
  // the bar stays indeterminate and there is no percent until there is one.
  expect(screen.getByText(/^0 B/u)).toBeDefined();
  expect(screen.getByText("of ~96 MB")).toBeDefined();
  expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  expect(screen.queryByText(/%/u)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(12_000);
  });
  expect(stat("Waiting")).toBe("12 s");
  // Nothing has been sent, so nothing about speed is claimed.
  expect(stat("Speed")).toBeNull();
});

// ---------------------------------------------------------------------------
// The statuses
// ---------------------------------------------------------------------------

test("each active status names itself in its pill and its first progress message", () => {
  const cases = [
    ["queued", "Starting", "Opening your download link."],
    // Re-analysing has no status line of its own: the stage is the line, and
    // before the first one lands it is the pending line the analysing panel uses.
    ["probing", "Re-analysing", PROBE_STAGE_PENDING],
    [
      "downloading",
      "Downloading",
      "Sending the video to your browser as it is fetched. Nothing is kept here.",
    ],
  ] as const;

  for (const [status, label, hint] of cases) {
    mount(job(status));
    expect(barLabel()).toMatch(new RegExp(`^${label}:`, "u"));
    expect(screen.getByText(label, { selector: ".pill" })).toBeDefined();
    expect(messages()[0]).toBe(hint);
    // A job still running can always be stopped.
    expect(screen.getByRole("button", { name: "Stop" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    cleanup();
  }
});

test("the card draws no step list; the bar and the messages are the progression", () => {
  mount(job("downloading"));
  expect(screen.queryByRole("list", { name: "Pipeline" })).toBeNull();
  expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
});

test("a re-analysing job before its first stage shows the pending line and nothing else", () => {
  mount(job("probing"));
  expect(messages()).toEqual([PROBE_STAGE_PENDING]);
});

test("the progress messages are one live region", () => {
  mount(job("downloading"));
  const region = screen.getByText(/^Sending the video/u).closest("ul");
  expect(region?.getAttribute("aria-live")).toBe("polite");
});

test("a terminal job offers nothing to stop and no bar, only Dismiss", () => {
  for (const status of ["failed", "canceled"] as const) {
    mount(job(status));
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Remove from list" })).toBeNull();
    cleanup();
  }
});

test("the downloading → probing back edge reads as re-analysing, not as an error", () => {
  // dl-9 made this transition legal: a signed URL that expired mid-download
  // sends the job back to `probing` rather than failing it.
  mount(job("probing", { attempts: 2, progress: { percent: null, downloadedBytes: 0 } }));

  expect(barLabel()).toBe("Re-analysing: in progress, total unknown");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
});

// ---------------------------------------------------------------------------
// What the card calls the job
// ---------------------------------------------------------------------------
//
// `title ?? result?.filename ?? variant?.label ?? sourceUrl`. The page title is
// what the visitor saw when they pressed Download (dl-109); the rest are the
// fallbacks for a job started before it, or restored without one.

test("a job is titled by the page it was started from, with the rendition and host under it", () => {
  mount(job("downloading"), { title: "Harbour timelapse" });
  expect(screen.getByRole("heading", { name: "Harbour timelapse" })).toBeDefined();
  expect(screen.getByText("1080p · H.264 + AAC · videos.example.com")).toBeDefined();
});

test("a job with no page title is titled by the rendition the user chose", () => {
  mount(job("downloading", { variant: variant({ label: "1080p · H.264 + AAC" }) }));
  expect(screen.getByRole("heading", { name: "1080p · H.264 + AAC" })).toBeDefined();
  // The label is the title, so it is not repeated under it.
  expect(screen.getByText("videos.example.com")).toBeDefined();
});

test("a queued job, which has neither, is titled by the address it came from", () => {
  const queued = job("queued");
  expect(queued.variant).toBeNull();
  expect(queued.result).toBeNull();

  mount(queued);
  expect(screen.getByRole("heading", { name: SOURCE_URL })).toBeDefined();
});

// ---------------------------------------------------------------------------
// A saved job is one line (dl-109)
// ---------------------------------------------------------------------------

test("a completed job is one line saying what arrived, and offers no second copy", () => {
  mount(job("completed"));

  // dl-53: the file went to this browser as it streamed and nothing is kept,
  // so there is no link to fetch it again — and nothing else to press.
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
  const row = screen.getByRole("status");
  expect(within(row).getByText("Saved by your browser — a-sample-recording.mp4")).toBeDefined();
  expect(within(row).getByText("399 MB · MP4 · 12:34 · the server kept no copy")).toBeDefined();
  expect(within(row).getByText("Done")).toBeDefined();
});

test("a finished file of unknown duration is described without a trailing separator", () => {
  mount(job("completed", { result: result({ durationSec: null }) }));
  expect(screen.getByText("399 MB · MP4 · the server kept no copy")).toBeDefined();
});

/** `mount` returns the spies; the preview tests need the container instead. */
function renderCard(value: Job): { container: HTMLElement; unmount: () => void } {
  const { container, unmount } = render(
    <ul>
      <JobCard
        job={value}
        title={undefined}
        streamState={undefined}
        refusal={undefined}
        stage={undefined}
        onFollowLink={vi.fn()}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />
    </ul>,
  );
  return { container, unmount };
}

test("an active job shows its preview in the head, beside the title, from our path", () => {
  const { container } = renderCard(job("downloading", { thumbnailPath: "/api/thumbnail/xyz789" }));

  const image = container.querySelector(".job__head .preview img");
  expect(image?.getAttribute("src")).toBe("/api/thumbnail/xyz789");
  expect(image?.getAttribute("alt")).toBe("");
  expect(screen.getByRole("heading", { name: "1080p · H.264 + AAC" })).toBeDefined();
});

test("a job with no preview renders no image and no empty frame", () => {
  // Both the pre-dl-29 records (no key at all) and a probe that found no image
  // (`null`) land here.
  for (const value of [undefined, null] as const) {
    const { container, unmount } = renderCard(
      job("downloading", value === undefined ? {} : { thumbnailPath: value }),
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelectorAll(".preview")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "1080p · H.264 + AAC" })).toBeDefined();
    unmount();
  }
});

test("a saved row shows its preview once, grouped with the filename", () => {
  const { container } = renderCard(job("completed", { thumbnailPath: "/api/thumbnail/done123" }));

  expect(container.querySelectorAll("img")).toHaveLength(1);
  const panel = container.querySelector(".result");
  const children = Array.from(panel?.children ?? []);
  // Two children, so `space-between` has exactly the two boxes it was written
  // for: the image and filename grouped at the left, the pill at the right.
  expect(children).toHaveLength(2);
  const [leading, trailing] = children;
  expect(leading?.querySelector(".preview img")?.getAttribute("src")).toBe(
    "/api/thumbnail/done123",
  );
  expect(leading?.querySelector(".result__filename")?.textContent).toBe(
    "Saved by your browser — a-sample-recording.mp4",
  );
  expect(trailing?.textContent).toBe("Done");
});

test("a saved row with no preview collapses its group to the meta alone", () => {
  for (const value of [undefined, null] as const) {
    const { container, unmount } = renderCard(
      job("completed", value === undefined ? {} : { thumbnailPath: value }),
    );
    expect(container.querySelectorAll(".preview")).toHaveLength(0);
    const grouped = Array.from(container.querySelector(".result__headline")?.children ?? []);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.className).toBe("result__meta");
    unmount();
  }
});

// ---------------------------------------------------------------------------
// The link, and its fallback (#433)
// ---------------------------------------------------------------------------

test("a queued job offers its link as a fallback, once, and says how long it has", () => {
  mount(job("queued"));

  expect(screen.getByText("Nothing in your browser's downloads?")).toBeDefined();
  const link = screen.getByRole("link", { name: "Download" });
  expect(link.getAttribute("href")).toBe("/api/files/opaque-token");
  // Empty: the name is the server's, from `Content-Disposition`.
  expect(link.getAttribute("download")).toBe("");
  expect(screen.getByText(/the link works once · expires in 14 min\./u)).toBeDefined();
});

test("a queued job whose link has expired offers the reason, not a dead link", () => {
  mount(
    job("queued", {
      link: { url: "/api/files/opaque-token", expiresAt: "2026-08-20T11:00:00.000Z" },
    }),
  );

  expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
  const notice = screen.getByRole("alert");
  expect(within(notice).getByRole("heading", { name: "Link used or expired" })).toBeDefined();
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

  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Canceled" })).toBeDefined();
  expect(within(notice).queryByRole("button")).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
});

test("a reconnecting stream is announced without disturbing the job's own state", () => {
  mount(job("downloading"), { streamState: "reconnecting" });

  expect(screen.getByRole("status")).toHaveProperty("textContent", "reconnecting…");
  expect(screen.getByRole("progressbar")).toBeDefined();
});

test("a healthy stream shows no pill at all", () => {
  // `useJobs` writes every `StreamState` into its record, so a healthy value is
  // the common case — a card that compared it to nothing would wear a permanent
  // pill.
  for (const healthy of ["idle", "connecting", "open", "closed"] as const) {
    mount(job("downloading"), { streamState: healthy });
    expect(screen.queryByText("reconnecting…")).toBeNull();
    // A negative assertion needs something positive beside it: the status pill
    // lives in the same row as the stream pill.
    expect(screen.getByText("Downloading", { selector: ".pill" })).toBeDefined();
    cleanup();
  }

  mount(job("downloading"));
  expect(screen.queryByText("reconnecting…")).toBeNull();
});

test("stop and dismiss report the job they were pressed on", () => {
  const live = mount(job("downloading", { id: "job-1" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(live.onCancel).toHaveBeenCalledWith("job-1");
  cleanup();

  const failed = mount(job("failed", { id: "job-2" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(failed.onRemove).toHaveBeenCalledWith("job-2");
});

// ---------------------------------------------------------------------------
// The list around it
// ---------------------------------------------------------------------------

test("an empty job list renders nothing at all", () => {
  const { container } = renderList([]);
  expect(container.innerHTML).toBe("");
});

test("the list offers no clear button, whatever has finished (dl-109)", () => {
  renderList([
    job("downloading", { id: "job-1", variant: variant({ label: "Still going" }) }),
    job("completed", { id: "job-2", variant: variant({ label: "Finished" }) }),
    job("failed", { id: "job-3", variant: variant({ label: "Gave up" }) }),
  ]);

  expect(screen.getByRole("heading", { name: "Still going" })).toBeDefined();
  expect(screen.getByText("Saved by your browser — a-sample-recording.mp4")).toBeDefined();
  expect(screen.getByRole("heading", { name: "Gave up" })).toBeDefined();
  expect(screen.queryByRole("button", { name: /Clear/u })).toBeNull();
});

test("each card is handed its own title, looked up by job id", () => {
  renderList(
    [
      job("downloading", { id: "job-1", variant: variant({ label: "First" }) }),
      job("downloading", { id: "job-2", variant: variant({ label: "Second" }) }),
    ],
    { titles: { "job-2": "Harbour timelapse" } },
  );

  expect(screen.getByRole("heading", { name: "First" })).toBeDefined();
  expect(screen.getByRole("heading", { name: "Harbour timelapse" })).toBeDefined();
  expect(screen.queryByRole("heading", { name: "Second" })).toBeNull();
});

test("each card is handed its own stream state, looked up by job id", () => {
  // The value has to be the visible one, and it has to be wrong for the *other*
  // card, or a lookup keyed by array index still passes.
  renderList(
    [
      job("downloading", { id: "job-1", variant: variant({ label: "First" }) }),
      job("downloading", { id: "job-2", variant: variant({ label: "Second" }) }),
    ],
    { streamStates: { "job-2": "reconnecting" } },
  );

  const cards = screen.getAllByRole("listitem").filter((item) => item.querySelector("h3"));
  const [first, second] = cards;
  expect(cards).toHaveLength(2);
  expect(within(first as HTMLElement).getByRole("heading", { name: "First" })).toBeDefined();
  expect(within(second as HTMLElement).getByText("reconnecting…")).toBeDefined();
  expect(within(first as HTMLElement).queryByText("reconnecting…")).toBeNull();
});

test("the list says the page can be closed once bytes flow, and only then", () => {
  const note = /You can close this page — downloads continue in your browser\./u;
  renderList([job("downloading")]);
  expect(screen.getByText(note)).toBeDefined();
  cleanup();
  // Before the first byte the browser holds a request, not a download, and
  // Firefox cancels it with the tab (dl-109's gate). A queued link has not been
  // opened at all, and a finished job has nothing left to continue.
  for (const status of ["queued", "probing", "completed", "failed", "canceled"] as const) {
    renderList([job(status)]);
    expect(screen.queryByText(note)).toBeNull();
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Why a job was canceled (dl-53)
// ---------------------------------------------------------------------------

function canceledFor(reason: string): Job {
  return job("canceled", { error: errorPayload("JOB_CANCELED", { details: { reason } }) });
}

test("a job the visitor canceled says they stopped it", () => {
  mount(canceledFor("requested"));
  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Canceled" })).toBeDefined();
  expect(within(notice).getByText(/You stopped this download\./u)).toBeDefined();
});

test("a job whose connection closed mid-download says it was interrupted, and blames no tab", () => {
  mount(canceledFor("disconnected"));
  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Download interrupted" })).toBeDefined();
  expect(within(notice).getByText(/connection closed before the file finished/u)).toBeDefined();
  // dl-109: a browser download outlives the tab that started it.
  expect(within(notice).queryByText(/tab/u)).toBeNull();
});

test("a job whose link nobody opened says the link expired", () => {
  mount(canceledFor("link-expired"));
  const notice = screen.getByRole("status");
  expect(within(notice).getByRole("heading", { name: "Link expired" })).toBeDefined();
  expect(within(notice).getByText(/was not opened within fifteen minutes/u)).toBeDefined();
});

// --- dl-77: a refused link says why, and stays on offer -----------------------

const capRefusal: AppErrorPayload = errorPayload("RATE_LIMITED", {
  message:
    "You already have as many downloads running or waiting as this server allows per client. Try again once one finishes.",
  details: { retryAfterSec: 30 },
});

test("a refused link says why and when to try again, and Download stays offered", () => {
  mount(job("queued"), { refusal: capRefusal });

  const notice = screen.getByRole("alert");
  expect(within(notice).getByText(/as many downloads running or waiting/u)).toBeDefined();
  expect(within(notice).getByText("Wait 30 s before trying again.")).toBeDefined();
  expect(within(notice).getByText("RATE_LIMITED")).toBeDefined();
  expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
    "/api/files/opaque-token",
  );
});

test("a refusal with no wait says why and does not invent one", () => {
  mount(job("queued"), {
    refusal: errorPayload("INTERNAL", {
      message: "The server is shutting down and is not starting new jobs.",
    }),
  });

  expect(within(screen.getByRole("alert")).getByText(/shutting down/u)).toBeDefined();
  expect(screen.queryByText(/before trying again/u)).toBeNull();
});

test("no refusal, no alert: a queued card is as it was", () => {
  mount(job("queued"));
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a refusal is not shown once the job has left the queue", () => {
  mount(job("probing"), { refusal: capRefusal });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("following the link tells the list, and does not stop the browser following it", () => {
  const spies = mount(job("queued", { id: "job-9" }), { refusal: capRefusal });
  const link = screen.getByRole("link", { name: "Download" });

  // `fireEvent` returns false when a handler called `preventDefault`: the
  // download must still happen, so the click handler must not.
  expect(fireEvent.click(link)).toBe(true);
  expect(spies.onFollowLink).toHaveBeenCalledExactlyOnceWith("job-9");
});

// ---------------------------------------------------------------------------
// dl-96: an expected total is shown as one, and is still not a percent
// ---------------------------------------------------------------------------

test("an expected size reads as approximate, and leaves the bar indeterminate", () => {
  mount(
    job("downloading", {
      progress: { percent: null, downloadedBytes: 7_130_000, totalBytes: 100_307_911 },
    }),
  );

  expect(screen.getByText("of ~96 MB")).toBeDefined();
  expect(screen.getByText(/^6\.8 MB/u)).toBeDefined();
  expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  expect(screen.queryByText(/%/u)).toBeNull();
});

test("a progress message is its text alone, as the analysing panel's stage line is", () => {
  for (const status of ["queued", "probing", "downloading"] as const) {
    mount(job(status));
    const items = screen
      .getAllByRole("listitem")
      .filter((item) => item.classList.contains("job__message"));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.children).toHaveLength(0);
      expect(item.querySelector("svg")).toBeNull();
    }
    cleanup();
  }
});

test("time leads the stats in both states: waited while preparing, remaining while downloading", () => {
  mount(job("probing"));
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual(["Waiting"]);
  cleanup();

  mount(
    job("downloading", {
      progress: { etaSec: 90, speedBps: 13_000_000, segmentsDone: 1, segmentsTotal: 2 },
    }),
  );
  expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual([
    "Remaining",
    "Speed",
    "Segments",
  ]);
});

/** The column class a stat's cell carries, by its label. */
function columnOf(term: string): string {
  return screen.getByText(term, { selector: "dt" }).parentElement?.className ?? "";
}

test("each stat keeps its own column, so an unknown one leaves a gap rather than a shift", () => {
  // No time left known: Speed stays in the second column and Segments in the
  // third, exactly where they sit on a card that knows all three.
  mount(job("downloading", { progress: { etaSec: null, speedBps: 13_000_000, segmentsDone: 4 } }));
  expect(columnOf("Speed")).toBe("stats__col-2");
  expect(columnOf("Segments")).toBe("stats__col-3");
  expect(stat("Remaining")).toBeNull();
});

test("progress messages render one line each, in order, in one live region", () => {
  render(
    <ProgressMessages
      messages={[
        { key: "status", text: "Sending the video." },
        { key: "connections", text: "Reading on 4 connections." },
      ]}
    />,
  );

  const items = screen.getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Sending the video.",
    "Reading on 4 connections.",
  ]);
  // Both lines in the one live region, so the second is announced when it appears.
  expect(items[0]?.parentElement).toBe(items[1]?.parentElement);
  expect(items[0]?.parentElement?.getAttribute("aria-live")).toBe("polite");
});

// ---------------------------------------------------------------------------
// A reopened card whose filename the server has cleared (dl-107)
// ---------------------------------------------------------------------------

/**
 * The state a restore produces: the tab was closed while the job ran, so the
 * local copy is `downloading` with no result, and the server's copy of the
 * finished job (fifteen minutes on) has had its filename blanked. The pair goes
 * through `reconcileJob` exactly as `useJobs` does.
 */
function reopenedAfterClearing(): Job {
  const local = job("downloading", { updatedAt: "2026-08-20T11:00:00.000Z" });
  const cleared = job("completed", {
    updatedAt: "2026-08-20T11:59:00.000Z",
    sourceUrl: "",
    variant: null,
    result: result({ filename: "" }),
  });
  return reconcileJob(local, cleared);
}

test("a reopened card with a blank filename is named by the title this browser kept", () => {
  mount(reopenedAfterClearing(), { title: "A sample recording" });

  expect(screen.getByText("Saved by your browser — A sample recording")).toBeDefined();
  expect(screen.queryByText(/—\s*$/u)).toBeNull();
});

test("and with no title kept either it reads without a dash, never a dash and nothing", () => {
  mount(reopenedAfterClearing());

  const line = screen.getByText("Saved by your browser");
  expect(line.textContent).toBe("Saved by your browser");
  expect(line.textContent).not.toContain("—");
});

test("a filename the server still has wins over the title", () => {
  mount(job("completed"), { title: "A sample recording" });

  expect(screen.getByText("Saved by your browser — a-sample-recording.mp4")).toBeDefined();
  expect(screen.queryByText(/A sample recording/u)).toBeNull();
});

test("a whitespace-only title is no title: no trailing dash", () => {
  mount(reopenedAfterClearing(), { title: "   " });

  const line = screen.getByText("Saved by your browser");
  expect(line.textContent).toBe("Saved by your browser");
});

// ---------------------------------------------------------------------------
// The re-probe's stages (dl-110)
// ---------------------------------------------------------------------------

test("a re-analysing card's line is the latest stage, and only that", () => {
  mount(job("probing"), { stage: { stage: "page-load", resolver: "browser" } });

  expect(messages()).toEqual(["Loading the page"]);
});

test("a stage held for a job that is no longer re-analysing is never shown", () => {
  mount(job("downloading"), { stage: { stage: "page-load", resolver: "browser" } });

  expect(screen.queryByText("Loading the page")).toBeNull();
  expect(messages()[0]).toBe(
    "Sending the video to your browser as it is fetched. Nothing is kept here.",
  );
});

// ---------------------------------------------------------------------------
// dl-108: a source read on parallel connections says so
// ---------------------------------------------------------------------------

test("a job read on 4 connections adds one message, after the status line", () => {
  mount(job("downloading", { progress: { originConnections: 4 } }));

  const lines = messages();
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Sending the video/u);
  expect(lines[1]).toBe("Reading on 4 connections. This source throttles each one.");
  // It is the live region's own entry, so it is announced when it appears.
  const region = screen.getByText(/Reading on 4 connections/u).closest("ul");
  expect(region?.getAttribute("aria-live")).toBe("polite");
});

test("the message follows the count: 2 connections read 2, and it goes when the count falls to 1", () => {
  mount(job("downloading", { progress: { originConnections: 2 } }));
  expect(messages()[1]).toBe("Reading on 2 connections. This source throttles each one.");
  cleanup();

  mount(job("downloading", { progress: { originConnections: 1 } }));
  expect(messages()).toHaveLength(1);
});

test("one connection, none open between requests, and not measured all say nothing", () => {
  for (const originConnections of [1, 0, null]) {
    mount(job("downloading", { progress: { originConnections } }));
    expect(messages(), `originConnections ${String(originConnections)}`).toHaveLength(1);
    expect(screen.queryByText(/connections/u)).toBeNull();
    cleanup();
  }
});

test("a job that is not downloading shows no connection message, whatever the count says", () => {
  mount(job("probing", { progress: { originConnections: 4 } }));
  // The card did render, with its own line and nothing after it.
  expect(messages()).toEqual([PROBE_STAGE_PENDING]);
  expect(screen.queryByText(/Reading on 4 connections/u)).toBeNull();
});

// ---------------------------------------------------------------------------
// The card just started is brought into view
// ---------------------------------------------------------------------------

test("the job just started scrolls its card into view, nearest, and no other card moves", () => {
  // jsdom has no layout, so the call is what is asserted, not a scroll offset.
  const scrolled: Element[] = [];
  const scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
  Element.prototype.scrollIntoView = scrollIntoView;
  try {
    renderList([job("queued", { id: "job-old" }), job("queued", { id: "job-new" })], {
      revealId: "job-new",
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    const cards = screen.getByRole("list", { name: "Downloads" }).querySelectorAll(":scope > li");
    expect(scrolled).toEqual([cards[1]]);
  } finally {
    // @ts-expect-error -- jsdom has none, and a later test must not inherit the stub.
    delete Element.prototype.scrollIntoView;
  }
});

test("a list with no job just started scrolls nothing, as after a reload", () => {
  const scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView;
  try {
    renderList([job("queued", { id: "job-1" })]);
    expect(scrollIntoView).not.toHaveBeenCalled();
  } finally {
    // @ts-expect-error -- jsdom has none, and a later test must not inherit the stub.
    delete Element.prototype.scrollIntoView;
  }
});
