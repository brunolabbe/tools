/**
 * The plan store: rows in, a `PlanDetail` out, and nothing else.
 *
 * Nothing here decides what a plan *contains*. Packing days, choosing which
 * candidate goes where and deriving a revision's number and parent all belong
 * further up — `@planner/itinerary` and `appendRevision` respectively. A store
 * that starts deciding placement is a second composer, and it will drift.
 *
 * **Rows where something is addressed, JSON where a value is read whole**, which
 * is migration 2's rule and the reason the reads below look asymmetric: days and
 * items come back column by column because pinning updates one of them, while
 * the brief, a candidate and the gap list are parsed from JSON in one go and
 * validated against `@planner/contract` on the way out.
 *
 * A stored row that no longer fits its schema is a **fatal** read here, unlike
 * an unreadable intake answer. The difference is what a caller can do about it:
 * a corrupt answer is one question to re-ask, and a corrupt candidate is a plan
 * that would silently lose an item from a draft the user is looking at.
 */

import {
  AppError,
  candidateSchema,
  itemTravelSchema,
  planGapSchema,
  sourceSchema,
  tripBriefSchema,
  uncheckedConstraintSchema,
  type Candidate,
  type Plan,
  type PlanDay,
  type PlanDetail,
  type PlanGap,
  type PlanItem,
  type PlanRevision,
  type Source,
  type TripBrief,
  type UncheckedConstraint,
} from "@planner/contract";
import type { Database } from "better-sqlite3";
import { z } from "zod";

interface PlanRow {
  id: string;
  title: string;
  brief_json: string;
  created_at: string;
  updated_at: string;
}

interface PlanListRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  latest_revision: number;
}

interface CandidateRow {
  id: string;
  candidate_json: string;
}

interface RevisionRow {
  id: string;
  plan_id: string;
  revision: number;
  parent_revision_id: string | null;
  reason: string;
  gaps_json: string;
  coverage_json: string;
  reading_json: string;
  created_at: string;
}

interface DayRow {
  id: string;
  revision_id: string;
  day_index: number;
  date: string | null;
}

interface ItemRow {
  id: string;
  day_id: string;
  candidate_id: string;
  position: number;
  starts_at: string | null;
  pinned: number;
  note: string | null;
  travel_json: string | null;
}

function corrupt(what: string, id: string): AppError {
  return new AppError("INTERNAL", `A stored ${what} could not be read back.`, {
    details: { [what]: id },
  });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseOr<T>(schema: z.ZodType<T>, raw: string, what: string, id: string): T {
  const parsed = schema.safeParse(parseJson(raw));
  if (!parsed.success) throw corrupt(what, id);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface NewPlan {
  id: string;
  title: string;
  brief: TripBrief;
  now: string;
}

/**
 * Write the plan row.
 *
 * Called **before** the fan-out, so the run has somewhere to report to from its
 * first frame. The plan that comes back has no revisions, which is a real and
 * reachable state for as long as the run takes — `latestRevision` returns `null`
 * for it and says so in its own signature.
 */
export function insertPlan(db: Database, plan: NewPlan): PlanDetail {
  db.prepare(
    `INSERT INTO plans (id, title, brief_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(plan.id, plan.title, JSON.stringify(plan.brief), plan.now, plan.now);

  return {
    id: plan.id,
    title: plan.title,
    createdAt: plan.now,
    updatedAt: plan.now,
    latestRevision: 0,
    brief: plan.brief,
    candidates: [],
    revisions: [],
  };
}

/**
 * Store what a run proposed, placed or not.
 *
 * Candidates hang off the plan rather than off a revision: one the composer did
 * not place is what the next revision draws on when the user says they cannot
 * afford the second hotel, and one that two revisions both place must not be
 * stored twice. `run_id` records which run minted it — migration 2 anticipated
 * the column and migration 4 added it.
 */
export function insertCandidates(
  db: Database,
  input: { planId: string; runId: string; candidates: readonly Candidate[]; now: string },
): void {
  const statement = db.prepare(
    `INSERT INTO plan_candidates (id, plan_id, run_id, specialist, candidate_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const candidate of input.candidates) {
    statement.run(
      candidate.id,
      input.planId,
      input.runId,
      candidate.specialist,
      JSON.stringify(candidate),
      input.now,
    );
  }
}

/**
 * Write one revision, its days and its items.
 *
 * Takes the revision **already numbered**, because deriving the number and the
 * parent is `appendRevision`'s job and doing it here as well would be two
 * implementations of §6's append-only rule. The database enforces the same thing
 * from below with its triggers and its `UNIQUE (plan_id, revision)`, so a
 * concurrent re-plan that produced two revision 3s fails rather than corrupting
 * the diff.
 */
export function insertRevision(db: Database, revision: PlanRevision): void {
  db.prepare(
    `INSERT INTO plan_revisions
       (id, plan_id, revision, parent_revision_id, reason, gaps_json, coverage_json,
        reading_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    revision.id,
    revision.planId,
    revision.revision,
    revision.parentRevisionId,
    revision.reason,
    JSON.stringify(revision.gaps),
    JSON.stringify(revision.coverage),
    JSON.stringify(revision.reading),
    revision.createdAt,
  );

  const day = db.prepare(
    "INSERT INTO plan_days (id, revision_id, day_index, date) VALUES (?, ?, ?, ?)",
  );
  const item = db.prepare(
    `INSERT INTO plan_items
       (id, day_id, candidate_id, position, starts_at, pinned, note, travel_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const each of revision.days) {
    day.run(each.id, revision.id, each.dayIndex, each.date);
    for (const placed of each.items) {
      item.run(
        placed.id,
        each.id,
        placed.candidateId,
        placed.position,
        placed.startsAt,
        placed.pinned ? 1 : 0,
        placed.note,
        // NULL rather than `"null"`: the column's own emptiness is the way to
        // say nothing measured this transition, and it is what the read below
        // turns back into `null` without going near a parser.
        placed.travelFromPrevious === null ? null : JSON.stringify(placed.travelFromPrevious),
      );
    }
  }
}

/** Moves with a revision or a pin, and with nothing else. */
export function touchPlan(db: Database, planId: string, now: string): void {
  db.prepare("UPDATE plans SET updated_at = ? WHERE id = ?").run(now, planId);
}

/**
 * Pin or unpin one placed item, scoped to the plan's **latest** revision.
 *
 * The `WHERE` walks days and revisions back to the plan rather than trusting
 * the item id alone: item ids are unique across the table, but a request that
 * named someone else's item would otherwise write to it. Returns false when
 * nothing matched, which the caller turns into `ITEM_NOT_FOUND`.
 *
 * The revision half of that scope is pl-22, and it is about a write that
 * succeeds and does nothing. A pin is read back off the latest revision only —
 * `pinnedPlacements` in `@planner/itinerary` never looks at an older one — so a
 * pin written to a superseded revision is stored, answers 200, and changes
 * nothing the reader can see. That is the repo's _never fake progress_ rule one
 * layer down, so a stale item id is **refused**: it lands on `changes === 0`
 * beside an item id that does not exist at all, and `ITEM_NOT_FOUND` already
 * tells the reader to reload to see the current draft, which is the right
 * advice for both.
 *
 * It is one statement on purpose. A check before the update — here or in the
 * route, which has only a plan id and an item id and would have to ask the
 * store anyway — is a race the moment a re-plan can append a revision while a
 * pin is in flight. The latest revision is found by a correlated `MAX` over the
 * plan's own revisions rather than by reading the document for its number: the
 * `plan_revisions_plan (plan_id, revision DESC)` index answers it, and there is
 * no `plans.latest_revision` column to join against — the `latest_revision` in
 * `selectPlans` is an alias for that same aggregate.
 *
 * This is the one update the schema's trigger allows — `pinned` is named column
 * by column in `plan_items_only_pinned_is_mutable`, so a statement that tried to
 * move an item as well would be refused by the database rather than by care
 * taken here. That trigger is not this rule and does not overlap it: it governs
 * *what* may change on a placed item, never *which* item.
 */
export function updateItemPin(
  db: Database,
  input: { planId: string; itemId: string; pinned: boolean },
): boolean {
  const result = db
    .prepare(
      `UPDATE plan_items SET pinned = ?
       WHERE id = ?
         AND day_id IN (
           SELECT plan_days.id FROM plan_days
           JOIN plan_revisions ON plan_revisions.id = plan_days.revision_id
           WHERE plan_revisions.plan_id = ?
             AND plan_revisions.revision = (
               SELECT MAX(sibling.revision) FROM plan_revisions AS sibling
               WHERE sibling.plan_id = plan_revisions.plan_id
             )
         )`,
    )
    .run(input.pinned ? 1 : 0, input.itemId, input.planId);

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The list: one row per plan, and **not one document per plan**.
 *
 * This is what `plans_updated_at` is indexed for, and the reason `Plan` and
 * `PlanDetail` are separate types at all — loading every revision of every plan
 * to print a page of titles is the read the split exists to prevent. So the
 * revisions are not touched here beyond `MAX`, which the
 * `plan_revisions_plan (plan_id, revision DESC)` index answers without a scan.
 *
 * A plan with no revisions is included, with `latestRevision` 0. It is a real
 * state — the plan row is written before the fan-out — and a list that hid it
 * would lose the plan whose first run is still going, which is precisely the
 * one someone is waiting to see.
 */
export function selectPlans(db: Database): Plan[] {
  const rows = db
    .prepare(
      `SELECT plans.id, plans.title, plans.created_at, plans.updated_at,
              COALESCE(MAX(plan_revisions.revision), 0) AS latest_revision
       FROM plans
       LEFT JOIN plan_revisions ON plan_revisions.plan_id = plans.id
       GROUP BY plans.id
       ORDER BY plans.updated_at DESC`,
    )
    .all() as PlanListRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestRevision: row.latest_revision,
  }));
}

export function planExists(db: Database, id: string): boolean {
  return db.prepare("SELECT 1 FROM plans WHERE id = ?").get(id) !== undefined;
}

/**
 * The whole document, in four queries rather than one per day.
 *
 * A plan is read entire — the UI renders a draft, and a diff needs two of them —
 * so there is no partial read worth the extra shape.
 */
export function selectPlan(db: Database, id: string): PlanDetail | undefined {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
  if (row === undefined) return undefined;

  const brief = parseOr(tripBriefSchema, row.brief_json, "brief", id);

  const candidateRows = db
    .prepare("SELECT id, candidate_json FROM plan_candidates WHERE plan_id = ? ORDER BY id")
    .all(id) as CandidateRow[];
  const candidates: Candidate[] = candidateRows.map((each) =>
    parseOr(candidateSchema, each.candidate_json, "candidate", each.id),
  );

  const revisionRows = db
    .prepare("SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision")
    .all(id) as RevisionRow[];

  const revisions = revisionRows.map((each) => toRevision(db, each));

  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestRevision: revisions.at(-1)?.revision ?? 0,
    brief,
    candidates,
    revisions,
  };
}

const gapsSchema = z.array(planGapSchema);
const coverageSchema = z.array(uncheckedConstraintSchema);
const readingSchema = z.array(sourceSchema);

function toRevision(db: Database, row: RevisionRow): PlanRevision {
  const gaps: PlanGap[] = parseOr(gapsSchema, row.gaps_json, "revision", row.id);
  const coverage: UncheckedConstraint[] = parseOr(
    coverageSchema,
    row.coverage_json,
    "revision",
    row.id,
  );

  const reading: Source[] = parseOr(readingSchema, row.reading_json, "revision", row.id);

  const dayRows = db
    .prepare("SELECT * FROM plan_days WHERE revision_id = ? ORDER BY day_index")
    .all(row.id) as DayRow[];

  const days: PlanDay[] = dayRows.map((day) => ({
    id: day.id,
    dayIndex: day.day_index,
    date: day.date,
    items: selectItems(db, day.id),
  }));

  return {
    id: row.id,
    planId: row.plan_id,
    revision: row.revision,
    parentRevisionId: row.parent_revision_id,
    reason: row.reason,
    createdAt: row.created_at,
    days,
    gaps,
    coverage,
    reading,
  };
}

function selectItems(db: Database, dayId: string): PlanItem[] {
  const rows = db
    .prepare("SELECT * FROM plan_items WHERE day_id = ? ORDER BY position")
    .all(dayId) as ItemRow[];

  return rows.map((row) => ({
    id: row.id,
    candidateId: row.candidate_id,
    position: row.position,
    startsAt: row.starts_at,
    // STRICT has no boolean type; the column is 0 or 1 and the CHECK keeps it so.
    pinned: row.pinned === 1,
    note: row.note,
    // Read back rather than re-measured, which is the whole reason it is
    // stored: the distances and the `fetchedAt` a plan was packed against stay
    // the ones it was packed against, long after the cache row has expired.
    travelFromPrevious:
      row.travel_json === null ? null : parseOr(itemTravelSchema, row.travel_json, "item", row.id),
  }));
}
