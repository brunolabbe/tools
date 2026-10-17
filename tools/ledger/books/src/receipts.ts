/**
 * What the books say of a receipt (lg-8): whether a proposal adds up, and which
 * stored joint-account rows it may document. Both pure; neither reads a photo,
 * and neither changes what it is given.
 *
 * **The check flags and never corrects.** A reader's misread is caught here or
 * not at all: on lg-8's measurement every misread, by every engine, failed this
 * check, so it is the safety net whichever engine reads. A proposal that is
 * flagged is shown for correction; the person, not the check, decides what is
 * filed — except that items which do not make the total are never filed
 * (lg-10), since the shared amount is computed from them.
 *
 * **What comes off the shared amount is computed here, never by the model**
 * (lg-10, `splitReceipt`): from the items the person marked, at the rates in
 * effect on the receipt's date (`SALES_TAX_RATES`).
 */

import { AppError } from "@ledger/contract";
import type { ReceiptFlag, ReceiptItem, ReceiptProposal } from "@ledger/contract";

/** A rate in hundred-thousandths — 5 % is 5 000 — so the arithmetic stays in integers. */
export const RATE_SCALE = 100_000;

/** GST and QST as they stood from a day on, until the next entry's `from`. */
export interface SalesTaxRates {
  /** `yyyy-mm-dd`, the first day these rates applied. */
  from: string;
  /** In hundred-thousandths. */
  gst: number;
  /** In hundred-thousandths, on the price alone. */
  qst: number;
}

/**
 * The GST and QST rates by the day they took effect, oldest first (lg-10). A rate
 * change is an entry added here: the owner chose a table in code over stored
 * configuration on 2026-10-16, and the check and the split both read it.
 *
 * It starts on 2013-01-01, when Québec stopped charging QST on the GST and set it
 * at 9.975 % of the price alone; GST has been 5 % since 2008. The tool reads
 * receipts photographed today, so a receipt dated before the table's first day
 * is taken at its first entry rather than at a formula nobody files under.
 */
export const SALES_TAX_RATES: readonly SalesTaxRates[] = [
  { from: "2013-01-01", gst: 5_000, qst: 9_975 },
];

/**
 * The rates in effect on `date`: the latest entry from that day or before. A
 * receipt with no date read is taken at the latest entry, which is what applies
 * to a receipt photographed now.
 */
export function ratesOn(
  date: string | null,
  table: readonly SalesTaxRates[] = SALES_TAX_RATES,
): SalesTaxRates {
  const [first] = table;
  if (first === undefined) throw new AppError("INTERNAL", "There are no sales tax rates.");
  if (date === null) return table.at(-1) ?? first;
  let found = first;
  for (const rates of table) if (rates.from <= date) found = rates;
  return found;
}

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
function taxesFit(
  gst: number,
  qst: number,
  subtotal: number | null,
  rates: SalesTaxRates,
): boolean {
  const [gstLow, gstHigh] = taxableRange(Math.abs(gst), rates.gst);
  const [qstLow, qstHigh] = taxableRange(Math.abs(qst), rates.qst);
  const low = Math.max(0, gstLow, qstLow);
  const high = Math.min(gstHigh, qstHigh, subtotal === null ? Infinity : Math.abs(subtotal));
  return low <= high;
}

/**
 * Whether the items marked taxable, taken as the taxable part, are what the
 * printed taxes say (lg-26): the same arithmetic as `taxesFit`, with the part
 * fixed instead of searched for. A tax not printed counts as zero, so an item
 * marked taxable on a receipt with no tax lines does not fit. A refund is checked
 * as its magnitudes.
 *
 * When the taxes themselves are inconsistent (`taxesConsistent` false) no part
 * gives both, so the marks are only held against each tax on its own: they differ
 * when they give neither. A misread mark is then still named, while a tax that
 * was misread (and still gives the marks' sum on the other tax) is not blamed on them.
 */
function taxableFits(
  items: readonly ReceiptItem[],
  gst: number,
  qst: number,
  rates: SalesTaxRates,
  taxesConsistent: boolean,
): boolean {
  const taxable = Math.abs(items.reduce((sum, item) => sum + (item.taxable ? item.price : 0), 0));
  const [gstLow, gstHigh] = taxableRange(Math.abs(gst), rates.gst);
  const [qstLow, qstHigh] = taxableRange(Math.abs(qst), rates.qst);
  const fitsGst = taxable >= gstLow && taxable <= gstHigh;
  const fitsQst = taxable >= qstLow && taxable <= qstHigh;
  return taxesConsistent ? fitsGst && fitsQst : fitsGst || fitsQst;
}

/**
 * What is wrong with a proposal, as flags; none when its parts add up.
 *
 * - Subtotal + GST + QST = total, to the cent.
 * - GST and QST, at the rates in effect on the receipt's date, of one taxable
 *   part of the subtotal.
 * - **A receipt with no tax lines** — both taxes `null`, the measured case for
 *   zero-rated groceries — passes when its subtotal is its total.
 * - **Items, with their deposits and the taxes, make the total** (lg-10), when
 *   there are items. A tax not printed counts as none. This is the one flag that
 *   blocks filing (`itemsAddUp`).
 * - **The Taxable marks give the printed taxes** (lg-26), when there are items:
 *   the prices of the items marked taxable are a taxable part that gives both
 *   taxes. Both taxes `null` count as printed zero here, so a mark on a receipt
 *   with no tax lines is flagged. Beside `tax-differs` it is raised only when the
 *   marks give **neither** tax; not raised with one tax missing, which
 *   `tax-missing` says, nor with mixed signs.
 * - A field not read is flagged, never guessed at.
 */
export function checkReceipt(
  proposal: ReceiptProposal,
  table: readonly SalesTaxRates[] = SALES_TAX_RATES,
): ReceiptFlag[] {
  const { subtotal, gst, qst, total } = proposal;
  const flags: ReceiptFlag[] = [];
  if (total === null) flags.push("total-missing");
  if (subtotal === null) flags.push("subtotal-missing");
  if ((gst === null) !== (qst === null)) flags.push("tax-missing");
  // Before the signs: an item can be a discount inside a purchase.
  if (!itemsAddUp(proposal)) flags.push("items-differ");

  const parts = [subtotal, gst, qst, total].filter((part) => part !== null);
  if (parts.some((part) => part > 0) && parts.some((part) => part < 0)) {
    // A sum over mixed signs says nothing a person could act on.
    flags.push("signs-differ");
    return flags;
  }
  if (subtotal !== null && total !== null && !flags.includes("tax-missing")) {
    if (subtotal + (gst ?? 0) + (qst ?? 0) !== total) flags.push("parts-differ");
  }
  if (
    gst !== null &&
    qst !== null &&
    !taxesFit(gst, qst, subtotal, ratesOn(proposal.date, table))
  ) {
    flags.push("tax-differs");
  }
  // `tax-differs` depends on the printed taxes alone, so it must not hide every mark.
  if (
    proposal.items.length > 0 &&
    (gst === null) === (qst === null) &&
    !taxableFits(
      proposal.items,
      gst ?? 0,
      qst ?? 0,
      ratesOn(proposal.date, table),
      !flags.includes("tax-differs"),
    )
  ) {
    flags.push("taxable-differs");
  }
  return flags;
}

/**
 * Whether a receipt's items reconcile (lg-10): items + deposits + GST + QST =
 * total, to the cent. A receipt with no items has nothing to reconcile and is
 * filed on its total, as lg-8 filed one; a receipt with items and no total
 * cannot reconcile.
 */
export function itemsAddUp(proposal: ReceiptProposal): boolean {
  if (proposal.items.length === 0) return true;
  if (proposal.total === null) return false;
  const items = proposal.items.reduce((sum, item) => sum + item.price + (item.deposit ?? 0), 0);
  return items + (proposal.gst ?? 0) + (proposal.qst ?? 0) === proposal.total;
}

/**
 * What some items cost, in hundred-thousandths of a cent, exactly: each price,
 * each deposit, and GST and QST on a taxable price. A deposit carries no tax.
 * In `bigint`, since a large price times a rate passes a safe integer.
 */
function itemsCost(items: readonly ReceiptItem[], rates: SalesTaxRates): bigint {
  const scale = BigInt(RATE_SCALE);
  const tax = BigInt(rates.gst + rates.qst);
  return items.reduce((sum, item) => {
    const price = BigInt(item.price);
    const deposit = BigInt(item.deposit ?? 0);
    return sum + price * scale + deposit * scale + (item.taxable ? price * tax : 0n);
  }, 0n);
}

/** Hundred-thousandths of a cent as whole cents, rounded once, half-up — half a cent away from zero. */
function roundCents(exact: bigint): number {
  const scale = BigInt(RATE_SCALE);
  const magnitude = exact < 0n ? -exact : exact;
  const rounded = Number((2n * magnitude + scale) / (2n * scale));
  return exact < 0n ? -rounded : rounded;
}

function totalOf(receipt: ReceiptProposal): number {
  if (receipt.total === null || !itemsAddUp(receipt)) throw new AppError("RECEIPT_DOES_NOT_ADD_UP");
  return receipt.total;
}

/**
 * The shared amount of a receipt with some items excluded (lg-10): the excluded
 * part is each excluded item's price, its deposit, and GST and QST on it if it
 * is taxable, at the rates in effect on the receipt's date, rounded once,
 * half-up; the shared part is the total minus it, so the two always make the
 * total. `excluded` is the items' places in `receipt.items`, from 0.
 *
 * Refuses a receipt whose items do not add up (`RECEIPT_DOES_NOT_ADD_UP`): the
 * printed taxes are on the subtotal, so an item's own taxes can differ from its
 * share of them by a cent, and the remainder is only meaningful against a total
 * the items make.
 */
export function sharedAmount(
  receipt: ReceiptProposal,
  excluded: readonly number[],
  rates: readonly SalesTaxRates[] = SALES_TAX_RATES,
): { excludedCents: number; sharedCents: number } {
  const total = totalOf(receipt);
  const chosen = new Set(excluded);
  const items = receipt.items.filter((_item, index) => chosen.has(index));
  const excludedCents = roundCents(itemsCost(items, ratesOn(receipt.date, rates)));
  return { excludedCents, sharedCents: total - excludedCents };
}

/** A receipt split three ways by its items' `share`: shared + not shared + charged = paid. */
export interface ReceiptSplit {
  /** What stays shared: what was paid, less the two below. */
  sharedCents: number;
  /** The `not-shared` items: they stay with whoever paid. */
  notSharedCents: number;
  /** The `theirs` items: a charge the other person owes in full. */
  chargedCents: number;
}

/**
 * The receipt split by its items' `share`. Each part taken off is computed as
 * `sharedAmount` computes an excluded one — price, deposit and taxes, rounded
 * once — so an item that is the other's costs them exactly what it would come
 * off as not shared. `paidCents` is what the card was charged, the total unless
 * a tip was added under it; the tip stays shared.
 */
export function splitReceipt(
  receipt: ReceiptProposal,
  rates: readonly SalesTaxRates[] = SALES_TAX_RATES,
  paidCents: number = totalOf(receipt),
): ReceiptSplit {
  // Refused when the items do not add up, whatever was paid.
  totalOf(receipt);
  const places = (share: ReceiptItem["share"]): number[] =>
    receipt.items.flatMap((item, index) => (item.share === share ? [index] : []));
  const notSharedCents = sharedAmount(receipt, places("not-shared"), rates).excludedCents;
  const chargedCents = sharedAmount(receipt, places("theirs"), rates).excludedCents;
  return { sharedCents: paidCents - notSharedCents - chargedCents, notSharedCents, chargedCents };
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
