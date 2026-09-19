/**
 * Revising a plan: `POST /api/plans/:id/revisions` (pl-44).
 *
 * §6's two mechanisms, where they meet the database and the job runner. A
 * **re-plan** names days and is a run — queued, streamed, cancelable, exactly a
 * first draft's machinery. A **move**, a **remove** and a **restore** are edits:
 * synchronous, no run, and a fresh `PlanView` in the response.
 *
 * Everything a revision *contains* is `@planner/itinerary`'s (pl-43): `replan`,
 * `replanPool`, `editTransitions`, `applyEdit` and `restoreRevision` are called
 * here and re-implemented nowhere, because a second composer in `api` is the
 * drift `db/plans.ts`'s header warns about. What is `api`'s is what a schema
 * cannot check and `itinerary` deliberately does not — each of those throws
 * `INTERNAL` when a bad value reaches it, because reaching it means this file
 * did not check.
 *
 * ## The checks, in their order
 *
 * The route parses the body and spends the bucket its `kind` selects; then:
 *
 * 1. `PLAN_NOT_FOUND`;
 * 2. `PLAN_BUSY`, naming the live run — before staleness, because the client's
 *    base is probably still the latest, and once the run finishes the same
 *    request becomes `REVISION_STALE`: wait, then reload;
 * 3. `REVISION_STALE` when the base is not the latest, a plan with no revision
 *    at all included;
 * 4. `REVISION_LIMIT_REACHED` at `MAX_REVISIONS_PER_PLAN`;
 * 5. per kind: a day past the base's count or a position past the destination
 *    is `INVALID_ANSWER`, an item not on the latest revision `ITEM_NOT_FOUND`,
 *    a restore of a version the plan does not have `REVISION_NOT_FOUND`; for a
 *    brief edit (pl-47), dates the intake would refuse `INVALID_DATES`, then a
 *    shorter trip that would drop a pinned item `PLAN_INFEASIBLE`.
 *
 * A brief edit is a run, as a re-plan is: it resizes the base to the new dates,
 * re-packs what the change reached, and asks no model anything.
 *
 * ## One writer on the chain, without a race
 *
 * The invariant is pl-42's: one writer building on the latest revision at a
 * time, and a non-terminal run is how this file detects another. A re-plan's
 * checks and its `insertRun` are one synchronous transaction, and
 * `plan_runs_one_live` (migration 10) refuses a second live run from below. An
 * edit awaits a lookup between its checks and its write, so its write
 * transaction checks again. `persist` re-checks the base and the ceiling for
 * both.
 *
 * **An orphaned run cannot wedge a plan.** Nothing sweeps runs on boot, so a
 * row left in `fanning-out` by a restart would make its plan busy forever
 * under that index. Before the checks, a live-by-status run the queue does not
 * know is closed out through `cancelRun`, the one code path that already does
 * that — synchronously, with no `await` before the transaction that follows.
 * `startRun` and a re-plan both insert and enqueue in one tick, so a real
 * queued run is never mistaken for one.
 */

import { randomUUID } from "node:crypto";
import { groundingBudget, readsFinds, runFanOut, type FanOutResult } from "@planner/agent";
import {
  AppError,
  isAnswered,
  latestRevision,
  MAX_REVISIONS_PER_PLAN,
  slot,
  type Candidate,
  type QuestionNode,
  type PlanDetail,
  type PlanGap,
  type PlanRevision,
  type PlanView,
  type ReviseRequest,
  type ReviseResponse,
  type RevisionOperation,
  type Run,
  type TripBrief,
} from "@planner/contract";
import { QUESTION_TREE, validateAnswer } from "@planner/intake";
import {
  applyEdit,
  briefEditSlice,
  droppedPins,
  droppedPinsRefusal,
  editTransitions,
  NOTHING_MEASURED,
  replan,
  replanPool,
  restoreRevision,
  reviseBrief,
  tripSpan,
  type BriefChange,
  type EditOperation,
  type TravelTable,
} from "@planner/itinerary";
import type { AppContext } from "../context.ts";
import { insertCandidates, selectLatestItem, selectPlan } from "../db/plans.ts";
import { insertRun, selectLiveRun } from "../db/runs.ts";
import { groundingForRun } from "../grounding/cache.ts";
import { discoverAlongCorridor, hasCorridor, tripContextFor } from "./discovery.ts";
import {
  cancelRun,
  capacityFor,
  enqueueRun,
  moveTo,
  persist,
  readPlanView,
  record,
  recordUsage,
  runBudgetFor,
  type Spent,
} from "./orchestrator.ts";
import { revisionReason } from "./reason.ts";
import { measureTravel, runPlaces } from "./travel.ts";

type ReplanOperation = Extract<RevisionOperation, { kind: "replan" }>;

/** A brief edit as checked: both ends of each change. The run derives the days it re-packs. */
type BriefEdit = { kind: "brief" } & BriefChange;

/** What the checks found, for the step that acts on them. */
interface Admitted {
  plan: PlanDetail;
  /** The latest revision, which is the request's base. */
  latest: PlanRevision;
  /** The operation the revision will store, with the item resolved to its candidate and day. */
  operation: Exclude<RevisionOperation, { kind: "first-draft" | "brief" }> | BriefEdit;
}

export async function revisePlan(
  context: AppContext,
  input: { planId: string; request: ReviseRequest; signal: AbortSignal },
): Promise<ReviseResponse> {
  const { planId, request } = input;
  closeOrphanedRuns(context, planId);

  switch (request.kind) {
    case "replan":
      return { kind: "run", run: startReplan(context, planId, request) };
    case "brief":
      return { kind: "run", run: startBriefEdit(context, planId, request) };
    case "restore":
      return { kind: "revision", view: restore(context, planId, request) };
    case "move":
    case "remove":
      return { kind: "revision", view: await edit(context, planId, request, input.signal) };
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

/**
 * A live-by-status run the queue has never heard of is closed out, the way
 * `cancelRun` closes one — by calling it. Synchronous, so nothing can enqueue
 * between this and the transaction the caller opens next.
 */
function closeOrphanedRuns(context: AppContext, planId: string): void {
  const live = selectLiveRun(context.db, planId);
  if (live !== undefined && !context.runs.has(live.id)) {
    context.logger.warn("closing a run no process is running", { run: live.id, plan: planId });
    cancelRun(context, live.id);
  }
}

/** Checks 1 to 5, in order. Synchronous: call it inside the transaction that acts on it. */
function admit(context: AppContext, planId: string, request: ReviseRequest): Admitted {
  const plan = selectPlan(context.db, planId);
  if (plan === undefined) {
    throw new AppError("PLAN_NOT_FOUND", undefined, { details: { plan: planId } });
  }

  refuseIfBusy(context, planId);

  const latest = latestRevision(plan);
  if (latest?.id !== request.baseRevisionId || latest === null) {
    throw new AppError("REVISION_STALE", undefined, {
      details: { base: request.baseRevisionId, latest: latest?.id ?? null },
    });
  }

  if (plan.revisions.length >= MAX_REVISIONS_PER_PLAN) {
    throw new AppError("REVISION_LIMIT_REACHED", undefined, {
      details: { limit: MAX_REVISIONS_PER_PLAN },
    });
  }

  const dayCount = latest.days.length;

  switch (request.kind) {
    case "replan": {
      // A dates edit (pl-47) changes the count only by appending a revision, so
      // a request built on an older count is already stale above. This is a
      // client naming a day the plan never had, which a correct one cannot send.
      const outside = request.days.filter((day) => day >= dayCount);
      if (outside.length > 0) {
        throw new AppError("INVALID_ANSWER", "A re-plan can only name days this plan has.", {
          details: { days: outside, dayCount },
        });
      }
      return {
        plan,
        latest,
        operation: {
          kind: "replan",
          days: [...request.days],
          specialists: [...request.specialists],
          note: request.note,
        },
      };
    }

    case "move":
    case "remove": {
      const placed = selectLatestItem(context.db, { planId, itemId: request.itemId });
      if (placed === undefined) {
        throw new AppError("ITEM_NOT_FOUND", undefined, { details: { item: request.itemId } });
      }
      if (request.kind === "remove") {
        return {
          plan,
          latest,
          operation: {
            kind: "remove",
            candidateId: placed.candidateId,
            fromDayIndex: placed.dayIndex,
          },
        };
      }

      const destination = latest.days[request.toDayIndex];
      if (destination === undefined) {
        throw new AppError("INVALID_ANSWER", "An item can only move to a day this plan has.", {
          details: { toDayIndex: request.toDayIndex, dayCount },
        });
      }
      // `toPosition` counts the destination **after** the item has left its
      // source (pl-42), so a same-day move has one fewer place to land.
      const length = destination.items.length - (request.toDayIndex === placed.dayIndex ? 1 : 0);
      if (request.toPosition > length) {
        throw new AppError("INVALID_ANSWER", "An item can only move to a place on that day.", {
          details: { toDayIndex: request.toDayIndex, toPosition: request.toPosition, length },
        });
      }
      return {
        plan,
        latest,
        operation: {
          kind: "move",
          candidateId: placed.candidateId,
          fromDayIndex: placed.dayIndex,
          toDayIndex: request.toDayIndex,
          toPosition: request.toPosition,
        },
      };
    }

    case "restore": {
      // Restoring the latest is legal — "earlier than the revision it
      // produces" (pl-42) — and gives an empty diff. No refusal is invented
      // for it.
      if (request.revision > latest.revision) {
        throw new AppError("REVISION_NOT_FOUND", undefined, {
          details: { revision: request.revision, latest: latest.revision },
        });
      }
      return { plan, latest, operation: { kind: "restore", revision: request.revision } };
    }

    case "brief":
      return { plan, latest, operation: admitBriefEdit(context, plan, latest, request) };
  }
}

/**
 * The brief edit's own checks (pl-47), after the shared ones, in order: the
 * dates by the intake's rules, the budget by its schema alone, then a pin on a
 * day the new dates drop — synchronously, so a refusal knowable now never
 * arrives after a 202.
 */
function admitBriefEdit(
  context: AppContext,
  plan: PlanDetail,
  latest: PlanRevision,
  request: Extract<ReviseRequest, { kind: "brief" }>,
): BriefEdit {
  const from = latest.brief;
  // `uncheckedForRevision`'s guard, and the same sentence: a stored revision
  // always has dates, because `startRun` refuses a brief without them.
  if (!isAnswered(from.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }

  if (request.dates !== undefined) {
    validateAnswer(
      datesQuestion(),
      { state: "answered", value: { kind: "dates", value: request.dates } },
      context.now(),
    );
  }
  // A budget needs nothing past the schema: `validateAnswer`'s `budget` case
  // says the schema is the whole check, and the route has already parsed it.

  if (request.dates !== undefined) {
    const dropped = droppedPins(latest, tripSpan(request.dates).dayCount);
    if (dropped.length > 0) throw droppedPinsRefusal(dropped, plan.candidates);
  }

  return {
    kind: "brief",
    dates: request.dates === undefined ? null : { from: from.dates.value, to: request.dates },
    budget: request.budget === undefined ? null : { from: from.budget, to: request.budget },
  };
}

/**
 * The tree's dates question, found by what it fills and never by its id: the
 * tree is content, and an id is not what this check is about.
 */
function datesQuestion(): QuestionNode {
  const node = QUESTION_TREE.nodes.find(
    (each) => each.fills.scope === "core" && each.fills.slot === "dates",
  );
  if (node === undefined) {
    throw new AppError("INTERNAL", "The question tree has no question for the trip's dates.");
  }
  return node;
}

function refuseIfBusy(context: AppContext, planId: string): void {
  const live = selectLiveRun(context.db, planId);
  if (live !== undefined) {
    throw new AppError("PLAN_BUSY", undefined, { details: { run: live.id } });
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Restore version _n_ as a new revision: `restoreRevision`, then the write, in
 * one transaction with the checks. No grounding call and no lookup of any kind
 * — the target's `travelFromPrevious` is still what those days were packed
 * against, and its pins come as it stored them (pl-43's Log, answered
 * 2026-09-13).
 */
function restore(
  context: AppContext,
  planId: string,
  request: Extract<ReviseRequest, { kind: "restore" }>,
): PlanView {
  const createdAt = context.now().toISOString();

  context.db.transaction((): void => {
    const { plan } = admit(context, planId, request);
    const target = plan.revisions.find((each) => each.revision === request.revision);
    if (target === undefined) {
      // Unreachable: revisions are dense from 1, and `admit` checked the upper bound.
      throw new AppError("REVISION_NOT_FOUND", undefined, {
        details: { revision: request.revision },
      });
    }

    const next = restoreRevision(target, {
      id: randomUUID(),
      reason: revisionReason({ kind: "restore", revision: target.revision }),
      createdAt,
    });
    persist(context, planId, next, createdAt, request.baseRevisionId);
  })();

  return readPlanView(context, planId);
}

// ---------------------------------------------------------------------------
// Move and remove
// ---------------------------------------------------------------------------

/**
 * One item moved or removed: measure exactly the transitions the edit creates,
 * then write in a transaction that checks again.
 *
 * **The lookup is sized to the edit.** One call per place still to locate plus
 * one matrix, capped by the deployment's own `MAX_GROUNDING_CALLS`, so an
 * ordinary edit is never refused for budget and a refused lookup is
 * `over-budget` rather than `not-established`. The draft wrote located
 * coordinates onto its candidates, so this is usually one matrix, most often a
 * cache hit.
 *
 * **`applyEdit` runs inside the write, against the latest revision re-read
 * there.** Nothing but a pin can change a revision in place (pl-22), and a pin
 * changes no position, so the pairs measured before the `await` are still the
 * pairs `applyEdit` asks about — and a pin set during the lookup is carried
 * rather than lost. A `PLAN_INFEASIBLE` from it rolls the transaction back.
 */
async function edit(
  context: AppContext,
  planId: string,
  request: Extract<ReviseRequest, { kind: "move" } | { kind: "remove" }>,
  signal: AbortSignal,
): Promise<PlanView> {
  const { plan, latest, operation } = context.db.transaction(() =>
    admit(context, planId, request),
  )();
  const editing = operation as EditOperation;

  const pairs = editTransitions(latest, editing);
  const named = new Set(pairs.flatMap((pair) => [pair.fromCandidateId, pair.toCandidateId]));
  const candidates = plan.candidates.filter((candidate) => named.has(candidate.id));
  const travel = await measureEdit(context, latest.brief, candidates, signal);

  // A request whose socket closed during the lookup writes nothing.
  if (signal.aborted) throw new AppError("CANCELED");

  const title = plan.candidates.find((each) => each.id === editing.candidateId)?.title;
  if (title === undefined) {
    throw new AppError("INTERNAL", "A placed item names a candidate the plan does not hold.", {
      details: { candidate: editing.candidateId },
    });
  }
  const reason = revisionReason(
    editing.kind === "move"
      ? {
          kind: "move",
          title,
          fromDayIndex: editing.fromDayIndex,
          toDayIndex: editing.toDayIndex,
        }
      : { kind: "remove", title, fromDayIndex: editing.fromDayIndex },
  );
  const createdAt = context.now().toISOString();

  context.db.transaction((): void => {
    refuseIfBusy(context, planId);
    const current = selectPlan(context.db, planId);
    const previous = current === undefined ? null : latestRevision(current);
    if (current === undefined || previous?.id !== request.baseRevisionId || previous === null) {
      throw new AppError("REVISION_STALE", undefined, {
        details: { base: request.baseRevisionId, latest: previous?.id ?? null },
      });
    }

    const { revision } = applyEdit({
      brief: previous.brief,
      candidates: current.candidates,
      previous,
      operation: editing,
      travel,
      revision: { id: randomUUID(), reason, createdAt },
    });
    persist(context, planId, revision, createdAt, request.baseRevisionId);
  })();

  return readPlanView(context, planId);
}

async function measureEdit(
  context: AppContext,
  brief: TripBrief,
  candidates: readonly Candidate[],
  signal: AbortSignal,
): Promise<TravelTable> {
  const places = runPlaces(candidates);
  // No pair, or a pair between two things with no place: nothing to ask.
  if (places.all.length === 0) return NOTHING_MEASURED;

  const grounding = groundingForRun(
    context.grounding,
    groundingBudget(Math.min(context.config.maxGroundingCalls, places.toLocate.length + 1)),
  );
  const measured = await measureTravel({
    candidates,
    places,
    provider: grounding,
    trip: tripContextFor(brief),
    logger: context.logger,
    signal,
    // An edit is not a run and emits no frame: there is no stream to send it to.
    onProgress: () => undefined,
  });
  return measured.travel;
}

// ---------------------------------------------------------------------------
// Re-plan
// ---------------------------------------------------------------------------

/**
 * Check, insert the run and enqueue it — the checks and the insert in one
 * synchronous transaction, the enqueue in the same tick.
 */
function startReplan(
  context: AppContext,
  planId: string,
  request: Extract<ReviseRequest, { kind: "replan" }>,
): Run {
  const runId = randomUUID();
  const timestamp = context.now().toISOString();

  const { run, brief, operation } = context.db.transaction(() => {
    const admitted = admit(context, planId, request);
    return {
      // The base revision's, never `readIntake` and never `plan.brief`: the
      // intake stays editable, and the plan's snapshot is the first draft's,
      // which a dates or budget edit has since left behind (pl-47).
      brief: admitted.latest.brief,
      operation: admitted.operation as ReplanOperation,
      run: insertRun(context.db, {
        id: runId,
        planId,
        kind: "replan",
        status: "queued",
        now: timestamp,
      }),
    };
  })();

  enqueueRun(context, { runId, planId }, async (signal, spent) => {
    await executeReplan(
      context,
      { runId, planId, brief, operation, base: request.baseRevisionId },
      signal,
      spent,
    );
  });

  return run;
}

interface ReplanJob {
  runId: string;
  planId: string;
  brief: TripBrief;
  operation: ReplanOperation;
  /** The revision the request built on, which `persist` checks is still the latest. */
  base: string;
}

/**
 * The re-plan run.
 *
 * ```
 * queued ─┬─► grounding (discover) ─► fanning-out ─┬─► grounding (measure) ─► composing ─► done
 *         ├─► fanning-out ─────────────────────────┤
 *         ├─► grounding (measure) ─────────────────┘   zero specialists named
 *         └─► composing                                zero specialists, nothing to measure
 * ```
 */
async function executeReplan(
  context: AppContext,
  job: ReplanJob,
  signal: AbortSignal,
  spent: Spent,
): Promise<void> {
  const { runId, planId, brief, operation, base } = job;
  const { days, specialists, note } = operation;
  const logger = context.logger.child({ run: runId });

  // One budget for the run, discovery and measuring alike, as a draft's.
  const grounding = groundingForRun(
    context.grounding,
    groundingBudget(context.config.maxGroundingCalls),
  );

  // --- The roster, first. With nobody named there is no fan-out to announce
  // one, so it is recorded here: `roster_size = 0`, "nobody is running", not
  // `null`, "not decided yet". Once only — `record` resets `specialists_done`.
  if (specialists.length === 0) {
    record(context, runId, { type: "roster", running: [], droppedForBudget: [], total: 0 });
  }

  // --- Discovery, only when it would change a prompt. Finds are not stored, so
  // re-planning `food` without them would be a worse specialist than the one
  // that drafted, and the diff would present that regression as a choice.
  const discovering = hasCorridor(brief) && specialists.some((each) => readsFinds(each));
  if (discovering && !moveTo(context, runId, "grounding")) return;
  const discovered = discovering
    ? await discoverAlongCorridor({
        brief,
        provider: grounding,
        logger,
        signal,
        onProgress: (event) => {
          record(context, runId, event);
        },
      })
    : null;

  // --- The named specialists, and only them.
  let fanOut: FanOutResult | null = null;
  if (specialists.length > 0) {
    if (!moveTo(context, runId, "fanning-out")) return;
    fanOut = await runFanOut({
      only: specialists,
      note,
      finds: discovered?.finds ?? [],
      brief,
      // The whole trip's: a candidate belongs to the pool, not to a day.
      capacity: capacityFor(brief),
      provider: context.model,
      budget: runBudgetFor(context.config),
      runId,
      signal,
      onProgress: (event) => {
        record(context, runId, event);
      },
      onUsage: (next) => {
        spent.usage = next;
      },
    });
  }
  const fresh = fanOut?.candidates ?? [];

  // --- The plan, read once. Stored order, this run's candidates appended: the
  // packer places in input order, and `selectPlan` orders by id, so reading the
  // pool back after inserting would interleave them.
  const before = readLatest(context, planId, base);
  const pool = [...before.plan.candidates, ...fresh];

  // --- Measure what the slice may place, and nothing else. `replanPool` is
  // what `replan` packs from, so the table and the days agree by construction.
  const measurable = replanPool({ candidates: pool, previous: before.latest, days });
  const places = runPlaces(measurable);
  if (places.all.length > 0 && !moveTo(context, runId, "grounding")) return;
  const measured =
    places.all.length === 0
      ? { candidates: measurable, travel: NOTHING_MEASURED }
      : await measureTravel({
          candidates: measurable,
          places,
          provider: grounding,
          trip: tripContextFor(brief),
          logger,
          signal,
          onProgress: (event) => {
            record(context, runId, event);
          },
        });
  const located = new Map(measured.candidates.map((candidate) => [candidate.id, candidate]));
  const locate = (candidate: Candidate): Candidate => located.get(candidate.id) ?? candidate;

  // --- Compose. No `await` from here to the write.
  const composedAt = context.now();
  const timestamp = composedAt.toISOString();

  // Re-read: a pin set while the specialists ran or grounding measured is on
  // that revision in place (pl-22), and `replan` must honour it.
  const { latest } = readLatest(context, planId, base);

  // Only the new candidates: the pool's are rows already. A run that fails in
  // `replan` leaves these in the pool on purpose — they were paid for, and a
  // later free re-pack can draw on them.
  insertCandidates(context.db, {
    planId,
    runId,
    candidates: fresh.map(locate),
    now: timestamp,
  });

  if (!moveTo(context, runId, "composing")) return;

  const ran = fanOut?.roster.ran.map((entry) => entry.specialist) ?? [];
  const composed = replan({
    brief,
    candidates: pool.map(locate),
    previous: latest,
    // What was asked, not what ran: the caption says what happened.
    operation,
    travel: measured.travel,
    gaps: carriedGaps(latest, operation, fanOut),
    // When discovery ran, its evidence; when it did not, `replan` keeps the
    // base's — evidence persists until something re-asks.
    ...(discovered === null ? {} : { coverage: discovered.coverage, reading: discovered.reading }),
    revision: {
      id: `${runId}-1`,
      reason: revisionReason({ kind: "replan", days, ran }),
      createdAt: timestamp,
    },
    now: composedAt,
  });

  const revisionId = persist(context, planId, composed.revision, timestamp, base);

  recordUsage(context, runId, spent.usage);
  if (!moveTo(context, runId, "done")) return;
  context.events.done(runId, planId, revisionId);
}

/**
 * The base's gaps minus every entry for a named specialist, plus the fan-out's,
 * which cover the named set only. A zero-specialist re-plan carries the base's
 * verbatim. `replan` then drops any gap its days contradict and keeps at most
 * one per specialist.
 */
function carriedGaps(
  base: PlanRevision,
  operation: ReplanOperation,
  fanOut: FanOutResult | null,
): PlanGap[] {
  if (fanOut === null) return base.gaps;
  const named = new Set(operation.specialists);
  return [...base.gaps.filter((gap) => !named.has(gap.specialist)), ...fanOut.gaps];
}

/** The plan and its latest revision, which must still be `base`. */
function readLatest(
  context: AppContext,
  planId: string,
  base: string,
): { plan: PlanDetail; latest: PlanRevision } {
  const plan = selectPlan(context.db, planId);
  if (plan === undefined) {
    throw new AppError("PLAN_NOT_FOUND", undefined, { details: { plan: planId } });
  }
  const latest = latestRevision(plan);
  if (latest === null || latest.id !== base) {
    // Unreachable while the one-writer rule holds; asserted as `persist` does.
    throw new AppError("REVISION_STALE", undefined, {
      details: { base, latest: latest?.id ?? null },
    });
  }
  return { plan, latest };
}

// ---------------------------------------------------------------------------
// Brief edits (pl-47)
// ---------------------------------------------------------------------------

/**
 * Check, insert the run and enqueue it, as `startReplan` does. A brief edit
 * spends the runs bucket and is a `replan` run: added and re-packed days need
 * grounding, and pl-42 made every re-plan a run for exactly that reason.
 */
function startBriefEdit(
  context: AppContext,
  planId: string,
  request: Extract<ReviseRequest, { kind: "brief" }>,
): Run {
  const runId = randomUUID();
  const timestamp = context.now().toISOString();

  const { run, brief, change } = context.db.transaction(() => {
    const admitted = admit(context, planId, request);
    const briefEdit = admitted.operation as BriefEdit;
    return {
      // The base revision's brief with the edited slots answered. Never
      // `plan.brief`, which is the first draft's.
      brief: {
        ...structuredClone(admitted.latest.brief),
        ...(briefEdit.dates === null ? {} : { dates: slot.answered(briefEdit.dates.to) }),
        ...(briefEdit.budget === null ? {} : { budget: slot.answered(briefEdit.budget.to) }),
      },
      change: { dates: briefEdit.dates, budget: briefEdit.budget },
      run: insertRun(context.db, {
        id: runId,
        planId,
        kind: "replan",
        status: "queued",
        now: timestamp,
      }),
    };
  })();

  enqueueRun(context, { runId, planId }, async (signal, spent) => {
    await executeBriefEdit(
      context,
      { runId, planId, brief, change, base: request.baseRevisionId },
      signal,
      spent,
    );
  });

  return run;
}

interface BriefEditJob {
  runId: string;
  planId: string;
  /** The edited brief. */
  brief: TripBrief;
  change: BriefChange;
  /** The revision the request built on, which `persist` checks is still the latest. */
  base: string;
}

/**
 * The brief edit's run. No specialist is named and nothing is discovered, so
 * no model is asked anything: a budget cut draws on the pool the plan already
 * has, and asking for new lodging after one is a re-plan naming `lodging`.
 *
 * ```
 * queued ─┬─► grounding (measure) ─► composing ─► done
 *         └─► composing                             nothing in the slice to measure
 * ```
 */
async function executeBriefEdit(
  context: AppContext,
  job: BriefEditJob,
  signal: AbortSignal,
  spent: Spent,
): Promise<void> {
  const { runId, planId, brief, change, base } = job;
  const logger = context.logger.child({ run: runId });

  // Nobody is running, and that is decided: `roster_size = 0`, not `null`.
  record(context, runId, { type: "roster", running: [], droppedForBudget: [], total: 0 });

  // --- Measure what the slice may place, over the resized revision, and
  // nothing else. `reviseBrief` resizes and slices the same way, so the table
  // and the days agree by construction. Kept days keep their stored travel.
  const before = readLatest(context, planId, base);
  const { resized, slice } = briefEditSlice({
    previous: before.latest,
    brief,
    change,
    candidates: before.plan.candidates,
  });
  // An empty slice re-packs nothing, so nothing it could place is worth a
  // lookup — `replanPool` over no days would still offer every unplaced one.
  const measurable =
    slice.length === 0
      ? []
      : replanPool({ candidates: before.plan.candidates, previous: resized, days: slice });
  const places = runPlaces(measurable);
  if (places.all.length > 0 && !moveTo(context, runId, "grounding")) return;
  const measured =
    places.all.length === 0
      ? { candidates: measurable, travel: NOTHING_MEASURED }
      : await measureTravel({
          candidates: measurable,
          places,
          provider: groundingForRun(
            context.grounding,
            groundingBudget(context.config.maxGroundingCalls),
          ),
          trip: tripContextFor(brief),
          logger,
          signal,
          onProgress: (event) => {
            record(context, runId, event);
          },
        });
  const located = new Map(measured.candidates.map((candidate) => [candidate.id, candidate]));
  const locate = (candidate: Candidate): Candidate => located.get(candidate.id) ?? candidate;

  // --- Compose. No `await` from here to the write.
  const composedAt = context.now();
  const timestamp = composedAt.toISOString();

  // Re-read: a pin set while grounding measured is on that revision in place
  // (pl-22). On a day the new dates drop, `reviseBrief` refuses it, and the
  // run fails with `PLAN_INFEASIBLE` and its findings.
  const { plan, latest } = readLatest(context, planId, base);

  if (!moveTo(context, runId, "composing")) return;

  const composed = reviseBrief({
    brief,
    candidates: plan.candidates.map(locate),
    previous: latest,
    change,
    travel: measured.travel,
    // Verbatim: nothing re-ran, and evidence persists until something re-asks.
    gaps: latest.gaps,
    coverage: latest.coverage,
    reading: latest.reading,
    revision: {
      id: `${runId}-1`,
      reason: revisionReason({
        kind: "brief",
        dates: change.dates !== null,
        budget: change.budget !== null,
        before: latest.days.length,
        after: resized.days.length,
        everyDay: slice.length === resized.days.length,
      }),
      createdAt: timestamp,
    },
    now: composedAt,
  });

  const revisionId = persist(context, planId, composed.revision, timestamp, base);

  recordUsage(context, runId, spent.usage);
  if (!moveTo(context, runId, "done")) return;
  context.events.done(runId, planId, revisionId);
}
