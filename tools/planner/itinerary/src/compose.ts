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
  type Source,
  type Specialist,
  type TripBrief,
} from "@planner/contract";
import { daysUntilDeparture, tripSpan } from "./dates.ts";
import { filterBySeason } from "./season.ts";
import { BUCKET_OF, pack, type PackResult, type PinnedPlacement } from "./pack.ts";
import { critique, isHard, type CriticFinding } from "./critic.ts";
import { MAX_CRITIC_ROUNDS } from "./limits.ts";
import type { TravelTable } from "./travel.ts";
import { uncheckedFor, type UncheckedConstraint } from "./unchecked.ts";

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
  /**
   * What a corridor discovery pass already decided was too thin to say much
   * about, before this composer ever saw a candidate (pl-29).
   *
   * Unlike `gaps`, this is not folded through a function of *this call's*
   * inputs — `uncheckedFor` cannot derive it, because it is not a statement
   * about the brief, the candidates or the days; it is a statement about a
   * live backend's answer to a corridor query that ran once, upstream. So it
   * is carried straight onto the revision (`NewRevision.coverage`) and appended
   * to the returned `unchecked` list untouched, the same way `gaps` rides
   * through unexamined. Defaults to empty, which is the correct answer for
   * every trip with no corridor to discover along and for the fixture default,
   * which discovers nothing.
   */
  coverage?: readonly UncheckedConstraint[];
  /**
   * Editorial context about the route itself, carried straight onto the
   * revision (`NewRevision.reading`) — pl-33.
   *
   * Unlike `coverage` it is *not* appended to `unchecked`: it is not a gap and
   * not a caveat, it is something worth reading. It rides through this
   * function untouched for the same reason `coverage` does — it is evidence a
   * live backend produced once, and nothing here can derive it a second time.
   */
  reading?: readonly Source[];
  /**
   * What the grounding pass measured between these candidates (pl-27).
   *
   * **Required**, the way `TripCapacity` is required by `runFanOut` and for the
   * same reason: a caller that forgot it would pack a plan under nothing and
   * nothing would say so. A run with no grounding passes `NOTHING_MEASURED`,
   * which packs exactly the days this composer packed before pl-27 — and that
   * identity is what makes the change additive rather than a re-tuning.
   *
   * The pass that fills it lives in `api`, between the fan-out and the
   * composer, because this package has no network. See `travel.ts`.
   */
  travel: TravelTable;
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
   * Constraints the composer could not evaluate, and why. See `unchecked.ts`.
   *
   * Travel time was on it unconditionally until pl-27 and is now on it only
   * where a transition actually went unmeasured — which is the whole of that
   * ticket, read from this end.
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
    travel: input.travel,
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
      travel: input.travel,
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

  // The days as they will be stored, built once. `uncheckedFor` then reads the
  // very same structure a reader of the revision hands it, which is what makes
  // the two agree by construction rather than by two implementations being
  // careful — including about which transitions were measured.
  const days = toPlanDays(packed, input.revision.id);
  const coverage = [...(input.coverage ?? [])];
  const reading = [...(input.reading ?? [])];

  return {
    revision: {
      id: input.revision.id,
      reason: input.revision.reason,
      createdAt: input.revision.createdAt,
      days,
      gaps: [...(input.gaps ?? []), ...gapsFor(input.candidates, packed)],
      coverage,
      reading,
    },
    // Derived from what was placed, not from the pack — so a reader of the
    // stored revision gets the identical list without re-composing. See
    // `unchecked.ts`. `coverage` rides on top rather than through it, because
    // it is not derivable from days at all — see the note on `ComposeInput`.
    unchecked: [...uncheckedFor({ brief, dates, candidates: input.candidates, days }), ...coverage],
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
      // Evidence rather than a derivation, so it is carried onto the document
      // and stored with it — see the header on `contract/src/travel.ts`.
      travelFromPrevious: item.travelFromPrevious,
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
