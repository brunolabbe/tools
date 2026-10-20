/**
 * Who is in the books on a date (lg-35).
 *
 * A person is retired from the books at a close and can return at a later one:
 * each is a record with the day it takes effect, the day after the period it was
 * applied at closed. On any date the person's latest record taking effect on or
 * before it stands, and a person with none is in. The records are given in the
 * order they were written, which is also the order of their dates, since each is
 * applied at a close and the closes only move forward; two on one day (a retire
 * and a return both recorded before the same close) are read in that order, so
 * the later one stands.
 *
 * The history keeps every person who was there — stats, past periods and past
 * settlements read every person the books hold — while anything about the open
 * period or after asks this: the people the screens offer, a ratio confirmed
 * from a date, and the mortgage's joint rows from the day a retirement starts.
 */

/** One retirement or return as the books hold it. */
export interface RetirementInput {
  personId: string;
  action: "retire" | "return";
  /** `yyyy-mm-dd`: the first day it holds. */
  fromDate: string;
}

/** Everyone in `retirements` retired on `date`. */
export function retiredOn(retirements: readonly RetirementInput[], date: string): Set<string> {
  const latest = new Map<string, RetirementInput["action"]>();
  for (const record of retirements) {
    if (record.fromDate <= date) latest.set(record.personId, record.action);
  }
  return new Set([...latest].filter(([, action]) => action === "retire").map(([person]) => person));
}

/** Who of `people` is in on `date`, in the order given. */
export function peopleOn(
  people: readonly string[],
  retirements: readonly RetirementInput[],
  date: string,
): string[] {
  const retired = retiredOn(retirements, date);
  return people.filter((person) => !retired.has(person));
}
