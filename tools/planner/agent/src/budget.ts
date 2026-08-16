/**
 * The per-run budget, and the roster it degrades to fit.
 *
 * `00-ANALYSIS.md` §9: one plan run is N specialists, each a prompt containing
 * the whole brief, plus a critic pass — roughly an order of magnitude more than
 * a single model call, and again, narrower, for every revision. So the
 * orchestrator owns a cap and **degrades the roster to fit rather than
 * discovering the ceiling mid-fan-out.** Discovering it halfway means paying for
 * half a plan and shipping neither.
 *
 * It is a security control as much as a cost one. Without it one open endpoint
 * is a stranger spending someone else's money, which is the cheapest denial of
 * service this tool could offer.
 *
 * ## Enforced before the fan-out, not during it
 *
 * Everything here is decided from the roster's *size*, which is known before the
 * first request goes out — that is also what makes the run's progress genuinely
 * knowable rather than a spinner. Nothing in this file is consulted again once
 * the specialists are running.
 *
 * ## What is dropped is recorded, never silently trimmed
 *
 * A dropped specialist becomes a `PlanGap` with reason
 * `specialist-dropped-for-budget`, which is a different sentence to a user than
 * "this trip had nothing for it to say". The repo's _never fake progress_ rule:
 * a plan that is thinner because of a cap says so.
 */

import type { PlanGap } from "@planner/contract";
import type { RosterDecision, RosterEntry } from "./roster.ts";

export interface RunBudget {
  /**
   * How many specialists one run may pay for. The architecture's
   * `MAX_SPECIALISTS`, which `api` reads from the environment and passes in —
   * this package reads none.
   */
  maxSpecialists: number;
  /**
   * Ceiling on one specialist's reply, in tokens. Passed to the provider on
   * every request; a planner answers in options, not in essays.
   */
  maxOutputTokens: number;
  /**
   * How many times a malformed reply may be re-asked before the specialist is
   * given up on. One is a real answer — a model that produced unparseable JSON
   * once often produces valid JSON when shown the error — and it bounds the
   * spend at twice the calls rather than at however many it takes.
   */
  maxAttemptsPerSpecialist: number;
}

/**
 * What a run costs when nobody says otherwise.
 *
 * `maxSpecialists` matches `01-ARCHITECTURE.md`'s `MAX_SPECIALISTS` default, and
 * `maxOutputTokens` matches `api`'s `MAX_OUTPUT_TOKENS`. They are duplicated as
 * numbers rather than imported because `api` owns the environment and this
 * package owns no configuration at all — a default here is what a library test
 * uses, not what a deployment runs.
 */
export const DEFAULT_RUN_BUDGET: RunBudget = {
  maxSpecialists: 5,
  maxOutputTokens: 2_048,
  maxAttemptsPerSpecialist: 2,
};

export interface BudgetedRoster {
  /** Who actually runs, after the cap. In roster order. */
  running: RosterEntry[];
  /** Who was cut, in the order they were cut — the least missed first out. */
  droppedForBudget: RosterEntry[];
}

/**
 * Cut the roster down to the cap, from the back.
 *
 * The back is `SPECIALIST_ORDER`'s back, and that order is the judgement about
 * what a plan loses least by losing — argued where it is defined. Nothing here
 * re-decides it: this function is arithmetic over an order someone else owns,
 * which is what keeps "why was lodging dropped" answerable by reading one list.
 *
 * A cap of zero is honoured rather than clamped. It means "run nothing", the
 * plan comes back as gaps and no days, and that is a truthful answer to a
 * budget of nothing — quietly running one specialist anyway would not be.
 */
export function applyBudget(roster: RosterDecision, budget: RunBudget): BudgetedRoster {
  const cap = Math.max(0, Math.trunc(budget.maxSpecialists));
  return {
    running: roster.running.slice(0, cap),
    droppedForBudget: roster.running.slice(cap),
  };
}

/**
 * The gaps a roster decision carries before a single specialist has run.
 *
 * Both kinds are the orchestrator's to know and the composer's to carry
 * untouched: `compose()` takes a `gaps` array precisely because it cannot tell
 * "never on the roster" from "dropped for budget" from "failed", and guessing
 * would be the composer inventing a reason.
 */
export function rosterGaps(roster: RosterDecision, budgeted: BudgetedRoster): PlanGap[] {
  return [
    ...budgeted.droppedForBudget.map((entry): PlanGap => ({
      specialist: entry.specialist,
      reason: "specialist-dropped-for-budget",
      detail:
        "This part of the plan was left out to keep the run inside its budget. Re-planning with a larger budget would fill it in.",
    })),
    ...roster.notApplicable.map((entry): PlanGap => ({
      specialist: entry.specialist,
      reason: "specialist-not-applicable",
      detail: entry.because,
    })),
  ];
}
