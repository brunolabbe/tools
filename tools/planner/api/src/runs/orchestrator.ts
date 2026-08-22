/**
 * The run: a brief in, a plan revision out, and an account of it along the way.
 *
 * This is the seam pl-5 stopped at and pl-9 stopped at from the other side.
 * `runFanOut` turns a brief into candidates, `compose` turns candidates into a
 * revision, and until pl-16 the only place the two met was a unit test.
 *
 * ```
 * POST /api/plans ─► brief from the intake
 *                    plan row  ◄── written BEFORE the fan-out, so the run has
 *                       │           somewhere to report to
 *                       ▼
 *                    run row, queued ─► queue (MAX_CONCURRENT_RUNS)
 *                       │
 *                       ▼  fanning-out    runFanOut ─► candidates + gaps
 *                       │                 progress ─► SSE, one frame per specialist
 *                       ▼  grounding      measureTravel ─► located places + a
 *                       │                 travel table; skipped when there is
 *                       │                 nothing to measure (pl-27)
 *                       ▼  composing      compose   ─► NewRevision
 *                       ▼  done           appendRevision, persisted
 * ```
 *
 * Three things it must get right, and each is a trap the brief named:
 *
 * **Cancel reaches the provider.** The queue's `AbortSignal` is handed to
 * `runFanOut`, which hands it to every in-flight `ModelRequest`. Moving a row to
 * `canceled` without that would leave the fan-out running and the bill accruing.
 *
 * **A cancellation is not a `PlanGap`.** pl-5's orchestrator rethrows rather
 * than recording one, precisely so a canceled draft cannot look like a completed
 * one with holes — so nothing here catches a cancellation and converts it. A
 * canceled run writes no revision at all.
 *
 * **A plan with no revisions is a real state.** It exists from the moment the
 * plan row is written until the composer is done, and `latestRevision` returns
 * `null` for it on purpose. Every reader handles it; none of them treats it as
 * missing.
 */

import { randomUUID } from "node:crypto";
import { groundingBudget, runFanOut, type RunBudget } from "@planner/agent";
import {
  AppError,
  appendRevision,
  canRunTransition,
  isAnswered,
  latestRevision,
  missingRequiredSlots,
  TERMINAL_RUN_STATUSES,
  type Plan,
  type PlanDetail,
  type PlanView,
  type Run,
  type RunProgress,
  type RunStatus,
  type TripBrief,
} from "@planner/contract";
import type { TripCapacity } from "@planner/agent";
import {
  compose,
  dayCapacity,
  NOTHING_MEASURED,
  tripSpan,
  uncheckedForRevision,
} from "@planner/itinerary";
import type { ApiConfig } from "../config.ts";
import type { AppContext } from "../context.ts";
import {
  insertCandidates,
  insertPlan,
  insertRevision,
  planExists,
  selectPlan,
  selectPlans,
  touchPlan,
  updateItemPin,
} from "../db/plans.ts";
import {
  insertRun,
  selectRun,
  updateRunProgress,
  updateRunRoster,
  updateRunStatus,
} from "../db/runs.ts";
import { evictExpiredGrounding, groundingForRun } from "../grounding/cache.ts";
import { intakeTitle } from "../intakes/title.ts";
import { readIntake } from "../intakes/state.ts";
import { measureTravel, runPlaces } from "./travel.ts";

/**
 * What the first draft's revision says it is.
 *
 * `reason` is the diff's caption, and the first draft's is simply that it is the
 * first draft — there is nothing before it to have changed.
 */
const FIRST_DRAFT_REASON = "The first draft.";

/** A plan whose brief said nothing nameable. Never rendered as an id. */
const UNTITLED = "Untitled trip";

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * How many specialists this deployment can afford, and what each may spend.
 *
 * `RUN_TOKEN_BUDGET` is spent **by degrading the roster**, not by stopping
 * partway: it divides down into a number of specialists this run can pay for,
 * and the lower of that and `MAX_SPECIALISTS` is the cap `runFanOut` enforces
 * before a single request goes out. A run that discovered the ceiling halfway
 * through would have paid for a plan it cannot ship — §9's whole point.
 *
 * `MAX_SPECIALISTS` stays at its default of 5 even though some shapes roster
 * six, which means the budget specialist is dropped on those trips and the plan
 * carries a `specialist-dropped-for-budget` gap saying so. That is the cap
 * working: the composer sums cost bands in code whether or not a budget
 * specialist ran, and a cap nothing ever reaches is not a cost control.
 */
export function runBudgetFor(config: ApiConfig): RunBudget {
  const attempts = 2;
  const affordable =
    config.runTokenBudget === undefined
      ? Number.POSITIVE_INFINITY
      : Math.floor(config.runTokenBudget / (config.maxOutputTokens * attempts));

  return {
    // Floored at zero rather than at one: a token budget too small for even one
    // specialist means "run nothing", the plan comes back as gaps, and that is a
    // truthful answer. Quietly running one anyway would not be.
    maxSpecialists: Math.max(0, Math.min(config.maxSpecialists, affordable)),
    maxOutputTokens: config.maxOutputTokens,
    maxAttemptsPerSpecialist: attempts,
  };
}

/**
 * What a day holds and how many there are.
 *
 * Assembled here because `@planner/agent` does not import `@planner/itinerary` —
 * the numbers behind an appetite answer live in `limits.ts` and the fan-out
 * takes them as a required argument, so this layer is the one that knows both.
 */
function capacityFor(brief: TripBrief): TripCapacity {
  if (!isAnswered(brief.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }
  return { dayCount: tripSpan(brief.dates.value).dayCount, ...dayCapacity(brief) };
}

// ---------------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------------

/**
 * Refuse a brief too thin to plan from **before** anything is written.
 *
 * The same two checks `runFanOut` and `compose` each make, made once more up
 * here and for a different reason: theirs protect the algorithm, this one keeps
 * a request that can only fail from leaving an empty plan behind it. It is a
 * 400 the wizard can act on, with the missing slots in `details`.
 */
function assertDraftable(brief: TripBrief): void {
  const missing = missingRequiredSlots(brief);
  if (missing.length > 0) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing } });
  }
  if (!isAnswered(brief.shape)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["shape"] } });
  }
  if (!isAnswered(brief.dates)) {
    throw new AppError("BRIEF_INCOMPLETE", undefined, { details: { missing: ["dates"] } });
  }
}

export function startRun(context: AppContext, intakeId: string): Run {
  const { brief } = readIntake(context, intakeId);
  assertDraftable(brief);

  const now = context.now();
  const timestamp = now.toISOString();
  const planId = randomUUID();
  const runId = randomUUID();

  // The plan and the run land together: a run pointing at a plan that does not
  // exist, or a plan nothing is drafting, are both states no reader handles.
  const run = context.db.transaction((): Run => {
    insertPlan(context.db, {
      id: planId,
      title: intakeTitle(brief) ?? UNTITLED,
      brief,
      now: timestamp,
    });
    return insertRun(context.db, { id: runId, planId, status: "queued", now: timestamp });
  })();

  context.runs.enqueue({
    runId,
    run: async (signal) => {
      try {
        await execute(context, { runId, planId, brief }, signal);
      } finally {
        // The grounding cache's other sweep — the first is on boot (pl-25).
        // Here rather than inside `execute` because it is true of a run however
        // it ended, including a canceled one, and because it is housekeeping
        // rather than part of drafting a plan.
        //
        // Skipped while shutting down: the queue cancels what is in flight and
        // the database closes behind it, and a failed DELETE would turn a run
        // that finished into a logged task rejection.
        //
        // And guarded even so, though it is worth being exact about what that
        // buys. The run row is already committed by the time `execute` returns,
        // and the queue catches a rejected task and releases its slot — so an
        // unguarded `SQLITE_BUSY` here does **not** lose the plan or leave the
        // queue wedged. What it does is reject the task, which `onTaskError`
        // logs at error level as "run task rejected": a spurious line blaming
        // the run for a failed DELETE it had nothing to do with, on a run that
        // succeeded. Housekeeping reports itself; the next boot sweeps whatever
        // this missed.
        if (!context.isShuttingDown()) {
          try {
            evictExpiredGrounding(context.db, context.now(), context.logger);
          } catch (error: unknown) {
            // The cause, not only the code. `AppError.from` wraps anything
            // untyped as `INTERNAL` with the catalog's generic sentence, so a
            // lock contention and a full disk would otherwise be the same log
            // line — and this line is the only place either of them is ever
            // mentioned.
            context.logger.warn("grounding cache eviction failed", {
              run: runId,
              code: AppError.from(error).code,
              cause: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    },
  });

  return run;
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------

/**
 * Move the run, refusing an illegal move.
 *
 * `RUN_TRANSITIONS` is the authority and it lives in the contract, so `web` and
 * this file cannot disagree about what a run may do next. An illegal move is a
 * bug here rather than an operational condition — it is logged and dropped
 * rather than thrown, because failing a run because we mis-sequenced our own
 * bookkeeping would lose a plan the user is otherwise about to get.
 */
function moveTo(
  context: AppContext,
  runId: string,
  to: RunStatus,
  error: AppError | null = null,
): boolean {
  const current = selectRun(context.db, runId);
  if (current === undefined) return false;
  if (!canRunTransition(current.status, to)) {
    context.logger.warn("illegal run transition", { run: runId, from: current.status, to });
    return false;
  }

  updateRunStatus(context.db, {
    id: runId,
    status: to,
    now: context.now().toISOString(),
    terminal: TERMINAL_RUN_STATUSES.has(to),
    error: error === null ? null : error.toPayload(),
  });
  context.events.status(runId, to);
  return true;
}

interface RunInput {
  runId: string;
  planId: string;
  brief: TripBrief;
}

async function execute(context: AppContext, input: RunInput, signal: AbortSignal): Promise<void> {
  const { runId, planId, brief } = input;

  try {
    if (!moveTo(context, runId, "fanning-out")) return;

    const result = await runFanOut({
      brief,
      capacity: capacityFor(brief),
      provider: context.model,
      budget: runBudgetFor(context.config),
      runId,
      signal,
      onProgress: (event) => {
        record(context, runId, event);
      },
    });

    // --- Grounding, between the fan-out and the composer (pl-27).
    //
    // The state is entered only when there is something to measure, and the
    // `fanning-out → composing` edge stays legal for exactly that: emitting a
    // state the run spends no time in, to make a diagram come true, is _never
    // fake progress_ broken for decoration (see `RUN_TRANSITIONS`).
    const places = runPlaces(result.candidates);
    if (places.all.length > 0 && !moveTo(context, runId, "grounding")) return;

    const measured =
      places.all.length === 0
        ? { candidates: [...result.candidates], travel: NOTHING_MEASURED }
        : await measureTravel({
            candidates: result.candidates,
            places,
            // The cache with this run's budget inside it (pl-25): a hit costs
            // nothing, a miss claims a call, and a refusal makes none. The
            // budget is not held here because holding it here is what would
            // charge for hits.
            provider: groundingForRun(
              context.grounding,
              groundingBudget(context.config.maxGroundingCalls),
            ),
            logger: context.logger.child({ run: runId }),
            signal,
            onProgress: (event) => {
              record(context, runId, event);
            },
          });

    const composedAt = context.now();
    const timestamp = composedAt.toISOString();

    // Written after grounding, not before: the places the pass located now
    // carry their coordinates, and a candidate stored before that would have
    // to be re-read and re-written to gain them.
    insertCandidates(context.db, {
      planId,
      runId,
      candidates: measured.candidates,
      now: timestamp,
    });

    if (!moveTo(context, runId, "composing")) return;

    const composed = compose({
      brief,
      candidates: measured.candidates,
      travel: measured.travel,
      gaps: result.gaps,
      revision: { id: `${runId}-1`, reason: FIRST_DRAFT_REASON, createdAt: timestamp },
      now: composedAt,
    });

    // `unchecked` is deliberately not persisted here, and pl-27 did not change
    // that: what a plan did not *check* is a derivation from the revision, and
    // `uncheckedForRevision` reads it back off the days on every read. What is
    // persisted is the *evidence* underneath it — each item's measured
    // transition — because a cache row expires and a plan still has to be able
    // to say what its days were packed against.
    const revisionId = persist(context, planId, composed.revision, timestamp);

    if (!moveTo(context, runId, "done")) return;
    context.events.done(runId, planId, revisionId);
  } catch (error: unknown) {
    // A cancellation is not a failure and it is not a gap. pl-5 rethrows it out
    // of the fan-out rather than recording one, so that a canceled draft cannot
    // be mistaken for a completed one with holes; catching it here to write a
    // revision anyway would undo exactly that.
    if (isCancellation(error, signal)) {
      const canceled = new AppError("JOB_CANCELED");
      if (moveTo(context, runId, "canceled", canceled)) {
        context.events.canceled(runId, canceled.toPayload());
      }
      return;
    }

    const failure = AppError.from(error);
    context.logger.error("run failed", { run: runId, plan: planId, code: failure.code });
    if (moveTo(context, runId, "failed", failure)) {
      context.events.failed(runId, failure.toPayload());
    }
  }
}

/**
 * The fan-out's own account of itself, written down and forwarded.
 *
 * The payload is the contract's `RunProgress` and is passed through untouched;
 * the run id and the timestamp are added by the hub, which is the one place in
 * the tool that reads a clock for a frame.
 */
function record(context: AppContext, runId: string, event: RunProgress): void {
  switch (event.type) {
    case "roster":
      // Knowable before the first request goes out, which is what lets the UI
      // say "4 of 7" instead of showing a spinner.
      updateRunRoster(context.db, runId, event.total);
      break;
    case "specialist-finished":
    case "specialist-failed":
      updateRunProgress(context.db, runId, event.done);
      break;
    case "specialist-started":
      break;
    case "grounding":
      // Nothing is written down. `Run` carries the fan-out's counters and no
      // others (see `RunEvent`'s `snapshot`), so a client that attaches during
      // grounding has no number to catch up on and shows an indeterminate bar
      // until the next frame — which is §7's answer to a total nobody knows,
      // and is honest in a way replaying `rosterSize` under grounding's label
      // would not be. A column here would be a second thing to keep true; the
      // frame is the one that matters and it is forwarded below.
      break;
  }
  context.events.progress(runId, event);
}

/**
 * Number the revision, write it, and move the plan's clock.
 *
 * `appendRevision` derives the number and the parent from the plan rather than
 * accepting them, so this cannot produce an orphan; the database's
 * `UNIQUE (plan_id, revision)` refuses the one thing it could still get wrong,
 * which is two concurrent runs both drafting revision 1.
 */
function persist(
  context: AppContext,
  planId: string,
  next: Parameters<typeof appendRevision>[1],
  now: string,
): string {
  return context.db.transaction((): string => {
    const plan = selectPlan(context.db, planId);
    if (plan === undefined) {
      throw new AppError("PLAN_NOT_FOUND", undefined, { details: { plan: planId } });
    }

    const appended = appendRevision(plan, next);
    const revision = latestRevision(appended);
    if (revision === null) {
      throw new AppError("INTERNAL", "A revision was appended and did not appear.");
    }

    insertRevision(context.db, revision);
    touchPlan(context.db, planId, now);
    return revision.id;
  })();
}

/**
 * Was this the user stopping the run, or the run breaking?
 *
 * The same three tests `@planner/agent` makes, because the two layers have to
 * agree: the signal, the typed code the queue aborts with, and a bare
 * `AbortError` from anything that only speaks DOM.
 */
function isCancellation(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof AppError) return error.code === "CANCELED" || error.code === "JOB_CANCELED";
  return error instanceof Error && error.name === "AbortError";
}

// ---------------------------------------------------------------------------
// Reading and stopping
// ---------------------------------------------------------------------------

export function readRun(context: AppContext, id: string): Run {
  const run = selectRun(context.db, id);
  if (run === undefined) {
    throw new AppError("JOB_NOT_FOUND", undefined, { details: { run: id } });
  }
  return run;
}

export function readPlan(context: AppContext, id: string): PlanDetail {
  const plan = selectPlan(context.db, id);
  if (plan === undefined) {
    throw new AppError("PLAN_NOT_FOUND", undefined, { details: { plan: id } });
  }
  return plan;
}

/**
 * The plan, and what nothing checked about it.
 *
 * `unchecked` is derived here rather than stored, and derived from the stored
 * revision rather than by re-composing — see `uncheckedForRevision`. That is
 * what makes the honesty a property of the plan instead of a property of having
 * watched the run that produced it: the same list comes back on the tenth read,
 * a week later, in a different browser.
 *
 * A plan with no revisions yet — the state between `POST /api/plans` and the
 * composer finishing — has an empty list rather than a made-up one. There is no
 * draft to have failed to check anything about.
 */
export function readPlanView(context: AppContext, id: string): PlanView {
  const plan = readPlan(context, id);
  const revision = latestRevision(plan);

  return {
    plan,
    unchecked:
      revision === null
        ? []
        : uncheckedForRevision({ brief: plan.brief, candidates: plan.candidates, revision }),
  };
}

export function listPlans(context: AppContext): Plan[] {
  return selectPlans(context.db);
}

/**
 * Pin or unpin one placed item.
 *
 * **No revision is appended**, which is the point: a pin is a statement about
 * what the next re-plan may not move, not an edit to this draft (§6). The
 * plan's `updatedAt` still moves, because the list orders by it and a pin is a
 * change someone made to the plan.
 *
 * Returns the whole view rather than the item, so an open tab that pinned
 * something is holding the same document the next reader gets.
 */
export function pinItem(
  context: AppContext,
  input: { planId: string; itemId: string; pinned: boolean },
): PlanView {
  const now = context.now().toISOString();

  context.db.transaction((): void => {
    if (!planExists(context.db, input.planId)) {
      throw new AppError("PLAN_NOT_FOUND", undefined, { details: { plan: input.planId } });
    }
    if (!updateItemPin(context.db, input)) {
      throw new AppError("ITEM_NOT_FOUND", undefined, { details: { item: input.itemId } });
    }
    touchPlan(context.db, input.planId, now);
  })();

  return readPlanView(context, input.planId);
}

/**
 * Stop a run, whether it is waiting or already fanning out.
 *
 * The queue's `cancel` is what makes this reach the provider: it aborts the
 * controller whose signal every in-flight `ModelRequest` is carrying, and the
 * run's own catch does the bookkeeping. A run the queue has never heard of is
 * one that already finished — which is not an error, and is why the status is
 * only forced here when the run is still live.
 */
export function cancelRun(context: AppContext, id: string): Run {
  const run = readRun(context, id);
  if (TERMINAL_RUN_STATUSES.has(run.status)) return run;

  const stopped = context.runs.cancel(id);
  if (!stopped) {
    // Live by its status and absent from the queue: the process that was
    // running it went away. Nothing is going to move this row, so this call is
    // what closes it out.
    const canceled = new AppError("JOB_CANCELED");
    if (moveTo(context, id, "canceled", canceled)) {
      context.events.canceled(id, canceled.toPayload());
    }
  }

  return readRun(context, id);
}
