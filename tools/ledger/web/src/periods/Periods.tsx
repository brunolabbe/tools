/**
 * The period screen (lg-6): the open period with its lines per person, a line
 * or a charge entered by hand, the recurring items, the close button with who
 * deposits what, and the deposits asked for that no paste has brought in yet.
 *
 * Every figure is the API's: the screen sends what a person typed, and shows
 * the settlement the API computes for the end date chosen. Closing records that
 * settlement; the deposit is then expected until a paste brings it in.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type {
  ClosedPeriod,
  OpenPeriodLine,
  OpenPeriodResponse,
  RecurringItem,
  SettlementFigures,
} from "@ledger/contract";
import { fetchPeople } from "../api/rules.ts";
import {
  closePeriod,
  fetchMe,
  fetchOpenPeriod,
  fetchPeriods,
  fetchRecurring,
  retireLine,
} from "../api/periods.ts";
import { LineForm } from "./LineForm.tsx";
import { Recurring } from "./Recurring.tsx";

interface Loaded {
  people: string[];
  me: string;
  open: OpenPeriodResponse;
  closed: ClosedPeriod[];
  recurring: RecurringItem[];
}

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | ({ state: "ready" } & Loaded);

/** Who deposits what, in one sentence, and the direct transfer it equals. */
export function settlementSentence(settlement: SettlementFigures): {
  lead: string;
  hint: string | null;
} {
  const { payerId, recipientId, depositCents, netCents } = settlement;
  if (payerId === null || recipientId === null) {
    return { lead: "Nobody owes anything: the two stand at the ratio.", hint: null };
  }
  if (depositCents === null) {
    return {
      lead: `${payerId} pays ${recipientId} ${formatCents(netCents)} directly.`,
      hint: `${recipientId}'s share of the buffer is zero, so a deposit into it cannot settle this.`,
    };
  }
  return {
    lead: `${payerId} deposits ${formatCents(depositCents)} into the buffer.`,
    hint: `Or pays ${recipientId} ${formatCents(netCents)} directly.`,
  };
}

function lineLabel(line: OpenPeriodLine): string {
  const what = [line.category, line.note].filter((part) => part !== null).join(" · ");
  const words = what === "" ? "Line" : what;
  const kind =
    line.recurringItemId !== null
      ? `${words} (monthly)`
      : line.chargedTo !== null
        ? `${words}, ${line.chargedTo}'s`
        : words;
  // Dated in a period already closed, and counted by the next close instead.
  return line.late ? `${kind}, entered after its period closed` : kind;
}

export function Periods(): React.ReactElement {
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [end, setEnd] = useState<string | null>(null);
  const [since, setSince] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (range: { start?: string | null; end?: string }, signal?: AbortSignal) => {
      try {
        const [people, me, open, closed, recurring] = await Promise.all([
          fetchPeople(signal),
          fetchMe(signal),
          fetchOpenPeriod(range, signal),
          fetchPeriods(signal),
          fetchRecurring(signal),
        ]);
        setLoad({ state: "ready", people, me, open, closed, recurring });
        return open;
      } catch (error: unknown) {
        if (signal?.aborted !== true) {
          setLoad({ state: "failed", message: AppError.from(error).message });
        }
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const first = async (): Promise<void> => {
      const open = await refresh({}, controller.signal);
      if (open !== null) setEnd(open.end);
    };
    void first();
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Loading the period…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { people, me, open, closed, recurring } = load;
  const range = (): { start?: string | null; end?: string } => ({
    ...(open.first && since !== "" ? { start: since } : {}),
    ...(end === null ? {} : { end }),
  });

  /**
   * Runs a write, then reloads; says what went wrong if it was refused. After a
   * close the open period is a new one, so it is reloaded as of today.
   */
  const send = async (
    write: () => Promise<string | null>,
    after: { start?: string | null; end?: string } = range(),
  ): Promise<void> => {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const said = await write();
      await refresh(after);
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
    void refresh({
      ...(open.first && nextSince !== "" ? { start: nextSince } : {}),
      end: nextEnd,
    });
  };

  const close = (): void => {
    void send(async () => {
      const period = await closePeriod({ start: open.start, end: end ?? open.end });
      setSince("");
      setEnd(null);
      return `Period closed. ${settlementSentence(period.settlement).lead}`;
    }, {});
  };

  const expected = closed.filter((period) => period.deposit.status === "expected");
  const chosenEnd = end ?? open.end;
  // The period after one closed today starts tomorrow: nothing to close yet.
  const empty = open.start !== null && chosenEnd < open.start;
  const sentence = open.settlement === null ? null : settlementSentence(open.settlement);

  return (
    <>
      <section className="card" aria-labelledby={`${id}-open`}>
        <h2 id={`${id}-open`}>
          {open.start === null ? "Open period" : `Open period, since ${open.start}`}
        </h2>
        {people.map((personId) => {
          const lines = open.lines.filter((line) => line.personId === personId);
          const shared = lines
            .filter((line) => line.chargedTo === null)
            .reduce((sum, line) => sum + line.amountCents, 0);
          return (
            <div key={personId} className="period-person">
              <p className="figure lead">
                <span>Paid by {personId}</span>
                <span className="amount">{formatCents(shared)}</span>
              </p>
              {lines.length === 0 ? (
                <p className="muted hint">Nothing yet.</p>
              ) : (
                <ul className="figures">
                  {lines.map((line) => (
                    <li key={`${String(line.lineId)}-${String(line.recurringItemId)}-${line.date}`}>
                      <span>
                        {line.date} · {lineLabel(line)}
                      </span>
                      <span className="amount">
                        {formatCents(line.amountCents)}
                        {line.lineId !== null && (
                          <button
                            type="button"
                            className="secondary small"
                            disabled={busy}
                            aria-label={`Remove ${line.date} ${lineLabel(line)}`}
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
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <LineForm people={people} me={me} busy={busy} send={send} onProblem={setProblem} />
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
          <button type="button" onClick={close} disabled={busy || sentence === null || empty}>
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
            {expected.map((period) => (
              <li key={period.id}>
                <span>
                  {period.settlement.payerId}, for the period ending {period.end}
                </span>
                <span className="amount">{formatCents(period.settlement.depositCents ?? 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
