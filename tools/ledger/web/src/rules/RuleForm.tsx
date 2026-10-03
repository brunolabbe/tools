/**
 * One form for a rule, whether it is new, being edited, or offered from an answer
 * (lg-4). It holds what the person typed as text and turns it into a `RuleDraft`
 * only when they submit, so a half-typed amount is never an error until it is
 * sent.
 *
 * An empty category or amount means "any". The amount is read the way a person
 * types one (`400`, `400.50`, `-700,00 $`), and a pattern may use `*` for any
 * run of characters.
 */

import { useId, useState } from "react";
import { formatCents, parseTypedAmountCents } from "@ledger/books";
import { AppError, BUCKETS } from "@ledger/contract";
import type { Bucket, RuleDraft } from "@ledger/contract";
import { BUCKET_LABELS } from "../labels.ts";

/** What is shown in the fields to begin with. */
export interface RuleFormValues {
  descriptionPattern: string;
  category: string | null;
  amountCents: number | null;
  personId: string | null;
  bucket: Bucket;
}

export interface RuleFormProps {
  initial: RuleFormValues;
  people: readonly string[];
  submitLabel: string;
  /** Rejects with an `AppError` to put the server's own sentence in front of the person. */
  onSubmit: (draft: RuleDraft) => Promise<void>;
  onCancel: () => void;
  cancelLabel?: string;
}

export function RuleForm(props: RuleFormProps): React.ReactElement {
  const { initial, people } = props;
  const id = useId();
  const [pattern, setPattern] = useState(initial.descriptionPattern);
  const [category, setCategory] = useState(initial.category ?? "");
  const [amount, setAmount] = useState(
    initial.amountCents === null ? "" : formatCents(initial.amountCents),
  );
  const [person, setPerson] = useState(initial.personId ?? "");
  const [bucket, setBucket] = useState<Bucket>(initial.bucket);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (pattern.trim() === "") {
      setProblem("Say which descriptions the rule is for.");
      return;
    }
    const amountCents = amount.trim() === "" ? null : parseTypedAmountCents(amount);
    if (amount.trim() !== "" && amountCents === null) {
      setProblem("The amount is not an amount. Try 400 or 400.50, or leave it empty for any.");
      return;
    }
    setProblem(null);
    setBusy(true);
    props
      .onSubmit({
        descriptionPattern: pattern.trim(),
        category: category.trim() === "" ? null : category.trim(),
        amountCents,
        personId: person === "" ? null : person,
        bucket,
      })
      .catch((error: unknown) => {
        setProblem(AppError.from(error).message);
      })
      .finally(() => setBusy(false));
  };

  return (
    <form className="rule-form" onSubmit={submit}>
      <label htmlFor={`${id}-pattern`}>Description</label>
      <input
        id={`${id}-pattern`}
        value={pattern}
        onChange={(event) => setPattern(event.target.value)}
        spellCheck={false}
      />
      <p className="muted hint">
        The whole description, as the bank writes it. Use * for any run of characters.
      </p>
      <label htmlFor={`${id}-category`}>Category</label>
      <input
        id={`${id}-category`}
        value={category}
        placeholder="any"
        onChange={(event) => setCategory(event.target.value)}
        spellCheck={false}
      />
      <label htmlFor={`${id}-amount`}>Exact amount</label>
      <input
        id={`${id}-amount`}
        value={amount}
        placeholder="any"
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
        spellCheck={false}
      />
      <label htmlFor={`${id}-person`}>Belongs to</label>
      <select
        id={`${id}-person`}
        value={person}
        onChange={(event) => setPerson(event.target.value)}
      >
        <option value="">Joint</option>
        {people.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-bucket`}>Bucket</label>
      <select
        id={`${id}-bucket`}
        value={bucket}
        onChange={(event) => setBucket(event.target.value as Bucket)}
      >
        {BUCKETS.map((value) => (
          <option key={value} value={value}>
            {BUCKET_LABELS[value]}
          </option>
        ))}
      </select>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {props.submitLabel}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel} disabled={busy}>
          {props.cancelLabel ?? "Cancel"}
        </button>
      </div>
    </form>
  );
}
