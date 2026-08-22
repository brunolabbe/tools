/**
 * Builders for the two things every suite here needs — a brief with particular
 * answers, and a candidate with a particular constraint on it.
 *
 * The checked-in fixtures in `@planner/contract`'s `test/fixtures/` are the
 * *realistic* input and are used directly by `compose.test.ts`. These builders
 * are for the opposite job: constructing the one-constraint-at-a-time cases
 * that make a packer testable — a candidate that is only ever out of season, a
 * day that is over by exactly one minute — which a realistic fixture cannot be
 * bent into without becoming unrealistic.
 */

import {
  emptyShapeDetails,
  emptyBrief,
  location,
  MODEL_ASSERTED,
  NOT_ESTABLISHED,
  slot,
  type Candidate,
  type ItemTravel,
  type MeasuredTravel,
  type Specialist,
  type TripBrief,
  type TripDates,
  type TripShapeDetails,
} from "@planner/contract";
import type { TravelTable } from "../src/travel.ts";

/** A draftable road-trip brief: every required slot answered, nothing else. */
export function briefFor(overrides: {
  dates?: TripDates;
  details?: TripShapeDetails;
  travellers?: number;
  effort?: TripBrief["effort"];
  budget?: TripBrief["budget"];
  dealBreakers?: string[];
}): TripBrief {
  const details =
    overrides.details ??
    detailsFor("road-trip", {
      driveAppetite: slot.answered("half-day"),
      vehicleKind: slot.answered("car"),
    });

  return {
    ...emptyBrief(),
    shape: slot.answered(details.shape),
    origin: slot.answered("Montréal"),
    dates: slot.answered(
      overrides.dates ?? { kind: "exact", departure: "2027-07-05", return: "2027-07-08" },
    ),
    travellers: slot.answered(overrides.travellers ?? 2),
    effort: overrides.effort ?? slot.answered("moderate"),
    budget: overrides.budget ?? slot.unknown(),
    dealBreakers: overrides.dealBreakers ? slot.answered(overrides.dealBreakers) : slot.unknown(),
    details,
  };
}

/** A shape extension with only the slots a test names answered. */
export function detailsFor<S extends TripShapeDetails["shape"]>(
  shape: S,
  answered: Partial<Extract<TripShapeDetails, { shape: S }>>,
): TripShapeDetails {
  return { ...emptyShapeDetails(shape), ...answered } as TripShapeDetails;
}

let sequence = 0;

/** A minimal valid candidate. Every field a test does not care about is `null`. */
export function candidate(overrides: Partial<Candidate> & { specialist: Specialist }): Candidate {
  sequence += 1;
  return {
    id: `cand-${sequence}`,
    title: "Something to do",
    summary: "A thing a specialist proposed.",
    location: location.at({ name: "Somewhere", locality: null, coordinates: null }),
    durationMinutes: null,
    cost: null,
    season: null,
    bookingLeadTimeDays: null,
    provenance: MODEL_ASSERTED,
    ...overrides,
  };
}

/**
 * One measurement, as the grounding pass would hand it over.
 *
 * `grounded` with a source, because that is the only shape `provenanceSchema`
 * accepts for a measured fact and the only shape the pass can produce.
 */
export function travelled(overrides: Partial<MeasuredTravel> = {}): ItemTravel {
  return {
    kind: "measured",
    distanceMeters: 60_000,
    durationMinutes: 45,
    provenance: {
      kind: "grounded",
      sources: [
        {
          url: "https://fixtures.invalid/planner/legs/test",
          title: "Checked-in fixture, not a measurement",
          fetchedAt: "2026-08-22T00:00:00.000Z",
        },
      ],
    },
    ...overrides,
  };
}

/** A backend that answered for every pair it was asked about. */
export function measuredEverywhere(travel: ItemTravel = travelled()): TravelTable {
  return { between: () => travel };
}

/**
 * An ordered pair of candidate ids.
 *
 * Joined by an escaped NUL, which is `fixture-data.ts`'s trick and is here for
 * the same reason: nothing an id can contain is able to forge another pair's
 * key. Written as an escape rather than a literal so the file stays text.
 */
function key(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * A backend that answered for some pairs and not others — the case a real one
 * is in most of the time, and the one a plan has to be able to describe.
 *
 * What it says about the pairs it does not hold is the caller's to choose:
 * `not-established` by default, `OVER_BUDGET` for a run that stopped asking.
 */
export function measuredBetween(
  pairs: readonly (readonly [string, string, ItemTravel])[],
  otherwise: ItemTravel = NOT_ESTABLISHED,
): TravelTable {
  const known = new Map(pairs.map(([from, to, travel]) => [key(from, to), travel]));
  return { between: (from, to) => known.get(key(from.id, to.id)) ?? otherwise };
}

/** The revision fields `compose` needs told, since the package has no clock. */
export const REVISION = {
  id: "rev-1",
  reason: "The first draft.",
  createdAt: "2027-01-01T00:00:00.000Z",
};

/** A fixed "today", well before every fixture's departure. */
export const NOW = new Date("2027-01-01T12:00:00.000Z");

/** Every candidate id placed on a day, in day and position order. */
export function placedIds(
  days: readonly { items: readonly { candidateId: string }[] }[],
): string[] {
  return days.flatMap((day) => day.items.map((item) => item.candidateId));
}
