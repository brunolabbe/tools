/**
 * The season filter — §7's "hard filter before the composer ever sees it".
 *
 * A snowmobile trail in April and a pass still under snow are two of §2's five
 * characteristic failures, and both are decidable from data the candidate
 * already carries. So this runs first, on the way in, rather than as a note on
 * a plan that has already been packed around something that cannot happen.
 *
 * Two traps, both inherited from the contract and both easy to get wrong once:
 *
 * - **A window may wrap the new year.** `12-01` to `04-15` is a ski season, not
 *   a malformed pair, and a comparison that assumed `from <= to` would make
 *   winter unrepresentable.
 * - **`season: null` means *not established*, not "all year".** An unknown
 *   window passes the filter and is recorded as unchecked; collapsing the two
 *   is how a plan quietly promises that a hut booked for February is open in
 *   February. `ALL_YEAR` is how a specialist says year-round, and it says it
 *   explicitly.
 *
 * The comparison is a string compare on `MM-DD` — the format sorts, so there
 * is no date parsing here and no timezone to get wrong.
 */

import type { Candidate, SeasonWindow, TripDates } from "@planner/contract";
import { possibleMonthDays } from "./dates.ts";

/**
 * Whether one `MM-DD` falls inside a window, wrapping included.
 *
 * The wrapping case is a union of two ranges rather than an inversion of one:
 * `12-01`–`04-15` is "December onward, or up to mid-April", and both endpoints
 * are inclusive because a season that opens on the first opens on the first.
 */
export function inSeasonOn(window: SeasonWindow, monthDay: string): boolean {
  return window.from <= window.to
    ? monthDay >= window.from && monthDay <= window.to
    : monthDay >= window.from || monthDay <= window.to;
}

/**
 * Whether a candidate could be in season at any point the trip could happen.
 *
 * Deliberately generous, and the generosity is the point: this is the *hard*
 * filter, so it may only remove a candidate that cannot possibly work. A
 * candidate in season for part of an eight-day trip stays, and the packer —
 * which knows each day's actual date — is what keeps it off the days it is
 * shut. Removing it here would delete a real option because of a day it was
 * never going to be placed on.
 *
 * An unknown window (`null`) and an unknown calendar (`open` dates) both pass,
 * for the same reason: neither is evidence of a conflict.
 */
export function couldBeInSeason(candidate: Candidate, dates: TripDates): boolean {
  if (candidate.season === null) return true;

  const possible = possibleMonthDays(dates);
  if (possible === null) return true;

  for (const monthDay of possible) {
    if (inSeasonOn(candidate.season, monthDay)) return true;
  }
  return false;
}

/**
 * Whether a candidate may be placed on a particular day.
 *
 * `date` is `null` for a brief with no calendar, and an unknown day cannot
 * contradict a known season — so it passes, and the plan says the season was
 * not checked rather than pretending it was.
 */
export function inSeasonOnDay(candidate: Candidate, date: string | null): boolean {
  if (candidate.season === null || date === null) return true;
  return inSeasonOn(candidate.season, date.slice(5));
}

/** The candidates that survive the filter, and the ids of those that did not. */
export interface SeasonSplit {
  kept: Candidate[];
  outOfSeason: string[];
  /** Kept, but with no window to check — the critic's problem, never silently fine. */
  seasonUnknown: string[];
}

export function filterBySeason(candidates: readonly Candidate[], dates: TripDates): SeasonSplit {
  const split: SeasonSplit = { kept: [], outOfSeason: [], seasonUnknown: [] };

  for (const candidate of candidates) {
    if (!couldBeInSeason(candidate, dates)) {
      split.outOfSeason.push(candidate.id);
      continue;
    }
    if (candidate.season === null) split.seasonUnknown.push(candidate.id);
    split.kept.push(candidate);
  }

  return split;
}
