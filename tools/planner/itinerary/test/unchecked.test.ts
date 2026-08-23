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
import {
  appendRevision,
  measuredOrNull,
  OVER_BUDGET,
  slot,
  TRIP_SHAPES,
  uncheckedConstraintKey,
  type Candidate,
  type PlanDetail,
  type PlanRevision,
} from "@planner/contract";
import { loadFixture } from "../../contract/test/fixtures.ts";
import { compose } from "../src/compose.ts";
import { NOTHING_MEASURED } from "../src/travel.ts";
import { uncheckedForRevision } from "../src/unchecked.ts";
import {
  briefFor,
  candidate,
  detailsFor,
  measuredBetween,
  measuredEverywhere,
  NOW,
  REVISION,
  travelled,
} from "./helpers.ts";

/**
 * A trip of one day, so the packer has nowhere to spread three things to.
 *
 * A transition is a pair of items on **one** day, which is exactly what the
 * packer charges for — spread over four days there would be nothing to measure
 * and the cases below would pass vacuously.
 */
const ONE_DAY = { kind: "exact", departure: "2027-07-05", return: "2027-07-05" } as const;

/** Three things that fit one day together, in a known order. */
function threeThings(): Candidate[] {
  return [
    candidate({ specialist: "activities", durationMinutes: 60 }),
    candidate({ specialist: "activities", durationMinutes: 60 }),
    candidate({ specialist: "activities", durationMinutes: 60 }),
  ];
}

/** The revision `compose` built, numbered the way the store would number it. */
function revisionOf(plan: PlanDetail): PlanRevision {
  const revision = plan.revisions.at(-1);
  if (revision === undefined) throw new Error("no revision was appended");
  return revision;
}

function planWith(
  brief: ReturnType<typeof briefFor>,
  candidates: Parameters<typeof compose>[0]["candidates"],
  travel: Parameters<typeof compose>[0]["travel"] = NOTHING_MEASURED,
): { plan: PlanDetail; composed: ReturnType<typeof compose> } {
  const composed = compose({ brief, candidates, travel, revision: REVISION, now: NOW });
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

/**
 * Every entry a plan emits is a distinct entry, on real input.
 *
 * `UncheckedConstraint` has no id, and until pl-27 its `kind` served as one —
 * a list held at most one entry per kind, so the plan view keyed its `<li>` by
 * it and that was safe. Making `travel-time` repeat broke that from a package
 * nobody opened. Composing the six checked-in sets, the old key collided on
 * **three** of them.
 *
 * So this asserts the property the renderer depends on, over the entries the
 * composer actually produces rather than a hand-built list — which is the half
 * a `web` test cannot cover, because the lists it builds are the ones its
 * author thought of. It runs against every checked-in fixture and against a
 * plan carrying each of the three `travel-time` sentences at once.
 */
describe("every entry in a list is a distinct entry", () => {
  test.each(TRIP_SHAPES)("on the %s fixture", (shape) => {
    const fixture = loadFixture(shape);
    const composed = compose({
      brief: fixture.brief,
      candidates: fixture.candidates,
      travel: NOTHING_MEASURED,
      revision: REVISION,
      now: NOW,
    });

    const keys = composed.unchecked.map(uncheckedConstraintKey);
    expect(keys).toHaveLength(new Set(keys).size);
    // And the property that used to hold and no longer does, so the reason this
    // test exists is visible in the test itself rather than only in its name.
    expect(composed.unchecked.length).toBeGreaterThan(
      new Set(composed.unchecked.map((each) => each.kind)).size - 1,
    );
  });

  test("on a plan carrying all three travel-time sentences at once", () => {
    // Three days: two things on day 0 measured, two on day 1 where one is
    // refused and one is unknown, so the list holds the named entry, the
    // over-budget entry and the overnight entry together.
    const brief = briefFor({
      dates: { kind: "exact", departure: "2027-07-05", return: "2027-07-07" },
    });
    const things = Array.from({ length: 6 }, () =>
      candidate({ specialist: "activities", durationMinutes: 60 }),
    );
    const [a, b, c, d] = things;
    if (a === undefined || b === undefined || c === undefined || d === undefined) {
      throw new Error("six candidates");
    }
    const travel = measuredBetween([
      [a.id, b.id, travelled({ durationMinutes: 5 })],
      [c.id, d.id, OVER_BUDGET],
    ]);

    const composed = compose({
      brief,
      candidates: things,
      travel,
      revision: REVISION,
      now: NOW,
    });

    const travelTime = composed.unchecked.filter((each) => each.kind === "travel-time");
    expect(travelTime.length).toBeGreaterThan(1);

    const keys = composed.unchecked.map(uncheckedConstraintKey);
    expect(keys).toHaveLength(new Set(keys).size);
    // Keying by kind is exactly what the plan view did, and exactly what
    // collides. Stated as the counterfactual so the assertion above cannot be
    // mistaken for something that was always true.
    const byKind = composed.unchecked.map((each) => each.kind);
    expect(byKind.length).toBeGreaterThan(new Set(byKind).size);
  });
});

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
   * Travel time when nothing measured anything — every plan until pl-27, and
   * still every plan on a deployment with no grounding backend.
   */
  test("says travel time was not checked when nothing measured a distance", () => {
    const brief = briefFor({});
    const { plan } = planWith(brief, [candidate({ specialist: "activities" })]);

    const kinds = uncheckedForRevision({
      brief,
      candidates: plan.candidates,
      revision: revisionOf(plan),
    }).map((constraint) => constraint.kind);

    expect(kinds).toContain("travel-time");
  });

  /**
   * The cases pl-27 exists for, on one plan each: everything measured, some of
   * it measured, none of it, and the one pl-25's budget adds — never asked.
   */
  describe("travel time, once something can measure it", () => {
    test("omits it when every transition on the plan was measured", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const things = threeThings();
      const { plan, composed } = planWith(brief, things, measuredEverywhere());

      // The premise: all three landed on the one day, so there are transitions
      // to have measured. Without this the test would pass vacuously.
      expect(plan.revisions.at(-1)?.days[0]?.items).toHaveLength(3);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      expect(derived.map((each) => each.kind)).not.toContain("travel-time");
    });

    test("names the candidates it could not measure the trip to, when only some answered", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const [first, second, third] = threeThings();
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("three candidates");
      }
      // A backend that knows one leg and not the other — the ordinary state of
      // a real one, and the state a plan has to be able to describe.
      const travel = measuredBetween([[first.id, second.id, travelled()]]);
      const { plan, composed } = planWith(brief, [first, second, third], travel);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      const entry = derived.find((each) => each.kind === "travel-time");
      expect(entry?.candidateIds).toEqual([third.id]);
    });

    test("still says it plan-wide when nothing was measured", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const { plan, composed } = planWith(brief, threeThings(), NOTHING_MEASURED);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      const entry = derived.find((each) => each.kind === "travel-time");
      expect(entry?.candidateIds).toEqual([]);
      expect(entry?.detail).toContain("Nothing here measured a distance");
    });

    /**
     * The hop nothing measures, named rather than passed over in silence.
     *
     * Within-day pairs are all this pass measures, so on a plan whose days are
     * each fully measured the branches above fall quiet — and on a list whose
     * only job is naming what went unchecked, quiet is a claim. The overnight
     * entry is what stops it being made.
     */
    test("still names the overnight hops when every within-day pair was measured", () => {
      // Two days, two things each, so there are within-day pairs *and* a hop
      // between the days.
      const brief = briefFor({
        dates: { kind: "exact", departure: "2027-07-05", return: "2027-07-06" },
      });
      const things = Array.from({ length: 4 }, () =>
        candidate({ specialist: "activities", durationMinutes: 60 }),
      );
      const { plan, composed } = planWith(brief, things, measuredEverywhere());
      const days = plan.revisions.at(-1)?.days ?? [];
      expect(days[0]?.items).toHaveLength(2);
      expect(days[1]?.items).toHaveLength(2);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      const entries = derived.filter((each) => each.kind === "travel-time");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.detail).toContain("end of one day to the start of the next");
      // Exactly the item nothing looked at: the first thing on the second day.
      expect(entries[0]?.candidateIds).toEqual([days[1]?.items[0]?.candidateId]);
    });

    test("has no overnight hop to name on a trip of one day", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const { plan } = planWith(brief, threeThings(), measuredEverywhere());

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived.map((each) => each.kind)).not.toContain("travel-time");
    });

    /**
     * The distinction pl-25's budget makes necessary: a run that stopped asking
     * is not a world nobody has mapped. They are two sentences and they get two
     * entries, because collapsing them would tell a reader that nothing knows a
     * road nobody ever looked up.
     */
    test("says so separately when a transition was never looked up for want of budget", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const [first, second, third] = threeThings();
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("three candidates");
      }
      const travel = measuredBetween([[first.id, second.id, travelled()]], OVER_BUDGET);
      const { plan, composed } = planWith(brief, [first, second, third], travel);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      const entries = derived.filter((each) => each.kind === "travel-time");
      expect(entries).toHaveLength(1);
      expect(entries[0]?.candidateIds).toEqual([third.id]);
      expect(entries[0]?.detail).toContain("number of lookups it is allowed");
    });

    test("keeps the two apart when a plan has one of each", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const [first, second, third] = threeThings();
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("three candidates");
      }
      // Second is asked and unknown; third was never asked.
      const travel = measuredBetween([[second.id, third.id, OVER_BUDGET]]);
      const { plan, composed } = planWith(brief, [first, second, third], travel);

      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });

      expect(derived).toEqual(composed.unchecked);
      const entries = derived.filter((each) => each.kind === "travel-time");
      expect(entries.map((each) => each.candidateIds)).toEqual([[second.id], [third.id]]);
    });

    /**
     * The bed **is** a transition, and the list speaks for it.
     *
     * This case was called "does not ask for a measurement of the trip to the
     * day's bed" and asserted nothing of the kind — it passed because
     * `NOTHING_MEASURED` takes the plan-wide branch whatever the items are.
     * `transitionsOf` filters on position alone, so an anchor after another
     * item is a transition like any other: getting to where you sleep is real
     * travel and the plan says what it knows about it. What the anchor is not
     * is *charged* — pl-9's rule is about what the day fits around, and
     * `transitionTo` carries that argument.
     */
    test("speaks for the trip to the day's bed, which is travel like any other", () => {
      const brief = briefFor({ dates: ONE_DAY });
      const doing = candidate({ specialist: "activities", durationMinutes: 60 });
      const bed = candidate({ specialist: "lodging" });
      const { plan } = planWith(brief, [doing, bed], NOTHING_MEASURED);

      expect(plan.revisions.at(-1)?.days[0]?.items).toEqual([
        expect.objectContaining({ candidateId: doing.id }),
        expect.objectContaining({ candidateId: bed.id }),
      ]);

      // Measured, the bed's arrival is what the plan records — and it is the
      // day's only pair, so measuring it is enough to take `travel-time` off a
      // one-day plan entirely.
      const measured = planWith(brief, [doing, bed], measuredEverywhere());
      expect(
        measuredOrNull(
          measured.plan.revisions.at(-1)?.days[0]?.items[1]?.travelFromPrevious ?? null,
        ),
      ).not.toBeNull();
      expect(
        uncheckedForRevision({
          brief,
          candidates: measured.plan.candidates,
          revision: revisionOf(measured.plan),
        }).map((each) => each.kind),
      ).not.toContain("travel-time");

      // Unmeasured, it is named — plan-wide here, because the bed's arrival is
      // the only pair there was.
      const derived = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      });
      expect(derived.find((each) => each.kind === "travel-time")?.candidateIds).toEqual([]);
    });

    /**
     * The two constraints pl-9 blamed on the same missing distance, and the
     * written decision in pl-27's log: a *driving* matrix does not measure how
     * far a party walks, so these stay named however much came back.
     */
    test("keeps naming daily distance, because a driving matrix is not a walking one", () => {
      const brief = briefFor({
        dates: ONE_DAY,
        details: detailsFor("backcountry", {
          nightsOut: slot.answered(2),
          shelter: slot.answered("tent"),
          maxDailyDistanceKm: slot.answered(18),
        }),
      });
      const { plan } = planWith(brief, threeThings(), measuredEverywhere());

      const kinds = uncheckedForRevision({
        brief,
        candidates: plan.candidates,
        revision: revisionOf(plan),
      }).map((each) => each.kind);

      expect(kinds).not.toContain("travel-time");
      expect(kinds).toContain("daily-distance");
    });
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
