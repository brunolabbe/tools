/**
 * One id scheme for every revision this package produces (pl-43).
 *
 * `plan_days.id` and `plan_items.id` are global primary keys, so **every** new
 * revision needs fresh ids — a first draft, a re-plan, an edit, and a restore
 * that copies an older revision's days verbatim. A restore that kept revision
 * _n_'s ids would collide on insert. So the derivation lives here once, and
 * `compose`, `replan`, `applyEdit` and `restoreRevision` all go through it;
 * `api` never learns the scheme.
 *
 * Ids are derived rather than generated: a revision's id is already unique, so
 * `<revision>-day-3` cannot collide across revisions and stays the same if the
 * same inputs are composed twice. An item is keyed by its candidate rather than
 * by its position, so an item that moved between revisions is recognisably the
 * same thing — which is what makes the diff in §6 a diff.
 */

import type { PlanDay, PlanItem } from "@planner/contract";

/** An item as it will be stored, before it has this revision's id. */
export type UnkeyedItem = Omit<PlanItem, "id">;

/** A day as it will be stored, before it has this revision's ids. A `PlanDay` is one. */
export interface UnkeyedDay {
  dayIndex: number;
  date: string | null;
  items: readonly UnkeyedItem[];
}

/**
 * The same days under a new revision's ids, and nothing else changed.
 *
 * **Every nested object is a copy.** A frozen day, an edit's untouched items
 * and a restore all carry stored `travelFromPrevious` objects forward, and
 * `Object.freeze` is shallow (pl-24's finding): handing back the stored object
 * would let a caller that adjusts the result corrupt the revision it came from.
 *
 * The key order is `toPlanDays`' as it stood before pl-43, because a first
 * draft is compared byte for byte against a baseline written then.
 */
export function rekeyDays(days: readonly UnkeyedDay[], revisionId: string): PlanDay[] {
  return days.map((day) => ({
    id: `${revisionId}-day-${day.dayIndex}`,
    dayIndex: day.dayIndex,
    date: day.date,
    items: day.items.map((item): PlanItem => ({
      id: `${revisionId}-item-${item.candidateId}`,
      candidateId: item.candidateId,
      position: item.position,
      startsAt: item.startsAt,
      pinned: item.pinned,
      note: item.note,
      travelFromPrevious:
        item.travelFromPrevious === null ? null : structuredClone(item.travelFromPrevious),
    })),
  }));
}
