/**
 * A plan's title follows its brief (pl-53).
 *
 * `intakeTitle` names a trip's length or its departure month, and the title is a
 * stored column written once at draft time, so a brief edit (pl-47) or a restore
 * of an earlier version left the list and the plan page describing a trip that
 * no longer exists. Every assertion here reads the title through both of its
 * readers — `GET /plans/:id` and the plans list — because a fix that reached
 * only one of them would pass a test that read only that one.
 *
 * Its own file rather than more of `brief-edits.test.ts`, for the reason that
 * file's header gives: merged records cite its lines.
 */

import { describe, expect, test } from "vitest";
import {
  latestRevision,
  planRevisionsUrl,
  planUrl,
  ROUTES,
  type PlanListResponse,
  type PlanView,
  type ReviseResponse,
} from "@planner/contract";
import {
  createRunHarness,
  intakeReadyToDraft,
  runToCompletion,
  startRunOver,
  type RunHarness,
} from "./helpers/runs.ts";

async function withHarness(body: (harness: RunHarness) => Promise<void>): Promise<void> {
  const harness = await createRunHarness({
    config: {
      rateLimitRunsPerMinute: 0,
      rateLimitEditsPerMinute: 0,
      groundingCacheTtlHours: { locate: 0, travel: 0 },
    },
  });
  try {
    await body(harness);
  } finally {
    await harness.close();
  }
}

async function readView(harness: RunHarness, planId: string): Promise<PlanView> {
  const response = await harness.app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanView>();
}

/** The title as the plans list prints it. */
async function listedTitle(harness: RunHarness, planId: string): Promise<string | undefined> {
  const response = await harness.app.server.inject({ method: "GET", url: ROUTES.plans });
  expect(response.statusCode).toBe(200);
  return response.json<PlanListResponse>().plans.find((plan) => plan.id === planId)?.title;
}

/** Both readers, which must agree. */
async function titleOf(harness: RunHarness, planId: string): Promise<string> {
  const detail = (await readView(harness, planId)).plan.title;
  expect(await listedTitle(harness, planId)).toBe(detail);
  return detail;
}

async function latestId(harness: RunHarness, planId: string): Promise<string> {
  const revision = latestRevision((await readView(harness, planId)).plan);
  if (revision === null) throw new Error("the plan has no revision");
  return revision.id;
}

/** A finished first draft: `open`, five nights, a road trip. */
async function draft(harness: RunHarness): Promise<string> {
  const run = await startRunOver(harness.app, await intakeReadyToDraft(harness.app));
  expect((await runToCompletion(harness.app, run.id)).status).toBe("done");
  return run.planId;
}

async function editBrief(
  harness: RunHarness,
  planId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await harness.app.server.inject({
    method: "POST",
    url: planRevisionsUrl(planId),
    payload: { kind: "brief", baseRevisionId: await latestId(harness, planId), ...body },
  });
  expect(response.statusCode).toBe(202);
  const reply = response.json<ReviseResponse>();
  if (reply.kind !== "run") throw new Error("a brief edit answered without a run");
  expect((await runToCompletion(harness.app, reply.run.id)).status).toBe("done");
}

describe("a plan's title follows its brief", () => {
  test("a longer trip names its new night count, on the plan and in the list", async () => {
    await withHarness(async (harness) => {
      const planId = await draft(harness);
      const drafted = await titleOf(harness, planId);
      // The premise: the first draft's title names its nights.
      expect(drafted).toContain("for 5 nights");

      await editBrief(harness, planId, { dates: { kind: "open", nights: 6 } });

      expect(await titleOf(harness, planId)).toBe(drafted.replace("5 nights", "6 nights"));
    });
  });

  test("moving the departure into the next month names the new month", async () => {
    await withHarness(async (harness) => {
      const planId = await draft(harness);
      const drafted = await titleOf(harness, planId);

      await editBrief(harness, planId, {
        dates: { kind: "exact", departure: "2026-10-28", return: "2026-11-02" },
      });
      expect(await titleOf(harness, planId)).toBe(drafted.replace("for 5 nights", "in October"));

      await editBrief(harness, planId, {
        dates: { kind: "exact", departure: "2026-11-01", return: "2026-11-06" },
      });
      expect(await titleOf(harness, planId)).toBe(drafted.replace("for 5 nights", "in November"));
    });
  });

  test("a budget-only edit leaves the title exactly as it was", async () => {
    await withHarness(async (harness) => {
      const planId = await draft(harness);
      const drafted = await titleOf(harness, planId);

      await editBrief(harness, planId, { budget: { kind: "band", band: "moderate" } });

      expect(await titleOf(harness, planId)).toBe(drafted);
    });
  });

  test("restoring the first draft brings its title back with its dates", async () => {
    await withHarness(async (harness) => {
      const planId = await draft(harness);
      const drafted = await titleOf(harness, planId);
      await editBrief(harness, planId, { dates: { kind: "open", nights: 7 } });
      expect(await titleOf(harness, planId)).toBe(drafted.replace("5 nights", "7 nights"));

      const restored = await harness.app.server.inject({
        method: "POST",
        url: planRevisionsUrl(planId),
        payload: { kind: "restore", baseRevisionId: await latestId(harness, planId), revision: 1 },
      });
      expect(restored.statusCode).toBe(200);

      expect(await titleOf(harness, planId)).toBe(drafted);
    });
  });
});
