/**
 * The chart pieces the stats screen is made of (lg-9), in plain SVG and HTML with
 * no charting library: the frame every chart sits in, a line chart and a column
 * chart. Written to the `dataviz` skill's specs — thin marks, hairline recessive
 * grid, a 2px surface ring on dots and a 2px gap between touching fills, a legend
 * for two series or more, a table twin for every chart, and text that wears the
 * text tokens and never a series colour.
 *
 * **Made for a phone.** The SVG is drawn at the container's measured width, so
 * its text is 12px on a 360px screen and not a desktop's shrunk to fit. A column
 * chart with more columns than fit at 28px each scrolls sideways, starting at the
 * newest, rather than squeezing to marks too thin to touch. A figure is never only
 * in a hover: the figures for the selected date are always printed under the chart,
 * the latest by default, and a tap, a pointer or the arrow keys move them.
 */

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { dayNumber, monthLabel, monthTicks, nearestIndex, niceTicks, project } from "./scale.ts";

/** What a container with no layout (a test, a hidden tab) is drawn at. */
export const DEFAULT_WIDTH = 320;
/** Room for the widest axis label, which `1,200 $` and `100,000 $` do not share. */
function leftFor(ticks: readonly number[], format: (value: number) => string): number {
  return Math.max(40, 14 + 7 * Math.max(...ticks.map((tick) => format(tick).length)));
}
const RIGHT = 12;
const TOP = 10;
const BOTTOM = 26;
/** The narrowest a column's slot is allowed to be: a thumb's width. */
const MIN_SLOT = 28;
const MAX_BAR = 24;

export interface LegendItem {
  key: string;
  label: string;
  /** A CSS colour, normally one of the `--series-*` tokens. */
  color: string;
}

/** The table twin of a chart: every value the chart draws, readable without seeing it. */
export interface TableData {
  head: string[];
  rows: string[][];
}

export interface ReadoutRow {
  key: string;
  label: string;
  value: string;
  color?: string;
}

/** What the chart says about the selected position. */
export interface Readout {
  heading: string;
  rows: ReadoutRow[];
  notes?: string[];
}

function useWidth(): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: HTMLDivElement | null) => {
    if (node === null) return undefined;
    setWidth(Math.floor(node.clientWidth));
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(Math.floor(node.clientWidth)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width > 0 ? width : DEFAULT_WIDTH];
}

/** Which position is selected: the newest until a pointer or a key says otherwise. */
function useSelection(positions: readonly number[]) {
  const [picked, setPicked] = useState<number | null>(null);
  const last = positions.length - 1;
  const index = picked === null ? last : Math.min(picked, last);
  const point = (event: PointerEvent<SVGSVGElement>): void => {
    const found = nearestIndex(
      positions,
      event.clientX - event.currentTarget.getBoundingClientRect().left,
    );
    if (found >= 0) setPicked(found);
  };
  const press = (event: KeyboardEvent<SVGSVGElement>): void => {
    const target = new Map([
      ["ArrowLeft", Math.max(index - 1, 0)],
      ["ArrowRight", Math.min(index + 1, last)],
      ["Home", 0],
      ["End", last],
    ]).get(event.key);
    if (target === undefined) return;
    event.preventDefault();
    setPicked(target);
  };
  return { index, point, press };
}

// --- The frame ---

export function ChartCard(props: {
  title: string;
  caption: string;
  legend: readonly LegendItem[];
  table: TableData;
  /** Says why there is nothing to draw; `null` when there is. */
  empty: string | null;
  /** The previous render is held, dimmed, while the next loads: no skeleton, no jump. */
  stale: boolean;
  children: ReactNode;
}): React.ReactElement {
  const { title, caption, legend, table, empty, stale, children } = props;
  const [asTable, setAsTable] = useState(false);
  const headingId = useId();
  return (
    <section
      className={`card chart-card${stale ? " stale" : ""}`}
      aria-labelledby={headingId}
      aria-busy={stale}
    >
      <h2 id={headingId}>{title}</h2>
      <p className="muted hint">{caption}</p>
      {empty !== null ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          {legend.length > 1 && (
            <ul className="legend" aria-label="Legend">
              {legend.map((item) => (
                <li key={item.key}>
                  <span className="swatch" style={{ background: item.color }} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          {asTable ? <TableView title={title} table={table} /> : children}
          <button type="button" className="secondary small" onClick={() => setAsTable(!asTable)}>
            {asTable ? "Show the chart" : "Show as a table"}
          </button>
        </>
      )}
    </section>
  );
}

function TableView({ title, table }: { title: string; table: TableData }): React.ReactElement {
  return (
    <div className="chart-scroll">
      <table className="chart-table">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {table.head.map((cell, index) => (
              <th key={cell} scope="col" className={index === 0 ? undefined : "num"}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, at) => (
            <tr key={`${String(at)}:${row[0] ?? ""}`}>
              {row.map((cell, index) => (
                <td
                  key={`${String(index)}:${table.head[index] ?? ""}`}
                  className={index === 0 ? undefined : "num"}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadoutView({ readout }: { readout: Readout | null }): React.ReactElement {
  return (
    <div className="readout" aria-live="polite">
      {readout !== null && (
        <>
          <p className="readout-heading">{readout.heading}</p>
          <ul className="readout-rows">
            {readout.rows.map((row) => (
              <li key={row.key}>
                {row.color !== undefined && (
                  <span className="key" style={{ background: row.color }} aria-hidden="true" />
                )}
                <span className="muted">{row.label}</span>
                <strong>{row.value}</strong>
              </li>
            ))}
          </ul>
          {readout.notes?.map((note) => (
            <p key={note} className="muted hint">
              {note}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

// --- Axes, shared ---

function YAxis(props: {
  ticks: readonly number[];
  y: (value: number) => number;
  left: number;
  right: number;
  format: (value: number) => string;
  /** The gridlines, the labels, or both: a scrolling chart keeps its labels in view apart from its lines. */
  part?: "all" | "grid" | "labels";
}): React.ReactElement {
  const { ticks, y, left, right, format, part = "all" } = props;
  return (
    <g className="axis">
      {ticks.map((tick) => (
        <g key={tick}>
          {part !== "labels" && (
            <line
              x1={left}
              x2={right}
              y1={y(tick)}
              y2={y(tick)}
              className={tick === 0 ? "baseline" : "grid"}
            />
          )}
          {part !== "grid" && (
            <text x={left - 6} y={y(tick)} textAnchor="end" dominantBaseline="middle">
              {format(tick)}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

// --- Lines ---

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  /** One value per date. */
  values: number[];
}

export function LineChart(props: {
  name: string;
  /** `yyyy-mm-dd`, oldest first; every series has a value for each. */
  dates: readonly string[];
  series: readonly LineSeries[];
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  minStep: number;
  /** Points to call out with a larger dot: a renewal, a large drop. */
  markers?: readonly { index: number; seriesKey: string }[];
  /** A wash under a single series, at 10%. */
  area?: boolean;
  /** Whether the axis reaches zero. A balance's does; a payment that hardly moves need not. */
  zero?: boolean;
  notes?: (index: number) => string[];
}): React.ReactElement {
  const { name, dates, series, formatValue, formatAxis, minStep } = props;
  const { markers = [], area = false, zero = true } = props;
  const [box, measured] = useWidth();
  const height = 210;
  const right = measured - RIGHT;

  const all = series.flatMap((one) => one.values);
  const axis = niceTicks(Math.min(...all), Math.max(...all), 4, minStep, zero);
  const left = leftFor(axis.ticks, formatAxis);
  const y = (value: number): number => project(value, axis, height - BOTTOM, TOP);
  const first = dayNumber(dates[0] ?? "1970-01-01");
  const last = dayNumber(dates.at(-1) ?? "1970-01-01");
  const x = (date: string): number =>
    last === first
      ? (left + right) / 2
      : project(dayNumber(date), { min: first, max: last }, left + 6, right - 6);
  const xs = dates.map(x);
  const { index, point, press } = useSelection(xs);

  const labelled = monthTicks(
    dates[0] ?? "",
    dates.at(-1) ?? "",
    Math.max(2, Math.floor((measured - left) / 70)),
  );
  const readout: Readout = {
    heading: dates[index] ?? "",
    rows: series.map((one) => ({
      key: one.key,
      label: one.label,
      value: formatValue(one.values[index] ?? 0),
      color: one.color,
    })),
    notes: props.notes?.(index) ?? [],
  };

  return (
    <div ref={box} className="chart-box">
      <svg
        width={measured}
        height={height}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG chart cannot be an input; slider is the role of something an arrow key steps along.
        role="slider"
        aria-label={`${name}. Arrow keys move between dates.`}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.max(dates.length - 1, 0)}
        aria-valuenow={index}
        aria-valuetext={dates[index] ?? ""}
        tabIndex={0}
        onPointerDown={point}
        onPointerMove={point}
        onKeyDown={press}
        className="chart"
      >
        <YAxis ticks={axis.ticks} y={y} left={left} right={right} format={formatAxis} />
        <g className="axis">
          {labelled.map((date) => (
            <text key={date} x={x(date)} y={height - 8} textAnchor="middle">
              {monthLabel(date)}
            </text>
          ))}
          {labelled.length === 0 && (
            <text x={(left + right) / 2} y={height - 8} textAnchor="middle">
              {dates[0]}
            </text>
          )}
        </g>
        {xs[index] !== undefined && (
          <line x1={xs[index]} x2={xs[index]} y1={TOP} y2={height - BOTTOM} className="crosshair" />
        )}
        {series.map((one) => {
          const ys = one.values.map(y);
          const d = ys
            .map((value, at) =>
              at === 0
                ? `M${String(xs[0])} ${String(value)}`
                : `H${String(xs[at])}V${String(value)}`,
            )
            .join("");
          return (
            <g key={one.key}>
              {area && ys.length > 1 && (
                <path
                  d={`${d}V${String(y(0))}H${String(xs[0])}Z`}
                  style={{ fill: one.color }}
                  className="area"
                />
              )}
              {ys.length > 1 && <path d={d} style={{ stroke: one.color }} className="line" />}
            </g>
          );
        })}
        {markers.map((marker) => {
          const owner = series.find((one) => one.key === marker.seriesKey);
          const value = owner?.values[marker.index];
          const at = xs[marker.index];
          if (owner === undefined || value === undefined || at === undefined) return null;
          return (
            <circle
              key={`${marker.seriesKey}:${String(marker.index)}`}
              cx={at}
              cy={y(value)}
              r={5}
              style={{ fill: owner.color }}
              className="dot marker"
            />
          );
        })}
        {series.map((one) => {
          const value = one.values[index];
          const at = xs[index];
          if (value === undefined || at === undefined) return null;
          return (
            <circle
              key={one.key}
              cx={at}
              cy={y(value)}
              r={4}
              style={{ fill: one.color }}
              className="dot"
            />
          );
        })}
      </svg>
      <ReadoutView readout={readout} />
    </div>
  );
}

// --- Columns ---

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
  /** One value per category. */
  values: number[];
}

/** The path of a bar whose top corners are rounded and whose bottom is square. */
function barPath(x: number, top: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  return `M${String(x)} ${String(top + height)}V${String(top + r)}Q${String(x)} ${String(top)} ${String(x + r)} ${String(top)}H${String(x + width - r)}Q${String(x + width)} ${String(top)} ${String(x + width)} ${String(top + r)}V${String(top + height)}Z`;
}

export function ColumnChart(props: {
  name: string;
  categories: readonly { key: string; label: string; heading: string }[];
  series: readonly ColumnSeries[];
  mode: "stacked" | "grouped";
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  minStep: number;
  /** A fixed axis, for a share that is always out of a hundred. */
  fixedAxis?: { min: number; max: number; ticks: number[] };
  /** A total line in the readout. */
  total?: boolean;
  notes?: (index: number) => string[];
}): React.ReactElement {
  const { name, categories, series, mode, formatValue, formatAxis, minStep, fixedAxis } = props;
  const [box, measured] = useWidth();
  const scroller = useRef<HTMLDivElement | null>(null);
  const height = 210;
  const count = categories.length;

  const heights = categories.map((_, at) =>
    mode === "stacked"
      ? series.reduce((sum, one) => sum + Math.max(one.values[at] ?? 0, 0), 0)
      : Math.max(...series.map((one) => one.values[at] ?? 0), 0),
  );
  const lows = categories.map((_, at) => Math.min(...series.map((one) => one.values[at] ?? 0), 0));
  const axis = fixedAxis ?? niceTicks(Math.min(...lows), Math.max(...heights), 4, minStep);
  const left = leftFor(axis.ticks, formatAxis);
  const slot = Math.max(MIN_SLOT, (measured - left - RIGHT) / Math.max(count, 1));
  const width = Math.max(measured, left + RIGHT + slot * count);
  const right = width - RIGHT;
  const y = (value: number): number => project(value, axis, height - BOTTOM, TOP);
  const centres = categories.map((_, at) => left + slot * at + slot / 2);
  const { index, point, press } = useSelection(centres);

  // Newest at the right, so that is where a phone starts.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollLeft = node.scrollWidth;
  }, [count]);

  const every = Math.max(1, Math.ceil(52 / slot));
  const barWidth = Math.min(MAX_BAR, slot - 8);
  const groupWidth = Math.max(4, Math.min(MAX_BAR, (slot - 8) / Math.max(series.length, 1) - 2));

  const selected = categories[index];
  const readout: Readout | null =
    selected === undefined
      ? null
      : {
          heading: selected.heading,
          rows: [
            ...series.map((one) => ({
              key: one.key,
              label: one.label,
              value: formatValue(one.values[index] ?? 0),
              color: one.color,
            })),
            ...(props.total === true
              ? [
                  {
                    key: "total",
                    label: "Total",
                    value: formatValue(
                      series.reduce((sum, one) => sum + (one.values[index] ?? 0), 0),
                    ),
                  },
                ]
              : []),
          ],
          notes: props.notes?.(index) ?? [],
        };

  return (
    <div ref={box} className="chart-box">
      <div className="chart-scroll with-axis" ref={scroller}>
        {/* The labels stay in view while the columns scroll under them. */}
        <svg
          className="chart chart-yaxis"
          width={left}
          height={height}
          aria-hidden="true"
          style={{ marginRight: -left }}
        >
          <YAxis
            ticks={axis.ticks}
            y={y}
            left={left}
            right={right}
            format={formatAxis}
            part="labels"
          />
        </svg>
        <svg
          width={width}
          height={height}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG chart cannot be an input; slider is the role of something an arrow key steps along.
          role="slider"
          aria-label={`${name}. Arrow keys move between columns.`}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.max(count - 1, 0)}
          aria-valuenow={index}
          aria-valuetext={categories[index]?.heading ?? ""}
          tabIndex={0}
          onPointerDown={point}
          onPointerMove={point}
          onKeyDown={press}
          className="chart"
        >
          <YAxis
            ticks={axis.ticks}
            y={y}
            left={left}
            right={right}
            format={formatAxis}
            part="grid"
          />
          {centres[index] !== undefined && (
            <rect
              x={(centres[index] ?? 0) - slot / 2}
              y={TOP}
              width={slot}
              height={height - BOTTOM - TOP}
              className="selected-band"
            />
          )}
          {categories.map((category, at) => {
            const centre = centres[at] ?? 0;
            if (mode === "grouped") {
              const groupLeft = centre - (groupWidth * series.length + 2 * (series.length - 1)) / 2;
              return (
                <g key={category.key}>
                  {series.map((one, position) => {
                    const value = Math.max(one.values[at] ?? 0, 0);
                    const top = y(value);
                    const bar = y(0) - top;
                    if (bar <= 0) return null;
                    return (
                      <path
                        key={one.key}
                        d={barPath(
                          groupLeft + position * (groupWidth + 2),
                          top,
                          groupWidth,
                          bar,
                          4,
                        )}
                        style={{ fill: one.color }}
                      />
                    );
                  })}
                </g>
              );
            }
            let floor = 0;
            const drawn = series.flatMap((one) => {
              const value = Math.max(one.values[at] ?? 0, 0);
              if (value === 0) return [];
              const from = y(floor);
              floor += value;
              return [{ one, from, to: y(floor) }];
            });
            return (
              <g key={category.key}>
                {drawn.map(({ one, from, to }, position) => {
                  // A 2px gap of surface between segments, not a stroke around them.
                  const gap = position === 0 ? 0 : 1;
                  const bar = Math.max(from - to - gap, 1);
                  const isTop = position === drawn.length - 1;
                  return isTop ? (
                    <path
                      key={one.key}
                      d={barPath(centre - barWidth / 2, from - gap - bar, barWidth, bar, 4)}
                      style={{ fill: one.color }}
                    />
                  ) : (
                    <rect
                      key={one.key}
                      x={centre - barWidth / 2}
                      y={from - gap - bar}
                      width={barWidth}
                      height={bar}
                      style={{ fill: one.color }}
                    />
                  );
                })}
              </g>
            );
          })}
          <g className="axis">
            {categories.map((category, at) =>
              at % every === (count - 1) % every ? (
                <text key={category.key} x={centres[at]} y={height - 8} textAnchor="middle">
                  {category.label}
                </text>
              ) : null,
            )}
          </g>
        </svg>
      </div>
      <ReadoutView readout={readout} />
    </div>
  );
}
