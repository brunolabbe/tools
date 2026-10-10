/**
 * The stats screen (lg-9): the household's history, drawn. Nothing here is
 * stored; every chart is a series the API computes from the rows on each read
 * (`docs/00-ANALYSIS.md` §9), over one range chosen once, in one row, above them
 * all — never per chart, so the figures always agree with one another.
 */

import { useId, useState } from "react";
import type { StatsRange } from "@ledger/contract";
import {
  BufferCard,
  ContributionCards,
  FixedItemsCard,
  MortgageOwnCard,
  MortgagePaymentCard,
  SalaryCards,
  SettlementsCard,
  SpendingCard,
} from "./Cards.tsx";

type Preset = "all" | "year" | "twelve" | "custom";

const PRESET_LABELS: Record<Preset, string> = {
  all: "All of it",
  year: "This year",
  twelve: "Last 12 months",
  custom: "Pick days",
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The range a preset means on `today` (a `yyyy-mm-dd`). Custom is the caller's. */
export function presetRange(preset: Exclude<Preset, "custom">, today: string): StatsRange {
  if (preset === "all") return { from: null, to: null };
  if (preset === "year") return { from: `${today.slice(0, 4)}-01-01`, to: null };
  const [year, month, day] = today.split("-").map(Number);
  const back = new Date(Date.UTC((year ?? 1970) - 1, (month ?? 1) - 1, day ?? 1));
  return { from: isoDay(back), to: null };
}

export function Stats(): React.ReactElement {
  const id = useId();
  const [preset, setPreset] = useState<Preset>("all");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const today = isoDay(new Date());

  const crossed = custom.from !== "" && custom.to !== "" && custom.from > custom.to;
  const range: StatsRange =
    preset === "custom"
      ? { from: custom.from === "" ? null : custom.from, to: custom.to === "" ? null : custom.to }
      : presetRange(preset, today);
  // A range the API would refuse is not sent; the charts keep the last one.
  const [held, setHeld] = useState<StatsRange>(range);
  const sent = crossed ? held : range;
  if (!crossed && (held.from !== range.from || held.to !== range.to)) setHeld(range);

  return (
    <>
      <section className="card" aria-labelledby={`${id}-range`}>
        <h2 id={`${id}-range`}>History</h2>
        <p className="muted hint">One range for every chart below.</p>
        <fieldset className="range">
          <legend className="sr-only">Range</legend>
          {(Object.keys(PRESET_LABELS) as Preset[]).map((one) => (
            <button
              key={one}
              type="button"
              className="secondary small"
              aria-pressed={preset === one}
              onClick={() => setPreset(one)}
            >
              {PRESET_LABELS[one]}
            </button>
          ))}
        </fieldset>
        {preset === "custom" && (
          <div className="rule-form">
            <label htmlFor={`${id}-from`}>From</label>
            <input
              id={`${id}-from`}
              type="date"
              value={custom.from}
              onChange={(event) => setCustom({ ...custom, from: event.target.value })}
            />
            <label htmlFor={`${id}-to`}>To</label>
            <input
              id={`${id}-to`}
              type="date"
              value={custom.to}
              onChange={(event) => setCustom({ ...custom, to: event.target.value })}
            />
            {crossed && (
              <p className="bad" role="alert">
                The first day is after the last.
              </p>
            )}
          </div>
        )}
      </section>
      <MortgagePaymentCard range={sent} />
      <MortgageOwnCard range={sent} />
      <ContributionCards range={sent} />
      <BufferCard range={sent} />
      <SalaryCards range={sent} />
      <SpendingCard range={sent} />
      <FixedItemsCard range={sent} />
      <SettlementsCard range={sent} />
    </>
  );
}
