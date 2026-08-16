/**
 * Deriving "what was not checked" from a stored revision.
 *
 * The property that matters is **agreement**: the list a reader gets from a
 * plan out of the database has to be the list the composer produced, or the two
 * halves of the tool are telling a user different things about the same plan.
 * So every test here composes, then re-derives from the revision, and compares.
 *
 * The second property is that it reads **no clock**. That is what lets the API
 * derive it on read at all — see the header on `unchecked.ts`.
 */

import { describe, expect, test } from "vitest";
import { appendRevision, slot, type PlanDetail, type PlanRevision } from "@planner/contract";
import { compose } from "../src/compose.ts";
import { uncheckedForRevision } from "../src/unchecked.ts";
import { briefFor, candidate, detailsFor, NOW, REVISION } from "./helpers.ts";

/** The revision `compose` built, numbered the way the store would number it. */
function revisionOf(plan: PlanDetail): PlanRevision {
  const revision = plan.revisions.at(-1);
  if (revision === undefined) throw new Error("no revision was appended");
  return revision;
}

function planWith(
  brief: ReturnType<typeof briefFor>,
  candidates: Parameters<typeof compose>[0]["candidates"],
): { plan: PlanDetail; composed: ReturnType<typeof compose> } {
  const composed = compose({ brief, candidates, revision: REVISION, now: NOW });
  const base: PlanDetail = {
    id: "plan-1",
    title: "A trip",
    createdAt: REVISION.createdAt,
    updatedAt: REVISION.createdAt,
    latestRevision: 0,
    brief,
    candidates: [...candidates],
    revisions: [],
  };
  return { plan: appendRevision(base, composed.revision), composed };
}

describe("uncheckedForRevision", () => {
  test("matches what compose returned, for an ordinary road trip", () => {
    const brief = briefFor({});
    const candidates = [
      candidate({ specialist: "activities", durationMinutes: 90 }),
      candidate({ specialist: "route-and-logistics", durationMinutes: 120 }),
    ];

    const { plan, composed } = planWith(brief, candidates);

    expect(
      uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      }),
    ).toEqual(composed.unchecked);
  });

  /**
   * Travel time is on every plan in Phase 2 and is the entry this whole
   * mechanism exists for — `Place.coordinates` is null until grounding, so
   * nothing measured a distance.
   */
  test("always says travel time was not checked", () => {
    const brief = briefFor({});
    const { plan } = planWith(brief, [candidate({ specialist: "activities" })]);

    const kinds = uncheckedForRevision({
      brief,
      candidates: plan.candidates,
      revision: revisionOf(plan),
    }).map((constraint) => constraint.kind);

    expect(kinds).toContain("travel-time");
  });

  test("agrees with compose on a trip with no calendar at all", () => {
    // `open` dates are the case with no departure to count back from, and the
    // one branch in the derivation that turns on the kind of dates.
    const brief = briefFor({ dates: { kind: "open", nights: 3 } });
    const { plan, composed } = planWith(brief, [
      candidate({ specialist: "activities", durationMinutes: 60 }),
    ]);

    const derived = uncheckedForRevision({
      brief,
      candidates: plan.candidates,
      revision: revisionOf(plan),
    });

    expect(derived).toEqual(composed.unchecked);
    expect(derived.map((each) => each.kind)).toEqual(
      expect.arrayContaining(["season-no-calendar", "booking-no-departure"]),
    );
  });

  test("agrees on the per-candidate entries, which name the items they apply to", () => {
    const brief = briefFor({});
    // No season and no duration: both produce an entry carrying candidate ids,
    // which is the half a derivation could get wrong by naming the whole plan.
    const vague = candidate({ specialist: "activities", season: null, durationMinutes: null });
    const { plan, composed } = planWith(brief, [vague]);

    const derived = uncheckedForRevision({
      brief,
      candidates: plan.candidates,
      revision: revisionOf(plan),
    });

    expect(derived).toEqual(composed.unchecked);
    const seasonUnknown = derived.find((each) => each.kind === "season-unknown");
    expect(seasonUnknown?.candidateIds).toContain(vague.id);
  });

  test("agrees when the budget is a band and the costs are in two currencies", () => {
    const brief = briefFor({ budget: slot.answered({ kind: "band", band: "moderate" }) });
    const candidates = [
      candidate({
        specialist: "activities",
        durationMinutes: 60,
        cost: {
          currency: "EUR",
          low: 10,
          high: 20,
          basis: "per-person",
          provenance: { kind: "model-asserted" },
        },
      }),
      candidate({
        specialist: "food",
        durationMinutes: 60,
        cost: {
          currency: "CAD",
          low: 30,
          high: 50,
          basis: "per-person",
          provenance: { kind: "model-asserted" },
        },
      }),
    ];

    const { plan, composed } = planWith(brief, candidates);

    expect(
      uncheckedForRevision({ brief, candidates: plan.candidates, revision: revisionOf(plan) }),
    ).toEqual(composed.unchecked);
  });

  test("agrees on a backcountry trip, which has a distance constraint of its own", () => {
    const brief = briefFor({
      details: detailsFor("backcountry", {
        // `nightsOut` and `shelter` are the shape's required slots; the distance
        // is the one this test is actually about.
        nightsOut: slot.answered(2),
        shelter: slot.answered("tent"),
        maxDailyDistanceKm: slot.answered(18),
      }),
    });
    const { plan, composed } = planWith(brief, [
      candidate({ specialist: "activities", durationMinutes: 240 }),
    ]);

    const derived = uncheckedForRevision({
      brief,
      candidates: plan.candidates,
      revision: revisionOf(plan),
    });

    expect(derived).toEqual(composed.unchecked);
    expect(derived.map((each) => each.kind)).toContain("daily-distance");
  });

  /**
   * The claim that makes deriving-on-read honest rather than merely cheap: the
   * same stored plan gives the same answer whatever day it is read on. A
   * re-compose would not — a booking deadline that has since passed changes
   * what packs, and the list would drift with it.
   */
  test("does not depend on when it is read", () => {
    const brief = briefFor({});
    const { plan } = planWith(brief, [
      candidate({ specialist: "activities", durationMinutes: 60 }),
    ]);
    const revision = revisionOf(plan);

    const first = uncheckedForRevision({ brief, candidates: plan.candidates, revision });
    const second = uncheckedForRevision({ brief, candidates: plan.candidates, revision });

    expect(second).toEqual(first);
  });
});
