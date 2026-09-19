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

import { AppError, isAnswered, missingRequiredSlots, MODEL_ASSERTED } from "@planner/contract";
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
import type { Find } from "./grounding.ts";
import type { ModelProvider, ModelReply } from "./provider.ts";
import { rosterFor, type RosterDecision, type RosterEntry } from "./roster.ts";
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
   * What a corridor discovery pass found before this fan-out started, handed
   * to the specialists that read map data — `activities`, `food` and
   * `conditions-and-gear` (pl-29). Defaults to empty, which is every trip
   * before this ticket and every trip whose brief had no corridor to discover
   * along.
   */
  finds?: readonly Find[] | undefined;
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
  /**
   * Told what the run has spent so far, each time a reply lands (pl-49).
   *
   * **The running total, not only the final one, because a run that ends in a
   * throw never returns a `FanOutResult`.** A cancellation rethrows out of
   * this function, and every reply that finished before it was billed all the
   * same — so the caller keeps the last total it was handed and records that,
   * however the run ended.
   *
   * A callback beside `onProgress` rather than a frame on it: `RunProgress`
   * is `@planner/contract`'s and is forwarded to the browser, and a token
   * count is neither something the plan view renders nor a reason to change a
   * contract. Nothing here reads a clock or a price; it only adds.
   */
  onUsage?: ((usage: RunUsage) => void) | undefined;
  /**
   * Run only these specialists — a re-plan's named set (pl-44). `undefined` is
   * the whole roster, which is every first draft.
   *
   * **The roster is still `rosterFor(brief)`**, so whether a specialist applies
   * stays a pure function of the brief; this only narrows what is reported and
   * run. A named specialist the roster says is not applicable is not run and
   * keeps its `specialist-not-applicable` gap with the roster's own sentence —
   * it is not refused, because that sentence is true and the checkbox that
   * named it is an ordinary one. **Gaps and the `roster` frame cover the named
   * set only**: an unnamed specialist's gap belongs to the revision being
   * re-planned, and the caller carries it forward.
   *
   * The budget cap applies to the named set as it applies to a roster, from the
   * back of `SPECIALIST_ORDER`. `[]` reports `total: 0`, sends nothing and
   * returns empty.
   */
  only?: readonly Specialist[] | undefined;
  /**
   * What the traveller wrote about this change (a re-plan's `note`, pl-44).
   * Rendered into every running specialist's **user** message as quoted
   * context, never into the system prompt — see `userPrompt`.
   */
  note?: string | null | undefined;
}

/**
 * What a run spent, where the provider was willing to say (pl-49).
 *
 * Every token field is `null` until some reply reports that kind — the
 * scripted provider reports none, and "nobody said" is not zero. `calls` and
 * `fallbackCalls` are counts this file makes itself, so they are never null.
 */
export interface RunUsage {
  /**
   * Replies that came back, **whatever became of them**: one that did not
   * parse, one that was refused and one whose specialist then failed were each
   * billed, and each is counted.
   */
  calls: number;
  inputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  /**
   * How much of `outputTokens` was internal reasoning, where some reply said
   * (pl-50). **Not proven to cover the same attempts `outputTokens` does**
   * within a reply that took a refusal fallback — see `ModelUsage`'s own doc
   * comment. Unmeasured until pl-40's funded run captures a real reply that
   * both thought and fell back.
   */
  thinkingTokens: number | null;
  /**
   * Replies a model other than the configured one served — a refusal fallback.
   * Their tokens are in the totals above, billed at that other model's rates,
   * which is why a report pricing the totals at one rate calls itself
   * approximate when this is not zero.
   */
  fallbackCalls: number;
}

/** A sum where `null` is "nobody said": it stays null until some value is reported. */
function add(sum: number | null, value: number | null): number | null {
  return value === null ? sum : (sum ?? 0) + value;
}

/** A run that has not been answered once. */
export function emptyRunUsage(): RunUsage {
  return {
    calls: 0,
    inputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    outputTokens: null,
    thinkingTokens: null,
    fallbackCalls: 0,
  };
}

/**
 * The total with one more reply in it.
 *
 * "Served by another model" is the provider's own test, applied to the same two
 * strings — `AnthropicProvider` logs a reply whose `servedModel` differs from
 * its `model`, and this counts exactly those. A reply that names no served
 * model is not a fallback: the backend had nothing to say.
 */
export function addReplyUsage(
  total: RunUsage,
  reply: ModelReply,
  configuredModel: string,
): RunUsage {
  return {
    calls: total.calls + 1,
    inputTokens: add(total.inputTokens, reply.usage.inputTokens),
    cacheReadTokens: add(total.cacheReadTokens, reply.usage.cacheReadTokens),
    cacheWriteTokens: add(total.cacheWriteTokens, reply.usage.cacheWriteTokens),
    outputTokens: add(total.outputTokens, reply.usage.outputTokens),
    thinkingTokens: add(total.thinkingTokens, reply.usage.thinkingTokens),
    fallbackCalls:
      total.fallbackCalls +
      (reply.servedModel !== undefined && reply.servedModel !== configuredModel ? 1 : 0),
  };
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
  /** Every reply this run was billed for. The last total `onUsage` was handed. */
  usage: RunUsage;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export async function runFanOut(input: FanOutInput): Promise<FanOutResult> {
  const shape = readyShape(input.brief);

  const roster = named(rosterFor(input.brief), input.only);
  const budgeted = applyBudget(roster, input.budget);
  const total = budgeted.running.length;

  input.onProgress?.({
    type: "roster",
    running: budgeted.running.map((entry) => entry.specialist),
    droppedForBudget: budgeted.droppedForBudget.map((entry) => entry.specialist),
    total,
  });

  // Counted at the seam rather than from what each specialist returned. A
  // specialist that throws — refused, or malformed past its re-ask — takes the
  // replies it was billed for down with it, and so does a cancellation, which
  // rethrows before anything could be added up afterwards. Before pl-49 both
  // fell out of the count. Wrapping `send` sees every reply that landed,
  // whatever the caller did with it next.
  let usage = emptyRunUsage();
  const provider: ModelProvider = {
    name: input.provider.name,
    model: input.provider.model,
    send: async (request) => {
      const reply = await input.provider.send(request);
      usage = addReplyUsage(usage, reply, input.provider.model);
      input.onUsage?.(usage);
      return reply;
    },
  };

  let done = 0;
  const outcomes = await Promise.all(
    budgeted.running.map(async (entry): Promise<SpecialistOutcome> => {
      input.onProgress?.({ type: "specialist-started", specialist: entry.specialist, total });
      try {
        const asked = await askSpecialist({
          provider,
          specialist: entry.specialist,
          shape,
          brief: input.brief,
          capacity: input.capacity,
          budget: input.budget,
          finds: input.finds,
          note: input.note,
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
        return { entry, proposals: asked.proposals, error: null };
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
        return { entry, proposals: [], error: appError };
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
    usage,
  };
}

/**
 * The roster narrowed to a named set, or the roster itself when nothing is
 * named. Filtered rather than rebuilt, so both halves keep `SPECIALIST_ORDER`
 * and every entry keeps the sentence `rosterFor` gave it.
 */
function named(roster: RosterDecision, only: readonly Specialist[] | undefined): RosterDecision {
  if (only === undefined) return roster;
  const wanted = new Set(only);
  return {
    running: roster.running.filter((entry) => wanted.has(entry.specialist)),
    notApplicable: roster.notApplicable.filter((entry) => wanted.has(entry.specialist)),
  };
}

interface SpecialistOutcome {
  entry: RosterEntry;
  proposals: CandidateProposal[];
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
 *
 * ## It is also the one place provenance is decided — pl-36
 *
 * `candidateProposalSchema` omits `provenance` so a specialist cannot state its
 * own, for the reason `ask.ts`'s header gives, which leaves this function
 * holding the only answer. It is `MODEL_ASSERTED` for every candidate, which is
 * exactly what the plan said before pl-36 — nothing about a run's output
 * changed, only who gets to say it.
 *
 * **A candidate a specialist wrote *from* a corridor `Find` is `model-asserted`
 * too, and pl-36 settled that permanently.** Not for want of a `Source` — a
 * `Find` carries its own — but because nothing can say *which* find a proposal
 * was written from: the prompt hands a model a name and takes back prose, and no
 * run in this repo has ever been captured with `finds` in it, so the name-match
 * join it would take has never been scored against a single observation.
 * Attributing OpenStreetMap to the wrong candidate is worse than attributing
 * nothing. `Provenance` gains no third member for the same reason pl-29's Build
 * step 6 gave. The argument, and what would have to be measured before reopening
 * it is worth anything, is in pl-36's Log and is deliberately not restated here.
 *
 * `cost.provenance` is overwritten rather than omitted, for the schema reason
 * `ask.ts` records. A price is §5's fastest-ageing fact and the one a reader is
 * likeliest to act on, so a model marking its own guess **Sourced** is the
 * version of this that would have done the most damage.
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
      // Whatever a model wrote here is discarded: a price the assistant guessed
      // is `model-asserted` however the reply described it.
      cost: proposal.cost === null ? null : { ...proposal.cost, provenance: MODEL_ASSERTED },
      // Derived rather than generated, the way the composer derives a day's id:
      // the run is already unique, so the same run composed twice produces the
      // same ids and a stored plan can be re-derived from its own inputs.
      id: `${input.runId}-${input.specialist}-${String(candidates.length + 1)}`,
      specialist: input.specialist,
      provenance: MODEL_ASSERTED,
    });
  }

  return { candidates, rejected };
}
