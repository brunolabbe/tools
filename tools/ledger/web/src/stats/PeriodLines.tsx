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

import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { PeriodLine, SpendingCategory } from "@ledger/contract";
import { fetchSpendingLines } from "../api/spending.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";
import { shownName, usePeopleNames } from "../people.tsx";
import { PAGE, failureOf, rereadFailureOf, spendingLinesQuery } from "../queries.ts";
import { useWrite } from "../writes.ts";

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
}: PeriodLinesProps): React.ReactElement {
  const names = usePeopleNames();
  const client = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  // A read from the top asks for as many lines as are shown, so a line written to
  // does not send the person back to the first page (`spendingLinesQuery`).
  const asked = spendingLinesQuery({ from: start, to: end, category: filter });
  // Mounted per filter, so a previous answer is only ever this filter's, for an earlier last day.
  const read = useQuery({ ...asked, placeholderData: keepPreviousData });
  const correctLine = useWrite("correctLine");
  const failure = failureOf(read);
  const load: Load =
    failure !== null
      ? { state: "failed", message: failure }
      : read.data === undefined
        ? { state: "loading" }
        : { state: "ready", lines: read.data.lines, total: read.data.total };
  const reread = rereadFailureOf(read);

  const showMore = async (): Promise<void> => {
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
      client.setQueryData(asked.queryKey, {
        lines: [...load.lines, ...answer.lines],
        total: answer.total,
      });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setMore(false);
    }
  };

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
      // filter it may no longer belong. The write marks the lines and the chart stale.
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
      {reread !== null && (
        <p className="bad" role="alert">
          {reread}
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
