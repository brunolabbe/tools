/**
 * The period screen (lg-6): the open period with its lines per person, a line
 * or a charge entered by hand, the recurring items, the close button with who
 * deposits what, and the deposits asked for that no paste has brought in yet.
 *
 * Every figure is the API's: the screen sends what a person typed, and shows
 * the settlement the API computes for the end date chosen. Closing records that
 * settlement; the deposit is then expected until a paste brings it in.
 */

import { useId, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { MeResponse, OpenPeriodLine, SettlementFigures } from "@ledger/contract";
import { spendingNames } from "../spending/Picker.tsx";
import { inShownOrder, shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import {
  categoriesQuery,
  failureOf,
  meQuery,
  openPeriodQuery,
  peopleIn,
  peopleQuery,
  periodsQuery,
  recurringQuery,
} from "../queries.ts";
import { useWrite } from "../writes.ts";
import { LineForm } from "./LineForm.tsx";
import { Recurring } from "./Recurring.tsx";

/** What the open period is asked as of: today when empty, else the day chosen. */
type Range = { start?: string | null; end?: string };

/** Who is signed in: the person a new line is paid by, unless they choose another. */
function personOf(me: MeResponse): string {
  return me.person.id;
}

/** "a, b and c". */
function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}`;
}

/**
 * Who deposits what, in one sentence, and the direct transfers it equals.
 * Between two people, lg-6's sentences; between more, the same said of each
 * deposit and each transfer (lg-23).
 */
export function settlementSentence(
  settlement: SettlementFigures,
  shown: ShownNames,
): {
  lead: string;
  hint: string | null;
} {
  const { deposits, transfers, shares } = settlement;
  const as = (person: string): string => shownName(shown, person);
  const people = new Set(shares.map((share) => share.personId));
  for (const { personId } of deposits ?? []) people.add(personId);
  for (const { fromId, toId } of transfers) people.add(fromId).add(toId);
  const two = people.size <= 2;
  const direct = listed(
    transfers.map(
      ({ fromId, toId, cents }) => `${as(fromId)} pays ${as(toId)} ${formatCents(cents)}`,
    ),
  );
  if (deposits !== null && deposits.length === 0 && transfers.length === 0) {
    return {
      lead: two
        ? "Nobody owes anything: the two stand at the ratio."
        : "Nobody owes anything: everyone stands at the ratio.",
      hint: null,
    };
  }
  const [transfer] = transfers;
  if (deposits === null) {
    if (two && transfer !== undefined) {
      return {
        lead: `${as(transfer.fromId)} pays ${as(transfer.toId)} ${formatCents(transfer.cents)} directly.`,
        hint: `${as(transfer.toId)}'s share of the buffer is zero, so a deposit into it cannot settle this.`,
      };
    }
    return {
      lead: `Paid directly: ${direct}.`,
      hint: "Someone owed has no share of the buffer, so a deposit into it cannot settle this.",
    };
  }
  const [deposit] = deposits;
  if (two && deposit !== undefined && deposits.length === 1) {
    const recipient = transfer?.toId ?? [...people].find((person) => person !== deposit.personId);
    return {
      lead: `${as(deposit.personId)} deposits ${formatCents(deposit.depositCents)} into the buffer.`,
      hint: `Or pays ${recipient === undefined ? "" : as(recipient)} ${formatCents(transfer?.cents ?? 0)} directly.`,
    };
  }
  const into = listed(
    inShownOrder(deposits, shown, (owed) => owed.personId).map(
      ({ personId, depositCents }) => `${as(personId)} deposits ${formatCents(depositCents)}`,
    ),
  );
  return {
    lead:
      deposits.length === 0 ? "Nothing to deposit into the buffer." : `${into} into the buffer.`,
    hint: transfers.length === 0 ? null : `Or directly: ${direct}.`,
  };
}

/**
 * A line is named by its spending category when it has one. One stored before the
 * list, or imported from the workbook, shows its free text as it was.
 */
function lineLabel(
  line: OpenPeriodLine,
  names: ReadonlyMap<number, string>,
  shown: ShownNames,
): string {
  const spending =
    line.spendingCategoryId === null ? undefined : names.get(line.spendingCategoryId);
  const what = [spending ?? line.category, line.note].filter((part) => part !== null).join(" · ");
  const words = what === "" ? "Line" : what;
  const kind =
    line.recurringItemId !== null
      ? `${words} (monthly)`
      : line.owedToPot && line.chargedTo !== null
        ? `${words}, owed to the pot by ${shownName(shown, line.chargedTo)}`
        : line.chargedTo !== null
          ? `${words}, ${shownName(shown, line.chargedTo)}'s`
          : words;
  // Dated in a period already closed, and counted by the next close instead.
  return line.late ? `${kind}, entered after its period closed` : kind;
}

export function Periods(): React.ReactElement {
  const id = useId();
  const shown = usePeopleNames();
  // `null` until a day is chosen: the open period's own end, today by the API's clock.
  const [end, setEnd] = useState<string | null>(null);
  const [since, setSince] = useState("");
  // What the open period was last asked as of: only a whole day is sent.
  const [asked, setAsked] = useState<Range>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inBooks = useQuery({ ...peopleQuery, select: peopleIn });
  const spending = useQuery(categoriesQuery);
  const signedIn = useQuery({ ...meQuery, select: personOf });
  // The figures for the last range stay on screen while the next one is read.
  const opened = useQuery({ ...openPeriodQuery(asked), placeholderData: keepPreviousData });
  const periods = useQuery(periodsQuery);
  const items = useQuery(recurringQuery);
  const closePeriod = useWrite("closePeriod");
  const retireLine = useWrite("retireLine");

  const failure = failureOf(inBooks, spending, signedIn, opened, periods, items);
  if (failure !== null) {
    return (
      <p className="bad" role="alert">
        {failure}
      </p>
    );
  }
  if (
    inBooks.data === undefined ||
    spending.data === undefined ||
    signedIn.data === undefined ||
    opened.data === undefined ||
    periods.data === undefined ||
    items.data === undefined
  ) {
    return <p className="muted">Loading the period…</p>;
  }

  const [people, categories, me, open, closed, recurring] = [
    inBooks.data,
    spending.data,
    signedIn.data,
    opened.data,
    periods.data,
    items.data,
  ];
  // Who the open period lists: who is in, and anyone retired at a close who
  // has a line in it, one entered late into a period they were in (lg-35).
  const shownPeople = [...new Set([...people, ...open.lines.map((line) => line.personId)])];
  const names = spendingNames(categories);
  const range = (): { start?: string | null; end?: string } => ({
    ...(open.first && since !== "" ? { start: since } : {}),
    ...(end === null ? {} : { end }),
  });

  /**
   * Runs a write, which reads the period again (`writes.ts`); says what went
   * wrong if it was refused. After a close the open period is a new one, so it
   * is asked for as of today.
   */
  const send = async (
    write: () => Promise<string | null>,
    after: Range = range(),
  ): Promise<void> => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const said = await write();
      setAsked(after);
      if (said !== null) setNotice(said);
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseRange = (next: { since?: string; end?: string }): void => {
    const nextSince = next.since ?? since;
    const nextEnd = next.end ?? end ?? open.end;
    setSince(nextSince);
    setEnd(nextEnd);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(nextEnd)) return;
    const nextStart = open.first ? nextSince : (open.start ?? "");
    if (nextStart !== "" && nextEnd < nextStart) {
      setProblem("A period cannot end before it starts.");
      return;
    }
    setProblem(null);
    setAsked({
      ...(open.first && nextSince !== "" ? { start: nextSince } : {}),
      end: nextEnd,
    });
  };

  const close = (): void => {
    void send(async () => {
      const period = await closePeriod({ start: open.start, end: end ?? open.end });
      setSince("");
      setEnd(null);
      return `Period closed. ${settlementSentence(period.settlement, shown).lead}`;
    }, {});
  };

  // Each deposit a close asked for and no paste has brought in yet: one per
  // person, so a close between more than two can be part seen (lg-23).
  const expected = closed
    .filter((period) => period.deposit.status === "expected")
    .flatMap((period) =>
      period.deposit.deposits
        .filter((deposit) => deposit.status === "expected")
        .map((deposit) => ({ period, deposit })),
    );
  const chosenEnd = end ?? open.end;
  // The period after one closed today starts tomorrow: nothing to close yet.
  const empty = open.start !== null && chosenEnd < open.start;
  const sentence = open.settlement === null ? null : settlementSentence(open.settlement, shown);
  // Charges to the pot (lg-91), which the settlement above already counts.
  const owedToPot = open.lines.filter((line) => line.owedToPot);

  const lineItem = (line: OpenPeriodLine): React.ReactElement => (
    <li key={`${String(line.lineId)}-${String(line.recurringItemId)}-${line.date}`}>
      <span>
        {line.date} · {lineLabel(line, names, shown)}
      </span>
      <span className="amount">
        {formatCents(line.amountCents)}
        {line.lineId !== null && (
          <button
            type="button"
            className="small"
            disabled={busy}
            aria-label={`Remove ${line.date} ${lineLabel(line, names, shown)}`}
            onClick={() => {
              const lineId = line.lineId;
              if (lineId === null) return;
              void send(async () => {
                await retireLine(lineId);
                return "Line removed.";
              });
            }}
          >
            Remove
          </button>
        )}
      </span>
    </li>
  );

  return (
    <>
      <section className="card" aria-labelledby={`${id}-open`}>
        <h2 id={`${id}-open`}>
          {open.start === null ? "Open period" : `Open period, since ${open.start}`}
        </h2>
        {shownPeople.map((personId) => {
          // A charge to the pot was paid on nobody's card (lg-91): it is listed apart.
          const lines = open.lines.filter((line) => line.personId === personId && !line.owedToPot);
          const shared = lines
            .filter((line) => line.chargedTo === null)
            .reduce((sum, line) => sum + line.amountCents, 0);
          return (
            <div key={personId} className="period-person">
              <p className="figure lead">
                <span>Paid by {shownName(shown, personId)}</span>
                <span className="amount">{formatCents(shared)}</span>
              </p>
              {lines.length === 0 ? (
                <p className="muted hint">Nothing yet.</p>
              ) : (
                <ul className="figures">{lines.map(lineItem)}</ul>
              )}
            </div>
          );
        })}
        {owedToPot.length > 0 && (
          <div className="period-person">
            <p className="figure lead">
              <span>Owed to the pot</span>
              <span className="amount">
                {formatCents(owedToPot.reduce((sum, line) => sum + line.amountCents, 0))}
              </span>
            </p>
            <p className="muted hint">
              Paid from the joint account for one person alone. They owe it to the others, at their
              shares.
            </p>
            <ul className="figures" aria-label="Owed to the pot">
              {owedToPot.map(lineItem)}
            </ul>
          </div>
        )}
        <LineForm
          people={people}
          categories={categories}
          me={me}
          busy={busy}
          send={send}
          onProblem={setProblem}
        />
      </section>

      <section className="card" aria-labelledby={`${id}-close`}>
        <h2 id={`${id}-close`}>Close the period</h2>
        {open.first && (
          <>
            <label htmlFor={`${id}-since`}>Since (when the two were last even)</label>
            <input
              id={`${id}-since`}
              type="date"
              value={since}
              onChange={(event) => chooseRange({ since: event.target.value })}
            />
          </>
        )}
        <label htmlFor={`${id}-end`}>Last day</label>
        <input
          id={`${id}-end`}
          type="date"
          value={end ?? open.end}
          onChange={(event) => chooseRange({ end: event.target.value })}
        />
        {empty && <p className="muted hint">This period starts on {open.start}.</p>}
        {sentence === null ? (
          <p className="bad">
            No ratio is in effect on that day. Confirm one on the salaries screen.
          </p>
        ) : (
          <>
            <p className="lead">{sentence.lead}</p>
            {sentence.hint !== null && <p className="muted hint">{sentence.hint}</p>}
          </>
        )}
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={close}
            disabled={busy || sentence === null || empty}
          >
            Close the period
          </button>
        </div>
      </section>

      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}

      <Recurring
        items={recurring}
        people={people}
        me={me}
        busy={busy}
        send={send}
        onProblem={setProblem}
      />

      <section className="card" aria-labelledby={`${id}-expected`}>
        <h2 id={`${id}-expected`}>Deposits not seen yet</h2>
        {expected.length === 0 ? (
          <p className="muted hint">Every deposit asked for has come in with a paste.</p>
        ) : (
          <ul className="figures">
            {expected.map(({ period, deposit }) => (
              <li key={`${String(period.id)}-${deposit.personId}`}>
                <span>
                  {shownName(shown, deposit.personId)}, for the period ending {period.end}
                </span>
                <span className="amount">{formatCents(deposit.depositCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
