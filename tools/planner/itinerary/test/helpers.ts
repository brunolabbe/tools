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
  slot,
  type Candidate,
  type Specialist,
  type TripBrief,
  type TripDates,
  type TripShapeDetails,
} from "@planner/contract";

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
