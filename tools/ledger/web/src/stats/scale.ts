/**
 * The arithmetic of a chart, apart from drawing it: round axis numbers, where a
 * date sits along a time axis, and which of a chart's marks a pointer is nearest.
 * Plain functions of numbers and `yyyy-mm-dd` text, so they are tested without a
 * DOM and a component only places what they return.
 */

/** Round values to put gridlines on, covering `min`..`max` (and so `0` when both are on one side of it). */
export interface Ticks {
  ticks: number[];
  min: number;
  max: number;
}

/**
 * About `target` gridlines at steps of 1, 2 or 5 times a power of ten, never
 * finer than `minStep`. The axis is widened to the outer ticks so no mark leaves
 * it; an empty range (every value equal) still gets an axis. It reaches `0`
 * unless `zero` is false, which a line of values far from it (a payment) does
 * not need and a column always does.
 */
export function niceTicks(min: number, max: number, target = 4, minStep = 1, zero = true): Ticks {
  const lo = zero ? Math.min(min, 0) : min;
  const hi = zero ? Math.max(max, 0) : max;
  const span = hi - lo === 0 ? minStep : hi - lo;
  const raw = Math.max(span / target, minStep);
  const power = 10 ** Math.floor(Math.log10(raw));
  // Of the round steps near the ideal one, the one whose gridlines come closest
  // to `target`, the larger on a tie, and none finer than `minStep`.
  const steps = [power / 10, power, power * 10].flatMap((base) => [base, base * 2, base * 5]);
  const intervals = (candidate: number): number =>
    Math.ceil(hi / candidate - 1e-9) - Math.floor(lo / candidate + 1e-9);
  const step =
    steps
      .filter((candidate) => candidate >= minStep)
      .toSorted(
        (a, b) => Math.abs(intervals(a) - target) - Math.abs(intervals(b) - target) || b - a,
      )[0] ?? raw;
  const first = Math.floor(lo / step) * step;
  const last = Math.max(Math.ceil(hi / step) * step, first + step);
  const ticks: number[] = [];
  for (let value = first; value <= last + step / 1000; value += step) {
    ticks.push(Math.round(value * 1000) / 1000);
  }
  return { ticks, min: first, max: last };
}

/** Whole dollars with a thousands separator, as an axis wants them: `1,200 $`, `−350 $`. */
export function formatAxisCents(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `${cents < 0 && dollars !== 0 ? "−" : ""}${grouped} $`;
}

/** A share in parts per million as a whole-number percent, for an axis. */
export function formatAxisPercent(percent: number): string {
  return `${String(Math.round(percent))} %`;
}

/** Days since 1970-01-01 of a `yyyy-mm-dd`, so dates subtract. */
export function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

/** The first of each month from the one holding `first` on, as `yyyy-mm-01`, up to `last`. */
function monthStarts(first: string, last: string): string[] {
  const starts: string[] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7));
  for (;;) {
    const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
    if (start > last) return starts;
    if (start >= first) starts.push(start);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

/**
 * Month starts to label a time axis from `first` to `last`, at most `max` of
 * them, every month or every few. A span inside one month has none, and the
 * caller labels its two ends instead.
 */
export function monthTicks(first: string, last: string, max: number): string[] {
  const starts = monthStarts(first, last);
  const every = Math.max(1, Math.ceil(starts.length / Math.max(max, 1)));
  return starts.filter((_, index) => index % every === 0);
}

/** `2026-03-01` as `2026-03`: all an axis label needs of a month start. */
export function monthLabel(date: string): string {
  return date.slice(0, 7);
}

/** The index in `positions` nearest to `at`; `-1` when there are none. Ties go to the earlier. */
export function nearestIndex(positions: readonly number[], at: number): number {
  let best = -1;
  let gap = Infinity;
  for (const [index, position] of positions.entries()) {
    const distance = Math.abs(position - at);
    if (distance < gap) {
      best = index;
      gap = distance;
    }
  }
  return best;
}

/** Where a value sits between two pixel positions, `min` at `from` and `max` at `to`. */
export function project(
  value: number,
  domain: { min: number; max: number },
  from: number,
  to: number,
): number {
  if (domain.max === domain.min) return from;
  return from + ((value - domain.min) / (domain.max - domain.min)) * (to - from);
}

/**
 * Colours follow the entity and never its rank: the first `slots` entities, in
 * the order given (the list's own, never by size), take slots 1.. in turn, and
 * the rest share the last slot as one "more" group. A filter that drops one of
 * them therefore does not repaint the others.
 */
export function assignSlots<K extends string | number>(
  keys: readonly K[],
  slots: number,
): { slotOf: Map<K, number>; folded: K[] } {
  const slotOf = new Map<K, number>();
  const folded: K[] = [];
  for (const [index, key] of keys.entries()) {
    if (index < slots - (keys.length > slots ? 1 : 0)) slotOf.set(key, index + 1);
    else {
      slotOf.set(key, slots);
      folded.push(key);
    }
  }
  return { slotOf, folded };
}
