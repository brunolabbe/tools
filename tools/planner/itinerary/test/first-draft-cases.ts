/**
 * The inputs behind `fixtures/first-draft-baseline.json` (pl-43 step 0).
 *
 * The baseline is the full `ComposeResult` for each case below, written by the
 * package **before** pl-43 touched `src`. It proves `compose` keeps producing
 * exactly the first drafts it produced then: the id helper, the critic's
 * transition charge and `fixed`, and the frozen days in `pack` are all shared
 * with `replan` now, and none of them may reach a first draft.
 *
 * Nothing here writes the file. A comparison that writes on a first run
 * (`toMatchFileSnapshot`) baselines whatever tree runs it first, which after a
 * refactor is the refactor.
 */

import { TRIP_SHAPES, type Candidate } from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { compose, type ComposeInput, type ComposeResult } from "../src/compose.ts";
import { NOTHING_MEASURED } from "../src/travel.ts";
import { briefFor, measuredEverywhere, NOW, REVISION, travelled } from "./helpers.ts";

/**
 * Three 90-minute activities on one moderate day, 45 minutes apart.
 *
 * `pack.test.ts`'s transition case, composed. **It is the only case here that
 * puts two chargeable items on one day**, which is what lets the baseline see a
 * change to the critic's transition charge at all: the six checked-in sets
 * never do (`compose.test.ts` asserts that). Ids are literal rather than from
 * `candidate()`, whose counter depends on what ran before it.
 */
function transitionCase(): ComposeInput {
  const things: Candidate[] = ["a", "b", "c"].map((suffix) => ({
    id: `baseline-activity-${suffix}`,
    specialist: "activities",
    title: "Something to do",
    summary: "A thing a specialist proposed.",
    location: {
      kind: "at",
      place: { name: "Somewhere", locality: null, coordinates: null },
    },
    durationMinutes: 90,
    cost: null,
    season: null,
    bookingLeadTimeDays: null,
    provenance: { kind: "model-asserted" },
  }));

  return {
    brief: briefFor({ dates: { kind: "exact", departure: "2027-07-05", return: "2027-07-05" } }),
    candidates: things,
    travel: measuredEverywhere(travelled({ durationMinutes: 45 })),
    revision: REVISION,
    now: NOW,
  };
}

/** Every case, by a name that says which input produced it. */
export function firstDraftCases(): Record<string, ComposeInput> {
  const cases: Record<string, ComposeInput> = {};
  for (const shape of TRIP_SHAPES) {
    const fixture = loadFixture(shape);
    const base = {
      brief: fixture.brief,
      candidates: fixture.candidates,
      revision: REVISION,
      now: NOW,
    };
    cases[`${shape}/nothing-measured`] = { ...base, travel: NOTHING_MEASURED };
    cases[`${shape}/measured-everywhere`] = {
      ...base,
      travel: measuredEverywhere(travelled()),
    };
  }
  cases["transition/three-activities-45-minutes-apart"] = transitionCase();
  return cases;
}

/** What `compose` makes of every case, keyed as above. */
export function composeEveryCase(): Record<string, ComposeResult> {
  return Object.fromEntries(
    Object.entries(firstDraftCases()).map(([name, input]) => [name, compose(input)]),
  );
}
