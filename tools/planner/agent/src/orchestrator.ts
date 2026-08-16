/**
 * The fan-out: a brief in, the candidates the specialists that trip needs came
 * back with, and an honest account of everyone who did not contribute.
 *
 * ```
 * TripBrief ─► rosterFor ─► applyBudget ─┬─► [route]     ─┐
 *                                        ├─► [lodging]   ─┤  parallel: they
 *                                        ├─► [activities]─┤  depend on the
 *                                        └─► ...         ─┘  brief, not on
 *                                                            each other
 *                                              │
 *                                              ▼  join once — a real barrier
 *                                   Candidate[] + PlanGap[]
 * ```
 *
 * **It stops before composing.** Packing days is arithmetic and belongs to
 * `@planner/itinerary` (§2). Nothing in this file knows what day anything falls
 * on, and `Candidate` has no field that could say.
 *
 * ## Parallel, and the join is the point
 *
 * The specialists do not read each other's output — only the brief — so the run
 * costs the slowest one rather than the sum. What *does* need all of them is the
 * composer, which cannot pack a day without every candidate. That barrier is
 * real rather than incidental, and it is why this function returns a whole
 * candidate set rather than streaming one.
 *
 * ## One specialist failing does not fail the run
 *
 * §7, and the repo's _never fake progress_ rule in this domain: a specialist that
 * failed or timed out leaves a plan that **says lodging was not checked**. A
 * quietly invented hotel is worse than an admitted hole. So every per-specialist
 * failure becomes a `PlanGap` and the run ships; the only things that fail the
 * whole run are a brief too thin to plan from and a cancellation.
 *
 * ## Which gaps are whose
 *
 * `compose()` takes a `gaps` array and carries it onto the revision untouched,
 * because it cannot tell "never on the roster" from "dropped for budget" from
 * "failed" — those are this file's to know, and it says so in its own doc. The
 * one gap the composer adds for itself is `no-candidates-found` for a specialist
 * that returned candidates and got none of them onto a day. This file raises the
 * same reason for the other half of it: a specialist that ran and returned
 * nothing at all.
 */

import { AppError, isAnswered, missingRequiredSlots } from "@planner/contract";
import type {
  Candidate,
  PlanGap,
  RunProgress,
  Specialist,
  TripBrief,
  TripShape,
} from "@planner/contract";
import { askSpecialist, type CandidateProposal } from "./ask.ts";
import { applyBudget, rosterGaps, type RunBudget } from "./budget.ts";
import type { ModelProvider } from "./provider.ts";
import { rosterFor, type RosterEntry } from "./roster.ts";
import { candidateCeiling, SPECIALIST_DEFINITIONS, type TripCapacity } from "./specialists.ts";

// ---------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------

export interface FanOutInput {
  brief: TripBrief;
  /**
   * What a day holds and how many there are, from `@planner/itinerary`. Required
   * rather than optional: a caller that forgets it writes the exact bug pl-9
   * found — see `TripCapacity`.
   */
  capacity: TripCapacity;
  provider: ModelProvider;
  /** A run carries a budget, and it is enforced here before anything is sent. */
  budget: RunBudget;
  /**
   * Prefix for the candidate ids this run mints. Unique per run and supplied by
   * the caller — this package has no clock and no randomness, for the reason
   * `@planner/itinerary` has none: the same inputs must produce the same output
   * twice.
   */
  runId: string;
  /** Cancels the whole fan-out. Every in-flight provider call takes it. */
  signal?: AbortSignal | undefined;
  /**
   * Told what the run is doing, as `@planner/contract`'s `RunProgress`.
   *
   * The contract's type rather than one of this package's: `api` forwards these
   * frames onto SSE and `web` renders them, and a shape defined twice is one
   * that gains a field on one side only (pl-16). What this package cannot fill
   * is the timestamp — it has no clock, for the reason `runId` is an argument —
   * so `api` wraps each of these in a `RunEvent` and reads the clock once.
   */
  onProgress?: ((event: RunProgress) => void) | undefined;
}

/** A proposal that came back and was refused, with the reason, for the log. */
export interface RejectedProposal {
  specialist: Specialist;
  title: string;
  reason: "over-day-capacity" | "wrong-location-kind";
}

export interface FanOutResult {
  /** Everything that survived, in roster order and then in the order proposed. */
  candidates: Candidate[];
  /** For `compose()`'s `gaps`, which carries them onto the revision untouched. */
  gaps: PlanGap[];
  roster: {
    ran: RosterEntry[];
    droppedForBudget: RosterEntry[];
    notApplicable: RosterEntry[];
  };
  rejected: RejectedProposal[];
  usage: {
    calls: number;
    /** `null` when no provider reported a count — a local model usually will not. */
    inputTokens: number | null;
    outputTokens: number | null;
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runFanOut(input: FanOutInput): Promise<FanOutResult> {
  const shape = readyShape(input.brief);

  const roster = rosterFor(input.brief);
  const budgeted = applyBudget(roster, input.budget);
  const total = budgeted.running.length;

  input.onProgress?.({
    type: "roster",
    running: budgeted.running.map((entry) => entry.specialist),
    droppedForBudget: budgeted.droppedForBudget.map((entry) => entry.specialist),
    total,
  });

  let done = 0;
  const outcomes = await Promise.all(
    budgeted.running.map(async (entry): Promise<SpecialistOutcome> => {
      input.onProgress?.({ type: "specialist-started", specialist: entry.specialist, total });
      try {
        const asked = await askSpecialist({
          provider: input.provider,
          specialist: entry.specialist,
          shape,
          brief: input.brief,
          capacity: input.capacity,
          budget: input.budget,
          signal: input.signal,
        });
        done += 1;
        input.onProgress?.({
          type: "specialist-finished",
          specialist: entry.specialist,
          candidates: asked.proposals.length,
          done,
          total,
        });
        return { entry, proposals: asked.proposals, replies: asked.replies, error: null };
      } catch (error: unknown) {
        // A cancellation is not a gap. "Lodging was not checked because you
        // stopped the run" is a sentence about the run, and the run is about to
        // fail as a whole — recording it on the plan would leave a canceled
        // draft looking like a completed one with holes.
        if (isCancellation(error, input.signal)) throw error;

        const appError = AppError.from(error);
        done += 1;
        input.onProgress?.({
          type: "specialist-failed",
          specialist: entry.specialist,
          code: appError.code,
          done,
          total,
        });
        return { entry, proposals: [], replies: [], error: appError };
      }
    }),
  );

  input.signal?.throwIfAborted();

  const candidates: Candidate[] = [];
  const rejected: RejectedProposal[] = [];
  const gaps: PlanGap[] = [];

  for (const outcome of outcomes) {
    const { specialist } = outcome.entry;

    if (outcome.error !== null) {
      gaps.push({
        specialist,
        reason: "specialist-failed",
        detail: `This part of the plan was tried and could not be finished: ${outcome.error.message} Re-planning would try it again.`,
      });
      continue;
    }

    const accepted = accept({
      specialist,
      proposals: outcome.proposals,
      capacity: input.capacity,
      runId: input.runId,
    });
    candidates.push(...accepted.candidates);
    rejected.push(...accepted.rejected);

    if (accepted.candidates.length === 0) {
      gaps.push({
        specialist,
        reason: "no-candidates-found",
        detail:
          accepted.rejected.length === 0
            ? "This part of the plan was checked and nothing worth proposing came back."
            : "This part of the plan was checked, and nothing that came back fitted the days this trip has.",
      });
    }
  }

  gaps.push(...rosterGaps(roster, budgeted));

  return {
    candidates,
    gaps,
    roster: {
      ran: budgeted.running,
      droppedForBudget: budgeted.droppedForBudget,
      notApplicable: roster.notApplicable,
    },
    rejected,
    usage: tally(outcomes),
  };
}

interface SpecialistOutcome {
  entry: RosterEntry;
  proposals: CandidateProposal[];
  replies: { usage: { inputTokens: number | null; outputTokens: number | null } }[];
  error: AppError | null;
}

/**
 * The shape a draftable brief has, or the refusal.
 *
 * The same two checks `compose()` makes and in the same order, because the two
 * have to agree about what "ready" means: a run that fanned out and then found
 * the brief unplannable would have spent the whole roster to say so.
 */
function readyShape(brief: TripBrief): TripShape {
  const missing = missingRequiredSlots(brief);
  if (missing.length > 0) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing } });
  }
  // `shape` is required, so it has been asked — but it can still have been
  // declined, and there is no roster for a trip whose shape nobody named.
  if (!isAnswered(brief.shape)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["shape"] } });
  }
  return brief.shape.value;
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted === true) return true;
  if (error instanceof AppError) return error.code === "CANCELED" || error.code === "JOB_CANCELED";
  return error instanceof Error && error.name === "AbortError";
}

/**
 * What survives the rules the prompt already stated.
 *
 * §2 in its narrowest form: **a rule a model was merely asked to follow is not a
 * rule.** Two of them are checkable here from data the candidate carries, and
 * both are the difference between a plan and a plan-shaped hole:
 *
 * - **Over the day's ceiling.** pl-9's finding: a 5½-hour leg proposed to a
 *   party who answered `half-day` is dropped by the composer, and a road trip
 *   comes out with no drives in it. Refusing it here means the gap says the
 *   specialist found nothing that fitted, which is true, rather than the plan
 *   quietly lacking a section.
 * - **The wrong kind of location.** A route candidate that came back `at` one
 *   place is a leg whose endpoints went back into its title, which is the shape
 *   pl-15 removed and the shape a model will write again unless something says
 *   no.
 *
 * A candidate with no stated duration is **kept**. `null` means nobody measured
 * it, the packer charges it nothing and notes that it did, and refusing it here
 * would turn "unknown" into "too long" — which is the collapse `Candidate`'s
 * `null` exists to prevent one layer down.
 */
function accept(input: {
  specialist: Specialist;
  proposals: readonly CandidateProposal[];
  capacity: TripCapacity;
  runId: string;
}): { candidates: Candidate[]; rejected: RejectedProposal[] } {
  const ceiling = candidateCeiling(input.specialist, input.capacity);
  const wanted = SPECIALIST_DEFINITIONS[input.specialist].location;

  const candidates: Candidate[] = [];
  const rejected: RejectedProposal[] = [];

  for (const proposal of input.proposals) {
    if (proposal.location.kind !== wanted) {
      rejected.push({
        specialist: input.specialist,
        title: proposal.title,
        reason: "wrong-location-kind",
      });
      continue;
    }
    if (
      ceiling !== null &&
      proposal.durationMinutes !== null &&
      proposal.durationMinutes > ceiling
    ) {
      rejected.push({
        specialist: input.specialist,
        title: proposal.title,
        reason: "over-day-capacity",
      });
      continue;
    }

    candidates.push({
      ...proposal,
      // Derived rather than generated, the way the composer derives a day's id:
      // the run is already unique, so the same run composed twice produces the
      // same ids and a stored plan can be re-derived from its own inputs.
      id: `${input.runId}-${input.specialist}-${String(candidates.length + 1)}`,
      specialist: input.specialist,
    });
  }

  return { candidates, rejected };
}

/** What the run cost, where the provider was willing to say. */
function tally(outcomes: readonly SpecialistOutcome[]): FanOutResult["usage"] {
  let calls = 0;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  for (const outcome of outcomes) {
    for (const reply of outcome.replies) {
      calls += 1;
      if (reply.usage.inputTokens !== null) {
        inputTokens = (inputTokens ?? 0) + reply.usage.inputTokens;
      }
      if (reply.usage.outputTokens !== null) {
        outputTokens = (outputTokens ?? 0) + reply.usage.outputTokens;
      }
    }
  }

  return { calls, inputTokens, outputTokens };
}
