/**
 * Entering a year's salaries, and confirming the ratio they give (lg-5).
 *
 * Saving the salaries stores them — a year that already has one for a person
 * takes a correction, and the earlier is kept by the API — and answers with the
 * ratio they give, **proposed and not yet in effect**. The person confirms it
 * with the day it takes effect, which starts as the day of entry and can be
 * changed. Until then the ratio in effect is the one confirmed before, so
 * correcting a salary never quietly moves a ratio a settlement already used.
 *
 * A blank salary leaves that person out of the entry, and so out of the ratio it
 * proposes (lg-29). The proposal's shares are on the screen before anyone
 * confirms, which is the check that a salary was left blank on purpose.
 *
 * Only the people in from the open period on are asked for (lg-35): a person
 * retired at a close is not, and while the ratio in effect still names one the
 * screen says a ratio without them is needed. No ratio is changed for them.
 */

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatCents, parseTypedAmountCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { RatioProposal, Salary } from "@ledger/contract";
import { formatShare } from "../labels.ts";
import { byShownName, inShownOrder, shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import { failureOf, peopleIn, peopleQuery, ratiosQuery, salariesQuery } from "../queries.ts";
import { useWrite } from "../writes.ts";

function sharesLabel(shares: RatioProposal["shares"], names: ShownNames): string {
  return inShownOrder(shares, names, (share) => share.personId)
    .map((share) => `${shownName(names, share.personId)} ${formatShare(share.partsPerMillion)}`)
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
  const names = usePeopleNames();
  // The year the screen opens on, read once: the year's amounts on record are
  // filled in for it when the salaries first load, and again on each change.
  const [firstYear] = useState(() => String(new Date().getFullYear()));
  const [year, setYear] = useState(firstYear);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [filled, setFilled] = useState(false);
  const [proposal, setProposal] = useState<RatioProposal | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useQuery({ ...peopleQuery, select: peopleIn });
  const filed = useQuery(salariesQuery);
  const ratios = useQuery(ratiosQuery);
  const enterSalaries = useWrite("enterSalaries");
  const confirmRatio = useWrite("confirmRatio");

  // Derived state, set during render: the first answer fills the opening year in once.
  if (!filled && filed.data !== undefined) {
    setFilled(true);
    setTyped(typedFor(filed.data, Number(firstYear)));
  }

  const failure = failureOf(asked, filed, ratios);
  if (failure !== null) {
    return (
      <p className="bad" role="alert">
        {failure}
      </p>
    );
  }
  if (asked.data === undefined || filed.data === undefined || ratios.data === undefined) {
    return <p className="muted">Loading the salaries…</p>;
  }

  const [people, salaries, inEffect] = [asked.data, filed.data, ratios.data.inEffect];
  // `people` is who is in from the open period on (lg-35), so anyone else the
  // ratio in effect names has been retired at a close.
  const retiredIn = (inEffect?.shares ?? [])
    .map((share) => share.personId)
    .filter((personId) => !people.includes(personId));

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
      // A blank leaves the person out of this year's ratio (lg-29); text that is
      // not an amount is still a mistake, not a blank.
      if (text.trim() === "") continue;
      const amountCents = parseTypedAmountCents(text);
      if (amountCents === null || amountCents < 0) {
        setProblem(
          `${shownName(names, personId)}'s salary is not an amount. Try 60000 or 60000.50.`,
        );
        return;
      }
      entries.push({ personId, amountCents });
    }
    if (entries.length < 2) {
      setProblem("A ratio is between two people or more. Enter a salary for at least two.");
      return;
    }
    setProblem(null);
    void send(async () => {
      const answer = await enterSalaries({ year: Number(year), salaries: entries });
      setProposal(answer.proposal);
      if (answer.proposal !== null) setEffectiveFrom(answer.proposal.effectiveFrom);
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
    });
  };

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Salaries</h2>
      <p className="lead">
        {inEffect === null
          ? "No ratio is in effect yet."
          : `Ratio in effect: ${sharesLabel(inEffect.shares, names)}, since ${inEffect.effectiveFrom}.`}
      </p>
      {retiredIn.length > 0 && (
        <p className="bad">
          <output>
            {retiredIn.map((personId) => shownName(names, personId)).join(", ")}{" "}
            {retiredIn.length === 1 ? "has" : "have"} been retired from the books, and the ratio in
            effect still names them. The period cannot close until a ratio without them is
            confirmed: enter the salaries without them, and confirm it from the open period&rsquo;s
            first day.
          </output>
        </p>
      )}

      <p className="muted">
        A blank salary leaves that person out of the year&rsquo;s ratio. A salary already on record
        for them comes back pre-filled whenever the year is opened, and must be cleared again each
        time; the one on record is kept.
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
            <label htmlFor={`${id}-${personId}`}>{shownName(names, personId)}&rsquo;s salary</label>
            <input
              id={`${id}-${personId}`}
              value={typed[personId] ?? ""}
              inputMode="decimal"
              onChange={(event) => setTyped({ ...typed, [personId]: event.target.value })}
            />
          </div>
        ))}
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            Save salaries
          </button>
        </div>
      </form>

      {proposal !== null && (
        <fieldset className="offer" aria-labelledby={`${id}-proposal`}>
          <h3 id={`${id}-proposal`}>These salaries give</h3>
          <p>{sharesLabel(proposal.shares, names)}</p>
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
            <button type="button" onClick={() => setProposal(null)} disabled={busy}>
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
          {/* Newest year first, each year's people by shown name (lg-76). */}
          {salaries
            .toSorted(
              (one, other) =>
                other.year - one.year || byShownName(names)(one.personId, other.personId),
            )
            .map((salary) => (
              <li key={salary.id}>
                <span>
                  {salary.year} · {shownName(names, salary.personId)}
                </span>
                <span className="amount">{formatCents(salary.amountCents)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
