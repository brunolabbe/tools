/**
 * `diffRevisions` and `revisionDiffs` — pl-43 step 6's table, one test per row,
 * and the rules behind it.
 */

import { describe, expect, test } from "vitest";
import { revisionDiffSchema, type RevisionOperation } from "@planner/contract";
import { diffRevisions, revisionDiffs } from "../src/diff.ts";
import { revisionOf } from "./revisions.ts";

type Days = readonly (readonly string[])[];

const REPLAN = (days: number[]): RevisionOperation => ({
  kind: "replan",
  days,
  specialists: [],
  note: null,
});

const MOVE = (
  candidateId: string,
  fromDayIndex: number,
  toDayIndex: number,
  toPosition: number,
): RevisionOperation => ({ kind: "move", candidateId, fromDayIndex, toDayIndex, toPosition });

/** Parent `rev-1` and child `rev-2` from lists of candidate ids; `pinned` is pinned in both. */
function entriesFor(
  parent: Days,
  child: Days,
  operation: RevisionOperation,
  pinned: readonly string[] = [],
) {
  const spec = (days: Days) =>
    days.map((items) =>
      items.map((candidate) => ({ candidate, pinned: pinned.includes(candidate) })),
    );
  const diff = diffRevisions(
    revisionOf({ id: "rev-1", days: spec(parent) }),
    revisionOf({ id: "rev-2", parentRevisionId: "rev-1", operation, days: spec(child) }),
  );
  expect(() => revisionDiffSchema.parse(diff)).not.toThrow();
  return diff.entries;
}

const at = (dayIndex: number, position: number) => ({ dayIndex, position });

describe("the twelve rows", () => {
  test("1: a restore that re-keys the same days is no change", () => {
    expect(
      entriesFor([["A", "B", "C"]], [["A", "B", "C"]], { kind: "restore", revision: 1 }),
    ).toEqual([]);
  });

  test("2: removing B reports B, and C is not moved", () => {
    expect(
      entriesFor([["A", "B", "C"]], [["A", "C"]], {
        kind: "remove",
        candidateId: "B",
        fromDayIndex: 0,
      }),
    ).toEqual([{ kind: "removed", candidateId: "B", from: at(0, 1) }]);
  });

  test("3: adding B reports B, and C is not moved", () => {
    expect(entriesFor([["A", "C"]], [["A", "B", "C"]], REPLAN([0]))).toEqual([
      { kind: "added", candidateId: "B", to: at(0, 1) },
    ]);
  });

  test("4: A moved to another day, and B, which slid up, is not moved", () => {
    expect(entriesFor([["A", "B"], ["C"]], [["B"], ["C", "A"]], MOVE("A", 0, 1, 1))).toEqual([
      { kind: "moved", candidateId: "A", from: at(0, 0), to: at(1, 1) },
    ]);
  });

  test("5: an adjacent swap captioned as moving A reports A only", () => {
    expect(entriesFor([["A", "B", "C"]], [["B", "A", "C"]], MOVE("A", 0, 0, 1))).toEqual([
      { kind: "moved", candidateId: "A", from: at(0, 0), to: at(0, 1) },
    ]);
  });

  test("6: the same swap from a re-plan keeps the smaller parent positions and reports B", () => {
    expect(entriesFor([["A", "B", "C"]], [["B", "A", "C"]], REPLAN([0]))).toEqual([
      { kind: "moved", candidateId: "B", from: at(0, 1), to: at(0, 0) },
    ]);
  });

  test("7: A moved to the end reports A only, not the three that slid up", () => {
    expect(entriesFor([["A", "B", "C", "D"]], [["B", "C", "D", "A"]], MOVE("A", 0, 0, 3))).toEqual([
      { kind: "moved", candidateId: "A", from: at(0, 0), to: at(0, 3) },
    ]);
  });

  test("8: a pin leading its day after a re-pack is kept, and D is the one moved", () => {
    expect(entriesFor([["D", "P"]], [["P", "D"]], REPLAN([0]), ["P"])).toEqual([
      { kind: "moved", candidateId: "D", from: at(0, 0), to: at(0, 1) },
    ]);
  });

  test("9: a removal and a move on one day", () => {
    expect(entriesFor([["A", "B", "C", "D"]], [["C", "A", "D"]], REPLAN([0]))).toEqual([
      { kind: "moved", candidateId: "C", from: at(0, 2), to: at(0, 0) },
      { kind: "removed", candidateId: "B", from: at(0, 1) },
    ]);
  });

  test("10: A moved in front of B on another day, and B is not moved", () => {
    expect(entriesFor([["A"], ["B"]], [[], ["A", "B"]], MOVE("A", 0, 1, 0))).toEqual([
      { kind: "moved", candidateId: "A", from: at(0, 0), to: at(1, 0) },
    ]);
  });

  test("11: entries sort by day, position, kind and id, and twice is the same list", () => {
    const parent = [
      ["A", "B"],
      ["C", "D"],
    ];
    const child = [
      ["B", "D"],
      ["E", "C"],
    ];
    const once = entriesFor(parent, child, REPLAN([0, 1]));
    expect(once).toEqual([
      { kind: "removed", candidateId: "A", from: at(0, 0) },
      { kind: "moved", candidateId: "D", from: at(1, 1), to: at(0, 1) },
      { kind: "added", candidateId: "E", to: at(1, 0) },
    ]);
    expect(entriesFor(parent, child, REPLAN([0, 1]))).toEqual(once);
  });

  test("12: a revision that is not the parent's child is INTERNAL", () => {
    const parent = revisionOf({ id: "rev-1", days: [["A", "B"]] });
    const stranger = revisionOf({
      id: "rev-9",
      parentRevisionId: "rev-8",
      operation: REPLAN([0]),
      days: [["A", "B"]],
    });
    expect(() => diffRevisions(parent, stranger)).toThrow(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });
});

describe("the rules the table does not reach", () => {
  test("at one place, removed sorts before moved and moved before added", () => {
    // `removed` sorts by where it was and the others by where they are, so a
    // removal and an arrival can share a place. Two entries of one kind never
    // can, which is why the candidate-id tie is a total order and not a case.
    expect(entriesFor([["A", "D"], ["B"]], [["B", "C"], []], REPLAN([0, 1]))).toEqual([
      { kind: "removed", candidateId: "A", from: at(0, 0) },
      { kind: "moved", candidateId: "B", from: at(1, 0), to: at(0, 0) },
      { kind: "removed", candidateId: "D", from: at(0, 1) },
      { kind: "added", candidateId: "C", to: at(0, 1) },
    ]);
  });

  test("a full day reversed keeps one stayer, the first, and reports the other eleven", () => {
    const day = Array.from({ length: 12 }, (_, index) => `c${String(index).padStart(2, "0")}`);
    const entries = entriesFor([day], [day.toReversed()], REPLAN([0]));
    expect(entries.map((entry) => entry.candidateId).toSorted()).toEqual(day.slice(1));
  });

  test("the largest kept set wins over a smaller one that keeps a pin", () => {
    // Pins break ties between largest sets only (rule 3.2); they never shrink
    // the set. `[P, A, B] → [A, B, P]` keeps A and B, so the pin is what moved.
    expect(entriesFor([["P", "A", "B"]], [["A", "B", "P"]], REPLAN([0]), ["P"])).toEqual([
      { kind: "moved", candidateId: "P", from: at(0, 0), to: at(0, 2) },
    ]);
  });
});

describe("revisionDiffs", () => {
  const first = revisionOf({ id: "rev-1", days: [["A", "B"]] });
  const second = revisionOf({
    id: "rev-2",
    parentRevisionId: "rev-1",
    revision: 2,
    operation: { kind: "remove", candidateId: "A", fromDayIndex: 0 },
    days: [["B"]],
  });
  const third = revisionOf({
    id: "rev-3",
    parentRevisionId: "rev-2",
    revision: 3,
    operation: REPLAN([0]),
    days: [["B", "C"]],
  });

  test("returns one diff per revision after the first, oldest first, paired by parent id", () => {
    // Shuffled on the way in: adjacency in the array is not what pairs them.
    const diffs = revisionDiffs([third, first, second]);
    expect(diffs.map((diff) => [diff.parentRevisionId, diff.revisionId])).toEqual([
      ["rev-1", "rev-2"],
      ["rev-2", "rev-3"],
    ]);
    expect(diffs.map((diff) => diff.entries.map((entry) => entry.kind))).toEqual([
      ["removed"],
      ["added"],
    ]);
  });

  test("a plan with only its first draft has no diffs", () => {
    expect(revisionDiffs([first])).toEqual([]);
  });

  test("a revision whose parent is not in the list is INTERNAL", () => {
    expect(() => revisionDiffs([first, third])).toThrow(
      expect.objectContaining({ code: "INTERNAL" }),
    );
  });
});
