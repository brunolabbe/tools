/**
 * French month names and the abbreviations AccèsD glues onto a day.
 *
 * `JUL`, `AOÛ` and `SEP` were seen in a real paste; the other nine are the same
 * rule applied to the month's name — three letters — and are unverified (the
 * analysis, §2). Both columns are matched with accents and case folded away, so
 * `FEV`, `FÉV` and `fév` are one month, and `AOÛ` and `AOU` another.
 */

interface Month {
  readonly number: number;
  readonly abbreviation: string;
  readonly name: string;
}

const MONTHS: readonly Month[] = [
  { number: 1, abbreviation: "JAN", name: "JANVIER" },
  { number: 2, abbreviation: "FEV", name: "FEVRIER" },
  { number: 3, abbreviation: "MAR", name: "MARS" },
  { number: 4, abbreviation: "AVR", name: "AVRIL" },
  { number: 5, abbreviation: "MAI", name: "MAI" },
  { number: 6, abbreviation: "JUN", name: "JUIN" },
  { number: 7, abbreviation: "JUL", name: "JUILLET" },
  { number: 8, abbreviation: "AOU", name: "AOUT" },
  { number: 9, abbreviation: "SEP", name: "SEPTEMBRE" },
  { number: 10, abbreviation: "OCT", name: "OCTOBRE" },
  { number: 11, abbreviation: "NOV", name: "NOVEMBRE" },
  { number: 12, abbreviation: "DEC", name: "DECEMBRE" },
];

/** Upper case with every accent removed, so `Août`, `AOÛT` and `aout` compare equal. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

/** The month number (1-12) for a full month name, `Septembre` or `AOÛT`. */
export function monthFromName(name: string): number | null {
  const folded = fold(name);
  return MONTHS.find((month) => month.name === folded)?.number ?? null;
}

/** The month number (1-12) for the three-letter abbreviation, `SEP` or `AOÛ`. */
export function monthFromAbbreviation(abbreviation: string): number | null {
  const folded = fold(abbreviation);
  return MONTHS.find((month) => month.abbreviation === folded)?.number ?? null;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
