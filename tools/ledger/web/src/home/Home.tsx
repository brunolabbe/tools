/**
 * The home screen (lg-5): what the workbook exists to answer.
 *
 * The mortgage bucket is not shared money, so it leads with **each person's own
 * money in it** and who has paid extra, by how much (`docs/00-ANALYSIS.md` §4).
 * The two schedules differ on purpose, so the gap moves within a year by design;
 * the screen states it and passes no verdict. Then the buffer: its balance, and
 * what each person has put in. Every figure is recomputed by the API from the
 * rows on each read.
 */

import { useEffect, useState } from "react";
import { formatCents } from "@ledger/books";
import { AppError } from "@ledger/contract";
import type { BucketsResponse, MortgageResponse } from "@ledger/contract";
import { fetchBuckets } from "../api/buckets.ts";
import { showsHomeSection, useMortgage } from "../mortgage.ts";
import { shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; buckets: BucketsResponse };

/**
 * Who has paid extra into the mortgage bucket. Between two people, as lg-5 said
 * it; between more, the one with most and their margin over the next (lg-23).
 */
export function leadSentence(mortgage: BucketsResponse["mortgage"], names: ShownNames): string {
  const two = mortgage.own.length <= 2;
  if (mortgage.lead === null) {
    return two ? "Both have paid the same." : "The two who have paid the most are level.";
  }
  const by = formatCents(mortgage.lead.byCents);
  const who = shownName(names, mortgage.lead.personId);
  return two
    ? `${who} has paid ${by} more.`
    : `${who} has paid the most, ${by} more than the next.`;
}

/**
 * What is left once the mortgage has ended, and whose it is (lg-55): the model
 * already holds every dollar in the bucket as one person's, so it goes back to
 * them as it stands, and a row filed to them that takes it out brings it down.
 */
export function endedSentence(mortgage: MortgageResponse): string {
  return `The mortgage ended on ${mortgage.closedOn ?? "a day the books do not name"}. The ${formatCents(mortgage.balanceCents)} left in the bucket is each person's own, theirs to take back.`;
}

export function Home(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const names = usePeopleNames();
  const said = useMortgage();

  useEffect(() => {
    const controller = new AbortController();
    fetchBuckets(controller.signal)
      .then((buckets) => setLoad({ state: "ready", buckets }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ state: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, []);

  if (load.state === "loading" || said.state === "loading") {
    return <p className="muted">Adding up the buckets…</p>;
  }
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { mortgage, buffer, unclassified, asOf } = load.buckets;
  const ended = said.mortgage?.state === "ended" ? said.mortgage : null;
  return (
    <>
      {showsHomeSection(said.mortgage) && (
        <section className="card" aria-labelledby="mortgage-heading">
          <h2 id="mortgage-heading">Mortgage</h2>
          <p className="muted hint">Each person&rsquo;s own money in the bucket.</p>
          <ul className="figures">
            {mortgage.own.map((person) => (
              <li key={person.personId}>
                <span>{shownName(names, person.personId)}</span>
                <span className="amount">{formatCents(person.ownCents)}</span>
              </li>
            ))}
          </ul>
          <p className="lead">
            {ended === null ? leadSentence(mortgage, names) : endedSentence(ended)}
          </p>
          <p className="muted hint">In the bucket: {formatCents(mortgage.balanceCents)}</p>
        </section>
      )}
      <section className="card" aria-labelledby="buffer-heading">
        <h2 id="buffer-heading">Buffer</h2>
        <p className="figure">
          <span>Balance</span>
          <span className="amount">{formatCents(buffer.balanceCents)}</span>
        </p>
        <ul className="figures muted">
          {buffer.contributions.map((person) => (
            <li key={person.personId}>
              <span>Put in by {shownName(names, person.personId)}</span>
              <span className="amount">{formatCents(person.contributedCents)}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="muted hint">
        As of {asOf}.
        {unclassified > 0 &&
          ` ${String(unclassified)} ${unclassified === 1 ? "row" : "rows"} in the inbox ${unclassified === 1 ? "is" : "are"} not counted yet.`}
      </p>
    </>
  );
}
