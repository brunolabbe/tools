/**
 * What the household says about its mortgage (lg-55): it is live, it ended on a
 * day, or there never was one. Any member may say it, and saying something else
 * later takes the earlier back; nothing said is erased. On the household's
 * screen because it is a fact about the household and not about a month.
 *
 * Ending it closes the mortgage views from the close — the later of the day
 * given and the last payment out of the bucket — and the history before still
 * charts. What is left in the bucket after it is each person's own money.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError, MORTGAGE_STATES } from "@ledger/contract";
import type { MortgageResponse, MortgageState } from "@ledger/contract";
import { fetchMortgage, saveMortgage } from "../api/mortgage.ts";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; mortgage: MortgageResponse };

const CHOICES: Record<MortgageState, string> = {
  live: "The mortgage is still being paid",
  ended: "The mortgage has ended",
  none: "There is no mortgage",
};

/** What stands, in words. */
export function mortgageStanding(mortgage: MortgageResponse): string {
  if (mortgage.state === "none") return "The household has no mortgage.";
  if (mortgage.state === "live") return "The mortgage is still being paid.";
  const ended = `The mortgage ended on ${mortgage.endedOn ?? ""}.`;
  const closed =
    mortgage.closedOn !== null && mortgage.closedOn !== mortgage.endedOn
      ? ` A payment out of the bucket came on ${mortgage.closedOn}, so it closes then.`
      : "";
  // The same words Home uses for a bucket that holds less than nothing.
  const left = !mortgage.left
    ? ""
    : mortgage.balanceCents < 0
      ? ` The bucket is ${formatCents(-mortgage.balanceCents)} short.`
      : ` ${formatCents(mortgage.balanceCents)} is left in the bucket.`;
  return `${ended}${closed}${left}`;
}

export function MortgageSetting(): React.ReactElement {
  const id = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [choice, setChoice] = useState<MortgageState>("live");
  const [endedOn, setEndedOn] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only setters, which React keeps the same, so `show` is built once and the
  // load effect below can name it without running again.
  const show = useCallback((mortgage: MortgageResponse): void => {
    setLoad({ state: "ready", mortgage });
    setChoice(mortgage.state);
    setEndedOn(mortgage.endedOn ?? "");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchMortgage(controller.signal)
      .then(show)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, [show]);

  if (load.state === "loading")
    return <p className="muted">Reading what is said of the mortgage…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (choice === "ended" && endedOn === "") {
      setProblem("Give the day the mortgage ended.");
      return;
    }
    setProblem(null);
    setBusy(true);
    const request = choice === "ended" ? { state: choice, endedOn } : { state: choice };
    saveMortgage(request)
      .then(show)
      .catch((error: unknown) => setProblem(AppError.from(error).message))
      .finally(() => setBusy(false));
  };

  const today = load.mortgage.asOf;
  return (
    <section aria-labelledby={`${id}-heading`} className="card">
      <h2 id={`${id}-heading`}>Mortgage</h2>
      <p>{mortgageStanding(load.mortgage)}</p>
      <form className="mortgage-form" onSubmit={submit}>
        <fieldset>
          <legend>What the household says</legend>
          {MORTGAGE_STATES.map((one) => (
            <label key={one} className="choice">
              <input
                type="radio"
                name={`${id}-state`}
                checked={choice === one}
                onChange={() => setChoice(one)}
              />
              {CHOICES[one]}
            </label>
          ))}
        </fieldset>
        {choice === "ended" && (
          <>
            <label htmlFor={`${id}-ended`}>Ended on</label>
            <input
              id={`${id}-ended`}
              type="date"
              max={today}
              value={endedOn}
              onChange={(event) => setEndedOn(event.target.value)}
            />
          </>
        )}
        <p className="muted hint">
          Ending it, or saying there is none, closes the mortgage cards on the stats and home
          screens from the last payment. What came before still charts, and nothing is erased:
          saying it is still being paid takes it back.
        </p>
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
