/**
 * A line entered by hand (lg-6): who paid, when, how much, and what. Ticking
 * "this was the other person's" makes it a **charge**: not shared at all, owed
 * in full by the other person (`docs/00-ANALYSIS.md` §5, _Charges between the
 * two_).
 */

import { useId, useState } from "react";
import { parseTypedAmountCents } from "@ledger/books";
import type { SpendingCategory } from "@ledger/contract";
import { addLine } from "../api/periods.ts";
import { SpendingCategoryPicker } from "../spending/Picker.tsx";

interface Props {
  people: readonly string[];
  /** The list a line's spending category is picked from (lg-15). */
  categories: readonly SpendingCategory[];
  /** Who is signed in: the payer unless they choose another. */
  me: string;
  busy: boolean;
  send: (write: () => Promise<string | null>) => Promise<void>;
  onProblem: (message: string) => void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today by the phone's own calendar, which is the day a person means. */
function today(): string {
  const now = new Date();
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function LineForm({
  people,
  categories,
  me,
  busy,
  send,
  onProblem,
}: Props): React.ReactElement {
  const id = useId();
  const [payer, setPayer] = useState(people.includes(me) ? me : (people[0] ?? ""));
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [spendingCategoryId, setSpendingCategoryId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [theirs, setTheirs] = useState(false);

  const other = people.find((personId) => personId !== payer) ?? null;

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    const amountCents = parseTypedAmountCents(amount);
    if (amountCents === null || amountCents === 0) {
      onProblem("The amount is not one. Try 45 or 45.20.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
      onProblem("The date is a day.");
      return;
    }
    if (theirs && other === null) {
      onProblem("A charge is owed by someone other than whoever paid.");
      return;
    }
    void send(async () => {
      await addLine({
        personId: payer,
        date,
        amountCents,
        // The free text stays for the lines that have it; a new one picks from the list.
        category: null,
        spendingCategoryId,
        note: note.trim() === "" ? null : note.trim(),
        chargedTo: theirs ? other : null,
      });
      setAmount("");
      setSpendingCategoryId(null);
      setNote("");
      setTheirs(false);
      return theirs ? `Charged to ${other ?? ""}.` : "Line added.";
    });
  };

  return (
    <form className="rule-form" onSubmit={submit} aria-label="Add a line">
      <h3>Add a line</h3>
      <label htmlFor={`${id}-payer`}>Paid by</label>
      <select id={`${id}-payer`} value={payer} onChange={(event) => setPayer(event.target.value)}>
        {people.map((personId) => (
          <option key={personId} value={personId}>
            {personId}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-date`}>Date</label>
      <input
        id={`${id}-date`}
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
      />
      <label htmlFor={`${id}-amount`}>Amount</label>
      <input
        id={`${id}-amount`}
        value={amount}
        inputMode="decimal"
        onChange={(event) => setAmount(event.target.value)}
      />
      <label htmlFor={`${id}-spending`}>Spending category</label>
      <SpendingCategoryPicker
        id={`${id}-spending`}
        categories={categories}
        value={spendingCategoryId}
        noneLabel="None"
        onChange={setSpendingCategoryId}
      />
      <label htmlFor={`${id}-note`}>Note</label>
      <input id={`${id}-note`} value={note} onChange={(event) => setNote(event.target.value)} />
      <label className="check">
        <input
          type="checkbox"
          checked={theirs}
          onChange={(event) => setTheirs(event.target.checked)}
        />
        {other === null ? "This was the other person's" : `This was ${other}'s`}
      </label>
      <div className="actions">
        <button type="submit" disabled={busy}>
          Add the line
        </button>
      </div>
    </form>
  );
}
