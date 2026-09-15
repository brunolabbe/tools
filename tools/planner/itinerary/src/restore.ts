/**
 * Restore revision _n_ as a new revision (pl-43).
 *
 * Copying days sounds like a caller's one-liner, and it is not one: every
 * revision needs fresh day and item ids (`ids.ts`), and a restore that kept
 * revision _n_'s would collide on insert.
 *
 * **Nothing is re-checked.** No critic, no clock and no travel: the target
 * shipped once, and its `travelFromPrevious` is still the evidence those days
 * were packed against (pl-42). **Pins are copied as revision _n_ holds them**,
 * which pl-22 froze when _n_ was superseded — a restore is a copy, and a latest
 * pin may name a candidate _n_ never placed (decided 2026-09-13). "Earlier than
 * the revision it produces" is `api`'s check.
 */

import type { NewRevision, PlanRevision } from "@planner/contract";
import { rekeyDays } from "./ids.ts";

export function restoreRevision(
  target: PlanRevision,
  revision: { id: string; reason: string; createdAt: string },
): NewRevision {
  return {
    id: revision.id,
    reason: revision.reason,
    operation: { kind: "restore", revision: target.revision },
    createdAt: revision.createdAt,
    days: rekeyDays(target.days, revision.id),
    gaps: [...structuredClone(target.gaps)],
    coverage: [...structuredClone(target.coverage)],
    reading: [...structuredClone(target.reading)],
  };
}
