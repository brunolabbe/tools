/**
 * The charts of the stats screen (lg-9), one card per series. A card reads its own
 * series over the screen's range and says in the words of the household what it
 * shows; the drawing is `Chart.tsx`'s and the arithmetic was done by the API.
 *
 * **Colour follows the entity** (the `dataviz` skill): a person has the slot their
 * place in the people list gives, a spending category the slot its place in the
 * list's own order gives, a fixed item the slot of the month it first appeared in.
 * None of them is ever coloured by its size, so a range that drops one does not
 * repaint the rest. More than seven of a kind share the eighth slot as "more", and
 * what has no spending category is the neutral grey.
 */

import { useState } from "react";
import { formatCents } from "@ledger/books";
import type {
  BufferStatsResponse,
  ClosedPeriod,
  FixedItemsResponse,
  MortgageResponse,
  SalaryYear,
  SpendingPeriod,
  SpendingStatsResponse,
  StatsRange,
} from "@ledger/contract";
import {
  fetchBufferStats,
  fetchContributions,
  fetchFixedItems,
  fetchMortgageOwn,
  fetchMortgagePayments,
  fetchSalariesStats,
  fetchSettlementsStats,
  fetchSpendingStats,
} from "../api/stats.ts";
import { formatShare, personLabel } from "../labels.ts";
import { endedSentence, reachesClose, spansClose } from "../mortgage.ts";
import { shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import { ChartCard, ColumnChart, LineChart } from "./Chart.tsx";
import type { ColumnSeries, LegendItem, LineSeries, TableData } from "./Chart.tsx";
import { PeriodRows } from "./PeriodRows.tsx";
import { assignSlots, formatAxisCents } from "./scale.ts";
import { useSeries } from "./useSeries.ts";
import type { Series } from "./useSeries.ts";

const SLOTS = 8;

export function slotColor(slot: number): string {
  return `var(--series-${String(slot)})`;
}

const NO_CATEGORY = "var(--series-none)";

/** Each person's colour, by their place in the people list. */
function personColors(people: readonly string[]): Map<string, string> {
  const { slotOf } = assignSlots(people, SLOTS);
  return new Map(people.map((person) => [person, slotColor(slotOf.get(person) ?? SLOTS)]));
}

/** `2026-01-31` as `26-01`: a period or a month on an axis. */
function shortMonth(date: string): string {
  return date.slice(2, 7);
}

function signed(cents: number): string {
  return `${cents > 0 ? "+" : ""}${formatCents(cents)}`;
}

/**
 * A card while its series loads, fails, or is ready; the ready body is the
 * caller's, and so is saying that a read again over the same range failed.
 */
function Loaded<T>(props: {
  title: string;
  series: Series<T>;
  children: (data: T, stale: boolean, failure: string | null) => React.ReactElement;
}): React.ReactElement {
  const { title, series, children } = props;
  if (series.state === "ready") return children(series.data, series.stale, series.failure);
  return (
    <section className="card chart-card">
      <h2>{title}</h2>
      {series.state === "loading" ? (
        <p className="muted">Reading the books…</p>
      ) : (
        <p className="bad" role="alert">
          {series.message}
        </p>
      )}
    </section>
  );
}

function legendOf(items: readonly { key: string; label: string; color: string }[]): LegendItem[] {
  return items.map((item) => ({ key: item.key, label: item.label, color: item.color }));
}

// --- The mortgage ---

/**
 * `mortgage` is what the household says of its mortgage (lg-55). While it is
 * live, or unread, the card is what it always was. Once ended, a range that holds
 * the close ends the line on the last payment with a dot of its own, as a
 * renewal has one; a range before the close is drawn as ever.
 */
export function MortgagePaymentCard({
  range,
  mortgage,
}: {
  range: StatsRange;
  mortgage: MortgageResponse | null;
}): React.ReactElement {
  const series = useSeries(fetchMortgagePayments, range);
  const closedOn = mortgage?.state === "ended" ? mortgage.closedOn : null;
  const ended = closedOn !== null && spansClose(range, closedOn);
  return (
    <Loaded title="Mortgage payment" series={series}>
      {({ payments }, stale) => {
        // The last payment in the books, if this range reaches it.
        const lastIndex = ended
          ? payments.findLastIndex((payment) => payment.date === mortgage?.lastPaymentOn)
          : -1;
        const table: TableData = {
          head: ["Date", "Payment", "Change"],
          rows: payments.map((payment, index) => {
            const change =
              payment.changed && payment.previousCents !== null
                ? signed(payment.cents - payment.previousCents)
                : "";
            if (index !== lastIndex) return [payment.date, formatCents(payment.cents), change];
            return [
              payment.date,
              formatCents(payment.cents),
              change === "" ? "Last payment" : `${change}, last payment`,
            ];
          }),
        };
        return (
          <ChartCard
            title="Mortgage payment"
            caption={`Each payment out of the mortgage bucket. A larger dot is a change: a renewal, or a payment that was not the usual one.${lastIndex === -1 ? "" : " The last dot is the final payment."}`}
            legend={[]}
            table={table}
            empty={
              payments.length > 0
                ? null
                : closedOn === null
                  ? "No payment came out of the mortgage bucket in this range."
                  : `No payment is in this range; the mortgage ended on ${closedOn}.`
            }
            stale={stale}
          >
            <LineChart
              name="Mortgage payment over time"
              dates={payments.map((payment) => payment.date)}
              series={[
                {
                  key: "payment",
                  label: "Payment",
                  color: slotColor(1),
                  values: payments.map((payment) => payment.cents),
                },
              ]}
              formatValue={formatCents}
              formatAxis={formatAxisCents}
              minStep={5000}
              zero={false}
              markers={payments.flatMap((payment, index) =>
                payment.changed || index === lastIndex ? [{ index, seriesKey: "payment" }] : [],
              )}
              notes={(index) => {
                const payment = payments[index];
                if (payment === undefined) return [];
                const ending =
                  index === lastIndex
                    ? [`Last payment on ${payment.date}; the mortgage ended.`]
                    : [];
                if (payment.previousCents === null) {
                  return ["The first payment in the books.", ...ending];
                }
                return payment.changed
                  ? [
                      `Changed from ${formatCents(payment.previousCents)} to ${formatCents(payment.cents)}.`,
                      ...ending,
                    ]
                  : ending;
              }}
            />
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

/**
 * `mortgage` is what the household says of its mortgage (lg-55). Once it has
 * ended, a range that reaches the close says what is left in the bucket is each
 * person's own, theirs to take back, with each person's part: the model has held
 * it as theirs all along, and no row is made to move it.
 */
export function MortgageOwnCard({
  range,
  mortgage,
}: {
  range: StatsRange;
  mortgage: MortgageResponse | null;
}): React.ReactElement {
  const series = useSeries(fetchMortgageOwn, range);
  const names = usePeopleNames();
  const closed = mortgage !== null && mortgage.state === "ended" ? mortgage : null;
  const left = closed !== null && closed.left && reachesClose(closed, range) ? closed : null;
  const note = left === null ? null : endedSentence(left, names);
  return (
    <Loaded title="Own money in the mortgage" series={series}>
      {({ points, people }, stale) => {
        const colors = personColors(people);
        const lines: LineSeries[] = people.map((person) => ({
          key: person,
          label: shownName(names, person),
          color: colors.get(person) ?? slotColor(1),
          values: points.map(
            (point) => point.own.find((own) => own.personId === person)?.ownCents ?? 0,
          ),
        }));
        return (
          <ChartCard
            title="Own money in the mortgage"
            caption="Each person's own money in the bucket: their deposits less half of every payment. It is not shared money."
            legend={legendOf(lines)}
            table={{
              head: ["Date", ...people.map((person) => shownName(names, person)), "In the bucket"],
              rows: points.map((point) => [
                point.date,
                ...people.map((person) =>
                  formatCents(point.own.find((own) => own.personId === person)?.ownCents ?? 0),
                ),
                formatCents(point.balanceCents),
              ]),
            }}
            empty={
              points.length > 0
                ? null
                : closed === null
                  ? "The mortgage bucket did not move in this range."
                  : "Nothing moved in the bucket in this range."
            }
            note={note}
            stale={stale}
          >
            <LineChart
              name="Each person's own money in the mortgage bucket"
              dates={points.map((point) => point.date)}
              series={lines}
              formatValue={formatCents}
              formatAxis={formatAxisCents}
              minStep={10000}
              notes={(index) => [`In the bucket: ${formatCents(points[index]?.balanceCents ?? 0)}`]}
            />
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

// --- What each person has put in ---

export function ContributionCards({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchContributions, range);
  const names = usePeopleNames();
  return (
    <Loaded title="What each person has put in" series={series}>
      {({ series: buckets, people }, stale) => {
        const colors = personColors(people);
        return (
          <>
            {buckets.map((bucket) => {
              const title = `Put into ${bucket.bucket === "mortgage" ? "the mortgage" : "the buffer"}`;
              const lines: LineSeries[] = people.map((person) => ({
                key: person,
                label: shownName(names, person),
                color: colors.get(person) ?? slotColor(1),
                values: bucket.points.map(
                  (point) =>
                    point.contributions.find((one) => one.personId === person)?.contributedCents ??
                    0,
                ),
              }));
              return (
                <ChartCard
                  key={bucket.bucket}
                  title={title}
                  caption="Cumulative: the sum of the rows filed to each person. A joint row is nobody's."
                  legend={legendOf(lines)}
                  table={{
                    head: ["Date", ...people.map((person) => shownName(names, person))],
                    rows: bucket.points.map((point) => [
                      point.date,
                      ...people.map((person) =>
                        formatCents(
                          point.contributions.find((one) => one.personId === person)
                            ?.contributedCents ?? 0,
                        ),
                      ),
                    ]),
                  }}
                  empty={
                    bucket.points.length === 0
                      ? "Nothing was filed to a person in this range."
                      : null
                  }
                  stale={stale}
                >
                  <LineChart
                    name={`${title}, cumulative by person`}
                    dates={bucket.points.map((point) => point.date)}
                    series={lines}
                    formatValue={formatCents}
                    formatAxis={formatAxisCents}
                    minStep={10000}
                  />
                </ChartCard>
              );
            })}
          </>
        );
      }}
    </Loaded>
  );
}

// --- The buffer ---

function BufferBody(props: { data: BufferStatsResponse; stale: boolean }): React.ReactElement {
  const { data, stale } = props;
  const { points, drops } = data;
  const dates = points.map((point) => point.date);
  return (
    <ChartCard
      title="Buffer balance"
      caption={`The balance at the end of each day it moved. A larger dot marks a row that took ${formatCents(data.minDropCents)} or more out.`}
      legend={[]}
      table={{
        head: ["Date", "Balance"],
        rows: points.map((point) => [point.date, formatCents(point.balanceCents)]),
      }}
      empty={points.length === 0 ? "The buffer did not move in this range." : null}
      stale={stale}
    >
      <LineChart
        name="Buffer balance over time"
        dates={dates}
        series={[
          {
            key: "balance",
            label: "Balance",
            color: slotColor(1),
            values: points.map((point) => point.balanceCents),
          },
        ]}
        formatValue={formatCents}
        formatAxis={formatAxisCents}
        minStep={10000}
        area
        markers={drops.flatMap((drop) => {
          const index = dates.indexOf(drop.date);
          return index < 0 ? [] : [{ index, seriesKey: "balance" }];
        })}
        notes={(index) =>
          drops
            .filter((drop) => drop.date === dates[index])
            .map((drop) => `${drop.description}: ${formatCents(drop.amountCents)}`)
        }
      />
    </ChartCard>
  );
}

export function BufferCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchBufferStats, range);
  return (
    <Loaded title="Buffer balance" series={series}>
      {(data, stale) => <BufferBody data={data} stale={stale} />}
    </Loaded>
  );
}

// --- Salaries and the ratio ---

function ratioWords(
  shares: readonly { personId: string; partsPerMillion: number }[],
  names: ShownNames,
): string {
  return shares
    .map((share) => `${shownName(names, share.personId)} ${formatShare(share.partsPerMillion)}`)
    .join(", ");
}

function SalaryBody(props: {
  years: SalaryYear[];
  everyone: readonly string[];
  stale: boolean;
}): React.ReactElement {
  const { years, stale } = props;
  const names = usePeopleNames();
  // Coloured by place in everyone the books know, whatever the range holds; drawn
  // only for the people the range has a salary or a share for.
  const colors = personColors(props.everyone);
  const named = new Set([
    ...years.flatMap((year) => year.salaries.map((salary) => salary.personId)),
    ...years.flatMap((year) => year.ratio?.shares.map((share) => share.personId) ?? []),
  ]);
  const people = props.everyone.filter((person) => named.has(person));
  const categories = years.map((year) => ({
    key: String(year.year),
    label: String(year.year),
    heading: String(year.year),
  }));
  const salaryLines: ColumnSeries[] = people.map((person) => ({
    key: person,
    label: shownName(names, person),
    color: colors.get(person) ?? slotColor(1),
    values: years.map(
      (year) => year.salaries.find((salary) => salary.personId === person)?.amountCents ?? 0,
    ),
  }));
  const ratioLines: ColumnSeries[] = people.map((person) => ({
    key: person,
    label: shownName(names, person),
    color: colors.get(person) ?? slotColor(1),
    values: years.map(
      (year) => year.ratio?.shares.find((share) => share.personId === person)?.partsPerMillion ?? 0,
    ),
  }));
  const empty = years.length === 0 ? "No salary or ratio was entered for these years." : null;
  return (
    <>
      <ChartCard
        title="Salaries by year"
        caption="The salaries that stand for each year, one column per person."
        legend={legendOf(salaryLines)}
        table={{
          head: ["Year", ...people.map((person) => shownName(names, person))],
          rows: years.map((year) => [
            String(year.year),
            ...people.map((person) => {
              const found = year.salaries.find((salary) => salary.personId === person);
              return found === undefined ? "" : formatCents(found.amountCents);
            }),
          ]),
        }}
        empty={empty}
        stale={stale}
      >
        <ColumnChart
          name="Salaries by year"
          categories={categories}
          series={salaryLines}
          mode="grouped"
          formatValue={formatCents}
          formatAxis={formatAxisCents}
          minStep={100_000}
        />
      </ChartCard>
      <ChartCard
        title="Ratio by year"
        caption="Each person's share of the buffer, the ratio in effect on the year's last day."
        legend={legendOf(ratioLines)}
        table={{
          head: ["Year", "Ratio at the year's end", "Changes in the year"],
          rows: years.map((year) => [
            String(year.year),
            year.ratio === null ? "none yet" : ratioWords(year.ratio.shares, names),
            year.changes
              .map((change) => `${change.effectiveFrom}: ${ratioWords(change.shares, names)}`)
              .join("; "),
          ]),
        }}
        empty={empty}
        stale={stale}
      >
        <ColumnChart
          name="Ratio by year"
          categories={categories}
          series={ratioLines}
          mode="stacked"
          formatValue={formatShare}
          formatAxis={(ppm) => `${String(ppm / 10_000)} %`}
          minStep={1}
          fixedAxis={{
            min: 0,
            max: 1_000_000,
            ticks: [0, 250_000, 500_000, 750_000, 1_000_000],
          }}
          notes={(index) =>
            (years[index]?.changes ?? []).map(
              (change) => `From ${change.effectiveFrom}: ${ratioWords(change.shares, names)}`,
            )
          }
        />
      </ChartCard>
    </>
  );
}

export function SalaryCards({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchSalariesStats, range);
  return (
    <Loaded title="Salaries and the ratio" series={series}>
      {({ years, people }, stale) => <SalaryBody years={years} everyone={people} stale={stale} />}
    </Loaded>
  );
}

// --- Spending ---

function nameOf(period: SpendingPeriod): string {
  return `${period.start ?? "the beginning"} to ${period.end}${period.open ? " (open)" : ""}`;
}

function SpendingBody(props: {
  data: SpendingStatsResponse;
  stale: boolean;
  /** The chart was not read again after a write, and shows the figures from before. */
  failure: string | null;
  /** A row's category was written, so the series is out of date. */
  onChanged: () => void;
}): React.ReactElement {
  const { data, stale, failure } = props;
  const { periods, categories } = data;
  // The period whose rows are open below the chart, by its start: the open
  // period's end is the range's last day, today by default, so it moves at
  // midnight and would close the list on the next read (lg-18 F5). `id` makes
  // opening another category of the same period start the list again on it.
  const [opened, setOpened] = useState<{
    id: number;
    start: string | null;
    category: number | "none" | null;
  } | null>(null);
  // Slots are by place in the whole list, which the API sends whatever the range,
  // so a range that leaves a category out does not move the others up a colour.
  const { slotOf, folded } = assignSlots(
    categories.map((category) => category.id),
    SLOTS,
  );
  const present = new Set(
    periods.flatMap((period) => period.categories.map((one) => one.categoryId)),
  );
  const named = categories.filter(
    (category) => !folded.includes(category.id) && present.has(category.id),
  );
  const sums = (ids: readonly (number | null)[]): number[] =>
    periods.map((period) =>
      period.categories
        .filter((one) => ids.includes(one.categoryId))
        .reduce((sum, one) => sum + one.cents, 0),
    );

  const lines: ColumnSeries[] = [
    ...named.map((category) => ({
      key: String(category.id),
      label: category.retired ? `${category.name} (retired)` : category.name,
      color: slotColor(slotOf.get(category.id) ?? SLOTS),
      values: sums([category.id]),
    })),
    ...(folded.some((id) => present.has(id))
      ? [{ key: "more", label: "More categories", color: slotColor(SLOTS), values: sums(folded) }]
      : []),
    ...(present.has(null)
      ? [{ key: "none", label: "Uncategorised", color: NO_CATEGORY, values: sums([null]) }]
      : []),
  ];

  const periodName = (index: number): string => {
    const period = periods[index];
    return period === undefined ? "" : nameOf(period);
  };
  const shown =
    opened === null ? undefined : periods.find((period) => period.start === opened.start);

  return (
    <>
      <ChartCard
        title="Spending by period"
        caption="What the cards paid toward the household and what left the buffer, per period and per spending category. Fixed items are charted below."
        legend={legendOf(lines)}
        table={{
          head: ["Period", "Cards", "Account", "Total", ...lines.map((line) => line.label)],
          rows: periods.map((period, index) => [
            periodName(index),
            formatCents(period.cardCents),
            formatCents(period.accountCents),
            formatCents(period.totalCents),
            ...lines.map((line) => formatCents(line.values[index] ?? 0)),
          ]),
        }}
        empty={periods.length === 0 ? "No period overlaps this range." : null}
        stale={stale}
        failure={
          failure === null
            ? null
            : `The chart was not read again after the change, and shows the figures from before it: ${failure}`
        }
      >
        <ColumnChart
          name="Spending per period, by spending category"
          categories={periods.map((period, index) => ({
            key: period.end,
            label: shortMonth(period.end),
            heading: periodName(index),
          }))}
          series={lines}
          mode="stacked"
          total
          formatValue={formatCents}
          formatAxis={formatAxisCents}
          minStep={10000}
          onOpen={(index, key) => {
            const period = periods[index];
            if (period === undefined) return;
            // "More categories" is several at once, so it opens the whole period.
            const category =
              key === null || key === "more" ? null : key === "none" ? "none" : Number(key);
            setOpened({ id: (opened?.id ?? 0) + 1, start: period.start, category });
          }}
          notes={(index) => {
            const period = periods[index];
            const none = period?.categories.find((one) => one.categoryId === null);
            const refunds = (period?.categories ?? []).some((one) => one.cents < 0);
            return [
              `Cards ${formatCents(period?.cardCents ?? 0)}, account ${formatCents(period?.accountCents ?? 0)}.`,
              ...(none?.detail?.map(
                (detail) =>
                  `Uncategorised: ${detail.label ?? "no text"}, ${formatCents(detail.cents)}`,
              ) ?? []),
              ...(refunds
                ? ["A category with refunds past its purchases is in the table, not drawn."]
                : []),
            ];
          }}
        />
      </ChartCard>
      {opened !== null && shown !== undefined && (
        <PeriodRows
          key={opened.id}
          period={{
            name: nameOf(shown),
            start: shown.start,
            end: shown.end,
          }}
          category={opened.category}
          onChanged={props.onChanged}
          onClose={() => setOpened(null)}
        />
      )}
    </>
  );
}

export function SpendingCard({ range }: { range: StatsRange }): React.ReactElement {
  // Bumped when a row's category is written under the chart, so it is drawn again.
  const [reload, setReload] = useState(0);
  const series = useSeries(fetchSpendingStats, range, reload);
  return (
    <Loaded title="Spending by period" series={series}>
      {(data, stale, failure) => (
        <SpendingBody
          data={data}
          stale={stale}
          failure={failure}
          onChanged={() => setReload((n) => n + 1)}
        />
      )}
    </Loaded>
  );
}

// --- Fixed items ---

function FixedBody(props: { data: FixedItemsResponse; stale: boolean }): React.ReactElement {
  const { data, stale } = props;
  // The API sends every label, in the order they first started, whatever the range
  // (a label with nothing in it is a line of zeros). Slots are by place in that
  // whole list, so a range that drops an earlier item does not move the later ones
  // up a colour, and a new item takes the next one; only lines with an amount are drawn.
  const { slotOf, folded } = assignSlots(
    data.series.map((item) => item.label),
    SLOTS,
  );
  const ordered = data.series.filter((item) => item.cents.some((cents) => cents !== 0));
  const lines: ColumnSeries[] = [
    ...ordered
      .filter((item) => !folded.includes(item.label))
      .map((item) => ({
        key: item.label,
        label: item.label,
        color: slotColor(slotOf.get(item.label) ?? SLOTS),
        values: item.cents,
      })),
    ...(ordered.some((item) => folded.includes(item.label))
      ? [
          {
            key: "more",
            label: "More items",
            color: slotColor(SLOTS),
            values: data.months.map((_, at) =>
              ordered
                .filter((item) => folded.includes(item.label))
                .reduce((sum, item) => sum + (item.cents[at] ?? 0), 0),
            ),
          },
        ]
      : []),
  ];
  return (
    <ChartCard
      title="Fixed items by month"
      caption="Insurance, Internet, subscriptions: what the recurring items generated each month. An item changed from some month on is one line."
      legend={legendOf(lines)}
      table={{
        head: ["Month", ...ordered.map((item) => item.label)],
        rows: data.months.map((month, at) => [
          month,
          ...ordered.map((item) => formatCents(item.cents[at] ?? 0)),
        ]),
      }}
      empty={data.months.length === 0 ? "No fixed item generated anything in this range." : null}
      stale={stale}
    >
      <ColumnChart
        name="Fixed items month by month"
        categories={data.months.map((month) => ({
          key: month,
          label: month.slice(2),
          heading: month,
        }))}
        series={lines}
        mode="stacked"
        total
        formatValue={formatCents}
        formatAxis={formatAxisCents}
        minStep={5000}
      />
    </ChartCard>
  );
}

export function FixedItemsCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchFixedItems, range);
  return (
    <Loaded title="Fixed items by month" series={series}>
      {(data, stale) => <FixedBody data={data} stale={stale} />}
    </Loaded>
  );
}

// --- Settlements ---

/** The old workbook's two formulas are history; only v3 is the tool's own. */
const FORMULA_WORDS = {
  v1: "the old workbook's first formula",
  v2: "the old workbook's second formula",
  v3: "the tool's formula",
} as const;

/**
 * Who owes whom, from the transfers that would settle it directly; between
 * more than two people, each of them (lg-23).
 */
function who(period: ClosedPeriod, names: ShownNames): string {
  const { deposits, transfers } = period.settlement;
  if (transfers.length === 0) {
    // A deposit of a cent can stand where the direct amount rounds to nothing;
    // between two, whom it is owed to is the ratio's other person (gate 1, F3).
    const [deposit, another] = deposits ?? [];
    if (deposit === undefined) return "Even";
    const others = period.settlement.shares
      .map((share) => share.personId)
      .filter((person) => person !== deposit.personId);
    const [recipient] = others;
    return another === undefined && others.length === 1 && recipient !== undefined
      ? `${personLabel(deposit.personId, names)} owes ${personLabel(recipient, names)}`
      : `${personLabel(deposit.personId, names)} owes`;
  }
  return transfers
    .map(
      (transfer) =>
        `${personLabel(transfer.fromId, names)} owes ${personLabel(transfer.toId, names)}`,
    )
    .join(", ");
}

/** What a direct payment would have moved in all: every transfer. */
function directCents(period: ClosedPeriod): number {
  return period.settlement.transfers.reduce((sum, transfer) => sum + transfer.cents, 0);
}

/** What the buffer was asked for in all, or `null` when only direct payment could settle it. */
function intoBufferCents(period: ClosedPeriod): number | null {
  const { deposits } = period.settlement;
  return deposits === null
    ? null
    : deposits.reduce((sum, deposit) => sum + deposit.depositCents, 0);
}

export function SettlementsCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchSettlementsStats, range);
  const names = usePeopleNames();
  return (
    <Loaded title="Settlements" series={series}>
      {({ periods }, stale) => {
        return (
          <ChartCard
            title="Settlements"
            caption="What each closed period settled, as a direct transfer would have paid it, and the formula it was settled by."
            legend={[]}
            table={{
              head: ["Closed", "Formula", "Who owes", "Direct", "Into the buffer"],
              rows: periods.map((period) => [
                period.end,
                period.settlement.formula,
                who(period, names),
                formatCents(directCents(period)),
                intoBufferCents(period) === null
                  ? "only direct"
                  : formatCents(intoBufferCents(period) ?? 0),
              ]),
            }}
            empty={periods.length === 0 ? "No period was closed in this range." : null}
            stale={stale}
          >
            <ColumnChart
              name="Settlement per closed period"
              categories={periods.map((period) => ({
                key: String(period.id),
                label: shortMonth(period.end),
                heading: `${period.start ?? "the beginning"} to ${period.end}`,
              }))}
              series={[
                {
                  key: "net",
                  label: "Direct transfer",
                  color: slotColor(1),
                  values: periods.map(directCents),
                },
              ]}
              mode="grouped"
              formatValue={formatCents}
              formatAxis={formatAxisCents}
              minStep={5000}
              notes={(index) => {
                const period = periods[index];
                if (period === undefined) return [];
                return [
                  `Formula ${period.settlement.formula}: ${FORMULA_WORDS[period.settlement.formula]}.`,
                  `${who(period, names)}.`,
                  intoBufferCents(period) === null
                    ? "Only a direct transfer can settle it."
                    : `Into the buffer instead: ${formatCents(intoBufferCents(period) ?? 0)}.`,
                ];
              }}
            />
          </ChartCard>
        );
      }}
    </Loaded>
  );
}
