import { describe, expect, test } from "vitest";
import {
  appendRevision,
  emptyBrief,
  latestRevision,
  MODEL_ASSERTED,
  pinnedCandidateIds,
  planDetailSchema,
  planItemSchema,
  planRevisionSchema,
  revisionItems,
  type Candidate,
  type NewRevision,
  type PlanDay,
  type PlanDetail,
  type PlanItem,
} from "../src/index.ts";

function item(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: "item-1",
    candidateId: "cand-1",
    position: 0,
    startsAt: null,
    pinned: false,
    note: null,
    ...overrides,
  };
}

function day(dayIndex: number, items: PlanItem[]): PlanDay {
  return { id: `day-${String(dayIndex)}`, dayIndex, date: null, items };
}

const CANDIDATE: Candidate = {
  id: "cand-1",
  specialist: "activities",
  title: "A thing to do",
  summary: "Why it is worth doing.",
  place: { name: "Somewhere", locality: null, coordinates: null },
  durationMinutes: 90,
  cost: null,
  season: null,
  bookingLeadTimeDays: null,
  provenance: MODEL_ASSERTED,
};

function emptyPlan(): PlanDetail {
  return {
    id: "plan-1",
    title: "Gaspésie",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    latestRevision: 0,
    brief: emptyBrief(),
    candidates: [CANDIDATE],
    revisions: [],
  };
}

function draft(id: string, createdAt: string, days: PlanDay[] = []): NewRevision {
  return { id, reason: "First draft", createdAt, days, gaps: [] };
}

describe("appendRevision", () => {
  test("the first revision is number 1 and has no parent", () => {
    const plan = appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z"));
    const revision = latestRevision(plan);

    expect(revision?.revision).toBe(1);
    expect(revision?.parentRevisionId).toBeNull();
    expect(revision?.planId).toBe("plan-1");
    expect(plan.latestRevision).toBe(1);
  });

  test("each revision chains to the one before it", () => {
    const first = appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z"));
    const second = appendRevision(first, {
      ...draft("rev-2", "2026-08-16T09:00:00.000Z"),
      reason: "Moved the hike to Thursday",
    });

    expect(second.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(second.revisions[1]?.parentRevisionId).toBe("rev-1");
  });

  test("appending does not mutate the plan it was given, or its predecessor", () => {
    // §6's claim, and the one a caller can break by accident. The predecessor
    // must be unreachable from the result — not merely unchanged today.
    const before = appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z"));
    const snapshot = structuredClone(before);

    const after = appendRevision(before, {
      ...draft("rev-2", "2026-08-16T09:00:00.000Z"),
      reason: "Dropped the second hotel",
    });

    expect(before).toEqual(snapshot);
    expect(before.revisions).toHaveLength(1);
    expect(after.revisions).toHaveLength(2);
    expect(after.revisions).not.toBe(before.revisions);
    // The first revision object itself is shared, which is safe precisely
    // because nothing ever writes to one — and is what keeps a long history
    // from copying every day of every draft on each append.
    expect(after.revisions[0]).toBe(before.revisions[0]);
  });

  test("the caller cannot set the revision number or the parent", () => {
    // Both are derived, so a caller passing them is not merely ignored — the
    // type has no field to pass them in. This asserts the derivation wins over
    // anything that reaches the function anyway.
    const plan = appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z"));
    const forged = { ...draft("rev-2", "2026-08-16T09:00:00.000Z"), revision: 99 } as NewRevision;

    expect(latestRevision(appendRevision(plan, forged))?.revision).toBe(2);
  });

  test("updatedAt follows the revision's own timestamp, not a clock", () => {
    // The contract has no clock. A plan whose updatedAt disagrees with its
    // latest revision is a bug nobody would find.
    const plan = appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z"));
    expect(plan.updatedAt).toBe("2026-08-15T10:05:00.000Z");
  });
});

describe("latestRevision", () => {
  test("a plan with no revisions is a real state, and returns null", () => {
    // pl-5 creates the plan when the run starts so the run has somewhere to
    // report progress to. The first revision arrives when the composer is done.
    expect(latestRevision(emptyPlan())).toBeNull();
  });
});

describe("pinning", () => {
  test("a pinned item round-trips through the schema", () => {
    const pinned = item({ id: "item-2", position: 1, pinned: true, note: "Keep this one" });
    expect(planItemSchema.parse(pinned)).toEqual(pinned);
  });

  test("pinned candidates are reported in day and position order", () => {
    const revision = latestRevision(
      appendRevision(
        emptyPlan(),
        draft("rev-1", "2026-08-15T10:05:00.000Z", [
          day(0, [
            item({ id: "a", candidateId: "cand-a", position: 0, pinned: true }),
            item({ id: "b", candidateId: "cand-b", position: 1 }),
          ]),
          day(1, [item({ id: "c", candidateId: "cand-c", position: 0, pinned: true })]),
        ]),
      ),
    );

    expect(revisionItems(revision!).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(pinnedCandidateIds(revision!)).toEqual(["cand-a", "cand-c"]);
  });

  test("a plan whose items are all unpinned reports none", () => {
    const revision = latestRevision(
      appendRevision(emptyPlan(), draft("rev-1", "2026-08-15T10:05:00.000Z", [day(0, [item()])])),
    );
    expect(pinnedCandidateIds(revision!)).toEqual([]);
  });
});

describe("the revision schema", () => {
  const base = {
    id: "rev-1",
    planId: "plan-1",
    revision: 1,
    parentRevisionId: null,
    reason: "First draft",
    createdAt: "2026-08-15T10:05:00.000Z",
    days: [],
    gaps: [],
  };

  test("only the first revision may have no parent", () => {
    expect(planRevisionSchema.safeParse({ ...base, revision: 2 }).success).toBe(false);
  });

  test("the first revision may not have one", () => {
    expect(planRevisionSchema.safeParse({ ...base, parentRevisionId: "rev-0" }).success).toBe(
      false,
    );
  });

  test("day indexes must be dense and in order", () => {
    // A gap here is a plan with a missing Tuesday, which every reader would
    // then have to defend against by index arithmetic.
    expect(planRevisionSchema.safeParse({ ...base, days: [day(0, []), day(2, [])] }).success).toBe(
      false,
    );
    expect(planRevisionSchema.safeParse({ ...base, days: [day(1, []), day(0, [])] }).success).toBe(
      false,
    );
    expect(planRevisionSchema.safeParse({ ...base, days: [day(0, []), day(1, [])] }).success).toBe(
      true,
    );
  });

  test("a gap names a specialist and a reason a user can be told", () => {
    const withGap = {
      ...base,
      gaps: [
        {
          specialist: "lodging" as const,
          reason: "specialist-failed" as const,
          detail: "We could not check what is bookable in Percé for those dates.",
        },
      ],
    };
    expect(planRevisionSchema.parse(withGap).gaps).toHaveLength(1);
  });

  test("a day may have no date, because a brief may have no calendar", () => {
    // "Ten nights, whenever is best" is a real trip. A required date would make
    // the tool invent a departure and then plan against it as though chosen.
    const dateless = { ...base, days: [{ id: "d", dayIndex: 0, date: null, items: [] }] };
    expect(planRevisionSchema.safeParse(dateless).success).toBe(true);
  });
});

describe("the plan detail schema", () => {
  test("a whole document round-trips", () => {
    const plan = appendRevision(
      emptyPlan(),
      draft("rev-1", "2026-08-15T10:05:00.000Z", [day(0, [item({ pinned: true })])]),
    );
    expect(planDetailSchema.parse(plan)).toEqual(plan);
  });
});
