/**
 * The critic — an adversarial pass over a packed plan.
 *
 * The packer already refuses to place a candidate that would break a day, so a
 * naive reading is that this can never find anything. It finds three things,
 * and each is a real failure mode rather than a belt-and-braces re-check:
 *
 * 1. **Pins.** A pinned item is the user's decision and bypasses every fit
 *    check, so three pinned hikes on one Tuesday produce a day that violates
 *    the party's own effort answer. That is exactly the case where the plan
 *    must not ship quietly. Since pl-43 the same is true of an **edit**, which
 *    never goes through `fits` at all, and of a **re-plan** that makes two pins
 *    adjacent and measures the new hop between them — which is why the minutes
 *    counted below include each item's transition, exactly as `charge` in
 *    `pack.ts` counts them.
 * 2. **Totals.** Budget is a property of the whole plan and not of a day, so
 *    nothing during packing could have caught it.
 * 3. **Emptiness.** A day with nothing on it, and a plan with nothing on it at
 *    all, are both invisible to a packer that only ever asks "does this fit".
 *
 * ## Findings feed back, in bounded rounds
 *
 * A finding that names something droppable goes back to the packer, which
 * re-packs without it — `MAX_CRITIC_ROUNDS` times, and then the plan ships with
 * whatever is left named. Unbounded, the critic and the packer argue on the
 * clock; the architecture fixes the bound at two and `api` makes it
 * configuration.
 *
 * ## Hard findings are not shippable
 *
 * §7: a plan that violates a hard constraint is not shipped. So a hard finding
 * that survives the rounds is `PLAN_INFEASIBLE` and not a note on a plan — that
 * distinction is the promise the code makes about what it checked, and it is
 * why `PLAN_INFEASIBLE` and `PlanGap` are different mechanisms. A soft finding
 * ships with the plan and is rendered beside it.
 */

import { isAnswered, MAX_ITEMS_PER_DAY } from "@planner/contract";
import type { Candidate, TripBrief } from "@planner/contract";
import { budgetCeiling, isOverBudget, partySize, totalCost } from "./cost.ts";
import { dayCapacity, type PackedDay, type PackResult } from "./pack.ts";
import { transitionMinutes } from "./travel.ts";

export const CRITIC_FINDINGS = [
  /** The day's drives exceed the party's own drive appetite. Only a pin or an edit can cause it. */
  "day-over-drive",
  /** The day's activities exceed the party's own effort appetite. Only a pin or an edit can cause it. */
  "day-over-effort",
  /** More items on one day than the contract allows. Only a pin or an edit can cause it. */
  "day-over-items",
  /** The cheapest reading of the plan still costs more than the party said. */
  "over-budget",
  /** A day with nothing on it. Honest, and worth saying out loud. */
  "empty-day",
  /** Nothing was placed anywhere. There is no plan here to ship. */
  "nothing-placed",
] as const;

export type CriticFindingKind = (typeof CRITIC_FINDINGS)[number];

/** The findings a plan may not ship with. Everything else is rendered beside it. */
const HARD: ReadonlySet<CriticFindingKind> = new Set<CriticFindingKind>([
  "day-over-drive",
  "day-over-effort",
  "day-over-items",
  "over-budget",
  "nothing-placed",
]);

export function isHard(finding: CriticFinding): boolean {
  return HARD.has(finding.kind);
}

export interface CriticFinding {
  kind: CriticFindingKind;
  /** `null` for a finding about the whole plan rather than about one day. */
  dayIndex: number | null;
  /** For a reader of the plan, in their terms — the bar `PlanGap.detail` sets. */
  detail: string;
  /**
   * The candidate whose removal would relieve this, or `null` when nothing
   * would. A pinned item is never named here: the user pinned it, and dropping
   * it to make the arithmetic work would be overruling them silently. Nor is a
   * `fixed` one (see `CritiqueInput.fixed`).
   */
  dropCandidateId: string | null;
}

export interface CritiqueInput {
  brief: TripBrief;
  candidates: readonly Candidate[];
  /** Only the days are read, so an edit — which has days and no pack — is judged the same way. */
  packed: Pick<PackResult, "days">;
  /**
   * Candidate ids the critic may never name as `dropCandidateId`, beside pinned
   * items (pl-43). A re-plan passes every id on a frozen day; an edit passes
   * every id, since an edit drops nothing. Absent means none.
   */
  fixed?: ReadonlySet<string>;
}

/** Every placed item, with the candidate behind it, in day and position order. */
function placed(
  days: readonly PackedDay[],
  byId: ReadonlyMap<string, Candidate>,
): { day: PackedDay; candidate: Candidate; pinned: boolean }[] {
  return days.flatMap((day) =>
    day.items.flatMap((item) => {
      const candidate = byId.get(item.candidateId);
      return candidate === undefined ? [] : [{ day, candidate, pinned: item.pinned }];
    }),
  );
}

/** The unpinned, unfixed candidate on this day with the longest stated duration. */
function heaviestOn(
  day: PackedDay,
  byId: ReadonlyMap<string, Candidate>,
  fixed: ReadonlySet<string>,
  bucket: "drive" | "activity",
): string | null {
  let chosen: { id: string; minutes: number } | null = null;
  for (const item of day.items) {
    if (item.pinned || fixed.has(item.candidateId) || item.bucket !== bucket) continue;
    const minutes = byId.get(item.candidateId)?.durationMinutes ?? 0;
    if (chosen === null || minutes > chosen.minutes) chosen = { id: item.candidateId, minutes };
  }
  return chosen?.id ?? null;
}

export function critique(input: CritiqueInput): CriticFinding[] {
  const { brief, packed } = input;
  const fixed = input.fixed ?? new Set<string>();
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const capacity = dayCapacity(brief);
  const findings: CriticFinding[] = [];

  const items = placed(packed.days, byId);
  if (items.length === 0) {
    findings.push({
      kind: "nothing-placed",
      dayIndex: null,
      detail: "Nothing could be placed on any day of this trip.",
      dropCandidateId: null,
    });
  }

  for (const day of packed.days) {
    if (day.items.length === 0) {
      findings.push({
        kind: "empty-day",
        dayIndex: day.dayIndex,
        detail: "Nothing was found for this day.",
        dropCandidateId: null,
      });
      continue;
    }

    if (day.items.length > MAX_ITEMS_PER_DAY) {
      findings.push({
        kind: "day-over-items",
        dayIndex: day.dayIndex,
        detail: `This day holds ${day.items.length} things, which is more than one day can.`,
        dropCandidateId:
          heaviestOn(day, byId, fixed, "activity") ?? heaviestOn(day, byId, fixed, "drive"),
      });
    }

    let driveMinutes = 0;
    let activityMinutes = 0;
    for (const item of day.items) {
      // Exactly what `charge` in `pack.ts` charges: the item's own duration
      // plus getting to it, to a drive's budget where the shape has one, to the
      // activity budget otherwise, and nowhere for an anchor. A second reading
      // of which transitions cost minutes is how the two would drift apart.
      const minutes =
        (byId.get(item.candidateId)?.durationMinutes ?? 0) +
        transitionMinutes(item.travelFromPrevious);
      if (item.bucket === "drive" && capacity.driveMinutes !== null) driveMinutes += minutes;
      else if (item.bucket !== "anchor") activityMinutes += minutes;
    }

    if (capacity.driveMinutes !== null && driveMinutes > capacity.driveMinutes) {
      findings.push({
        kind: "day-over-drive",
        dayIndex: day.dayIndex,
        detail: `This day has ${Math.round(driveMinutes / 60)} hours of driving, and the trip was planned for at most ${Math.round(capacity.driveMinutes / 60)}.`,
        dropCandidateId: heaviestOn(day, byId, fixed, "drive"),
      });
    }

    if (activityMinutes > capacity.activityMinutes) {
      findings.push({
        kind: "day-over-effort",
        dayIndex: day.dayIndex,
        detail: `This day holds ${Math.round(activityMinutes / 60)} hours of activity, and the party asked for days of about ${Math.round(capacity.activityMinutes / 60)}.`,
        dropCandidateId: heaviestOn(day, byId, fixed, "activity"),
      });
    }
  }

  const size = partySize(brief);
  const total = totalCost(
    items.map(({ candidate }) => ({ id: candidate.id, cost: candidate.cost })),
    size,
  );
  const ceiling = isAnswered(brief.budget)
    ? budgetCeiling(brief.budget.value, size, packed.days.length)
    : null;

  if (isOverBudget(total.band, ceiling) && total.band !== null && ceiling !== null) {
    // The most expensive unpinned, unfixed line, wherever it is. Dropping the
    // cheapest would take more rounds than the budget allows and would remove
    // more of the plan to save the same money.
    let dearest: { id: string; amount: number } | null = null;
    for (const { candidate, pinned } of items) {
      if (pinned || fixed.has(candidate.id) || candidate.cost === null) continue;
      const amount = candidate.cost.low * (candidate.cost.basis === "per-person" ? size : 1);
      if (dearest === null || amount > dearest.amount) dearest = { id: candidate.id, amount };
    }

    findings.push({
      kind: "over-budget",
      dayIndex: null,
      detail: `Even at its cheapest this plan comes to ${total.band.low} ${total.band.currency}, and the budget for the trip is ${ceiling.high} ${ceiling.currency}.`,
      dropCandidateId: dearest?.id ?? null,
    });
  }

  return findings;
}
