/**
 * The composer — a brief and a pile of candidates in, a plan revision out.
 *
 * The order is forced by what each stage needs, and every step of it is
 * deterministic:
 *
 * ```
 * missingRequiredSlots  ── not empty? BRIEF_INCOMPLETE, before any work
 *        │
 *        ▼
 * filterBySeason        ── §7's hard filter, before the composer sees anything
 *        │
 *        ▼
 *      pack ◄──────────┐  bounded rounds
 *        │             │
 *        ▼             │
 *     critique ────────┘  droppable findings go back
 *        │
 *        ▼
 *  hard finding left? PLAN_INFEASIBLE — a plan that violates one is not shipped
 *        │
 *        ▼
 *  NewRevision + the gaps it has + what was never checked
 * ```
 *
 * **It reads the brief and the candidates, and nothing else.** Not the answers,
 * not the tree, not a specialist's prompt. That is what makes it testable from
 * a checked-in fixture, and it is the same indirection that let the intake stop
 * being a model interview without anything downstream noticing.
 *
 * **No clock and no ids of its own.** `now`, the revision's id and its
 * timestamp are all arguments — a `Date.now()` here is a booking deadline that
 * changes answer at midnight, and a random id is a plan that cannot be
 * re-derived from its own inputs. Day and item ids are derived from the
 * revision's, which is unique per revision and is what `plan_days.id` and
 * `plan_items.id` require.
 */

import {
  AppError,
  isAnswered,
  missingRequiredSlots,
  type Candidate,
  type NewRevision,
  type PlanDay,
  type PlanGap,
  type PlanItem,
  type PlanRevision,
  type Specialist,
  type TripBrief,
} from "@planner/contract";
import { daysUntilDeparture, tripSpan } from "./dates.ts";
import { filterBySeason } from "./season.ts";
import { BUCKET_OF, dayCapacity, pack, type PackResult, type PinnedPlacement } from "./pack.ts";
import { critique, isHard, type CriticFinding } from "./critic.ts";
import { MAX_CRITIC_ROUNDS } from "./limits.ts";
import { unchecked, type UncheckedConstraint } from "./unchecked.ts";

export interface ComposeInput {
  brief: TripBrief;
  /** Everything the fan-out proposed, placed or not. */
  candidates: readonly Candidate[];
  /**
   * The draft this one is derived from, when this is a re-plan. Its pinned
   * items keep their day, and the packer works around them (§6).
   */
  previous?: PlanRevision | null;
  /**
   * The gaps the orchestrator already knows about — a specialist that failed,
   * was dropped for budget, or was never on the roster. The composer cannot
   * tell those apart from silence, so it is told rather than guessing, and it
   * adds only the gaps it can see for itself.
   */
  gaps?: readonly PlanGap[];
  /** Identity and timestamp for the revision to build. This package has no clock. */
  revision: { id: string; reason: string; createdAt: string };
  /** Today. Booking lead times are counted back from the departure to here. */
  now: Date;
  maxCriticRounds?: number;
}

export interface ComposeResult {
  /** Ready for `appendRevision`, which derives the number and the parent. */
  revision: NewRevision;
  /**
   * Constraints the composer could not evaluate, and why. Never empty in
   * Phase 2 — travel time is always on it. See `unchecked.ts`.
   */
  unchecked: UncheckedConstraint[];
  /** Findings that ship with the plan: an empty day, and anything else soft. */
  findings: CriticFinding[];
  /** Candidates that reached the composer and were not placed, with the reason. */
  excluded: PackResult["excluded"];
}

/** Where a previous revision put each pinned item — the packer's fixed points. */
export function pinnedPlacements(revision: PlanRevision): PinnedPlacement[] {
  return revision.days.flatMap((day) =>
    day.items
      .filter((item) => item.pinned)
      .map((item) => ({
        candidateId: item.candidateId,
        dayIndex: day.dayIndex,
        position: item.position,
      })),
  );
}

/**
 * Build a revision from a brief and a candidate set.
 *
 * Throws `BRIEF_INCOMPLETE` when the brief is too thin to draft from, and
 * `PLAN_INFEASIBLE` when nothing can satisfy the constraints — the two are
 * deliberately different: the first is answered by going back to the wizard,
 * the second by relaxing something. A plan that merely has holes in it is
 * neither; it ships, with the holes named.
 */
export function compose(input: ComposeInput): ComposeResult {
  const { brief, now } = input;

  const missing = missingRequiredSlots(brief);
  if (missing.length > 0) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing } });
  }

  // `dates` is required, so `missingRequiredSlots` has already refused a brief
  // without one — but a declined slot passes that check, and a trip with no
  // dates at all has no days to pack. That is a brief that cannot be drafted
  // from, and it is the same sentence to the user.
  if (!isAnswered(brief.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }
  const dates = brief.dates.value;

  const span = tripSpan(dates);
  const pinned =
    input.previous === null || input.previous === undefined ? [] : pinnedPlacements(input.previous);

  const season = filterBySeason(input.candidates, dates);

  // A pinned candidate is the user's decision and outranks the season filter:
  // they may know something the window does not say, and a re-plan that
  // silently deleted a pin would be the worst possible answer to a pin.
  const pinnedIds = new Set(pinned.map((placement) => placement.candidateId));
  const droppedByFilter = season.outOfSeason.filter((id) => !pinnedIds.has(id));
  const forPacking = input.candidates.filter(
    (candidate) => !season.outOfSeason.includes(candidate.id) || pinnedIds.has(candidate.id),
  );

  const untilDeparture = daysUntilDeparture(dates, now);
  const rounds = input.maxCriticRounds ?? MAX_CRITIC_ROUNDS;

  const dropped = new Set<string>();
  let packed = pack({
    brief,
    candidates: forPacking,
    span,
    daysUntilDeparture: untilDeparture,
    pinned,
  });
  let findings = critique({ brief, candidates: forPacking, packed });

  for (let round = 0; round < rounds; round += 1) {
    const actionable = findings
      .filter((finding) => finding.dropCandidateId !== null)
      .map((finding) => finding.dropCandidateId ?? "")
      .filter((id) => !dropped.has(id));

    if (actionable.length === 0) break;

    for (const id of actionable) dropped.add(id);
    packed = pack({
      brief,
      candidates: forPacking,
      span,
      daysUntilDeparture: untilDeparture,
      pinned,
      excluded: dropped,
    });
    findings = critique({ brief, candidates: forPacking, packed });
  }

  const hard = findings.filter(isHard);
  if (hard.length > 0) {
    throw new AppError("PLAN_INFEASIBLE", undefined, {
      details: {
        findings: hard.map((finding) => ({
          kind: finding.kind,
          dayIndex: finding.dayIndex,
          detail: finding.detail,
        })),
      },
    });
  }

  const excluded = [
    ...packed.excluded,
    ...droppedByFilter.map((candidateId) => ({ candidateId, reason: "out-of-season" as const })),
  ];

  return {
    revision: {
      id: input.revision.id,
      reason: input.revision.reason,
      createdAt: input.revision.createdAt,
      days: toPlanDays(packed, input.revision.id),
      gaps: [...(input.gaps ?? []), ...gapsFor(input.candidates, packed)],
    },
    unchecked: uncheckedFor({ brief, dates, span, packed, season, untilDeparture }),
    findings: findings.filter((finding) => !isHard(finding)),
    excluded,
  };
}

/**
 * Ids are derived rather than generated: `plan_days.id` and `plan_items.id` are
 * global primary keys, and a revision's id is already unique, so
 * `<revision>-day-3` cannot collide across revisions and stays the same if the
 * same inputs are composed twice. An item is keyed by its candidate rather than
 * by its position, so an item that moved between revisions is recognisably the
 * same thing — which is what makes the diff in §6 a diff.
 */
function toPlanDays(packed: PackResult, revisionId: string): PlanDay[] {
  return packed.days.map((day) => ({
    id: `${revisionId}-day-${day.dayIndex}`,
    dayIndex: day.dayIndex,
    date: day.date,
    items: day.items.map((item, position): PlanItem => ({
      id: `${revisionId}-item-${item.candidateId}`,
      candidateId: item.candidateId,
      position,
      // Always null in Phase 2: a wall-clock start is a claim that something
      // outside the plan fixes it, and without opening hours there is
      // nothing that could.
      startsAt: null,
      pinned: item.pinned,
      note: item.note,
    })),
  }));
}

/**
 * The gaps the composer can see for itself.
 *
 * Only for a specialist that actually returned candidates and got none of them
 * onto a day: that is `no-candidates-found`'s exact meaning — it ran, and what
 * came back was not usable. A specialist absent from the candidate set is not
 * the composer's to explain, because it cannot tell "never on the roster" from
 * "failed", and the orchestrator passes those in.
 */
function gapsFor(candidates: readonly Candidate[], packed: PackResult): PlanGap[] {
  const placedIds = new Set(
    packed.days.flatMap((day) => day.items.map((item) => item.candidateId)),
  );
  const byReason = new Map(packed.excluded.map((entry) => [entry.candidateId, entry.reason]));

  const proposed = new Map<Specialist, Candidate[]>();
  for (const candidate of candidates) {
    if (BUCKET_OF[candidate.specialist] === "unscheduled") continue;
    const list = proposed.get(candidate.specialist) ?? [];
    list.push(candidate);
    proposed.set(candidate.specialist, list);
  }

  const gaps: PlanGap[] = [];
  for (const [specialist, theirs] of proposed) {
    if (theirs.some((candidate) => placedIds.has(candidate.id))) continue;

    const reasons = new Set(theirs.map((candidate) => byReason.get(candidate.id)));
    const why = reasons.has("booking-deadline-passed")
      ? "everything it found had to be booked further ahead than there is time for"
      : reasons.has("out-of-season") || reasons.has("no-day-in-season")
        ? "everything it found is out of season for these dates"
        : "nothing it found fitted the days this trip has";

    gaps.push({
      specialist,
      reason: "no-candidates-found",
      detail: `Nothing from this part of the plan made it onto a day: ${why}.`,
    });
  }

  return gaps;
}

/** Everything this composer did not check, assembled once, on every plan. */
function uncheckedFor(context: {
  brief: TripBrief;
  dates: NonNullable<Extract<TripBrief["dates"], { state: "answered" }>["value"]>;
  span: ReturnType<typeof tripSpan>;
  packed: PackResult;
  season: ReturnType<typeof filterBySeason>;
  untilDeparture: number | null;
}): UncheckedConstraint[] {
  const { brief, dates, span, packed, season, untilDeparture } = context;
  const notes: UncheckedConstraint[] = [
    // Always, and first. Phase 2 has no coordinates, so no leg between two
    // items was measured — decided 2026-08-16, roadmap _Still open_.
    unchecked(
      "travel-time",
      "How long it takes to get from one of these to the next was not checked. Nothing here measured a distance.",
    ),
    unchecked(
      "opening-hours",
      "Whether these places are open on the days they were put on was not checked.",
    ),
  ];

  if (isAnswered(brief.dealBreakers) && brief.dealBreakers.value.length > 0) {
    notes.push(
      unchecked(
        "deal-breakers",
        "The things you said would rule a trip out were passed to the people proposing it, but nothing here could check the plan against them.",
      ),
    );
  }

  const details = brief.details;
  if (details?.shape === "backcountry" && isAnswered(details.maxDailyDistanceKm)) {
    notes.push(
      unchecked(
        "daily-distance",
        "How far each day actually goes was not checked — see travel time.",
      ),
    );
  }
  if (details?.shape === "motorised-touring" && isAnswered(details.rangeKm)) {
    notes.push(
      unchecked(
        "machine-range",
        "Whether each day stays inside your range was not checked — see travel time.",
      ),
    );
  }

  if (dayCapacity(brief).effortAssumed) {
    notes.push(
      unchecked(
        "effort-assumed",
        "You did not say how full you like a day, so these are ordinary ones.",
      ),
    );
  }

  if (dates.kind === "open") {
    notes.push(
      unchecked(
        "season-no-calendar",
        "There are no dates yet, so nothing was checked against a season.",
      ),
    );
    notes.push(
      unchecked(
        "booking-no-departure",
        "There are no dates yet, so no booking deadline could be checked.",
      ),
    );
  } else if (untilDeparture === null) {
    notes.push(unchecked("booking-no-departure", "No booking deadline could be checked."));
  }

  const placedIds = new Set(
    packed.days.flatMap((day) => day.items.map((item) => item.candidateId)),
  );
  const seasonUnknown = season.seasonUnknown.filter((id) => placedIds.has(id));
  if (seasonUnknown.length > 0) {
    notes.push(
      unchecked(
        "season-unknown",
        "Nobody established when these are open, so they were left in.",
        seasonUnknown,
      ),
    );
  }

  const durationUnknown = packed.durationUnknown.filter((id) => placedIds.has(id));
  if (durationUnknown.length > 0) {
    notes.push(
      unchecked(
        "duration-unknown",
        "How long these take was never established, so they were not counted against the day.",
        durationUnknown,
      ),
    );
  }

  if (isAnswered(brief.budget) && brief.budget.value.kind === "band") {
    notes.push(
      unchecked(
        "budget-band",
        "You gave a feel for the budget rather than a figure, so nothing was summed against it.",
      ),
    );
  }

  const currencies = new Set(
    [...placedIds]
      .map((id) => season.kept.find((candidate) => candidate.id === id)?.cost?.currency)
      .filter((currency): currency is string => currency !== undefined),
  );
  if (currencies.size > 1) {
    notes.push(
      unchecked(
        "budget-currency",
        `Costs came back in ${[...currencies].toSorted().join(" and ")}, and nothing here converts between them, so the total was not summed.`,
      ),
    );
  }

  if (span.truncated) {
    notes.push(
      unchecked(
        "trip-truncated",
        "This trip is longer than a plan can hold, so the last days are not here.",
      ),
    );
  }

  return notes;
}
