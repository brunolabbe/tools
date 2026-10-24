/**
 * lg-65: the block search answers as it did before it was made faster. Two
 * checks on one seeded population of pastes (`helpers/paste-population.ts`):
 *
 * - **Every call.** `matchStretch` is wrapped so that each call the import makes
 *   is answered by both searches, lg-65's and the one `main` had at `8a6dcf9a`
 *   (`helpers/reference-search.ts`, verbatim), and the two pairings compared.
 * - **Every outcome.** Each seed is run twice on fresh databases, once answered by
 *   lg-65's search and once by `main`'s alone: the reports or errors, and the rows
 *   stored after, must be equal.
 *
 * The suite runs seeds 1 to 200, about 3 s here: the old search is the slow half.
 * The Log's run of seeds 1 to 20,000 is this file with `LG65_SEEDS=1-20000`, and
 * `LG65_SUMMARY=<file>` writes the counts it read.
 */

import { writeFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import type * as WorkbookDays from "../src/workbook-days.ts";
import { runScenario, scenario } from "./helpers/paste-population.ts";

const state = vi.hoisted(() => ({
  answer: "new" as "new" | "reference",
  seed: 0,
  calls: 0,
  accepted: 0,
  mismatches: [] as string[],
}));

vi.mock("../src/workbook-days.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof WorkbookDays>();
  const { matchStretch: reference } = await import("./helpers/reference-search.ts");
  const matchStretch: typeof actual.matchStretch = (rows, start, pasted, same, tolerance) => {
    const theirs = reference(rows, start, pasted, same, tolerance);
    if (state.answer === "reference") return theirs;
    const mine = actual.matchStretch(rows, start, pasted, same, tolerance);
    state.calls += 1;
    if (theirs !== null) state.accepted += 1;
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
      state.mismatches.push(
        `seed ${state.seed}: ${JSON.stringify(mine)} against ${JSON.stringify(theirs)}`,
      );
    }
    return mine;
  };
  return { ...actual, matchStretch };
});

/** The seeds to run: `LG65_SEEDS` as `first-last`, or the suite's own 1 to 200. */
function seeds(): [number, number] {
  const [first, last] = (process.env.LG65_SEEDS ?? "1-200").split("-").map(Number);
  return [first ?? 1, last ?? 200];
}

test("the search pairs and decides every seeded paste as main's search did (lg-65)", () => {
  const [first, last] = seeds();
  const differing: string[] = [];
  const shapes = new Map<string, number>();
  const outcomes = new Map<string, number>();
  for (let seed = first; seed <= last; seed++) {
    const drawn = scenario(seed);
    state.seed = seed;
    state.answer = "new";
    const mine = runScenario(drawn);
    state.answer = "reference";
    const theirs = runScenario(drawn);
    if (JSON.stringify(mine) !== JSON.stringify(theirs)) differing.push(`seed ${seed}`);
    shapes.set(drawn.shape, (shapes.get(drawn.shape) ?? 0) + 1);
    for (const paste of mine.pastes) {
      const kind = "report" in paste ? "accepted" : paste.code;
      outcomes.set(kind, (outcomes.get(kind) ?? 0) + 1);
    }
  }
  const summary = {
    seeds: `${first}-${last}`,
    searchCalls: state.calls,
    searchCallsMatching: state.accepted,
    callMismatches: state.mismatches.length,
    outcomeMismatches: differing.length,
    shapes: Object.fromEntries(shapes),
    outcomes: Object.fromEntries(outcomes),
    firstMismatches: [...state.mismatches.slice(0, 5), ...differing.slice(0, 5)],
  };
  if (process.env.LG65_SUMMARY !== undefined) {
    writeFileSync(process.env.LG65_SUMMARY, `${JSON.stringify(summary, null, 2)}\n`);
  }
  expect(state.mismatches.slice(0, 5)).toEqual([]);
  expect(differing.slice(0, 5)).toEqual([]);
  // Not vacuous: the search was reached, it matched and refused, and pastes were
  // both stored and refused.
  expect(state.calls).toBeGreaterThan(last - first);
  expect(state.accepted).toBeGreaterThan(0);
  expect(state.accepted).toBeLessThan(state.calls);
  expect(outcomes.get("accepted") ?? 0).toBeGreaterThan(0);
  expect([...outcomes.keys()].length).toBeGreaterThan(1);
});
