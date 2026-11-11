/**
 * The bank rows behind one period of the spending chart (lg-18), opened under it
 * so the screen's one range stays where it is. Each row shows where its spending
 * category came from and can be given one of its own, which the chart then counts
 * under the new category.
 *
 * The cards' lines are listed below the bank rows (lg-19), under the one filter, so a
 * slice made only of card lines still has something to open. They are not rows: a
 * line is corrected with a whole new line, which `PeriodLines` files.
 */

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { StoredRow } from "@ledger/contract";
import { fetchSpendingRows } from "../api/spending.ts";
import {
  PAGE,
  categoriesQuery,
  failureOf,
  rereadFailureOf,
  spendingRowsQuery,
} from "../queries.ts";
import { RowSpending } from "../spending/RowSpending.tsx";
import { useWrite } from "../writes.ts";
import { PeriodLines } from "./PeriodLines.tsx";

type Filter = number | "none" | null;

export interface PeriodRowsProps {
  /** The period as the chart drew it: its own days, and what to call it. */
  period: { name: string; start: string | null; end: string };
  /** The category the list starts on: one by id, `"none"`, or all of them. */
  category: Filter;
  onClose: () => void;
}

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; rows: StoredRow[]; total: number };

/** Whether a cached list's key was asked under `filter`. */
function sameFilter(key: readonly unknown[] | undefined, filter: Filter): boolean {
  const asked = key?.[1];
  return typeof asked === "object" && asked !== null && "category" in asked
    ? asked.category === filter
    : false;
}

/** What a row counts for in the list it is in: its slice of a receipt (lg-28), else its amount. */
function shown(row: StoredRow): number {
  return row.sliceCents ?? row.amountCents;
}

export function PeriodRows({ period, category, onClose }: PeriodRowsProps): React.ReactElement {
  const id = useId();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>(category);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const { start, end } = period;
  const listed = useQuery(categoriesQuery);
  const categories = listed.data ?? [];
  // A read from the top asks for as many rows as are shown, so a row written to does
  // not send the person back to the first page (`spendingRowsQuery`).
  const asked = spendingRowsQuery({ from: start, to: end, category: filter });
  // The open period's last day moving on, as it does at midnight, keeps the list on
  // screen while it is read again; another filter starts from "loading".
  const read = useQuery({
    ...asked,
    placeholderData: (previous, before) =>
      sameFilter(before?.queryKey, filter) ? previous : undefined,
  });
  const setRowSpendingCategory = useWrite("setRowSpendingCategory");
  const failure = failureOf(read);
  const load: Load =
    failure !== null
      ? { state: "failed", message: failure }
      : read.data === undefined
        ? { state: "loading" }
        : { state: "ready", rows: read.data.rows, total: read.data.total };
  const unlisted = failureOf(listed);
  const reread = rereadFailureOf(read);

  const choose = (next: Filter): void => {
    setFilter(next);
  };

  const showMore = async (): Promise<void> => {
    if (load.state !== "ready") return;
    setMore(true);
    setProblem(null);
    try {
      const answer = await fetchSpendingRows({
        from: start,
        to: end,
        category: filter,
        offset: load.rows.length,
        limit: PAGE,
      });
      client.setQueryData(asked.queryKey, {
        rows: [...load.rows, ...answer.rows],
        total: answer.total,
      });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setMore(false);
    }
  };

  const setSpending = async (row: StoredRow, spendingCategoryId: number | null): Promise<void> => {
    setProblem(null);
    try {
      // Read again rather than patch: under a category filter the row may no longer
      // belong. The write marks the rows, the lines and the chart stale (`writes.ts`).
      await setRowSpendingCategory(row.id, spendingCategoryId);
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    }
  };

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Rows in {period.name}</h2>
      <p className="muted hint">
        The bank rows and the cards' lines this period counted as spending.
      </p>
      <label htmlFor={`${id}-filter`}>Spending category</label>
      <select
        id={`${id}-filter`}
        value={filter === null ? "all" : String(filter)}
        onChange={(event) =>
          choose(
            event.target.value === "all"
              ? null
              : event.target.value === "none"
                ? "none"
                : Number(event.target.value),
          )
        }
      >
        <option value="all">All of them</option>
        <option value="none">Uncategorised</option>
        {categories.map((one) => (
          <option key={one.id} value={String(one.id)}>
            {one.retired ? `${one.name} (retired)` : one.name}
          </option>
        ))}
      </select>
      {(problem ?? unlisted) !== null && (
        <p className="bad" role="alert">
          {problem ?? unlisted}
        </p>
      )}
      <h3>Bank rows</h3>
      {load.state === "loading" && <p className="muted">Loading the rows…</p>}
      {load.state === "failed" && (
        <p className="bad" role="alert">
          {load.message}
        </p>
      )}
      {reread !== null && (
        <p className="bad" role="alert">
          {reread}
        </p>
      )}
      {load.state === "ready" && (
        <>
          {load.rows.length === 0 && <p className="muted">No bank row matches.</p>}
          <ol className="inbox" aria-label="Rows in this period">
            {load.rows.map((row) => (
              <li key={row.id}>
                <p className="line">
                  <span className="when">{row.date}</span>
                  {/* A split row counts here for the part its receipt put under this category. */}
                  <span className={shown(row) < 0 ? "amount out" : "amount in"}>
                    {formatCents(shown(row))}
                  </span>
                </p>
                <p className="what">{row.description}</p>
                <p className="muted">{row.category}.</p>
                {row.sliceCents !== undefined && (
                  <p className="muted">
                    Has a receipt: {formatCents(row.sliceCents)} of its{" "}
                    {formatCents(row.amountCents)} is in this category, the rest in the others its
                    items chose. A category of its own for the row charts all of it there.
                  </p>
                )}
                <RowSpending
                  description={row.description}
                  spending={row.spendingCategory}
                  categories={categories}
                  onSet={(value) => void setSpending(row, value)}
                />
              </li>
            ))}
          </ol>
          <p className="muted hint">
            {load.rows.length} of {load.total}
          </p>
          {load.rows.length < load.total && (
            <button type="button" disabled={more} onClick={() => void showMore()}>
              Show more
            </button>
          )}
        </>
      )}
      <PeriodLines
        key={String(filter)}
        start={start}
        end={end}
        filter={filter}
        categories={categories}
      />
      <button type="button" onClick={onClose}>
        Close the rows
      </button>
    </section>
  );
}
