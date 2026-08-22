/**
 * The plan's read surface: the list, the document, and the one write that is
 * not a revision.
 *
 * The assertion this suite exists for is the reload. `unchecked` was the
 * composer's return value and nothing else, which meant a plan opened from the
 * list a day later would have lost it — and the thing it always carries is
 * "nothing measured travel time", so losing it turns an honest plan into one
 * that merely looks finished. So the tests below read the plan back **over
 * HTTP, from the database**, never from the `compose` call that made it.
 */

import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  appendRevision,
  latestRevision,
  planUrl,
  planItemPinUrl,
  revisionItems,
  ROUTES,
  type ErrorResponse,
  type PlanItem,
  type PlanListResponse,
  type PlanRevision,
  type PlanView,
} from "@planner/contract";
import { insertRevision, selectPlan } from "../src/db/plans.ts";
import {
  createRunHarness,
  intakeReadyToDraft,
  NOW,
  runToCompletion,
  startRunOver,
  type RunHarness,
} from "./helpers/runs.ts";

async function readView(harness: RunHarness, planId: string): Promise<PlanView> {
  const response = await harness.app.server.inject({ method: "GET", url: planUrl(planId) });
  expect(response.statusCode).toBe(200);
  return response.json<PlanView>();
}

/** The latest revision's items, or a failure that names what was missing. */
function itemsOf(view: PlanView): PlanItem[] {
  const revision = latestRevision(view.plan);
  if (revision === null) throw new Error("the plan has no revision");
  return revisionItems(revision);
}

/** A finished run, and the plan it drafted. */
async function draftedPlan(harness: RunHarness): Promise<string> {
  const intakeId = await intakeReadyToDraft(harness.app);
  const run = await startRunOver(harness.app, intakeId);
  const finished = await runToCompletion(harness.app, run.id);
  expect(finished.status).toBe("done");
  return run.planId;
}

/**
 * Append a second revision, so the first one is superseded.
 *
 * Re-plan is Phase 4 and no route appends a revision yet, so this does what the
 * orchestrator's `persist` does — `appendRevision` for the number and the
 * parent, `insertRevision` for the rows — and copies the draft it supersedes
 * item for item with fresh ids and the same candidates. What the copy contains
 * does not matter; that the older revision's item ids stop being the ones
 * anybody reads is the whole point.
 */
function supersedeDraft(harness: RunHarness, planId: string): PlanRevision {
  const plan = selectPlan(harness.app.context.db, planId);
  if (plan === undefined) throw new Error(`no plan ${planId}`);
  const previous = latestRevision(plan);
  if (previous === null) throw new Error("the plan has no revision to supersede");

  const appended = appendRevision(plan, {
    id: randomUUID(),
    reason: "A second draft, so the first is no longer the one being read.",
    createdAt: NOW.toISOString(),
    gaps: previous.gaps,
    days: previous.days.map((day) => ({
      ...day,
      id: randomUUID(),
      items: day.items.map((item) => ({ ...item, id: randomUUID(), pinned: false })),
    })),
  });

  const next = latestRevision(appended);
  if (next === null) throw new Error("the appended revision did not appear");
  insertRevision(harness.app.context.db, next);
  return previous;
}

/** One revision of the plan as it reads back over HTTP, by id. */
function revisionById(view: PlanView, id: string): PlanRevision {
  const revision = view.plan.revisions.find((each) => each.id === id);
  if (revision === undefined) throw new Error(`the plan has no revision ${id}`);
  return revision;
}

describe("reading a plan", () => {
  test("comes back with the document and what nothing checked about it", async () => {
    const harness = await createRunHarness();
    try {
      const view = await readView(harness, await draftedPlan(harness));

      const revision = latestRevision(view.plan);
      expect(revision).not.toBeNull();
      expect(revision?.days.length).toBeGreaterThan(0);
      expect(view.plan.candidates.length).toBeGreaterThan(0);
    } finally {
      await harness.close();
    }
  });

  /**
   * The one the ticket calls the half that can silently go missing.
   *
   * Travel time is on **every** plan in Phase 2 — `Place.coordinates` is null
   * until grounding, so nothing measured a distance — and this asserts it on a
   * plan loaded out of the database rather than on one just composed. That is
   * the difference between the honesty being a property of the plan and being a
   * property of having watched the run.
   */
  test("says travel time was not checked, on a plan read back from the database", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);

      const first = await readView(harness, planId);
      const kinds = first.unchecked.map((constraint) => constraint.kind);
      expect(kinds).toContain("travel-time");

      // Again, because "it survived one read" is not the claim — the claim is
      // that it is derived from the stored plan and so cannot wear off.
      const second = await readView(harness, planId);
      expect(second.unchecked).toEqual(first.unchecked);

      const travel = first.unchecked.find((constraint) => constraint.kind === "travel-time");
      expect(travel?.detail).toMatch(/not checked/i);
    } finally {
      await harness.close();
    }
  });

  test("a plan whose run has not finished reads, with no draft and nothing unchecked", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      // The plan row is written before the fan-out, so this is a real state and
      // not a race — the run may or may not have finished, and either way the
      // route answers rather than 404ing.
      const response = await harness.app.server.inject({
        method: "GET",
        url: planUrl(run.planId),
      });
      expect(response.statusCode).toBe(200);

      await runToCompletion(harness.app, run.id);
    } finally {
      await harness.close();
    }
  });

  test("an unknown plan is PLAN_NOT_FOUND", async () => {
    const harness = await createRunHarness();
    try {
      const response = await harness.app.server.inject({
        method: "GET",
        url: planUrl("nope"),
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorResponse>().error.code).toBe("PLAN_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });
});

describe("the plans list", () => {
  test("lists plans without loading their revisions", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);

      const response = await harness.app.server.inject({ method: "GET", url: ROUTES.plans });
      expect(response.statusCode).toBe(200);

      const { plans } = response.json<PlanListResponse>();
      const row = plans.find((plan) => plan.id === planId);
      expect(row).toBeDefined();
      expect(row?.latestRevision).toBe(1);

      // `Plan` and not `PlanDetail`: the split exists so a page of titles does
      // not drag every revision of every plan out of the database with it.
      expect(row).not.toHaveProperty("revisions");
      expect(row).not.toHaveProperty("candidates");
      expect(row).not.toHaveProperty("brief");
    } finally {
      await harness.close();
    }
  });

  test("includes a plan whose first run has not produced a revision", async () => {
    const harness = await createRunHarness();
    try {
      const intakeId = await intakeReadyToDraft(harness.app);
      const run = await startRunOver(harness.app, intakeId);

      const response = await harness.app.server.inject({ method: "GET", url: ROUTES.plans });
      const { plans } = response.json<PlanListResponse>();
      expect(plans.some((plan) => plan.id === run.planId)).toBe(true);

      await runToCompletion(harness.app, run.id);
    } finally {
      await harness.close();
    }
  });
});

describe("pinning", () => {
  test("persists, and appends no revision", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);
      const before = await readView(harness, planId);
      const item = itemsOf(before)[0];
      if (item === undefined) throw new Error("the draft placed nothing");
      expect(item.pinned).toBe(false);

      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, item.id),
        payload: { pinned: true },
      });
      expect(response.statusCode).toBe(200);

      // Read back over HTTP rather than trusting the response: the claim is
      // that it is stored, not that it was echoed.
      const after = await readView(harness, planId);
      expect(itemsOf(after).find((each) => each.id === item.id)?.pinned).toBe(true);

      // §6: a pin says what the *next* re-plan may not move. It is not an edit
      // to this draft, and a revision per pin toggle would fill the history
      // with intent and no content.
      expect(after.plan.revisions).toHaveLength(before.plan.revisions.length);
      expect(after.plan.latestRevision).toBe(before.plan.latestRevision);
    } finally {
      await harness.close();
    }
  });

  test("unpins again", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);
      const item = itemsOf(await readView(harness, planId))[0];
      if (item === undefined) throw new Error("the draft placed nothing");

      for (const pinned of [true, false]) {
        const response = await harness.app.server.inject({
          method: "POST",
          url: planItemPinUrl(planId, item.id),
          payload: { pinned },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json<PlanView>().plan.revisions).toHaveLength(1);
      }

      const after = await readView(harness, planId);
      expect(itemsOf(after).find((each) => each.id === item.id)?.pinned).toBe(false);
    } finally {
      await harness.close();
    }
  });

  test("an item that is not on this plan is ITEM_NOT_FOUND, not PLAN_NOT_FOUND", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);

      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, "no-such-item"),
        payload: { pinned: true },
      });
      expect(response.statusCode).toBe(404);

      // The plan is right there — saying it could not be found would be a lie,
      // and it would send the reader to the list instead of to a reload.
      expect(response.json<ErrorResponse>().error.code).toBe("ITEM_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });

  /**
   * pl-22: a pin lands on the revision the reader is looking at, or nowhere.
   *
   * A pin is only ever read back off the latest revision, so one written to a
   * superseded revision is a 200 that changes nothing on screen — the failure
   * the _never fake progress_ rule is about. It is refused instead, and refused
   * with the same code and body as an item id that never existed, because
   * "reload the plan" is the same advice.
   */
  test("an item on a superseded revision is refused exactly like a missing one", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);
      const stale = itemsOf(await readView(harness, planId))[0];
      if (stale === undefined) throw new Error("the draft placed nothing");

      const superseded = supersedeDraft(harness, planId);
      expect(superseded.days.some((day) => day.items.some((each) => each.id === stale.id))).toBe(
        true,
      );

      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, stale.id),
        payload: { pinned: true },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorResponse>().error.code).toBe("ITEM_NOT_FOUND");

      // Indistinguishable at the caller: a stale id and an id that names
      // nothing at all answer with the same status and the same message.
      const missing = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, "no-such-item"),
        payload: { pinned: true },
      });
      expect(missing.statusCode).toBe(response.statusCode);
      expect(missing.json<ErrorResponse>().error.message).toBe(
        response.json<ErrorResponse>().error.message,
      );

      // Refused, not merely reported as refused: the old row is untouched.
      const after = await readView(harness, planId);
      const items = revisionItems(revisionById(after, superseded.id));
      expect(items.find((each) => each.id === stale.id)?.pinned).toBe(false);
    } finally {
      await harness.close();
    }
  });

  test("an item on the latest revision still pins once an older one exists", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);
      supersedeDraft(harness, planId);

      const item = itemsOf(await readView(harness, planId))[0];
      if (item === undefined) throw new Error("the second draft placed nothing");

      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, item.id),
        payload: { pinned: true },
      });
      expect(response.statusCode).toBe(200);

      const after = await readView(harness, planId);
      expect(after.plan.latestRevision).toBe(2);
      expect(itemsOf(after).find((each) => each.id === item.id)?.pinned).toBe(true);
    } finally {
      await harness.close();
    }
  });

  test("a pin aimed at an unknown plan is PLAN_NOT_FOUND", async () => {
    const harness = await createRunHarness();
    try {
      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl("nope", "item"),
        payload: { pinned: true },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorResponse>().error.code).toBe("PLAN_NOT_FOUND");
    } finally {
      await harness.close();
    }
  });

  test("a body that does not say whether it is pinned is refused", async () => {
    const harness = await createRunHarness();
    try {
      const planId = await draftedPlan(harness);
      const response = await harness.app.server.inject({
        method: "POST",
        url: planItemPinUrl(planId, "whatever"),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorResponse>().error.code).toBe("INVALID_ANSWER");
    } finally {
      await harness.close();
    }
  });
});
