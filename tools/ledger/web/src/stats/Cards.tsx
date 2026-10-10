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

import { formatCents } from "@ledger/books";
import type {
  BufferStatsResponse,
  ClosedPeriod,
  FixedItemsResponse,
  SalaryYear,
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
import { ChartCard, ColumnChart, LineChart } from "./Chart.tsx";
import type { ColumnSeries, LegendItem, LineSeries, TableData } from "./Chart.tsx";
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

/** A card while its series loads, fails, or is ready; the ready body is the caller's. */
function Loaded<T>(props: {
  title: string;
  series: Series<T>;
  children: (data: T, stale: boolean) => React.ReactElement;
}): React.ReactElement {
  const { title, series, children } = props;
  if (series.state === "ready") return children(series.data, series.stale);
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

export function MortgagePaymentCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchMortgagePayments, range);
  return (
    <Loaded title="Mortgage payment" series={series}>
      {({ payments }, stale) => {
        const table: TableData = {
          head: ["Date", "Payment", "Change"],
          rows: payments.map((payment) => [
            payment.date,
            formatCents(payment.cents),
            payment.changed && payment.previousCents !== null
              ? signed(payment.cents - payment.previousCents)
              : "",
          ]),
        };
        return (
          <ChartCard
            title="Mortgage payment"
            caption="Each payment out of the mortgage bucket. A larger dot is a change: a renewal, or a payment that was not the usual one."
            legend={[]}
            table={table}
            empty={
              payments.length === 0
                ? "No payment came out of the mortgage bucket in this range."
                : null
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
                payment.changed ? [{ index, seriesKey: "payment" }] : [],
              )}
              notes={(index) => {
                const payment = payments[index];
                if (payment === undefined) return [];
                if (payment.previousCents === null) return ["The first payment in the books."];
                return payment.changed
                  ? [
                      `Changed from ${formatCents(payment.previousCents)} to ${formatCents(payment.cents)}.`,
                    ]
                  : [];
              }}
            />
          </ChartCard>
        );
      }}
    </Loaded>
  );
}

export function MortgageOwnCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchMortgageOwn, range);
  return (
    <Loaded title="Own money in the mortgage" series={series}>
      {({ points, people }, stale) => {
        const colors = personColors(people);
        const lines: LineSeries[] = people.map((person) => ({
          key: person,
          label: person,
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
              head: ["Date", ...people, "In the bucket"],
              rows: points.map((point) => [
                point.date,
                ...people.map((person) =>
                  formatCents(point.own.find((own) => own.personId === person)?.ownCents ?? 0),
                ),
                formatCents(point.balanceCents),
              ]),
            }}
            empty={points.length === 0 ? "The mortgage bucket did not move in this range." : null}
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
                label: person,
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
                    head: ["Date", ...people],
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
      {drops.length > 0 && (
        <>
          <h3 className="chart-subhead">Large drops</h3>
          <ul className="figures">
            {drops.map((drop) => (
              <li key={drop.rowId}>
                <span>
                  <span className="muted">{drop.date}</span> {drop.description}
                </span>
                <span className="amount">{formatCents(drop.amountCents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
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

function ratioWords(shares: readonly { personId: string; partsPerMillion: number }[]): string {
  return shares
    .map((share) => `${share.personId} ${formatShare(share.partsPerMillion)}`)
    .join(", ");
}

function SalaryBody(props: { years: SalaryYear[]; stale: boolean }): React.ReactElement {
  const { years, stale } = props;
  const people = [
    ...new Set([
      ...years.flatMap((year) => year.salaries.map((salary) => salary.personId)),
      ...years.flatMap((year) => year.ratio?.shares.map((share) => share.personId) ?? []),
    ]),
  ].toSorted();
  const colors = personColors(people);
  const categories = years.map((year) => ({
    key: String(year.year),
    label: String(year.year),
    heading: String(year.year),
  }));
  const salaryLines: ColumnSeries[] = people.map((person) => ({
    key: person,
    label: person,
    color: colors.get(person) ?? slotColor(1),
    values: years.map(
      (year) => year.salaries.find((salary) => salary.personId === person)?.amountCents ?? 0,
    ),
  }));
  const ratioLines: ColumnSeries[] = people.map((person) => ({
    key: person,
    label: person,
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
          head: ["Year", ...people],
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
            year.ratio === null ? "none yet" : ratioWords(year.ratio.shares),
            year.changes
              .map((change) => `${change.effectiveFrom}: ${ratioWords(change.shares)}`)
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
              (change) => `From ${change.effectiveFrom}: ${ratioWords(change.shares)}`,
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
      {({ years }, stale) => <SalaryBody years={years} stale={stale} />}
    </Loaded>
  );
}

// --- Spending ---

function SpendingBody(props: { data: SpendingStatsResponse; stale: boolean }): React.ReactElement {
  const { data, stale } = props;
  const { periods, categories } = data;
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
    if (period === undefined) return "";
    return `${period.start ?? "the beginning"} to ${period.end}${period.open ? " (open)" : ""}`;
  };

  return (
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
  );
}

export function SpendingCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchSpendingStats, range);
  return (
    <Loaded title="Spending by period" series={series}>
      {(data, stale) => <SpendingBody data={data} stale={stale} />}
    </Loaded>
  );
}

// --- Fixed items ---

function FixedBody(props: { data: FixedItemsResponse; stale: boolean }): React.ReactElement {
  const { data, stale } = props;
  // The API sends the lines in the order their labels first started, whatever the
  // range, so a new item takes the next colour and never repaints the ones before it.
  const ordered = data.series;
  const { slotOf, folded } = assignSlots(
    ordered.map((item) => item.label),
    SLOTS,
  );
  const lines: ColumnSeries[] = [
    ...ordered
      .filter((item) => !folded.includes(item.label))
      .map((item) => ({
        key: item.label,
        label: item.label,
        color: slotColor(slotOf.get(item.label) ?? SLOTS),
        values: item.cents,
      })),
    ...(folded.length > 0
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

function who(period: ClosedPeriod): string {
  const { payerId, recipientId } = period.settlement;
  return payerId === null || recipientId === null
    ? "Even"
    : `${personLabel(payerId)} owes ${personLabel(recipientId)}`;
}

export function SettlementsCard({ range }: { range: StatsRange }): React.ReactElement {
  const series = useSeries(fetchSettlementsStats, range);
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
                who(period),
                formatCents(period.settlement.netCents),
                period.settlement.depositCents === null
                  ? "only direct"
                  : formatCents(period.settlement.depositCents),
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
                  values: periods.map((period) => period.settlement.netCents),
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
                  `${who(period)}.`,
                  period.settlement.depositCents === null
                    ? "Only a direct transfer can settle it."
                    : `Into the buffer instead: ${formatCents(period.settlement.depositCents)}.`,
                ];
              }}
            />
          </ChartCard>
        );
      }}
    </Loaded>
  );
}
