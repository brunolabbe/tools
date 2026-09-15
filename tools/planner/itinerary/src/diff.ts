/**
 * What changed between a revision and its parent, by candidate (pl-43).
 *
 * **Derived, never stored** (pl-42): `api` calls `revisionDiffs` on every read
 * of a plan and serves the result on `PlanView.diffs`.
 *
 * ## A position is not a placement, and relative order is
 *
 * A candidate in the child and not the parent is `added`; one in the parent and
 * not the child is `removed`. For a candidate in both:
 *
 * 1. **A different `dayIndex` is `moved`.**
 * 2. **Otherwise it is `moved` only if the relative order among the items that
 *    stayed on that day changed.** The stayers of day _d_ are the candidates on
 *    _d_ in both revisions. A kept set is a largest subset whose child order
 *    agrees with its parent order — a longest increasing subsequence of child
 *    positions, read in parent order — and every stayer outside it is `moved`.
 *    An item added, removed or moved off the day is not a stayer, so it cannot
 *    make a neighbour look moved: removing B from `[A, B, C]` reports B alone.
 * 3. **Ties between largest kept sets are real** — `[A, B, C] → [B, A, C]` is
 *    "A moved down one" and "B moved up one" at once — and break in order:
 *    1. when the child's operation is a `move`, a set without its candidate, so
 *       the diff agrees with the caption;
 *    2. then the set keeping more items pinned in the child, since a re-pack
 *       leads a day with its pins and a pin reported as moved reads as
 *       overruled;
 *    3. then the lexicographically smallest list of parent positions.
 *
 * ## Cost
 *
 * Every diff on every read: up to `MAX_REVISIONS_PER_PLAN` × `MAX_PLAN_DAYS`
 * days, at most `MAX_ITEMS_PER_DAY` stayers each. The kept set is an O(n²)
 * dynamic programme per day. Enumerating subsets would be 2¹² per day across
 * every day of every revision, which is a read that visibly stalls.
 */

import type { DiffEntry, DiffPlacement, PlanRevision, RevisionDiff } from "@planner/contract";
import { brokenPrecondition } from "./preconditions.ts";

interface Placed {
  dayIndex: number;
  position: number;
  pinned: boolean;
}

interface Stayer {
  candidateId: string;
  from: Placed;
  to: Placed;
}

/** One kept set, read as a chain through the stayers in parent order from `start`. */
interface Chain {
  length: number;
  /** 1 when the chain holds the child's `move` candidate. */
  named: number;
  /** Items in the chain that are pinned in the child. */
  pinned: number;
  /** Index into the parent-ordered stayers. Smaller is a smaller parent position. */
  start: number;
  next: number | null;
}

function placementsOf(revision: PlanRevision): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  for (const day of revision.days) {
    for (const item of day.items) {
      placed.set(item.candidateId, {
        dayIndex: day.dayIndex,
        position: item.position,
        pinned: item.pinned,
      });
    }
  }
  return placed;
}

function placement(placed: Placed): DiffPlacement {
  return { dayIndex: placed.dayIndex, position: placed.position };
}

/**
 * Whether `left` is the preferred chain, rules 3.1 to 3.3 after length.
 *
 * Comparing `start` is the whole of 3.3: two chains are lists of parent
 * positions in ascending order, so where their first elements differ that
 * decides the comparison, and where they are equal the chains were built from
 * the same preferred tail.
 */
function preferred(left: Chain, right: Chain): boolean {
  if (left.length !== right.length) return left.length > right.length;
  if (left.named !== right.named) return left.named < right.named;
  if (left.pinned !== right.pinned) return left.pinned > right.pinned;
  return left.start < right.start;
}

/** The candidates on one day that did not move, by rule 2 and its tie-breaks. */
function keptOn(stayers: readonly Stayer[], named: string | null): Set<string> {
  const ordered = stayers.toSorted((left, right) => left.from.position - right.from.position);
  const best: (Chain | undefined)[] = Array.from({ length: ordered.length });

  // From the end, so every chain's preferred tail is already known. Each
  // component of the preference is additive or decided at the head, which is
  // what lets the best chain from `i` extend the best chain from some `j`.
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const self = ordered[index];
    if (self === undefined) continue;

    let tail: Chain | undefined;
    for (let later = index + 1; later < ordered.length; later += 1) {
      const other = ordered[later];
      const chain = best[later];
      if (other === undefined || chain === undefined) continue;
      if (other.to.position <= self.to.position) continue;
      if (tail === undefined || preferred(chain, tail)) tail = chain;
    }

    best[index] = {
      length: 1 + (tail?.length ?? 0),
      named: (self.candidateId === named ? 1 : 0) + (tail?.named ?? 0),
      pinned: (self.to.pinned ? 1 : 0) + (tail?.pinned ?? 0),
      start: index,
      next: tail?.start ?? null,
    };
  }

  let head: Chain | undefined;
  for (const chain of best) {
    if (chain !== undefined && (head === undefined || preferred(chain, head))) head = chain;
  }

  const kept = new Set<string>();
  let cursor: Chain | undefined = head;
  while (cursor !== undefined) {
    const stayer = ordered[cursor.start];
    if (stayer !== undefined) kept.add(stayer.candidateId);
    cursor = cursor.next === null ? undefined : best[cursor.next];
  }
  return kept;
}

const KIND_ORDER: Record<DiffEntry["kind"], number> = { removed: 0, moved: 1, added: 2 };

function sortPlacement(entry: DiffEntry): DiffPlacement {
  return entry.kind === "removed" ? entry.from : entry.to;
}

/**
 * `(dayIndex, position)` — `to` for `added` and `moved`, `from` for `removed` —
 * then `removed`, `moved`, `added`, then candidate id by code unit. Never
 * `localeCompare`, whose answer depends on the ICU build.
 */
function byPlacement(left: DiffEntry, right: DiffEntry): number {
  const a = sortPlacement(left);
  const b = sortPlacement(right);
  if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
  if (a.position !== b.position) return a.position - b.position;
  if (left.kind !== right.kind) return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (left.candidateId < right.candidateId) return -1;
  return left.candidateId > right.candidateId ? 1 : 0;
}

/**
 * What changed from `parent` to `child`.
 *
 * Throws `INTERNAL` when `child.parentRevisionId` is not `parent.id`: a diff
 * captioned with the wrong pair is a claim about two revisions that were never
 * parent and child.
 */
export function diffRevisions(parent: PlanRevision, child: PlanRevision): RevisionDiff {
  if (child.parentRevisionId !== parent.id) {
    throw brokenPrecondition("not-parent-and-child", {
      parentRevisionId: parent.id,
      revisionId: child.id,
      childParentRevisionId: child.parentRevisionId,
    });
  }

  const before = placementsOf(parent);
  const after = placementsOf(child);
  const entries: DiffEntry[] = [];
  const stayers = new Map<number, Stayer[]>();

  for (const [candidateId, from] of before) {
    const to = after.get(candidateId);
    if (to === undefined) {
      entries.push({ kind: "removed", candidateId, from: placement(from) });
    } else if (to.dayIndex !== from.dayIndex) {
      entries.push({ kind: "moved", candidateId, from: placement(from), to: placement(to) });
    } else {
      const onDay = stayers.get(from.dayIndex) ?? [];
      onDay.push({ candidateId, from, to });
      stayers.set(from.dayIndex, onDay);
    }
  }

  for (const [candidateId, to] of after) {
    if (!before.has(candidateId)) entries.push({ kind: "added", candidateId, to: placement(to) });
  }

  // The operation is a stored field of the child, so reading it is still a
  // derivation from the two revisions (pl-42 put it there for this).
  const named = child.operation.kind === "move" ? child.operation.candidateId : null;
  for (const onDay of stayers.values()) {
    const kept = keptOn(onDay, named);
    for (const stayer of onDay) {
      if (kept.has(stayer.candidateId)) continue;
      entries.push({
        kind: "moved",
        candidateId: stayer.candidateId,
        from: placement(stayer.from),
        to: placement(stayer.to),
      });
    }
  }

  return {
    revisionId: child.id,
    parentRevisionId: parent.id,
    entries: entries.toSorted(byPlacement),
  };
}

/**
 * One diff per revision after the first, oldest first, each against its parent
 * by `parentRevisionId` — never by array adjacency, so a caller cannot mis-pair
 * two revisions. Throws `INTERNAL` for a parent missing from `revisions`.
 */
export function revisionDiffs(revisions: readonly PlanRevision[]): RevisionDiff[] {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  return revisions
    .filter((revision) => revision.parentRevisionId !== null)
    .toSorted((left, right) => left.revision - right.revision)
    .map((child) => {
      const parent = child.parentRevisionId === null ? undefined : byId.get(child.parentRevisionId);
      if (parent === undefined) {
        throw brokenPrecondition("parent-missing", {
          revisionId: child.id,
          parentRevisionId: child.parentRevisionId,
        });
      }
      return diffRevisions(parent, child);
    });
}
