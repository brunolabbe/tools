/**
 * Revising a plan over the wire: the route, the request and the response
 * (pl-42).
 *
 * `api` parses with these schemas and `web` builds its requests against the
 * same types, so what is asserted here is what keeps the two from disagreeing
 * about a request neither of them has sent yet.
 */

import { describe, expect, test } from "vitest";
import {
  emptyBrief,
  planRevisionsUrl,
  reviseRequestSchema,
  reviseResponseSchema,
  ROUTES,
  type PlanView,
  type ReviseRequest,
  type Run,
} from "../src/index.ts";

const AT = "2026-08-16T12:00:00.000Z";

describe("the route", () => {
  test("is a Fastify pattern under the plan, and the helper fills it in", () => {
    expect(ROUTES.planRevisions).toBe("/api/plans/:id/revisions");
    expect(planRevisionsUrl("plan/1")).toBe("/api/plans/plan%2F1/revisions");
  });
});

describe("the request", () => {
  const requests: ReviseRequest[] = [
    { kind: "replan", baseRevisionId: "rev-1", days: [0, 1], specialists: [], note: null },
    { kind: "move", baseRevisionId: "rev-1", itemId: "item-1", toDayIndex: 1, toPosition: 0 },
    { kind: "remove", baseRevisionId: "rev-1", itemId: "item-1" },
    { kind: "restore", baseRevisionId: "rev-1", revision: 1 },
  ];

  test.for(requests)("a $kind request parses", (request) => {
    expect(reviseRequestSchema.safeParse(request).success).toBe(true);
  });

  test.for(requests)("a $kind request without a base revision is refused", (request) => {
    // Every member carries it: a stale base is `REVISION_STALE`, and a request
    // with no base could never be told apart from a current one.
    const { baseRevisionId: _base, ...baseless } = request;
    expect(reviseRequestSchema.safeParse(baseless).success).toBe(false);
    expect(reviseRequestSchema.safeParse({ ...request, baseRevisionId: "" }).success).toBe(false);
  });

  test("a first draft is not requestable", () => {
    // It has its own route, `POST /api/plans`, and that route stays.
    expect(
      reviseRequestSchema.safeParse({ kind: "first-draft", baseRevisionId: "rev-1" }).success,
    ).toBe(false);
  });

  test("a request names an item, not a candidate", () => {
    // The item id is the client's handle on the revision it is looking at; the
    // server resolves the candidate. A move naming only a candidate is refused.
    expect(
      reviseRequestSchema.safeParse({
        kind: "remove",
        baseRevisionId: "rev-1",
        candidateId: "cand-1",
      }).success,
    ).toBe(false);
  });

  test("the request carries the operation's bounds, written once", () => {
    const replan = requests[0]!;
    expect(reviseRequestSchema.safeParse({ ...replan, days: [2, 1] }).success).toBe(false);
    expect(
      reviseRequestSchema.safeParse({ ...replan, specialists: ["lodging", "lodging"] }).success,
    ).toBe(false);
    expect(reviseRequestSchema.safeParse({ ...requests[3]!, revision: 0 }).success).toBe(false);
  });
});

describe("the response", () => {
  const run: Run = {
    id: "run-2",
    planId: "plan-1",
    kind: "replan",
    status: "queued",
    rosterSize: null,
    specialistsDone: 0,
    error: null,
    startedAt: AT,
    finishedAt: null,
  };

  const view: PlanView = {
    plan: {
      id: "plan-1",
      title: "Gaspésie",
      createdAt: AT,
      updatedAt: AT,
      latestRevision: 0,
      brief: emptyBrief(),
      candidates: [],
      revisions: [],
    },
    unchecked: [],
    diffs: [],
  };

  test("a re-plan answers with its run", () => {
    expect(reviseResponseSchema.safeParse({ kind: "run", run }).success).toBe(true);
  });

  test("an edit answers with the view, and a diff in it parses", () => {
    const diff = {
      revisionId: "rev-2",
      parentRevisionId: "rev-1",
      entries: [
        {
          kind: "moved",
          candidateId: "cand-1",
          from: { dayIndex: 0, position: 0 },
          to: { dayIndex: 1, position: 1 },
        },
        { kind: "added", candidateId: "cand-2", to: { dayIndex: 0, position: 0 } },
        { kind: "removed", candidateId: "cand-3", from: { dayIndex: 2, position: 0 } },
      ],
    };
    expect(reviseResponseSchema.safeParse({ kind: "revision", view }).success).toBe(true);
    expect(
      reviseResponseSchema.safeParse({ kind: "revision", view: { ...view, diffs: [diff] } })
        .success,
    ).toBe(true);
    // A diff entry of a kind the reader cannot render is refused, not passed on.
    const unknown = { ...diff, entries: [{ kind: "reshuffled", candidateId: "cand-1" }] };
    expect(
      reviseResponseSchema.safeParse({ kind: "revision", view: { ...view, diffs: [unknown] } })
        .success,
    ).toBe(false);
  });

  test("a response's kind decides its body", () => {
    expect(reviseResponseSchema.safeParse({ kind: "run", view }).success).toBe(false);
    expect(reviseResponseSchema.safeParse({ kind: "revision", run }).success).toBe(false);
  });
});
