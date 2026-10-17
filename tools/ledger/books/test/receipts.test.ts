/**
 * The receipt check and the row match (lg-8). Every proposal is synthetic: the
 * amounts are invented so that their taxes are what the rates give, or are not.
 */

import { describe, expect, test } from "vitest";
import type { ReceiptItem, ReceiptProposal } from "@ledger/contract";
import {
  RECEIPT_MATCH_DAYS,
  SALES_TAX_RATES,
  checkReceipt,
  matchReceipt,
  ratesOn,
  sharedAmount,
  splitByCategory,
  splitReceipt,
} from "../src/index.ts";
import type { MatchableRow, SalesTaxRates } from "../src/index.ts";

/**
 * 15,00 $ of zero-rated groceries and 10,00 $ taxable: GST 0,50 $, QST 0,9975 $
 * rounded to 1,00 $.
 */
const GROCERIES: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_500,
  gst: 50,
  qst: 100,
  total: 2_650,
  items: [],
};

describe("the arithmetic check", () => {
  test("passes a proposal whose parts add up and whose taxes fit one taxable part", () => {
    expect(checkReceipt(GROCERIES)).toEqual([]);
  });

  test.each([
    // 123,45 $ taxable of 200,00 $: GST 6,1725 $ and QST 12,3141 $.
    ["a larger mixed basket", { subtotal: 20_000, gst: 617, qst: 1_231, total: 21_848 }],
    // Everything taxable: 40,00 $, GST 2,00 $, QST 3,99 $.
    ["an all-taxable receipt", { subtotal: 4_000, gst: 200, qst: 399, total: 4_599 }],
    // Printed as zero rather than left off.
    ["taxes printed as zero", { subtotal: 1_899, gst: 0, qst: 0, total: 1_899 }],
  ])("passes %s", (_name, parts) => {
    expect(checkReceipt({ ...GROCERIES, ...parts })).toEqual([]);
  });

  test("flags a total a cent off", () => {
    expect(checkReceipt({ ...GROCERIES, total: 2_651 })).toEqual(["parts-differ"]);
  });

  test("flags a wrong tax, even when the parts still add up", () => {
    // QST 0,90 $ is 9,975 % of no amount GST 0,50 $ is 5 % of.
    expect(checkReceipt({ ...GROCERIES, qst: 90, total: 2_640 })).toEqual(["tax-differs"]);
  });

  test("flags taxes on more than the subtotal holds", () => {
    expect(checkReceipt({ ...GROCERIES, subtotal: 500, total: 650 })).toEqual(["tax-differs"]);
  });

  test.each([
    ["the total", { total: null }, ["total-missing"]],
    ["the subtotal", { subtotal: null }, ["subtotal-missing"]],
    ["one tax", { qst: null }, ["tax-missing"]],
  ] as const)("flags %s not read, and guesses nothing", (_name, missing, flags) => {
    expect(checkReceipt({ ...GROCERIES, ...missing })).toEqual(flags);
  });

  test("passes a receipt with no tax lines when its subtotal is its total", () => {
    const zeroRated = { ...GROCERIES, subtotal: 1_899, gst: null, qst: null, total: 1_899 };

    expect(checkReceipt(zeroRated)).toEqual([]);
    expect(checkReceipt({ ...zeroRated, total: 1_950 })).toEqual(["parts-differ"]);
  });

  test("passes a refund, whose parts are all negative", () => {
    const refund = { ...GROCERIES, subtotal: -2_500, gst: -50, qst: -100, total: -2_650 };

    expect(checkReceipt(refund)).toEqual([]);
  });

  test("flags parts that are a purchase and a refund at once", () => {
    expect(checkReceipt({ ...GROCERIES, total: -2_650 })).toEqual(["signs-differ"]);
  });

  test("never changes the proposal it checks", () => {
    const proposal = { ...GROCERIES, total: 2_651 };
    const before = structuredClone(proposal);

    checkReceipt(proposal);

    expect(proposal).toEqual(before);
  });
});

const ROWS: MatchableRow[] = [
  { id: 1, date: "2026-10-03", description: "Achat /Marché Exemple", amountCents: -2_650 },
  { id: 2, date: "2026-10-06", description: "Achat /Marché Exemple", amountCents: -2_650 },
  { id: 3, date: "2026-10-04", description: "Achat /Quincaillerie", amountCents: -2_651 },
  { id: 4, date: "2026-10-20", description: "Achat /Marché Exemple", amountCents: -2_650 },
  { id: 5, date: "2026-10-04", description: "Remboursement /Marché", amountCents: 2_650 },
];

describe("the row match", () => {
  test("offers the charges for exactly the amount, nearest first, within the window", () => {
    const matches = matchReceipt(ROWS, { amountCents: 2_650, date: "2026-10-04" });

    expect(matches.map((match) => [match.row.id, match.daysApart])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  test("offers a refund the money that came back in", () => {
    const matches = matchReceipt(ROWS, { amountCents: -2_650, date: "2026-10-04" });

    expect(matches.map((match) => match.row.id)).toEqual([5]);
  });

  test("reaches as far as the window either way, and no further", () => {
    const edge = { amountCents: 2_650, date: "2026-10-15" };

    expect(matchReceipt(ROWS, edge).map((match) => match.row.id)).toEqual([4]);
    expect(RECEIPT_MATCH_DAYS).toBe(5);
    expect(matchReceipt(ROWS, edge, 4)).toEqual([]);
  });

  test("counts days across a month's end", () => {
    const rows = [{ ...ROWS[0], id: 9, date: "2026-11-02" } as MatchableRow];

    expect(matchReceipt(rows, { amountCents: 2_650, date: "2026-10-30" })).toEqual([
      { row: rows[0], daysApart: 3 },
    ]);
  });
});

// --- lg-10: items, what comes off the shared amount, and the dated rates ---

/**
 * Bread, zero-rated; a six-pack, taxable, with its 0,60 $ deposit; soap,
 * taxable. Taxable 17,98 $: GST 0,899 $ → 0,90 $, QST 1,7935 $ → 1,79 $. The
 * subtotal holds the deposit, so it is 22,07 $, and the total 24,76 $.
 */
const BASKET: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_207,
  gst: 90,
  qst: 179,
  total: 2_476,
  items: [
    {
      text: "PAIN",
      price: 349,
      taxable: false,
      deposit: null,
      spendingCategoryId: 1,
      share: "shared",
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      spendingCategoryId: 2,
      share: "shared",
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      spendingCategoryId: 3,
      share: "shared",
    },
  ],
};

/** `BASKET`'s item at `index`, which the tests know is there. */
function item(index: number): ReceiptItem {
  const found = BASKET.items[index];
  if (found === undefined) throw new Error(`no item ${String(index)}`);
  return found;
}

describe("the items (lg-10)", () => {
  test("a receipt whose items, deposits and taxes make its total passes the check", () => {
    expect(checkReceipt(BASKET)).toEqual([]);
  });

  test("flags items a cent short of the total, and only that", () => {
    const short = { ...BASKET, items: [{ ...item(0), price: 348 }, item(1), item(2)] };

    expect(checkReceipt(short)).toEqual(["items-differ"]);
  });

  test("flags items with no total to make", () => {
    expect(checkReceipt({ ...BASKET, total: null })).toEqual(["total-missing", "items-differ"]);
  });

  test("takes a taxable excluded item and its deposit off the shared amount, to the cent", () => {
    // 12,99 $ + 0,60 $ + 12,99 $ × 14,975 % = 15,5352525 $ → 15,54 $, rounded once.
    const { excludedCents, sharedCents } = sharedAmount(BASKET, [1]);

    expect(excludedCents).toBe(1_554);
    expect(sharedCents).toBe(922);
    expect(excludedCents + sharedCents).toBe(BASKET.total);
  });

  test("charges no tax on a deposit, nor on a zero-rated item", () => {
    const untaxed = { ...BASKET, items: [item(0), { ...item(1), taxable: false }, item(2)] };

    // 12,99 $ + 0,60 $, untaxed; and 3,49 $, untaxed.
    expect(sharedAmount(untaxed, [1]).excludedCents).toBe(1_359);
    expect(sharedAmount(untaxed, [0]).excludedCents).toBe(349);
  });

  test("rounds the excluded part once, half-up", () => {
    // 20,00 $ × 14,975 % is 2,995 $ exactly: 22,995 $ → 23,00 $.
    const receipt: ReceiptProposal = {
      ...BASKET,
      subtotal: 2_000,
      gst: 100,
      qst: 200,
      total: 2_300,
      items: [{ ...item(2), price: 2_000 }],
    };
    const refund: ReceiptProposal = {
      ...receipt,
      subtotal: -2_000,
      gst: -100,
      qst: -200,
      total: -2_300,
      items: [{ ...item(2), price: -2_000 }],
    };

    expect(sharedAmount(receipt, [0])).toEqual({ excludedCents: 2_300, sharedCents: 0 });
    // Half a cent away from zero, either way.
    expect(sharedAmount(refund, [0])).toEqual({ excludedCents: -2_300, sharedCents: 0 });
  });

  test("refuses to share a receipt whose items do not add up", () => {
    expect(() => sharedAmount({ ...BASKET, total: 2_477 }, [1])).toThrow(
      expect.objectContaining({ code: "RECEIPT_DOES_NOT_ADD_UP" }),
    );
  });

  test("splits three ways, each part off computed alike, and the three make the total", () => {
    const marked: ReceiptProposal = {
      ...BASKET,
      items: [item(0), { ...item(1), share: "theirs" }, { ...item(2), share: "not-shared" }],
    };

    const split = splitReceipt(marked);

    // The six-pack is charged exactly what it would come off as not shared.
    expect(split.chargedCents).toBe(sharedAmount(BASKET, [1]).excludedCents);
    // 4,99 $ + 0,7472525 $ → 5,74 $.
    expect(split.notSharedCents).toBe(574);
    expect(split.sharedCents + split.notSharedCents + split.chargedCents).toBe(BASKET.total);
  });

  test("leaves a tip in the shared part", () => {
    const marked = {
      ...BASKET,
      items: BASKET.items.map((each) => ({ ...each, share: "not-shared" as const })),
    };

    const split = splitReceipt(marked, SALES_TAX_RATES, 2_476 + 300);

    // Every item off, rounded once: 22,07 $ + 17,98 $ × 14,975 % = 24,762505 $ → 24,76 $.
    expect(split.notSharedCents).toBe(2_476);
    expect(split.sharedCents).toBe(300);
  });
});

describe("the dated rates (lg-10)", () => {
  /** An invented change: QST to 10,975 % from 1 July 2026. */
  const CHANGED: SalesTaxRates[] = [
    { from: "2013-01-01", gst: 5_000, qst: 9_975 },
    { from: "2026-07-01", gst: 5_000, qst: 10_975 },
  ];

  /** 10,00 $ of wine, taxable, and 10,00 $ of bread; the QST at the date's rate. */
  function receiptOn(date: string, qst: number): ReceiptProposal {
    return {
      merchant: "Marché Exemple",
      date,
      subtotal: 2_000,
      gst: 50,
      qst,
      total: 2_050 + qst,
      items: [
        { ...item(2), text: "VIN", price: 1_000 },
        { ...item(0), price: 1_000 },
      ],
    };
  }

  test("a rate change mid-year uses the rate in effect on the receipt's date", () => {
    const before = receiptOn("2026-06-30", 100);
    const after = receiptOn("2026-07-01", 110);

    // 10,00 $ + 0,50 $ + 0,9975 $ → 11,50 $; then 10,00 $ + 0,50 $ + 1,0975 $ → 11,60 $.
    expect(sharedAmount(before, [0], CHANGED)).toEqual({
      excludedCents: 1_150,
      sharedCents: 1_000,
    });
    expect(sharedAmount(after, [0], CHANGED)).toEqual({
      excludedCents: 1_160,
      sharedCents: 1_000,
    });
  });

  test("the check reads the same dated rates", () => {
    const after = receiptOn("2026-07-01", 110);

    expect(checkReceipt(after, CHANGED)).toEqual([]);
    expect(checkReceipt(receiptOn("2026-06-30", 110), CHANGED)).toEqual(["tax-differs"]);
    // The table in force has no such change, so the same receipt does not fit it.
    expect(checkReceipt(after)).toEqual(["tax-differs"]);
  });

  test("takes the latest rates for a receipt with no date, and the first for one before the table", () => {
    expect(ratesOn(null, CHANGED)).toBe(CHANGED[1]);
    expect(ratesOn("2010-05-01", CHANGED)).toBe(CHANGED[0]);
    expect(ratesOn("2026-10-04")).toEqual({ from: "2013-01-01", gst: 5_000, qst: 9_975 });
  });
});

/** Oldest first, each day once: `ratesOn` takes the last entry whose day has come. */
function inOrder(table: readonly SalesTaxRates[]): boolean {
  return table.every((rates, index) => index === 0 || (table[index - 1]?.from ?? "") < rates.from);
}

describe("the shipped rate table (lg-10 gate 1, F6)", () => {
  test("is oldest first, with each day once", () => {
    expect(inOrder(SALES_TAX_RATES)).toBe(true);
    // The check can fail: an entry added out of order, or a day given twice.
    const added = { from: "2027-01-01", gst: 5_000, qst: 9_975 };
    expect(inOrder([added, ...SALES_TAX_RATES])).toBe(false);
    expect(inOrder([...SALES_TAX_RATES, ...SALES_TAX_RATES])).toBe(false);
  });
});

describe("a joint-account row's amount, split by its items' categories (lg-27)", () => {
  // Each item's own cost, as `sharedAmount` takes one off: bread 3,49 $; the six-pack
  // with its deposit and both taxes 15,5352525 $ → 15,54 $; the soap with its taxes
  // 5,7372525 $ → 5,74 $. Together 24,77 $, a cent over the 24,76 $ the card was charged.
  const BY_ITEM = { date: BASKET.date, items: BASKET.items };

  test("two or more categories chart as amounts that sum to the row's amount, to the cent", () => {
    const split = splitByCategory(2_476, BY_ITEM);

    // The cent the items' own taxes add comes off the largest category, the six-pack's.
    expect(split).toEqual([
      { categoryId: 1, cents: 349 },
      { categoryId: 2, cents: 1_553 },
      { categoryId: 3, cents: 574 },
    ]);
    expect(split.reduce((sum, slice) => sum + slice.cents, 0)).toBe(2_476);
  });

  test("a tip charted on top of the total goes to the largest category", () => {
    const split = splitByCategory(2_476 + 300, BY_ITEM);

    // 15,54 $ rounded, plus the 3,00 $ tip, less the cent the items run over.
    expect(split).toEqual([
      { categoryId: 1, cents: 349 },
      { categoryId: 2, cents: 1_853 },
      { categoryId: 3, cents: 574 },
    ]);
    expect(split.reduce((sum, slice) => sum + slice.cents, 0)).toBe(2_776);
  });

  test("items of one category are summed before they are rounded, once", () => {
    // 0,03 $ taxable is 3,4 ¢ with its taxes: 3 ¢ alone, and 6,9 ¢ → 7 ¢ for two.
    const penny = { ...item(2), price: 3 };

    const together = splitByCategory(7, { date: BASKET.date, items: [penny, penny] });
    const apart = splitByCategory(7, {
      date: BASKET.date,
      items: [penny, { ...penny, spendingCategoryId: 1 }],
    });

    expect(together).toEqual([{ categoryId: 3, cents: 7 }]);
    // Rounded apart they make 6 ¢; the cent left over goes to the first of two equal.
    expect(apart).toEqual([
      { categoryId: 3, cents: 4 },
      { categoryId: 1, cents: 3 },
    ]);
  });

  test("an item with no category is a category of its own, and a tie goes to the earlier", () => {
    const split = splitByCategory(2_000, {
      date: BASKET.date,
      items: [
        { ...item(0), price: 999, spendingCategoryId: null },
        { ...item(0), price: 999, spendingCategoryId: 4 },
      ],
    });

    expect(split).toEqual([
      { categoryId: null, cents: 1_001 },
      { categoryId: 4, cents: 999 },
    ]);
  });

  test("a refund splits as a purchase does, with its signs", () => {
    const refund = BASKET.items.map((one) => ({
      ...one,
      price: -one.price,
      deposit: one.deposit === null ? null : -one.deposit,
    }));

    const split = splitByCategory(-2_476, { date: BASKET.date, items: refund });

    expect(split).toEqual([
      { categoryId: 1, cents: -349 },
      { categoryId: 2, cents: -1_553 },
      { categoryId: 3, cents: -574 },
    ]);
  });

  test("a category that comes to nothing is left out, and a receipt with no items answers none", () => {
    const free = { ...item(0), price: 0, spendingCategoryId: 4 };

    expect(splitByCategory(349, { date: BASKET.date, items: [item(0), free] })).toEqual([
      { categoryId: 1, cents: 349 },
    ]);
    expect(splitByCategory(2_650, { date: BASKET.date, items: [] })).toEqual([]);
  });

  test("reads the rates in effect on the receipt's date", () => {
    const changed: SalesTaxRates[] = [
      { from: "2013-01-01", gst: 5_000, qst: 9_975 },
      { from: "2026-07-01", gst: 5_000, qst: 10_975 },
    ];
    // 10,00 $ of soap, taxable, is 11,50 $ before the change and 11,60 $ after;
    // the 15,00 $ of bread is the larger, so it absorbs whatever is left over.
    const items = [
      { ...item(2), price: 1_000 },
      { ...item(0), price: 1_500 },
    ];
    const on = (date: string, amount: number) => splitByCategory(amount, { date, items }, changed);

    expect(on("2026-06-30", 2_650)).toEqual([
      { categoryId: 3, cents: 1_150 },
      { categoryId: 1, cents: 1_500 },
    ]);
    expect(on("2026-07-01", 2_660)).toEqual([
      { categoryId: 3, cents: 1_160 },
      { categoryId: 1, cents: 1_500 },
    ]);
    // The same amount on the other side of the change: the soap moves, the bread pays.
    expect(on("2026-07-01", 2_650)).toEqual([
      { categoryId: 3, cents: 1_160 },
      { categoryId: 1, cents: 1_490 },
    ]);
  });
});

describe("the guard on a remainder that turns the largest category over (lg-27 gate 1, F3)", () => {
  const BASKET_AT = (amount: number) =>
    splitByCategory(amount, { date: BASKET.date, items: BASKET.items });

  test("a basket part paid by card gives no split, where it gave Alcohol −4,23 $", () => {
    // 5,00 $ on the card, the rest by gift card: 15,54 $ + (5,00 − 24,77) $ is below zero.
    expect(BASKET_AT(500)).toEqual([]);
  });

  test("a purchase's receipt on a refund row gives no split", () => {
    // The row is +24,76 $, so the amount spent is −24,76 $: the six-pack would be −33,99 $.
    expect(BASKET_AT(-2_476)).toEqual([]);
  });

  test("a remainder is still split when it leaves the largest category's sign alone", () => {
    // 100,00 $ charged for a 24,77 $ basket is a large remainder but not a sign
    // change; the owner's guard is the sign, so the six-pack takes 90,77 $.
    expect(BASKET_AT(10_000)).toEqual([
      { categoryId: 1, cents: 349 },
      { categoryId: 2, cents: 9_077 },
      { categoryId: 3, cents: 574 },
    ]);
  });
});
