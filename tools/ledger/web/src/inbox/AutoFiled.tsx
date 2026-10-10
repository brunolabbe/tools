/**
 * The rows history filed with nobody tapping (lg-17), reached from the inbox.
 *
 * Each shows what it was filed as and the three answers it rests on, so a person
 * can see why. **One tap confirms it**, which stores the same person and bucket
 * as an answer of the person's own; the usual controls change it. Either way the
 * row leaves this list, and the automatic filing stays in the books under the
 * answer that superseded it.
 */

import { useState } from "react";
import { formatCents } from "@ledger/books";
import { BUCKETS } from "@ledger/contract";
import type { AutoFiledRow, Bucket, SpendingCategory } from "@ledger/contract";
import { BUCKET_LABELS, answerLabel, personLabel } from "../labels.ts";
import { RowSpending } from "../spending/RowSpending.tsx";

export interface AutoFiledProps {
  rows: readonly AutoFiledRow[];
  people: readonly string[];
  categories: readonly SpendingCategory[];
  /** A person's answer for the row: the same as the filing to confirm it, another to change it. */
  onAnswer: (row: AutoFiledRow, personId: string | null, bucket: Bucket) => void;
  onSpending: (row: AutoFiledRow, spendingCategoryId: number | null) => void;
}

export function AutoFiled({
  rows,
  people,
  categories,
  onAnswer,
  onSpending,
}: AutoFiledProps): React.ReactElement {
  return (
    <>
      {rows.length === 0 && <p className="muted">Nothing filed automatically is waiting.</p>}
      <ol className="inbox" aria-label="Rows filed automatically">
        {rows.map((row) => (
          <AutoFiledItem
            key={row.id}
            row={row}
            people={people}
            categories={categories}
            onAnswer={(personId, bucket) => onAnswer(row, personId, bucket)}
            onSpending={(value) => onSpending(row, value)}
          />
        ))}
      </ol>
    </>
  );
}

interface AutoFiledItemProps {
  row: AutoFiledRow;
  people: readonly string[];
  categories: readonly SpendingCategory[];
  onAnswer: (personId: string | null, bucket: Bucket) => void;
  onSpending: (spendingCategoryId: number | null) => void;
}

function AutoFiledItem({
  row,
  people,
  categories,
  onAnswer,
  onSpending,
}: AutoFiledItemProps): React.ReactElement {
  const filed = row.classification;
  const [person, setPerson] = useState(filed.personId ?? "");
  const [bucket, setBucket] = useState<Bucket>(filed.bucket);

  return (
    <li>
      <p className="line">
        <span className="when">{row.date}</span>
        <span className={row.amountCents < 0 ? "amount out" : "amount in"}>
          {formatCents(row.amountCents)}
        </span>
      </p>
      <p className="what">{row.description}</p>
      <p className="muted">{row.category}.</p>
      <RowSpending
        description={row.description}
        spending={row.spendingCategory}
        categories={categories}
        onSet={onSpending}
      />
      <div className="suggestion">
        <p>
          Filed automatically as <strong>{answerLabel(filed)}</strong>, on these answers:
        </p>
        <ul className="matching" aria-label="Answers it rests on">
          {row.restsOn.map((ground) => (
            <li key={ground.classificationId}>
              {ground.date} · {formatCents(ground.amountCents)} · {answerLabel(ground)}
              <span className="muted"> — answered by {ground.classifiedBy}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => onAnswer(filed.personId, filed.bucket)}>
          Confirm
        </button>
      </div>
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
          Change
        </button>
      </div>
    </li>
  );
}
