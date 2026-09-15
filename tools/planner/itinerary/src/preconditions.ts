/**
 * What a caller must already have checked before asking this package for a
 * revision (pl-43).
 *
 * **These are `INTERNAL`, never a user-facing refusal.** A day index the base
 * revision does not have, a candidate the plan has no record of, an item not on
 * the day an operation says it is on: each is a request `api` should have
 * refused first, with its own copy (pl-42 assigns those checks there). Reaching
 * this far means it did not. `INVALID_ANSWER` and `ITEM_NOT_FOUND` are sentences
 * about a user's request, and re-wording one here would be the tell that the
 * code is wrong. The one user-facing code this package raises is
 * `PLAN_INFEASIBLE`.
 *
 * `details.precondition` names which one broke, so a log line says so without
 * a stack trace.
 */

import { AppError, type Candidate, type PlanRevision } from "@planner/contract";

export function brokenPrecondition(
  precondition: string,
  facts: Record<string, string | number | null> = {},
): AppError {
  return new AppError("INTERNAL", undefined, { details: { precondition, ...facts } });
}

/**
 * A revision that places one candidate twice.
 *
 * `planRevisionSchema` refuses it, but the API never validates a stored
 * revision against the schema (pl-42's gate record), so this package does not
 * get to assume it. Every operation here names candidates, and a name that
 * matches two items means nothing.
 */
export function assertPlacedOnce(revision: PlanRevision): void {
  const seen = new Set<string>();
  for (const day of revision.days) {
    for (const item of day.items) {
      if (seen.has(item.candidateId)) {
        throw brokenPrecondition("candidate-placed-twice", {
          revisionId: revision.id,
          candidateId: item.candidateId,
        });
      }
      seen.add(item.candidateId);
    }
  }
}

/** Every day index named must be a day the revision has. */
export function assertDaysExist(revision: PlanRevision, dayIndexes: readonly number[]): void {
  for (const dayIndex of dayIndexes) {
    if (!revision.days.some((day) => day.dayIndex === dayIndex)) {
      throw brokenPrecondition("day-not-in-revision", { revisionId: revision.id, dayIndex });
    }
  }
}

/** Every candidate the revision places must be one the caller handed over. */
export function assertCandidatesKnown(
  revision: PlanRevision,
  byId: ReadonlyMap<string, Candidate>,
): void {
  for (const day of revision.days) {
    for (const item of day.items) {
      if (!byId.has(item.candidateId)) {
        throw brokenPrecondition("candidate-missing", {
          revisionId: revision.id,
          candidateId: item.candidateId,
        });
      }
    }
  }
}

/** A candidate by id, where a missing one is a caller's broken precondition. */
export function candidateOf(byId: ReadonlyMap<string, Candidate>, candidateId: string): Candidate {
  const found = byId.get(candidateId);
  if (found === undefined) throw brokenPrecondition("candidate-missing", { candidateId });
  return found;
}
