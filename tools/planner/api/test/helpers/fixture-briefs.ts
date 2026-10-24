/**
 * Drafting one of the checked-in briefs through a real run — pl-60.
 *
 * Not a test file — vitest collects `*.test.ts` only.
 *
 * A run starts from an intake, and an intake's brief is whatever its answers
 * build, so a suite cannot hand a run `road-trip.json`'s brief over HTTP. The
 * six checked-in briefs are the ones the scripted model answers for, and the
 * ones pl-58's set A ran, so a suite that wants "a draft of this shape, as a
 * run produces it" mocks the one read `startRun` makes — `readIntake` — to
 * swap the brief, and leaves everything after it real: the queue, discovery,
 * the fan-out, measuring, composing and the stored revision.
 *
 * This module imports nothing from `src` on purpose: it is loaded from inside a
 * `vi.mock` factory for `src/intakes/state.ts`, and an import back into `src`
 * from there would ask for the module being mocked.
 */

import type { IntakeState, TripBrief } from "@planner/contract";

/** Which intake drafts which brief. Filled by the suite before it starts the run. */
export const FIXTURE_BRIEFS = new Map<string, TripBrief>();

/** `readIntake`, with the brief swapped for an intake the suite registered above. */
export function withFixtureBrief<Context>(
  read: (context: Context, id: string) => IntakeState,
): (context: Context, id: string) => IntakeState {
  return (context, id) => {
    const state = read(context, id);
    const brief = FIXTURE_BRIEFS.get(id);
    return brief === undefined ? state : { ...state, brief };
  };
}
