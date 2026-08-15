/**
 * A control per question kind, driven by the contract's discriminated union.
 *
 * `QuestionField` switches over `question.kind` with no default case, so a kind
 * added to the contract without a control here is a compile error rather than a
 * blank screen in front of a user.
 *
 * **Every bound is read off the node** — `min`, `max`, `integer`, `unit`,
 * `maxLength`, `maxItems`, `choices`. Hard-coding any of them here would put the
 * tree's content in two places, and the browser's copy would be the stale one.
 *
 * Each field owns the half-typed state — the text of a list before it is a list,
 * the mode of a date answer — and reports upward only a complete `AnswerValue`
 * or `null`. `null` is what disables the button, so a partly filled composite
 * cannot be submitted as though it were an answer.
 */

import { useState } from "react";
import {
  BUDGET_BANDS,
  BUDGET_BASES,
  type AnswerValue,
  type BudgetBand,
  type BudgetBasis,
  type QuestionNode,
} from "@planner/contract";

export interface FieldProps {
  question: QuestionNode;
  /** The answer already on record, when this is an edit. */
  initial: AnswerValue | null;
  /** A complete answer, or null while it is not one yet. */
  onChange: (value: AnswerValue | null) => void;
}

/**
 * The field for this question.
 *
 * Keyed by the caller on the question id, so the local drafts below start empty
 * for a new question and seeded for an edit, with no effect to synchronise them.
 */
export function QuestionField({ question, initial, onChange }: FieldProps): React.ReactElement {
  switch (question.kind) {
    case "single-choice":
      return <SingleChoice question={question} initial={initial} onChange={onChange} />;
    case "multi-choice":
      return <MultiChoice question={question} initial={initial} onChange={onChange} />;
    case "text":
      return <TextEntry question={question} initial={initial} onChange={onChange} />;
    case "text-list":
      return <TextList question={question} initial={initial} onChange={onChange} />;
    case "number":
      return <NumberEntry question={question} initial={initial} onChange={onChange} />;
    case "number-list":
      return <NumberList question={question} initial={initial} onChange={onChange} />;
    case "dates":
      return <DatesEntry initial={initial} onChange={onChange} />;
    case "budget":
      return <BudgetEntry initial={initial} onChange={onChange} />;
  }
}

// ---------------------------------------------------------------------------
// Reading a draft back out of an existing answer
// ---------------------------------------------------------------------------

/**
 * The one narrowing every field below needs: the answer on record, if it is of
 * the kind this question asks for.
 *
 * It always is — the server validated it on the way in — but the type is a union
 * and the check is one line, so nothing here has to assert.
 */
function draftOf<K extends AnswerValue["kind"]>(
  kind: K,
  initial: AnswerValue | null,
): Extract<AnswerValue, { kind: K }> | null {
  return initial !== null && initial.kind === kind
    ? (initial as Extract<AnswerValue, { kind: K }>)
    : null;
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

function SingleChoice({ question, initial, onChange }: FieldProps): React.ReactElement {
  const [chosen, setChosen] = useState(draftOf("single-choice", initial)?.value ?? null);

  const pick = (value: string): void => {
    setChosen(value);
    onChange({ kind: "single-choice", value });
  };

  return (
    <fieldset className="choices">
      <legend className="sr-only">{question.prompt}</legend>
      {"choices" in question &&
        question.choices.map((choice) => (
          <label key={choice.value} className={choice.value === chosen ? "choice on" : "choice"}>
            <input
              type="radio"
              name={question.id}
              value={choice.value}
              checked={choice.value === chosen}
              onChange={() => pick(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
    </fieldset>
  );
}

function MultiChoice({ question, initial, onChange }: FieldProps): React.ReactElement {
  const [chosen, setChosen] = useState<readonly string[]>(
    draftOf("multi-choice", initial)?.values ?? [],
  );

  const toggle = (value: string): void => {
    const next = chosen.includes(value)
      ? chosen.filter((each) => each !== value)
      : [...chosen, value];
    setChosen(next);
    // An empty multi-choice is not an answer — the engine refuses it, and
    // "nothing selected" is what the skip button is for on a refine question.
    onChange(next.length === 0 ? null : { kind: "multi-choice", values: [...next] });
  };

  return (
    <fieldset className="choices">
      <legend className="sr-only">{question.prompt}</legend>
      {"choices" in question &&
        question.choices.map((choice) => (
          <label
            key={choice.value}
            className={chosen.includes(choice.value) ? "choice on" : "choice"}
          >
            <input
              type="checkbox"
              name={question.id}
              value={choice.value}
              checked={chosen.includes(choice.value)}
              onChange={() => toggle(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function TextEntry({ question, initial, onChange }: FieldProps): React.ReactElement {
  const [text, setText] = useState(draftOf("text", initial)?.value ?? "");
  const maxLength = "maxLength" in question ? question.maxLength : undefined;

  const update = (value: string): void => {
    setText(value);
    onChange(value.trim() === "" ? null : { kind: "text", value });
  };

  return (
    <textarea
      id={`field-${question.id}`}
      className="field"
      rows={maxLength !== undefined && maxLength > 500 ? 5 : 2}
      {...(maxLength === undefined ? {} : { maxLength })}
      value={text}
      onChange={(event) => update(event.target.value)}
    />
  );
}

/** One per line: a list control that is a textarea is the one people can paste into. */
function TextList({ question, initial, onChange }: FieldProps): React.ReactElement {
  const [text, setText] = useState(draftOf("text-list", initial)?.values.join("\n") ?? "");
  const maxItems = "maxItems" in question ? question.maxItems : undefined;

  const update = (value: string): void => {
    setText(value);
    const values = value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    onChange(values.length === 0 ? null : { kind: "text-list", values });
  };

  return (
    <>
      <textarea
        id={`field-${question.id}`}
        className="field"
        rows={4}
        value={text}
        onChange={(event) => update(event.target.value)}
      />
      <p className="hint">
        One per line{maxItems === undefined ? "" : `, up to ${String(maxItems)}`}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** `null` for anything that is not a number, so the button stays disabled. */
function asNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function NumberEntry({ question, initial, onChange }: FieldProps): React.ReactElement {
  const draft = draftOf("number", initial);
  const [text, setText] = useState(draft === null ? "" : String(draft.value));
  const bounds = question.kind === "number" ? question : null;

  const update = (raw: string): void => {
    setText(raw);
    const value = asNumber(raw);
    onChange(value === null ? null : { kind: "number", value });
  };

  return (
    <span className="measure">
      <input
        id={`field-${question.id}`}
        className="field"
        type="number"
        inputMode={bounds?.integer === true ? "numeric" : "decimal"}
        {...(bounds === null
          ? {}
          : { min: bounds.min, max: bounds.max, step: bounds.integer ? 1 : "any" })}
        value={text}
        onChange={(event) => update(event.target.value)}
      />
      {bounds?.unit !== null && bounds !== null && <span className="unit">{bounds.unit}</span>}
    </span>
  );
}

function NumberList({ question, initial, onChange }: FieldProps): React.ReactElement {
  const draft = draftOf("number-list", initial);
  const [text, setText] = useState(draft?.values.join(", ") ?? "");
  const bounds = question.kind === "number-list" ? question : null;

  const update = (raw: string): void => {
    setText(raw);
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const values = parts.map(asNumber);
    // One unparseable entry disables the whole answer rather than silently
    // dropping it — a missing traveller's age is not a rounding error.
    onChange(
      values.length === 0 || values.some((value) => value === null)
        ? null
        : { kind: "number-list", values: values as number[] },
    );
  };

  return (
    <>
      <input
        id={`field-${question.id}`}
        className="field"
        type="text"
        inputMode="numeric"
        value={text}
        onChange={(event) => update(event.target.value)}
      />
      <p className="hint">
        Separated by commas
        {bounds === null ? "" : `, each between ${String(bounds.min)} and ${String(bounds.max)}`}.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dates — the composite that decides whether people invent dates
// ---------------------------------------------------------------------------

const DATE_MODES = ["exact", "window", "open"] as const;
type DateMode = (typeof DATE_MODES)[number];

const DATE_MODE_LABELS: Record<DateMode, string> = {
  exact: "I know the dates",
  window: "Sometime in a window",
  open: "However long, whenever",
};

/**
 * "Ten nights sometime in spring" has to be as easy to say as a pair of dates.
 * A control that only takes a departure and a return forces every user to invent
 * one, and the tool then plans against a date nobody meant.
 */
function DatesEntry({ initial, onChange }: Omit<FieldProps, "question">): React.ReactElement {
  const draft = draftOf("dates", initial)?.value ?? null;
  const [mode, setMode] = useState<DateMode>(draft?.kind ?? "exact");
  const [departure, setDeparture] = useState(draft?.kind === "exact" ? draft.departure : "");
  const [back, setBack] = useState(draft?.kind === "exact" ? draft.return : "");
  const [earliest, setEarliest] = useState(draft?.kind === "window" ? draft.earliest : "");
  const [latest, setLatest] = useState(draft?.kind === "window" ? draft.latest : "");
  const [nights, setNights] = useState(
    draft !== null && draft.kind !== "exact" ? String(draft.nights) : "",
  );

  const emit = (next: {
    mode: DateMode;
    departure: string;
    back: string;
    earliest: string;
    latest: string;
    nights: string;
  }): void => {
    const count = asNumber(next.nights);
    switch (next.mode) {
      case "exact":
        onChange(
          next.departure === "" || next.back === ""
            ? null
            : {
                kind: "dates",
                value: { kind: "exact", departure: next.departure, return: next.back },
              },
        );
        return;
      case "window":
        onChange(
          next.earliest === "" || next.latest === "" || count === null
            ? null
            : {
                kind: "dates",
                value: {
                  kind: "window",
                  earliest: next.earliest,
                  latest: next.latest,
                  nights: count,
                },
              },
        );
        return;
      case "open":
        onChange(count === null ? null : { kind: "dates", value: { kind: "open", nights: count } });
    }
  };

  const current = { mode, departure, back, earliest, latest, nights };
  const change = (patch: Partial<typeof current>): void => {
    const next = { ...current, ...patch };
    setMode(next.mode);
    setDeparture(next.departure);
    setBack(next.back);
    setEarliest(next.earliest);
    setLatest(next.latest);
    setNights(next.nights);
    emit(next);
  };

  return (
    <div className="composite">
      <fieldset className="choices tight">
        <legend className="sr-only">How exact are these dates?</legend>
        {DATE_MODES.map((each) => (
          <label key={each} className={each === mode ? "choice on" : "choice"}>
            <input
              type="radio"
              name="date-mode"
              checked={each === mode}
              onChange={() => change({ mode: each })}
            />
            <span>{DATE_MODE_LABELS[each]}</span>
          </label>
        ))}
      </fieldset>

      {mode === "exact" && (
        <div className="row">
          <label htmlFor="date-departure">Leaving</label>
          <input
            id="date-departure"
            className="field"
            type="date"
            value={departure}
            onChange={(event) => change({ departure: event.target.value })}
          />
          <label htmlFor="date-return">Back</label>
          <input
            id="date-return"
            className="field"
            type="date"
            value={back}
            onChange={(event) => change({ back: event.target.value })}
          />
        </div>
      )}

      {mode === "window" && (
        <div className="row">
          <label htmlFor="date-earliest">No earlier than</label>
          <input
            id="date-earliest"
            className="field"
            type="date"
            value={earliest}
            onChange={(event) => change({ earliest: event.target.value })}
          />
          <label htmlFor="date-latest">No later than</label>
          <input
            id="date-latest"
            className="field"
            type="date"
            value={latest}
            onChange={(event) => change({ latest: event.target.value })}
          />
        </div>
      )}

      {mode !== "exact" && (
        <div className="row">
          <label htmlFor="date-nights">Nights</label>
          <input
            id="date-nights"
            className="field"
            type="number"
            min={1}
            step={1}
            value={nights}
            onChange={(event) => change({ nights: event.target.value })}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget — a figure or a feeling, and both are answers
// ---------------------------------------------------------------------------

const BAND_LABELS: Record<BudgetBand, string> = {
  shoestring: "Shoestring",
  moderate: "Moderate",
  comfortable: "Comfortable",
  unconstrained: "Not a constraint",
};

const BASIS_LABELS: Record<BudgetBasis, string> = {
  total: "in total",
  "per-person": "per person",
  "per-day": "per day",
};

function BudgetEntry({ initial, onChange }: Omit<FieldProps, "question">): React.ReactElement {
  const draft = draftOf("budget", initial)?.value ?? null;
  const [asAmount, setAsAmount] = useState(draft?.kind !== "band");
  const [amount, setAmount] = useState(draft?.kind === "amount" ? String(draft.amount) : "");
  const [currency, setCurrency] = useState(draft?.kind === "amount" ? draft.currency : "");
  const [basis, setBasis] = useState<BudgetBasis>(draft?.kind === "amount" ? draft.basis : "total");
  const [band, setBand] = useState<BudgetBand | null>(draft?.kind === "band" ? draft.band : null);

  const emit = (next: {
    asAmount: boolean;
    amount: string;
    currency: string;
    basis: BudgetBasis;
    band: BudgetBand | null;
  }): void => {
    if (!next.asAmount) {
      onChange(
        next.band === null ? null : { kind: "budget", value: { kind: "band", band: next.band } },
      );
      return;
    }
    const value = asNumber(next.amount);
    // Three letters, upper case — the contract's own rule for a currency, so a
    // typo is caught here rather than as a 400 the user has to interpret.
    const code = next.currency.trim().toUpperCase();
    onChange(
      value === null || value <= 0 || !/^[A-Z]{3}$/.test(code)
        ? null
        : {
            kind: "budget",
            value: { kind: "amount", currency: code, amount: value, basis: next.basis },
          },
    );
  };

  const current = { asAmount, amount, currency, basis, band };
  const change = (patch: Partial<typeof current>): void => {
    const next = { ...current, ...patch };
    setAsAmount(next.asAmount);
    setAmount(next.amount);
    setCurrency(next.currency);
    setBasis(next.basis);
    setBand(next.band);
    emit(next);
  };

  return (
    <div className="composite">
      <fieldset className="choices tight">
        <legend className="sr-only">A figure or a feeling?</legend>
        <label className={asAmount ? "choice on" : "choice"}>
          <input
            type="radio"
            name="budget-mode"
            checked={asAmount}
            onChange={() => change({ asAmount: true })}
          />
          <span>A figure</span>
        </label>
        <label className={asAmount ? "choice" : "choice on"}>
          <input
            type="radio"
            name="budget-mode"
            checked={!asAmount}
            onChange={() => change({ asAmount: false })}
          />
          <span>A feeling</span>
        </label>
      </fieldset>

      {asAmount ? (
        <div className="row">
          <label htmlFor="budget-amount">Amount</label>
          <input
            id="budget-amount"
            className="field"
            type="number"
            min={1}
            step="any"
            value={amount}
            onChange={(event) => change({ amount: event.target.value })}
          />
          <label htmlFor="budget-currency">Currency</label>
          <input
            id="budget-currency"
            className="field short"
            type="text"
            maxLength={3}
            placeholder="CAD"
            value={currency}
            onChange={(event) => change({ currency: event.target.value })}
          />
          <label htmlFor="budget-basis">Counted</label>
          <select
            id="budget-basis"
            className="field"
            value={basis}
            onChange={(event) => change({ basis: event.target.value as BudgetBasis })}
          >
            {BUDGET_BASES.map((each) => (
              <option key={each} value={each}>
                {BASIS_LABELS[each]}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <fieldset className="choices">
          <legend className="sr-only">How much room is there?</legend>
          {BUDGET_BANDS.map((each) => (
            <label key={each} className={each === band ? "choice on" : "choice"}>
              <input
                type="radio"
                name="budget-band"
                checked={each === band}
                onChange={() => change({ band: each })}
              />
              <span>{BAND_LABELS[each]}</span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
