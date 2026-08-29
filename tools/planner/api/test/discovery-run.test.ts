/**
 * The discovery pass, from a real run to the plan it leaves behind.
 *
 * `travel-pass.test.ts` proves pl-27's claim by reading the plan back over
 * HTTP rather than off the `compose` call that produced it; this file makes
 * the analogous claim about `PlanRevision.coverage`'s round trip — that a
 * `coverage` note a real run wrote survives being read back a second time,
 * over HTTP, out of SQLite, rather than being asserted only against the
 * in-memory `compose()` result the unit tests use.
 *
 * **Corrected, gate A (2026-08-29):** the paragraph this replaces claimed the
 * test below exercises "a corridor with nothing on it" — an empty `nearby`
 * reply. It does not. `intakeReadyToDraft`'s auto-answers give every "text"
 * question the literal string `"somewhere"`, which is not in
 * `FIXTURE_PLACES` (`fixture-data.ts`), so `locate("somewhere")` answers
 * `null` for both ends and the run takes discovery's *other* empty branch —
 * "an end that will not locate" (`discovery.ts`'s `originLocated === null ||
 * destinationLocated === null` guard), which never calls `nearby` at all.
 * Gate A found this by mutation: the branch this docstring named is covered
 * — `discovery-pass.test.ts`'s "a corridor with nothing on it" unit test —
 * so there is no coverage gap, only a wrong claim about which test covers
 * what. What this file actually proves, and the only thing it needs to
 * prove given the unit tests already cover every branch in isolation, is the
 * storage round trip: *some* `coverage` entry, from *some* branch, survives
 * a real run and a real read-back.
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
  test("carries a coverage note on the plan it leaves behind, read back from storage — via the un-locatable-endpoint branch, not an empty nearby reply", async () => {
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
