/**
 * How the mortgage's payments split, from a date (lg-63): by shares the
 * household names, equally, or at the ratio in effect on each payment's date.
 * Beside the salaries and the ratio, since the ratio is one of the three.
 *
 * Each payment is split by the record in effect on its own date, so filing one
 * from a day never moves a payment before it; filing one for a day that has one
 * takes its place, and the earlier is kept by the API. With no record the
 * payments split equally. Shares name every person the books hold on the day,
 * which the API checks; the form offers the people in from the open period on.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { AppError, MORTGAGE_SPLIT_MODES } from "@ledger/contract";
import type {
  MortgageSplit,
  MortgageSplitMode,
  MortgageSplitRequest,
  MortgageSplitsResponse,
} from "@ledger/contract";
import { fetchPeople } from "../api/rules.ts";
import { fetchMortgageSplits, fileMortgageSplit } from "../api/mortgage-splits.ts";
import { SPLIT_MODE_LABELS, formatShare, parseShare, partsLabel } from "../labels.ts";
import { shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; people: string[]; splits: MortgageSplitsResponse };

/** One record, in words. */
export function recordLabel(split: MortgageSplit, names: ShownNames): string {
  if (split.mode === "shares") return `by shares: ${partsLabel(split.shares, names)}`;
  if (split.mode === "ratio") return "at the ratio in effect on each payment's date";
  return "equally between the people in the books on each payment's date";
}

export function MortgageSplitCard(): React.ReactElement {
  const id = useId();
  const names = usePeopleNames();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [mode, setMode] = useState<MortgageSplitMode>("equal");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const [people, splits] = await Promise.all([
        fetchPeople(signal),
        fetchMortgageSplits(signal),
      ]);
      setLoad({ state: "ready", people, splits });
      setEffectiveFrom((held) => (held === "" ? splits.asOf : held));
    } catch (error: unknown) {
      if (signal?.aborted !== true) {
        setLoad({ state: "failed", message: AppError.from(error).message });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- `refresh` sets state only after its request settles; the rule cannot see through the await.
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Reading the mortgage split…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { people, splits } = load;

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setNotice(null);
    if (effectiveFrom === "") {
      setProblem("Give the day the split takes effect.");
      return;
    }
    let request: MortgageSplitRequest;
    if (mode === "shares") {
      const shares: { personId: string; partsPerMillion: number }[] = [];
      for (const personId of people) {
        const partsPerMillion = parseShare(typed[personId] ?? "");
        if (partsPerMillion === null) {
          setProblem(`${shownName(names, personId)}'s part is not a percent. Try 60 or 62.5.`);
          return;
        }
        shares.push({ personId, partsPerMillion });
      }
      const total = shares.reduce((sum, share) => sum + share.partsPerMillion, 0);
      if (total !== 1_000_000) {
        setProblem(`The parts make 100 %. These make ${formatShare(total)}.`);
        return;
      }
      request = { effectiveFrom, mode, shares };
    } else {
      request = { effectiveFrom, mode };
    }
    setProblem(null);
    setBusy(true);
    const send = async (): Promise<void> => {
      try {
        const split = await fileMortgageSplit(request);
        setNotice(`Split filed, in effect from ${split.effectiveFrom}.`);
        await refresh();
      } catch (error: unknown) {
        setProblem(AppError.from(error).message);
      } finally {
        setBusy(false);
      }
    };
    void send();
  };

  const standing = splits.inEffect;
  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Mortgage split</h2>
      <p className="lead">
        {standing === null
          ? "The mortgage's payments split equally: no split has been filed."
          : `The mortgage's payments split ${recordLabel(standing, names)}, since ${standing.effectiveFrom}.`}
      </p>
      <form className="rule-form" onSubmit={submit}>
        <fieldset>
          <legend>Split each payment</legend>
          {MORTGAGE_SPLIT_MODES.map((one) => (
            <label key={one} className="choice">
              <input
                type="radio"
                name={`${id}-mode`}
                checked={mode === one}
                onChange={() => setMode(one)}
              />
              {SPLIT_MODE_LABELS[one]}
            </label>
          ))}
        </fieldset>
        {mode === "shares" &&
          people.map((personId) => (
            <div key={personId} className="rule-form">
              <label htmlFor={`${id}-${personId}`}>
                {shownName(names, personId)}&rsquo;s part, in %
              </label>
              <input
                id={`${id}-${personId}`}
                value={typed[personId] ?? ""}
                inputMode="decimal"
                onChange={(event) => setTyped({ ...typed, [personId]: event.target.value })}
              />
            </div>
          ))}
        <label htmlFor={`${id}-from`}>From</label>
        <input
          id={`${id}-from`}
          type="date"
          max={splits.asOf}
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
        />
        <p className="muted hint">
          Each payment splits by the record in effect on its own date, so a payment before the day
          given is never moved. A split filed for a day that has one takes its place.
        </p>
        <div className="actions">
          <button type="submit" disabled={busy}>
            File the split
          </button>
        </div>
      </form>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}
      {splits.splits.length > 0 && (
        <ul className="figures" aria-label="Mortgage splits filed">
          {splits.splits.toReversed().map((split) => (
            <li key={split.id}>
              <span>From {split.effectiveFrom}</span>
              <span>{recordLabel(split, names)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
