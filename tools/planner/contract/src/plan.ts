/**
 * The plan document.
 *
 * `00-ANALYSIS.md` §6: **the interesting problem is not the chat, it is that a
 * plan is a long-lived, revisable document.** What a user does with a first
 * draft is change it, and the quality of that experience is the quality of the
 * product. That is only possible if a plan is structured data — a markdown blob
 * can be regenerated but not amended, cannot say which of its lines were
 * verified, and produces an unreadable diff.
 *
 * Three mechanisms carry it, and each is a type below:
 *
 * - **Revisions append.** A revision is never overwritten, so the draft the user
 *   liked is always retrievable and the UI shows a diff rather than a wall of
 *   new prose.
 * - **Pinning.** An item the user blessed may not be moved by a re-plan; the
 *   composer works around it. `pinned` is on the item because it is the
 *   composer's input constraint.
 * - **Naming the gap.** A specialist that failed or never ran leaves a plan that
 *   *says so*. §7's last row, and the repo's _never fake progress_ rule in this
 *   domain: a plan that quietly invents a hotel is worse than no plan.
 *
 * ## What a plan is *not*
 *
 * It is not the intake and it is not the brief. Answers are what the user said,
 * the brief is the validated document derived from them, and the plan is what
 * the tool made of it — fusing any two means deriving one by re-reading another
 * (§6). The brief a plan was drafted from is carried here as a **snapshot**, for
 * the reason on `PlanDetail.brief`.
 */

import { z } from "zod";
import { candidateSchema, SPECIALISTS } from "./candidate.ts";
import type { Candidate, Specialist } from "./candidate.ts";
import { tripBriefSchema } from "./brief.ts";
import type { TripBrief } from "./brief.ts";
import { itemTravelSchema } from "./travel.ts";
import type { ItemTravel } from "./travel.ts";
import { uncheckedConstraintSchema } from "./unchecked.ts";
import type { UncheckedConstraint } from "./unchecked.ts";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Matches `MAX_TRIP_NIGHTS` — a plan cannot be longer than the trip it plans. */
export const MAX_PLAN_DAYS = 60;

/** Items on one day. Past this the composer has packed a list, not a day. */
export const MAX_ITEMS_PER_DAY = 12;

export const MAX_PLAN_TITLE_CHARS = 200;
export const MAX_ITEM_NOTE_CHARS = 500;
export const MAX_REVISION_REASON_CHARS = 500;
export const MAX_GAP_DETAIL_CHARS = 500;

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * One thing on one day.
 *
 * It carries no content of its own beyond placement: what it *is* lives on the
 * `Candidate` it points at. That indirection is what makes a re-plan a diff —
 * moving a hike to Thursday changes one item's day and nothing about the hike —
 * and it is what lets two revisions share a candidate rather than duplicating
 * its sources and its cost band.
 */
export interface PlanItem {
  id: string;
  /** The candidate this item schedules. */
  candidateId: string;
  /** Ordinal within the day. Dense from 0, and the day's order is this alone. */
  position: number;
  /**
   * A wall-clock start, `HH:MM`, only when something outside the plan fixes it —
   * a ferry, a timed entry, a guided departure. `null` is the normal case and
   * means "this is the third thing that day", which is all the composer can
   * honestly claim without opening hours (Phase 3).
   */
  startsAt: string | null;
  /**
   * The user blessed this; a re-plan may not move it (§6).
   *
   * **The one field on a placed item that changes without a new revision.**
   * Pinning is a statement about what the *next* re-plan may touch, not an edit
   * to this draft — a revision per pin toggle would fill the history with
   * intent and no content. The database enforces exactly that: `plan_items` is
   * append-only in every column but this one.
   */
  pinned: boolean;
  /** The composer's or the critic's note about this placement, if any. */
  note: string | null;
  /**
   * Getting here from the item before it on the same day, as this revision was
   * packed (pl-27).
   *
   * `null` means exactly one thing: **there is nothing before it on this day**,
   * so there was no transition to know anything about. Every other answer is a
   * named member of `ItemTravel` — measured, nobody could say, or never asked
   * for want of budget — because those are three different sentences to a
   * reader and a `null` that meant all of them would be a plan that cannot tell
   * a road nobody has mapped from a question this run stopped asking.
   *
   * **It is stored rather than derived**, which is the opposite of what pl-10
   * decided for `UncheckedConstraint` and deliberately so — see the header on
   * `travel.ts`. A cache row expires; the plan still has to be able to say what
   * its days were packed against.
   *
   * The day's **anchor** — where you sleep — carries one and is not charged for
   * it: getting to your bed is real travel worth recording, and pl-9's rule that
   * the anchor consumes no part of the day is about what the day fits around.
   * See `transitionTo` in `@planner/itinerary`'s packer.
   */
  travelFromPrevious: ItemTravel | null;
}

export const planItemSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  position: z
    .number()
    .int()
    .min(0)
    .max(MAX_ITEMS_PER_DAY - 1),
  // 24-hour, zero-padded. A string rather than minutes-past-midnight because it
  // is displayed far more often than it is arithmetic on, and because the
  // arithmetic that does happen is the composer's, which parses it once.
  startsAt: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  pinned: z.boolean(),
  note: z.string().trim().min(1).max(MAX_ITEM_NOTE_CHARS).nullable(),
  travelFromPrevious: itemTravelSchema.nullable(),
}) satisfies z.ZodType<PlanItem>;

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/**
 * One day of the plan.
 *
 * **`dayIndex` is always present and `date` may be `null`**, which is a direct
 * consequence of pl-3's flexible dates. A brief whose dates are `open` ("ten
 * nights, whenever is best") has no calendar to hang a plan on, and a plan that
 * demanded one would force the tool to invent a departure date and then plan
 * against it as though the user had chosen it. So the day's identity is its
 * index, and the date is an annotation that arrives when the brief has one.
 *
 * Every reader must therefore handle a dateless day. That is the cost of the
 * brief being honest about flexibility, and it is paid here rather than by
 * making the intake lie.
 */
export interface PlanDay {
  id: string;
  /** 0-based, dense. The day's identity, with or without a calendar. */
  dayIndex: number;
  /** `YYYY-MM-DD`, or `null` when the brief's dates are a window or open. */
  date: string | null;
  items: PlanItem[];
}

export const planDaySchema = z.object({
  id: z.string().min(1),
  dayIndex: z
    .number()
    .int()
    .min(0)
    .max(MAX_PLAN_DAYS - 1),
  date: z.iso.date().nullable(),
  items: z.array(planItemSchema).max(MAX_ITEMS_PER_DAY),
}) satisfies z.ZodType<PlanDay>;

// ---------------------------------------------------------------------------
// Gaps
// ---------------------------------------------------------------------------

/**
 * Why a part of the plan is missing.
 *
 * Each of these is a *different sentence to a user*, which is the bar for a
 * separate case: "we did not check lodging because you are staying in one
 * place" is reassurance, and "we tried to check lodging and could not" is a
 * warning with a retry behind it.
 */
export const PLAN_GAP_REASONS = [
  /** On the roster, and it failed or timed out. §7: ship, and name it. */
  "specialist-failed",
  /** Dropped before the fan-out to stay inside the run's budget (§9). */
  "specialist-dropped-for-budget",
  /** Not on the roster: this trip had nothing for it to say (§4). */
  "specialist-not-applicable",
  /** It ran and returned nothing usable — a real answer, and not a failure. */
  "no-candidates-found",
] as const;

export type PlanGapReason = (typeof PLAN_GAP_REASONS)[number];

/**
 * A section of the plan that is honestly absent.
 *
 * This type is the repo's _never fake progress_ rule made structural: a plan
 * with a hole must carry the hole as data, because a hole recorded only in
 * prose is one the UI cannot mark and the next revision cannot re-try.
 *
 * A gap belongs to the revision rather than the plan: a re-plan that finally
 * reaches the lodging specialist closes it, and the closing is exactly what the
 * diff between two revisions should show.
 */
export interface PlanGap {
  specialist: Specialist;
  reason: PlanGapReason;
  /** What to tell the user, in their terms. Never a stack trace or a code. */
  detail: string;
}

export const planGapSchema = z.object({
  specialist: z.enum(SPECIALISTS),
  reason: z.enum(PLAN_GAP_REASONS),
  detail: z.string().trim().min(1).max(MAX_GAP_DETAIL_CHARS),
}) satisfies z.ZodType<PlanGap>;

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

/**
 * One draft of the plan, frozen.
 *
 * Revisions append and are never overwritten (§6), so this type has no
 * `updatedAt` — there is no such moment. The chain is `parentRevisionId`, and
 * `revision` is its 1-based position, denormalised because every list and every
 * URL wants it and recomputing it means walking the chain.
 */
export interface PlanRevision {
  id: string;
  planId: string;
  /** 1-based and dense. Revision 1 is the first draft. */
  revision: number;
  /** What this was derived from. `null` only for revision 1. */
  parentRevisionId: string | null;
  /**
   * Why this revision exists, in the user's terms — "moved the hike to
   * Thursday", "dropped the second hotel". It is the diff's caption, and the
   * first draft's is simply that it is the first draft.
   */
  reason: string;
  createdAt: string;
  days: PlanDay[];
  /** What this draft could not cover, and why. Empty is a real and good answer. */
  gaps: PlanGap[];
  /**
   * What a corridor discovery pass found the ground too thin to say much
   * about, before the fan-out ever ran (pl-29).
   *
   * **Not `uncheckedFor`'s business**, unlike the rest of `UncheckedConstraint`.
   * Every other kind in that list is a pure function of the brief, the
   * candidates and which of them a revision placed — re-derivable from a
   * stored revision without asking anything outside this process again. A thin
   * corridor is not: it is a fact a live backend answered once, at compose
   * time, the same way a measured leg is (`PlanItem.travelFromPrevious`) —
   * evidence, not a derivation, so it is stored here rather than recomputed on
   * every read. `uncheckedForRevision` appends it to what it derives; nothing
   * here is asked to derive it a second time.
   *
   * Empty is a real and good answer, the same as `gaps`: most corridors have
   * something on the map.
   */
  coverage: UncheckedConstraint[];
}

export const planRevisionSchema = z
  .object({
    id: z.string().min(1),
    planId: z.string().min(1),
    revision: z.number().int().min(1),
    parentRevisionId: z.string().min(1).nullable(),
    reason: z.string().trim().min(1).max(MAX_REVISION_REASON_CHARS),
    createdAt: z.iso.datetime(),
    days: z.array(planDaySchema).max(MAX_PLAN_DAYS),
    gaps: z.array(planGapSchema).max(SPECIALISTS.length),
    // Unbounded by a specialist count the way `gaps` is: this is plan-wide and
    // there is at most one sensible entry, but nothing here enforces that —
    // the discovery pass builds the list and this schema just says what one
    // entry looks like.
    coverage: z.array(uncheckedConstraintSchema),
  })
  // The two ways the chain can be malformed, and both are only ever produced by
  // something assembling a revision by hand — `appendRevision` cannot make
  // either. Rejecting them here means no reader has to consider an orphan.
  .refine((rev) => (rev.revision === 1) === (rev.parentRevisionId === null), {
    message: "Only the first revision has no parent, and it must have none.",
    path: ["parentRevisionId"],
  })
  .refine((rev) => rev.days.every((day, index) => day.dayIndex === index), {
    message: "Day indexes must be dense and in order.",
    path: ["days"],
  }) satisfies z.ZodType<PlanRevision>;

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * The aggregate root, as it appears in a list.
 *
 * Deliberately thin: this is what the UI's "your plans" page reads, and loading
 * every revision of every plan to render a list of titles is the read this
 * split exists to prevent. `PlanDetail` is the whole document.
 */
export interface Plan {
  id: string;
  /** Drawn from the brief's destination, or the trip's shape when it declined one. */
  title: string;
  createdAt: string;
  /** Moves when a revision is appended or an item is pinned. */
  updatedAt: string;
  /** The revision number of the latest — what a list shows without loading them. */
  latestRevision: number;
}

export const planSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_PLAN_TITLE_CHARS),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  latestRevision: z.number().int().min(0),
}) satisfies z.ZodType<Plan>;

/**
 * The whole document: the brief it came from, every candidate proposed for it,
 * and every revision made of them.
 *
 * **`brief` is a snapshot, not a reference.** The intake stays editable after a
 * plan is drafted — refining is somewhere a user comes back to — so the live
 * brief drifts from the one this plan was actually built against. Storing the
 * brief with the plan is what lets the UI answer "why is there no lodging in
 * here?" with the brief that was true at the time, and it is what lets pl-5's
 * fan-out be replayed from a stored plan. pl-7 owns the *live* intake and may
 * add a link to it; the snapshot is not that link and does not replace it.
 *
 * **Candidates belong to the plan, not to a revision.** A candidate the composer
 * did not place is still worth keeping — it is what the next revision draws on
 * when the user says "we cannot afford the second hotel" — and a candidate two
 * revisions both place must not be stored twice.
 */
export interface PlanDetail extends Plan {
  brief: TripBrief;
  candidates: Candidate[];
  /** Oldest first. Appended to, never rewritten. */
  revisions: PlanRevision[];
}

export const planDetailSchema = planSchema.extend({
  brief: tripBriefSchema,
  candidates: z.array(candidateSchema),
  revisions: z.array(planRevisionSchema),
}) satisfies z.ZodType<PlanDetail>;

// ---------------------------------------------------------------------------
// Reading and appending
// ---------------------------------------------------------------------------

/**
 * The current draft, or `null` for a plan whose first run has not finished.
 *
 * A plan with no revisions is a real and reachable state — pl-5 creates the plan
 * when the run starts so the run has somewhere to report progress to, and the
 * first revision arrives when the composer is done. Callers must handle it, so
 * the signature says so rather than throwing.
 */
export function latestRevision(plan: PlanDetail): PlanRevision | null {
  return plan.revisions.at(-1) ?? null;
}

/**
 * Every item across a revision, in day and then position order.
 *
 * Here rather than in a caller because both the composer and the UI's diff want
 * it, and a second implementation of "in order" is how two views of one plan
 * start disagreeing about what order means.
 */
export function revisionItems(revision: PlanRevision): PlanItem[] {
  return revision.days.flatMap((day) => day.items);
}

/**
 * The candidates a re-plan may not move (§6).
 *
 * Ids rather than candidates: the composer's constraint is about identity, and
 * resolving them against `PlanDetail.candidates` is the caller's business.
 */
export function pinnedCandidateIds(revision: PlanRevision): string[] {
  return revisionItems(revision)
    .filter((item) => item.pinned)
    .map((item) => item.candidateId);
}

/** What `appendRevision` needs told; everything else it derives from the plan. */
export type NewRevision = Pick<
  PlanRevision,
  "id" | "reason" | "createdAt" | "days" | "gaps" | "coverage"
>;

/**
 * Append a revision, returning a new plan.
 *
 * The append-only rule is the one thing in §6 that a caller can break by
 * accident, so it is not left to care: this derives `revision` and
 * `parentRevisionId` from the plan rather than accepting them, and it copies
 * rather than pushes. The predecessor is unreachable from the result, which is
 * what a test asserts.
 *
 * It is runtime logic in a package `01-ARCHITECTURE.md` describes as having
 * none — the same exception `withShape` and `missingRequiredSlots` already took
 * in pl-3, and for the same reason: `api` writes revisions and `web` renders
 * them, both need the rule, and neither should own it.
 *
 * `updatedAt` moves to the new revision's `createdAt` rather than to a clock
 * read here. The contract has no clock, deliberately — the caller has one, and
 * a plan whose `updatedAt` disagrees with its own latest revision is a bug
 * nobody would find.
 */
export function appendRevision(plan: PlanDetail, next: NewRevision): PlanDetail {
  const previous = latestRevision(plan);
  const revision: PlanRevision = {
    ...next,
    planId: plan.id,
    revision: (previous?.revision ?? 0) + 1,
    parentRevisionId: previous?.id ?? null,
  };
  return {
    ...plan,
    updatedAt: revision.createdAt,
    latestRevision: revision.revision,
    revisions: [...plan.revisions, revision],
  };
}
