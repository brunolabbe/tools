/**
 * Entering a year's salaries, and confirming the ratio they give (lg-5).
 *
 * Saving the salaries stores them — a year that already has one for a person
 * takes a correction, and the earlier is kept by the API — and answers with the
 * ratio they give, **proposed and not yet in effect**. The person confirms it
 * with the day it takes effect, which starts as the day of entry and can be
 * changed. Until then the ratio in effect is the one confirmed before, so
 * correcting a salary never quietly moves a ratio a settlement already used.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { formatCents, parseTypedAmountCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { Ratio, RatioProposal, Salary } from "@ledger/contract";
import { fetchPeople } from "../api/rules.ts";
import { confirmRatio, enterSalaries, fetchRatios, fetchSalaries } from "../api/salaries.ts";
import { formatShare } from "../labels.ts";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; people: string[]; salaries: Salary[]; inEffect: Ratio | null };

function sharesLabel(shares: RatioProposal["shares"]): string {
  return shares
    .map((share) => `${share.personId} ${formatShare(share.partsPerMillion)}`)
    .join(" · ");
}

/** The amounts on record for a year, as a person would type them, to correct from. */
function typedFor(salaries: readonly Salary[], year: number): Record<string, string> {
  return Object.fromEntries(
    salaries
      .filter((salary) => salary.year === year)
      .map((salary) => [salary.personId, formatCents(salary.amountCents)]),
  );
}

export function Salaries(): React.ReactElement {
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  // The year the screen opens on, read once: the year's amounts on record are
  // filled in for it when the salaries first load, and again on each change.
  const [firstYear] = useState(() => String(new Date().getFullYear()));
  const [year, setYear] = useState(firstYear);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [proposal, setProposal] = useState<RatioProposal | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<Salary[] | null> => {
    try {
      const [people, salaries, ratios] = await Promise.all([
        fetchPeople(signal),
        fetchSalaries(signal),
        fetchRatios(signal),
      ]);
      setLoad({ state: "ready", people, salaries, inEffect: ratios.inEffect });
      return salaries;
    } catch (error: unknown) {
      if (signal?.aborted !== true) {
        setLoad({ state: "failed", message: AppError.from(error).message });
      }
      return null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const open = async (): Promise<void> => {
      const salaries = await refresh(controller.signal);
      if (salaries !== null) setTyped(typedFor(salaries, Number(firstYear)));
    };
    void open();
    return () => controller.abort();
  }, [refresh, firstYear]);

  if (load.state === "loading") return <p className="muted">Loading the salaries…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { people, salaries, inEffect } = load;

  const chooseYear = (value: string): void => {
    setYear(value);
    setProposal(null);
    if (/^\d{4}$/u.test(value)) setTyped(typedFor(salaries, Number(value)));
  };

  /** Runs a write, says what went wrong if it was refused, and keeps the buttons off meanwhile. */
  const send = async (write: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await write();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setNotice(null);
    if (!/^\d{4}$/u.test(year)) {
      setProblem("The year is four digits.");
      return;
    }
    const entries: { personId: string; amountCents: number }[] = [];
    for (const personId of people) {
      const text = typed[personId] ?? "";
      const amountCents = parseTypedAmountCents(text);
      if (amountCents === null || amountCents < 0) {
        setProblem(`${personId}'s salary is not an amount. Try 60000 or 60000.50.`);
        return;
      }
      entries.push({ personId, amountCents });
    }
    setProblem(null);
    void send(async () => {
      const answer = await enterSalaries({ year: Number(year), salaries: entries });
      setProposal(answer.proposal);
      if (answer.proposal !== null) setEffectiveFrom(answer.proposal.effectiveFrom);
      await refresh();
    });
  };

  const confirm = (): void => {
    if (proposal === null) return;
    const salaryIds = proposal.shares.flatMap((share) =>
      share.salaryId === null ? [] : [share.salaryId],
    );
    void send(async () => {
      const ratio = await confirmRatio({ effectiveFrom, salaryIds });
      setProposal(null);
      setProblem(null);
      setNotice(`Ratio confirmed, in effect from ${ratio.effectiveFrom}.`);
      await refresh();
    });
  };

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Salaries</h2>
      <p className="lead">
        {inEffect === null
          ? "No ratio is in effect yet."
          : `Ratio in effect: ${sharesLabel(inEffect.shares)}, since ${inEffect.effectiveFrom}.`}
      </p>

      <form className="rule-form" onSubmit={save}>
        <label htmlFor={`${id}-year`}>Year</label>
        <input
          id={`${id}-year`}
          value={year}
          inputMode="numeric"
          onChange={(event) => chooseYear(event.target.value)}
        />
        {people.map((personId) => (
          <div key={personId} className="rule-form">
            <label htmlFor={`${id}-${personId}`}>{personId}&rsquo;s salary</label>
            <input
              id={`${id}-${personId}`}
              value={typed[personId] ?? ""}
              inputMode="decimal"
              onChange={(event) => setTyped({ ...typed, [personId]: event.target.value })}
            />
          </div>
        ))}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Save salaries
          </button>
        </div>
      </form>

      {proposal !== null && (
        <fieldset className="offer" aria-labelledby={`${id}-proposal`}>
          <h3 id={`${id}-proposal`}>These salaries give</h3>
          <p>{sharesLabel(proposal.shares)}</p>
          <label htmlFor={`${id}-from`}>In effect from</label>
          <input
            id={`${id}-from`}
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
          <div className="actions">
            <button type="button" onClick={confirm} disabled={busy || effectiveFrom === ""}>
              Confirm ratio
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setProposal(null)}
              disabled={busy}
            >
              Not now
            </button>
          </div>
        </fieldset>
      )}

      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}

      {salaries.length > 0 && (
        <ul className="figures">
          {salaries.map((salary) => (
            <li key={salary.id}>
              <span>
                {salary.year} · {salary.personId}
              </span>
              <span className="amount">{formatCents(salary.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
