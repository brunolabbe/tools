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
import type { Bucket, RuleDraft, SpendingCategory } from "@ledger/contract";
import { BUCKET_LABELS } from "../labels.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";

/** What is shown in the fields to begin with. */
export interface RuleFormValues {
  descriptionPattern: string;
  category: string | null;
  amountCents: number | null;
  personId: string | null;
  bucket: Bucket;
  spendingCategoryId: number | null;
}

export interface RuleFormProps {
  initial: RuleFormValues;
  people: readonly string[];
  /** The spending categories to pick from (lg-15), retired ones included. */
  categories: readonly SpendingCategory[];
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
  const [spendingCategoryId, setSpendingCategoryId] = useState(initial.spendingCategoryId);
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
        spendingCategoryId,
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
      <label htmlFor={`${id}-category`}>Bank category</label>
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
      <label htmlFor={`${id}-spending`}>Spending category</label>
      <SpendingCategoryPicker
        id={`${id}-spending`}
        categories={props.categories}
        value={spendingCategoryId}
        noneLabel="Use the bank category's"
        onChange={setSpendingCategoryId}
      />
      <p className="muted hint">
        For the spending charts only. Over the map, for every row this rule files.
      </p>
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
