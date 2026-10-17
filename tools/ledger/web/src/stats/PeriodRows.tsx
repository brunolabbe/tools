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

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { SpendingCategory, StoredRow } from "@ledger/contract";
import {
  fetchSpendingCategories,
  fetchSpendingRows,
  setRowSpendingCategory,
} from "../api/spending.ts";
import { RowSpending } from "../spending/RowSpending.tsx";
import { PeriodLines } from "./PeriodLines.tsx";

/** How many rows one tap of "Show more" brings. */
const PAGE = 25;

type Filter = number | "none" | null;

export interface PeriodRowsProps {
  /** The period as the chart drew it: its own days, and what to call it. */
  period: { name: string; start: string | null; end: string };
  /** The category the list starts on: one by id, `"none"`, or all of them. */
  category: Filter;
  /** Called after a row's category was written, so the chart can be read again. */
  onChanged: () => void;
  onClose: () => void;
}

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; rows: StoredRow[]; total: number };

/** What a row counts for in the list it is in: its slice of a receipt (lg-28), else its amount. */
function shown(row: StoredRow): number {
  return row.sliceCents ?? row.amountCents;
}

export function PeriodRows({
  period,
  category,
  onChanged,
  onClose,
}: PeriodRowsProps): React.ReactElement {
  const id = useId();
  const [filter, setFilter] = useState<Filter>(category);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [version, setVersion] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // How many rows the next read from the top should bring: a page, or everything
  // already shown, so a row written to does not send the person back to the first page.
  const wanted = useRef(PAGE);
  const { start, end } = period;

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        setCategories(await fetchSpendingCategories(controller.signal));
      } catch (error: unknown) {
        if (!controller.signal.aborted) setProblem(AppError.from(error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const answer = await fetchSpendingRows(
          { from: start, to: end, category: filter, offset: 0, limit: wanted.current },
          controller.signal,
        );
        setLoad({ state: "ready", rows: answer.rows, total: answer.total });
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setLoad({ state: "failed", message: AppError.from(error).message });
        }
      }
    })();
    return () => controller.abort();
  }, [start, end, filter, version]);

  const choose = (next: Filter): void => {
    wanted.current = PAGE;
    setLoad({ state: "loading" });
    setFilter(next);
  };

  const showMore = useCallback(async (): Promise<void> => {
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
      wanted.current = load.rows.length + answer.rows.length;
      setLoad({ state: "ready", rows: [...load.rows, ...answer.rows], total: answer.total });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setMore(false);
    }
  }, [load, start, end, filter]);

  const setSpending = async (row: StoredRow, spendingCategoryId: number | null): Promise<void> => {
    setProblem(null);
    try {
      await setRowSpendingCategory(row.id, spendingCategoryId);
      // Read again rather than patch: under a category filter the row may no longer belong.
      wanted.current = Math.max(PAGE, load.state === "ready" ? load.rows.length : PAGE);
      setVersion((current) => current + 1);
      onChanged();
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
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      <h3>Bank rows</h3>
      {load.state === "loading" && <p className="muted">Loading the rows…</p>}
      {load.state === "failed" && (
        <p className="bad" role="alert">
          {load.message}
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
            <button
              type="button"
              className="secondary"
              disabled={more}
              onClick={() => void showMore()}
            >
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
        onChanged={onChanged}
      />
      <button type="button" className="secondary" onClick={onClose}>
        Close the rows
      </button>
    </section>
  );
}
