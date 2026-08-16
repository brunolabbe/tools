/**
 * The trip's calendar, or the honest absence of one.
 *
 * `PlanDay.dayIndex` is always present and `PlanDay.date` may be `null`, which
 * is pl-3's flexible dates arriving in the packer: a brief whose dates are a
 * `window` or `open` has no calendar to hang a plan on, and inventing a
 * departure date so the packer has something to subtract would be planning
 * against a date the user never chose. So this module turns any `TripDates`
 * into a day count, and a date per day only when the brief actually has one.
 *
 * **No clock.** `now` is an argument everywhere it is needed, the same rule
 * `@planner/intake` carries and for the same reason: a `Date.now()` in here is
 * a booking deadline that changes answer at midnight, and a test that fails
 * with it.
 *
 * Arithmetic is on whole UTC days. The server does not know the traveller's
 * timezone — `validateAnswer` makes the same choice for the same reason — and
 * a lead time in days has no business being sensitive to one.
 */

import { MAX_PLAN_DAYS } from "@planner/contract";
import type { TripDates } from "@planner/contract";

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` to whole days since the epoch. ISO dates are already sorted. */
function toEpochDay(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** The inverse. `new Date(number)` reads no clock — the argument is the instant. */
function toIsoDate(epochDay: number): string {
  return new Date(epochDay * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `MM-DD`, which is the unit a `SeasonWindow` is written in. */
export function monthDay(date: string): string {
  return date.slice(5);
}

/**
 * The days a plan for these dates has, and their dates when there are any.
 *
 * `dates` is dense and the same length as `dayCount`, so the packer indexes it
 * rather than re-deriving; every entry is `null` when the brief has no
 * calendar, which is a property of the brief and never of a single day.
 */
export interface TripSpan {
  /** How many `PlanDay`s to build. At least 1, at most `MAX_PLAN_DAYS`. */
  dayCount: number;
  /** `YYYY-MM-DD` per day index, or `null` throughout. */
  dates: (string | null)[];
  /**
   * True when the day count was cut to `MAX_PLAN_DAYS`.
   *
   * A 60-night trip is 61 days and the contract caps a plan at 60, so the
   * longest trips this tool accepts lose their last day. Reported rather than
   * clamped in silence — the caller puts it on the plan.
   */
  truncated: boolean;
}

/**
 * A day count from any `TripDates`, with dates only when the brief has them.
 *
 * Nights plus one: a trip of eight nights is nine days, because the day you
 * drive home is a day someone has to be told about. That is also why the cap
 * can bite — see `truncated`.
 */
export function tripSpan(dates: TripDates): TripSpan {
  const nights =
    dates.kind === "exact" ? toEpochDay(dates.return) - toEpochDay(dates.departure) : dates.nights;

  const wanted = nights + 1;
  const dayCount = Math.min(Math.max(wanted, 1), MAX_PLAN_DAYS);

  if (dates.kind !== "exact") {
    return { dayCount, dates: Array.from({ length: dayCount }, () => null), truncated: false };
  }

  const start = toEpochDay(dates.departure);
  return {
    dayCount,
    dates: Array.from({ length: dayCount }, (_, index) => toIsoDate(start + index)),
    truncated: dayCount < wanted,
  };
}

/**
 * How many days there are to book something in, or `null` when nobody knows.
 *
 * `open` dates return `null` rather than a number: "ten nights, whenever is
 * best" has no departure to count back from, and a lead-time check against an
 * invented one would reject a hut that is perfectly bookable. A `window`
 * counts from its earliest day, which is the only answer that cannot be
 * optimistic.
 *
 * Never negative. A departure already in the past is `INVALID_DATES` and the
 * intake's business; by the time a brief reaches here the useful reading of a
 * past date is that nothing can be booked, which is what zero says.
 */
export function daysUntilDeparture(dates: TripDates, now: Date): number | null {
  const departure =
    dates.kind === "exact" ? dates.departure : dates.kind === "window" ? dates.earliest : null;
  if (departure === null) return null;

  return Math.max(0, toEpochDay(departure) - toEpochDay(now.toISOString().slice(0, 10)));
}

/**
 * Every `MM-DD` the trip could possibly fall on, for the season filter.
 *
 * For exact dates that is the trip's own days. For a `window` it is every day
 * the window allows, because the trip may land anywhere inside it and a
 * candidate in season for part of the window is not out of season for the trip.
 * For `open` dates it is `null` — there is no calendar at all, and a filter
 * that treated that as "no month matches" would delete every seasonal candidate
 * from every flexible trip.
 *
 * Bounded at a year: a window that covers one covers every `MM-DD` there is, so
 * it is answered from a leap year's calendar rather than by walking the real
 * one. Walking would give 365 days for a window starting in a common year and
 * silently rule out anything whose season is `02-29`.
 */
export function possibleMonthDays(dates: TripDates): ReadonlySet<string> | null {
  const [first, last] =
    dates.kind === "exact"
      ? [dates.departure, dates.return]
      : dates.kind === "window"
        ? [dates.earliest, dates.latest]
        : [null, null];

  if (first === null || last === null) return null;

  const start = toEpochDay(first);
  const span = toEpochDay(last) - start;

  // 2000 is a leap year, and any leap year would do — the year is discarded by
  // `monthDay`, and only the presence of a 29th of February survives it.
  const [from, count] = span >= 365 ? [toEpochDay("2000-01-01"), 366] : [start, span + 1];

  const days = new Set<string>();
  for (let offset = 0; offset < count; offset += 1) days.add(monthDay(toIsoDate(from + offset)));
  return days;
}
