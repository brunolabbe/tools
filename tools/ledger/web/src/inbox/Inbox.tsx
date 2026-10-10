/**
 * The inbox: the stored rows no rule claimed (lg-4).
 *
 * Each row shows why it is here and, when there is one, the nearest rule as a
 * suggestion. **One tap accepts the suggestion**; or the person answers with a
 * person and a bucket of their own. A description answered before shows that
 * answer too (lg-16), taken in one tap as an answer of the person's own; when the
 * rule's suggestion says the same, it is one control, not two. Either way a new classification is appended
 * and the row leaves the list — what was said before about it is kept by the API.
 *
 * After an answer of the person's own the screen offers to turn it into a rule,
 * with the form filled in from the row. The amount is filled in too, on purpose:
 * a rule that names the usual amount asks about a different one, where a rule
 * that does not would classify it without a word.
 *
 * The rows history filed with nobody tapping (lg-17) are not here and not in the
 * count: they are filed. The inbox links to them, for review, while any are
 * still standing as history filed them.
 */

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError, BUCKETS } from "@ledger/contract";
import type { AutoFiledRow, Bucket, InboxRow, SpendingCategory } from "@ledger/contract";
import { classifyRow, fetchAutoFiled, fetchInbox } from "../api/inbox.ts";
import { createRule, fetchPeople } from "../api/rules.ts";
import { fetchSpendingCategories, setRowSpendingCategory } from "../api/spending.ts";
import {
  BUCKET_LABELS,
  REASON_LABELS,
  answerLabel,
  criteriaLabel,
  historyLabel,
  personLabel,
} from "../labels.ts";
import { RuleForm } from "../rules/RuleForm.tsx";
import { RowSpending } from "../spending/RowSpending.tsx";
import { AutoFiled } from "./AutoFiled.tsx";

interface Ready {
  state: "ready";
  rows: InboxRow[];
  autoFiled: AutoFiledRow[];
  people: string[];
  categories: SpendingCategory[];
}

type Load = { state: "loading" } | { state: "failed"; message: string } | Ready;

/** An answer of the person's own, waiting to be offered as a rule. */
interface Offer {
  row: InboxRow;
  personId: string | null;
  bucket: Bucket;
}

export interface InboxProps {
  /** Told how many rows are waiting, whenever that changes, for the tab's number. */
  onCount?: (count: number) => void;
}

export function Inbox({ onCount }: InboxProps): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [problem, setProblem] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        const [rows, autoFiled, people, categories] = await Promise.all([
          fetchInbox(signal),
          fetchAutoFiled(signal),
          fetchPeople(signal),
          fetchSpendingCategories(signal),
        ]);
        setLoad({ state: "ready", rows, autoFiled, people, categories });
        onCount?.(rows.length);
      } catch (error: unknown) {
        if (signal?.aborted === true) return;
        setLoad({ state: "failed", message: AppError.from(error).message });
      }
    },
    [onCount],
  );

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Loading the inbox…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { rows, autoFiled, people, categories } = load;

  const leave = (row: InboxRow): void => {
    const rest = rows.filter((other) => other.id !== row.id);
    setLoad({ ...load, rows: rest });
    onCount?.(rest.length);
  };

  // Confirming and changing are both a person's answer, and either ends the review.
  const answerFiled = async (
    row: AutoFiledRow,
    personId: string | null,
    bucket: Bucket,
  ): Promise<void> => {
    setProblem(null);
    setNotice(null);
    try {
      await classifyRow({ rowId: row.id, personId, bucket });
      setLoad({ ...load, autoFiled: autoFiled.filter((other) => other.id !== row.id) });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    }
  };

  const setFiledSpending = async (
    row: AutoFiledRow,
    spendingCategoryId: number | null,
  ): Promise<void> => {
    setProblem(null);
    setNotice(null);
    try {
      const answered = await setRowSpendingCategory(row.id, spendingCategoryId);
      setLoad({
        ...load,
        autoFiled: autoFiled.map((other) =>
          other.id === row.id ? { ...other, spendingCategory: answered.spendingCategory } : other,
        ),
      });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      if (error instanceof AppError && error.code === "SPENDING_CATEGORY_NOT_FOUND") {
        await refresh();
      }
    }
  };

  if (reviewing) {
    return (
      <section className="card" aria-labelledby="auto-filed-title">
        <h2 id="auto-filed-title">Filed automatically</h2>
        <p className="muted">
          Each was filed on the three latest answers for its description. Confirm it, or change it.
        </p>
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
        <button type="button" className="secondary" onClick={() => setReviewing(false)}>
          Back to the inbox
        </button>
        <AutoFiled
          rows={autoFiled}
          people={people}
          categories={categories}
          onAnswer={(row, personId, bucket) => void answerFiled(row, personId, bucket)}
          onSpending={(row, value) => void setFiledSpending(row, value)}
        />
      </section>
    );
  }

  // The row stays where it is: a spending category never files it or moves it.
  const setSpending = async (row: InboxRow, spendingCategoryId: number | null): Promise<void> => {
    setProblem(null);
    setNotice(null);
    try {
      const answered = await setRowSpendingCategory(row.id, spendingCategoryId);
      setLoad({
        ...load,
        rows: rows.map((other) =>
          other.id === row.id ? { ...other, spendingCategory: answered.spendingCategory } : other,
        ),
      });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      // The category was retired by someone else: show the list as it is now.
      if (error instanceof AppError && error.code === "SPENDING_CATEGORY_NOT_FOUND") {
        await refresh();
      }
    }
  };

  const accept = async (row: InboxRow, ruleId: number): Promise<void> => {
    setProblem(null);
    setNotice(null);
    try {
      await classifyRow({ rowId: row.id, ruleId });
      leave(row);
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      // The rule was changed or retired by someone else: show the list as it is now.
      if (error instanceof AppError && error.code === "RULE_NOT_FOUND") await refresh();
    }
  };

  const answer = async (row: InboxRow, personId: string | null, bucket: Bucket): Promise<void> => {
    setProblem(null);
    setNotice(null);
    try {
      await classifyRow({ rowId: row.id, personId, bucket });
      leave(row);
      setOffer({ row, personId, bucket });
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    }
  };

  return (
    <section className="card" aria-labelledby="inbox-title">
      <h2 id="inbox-title">Inbox</h2>
      {autoFiled.length > 0 && (
        <button type="button" className="secondary" onClick={() => setReviewing(true)}>
          Review {autoFiled.length} filed automatically
        </button>
      )}
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}
      {offer !== null && (
        <fieldset className="offer" aria-label="Make a rule from this answer">
          <h3>Make this a rule?</h3>
          <p>
            Next time, a row like <strong>{offer.row.description}</strong> will be filed as{" "}
            <strong>{answerLabel(offer)}</strong> without asking. Change what it should match first,
            or leave it.
          </p>
          <RuleForm
            initial={{
              descriptionPattern: offer.row.description,
              category: offer.row.category,
              amountCents: offer.row.amountCents,
              personId: offer.personId,
              bucket: offer.bucket,
              spendingCategoryId: null,
            }}
            people={people}
            categories={categories}
            submitLabel="Create rule"
            cancelLabel="No thanks"
            onSubmit={async (draft) => {
              await createRule(draft);
              setOffer(null);
              setNotice("Rule added. It applies to the next paste.");
              // The rows already here may now match it exactly, and say so.
              await refresh();
            }}
            onCancel={() => setOffer(null)}
          />
        </fieldset>
      )}
      {rows.length === 0 && <p className="muted">Nothing is waiting. Every stored row is filed.</p>}
      <ol className="inbox" aria-label="Rows to classify">
        {rows.map((row) => (
          <InboxItem
            key={row.id}
            row={row}
            people={people}
            categories={categories}
            onSpending={(value) => void setSpending(row, value)}
            onAccept={(ruleId) => void accept(row, ruleId)}
            onAnswer={(personId, bucket) => void answer(row, personId, bucket)}
          />
        ))}
      </ol>
    </section>
  );
}

interface InboxItemProps {
  row: InboxRow;
  people: readonly string[];
  categories: readonly SpendingCategory[];
  onSpending: (spendingCategoryId: number | null) => void;
  onAccept: (ruleId: number) => void;
  onAnswer: (personId: string | null, bucket: Bucket) => void;
}

function InboxItem({
  row,
  people,
  categories,
  onSpending,
  onAccept,
  onAnswer,
}: InboxItemProps): React.ReactElement {
  const { suggestion, history } = row;
  const agrees =
    suggestion !== null &&
    history !== null &&
    suggestion.personId === history.personId &&
    suggestion.bucket === history.bucket;
  const [person, setPerson] = useState(suggestion?.personId ?? history?.personId ?? "");
  const [bucket, setBucket] = useState<Bucket>(
    suggestion?.bucket ?? history?.bucket ?? "current-expenses",
  );

  return (
    <li>
      <p className="line">
        <span className="when">{row.date}</span>
        <span className={row.amountCents < 0 ? "amount out" : "amount in"}>
          {formatCents(row.amountCents)}
        </span>
      </p>
      <p className="what">{row.description}</p>
      <p className="muted">
        {row.category}. {REASON_LABELS[row.reason]}
      </p>
      <RowSpending
        description={row.description}
        spending={row.spendingCategory}
        categories={categories}
        onSet={onSpending}
      />
      {row.matching.length > 1 && (
        <ul className="matching" aria-label="Rules that match">
          {row.matching.map((rule) => (
            <li key={rule.id}>
              {rule.descriptionPattern} ({criteriaLabel(rule)}) → {answerLabel(rule)}
            </li>
          ))}
        </ul>
      )}
      {suggestion !== null && (
        <div className="suggestion">
          <p>
            Suggested: <strong>{answerLabel(suggestion)}</strong>
            <span className="muted">
              {" "}
              — rule {suggestion.descriptionPattern} ({criteriaLabel(suggestion)})
            </span>
          </p>
          {/* The rule and the history saying the same thing is one answer, not two. */}
          {history !== null && agrees && <p className="muted">Answered {historyLabel(history)}.</p>}
          <button type="button" onClick={() => onAccept(suggestion.id)}>
            Accept
          </button>
        </div>
      )}
      {history !== null && !agrees && (
        <div className="suggestion">
          <p>
            Answered <strong>{historyLabel(history)}</strong>
          </p>
          <button type="button" onClick={() => onAnswer(history.personId, history.bucket)}>
            Use this answer
          </button>
        </div>
      )}
      <div className="answer">
        <label>
          Belongs to
          <select value={person} onChange={(event) => setPerson(event.target.value)}>
            <option value="">{personLabel(null)}</option>
            {people.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Bucket
          <select value={bucket} onChange={(event) => setBucket(event.target.value as Bucket)}>
            {BUCKETS.map((value) => (
              <option key={value} value={value}>
                {BUCKET_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          onClick={() => onAnswer(person === "" ? null : person, bucket)}
        >
          Classify
        </button>
      </div>
    </li>
  );
}
