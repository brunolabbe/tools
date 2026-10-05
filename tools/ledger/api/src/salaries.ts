/**
 * Salaries, and the ratio confirmed from them (lg-5).
 *
 * **Nothing is edited** (`docs/00-ANALYSIS.md` §9). Entering a salary for a
 * person's year that already has one files a correction that supersedes it, and
 * the earlier record stays; confirming a ratio for a day that already has one
 * does the same. What stands is the `current_salaries` and `current_ratios`
 * views.
 *
 * **A corrected salary does not move a confirmed ratio.** The ratio is stored,
 * with the salary records it came from, precisely so that a settlement made with
 * it can be recomputed after a salary is corrected (§5). Entering salaries only
 * *proposes* the ratio they give; a person confirms it, with the day it takes
 * effect, and until then the ratio in effect is the one confirmed before.
 */

import { ratioFromSalaries, ratioInEffect } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  ConfirmRatioRequest,
  Ratio,
  RatioProposal,
  RatioShare,
  Salary,
  SalaryEntry,
  SalaryEntryResponse,
} from "@ledger/contract";
import type { Database } from "better-sqlite3";
import { requireKnownPerson } from "./rules.ts";
import type { RuleContext } from "./rules.ts";

/** Who is acting and when, and who the household is: the same as a rule's. */
export type SalaryContext = RuleContext;

interface SalaryColumns {
  id: number;
  person_id: string;
  year: number;
  amount_cents: number;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

interface RatioColumns {
  id: number;
  effective_from: string;
  supersedes: number | null;
  entered_at: string;
  entered_by: string;
}

interface ShareColumns {
  ratio_id: number;
  person_id: string;
  parts_per_million: number;
  salary_id: number | null;
}

function toSalary(columns: SalaryColumns): Salary {
  return {
    id: columns.id,
    personId: columns.person_id,
    year: columns.year,
    amountCents: columns.amount_cents,
    supersedes: columns.supersedes,
    enteredAt: columns.entered_at,
    enteredBy: columns.entered_by,
  };
}

/** The salaries that stand, newest year first. */
export function currentSalaries(db: Database): Salary[] {
  return (
    db
      .prepare("SELECT * FROM current_salaries ORDER BY year DESC, person_id")
      .all() as SalaryColumns[]
  ).map(toSalary);
}

function yearSalaries(db: Database, year: number): Salary[] {
  return (
    db
      .prepare("SELECT * FROM current_salaries WHERE year = ? ORDER BY person_id")
      .all(year) as SalaryColumns[]
  ).map(toSalary);
}

/** The ratio a year's salaries give, if the year holds one for each of two people. */
function proposalFor(salaries: readonly Salary[], today: string): RatioProposal | null {
  if (salaries.length !== 2) return null;
  const byPerson = new Map(salaries.map((salary) => [salary.personId, salary.id]));
  // Two zero salaries give no ratio; nothing to propose, and nothing wrong with the entry.
  if (salaries.every((salary) => salary.amountCents === 0)) return null;
  return {
    effectiveFrom: today,
    shares: ratioFromSalaries(salaries).map((share) => ({
      ...share,
      salaryId: byPerson.get(share.personId) ?? null,
    })),
  };
}

function todayOf(context: Pick<SalaryContext, "now">): string {
  return context.now().toISOString().slice(0, 10);
}

/**
 * Stores a year's salaries. A person's year with no salary takes a first record;
 * one whose salary differs takes a correction that supersedes it; one whose
 * salary is the same is left alone, so sending the form twice files nothing new.
 */
export function enterSalaries(context: SalaryContext, entry: SalaryEntry): SalaryEntryResponse {
  const named = entry.salaries.map((salary) => salary.personId);
  if (new Set(named).size !== named.length) {
    throw new AppError("BAD_REQUEST", "Each person's salary is entered once.");
  }
  for (const personId of named) requireKnownPerson(context.people, personId);

  return context.db
    .transaction(() => {
      const standing = new Map(
        yearSalaries(context.db, entry.year).map((salary) => [salary.personId, salary]),
      );
      const insert = context.db.prepare(
        `INSERT INTO salaries (person_id, year, amount_cents, supersedes, entered_at, entered_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const { personId, amountCents } of entry.salaries) {
        const earlier = standing.get(personId);
        if (earlier?.amountCents === amountCents) continue;
        insert.run(
          personId,
          entry.year,
          amountCents,
          earlier?.id ?? null,
          context.now().toISOString(),
          context.personId,
        );
      }
      const salaries = yearSalaries(context.db, entry.year);
      return { salaries, proposal: proposalFor(salaries, todayOf(context)) };
    })
    .immediate();
}

function readRatios(db: Database, where: string, ...params: unknown[]): Ratio[] {
  const ratios = db
    .prepare(`SELECT * FROM current_ratios ${where} ORDER BY effective_from, id`)
    .all(...params) as RatioColumns[];
  const shares = db.prepare("SELECT * FROM ratio_shares WHERE ratio_id = ? ORDER BY person_id");
  return ratios.map((ratio) => ({
    id: ratio.id,
    effectiveFrom: ratio.effective_from,
    shares: (shares.all(ratio.id) as ShareColumns[]).map((share): RatioShare => ({
      personId: share.person_id,
      partsPerMillion: share.parts_per_million,
      salaryId: share.salary_id,
    })),
    supersedes: ratio.supersedes,
    enteredAt: ratio.entered_at,
    enteredBy: ratio.entered_by,
  }));
}

/** Every ratio that stands, oldest first. */
export function currentRatios(db: Database): Ratio[] {
  return readRatios(db, "");
}

/** The ratios that stand, and the one in effect on `asOf`. */
export function ratiosAsOf(
  db: Database,
  asOf: string,
): { ratios: Ratio[]; inEffect: Ratio | null } {
  const ratios = currentRatios(db);
  return { ratios, inEffect: ratioInEffect(ratios, asOf) };
}

function sameShares(a: readonly RatioShare[], b: readonly RatioShare[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (share, index) =>
        share.personId === b[index]?.personId &&
        share.partsPerMillion === b[index]?.partsPerMillion &&
        share.salaryId === b[index]?.salaryId,
    )
  );
}

/**
 * Confirms the ratio the named salary records give, from `effectiveFrom`. The
 * records must stand — a salary corrected since the proposal is
 * `SALARY_NOT_FOUND` — and be one year's, one for each of two people. The ratio
 * is derived again here from the records, never taken from the caller.
 */
export function confirmRatio(context: SalaryContext, request: ConfirmRatioRequest): Ratio {
  return context.db
    .transaction(() => {
      const salaries = request.salaryIds.map((id) => {
        const found = context.db.prepare("SELECT * FROM current_salaries WHERE id = ?").get(id) as
          | SalaryColumns
          | undefined;
        if (found === undefined) throw new AppError("SALARY_NOT_FOUND");
        return toSalary(found);
      });
      if (new Set(salaries.map((salary) => salary.year)).size !== 1) {
        throw new AppError("BAD_REQUEST", "A ratio comes from one year's salaries.");
      }
      const byPerson = new Map(salaries.map((salary) => [salary.personId, salary.id]));
      const shares = ratioFromSalaries(salaries).map((share): RatioShare => ({
        ...share,
        salaryId: byPerson.get(share.personId) ?? null,
      }));

      const [earlier] = readRatios(context.db, "WHERE effective_from = ?", request.effectiveFrom);
      // The same ratio confirmed twice for the same day is one confirmation.
      if (earlier !== undefined && sameShares(earlier.shares, shares)) return earlier;

      const result = context.db
        .prepare(
          `INSERT INTO ratios (effective_from, supersedes, entered_at, entered_by) VALUES (?, ?, ?, ?)`,
        )
        .run(
          request.effectiveFrom,
          earlier?.id ?? null,
          context.now().toISOString(),
          context.personId,
        );
      const ratioId = Number(result.lastInsertRowid);
      const insertShare = context.db.prepare(
        `INSERT INTO ratio_shares (ratio_id, person_id, parts_per_million, salary_id) VALUES (?, ?, ?, ?)`,
      );
      for (const share of shares) {
        insertShare.run(ratioId, share.personId, share.partsPerMillion, share.salaryId);
      }
      const [stored] = readRatios(context.db, "WHERE id = ?", ratioId);
      if (stored === undefined)
        throw new AppError("INTERNAL", "A confirmed ratio did not read back.");
      return stored;
    })
    .immediate();
}
