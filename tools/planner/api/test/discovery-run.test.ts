/**
 * The discovery pass, from a real run to the plan it leaves behind.
 *
 * `travel-pass.test.ts` proves pl-27's claim by reading the plan back over
 * HTTP rather than off the `compose` call that produced it; this file makes
 * the same claim about pl-29's pass. `intakeReadyToDraft`'s auto-answers give
 * every "text" question the same value, "somewhere" — so a fixture-driven run
 * has a real, if degenerate, corridor (`origin === destination`), and the
 * fixture provider's `nearby` always answers an empty list. That combination
 * is exactly the acceptance line this file exists to prove: a corridor with
 * nothing on it produces the plan pl-27 would have produced, plus the
 * `coverage` note — read back from storage, not from the run that wrote it.
 */

import { describe, expect, test } from "vitest";
import { latestRevision, planUrl, type PlanView } from "@planner/contract";
import {
  createRunHarness,
  intakeReadyToDraft,
  runToCompletion,
  startRunOver,
} from "./helpers/runs.ts";

async function readView(
  app: Awaited<ReturnType<typeof createRunHarness>>["app"],
  planId: string,
): Promise<PlanView> {
  const response = await app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanView>();
}

describe("a run against the fixture default", () => {
  test("carries a coverage note on the plan it leaves behind, read back from storage", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);
      const finished = await runToCompletion(harness.app, run.id);
      expect(finished.status).toBe("done");

      const view = await readView(harness.app, run.planId);
      const revision = latestRevision(view.plan);
      expect(revision).not.toBeNull();

      // Stored on the revision, per pl-29's contract change.
      expect(revision?.coverage.some((entry) => entry.kind === "coverage")).toBe(true);
      // And reachable through the same list a reader of the plan sees —
      // `uncheckedForRevision`'s job, proven end to end rather than assumed
      // from the unit tests on it.
      expect(view.unchecked.some((entry) => entry.kind === "coverage")).toBe(true);
    } finally {
      await harness.close();
    }
  });

  // A live-SSE assertion that discovery's `grounding` frame precedes the
  // fan-out's was deliberately not added here: `helpers/runs.ts`'s own
  // `readEventStream` is documented as "not a replay log" — a subscribe after
  // the run has settled sees nothing, and the scripted fan-out is fast enough
  // that it usually has. `contract/test/run.test.ts` already proves the edge
  // is legal; a flaky race for "and a real run takes it" buys little over
  // that plus the storage assertion above, which is deterministic.
});
