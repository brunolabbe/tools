/**
 * Which specialists this trip needs — as a table, and never as conditionals.
 *
 * `00-ANALYSIS.md` §4: **the roster is chosen, not fixed.** A resort week does
 * not need a route specialist, and one would produce noise about airport
 * transfers; a skidoo weekend lives or dies on conditions and gear. A specialist
 * with nothing to say costs money and pads the plan.
 *
 * The reason it is a table rather than a chain of `if`s inside the orchestrator
 * is the first question anyone debugging a bad plan asks: **which agents ran, and
 * why.** A table answers it by being read. A function that computed the same
 * answer would have to be traced, and its reasons would exist only in whoever
 * wrote it.
 *
 * So every specialist that runs carries the sentence that put it there, and
 * every specialist that does not carries the sentence that kept it out — because
 * the second half becomes a `PlanGap` with reason `specialist-not-applicable`,
 * which is reassurance the user reads rather than a hole they wonder about.
 *
 * ## Conditions are named, and there are three of them
 *
 * Most rows are `always`: the shape decides. Two rows are not, and both are
 * cases where the shape is the wrong question — an all-inclusive resort has
 * nothing for a food specialist to say and a room-only one has plenty, and a
 * road trip in a rented camper has paperwork that the same trip in your own car
 * does not. A condition is a named member of `ROSTER_CONDITIONS` with its
 * predicate beside it, so the table still reads as a table.
 */

import { isAnswered } from "@planner/contract";
import type { Specialist, TripBrief, TripShape } from "@planner/contract";

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const ROSTER_CONDITIONS = [
  /** The shape alone decides. Most rows. */
  "always",
  /** Meals are not already paid for — anything but an all-inclusive resort. */
  "meals-not-included",
  /** Something is rented, so there is paperwork, insurance and a pickup point. */
  "something-is-rented",
] as const;

export type RosterCondition = (typeof ROSTER_CONDITIONS)[number];

/**
 * What each condition means, in one place.
 *
 * An **unknown or declined** slot reads as "the condition is not met". That is
 * the conservative answer and it is the right one here: a `refine` slot is
 * routinely unknown at the first draft (the wizard stops at the core questions),
 * and running an extra specialist on a maybe is exactly the spend §9 says the
 * roster exists to avoid. The user is told, because a specialist kept off the
 * roster leaves a gap that names itself.
 */
const MEETS: Record<RosterCondition, (brief: TripBrief) => boolean> = {
  always: () => true,
  "meals-not-included": (brief) => {
    const details = brief.details;
    if (details?.shape !== "resort") return true;
    return !isAnswered(details.boardBasis) || details.boardBasis.value !== "all-inclusive";
  },
  "something-is-rented": (brief) => {
    const details = brief.details;
    if (details?.shape === "road-trip") {
      return isAnswered(details.vehicleSource) && details.vehicleSource.value === "rental";
    }
    if (details?.shape === "motorised-touring") {
      return isAnswered(details.machineSource) && details.machineSource.value === "rental";
    }
    return false;
  },
};

/** Why a condition kept a specialist off, for the user. */
const CONDITION_ABSENT: Record<RosterCondition, string> = {
  // Unreachable in practice — `always` never fails — and present so the record
  // is total rather than because a caller can hit it.
  always: "This part of the plan was not needed.",
  "meals-not-included":
    "Nothing was checked about where to eat: the board you asked for already covers the meals.",
  "something-is-rented":
    "Nothing was checked about rental paperwork or insurance: you are not renting anything for this trip.",
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export interface RosterRule {
  specialist: Specialist;
  /** The shapes this specialist has something to say about. */
  shapes: readonly TripShape[];
  when: RosterCondition;
  /** Why it is on the roster. Shown as the answer to "which agents ran, and why". */
  because: string;
}

const EVERY_SHAPE: readonly TripShape[] = [
  "road-trip",
  "backcountry",
  "motorised-touring",
  "city-and-culture",
  "resort",
  "multi-city",
];

/**
 * The roster, as data.
 *
 * Read it as rows: a specialist runs when one of its rows matches the brief's
 * shape and that row's condition holds. Two rows for one specialist is how a
 * shape earns it conditionally while others get it outright — `food` is the
 * worked example.
 *
 * The absences are the interesting half and each one is deliberate:
 *
 * - **No route specialist for `city-and-culture` or `resort`.** §4 names the
 *   resort case outright. A city trip is one place on foot, and legs between
 *   places are what a route specialist is for.
 * - **No conditions-and-gear outside `backcountry` and `motorised-touring`.**
 *   §4: a skidoo weekend lives or dies on it. A week in Rome does not, and a
 *   specialist that runs everywhere says nothing anywhere.
 * - **No practicalities for a `road-trip` in your own car.** Every other shape
 *   carries paperwork by construction — a permit, a border, a rental counter, a
 *   hut reservation. A road trip in the car on the drive does not, and running a
 *   specialist to say so is the spend §9 exists to refuse.
 *
 * `lodging`, `activities` and `budget` run on everything, and that is not
 * laziness: every trip sleeps somewhere, does something, and costs money.
 */
export const ROSTER: readonly RosterRule[] = [
  {
    specialist: "route-and-logistics",
    shapes: ["road-trip", "backcountry", "motorised-touring", "multi-city"],
    when: "always",
    because: "This trip moves between places, so the legs between them are part of the plan.",
  },
  {
    specialist: "lodging",
    shapes: EVERY_SHAPE,
    when: "always",
    because: "Every trip sleeps somewhere, and what is bookable decides how far ahead.",
  },
  {
    specialist: "activities",
    shapes: EVERY_SHAPE,
    when: "always",
    because: "What there is to do, how long it takes, and when it is open.",
  },
  {
    specialist: "conditions-and-gear",
    shapes: ["backcountry", "motorised-touring"],
    when: "always",
    because: "This trip depends on the conditions on the day and on carrying the right kit.",
  },
  {
    specialist: "food",
    shapes: ["road-trip", "city-and-culture", "multi-city"],
    when: "always",
    because: "Meals are part of this trip rather than fuel for it.",
  },
  {
    specialist: "food",
    shapes: ["resort"],
    when: "meals-not-included",
    because: "The board you asked for leaves meals to arrange.",
  },
  {
    specialist: "practicalities",
    shapes: ["backcountry", "motorised-touring", "multi-city", "city-and-culture", "resort"],
    when: "always",
    because: "Permits, documents and insurance decide whether this trip happens at all.",
  },
  {
    specialist: "practicalities",
    shapes: ["road-trip"],
    when: "something-is-rented",
    because: "A rental brings paperwork, insurance and a pickup point with it.",
  },
  {
    specialist: "budget",
    shapes: EVERY_SHAPE,
    when: "always",
    because: "What it comes to, and the assumptions under the estimate.",
  },
];

/**
 * The order a roster is reported in, and the order the budget drops from the
 * back of.
 *
 * **It is not `SPECIALISTS`' order and it is not alphabetical: it is what a plan
 * loses least by keeping.** The four whose output the composer can actually put
 * on a day come first, because a plan with nothing on any day is not a plan —
 * `nothing-placed` is a hard critic finding and the run fails outright.
 * `conditions-and-gear` follows them because it is the one that is safety-
 * adjacent (§8), and `budget` is last because the composer sums the cost bands
 * on the candidates itself, in code, whether or not a budget specialist ran.
 *
 * Kept as one global order rather than one per shape: a per-shape ordering is
 * six tables that have to agree about the same six judgements, and nothing yet
 * needs them to differ.
 */
export const SPECIALIST_ORDER: readonly Specialist[] = [
  "route-and-logistics",
  "lodging",
  "activities",
  "food",
  "conditions-and-gear",
  "practicalities",
  "budget",
];

/** Why a specialist has nothing to say about a shape. One sentence, per specialist. */
const SHAPE_ABSENT: Record<Specialist, string> = {
  "route-and-logistics":
    "Nothing was checked about legs between places: this trip stays where it lands.",
  lodging: "Nothing was checked about where to sleep.",
  activities: "Nothing was checked about what there is to do.",
  "conditions-and-gear":
    "Nothing was checked about conditions or kit: this trip does not turn on them.",
  food: "Nothing was checked about where to eat.",
  budget: "Nothing was estimated about what this comes to.",
  practicalities: "Nothing was checked about permits, documents or insurance.",
};

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

export interface RosterEntry {
  specialist: Specialist;
  /** The matched row's sentence, or the reason it was left out. */
  because: string;
}

export interface RosterDecision {
  /** Who runs, in `SPECIALISTS` order so a roster reads the same twice. */
  running: RosterEntry[];
  /** Everyone else, each with the sentence that becomes their `PlanGap`. */
  notApplicable: RosterEntry[];
}

/**
 * The roster for a brief — a pure function of it, and of nothing else.
 *
 * A brief whose shape is not answered gets an empty roster rather than a guess.
 * `shape` is a required slot, so that brief is not draftable and the
 * orchestrator refuses it before ever asking for a roster; the empty answer is
 * here so this function has one at all, not because it is a reachable plan.
 */
export function rosterFor(brief: TripBrief): RosterDecision {
  const running: RosterEntry[] = [];
  const notApplicable: RosterEntry[] = [];

  const shape = isAnswered(brief.shape) ? brief.shape.value : null;

  for (const specialist of SPECIALIST_ORDER) {
    const rows = ROSTER.filter((rule) => rule.specialist === specialist);
    const forShape = shape === null ? [] : rows.filter((rule) => rule.shapes.includes(shape));

    const matched = forShape.find((rule) => MEETS[rule.when](brief));
    if (matched !== undefined) {
      running.push({ specialist, because: matched.because });
      continue;
    }

    // A row that exists for this shape and did not fire explains itself with the
    // condition's own sentence; no row at all is a fact about the shape.
    const blocked = forShape[0];
    notApplicable.push({
      specialist,
      because: blocked === undefined ? SHAPE_ABSENT[specialist] : CONDITION_ABSENT[blocked.when],
    });
  }

  return { running, notApplicable };
}
