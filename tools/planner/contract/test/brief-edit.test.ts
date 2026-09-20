/**
 * Editing a version's dates and budget, in the contract (pl-47): the brief on
 * every revision, its stored `deadlines`, the `brief` operation and request,
 * `currentBrief` and the new unchecked kind.
 *
 * Every refine has a case that fails on that refine alone, and where a refine
 * has a message the assertion names it, so a case cannot pass by tripping a
 * neighbouring rule instead.
 */

import { describe, expect, test } from "vitest";
import {
  appendRevision,
  currentBrief,
  emptyBrief,
  planRevisionSchema,
  reviseRequestSchema,
  revisionOperationSchema,
  slot,
  UNCHECKED_CONSTRAINTS,
  type NewRevision,
  type PlanDetail,
  type RevisionOperation,
  type TripBrief,
  type TripDates,
} from "../src/index.ts";

const EXACT: TripDates = { kind: "exact", departure: "2027-07-05", return: "2027-07-08" };
const LONGER: TripDates = { kind: "exact", departure: "2027-07-05", return: "2027-07-10" };
const AMOUNT = { kind: "amount", currency: "CAD", amount: 2000, basis: "total" } as const;

const briefOp: Extract<RevisionOperation, { kind: "brief" }> = {
  kind: "brief",
  dates: { from: EXACT, to: LONGER },
  budget: { from: slot.answered({ kind: "band", band: "moderate" }), to: AMOUNT },
  days: [4, 5],
};

const second = {
  id: "rev-2",
  planId: "plan-1",
  revision: 2,
  parentRevisionId: "rev-1",
  reason: "Changed the dates.",
  operation: briefOp,
  brief: emptyBrief(),
  createdAt: "2026-08-16T10:05:00.000Z",
  days: [],
  gaps: [],
  coverage: [],
  deadlines: [],
  reading: [],
};

function messages(schema: typeof planRevisionSchema | typeof reviseRequestSchema, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const late = {
  kind: "booking-deadline-passed" as const,
  detail: "These need booking further ahead than there was time for.",
  candidateIds: ["cand-1"],
};

describe("a revision's brief", () => {
  test("is required, and is a whole brief", () => {
    const { brief: _brief, ...briefless } = second;
    expect(planRevisionSchema.safeParse(second).success).toBe(true);
    expect(planRevisionSchema.safeParse(briefless).success).toBe(false);
    expect(planRevisionSchema.safeParse({ ...second, brief: { dates: EXACT } }).success).toBe(
      false,
    );
  });
});

describe("a revision's deadlines", () => {
  test("may be empty, or hold one booking-deadline-passed entry", () => {
    expect(planRevisionSchema.safeParse({ ...second, deadlines: [late] }).success).toBe(true);
  });

  test("are required", () => {
    const { deadlines: _deadlines, ...without } = second;
    expect(planRevisionSchema.safeParse(without).success).toBe(false);
  });

  test("hold only booking-deadline-passed", () => {
    expect(
      messages(planRevisionSchema, { ...second, deadlines: [{ ...late, kind: "coverage" }] }),
    ).toEqual(["A revision's deadlines hold only booking-deadline-passed."]);
  });

  test("hold at most one entry", () => {
    expect(planRevisionSchema.safeParse({ ...second, deadlines: [late, late] }).success).toBe(
      false,
    );
  });
});

describe("the brief operation", () => {
  function refusal(operation: unknown): string[] {
    return messages(planRevisionSchema, { ...second, operation });
  }

  test("a well-formed edit of both is accepted", () => {
    expect(refusal(briefOp)).toEqual([]);
  });

  test("either change alone is accepted, and days may be empty", () => {
    expect(refusal({ ...briefOp, budget: null, days: [] })).toEqual([]);
    expect(refusal({ ...briefOp, dates: null })).toEqual([]);
  });

  test("changes the dates, the budget or both", () => {
    expect(refusal({ ...briefOp, dates: null, budget: null })).toEqual([
      "A brief edit changes the dates, the budget or both.",
    ]);
  });

  test("names each day it re-packed once", () => {
    expect(refusal({ ...briefOp, days: [4, 4] })).toEqual([
      "A brief edit names each day it re-packed once.",
    ]);
  });

  test("names the days it re-packed in ascending order", () => {
    expect(refusal({ ...briefOp, days: [5, 4] })).toEqual([
      "A brief edit names the days it re-packed in ascending order.",
    ]);
  });

  test("names days a plan can have", () => {
    expect(revisionOperationSchema.safeParse({ ...briefOp, days: [60] }).success).toBe(false);
  });

  test("a budget's from is a slot, so a declined or unasked one is an end", () => {
    for (const from of [slot.declined(), slot.unknown()]) {
      expect(refusal({ ...briefOp, budget: { from, to: AMOUNT } })).toEqual([]);
    }
  });

  test("the dates' from is a value, never a slot", () => {
    expect(refusal({ ...briefOp, dates: { from: slot.answered(EXACT), to: LONGER } })).not.toEqual(
      [],
    );
  });

  test("each to is a value: clearing a budget is not an edit", () => {
    expect(
      refusal({ ...briefOp, budget: { from: slot.answered(AMOUNT), to: slot.declined() } }),
    ).not.toEqual([]);
    expect(refusal({ ...briefOp, dates: { from: EXACT, to: slot.answered(LONGER) } })).not.toEqual(
      [],
    );
  });
});

describe("the brief request", () => {
  const base = { kind: "brief", baseRevisionId: "rev-1" } as const;

  test("names new dates, a new budget, or both", () => {
    for (const request of [
      { ...base, dates: LONGER },
      { ...base, budget: AMOUNT },
      { ...base, dates: LONGER, budget: AMOUNT },
    ]) {
      expect(reviseRequestSchema.safeParse(request).success).toBe(true);
    }
  });

  test("names at least one", () => {
    expect(messages(reviseRequestSchema, base)).toEqual([
      "A brief edit names new dates, a new budget or both.",
    ]);
  });

  test("carries a base revision", () => {
    expect(reviseRequestSchema.safeParse({ kind: "brief", dates: LONGER }).success).toBe(false);
  });

  test("carries values the brief's own schemas accept", () => {
    expect(
      reviseRequestSchema.safeParse({ ...base, dates: { ...EXACT, return: "2027-07-01" } }).success,
    ).toBe(false);
    expect(
      reviseRequestSchema.safeParse({ ...base, budget: { ...AMOUNT, amount: -1 } }).success,
    ).toBe(false);
  });

  test("never carries the other end or the days: the server derives both", () => {
    const parsed = reviseRequestSchema.parse({ ...base, dates: LONGER, from: EXACT, days: [1] });
    expect(parsed).toEqual({ ...base, dates: LONGER });
  });
});

function revision(id: string, brief: TripBrief, operation: NewRevision["operation"]) {
  return {
    id,
    reason: "A revision.",
    operation,
    brief,
    createdAt: "2026-08-15T10:05:00.000Z",
    days: [],
    gaps: [],
    coverage: [],
    deadlines: [],
    reading: [],
  } satisfies NewRevision;
}

describe("currentBrief", () => {
  const first: TripBrief = { ...emptyBrief(), dates: slot.answered(EXACT) };
  const edited: TripBrief = { ...emptyBrief(), dates: slot.answered(LONGER) };
  const plan: PlanDetail = {
    id: "plan-1",
    title: "A trip",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    latestRevision: 0,
    brief: first,
    candidates: [],
    revisions: [],
  };

  test("is the plan's snapshot while no revision exists", () => {
    expect(currentBrief(plan)).toEqual(first);
  });

  test("is the latest revision's, not the plan's, once a version edits it", () => {
    const drafted = appendRevision(plan, revision("r1", first, { kind: "first-draft" }));
    const edits = appendRevision(drafted, revision("r2", edited, briefOp));
    expect(edits.brief).toEqual(first);
    expect(currentBrief(edits)).toEqual(edited);
  });
});

describe("the unchecked vocabulary", () => {
  test("names booking-deadline-passed", () => {
    expect(UNCHECKED_CONSTRAINTS).toContain("booking-deadline-passed");
  });
});
