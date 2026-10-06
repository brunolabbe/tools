/**
 * The recurring items (lg-6): insurance, Internet, a subscription. Each makes
 * one line a month in whatever period covers that month. Ending one files a
 * version with its last day; the months before keep their lines. A new amount
 * from some month on is an end and a new item.
 */

import { useId, useState } from "react";
import { formatCents, parseTypedAmountCents } from "@ledger/books";
import type { RecurringItem } from "@ledger/contract";
import { addRecurring, changeRecurring } from "../api/periods.ts";

interface Props {
  items: readonly RecurringItem[];
  people: readonly string[];
  me: string;
  busy: boolean;
  send: (write: () => Promise<string | null>) => Promise<void>;
  onProblem: (message: string) => void;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function EndItem({
  item,
  busy,
  send,
  onProblem,
}: { item: RecurringItem } & Pick<Props, "busy" | "send" | "onProblem">): React.ReactElement {
  const id = useId();
  const [last, setLast] = useState("");
  const end = (): void => {
    if (!DAY.test(last) || last < item.startDate) {
      onProblem(`${item.label} ends on a day on or after ${item.startDate}.`);
      return;
    }
    void send(async () => {
      await changeRecurring(item.id, {
        personId: item.personId,
        monthlyCents: item.monthlyCents,
        startDate: item.startDate,
        endDate: last,
        label: item.label,
      });
      return `${item.label} ends on ${last}.`;
    });
  };
  return (
    <div className="actions">
      <label htmlFor={`${id}-end`} className="sr-only">
        {item.label} ends on
      </label>
      <input
        id={`${id}-end`}
        type="date"
        value={last}
        onChange={(event) => setLast(event.target.value)}
      />
      <button type="button" className="secondary" disabled={busy} onClick={end}>
        End
      </button>
    </div>
  );
}

export function Recurring({ items, people, me, busy, send, onProblem }: Props): React.ReactElement {
  const id = useId();
  const [payer, setPayer] = useState(people.includes(me) ? me : (people[0] ?? ""));
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    const monthlyCents = parseTypedAmountCents(amount);
    if (monthlyCents === null || monthlyCents <= 0) {
      onProblem("The monthly amount is not one. Try 80 or 79.99.");
      return;
    }
    if (label.trim() === "" || !DAY.test(startDate)) {
      onProblem("A recurring item needs a name and the day it starts.");
      return;
    }
    void send(async () => {
      await addRecurring({
        personId: payer,
        monthlyCents,
        startDate,
        endDate: null,
        label: label.trim(),
      });
      setLabel("");
      setAmount("");
      setStartDate("");
      return `${label.trim()} added.`;
    });
  };

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Every month</h2>
      {items.length === 0 ? (
        <p className="muted hint">No recurring items.</p>
      ) : (
        <ul className="rules">
          {items.map((item) => (
            <li key={item.id}>
              <p className="figure">
                <span>
                  {item.label} · {item.personId}
                </span>
                <span className="amount">{formatCents(item.monthlyCents)} a month</span>
              </p>
              <p className="muted hint">
                {item.endDate === null
                  ? `Since ${item.startDate}.`
                  : `From ${item.startDate} to ${item.endDate}.`}
              </p>
              {item.endDate === null && (
                <EndItem item={item} busy={busy} send={send} onProblem={onProblem} />
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="rule-form" onSubmit={submit} aria-label="Add a recurring item">
        <h3>Add one</h3>
        <label htmlFor={`${id}-label`}>What</label>
        <input
          id={`${id}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <label htmlFor={`${id}-payer`}>Paid by</label>
        <select id={`${id}-payer`} value={payer} onChange={(event) => setPayer(event.target.value)}>
          {people.map((personId) => (
            <option key={personId} value={personId}>
              {personId}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-amount`}>Each month</label>
        <input
          id={`${id}-amount`}
          value={amount}
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
        />
        <label htmlFor={`${id}-start`}>First month&rsquo;s date</label>
        <input
          id={`${id}-start`}
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            Add the item
          </button>
        </div>
      </form>
    </section>
  );
}
