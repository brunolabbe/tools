/**
 * The history of every bank row (lg-41): the whole account, searched, filtered
 * and sorted by the server, a page at a time. A row's spending category is
 * changed where it already is, from the stats screen; **the person and bucket a
 * row was filed to are changed here** (lg-95), the one place a row a person has
 * already answered can be found again. A change appends an answer, as the inbox
 * does, and the list is read again from the server afterwards.
 *
 * A row whose date falls in a closed period says so before it is changed: the
 * recorded settlement stays what was paid, stats and deposit matching follow the
 * new answer at once, and the next close carries the correction.
 *
 * Nothing here narrows or orders in the browser. Every control builds the query
 * `GET /api/rows` takes, and a change of any of them starts again from the first
 * page and drops the request still in flight, so a late answer to an old filter
 * never replaces a newer list.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCents, parseTypedAmountCents } from "@ledger/books";
import { AppError, BUCKETS, JOINT_PERSON_FILTER } from "@ledger/contract";
import type {
  Bucket,
  ClosedPeriod,
  RowBucketFilter,
  RowOrder,
  RowSort,
  RowsQuery,
  SpendingCategory,
  StoredRow,
} from "@ledger/contract";
import { classifyRow } from "../api/inbox.ts";
import { fetchPeriods } from "../api/periods.ts";
import { fetchRows } from "../api/rows.ts";
import { fetchPeople } from "../api/rules.ts";
import { fetchSpendingCategories } from "../api/spending.ts";
import {
  BUCKET_LABELS,
  CLASSIFICATION_SOURCE_LABELS,
  answerLabel,
  personLabel,
} from "../labels.ts";
import { AnswerControls } from "../inbox/AnswerControls.tsx";
import { usePeopleNames } from "../people.tsx";
import { spendingNames } from "../spending/Picker.tsx";

/** How many rows one request brings. */
const PAGE = 50;

/** How long typing must pause before the search is sent. */
const SEARCH_DELAY_MS = 300;

/** Each sort the screen offers, as the pair the query carries. */
const SORTS: readonly { value: string; label: string; sort: RowSort; order: RowOrder }[] = [
  { value: "date-desc", label: "Date, newest first", sort: "date", order: "desc" },
  { value: "date-asc", label: "Date, oldest first", sort: "date", order: "asc" },
  { value: "amount-asc", label: "Amount, withdrawals first", sort: "amount", order: "asc" },
  { value: "amount-desc", label: "Amount, deposits first", sort: "amount", order: "desc" },
  { value: "description-asc", label: "Description, A to Z", sort: "description", order: "asc" },
  { value: "description-desc", label: "Description, Z to A", sort: "description", order: "desc" },
];

const DEFAULT_SORT = "date-desc";

interface Filters {
  from: string;
  to: string;
  bucket: "" | RowBucketFilter;
  /** A person id, `joint`, or nothing. */
  person: string;
  /** A spending category id as text, `none`, or nothing. */
  spending: string;
  direction: "" | "in" | "out";
  /** Dollars as typed. */
  min: string;
  max: string;
  sort: string;
}

const NO_FILTERS: Filters = {
  from: "",
  to: "",
  bucket: "",
  person: "",
  spending: "",
  direction: "",
  min: "",
  max: "",
  sort: DEFAULT_SORT,
};

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; rows: StoredRow[]; total: number };

/**
 * The closed period a day falls in, or `null` while it is in the open one. A period
 * covers `start` to `end` inclusive, and the first has no start (`periods.ts`).
 */
export function closedPeriodOf(
  date: string,
  periods: readonly ClosedPeriod[],
): ClosedPeriod | null {
  return (
    periods.find(
      (period) => (period.start === null || date >= period.start) && date <= period.end,
    ) ?? null
  );
}

/** A bound typed in dollars as cents, `undefined` when empty, `null` when it is not an amount. */
function bound(text: string): number | undefined | null {
  if (text.trim() === "") return undefined;
  const cents = parseTypedAmountCents(text);
  return cents === null || cents < 0 ? null : cents;
}

/** The query the controls ask for, or what is wrong with them. */
function queryOf(search: string, filters: Filters): { query: RowsQuery } | { problem: string } {
  const min = bound(filters.min);
  const max = bound(filters.max);
  if (min === null || max === null) return { problem: "Type an amount like 12.50 in dollars." };
  if (min !== undefined && max !== undefined && min > max) {
    return { problem: "The smallest amount is above the largest." };
  }
  if (filters.from !== "" && filters.to !== "" && filters.from > filters.to) {
    return { problem: "The first day is after the last." };
  }
  const chosen = SORTS.find((one) => one.value === filters.sort);
  const query: RowsQuery = {};
  if (search.trim() !== "") query.q = search.trim();
  if (filters.from !== "") query.from = filters.from;
  if (filters.to !== "") query.to = filters.to;
  if (filters.bucket !== "") query.bucket = filters.bucket;
  if (filters.person !== "") query.person = filters.person;
  if (filters.spending === "none") query.spendingCategory = "none";
  else if (filters.spending !== "") query.spendingCategory = Number(filters.spending);
  if (filters.direction !== "") query.direction = filters.direction;
  if (min !== undefined) query.minCents = min;
  if (max !== undefined) query.maxCents = max;
  // Newest first is what the server does with no sort, so the default sends none.
  if (chosen !== undefined && chosen.value !== DEFAULT_SORT) {
    query.sort = chosen.sort;
    query.order = chosen.order;
  }
  return { query };
}

export function History(): React.ReactElement {
  const id = useId();
  const names = usePeopleNames();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<string[]>([]);
  const [categories, setCategories] = useState<SpendingCategory[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [more, setMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [periods, setPeriods] = useState<ClosedPeriod[]>([]);
  // The row whose person and bucket are open to change, and what the last change said.
  const [changing, setChanging] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The request for a further page, so a filter change can drop it with the rest.
  const moreRequest = useRef<AbortController | null>(null);

  // What a person types reaches the query once they pause.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(text), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const [who, spending, closed] = await Promise.all([
          // The history names everyone it ever held, retired at a close or not (lg-35).
          fetchPeople(controller.signal, "everyone"),
          fetchSpendingCategories(controller.signal),
          fetchPeriods(controller.signal),
        ]);
        setPeople(who);
        setCategories(spending);
        setPeriods(closed);
      } catch (error: unknown) {
        if (!controller.signal.aborted) setProblem(AppError.from(error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  const asked = useMemo(() => queryOf(search, filters), [search, filters]);
  const badFilter = "problem" in asked ? asked.problem : null;
  // One string stands for the query, so an unrelated render never reads again.
  const key = "query" in asked ? JSON.stringify(asked.query) : null;

  // A new query starts from "loading" with no problem shown, not from the list
  // the last one drew. Derived state, set during render, so that list is never
  // painted under the new filters — an effect would paint it first.
  const [askedKey, setAskedKey] = useState(key);
  if (askedKey !== key) {
    setAskedKey(key);
    if (key !== null) {
      setLoad({ state: "loading" });
      setProblem(null);
    }
  }

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    void (async (): Promise<void> => {
      try {
        const answer = await fetchRows(
          { ...(JSON.parse(key) as RowsQuery), offset: 0, limit: PAGE },
          controller.signal,
        );
        // A request that was dropped may still answer; its list is not the one asked for now.
        if (controller.signal.aborted) return;
        setLoad({ state: "ready", rows: answer.rows, total: answer.total });
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setLoad({ state: "failed", message: AppError.from(error).message });
        }
      }
    })();
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
      setMore(false);
    };
  }, [key]);

  const showMore = async (): Promise<void> => {
    if (load.state !== "ready" || key === null) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setMore(true);
    setProblem(null);
    try {
      const answer = await fetchRows(
        { ...(JSON.parse(key) as RowsQuery), offset: load.rows.length, limit: PAGE },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setLoad({ state: "ready", rows: [...load.rows, ...answer.rows], total: answer.total });
    } catch (error: unknown) {
      if (!controller.signal.aborted) setProblem(AppError.from(error).message);
    } finally {
      if (!controller.signal.aborted) setMore(false);
    }
  };

  // Sends the new answer, then reads the list again rather than patching the row:
  // as many rows as are shown, so a page the person opened stays open.
  const refile = async (row: StoredRow, personId: string | null, bucket: Bucket): Promise<void> => {
    if (load.state !== "ready" || key === null) return;
    setSaving(true);
    setProblem(null);
    setNotice(null);
    try {
      await classifyRow({ rowId: row.id, personId, bucket });
      const answer = await fetchRows({
        ...(JSON.parse(key) as RowsQuery),
        offset: 0,
        limit: Math.max(PAGE, load.rows.length),
      });
      setLoad({ state: "ready", rows: answer.rows, total: answer.total });
      setChanging(null);
      const closed = closedPeriodOf(row.date, periods);
      setNotice(
        `${row.description} is now ${answerLabel({ personId, bucket }, names)}.${
          closed === null ? "" : " The next close will carry this correction."
        }`,
      );
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setSaving(false);
    }
  };

  const change = (next: Partial<Filters>): void =>
    setFilters((current) => ({ ...current, ...next }));

  const clear = (): void => {
    setText("");
    setSearch("");
    setFilters(NO_FILTERS);
  };

  const filtered =
    search !== "" || text !== "" || JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const categoryNames = spendingNames(categories);

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>History</h2>
      <p className="muted hint">
        Every bank row, filed or not. The cards&rsquo; lines are not here.
      </p>

      <div className="rule-form">
        <label htmlFor={`${id}-search`}>Search the description</label>
        <input
          id={`${id}-search`}
          type="search"
          value={text}
          maxLength={100}
          onChange={(event) => setText(event.target.value)}
        />
        <label htmlFor={`${id}-sort`}>Sort by</label>
        <select
          id={`${id}-sort`}
          value={filters.sort}
          onChange={(event) => change({ sort: event.target.value })}
        >
          {SORTS.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={open}
          aria-controls={`${id}-filters`}
          onClick={() => setOpen((current) => !current)}
        >
          Filters
        </button>
      </div>

      <div id={`${id}-filters`} className={open ? "filters open" : "filters"}>
        <div className="rule-form">
          <label htmlFor={`${id}-from`}>From</label>
          <input
            id={`${id}-from`}
            type="date"
            value={filters.from}
            onChange={(event) => change({ from: event.target.value })}
          />
          <label htmlFor={`${id}-to`}>To</label>
          <input
            id={`${id}-to`}
            type="date"
            value={filters.to}
            onChange={(event) => change({ to: event.target.value })}
          />
          <label htmlFor={`${id}-bucket`}>Bucket</label>
          <select
            id={`${id}-bucket`}
            value={filters.bucket}
            onChange={(event) => change({ bucket: event.target.value as Filters["bucket"] })}
          >
            <option value="">Any bucket</option>
            {BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {BUCKET_LABELS[bucket]}
              </option>
            ))}
            <option value="unfiled">Not filed yet</option>
          </select>
          <label htmlFor={`${id}-person`}>Person</label>
          <select
            id={`${id}-person`}
            value={filters.person}
            onChange={(event) => change({ person: event.target.value })}
          >
            <option value="">Anyone</option>
            {people.map((person) => (
              <option key={person} value={person}>
                {personLabel(person, names)}
              </option>
            ))}
            <option value={JOINT_PERSON_FILTER}>{personLabel(null, names)}</option>
          </select>
          <label htmlFor={`${id}-spending`}>Spending category</label>
          <select
            id={`${id}-spending`}
            value={filters.spending}
            onChange={(event) => change({ spending: event.target.value })}
          >
            <option value="">Any</option>
            <option value="none">None</option>
            {categories.map((one) => (
              <option key={one.id} value={String(one.id)}>
                {one.retired ? `${one.name} (retired)` : one.name}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-direction`}>Money</label>
          <select
            id={`${id}-direction`}
            value={filters.direction}
            onChange={(event) => change({ direction: event.target.value as Filters["direction"] })}
          >
            <option value="">In and out</option>
            <option value="in">Money in</option>
            <option value="out">Money out</option>
          </select>
          <label htmlFor={`${id}-min`}>At least ($)</label>
          <input
            id={`${id}-min`}
            inputMode="decimal"
            value={filters.min}
            onChange={(event) => change({ min: event.target.value })}
          />
          <label htmlFor={`${id}-max`}>At most ($)</label>
          <input
            id={`${id}-max`}
            inputMode="decimal"
            value={filters.max}
            onChange={(event) => change({ max: event.target.value })}
          />
        </div>
      </div>

      {badFilter !== null && (
        <p className="bad" role="alert">
          {badFilter}
        </p>
      )}
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}
      {filtered && (
        <button type="button" onClick={clear}>
          Clear filters
        </button>
      )}

      {badFilter === null && load.state === "loading" && <p className="muted">Loading the rows…</p>}
      {badFilter === null && load.state === "failed" && (
        <p className="bad" role="alert">
          {load.message}
        </p>
      )}
      {badFilter === null && load.state === "ready" && (
        <>
          <p className="muted hint" aria-live="polite">
            {load.total === 1 ? "1 row matches." : `${String(load.total)} rows match.`}
          </p>
          {load.rows.length === 0 && <p className="muted">No bank row matches.</p>}
          <ol className="inbox" aria-label="Bank rows">
            {load.rows.map((row) => (
              <li key={row.id}>
                <p className="line">
                  <span className="when">{row.date}</span>
                  <span className={row.amountCents < 0 ? "amount out" : "amount in"}>
                    {formatCents(row.amountCents)}
                  </span>
                </p>
                <p className="what">{row.description}</p>
                <p className="muted">
                  {row.classification === null
                    ? "Not filed yet"
                    : `${personLabel(row.classification.personId, names)} · ${BUCKET_LABELS[row.classification.bucket]}`}
                  {row.classification !== null && (
                    <span> — {CLASSIFICATION_SOURCE_LABELS[row.classification.source]}</span>
                  )}
                </p>
                <p className="muted">
                  {row.spendingCategory === null
                    ? "No spending category"
                    : (categoryNames.get(row.spendingCategory.id) ?? "A spending category")}
                  . {row.category}.
                </p>
                {row.classification !== null && (
                  <Refile
                    row={row}
                    classification={row.classification}
                    closed={closedPeriodOf(row.date, periods)}
                    people={people}
                    open={changing === row.id}
                    saving={saving}
                    onOpen={(next) => setChanging(next ? row.id : null)}
                    onAnswer={(personId, bucket) => void refile(row, personId, bucket)}
                  />
                )}
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
    </section>
  );
}

interface RefileProps {
  row: StoredRow;
  classification: NonNullable<StoredRow["classification"]>;
  /** The closed period the row's date falls in, if any. */
  closed: ClosedPeriod | null;
  people: readonly string[];
  open: boolean;
  saving: boolean;
  onOpen: (open: boolean) => void;
  onAnswer: (personId: string | null, bucket: Bucket) => void;
}

/**
 * The action that changes a row a person (or a rule) already filed (lg-95), and
 * the same person and bucket controls the inbox uses. There is no undo: the old
 * answer is kept by the API, and changing it back is one more change.
 */
function Refile({
  row,
  classification,
  closed,
  people,
  open,
  saving,
  onOpen,
  onAnswer,
}: RefileProps): React.ReactElement {
  if (!open) {
    return (
      <button type="button" aria-expanded={false} onClick={() => onOpen(true)}>
        Change who and what
      </button>
    );
  }
  return (
    <fieldset className="offer" aria-label={`Change who and what for ${row.description}`}>
      {closed !== null && (
        <p className="muted">
          This row is in the closed period {closed.start ?? "from the first row"} to {closed.end}.
          The settlement recorded for it stays as it was paid. Stats and deposit matching follow the
          new answer at once, and the next close carries the correction.
        </p>
      )}
      <AnswerControls
        people={people}
        initial={{ personId: classification.personId, bucket: classification.bucket }}
        submitLabel="Save"
        disabled={saving}
        onAnswer={onAnswer}
      />
      <button type="button" onClick={() => onOpen(false)}>
        Cancel
      </button>
    </fieldset>
  );
}
