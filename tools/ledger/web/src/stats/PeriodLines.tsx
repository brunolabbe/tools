/**
 * The card lines behind one period of the spending chart (lg-19), listed under
 * the bank rows with the same category filter, so a slice made only of card
 * lines has something to open. A line is given another spending category by
 * correcting it: the whole line is filed again with the one field changed, and
 * the chart then counts it under the new category. The correction keeps the
 * line's place in time (the API follows it back to the first entry), so doing
 * this to a closed period's line does not touch that period's settlement.
 *
 * Mounted with the filter as its key, so choosing another category starts over
 * from the first page without a reset of its own.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { PeriodLine, SpendingCategory } from "@ledger/contract";
import { correctLine } from "../api/periods.ts";
import { fetchSpendingLines } from "../api/spending.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";
import { shownName, usePeopleNames } from "../people.tsx";

/** How many lines one tap of "Show more" brings. */
const PAGE = 25;

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; lines: PeriodLine[]; total: number };

export interface PeriodLinesProps {
  /** The period's own days, as the chart drew it; `null` is from the beginning. */
  start: string | null;
  end: string;
  /** One category by id, `"none"` for the uncategorised, `null` for all. */
  filter: number | "none" | null;
  categories: readonly SpendingCategory[];
  /** Called after a line was corrected, so the chart can be read again. */
  onChanged: () => void;
}

/** What a line is called to a person and to a screen reader: its own words, or its day. */
function nameOf(line: PeriodLine): string {
  return `${line.category ?? line.note ?? "card line"} of ${line.date}`;
}

export function PeriodLines({
  start,
  end,
  filter,
  categories,
  onChanged,
}: PeriodLinesProps): React.ReactElement {
  const names = usePeopleNames();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [version, setVersion] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // How many lines the next read from the top should bring: a page, or everything
  // already shown, so a line written to does not send the person back to the first page.
  const wanted = useRef(PAGE);

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const answer = await fetchSpendingLines(
          { from: start, to: end, category: filter, offset: 0, limit: wanted.current },
          controller.signal,
        );
        setLoad({ state: "ready", lines: answer.lines, total: answer.total });
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setLoad({ state: "failed", message: AppError.from(error).message });
        }
      }
    })();
    return () => controller.abort();
    // `version` is a trigger: a line written elsewhere bumps it, and the page is asked for again.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [start, end, filter, version]);

  const showMore = useCallback(async (): Promise<void> => {
    if (load.state !== "ready") return;
    setMore(true);
    setProblem(null);
    try {
      const answer = await fetchSpendingLines({
        from: start,
        to: end,
        category: filter,
        offset: load.lines.length,
        limit: PAGE,
      });
      wanted.current = load.lines.length + answer.lines.length;
      setLoad({ state: "ready", lines: [...load.lines, ...answer.lines], total: answer.total });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setMore(false);
    }
  }, [load, start, end, filter]);

  const setSpending = async (
    line: PeriodLine,
    spendingCategoryId: number | null,
  ): Promise<void> => {
    setProblem(null);
    try {
      await correctLine(line.id, {
        personId: line.personId,
        date: line.date,
        amountCents: line.amountCents,
        category: line.category,
        spendingCategoryId,
        note: line.note,
        chargedTo: line.chargedTo,
      });
      // Read again rather than patch: the line has a new id, and under a category
      // filter it may no longer belong.
      wanted.current = Math.max(PAGE, load.state === "ready" ? load.lines.length : PAGE);
      setVersion((current) => current + 1);
      onChanged();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    }
  };

  return (
    <>
      <h3>Card lines</h3>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {load.state === "loading" && <p className="muted">Loading the card lines…</p>}
      {load.state === "failed" && (
        <p className="bad" role="alert">
          {load.message}
        </p>
      )}
      {load.state === "ready" && (
        <>
          {load.lines.length === 0 && <p className="muted">No card line matches.</p>}
          <ol className="inbox" aria-label="Card lines in this period">
            {load.lines.map((line) => (
              <li key={line.id}>
                <p className="line">
                  <span className="when">{line.date}</span>
                  <span className={line.amountCents < 0 ? "amount in" : "amount out"}>
                    {formatCents(line.amountCents)}
                  </span>
                </p>
                <p className="what">{line.category ?? line.note ?? "No text"}</p>
                {line.category !== null && line.note !== null && (
                  <p className="muted">{line.note}</p>
                )}
                <p className="muted">
                  {line.owedToPot ? (
                    // Paid from the joint account for one person alone (lg-91).
                    <>Owed to the pot by {shownName(names, line.personId)}.</>
                  ) : (
                    <>
                      Paid by {shownName(names, line.personId)}
                      {line.chargedTo !== null &&
                        `, charged to ${shownName(names, line.chargedTo)}`}
                      .
                    </>
                  )}
                </p>
                <p className="line">
                  <span>Spending category</span>
                  <SpendingCategoryPicker
                    ariaLabel={`Spending category for ${nameOf(line)}`}
                    categories={categories}
                    value={line.spendingCategoryId}
                    noneLabel="None"
                    onChange={(value) => void setSpending(line, value)}
                  />
                </p>
              </li>
            ))}
          </ol>
          <p className="muted hint">
            {load.lines.length} of {load.total}
          </p>
          {load.lines.length < load.total && (
            <button type="button" disabled={more} onClick={() => void showMore()}>
              Show more card lines
            </button>
          )}
        </>
      )}
    </>
  );
}
