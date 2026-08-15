/**
 * What the list calls an intake before it is a plan.
 *
 * pl-7's brief assumed the title came from the destination. pl-6 moved that
 * further away than the brief expected: `destination` is a **refine** question —
 * §1's hard facts do not include where, and "somewhere warm, you pick" is a real
 * trip — so it is the first question *past* the checkpoint. An intake that stops
 * where the wizard invites it to stop has no destination at all, and a list of
 * rows called "Untitled" is a list nobody can read.
 *
 * So the title is the shape and the month: "A backcountry trip in February". Both
 * are `core`, so every intake past its second answer has one, and neither needs a
 * column of its own — the brief is derivable from the answers, and this is
 * derived from the brief. The destination joins it when there is one, because by
 * then it is the thing the user would recognise the row by.
 */

import { isAnswered, type TripBrief, type TripDates, type TripShape } from "@planner/contract";

/** Long enough to be recognisable; the destination slot allows five times this. */
const MAX_TITLE_CHARS = 200;

/**
 * Read as "a road trip in February". Lower case because the destination clause
 * usually comes first; `capitalise` fixes the standalone case.
 */
const SHAPE_PHRASES: Record<TripShape, string> = {
  "road-trip": "a road trip",
  backcountry: "a backcountry trip",
  "motorised-touring": "a touring trip",
  "city-and-culture": "a city trip",
  resort: "a resort stay",
  "multi-city": "a multi-city trip",
};

/**
 * Named from the ISO string rather than a `Date`, so no timezone can move a
 * departure to the month before it.
 */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthOf(isoDate: string): string | null {
  return MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? null;
}

function whenPhrase(dates: TripDates): string {
  switch (dates.kind) {
    case "exact": {
      const month = monthOf(dates.departure);
      return month === null ? "" : ` in ${month}`;
    }
    case "window": {
      const month = monthOf(dates.earliest);
      return month === null ? "" : ` around ${month}`;
    }
    // The honest state for "whenever is best": there is no month to name, so
    // the length is what distinguishes this trip from the next one.
    case "open":
      return ` for ${String(dates.nights)} ${dates.nights === 1 ? "night" : "nights"}`;
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function truncate(text: string): string {
  return text.length <= MAX_TITLE_CHARS ? text : `${text.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
}

/**
 * Null until there is something true to say — an intake with no answers yet, or
 * one whose only answers were declined.
 */
export function intakeTitle(brief: TripBrief): string | null {
  if (!isAnswered(brief.shape)) return null;

  const shape = SHAPE_PHRASES[brief.shape.value];
  const when = isAnswered(brief.dates) ? whenPhrase(brief.dates.value) : "";
  const trip = `${shape}${when}`;

  return truncate(
    isAnswered(brief.destination)
      ? `${brief.destination.value.trim()} — ${trip}`
      : capitalise(trip),
  );
}
