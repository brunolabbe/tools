/**
 * `PlanRevision.reason`, one test per branch of pl-44's step 6 table.
 */

import { describe, expect, test } from "vitest";
import {
  emptyBrief,
  MAX_CANDIDATE_TITLE_CHARS,
  MAX_PLAN_DAYS,
  MAX_REVISION_REASON_CHARS,
  planRevisionSchema,
  SPECIALISTS,
  type PlanRevision,
} from "@planner/contract";
import { revisionReason, type ReasonInput } from "../src/runs/reason.ts";

describe("revisionReason", () => {
  test("a re-plan where specialists ran names the days and who ran, in SPECIALIST_ORDER", () => {
    // The step 6 table's example reads "with food and lodging"; the rule beside
    // it orders by SPECIALIST_ORDER, where lodging comes first. The rule wins.
    for (const ran of [
      ["lodging", "food"],
      ["food", "lodging"],
    ] as const) {
      expect(revisionReason({ kind: "replan", days: [2, 3], ran })).toBe(
        "Re-planned days 3–4 with lodging and food.",
      );
    }
    expect(
      revisionReason({ kind: "replan", days: [0], ran: ["budget", "route-and-logistics", "food"] }),
    ).toBe("Re-planned day 1 with route and logistics, food and budget.");
  });

  test("a re-plan where nothing ran is a re-pack", () => {
    expect(revisionReason({ kind: "replan", days: [2], ran: [] })).toBe(
      "Re-packed day 3 from what was already proposed.",
    );
  });

  test("a scattered day set is written with commas, en dashes and a final and", () => {
    expect(revisionReason({ kind: "replan", days: [1, 3, 4, 6], ran: [] })).toBe(
      "Re-packed days 2, 4–5 and 7 from what was already proposed.",
    );
    expect(revisionReason({ kind: "replan", days: [0, 2], ran: [] })).toBe(
      "Re-packed days 1 and 3 from what was already proposed.",
    );
  });

  test("a move across days names both, 1-based", () => {
    expect(
      revisionReason({
        kind: "move",
        title: "Chute Montmorency",
        fromDayIndex: 1,
        toDayIndex: 3,
      }),
    ).toBe("Moved “Chute Montmorency” from day 2 to day 4.");
  });

  test("a move within a day names the day once", () => {
    expect(
      revisionReason({ kind: "move", title: "Chute Montmorency", fromDayIndex: 1, toDayIndex: 1 }),
    ).toBe("Moved “Chute Montmorency” within day 2.");
  });

  test("a remove names the item and its day", () => {
    expect(revisionReason({ kind: "remove", title: "Chute Montmorency", fromDayIndex: 1 })).toBe(
      "Removed “Chute Montmorency” from day 2.",
    );
  });

  test("a restore says version", () => {
    expect(revisionReason({ kind: "restore", revision: 3 })).toBe("Restored version 3.");
  });

  test("every branch at its longest fits the schema's bound, and parses on a revision", () => {
    const title = "T".repeat(MAX_CANDIDATE_TITLE_CHARS);
    const last = MAX_PLAN_DAYS - 1;
    // Every other day: the longest a day list can be written.
    const scattered = Array.from({ length: MAX_PLAN_DAYS }, (_, day) => day).filter(
      (day) => day % 2 === 0,
    );
    const longest: ReasonInput[] = [
      { kind: "move", title, fromDayIndex: last - 1, toDayIndex: last },
      { kind: "move", title, fromDayIndex: last, toDayIndex: last },
      { kind: "remove", title, fromDayIndex: last },
      { kind: "replan", days: scattered, ran: [...SPECIALISTS] },
      { kind: "replan", days: scattered, ran: [] },
      { kind: "restore", revision: 50 },
    ];

    for (const input of longest) {
      const reason = revisionReason(input);
      expect(reason.length).toBeLessThanOrEqual(MAX_REVISION_REASON_CHARS);

      const revision: PlanRevision = {
        id: "r2",
        planId: "p",
        revision: 2,
        parentRevisionId: "r1",
        reason,
        operation: { kind: "restore", revision: 1 },
        brief: emptyBrief(),
        createdAt: "2026-08-15T12:00:00.000Z",
        days: [],
        gaps: [],
        coverage: [],
        deadlines: [],
        reading: [],
      };
      expect(planRevisionSchema.safeParse(revision).success).toBe(true);
    }
  });
});

describe("a brief edit's caption (pl-47)", () => {
  // Step 3.5's table, with one row read as its subject rather than its words:
  // see the last case.
  const rows: [string, ReasonInput, string][] = [
    [
      "dates, longer",
      { kind: "brief", dates: true, budget: false, before: 8, after: 10, everyDay: false },
      "Changed the dates, and planned days 9–10.",
    ],
    [
      "dates, shorter",
      { kind: "brief", dates: true, budget: false, before: 8, after: 6, everyDay: false },
      "Changed the dates, and dropped days 7–8.",
    ],
    [
      "dates, same length",
      { kind: "brief", dates: true, budget: false, before: 8, after: 8, everyDay: false },
      "Changed the dates.",
    ],
    [
      "budget",
      { kind: "brief", dates: false, budget: true, before: 8, after: 8, everyDay: true },
      "Changed the budget, and re-packed every day.",
    ],
    [
      "dates and budget",
      { kind: "brief", dates: true, budget: true, before: 8, after: 10, everyDay: true },
      "Changed the dates and the budget, and re-packed every day.",
    ],
    [
      "dates shorter and budget",
      { kind: "brief", dates: true, budget: true, before: 8, after: 6, everyDay: true },
      "Changed the dates and the budget, dropped days 7–8, and re-packed the rest.",
    ],
    [
      "one day more",
      { kind: "brief", dates: true, budget: false, before: 5, after: 6, everyDay: false },
      "Changed the dates, and planned day 6.",
    ],
  ];

  test.for(rows)("%s", ([, input, caption]) => {
    expect(revisionReason(input)).toBe(caption);
  });

  test("a new day count under a per-day budget says the dates changed, not the budget", () => {
    // The table's row reads "Changed the budget, and re-packed every day." for
    // this case. The budget slot did not change, and a caption that says it did
    // is a false sentence under the diff; so the subject is what was changed,
    // and the action is what the ceiling moving made the tool do.
    expect(
      revisionReason({
        kind: "brief",
        dates: true,
        budget: false,
        before: 8,
        after: 10,
        everyDay: true,
      }),
    ).toBe("Changed the dates, and re-packed every day.");
    expect(
      revisionReason({
        kind: "brief",
        dates: true,
        budget: false,
        before: 8,
        after: 6,
        everyDay: true,
      }),
    ).toBe("Changed the dates, dropped days 7–8, and re-packed the rest.");
  });

  test("the longest is within MAX_REVISION_REASON_CHARS", () => {
    const longest = revisionReason({
      kind: "brief",
      dates: true,
      budget: true,
      before: MAX_PLAN_DAYS,
      after: 1,
      everyDay: true,
    });
    expect(longest).toBe(
      "Changed the dates and the budget, dropped days 2–60, and re-packed the rest.",
    );
    expect(longest.length).toBeLessThanOrEqual(MAX_REVISION_REASON_CHARS);
  });
});
