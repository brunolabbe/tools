/**
 * What the books say of a receipt (lg-8): whether a proposal adds up, and which
 * stored joint-account rows it may document. Both pure; neither reads a photo,
 * and neither changes what it is given.
 *
 * **The check flags and never corrects.** A reader's misread is caught here or
 * not at all: on lg-8's measurement every misread, by every engine, failed this
 * check, so it is the safety net whichever engine reads. A proposal that is
 * flagged is shown for correction; the person, not the check, decides what is
 * filed.
 */

import type { ReceiptFlag, ReceiptProposal } from "@ledger/contract";

/**
 * GST is 5 % and QST 9.975 % of the taxable part, each rounded to the cent. In
 * hundred-thousandths, so the arithmetic stays in integers.
 */
const GST_RATE = 5_000;
const QST_RATE = 9_975;
const RATE_SCALE = 100_000;

/** The integers `t` for which `rate × t`, rounded half-up to a whole, is `tax`. */
function taxableRange(tax: number, rate: number): [number, number] {
  // round(rate·t / SCALE) = tax  ⇔  tax·SCALE − SCALE/2 ≤ rate·t ≤ tax·SCALE + SCALE/2 − 1
  const low = tax * RATE_SCALE - RATE_SCALE / 2;
  const high = tax * RATE_SCALE + RATE_SCALE / 2 - 1;
  return [Math.ceil(low / rate), Math.floor(high / rate)];
}

/**
 * Whether some taxable part of the subtotal, in whole cents, gives both taxes as
 * printed. The taxable part is not read — a grocery receipt taxes some lines and
 * not others — so the check is that one exists, not that it is the subtotal.
 * A refund's parts are all negative and are checked as their magnitudes.
 */
function taxesFit(gst: number, qst: number, subtotal: number | null): boolean {
  const [gstLow, gstHigh] = taxableRange(Math.abs(gst), GST_RATE);
  const [qstLow, qstHigh] = taxableRange(Math.abs(qst), QST_RATE);
  const low = Math.max(0, gstLow, qstLow);
  const high = Math.min(gstHigh, qstHigh, subtotal === null ? Infinity : Math.abs(subtotal));
  return low <= high;
}

/**
 * What is wrong with a proposal, as flags; none when its parts add up.
 *
 * - Subtotal + GST + QST = total, to the cent.
 * - GST at 5 % and QST at 9.975 % of one taxable part of the subtotal.
 * - **A receipt with no tax lines** — both taxes `null`, the measured case for
 *   zero-rated groceries — passes when its subtotal is its total.
 * - A field not read is flagged, never guessed at.
 */
export function checkReceipt(proposal: ReceiptProposal): ReceiptFlag[] {
  const { subtotal, gst, qst, total } = proposal;
  const flags: ReceiptFlag[] = [];
  if (total === null) flags.push("total-missing");
  if (subtotal === null) flags.push("subtotal-missing");
  if ((gst === null) !== (qst === null)) flags.push("tax-missing");

  const parts = [subtotal, gst, qst, total].filter((part) => part !== null);
  if (parts.some((part) => part > 0) && parts.some((part) => part < 0)) {
    // A sum over mixed signs says nothing a person could act on.
    flags.push("signs-differ");
    return flags;
  }
  if (subtotal !== null && total !== null && !flags.includes("tax-missing")) {
    if (subtotal + (gst ?? 0) + (qst ?? 0) !== total) flags.push("parts-differ");
  }
  if (gst !== null && qst !== null && !taxesFit(gst, qst, subtotal)) flags.push("tax-differs");
  return flags;
}

/**
 * How many days either side of a receipt's date its card charge may be dated. A
 * card purchase reaches the account a day or two later, and a weekend adds two;
 * a row dated before the receipt is a date typed wrong, which the person still
 * wants offered.
 */
export const RECEIPT_MATCH_DAYS = 5;

/** A stored joint-account row, as matching needs it. */
export interface MatchableRow {
  id: number;
  date: string;
  description: string;
  amountCents: number;
}

export interface RowMatch {
  row: MatchableRow;
  daysApart: number;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

/**
 * The rows a receipt may document: the account's movement for exactly the
 * amount the person confirmed — a purchase leaves the account, so its row is the
 * amount negated, and a refund's comes back in — dated within
 * `RECEIPT_MATCH_DAYS` of the receipt. Nearest first, then oldest stored first.
 *
 * The amount is what the card was charged, which the person confirms on the
 * form, not the total read: a tip printed under the total makes the two differ.
 */
export function matchReceipt(
  rows: readonly MatchableRow[],
  receipt: { amountCents: number; date: string },
  days: number = RECEIPT_MATCH_DAYS,
): RowMatch[] {
  const day = dayNumber(receipt.date);
  return rows
    .filter((row) => row.amountCents === -receipt.amountCents)
    .map((row) => ({ row, daysApart: Math.abs(dayNumber(row.date) - day) }))
    .filter((match) => match.daysApart <= days)
    .toSorted((a, b) => a.daysApart - b.daysApart || a.row.id - b.row.id);
}
