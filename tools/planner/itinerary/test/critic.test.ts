/**
 * The critic's two pl-43 changes, tested on the critic directly (step 2).
 *
 * Both are visible end to end only in part: a re-plan discards per-day findings
 * on frozen days and an edit refuses rather than dropping, so a `fixed` id named
 * as a day's drop candidate would never surface through either. The promise is
 * the critic's, so it is asserted here.
 */

import { describe, expect, test } from "vitest";
import {
  NOT_ESTABLISHED,
  slot,
  type Candidate,
  type CostEstimate,
  type ItemTravel,
} from "@planner/contract";
import { critique, type CriticFinding } from "../src/critic.ts";
import { ACTIVITY_MINUTES_PER_DAY, DRIVE_MINUTES_PER_DAY } from "../src/limits.ts";
import { BUCKET_OF, type PackedDay } from "../src/pack.ts";
import { briefFor, candidate, travelled } from "./helpers.ts";

/** One day holding these candidates in order, each with the transition given for it. */
function dayOf(
  entries: readonly { candidate: Candidate; travel?: ItemTravel | null; pinned?: boolean }[],
): PackedDay {
  return {
    dayIndex: 0,
    date: "2027-07-05",
    items: entries.map((entry, index) => ({
      candidateId: entry.candidate.id,
      bucket: BUCKET_OF[entry.candidate.specialist],
      pinned: entry.pinned ?? false,
      note: null,
      travelFromPrevious: entry.travel ?? (index === 0 ? null : NOT_ESTABLISHED),
    })),
  };
}

function kinds(findings: readonly CriticFinding[]): string[] {
  return findings.map((finding) => finding.kind);
}

function cad(low: number): CostEstimate {
  return {
    currency: "CAD",
    low,
    high: low,
    basis: "per-party",
    provenance: { kind: "model-asserted" },
  };
}

describe("transitions, counted as the packer charges them", () => {
  const half = ACTIVITY_MINUTES_PER_DAY.moderate / 2;

  test("a measured transition pushes a day over its effort budget", () => {
    const first = candidate({ specialist: "activities", durationMinutes: half });
    const second = candidate({ specialist: "activities", durationMinutes: half });
    const candidates = [first, second];
    const brief = briefFor({});

    // 150 + 150 is exactly 300, and 150 + 1 + 150 is not.
    const unmeasured = critique({
      brief,
      candidates,
      packed: { days: [dayOf([{ candidate: first }, { candidate: second }])] },
    });
    const measured = critique({
      brief,
      candidates,
      packed: {
        days: [
          dayOf([
            { candidate: first },
            { candidate: second, travel: travelled({ durationMinutes: 1 }) },
          ]),
        ],
      },
    });

    expect(kinds(unmeasured)).toEqual([]);
    expect(kinds(measured)).toEqual(["day-over-effort"]);
  });

  test("a drive's transition goes to the drive budget, and the anchor's to nothing", () => {
    const leg = candidate({
      specialist: "route-and-logistics",
      durationMinutes: DRIVE_MINUTES_PER_DAY["half-day"] - 10,
    });
    const hop = candidate({ specialist: "route-and-logistics", durationMinutes: 5 });
    const full = candidate({
      specialist: "activities",
      durationMinutes: ACTIVITY_MINUTES_PER_DAY.moderate,
    });
    const bed = candidate({ specialist: "lodging" });

    const findings = critique({
      brief: briefFor({}),
      candidates: [leg, hop, full, bed],
      packed: {
        days: [
          dayOf([
            { candidate: leg },
            // 290 + 10 + 5 is 305 of a half-day's 300, on the drive budget.
            { candidate: hop, travel: travelled({ durationMinutes: 10 }) },
            // A full day of activity. Getting to it was not established, so it
            // costs nothing and the activity budget is exactly full — a measured
            // minute here would go to the activity budget, because a transition
            // is charged to the item it arrives at.
            { candidate: full, travel: NOT_ESTABLISHED },
            // Two hundred minutes to the bed, charged to nothing.
            { candidate: bed, travel: travelled({ durationMinutes: 200 }) },
          ]),
        ],
      },
    });

    expect(kinds(findings)).toEqual(["day-over-drive"]);
  });
});

describe("fixed candidates", () => {
  test("are never named as the one to drop from a day", () => {
    const heavy = candidate({ specialist: "activities", durationMinutes: 200 });
    const light = candidate({ specialist: "activities", durationMinutes: 150 });
    const packed = { days: [dayOf([{ candidate: heavy }, { candidate: light }])] };
    const base = { brief: briefFor({}), candidates: [heavy, light], packed };

    const drop = (fixed?: ReadonlySet<string>) =>
      critique(fixed === undefined ? base : { ...base, fixed }).find(
        (finding) => finding.kind === "day-over-effort",
      )?.dropCandidateId;

    expect(drop()).toBe(heavy.id);
    expect(drop(new Set([heavy.id]))).toBe(light.id);
    expect(drop(new Set([heavy.id, light.id]))).toBeNull();
  });

  test("are never named as the one to drop for the budget", () => {
    const dear = candidate({ specialist: "lodging", cost: cad(600) });
    const cheaper = candidate({ specialist: "activities", durationMinutes: 60, cost: cad(500) });
    const packed = { days: [dayOf([{ candidate: cheaper }, { candidate: dear }])] };
    const base = {
      brief: briefFor({
        budget: slot.answered({ kind: "amount", currency: "CAD", amount: 1_000, basis: "total" }),
      }),
      candidates: [dear, cheaper],
      packed,
    };

    const drop = (fixed?: ReadonlySet<string>) =>
      critique(fixed === undefined ? base : { ...base, fixed }).find(
        (finding) => finding.kind === "over-budget",
      )?.dropCandidateId;

    expect(drop()).toBe(dear.id);
    expect(drop(new Set([dear.id]))).toBe(cheaper.id);
    expect(drop(new Set([dear.id, cheaper.id]))).toBeNull();
  });
});
