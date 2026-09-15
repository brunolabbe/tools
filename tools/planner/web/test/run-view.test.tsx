// @vitest-environment jsdom

/**
 * What the run screen says while a run is happening.
 *
 * Every assertion here is the repo's _never fake progress_ rule in the one place
 * it is easiest to break, because a progress bar always looks like it is telling
 * the truth. pl-24 broke it twice in one branch — first by rendering "N of M
 * specialists done" underneath a grounding header, then by replaying the
 * fan-out's finished counters as grounding's own — and neither was visible to
 * any test, because until now this component had none.
 *
 * **The fake is the API client module, never `fetch`** — the rule
 * `plan-view.test.tsx` and `wizard.test.tsx` both state, for the same reason.
 * `watchRun` is faked so a spec can hand the component a frame directly, which
 * is the only way to sit a run in a state a real server would take a minute to
 * reach.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Run, RunEvent, RunStatus } from "@planner/contract";
import { cancelRun, fetchPlan, watchRun } from "../src/api/plan.ts";
import { RunView, type AttachTarget } from "../src/plan/RunView.tsx";
import { day, planView, revision } from "./plan-fixtures.ts";

vi.mock("../src/api/plan.ts", () => ({
  watchRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchPlan: vi.fn(),
}));

const watched = vi.mocked(watchRun);
const canceled = vi.mocked(cancelRun);
const fetched = vi.mocked(fetchPlan);

/** Whatever `watchRun` was last handed as its callback. */
let emit: (event: RunEvent) => void = () => undefined;

/**
 * Push one frame at the component, the way the event stream would.
 *
 * Inside `act`, because the callback lands outside React's own event handling —
 * without it the state update is queued and never flushed, and every assertion
 * below reads the render from *before* the frame arrived.
 */
function push(event: RunEvent): void {
  act(() => {
    emit(event);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  watched.mockImplementation((_runId, onEvent) => {
    emit = onEvent;
    return () => undefined;
  });
  canceled.mockResolvedValue({} as Run);
  fetched.mockResolvedValue({} as never);
});

// `globals: false`, so Testing Library registers no cleanup of its own.
afterEach(cleanup);

const AT = "2026-08-22T12:00:00.000Z";

/**
 * A run mid-fan-out by default. `rosterSize` and `specialistsDone` are the
 * fan-out's counters and the only ones a `Run` carries — which is the whole
 * subject of the grounding tests below.
 */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: "run-1",
    planId: "plan-1",
    kind: "draft",
    status: "fanning-out",
    rosterSize: 5,
    specialistsDone: 5,
    error: null,
    startedAt: AT,
    finishedAt: null,
    ...overrides,
  };
}

function show(status: RunStatus): void {
  render(<RunView run={run({ status })} onExit={() => undefined} onOpenPlan={() => undefined} />);
}

describe("the run screen while the specialists work", () => {
  test("counts specialists, because that is what the counters count", () => {
    show("fanning-out");

    expect(screen.getByText("Asking the specialists")).toBeTruthy();
    expect(screen.getByText("5 of 5 specialists done.")).toBeTruthy();
  });

  test("shows an indeterminate bar before the roster is decided", () => {
    render(
      <RunView
        run={run({ status: "queued", rosterSize: null, specialistsDone: 0 })}
        onExit={() => undefined}
        onOpenPlan={() => undefined}
      />,
    );

    // No `value` attribute at all: "the total is not knowable yet" renders as a
    // bar with no position, never as zero.
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
  });
});

describe("the run screen while it is grounding", () => {
  test("does not call a lookup a specialist", () => {
    show("grounding");

    // The header and the line under the bar have to be talking about the same
    // thing. They were not: the noun was hard-coded to "specialists".
    expect(screen.getByText("Checking the details")).toBeTruthy();
    expect(screen.queryByText(/specialists done/)).toBeNull();
  });

  test("does not replay the fan-out's finished count as grounding's own", () => {
    // The run arrives already grounding — a reload, or a client that attached
    // late. `rosterSize` is 5 and `specialistsDone` is 5, and both describe work
    // that is over. Rendering them here would say "5 of 5 details checked"
    // before a single lookup had gone out.
    show("grounding");

    expect(screen.queryByText(/5 of 5/)).toBeNull();
    expect(screen.getByText("Checking what the specialists proposed…")).toBeTruthy();
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
  });

  test("does not replay it through a snapshot frame either", () => {
    // The same bug by the other route in: a client that connects and is handed
    // the whole `Run` as its first frame.
    show("queued");
    push({ type: "snapshot", runId: "run-1", run: run({ status: "grounding" }), at: AT });

    expect(screen.queryByText(/5 of 5/)).toBeNull();
    expect(screen.getByText("Checking what the specialists proposed…")).toBeTruthy();
  });

  test("counts lookups once something is actually counting them", () => {
    show("grounding");
    push({
      type: "progress",
      runId: "run-1",
      progress: { type: "grounding", done: 2, total: 6 },
      at: AT,
    });

    expect(screen.getByText("2 of 6 details checked.")).toBeTruthy();
    expect(document.querySelector("progress")?.getAttribute("value")).toBe("2");
  });

  test("stops naming specialists as still being looked at", () => {
    show("fanning-out");
    push({
      type: "progress",
      runId: "run-1",
      progress: { type: "roster", running: ["lodging"], droppedForBudget: [], total: 5 },
      at: AT,
    });
    expect(screen.getByText("Looking at lodging.")).toBeTruthy();

    push({
      type: "progress",
      runId: "run-1",
      progress: { type: "grounding", done: 0, total: 3 },
      at: AT,
    });

    // Leaving the last roster on screen would say specialists were still being
    // asked, while the header says the run has moved on.
    expect(screen.queryByText(/Looking at/)).toBeNull();
  });

  test("reports an unknowable lookup total as an indeterminate bar", () => {
    show("grounding");
    push({
      type: "progress",
      runId: "run-1",
      progress: { type: "grounding", done: 4, total: null },
      at: AT,
    });

    // §7: a backend that discovers work as it goes has no honest total, and the
    // answer is a bar with no position — never a number that moves.
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
    expect(screen.queryByText(/of null/)).toBeNull();
  });

  /**
   * pl-42's own real and reachable case: a re-plan naming no specialists
   * re-packs with `rosterSize: 0`, and the fan-out's arithmetic would
   * otherwise render "0 of 0 specialists done." — technically true and the
   * repo's _never fake progress_ rule broken by omission (pl-45).
   */
  test("renders an honest sentence for zero specialists, never zero of zero", () => {
    show("fanning-out");
    push({
      type: "progress",
      runId: "run-1",
      progress: { type: "roster", running: [], droppedForBudget: [], total: 0 },
      at: AT,
    });

    expect(screen.getByText("Re-packing the existing days…")).toBeTruthy();
    expect(screen.queryByText(/of 0/)).toBeNull();
  });
});

describe("when it finishes", () => {
  /**
   * `run.kind` (pl-42) distinguishes a first draft from a re-plan, and the
   * copy has to say which: "a first draft is ready" is wrong once a plan
   * already existed before this run.
   */
  test("says a first draft is ready for a draft run", async () => {
    fetched.mockResolvedValue(planView({ revisions: [revision([day(0, [])])] }));
    render(
      <RunView
        run={run({ status: "composing", kind: "draft" })}
        onExit={() => undefined}
        onOpenPlan={() => undefined}
      />,
    );
    push({ type: "done", runId: "run-1", planId: "plan-1", revisionId: "rev-1", at: AT });

    expect(await screen.findByText(/A first draft is ready/)).toBeTruthy();
  });

  test("says this version is ready for a re-plan, never that a first draft is", async () => {
    fetched.mockResolvedValue(planView({ revisions: [revision([day(0, [])])] }));
    render(
      <RunView
        run={run({ status: "composing", kind: "replan" })}
        onExit={() => undefined}
        onOpenPlan={() => undefined}
      />,
    );
    push({ type: "done", runId: "run-1", planId: "plan-1", revisionId: "rev-1", at: AT });

    expect(await screen.findByText(/This version is ready/)).toBeTruthy();
    expect(screen.queryByText(/A first draft is ready/)).toBeNull();
  });
});

/**
 * pl-45's gate: "Watch it" has only a run id (pl-42 added no route to fetch a
 * `Run` by one), and the placeholder this screen used to be handed — a
 * guessed `status: "queued"` and `kind: "replan"` — was neither corrected by
 * a `snapshot` (the reducer copied status and counts only) nor an honest
 * render in the meantime. The owner's decision, 2026-09-14: an attach with no
 * `Run` gets an honest "not known yet" screen instead.
 */
describe("attaching to a run with only its id", () => {
  const TARGET: AttachTarget = { id: "run-1", planId: "plan-1" };

  function showAttaching(): void {
    render(<RunView run={TARGET} onExit={() => undefined} onOpenPlan={() => undefined} />);
  }

  test("says nothing a RunStatus would own, and shows an indeterminate bar", () => {
    showAttaching();

    expect(screen.getByText("Connecting…")).toBeTruthy();
    // None of the real statuses' labels, and no fabricated count.
    expect(screen.queryByText("Waiting for a slot")).toBeNull();
    expect(screen.queryByText(/specialists done|details checked/)).toBeNull();
    expect(document.querySelector("progress")?.hasAttribute("value")).toBe(false);
  });

  test("the finish screen's wording comes from the snapshot's real kind, never a guess", async () => {
    fetched.mockResolvedValue(planView({ revisions: [revision([day(0, [])])] }));
    showAttaching();

    // `kind: "replan"`, deliberately **not** `"draft"` — the fallback
    // `progress.kind ?? "draft"` reads as correct for a draft snapshot even
    // if the reducer never copied `kind` at all, which is exactly the gap
    // gate 2 found here. Only a kind the fallback disagrees with can prove
    // the snapshot's own value was used.
    push({
      type: "snapshot",
      runId: "run-1",
      run: run({ kind: "replan", status: "done" }),
      at: AT,
    });
    push({ type: "done", runId: "run-1", planId: "plan-1", revisionId: "rev-1", at: AT });

    expect(await screen.findByText(/This version is ready/)).toBeTruthy();
    expect(screen.queryByText(/A first draft is ready/)).toBeNull();
  });

  test("a snapshot replaces the attaching screen with the run's real status", () => {
    showAttaching();
    push({
      type: "snapshot",
      runId: "run-1",
      run: run({ status: "fanning-out" }),
      at: AT,
    });

    expect(screen.getByText("Asking the specialists")).toBeTruthy();
    expect(screen.queryByText("Connecting…")).toBeNull();
  });

  test("a stream that never delivers a frame stops attaching and offers a way out", () => {
    vi.useFakeTimers();
    try {
      showAttaching();
      expect(screen.getByText("Connecting…")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(screen.queryByText("Connecting…")).toBeNull();
      expect(screen.getByText(/Could not reach this run/)).toBeTruthy();
      // The way out this ticket's requirement names.
      expect(screen.getByRole("button", { name: "Back to the trip" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a frame that arrives before the timeout cancels it — no false failure after", () => {
    vi.useFakeTimers();
    try {
      showAttaching();
      push({
        type: "snapshot",
        runId: "run-1",
        run: run({ status: "fanning-out" }),
        at: AT,
      });

      act(() => {
        vi.advanceTimersByTime(15_000);
      });

      expect(screen.getByText("Asking the specialists")).toBeTruthy();
      expect(screen.queryByText(/Could not reach this run/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
