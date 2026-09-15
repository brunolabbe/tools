// @vitest-environment jsdom

/**
 * The shell's own wiring, tested rather than only reasoned about — pl-45's
 * gate found the one thing `PlanView.test.tsx` and `RunView.test.tsx` cannot
 * see between them: whether the run either of them hands `App` is actually
 * shown.
 *
 * **The fake is the API client module, never `fetch`** — the same rule every
 * other suite in this package states, and for the same reason.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppError, type Run } from "@planner/contract";
import {
  cancelRun,
  editPlan,
  fetchPlan,
  fetchPlans,
  pinItem,
  startReplan,
  watchRun,
} from "../src/api/plan.ts";
import { App } from "../src/App.tsx";
import { candidate, day, item, planView, revision } from "./plan-fixtures.ts";

vi.mock("../src/api/plan.ts", () => ({
  fetchPlans: vi.fn(),
  fetchPlan: vi.fn(),
  pinItem: vi.fn(),
  editPlan: vi.fn(),
  startReplan: vi.fn(),
  watchRun: vi.fn(),
  cancelRun: vi.fn(),
}));

const plansFetched = vi.mocked(fetchPlans);
const planFetched = vi.mocked(fetchPlan);
const edited = vi.mocked(editPlan);
const replanned = vi.mocked(startReplan);
const watched = vi.mocked(watchRun);
const canceled = vi.mocked(cancelRun);
const pinned = vi.mocked(pinItem);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  watched.mockImplementation(() => () => undefined);
  canceled.mockResolvedValue({} as Run);
  pinned.mockResolvedValue({} as never);
});

// `globals: false`, so Testing Library registers no cleanup of its own.
afterEach(cleanup);

const PLAN_ROW = {
  id: "plan-1",
  title: "A trip",
  createdAt: "2027-01-01T00:00:00.000Z",
  updatedAt: "2027-01-01T00:00:00.000Z",
  latestRevision: 1,
};

function onePlan(): ReturnType<typeof planView> {
  const activity = candidate({ title: "A long walk" });
  return planView({
    candidates: [activity],
    revisions: [revision([day(0, [item({ candidateId: activity.id })])])],
  });
}

async function openPlanFromTheList(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  plansFetched.mockResolvedValue([PLAN_ROW]);
  planFetched.mockResolvedValue(onePlan());

  render(<App />);
  await user.click(await screen.findByRole("button", { name: "A trip" }));
  await screen.findByText("A long walk");
}

/**
 * pl-45's gate finding: a re-plan or "Watch it" started from a plan opened
 * off the **list** — no intake ever opened in this tab — had nowhere to go.
 * `RunView` was nested only inside the open-intake branch of `App`'s JSX, so
 * clearing `reading` fell straight through to `openIntake === null` and back
 * onto the trips-and-plans list, with the run going on unseen.
 */
describe("reaching a run from a plan opened off the list", () => {
  test("a re-plan shows the run screen, not the list it used to fall back to", async () => {
    const run: Run = {
      id: "run-1",
      planId: "plan-1",
      kind: "replan",
      status: "queued",
      rosterSize: null,
      specialistsDone: 0,
      error: null,
      startedAt: "2027-01-01T00:00:00.000Z",
      finishedAt: null,
    };
    replanned.mockResolvedValue(run);

    const user = userEvent.setup();
    await openPlanFromTheList(user);

    await user.click(await screen.findByRole("checkbox", { name: "Day 1" }));
    await user.click(screen.getByRole("button", { name: "Re-plan these days" }));

    expect(await screen.findByText("Waiting for a slot")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Plans" })).toBeNull();
    expect(screen.queryByRole("button", { name: "A trip" })).toBeNull();
  });

  test("Watch it shows the run screen too, for a plan with no intake ever open", async () => {
    edited.mockRejectedValue(
      new AppError(
        "PLAN_BUSY",
        "A change to this plan is already underway — wait for it to finish, then try again.",
        { details: { run: "run-42" } },
      ),
    );

    const user = userEvent.setup();
    await openPlanFromTheList(user);

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(await screen.findByRole("button", { name: "Watch it" }));

    // "Watch it" has only a run id (pl-42 added no route to fetch a `Run` by
    // one), so this is `RunView`'s honest attaching screen, not a status
    // nothing has measured yet — see `run-view.test.tsx` for that behaviour.
    expect(await screen.findByText("Connecting…")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Plans" })).toBeNull();
  });
});
