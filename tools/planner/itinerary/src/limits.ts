/**
 * How much a day is allowed to hold.
 *
 * **These tables are content, and they are reviewed as content** — the same
 * standing the question tree has in `@planner/intake`. Every number here is a
 * claim about what a real party can do in a day, and the honest way to argue
 * with one is to argue with the number rather than to add a branch somewhere
 * that quietly works around it.
 *
 * They are tables and not conditionals for the reason the roster is (§4): "why
 * did it only put two things on Tuesday" has to be answerable by reading one
 * value, not by tracing the packer.
 *
 * The brief already carries the user's own answer to each of these questions —
 * `effort`, `driveAppetite`, `pace` — which is exactly the point of §1's
 * observation that "not too much driving" means four hours to one person and
 * ninety minutes to another. Nothing here is a default the tool prefers; each
 * row is a translation of an answer the party gave into the unit the packer
 * needs.
 */

import type { CityPace, DriveAppetite, EffortAppetite } from "@planner/contract";

/**
 * Minutes of *doing* a day may hold, by the party's effort appetite.
 *
 * Doing, not waking: this budget covers activities and the meals that are part
 * of the trip, and deliberately not the drive, which has its own budget below
 * because a day can be long in one and short in the other.
 *
 * `gentle` is a stroll and a long lunch; `strenuous` is dawn starts under load,
 * several days running. The spread is roughly 3.5× because that is what the
 * enum's own doc comments describe, and a narrower one would make the answer
 * not worth asking for.
 */
export const ACTIVITY_MINUTES_PER_DAY: Record<EffortAppetite, number> = {
  gentle: 180,
  moderate: 300,
  demanding: 480,
  strenuous: 660,
};

/**
 * Minutes behind the wheel a day may hold, by the party's drive appetite.
 *
 * The enum is named for the day rather than for a number on purpose (see
 * `DRIVE_APPETITES`), so this table is where the day becomes arithmetic. It is
 * the only place it does — §2's failure 1 is geometry, and the honest position
 * in Phase 2 is that we can bound the *durations a specialist stated* and
 * cannot compute a leg we were never given, which is what
 * `UNCHECKED_CONSTRAINTS` records on every plan.
 */
export const DRIVE_MINUTES_PER_DAY: Record<DriveAppetite, number> = {
  "short-hops": 150,
  "half-day": 300,
  "long-day": 480,
  "all-day": 660,
};

/**
 * How many scheduled things a city day holds, by the party's pace.
 *
 * A count rather than minutes because that is the unit the question was asked
 * in, and because a city day is bounded by appetite for queueing and walking
 * between things long before it is bounded by the sum of the durations. It
 * applies *on top of* the effort budget, never instead of it: whichever binds
 * first, binds.
 */
export const ITEMS_PER_CITY_DAY: Record<CityPace, number> = {
  packed: 5,
  steady: 3,
  slow: 2,
};

/**
 * The effort appetite assumed when the party declined to give one.
 *
 * `effort` is a required slot, so a brief that reaches the composer has it
 * answered or declined — and a declined slot is indistinguishable from an
 * unknown one downstream, by design (`Slot`). Something has to be assumed to
 * pack a day at all, and the middle of the range is the assumption that is
 * wrong by the least. It is recorded on the plan rather than hidden: see
 * `"effort-assumed"` in `UNCHECKED_CONSTRAINTS`.
 */
export const ASSUMED_EFFORT: EffortAppetite = "moderate";

/**
 * Bounded, or the critic and the packer argue on the clock.
 *
 * Two is the architecture's number (`MAX_CRITIC_ROUNDS`). It is a default here
 * and configuration in `api`, because this package reads no environment.
 */
export const MAX_CRITIC_ROUNDS = 2;
