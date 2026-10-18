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
      chargedTo: null,
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      spendingCategoryId: 2,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      spendingCategoryId: 3,
      share: "shared",
      chargedTo: null,
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

describe("the taxable marks (lg-26)", () => {
  /** `BASKET` with the item at `index` marked taxable or not, and the six-pack not shared. */
  function marked(index: number, taxable: boolean): ReceiptProposal {
    return {
      ...BASKET,
      items: BASKET.items.map((each, at) => ({
        ...each,
        share: at === 1 ? ("not-shared" as const) : each.share,
        taxable: at === index ? taxable : each.taxable,
      })),
    };
  }

  /** Zero-rated groceries: no tax lines, and a milk that is marked taxable or not. */
  function groceries(milkTaxable: boolean): ReceiptProposal {
    return {
      merchant: "Marché Exemple",
      date: "2026-10-04",
      subtotal: 2_000,
      gst: null,
      qst: null,
      total: 2_000,
      items: [
        { ...item(0), text: "LAIT", price: 1_000, taxable: milkTaxable, share: "not-shared" },
        { ...item(0), text: "PAIN", price: 1_000, taxable: false, share: "shared" },
      ],
    };
  }

  test("flags the six-pack misread as not taxable, and not the basket as printed", () => {
    expect(checkReceipt(marked(1, true))).toEqual([]);
    expect(checkReceipt(marked(1, false))).toEqual(["taxable-differs"]);
    // The money it moves: the misread basket still files, 1,95 $ on the wrong side.
    expect(splitReceipt(marked(1, false)).sharedCents).toBe(1_117);
    expect(splitReceipt(marked(1, true)).sharedCents).toBe(922);
  });

  test("flags the bread misread as taxable", () => {
    expect(checkReceipt(marked(0, true))).toEqual(["taxable-differs"]);
  });

  test("does not flag items all untaxed on a receipt with no tax lines", () => {
    expect(checkReceipt(groceries(false))).toEqual([]);
  });

  test("flags a taxable mark on a receipt with no tax lines, both taxes counting as zero", () => {
    expect(checkReceipt(groceries(true))).toEqual(["taxable-differs"]);
    // The money it moves: 1,50 $ of tax nobody charged comes off the shared part.
    expect(splitReceipt(groceries(true)).notSharedCents).toBe(1_150);
    expect(splitReceipt(groceries(false)).notSharedCents).toBe(1_000);
  });

  test("leaves one tax missing to tax-missing, and no items to no flag", () => {
    expect(checkReceipt({ ...groceries(true), gst: 50, total: 2_050 })).toEqual(["tax-missing"]);
    expect(checkReceipt({ ...BASKET, items: [] })).toEqual([]);
    expect(checkReceipt({ ...groceries(true), items: [] })).toEqual([]);
  });

  test("leaves taxes no taxable part gives to tax-differs alone", () => {
    expect(checkReceipt({ ...BASKET, qst: 190, total: 2_487 })).toEqual(["tax-differs"]);
  });

  test("checks a refund's parts as their magnitudes", () => {
    const refund: ReceiptProposal = {
      ...BASKET,
      subtotal: -2_207,
      gst: -90,
      qst: -179,
      total: -2_476,
      items: BASKET.items.map((each) => ({
        ...each,
        price: -each.price,
        deposit: each.deposit === null ? null : -each.deposit,
      })),
    };

    expect(checkReceipt(refund)).toEqual([]);
    expect(
      checkReceipt({
        ...refund,
        items: refund.items.map((each, at) => (at === 1 ? { ...each, taxable: false } : each)),
      }),
    ).toEqual(["taxable-differs"]);
  });

  test("reads the rates in effect on the receipt's date", () => {
    const changed: SalesTaxRates[] = [
      { from: "2013-01-01", gst: 5_000, qst: 9_975 },
      { from: "2026-07-01", gst: 5_000, qst: 10_975 },
    ];
    // 10,00 $ taxable: GST 0,50 $; QST 0,9975 $ → 1,00 $ before, 1,0975 $ → 1,10 $ after.
    const wine = (date: string, qst: number): ReceiptProposal => ({
      ...BASKET,
      date,
      subtotal: 2_000,
      gst: 50,
      qst,
      total: 2_050 + qst,
      items: [
        { ...item(2), price: 1_000 },
        { ...item(0), price: 1_000 },
      ],
    });

    expect(checkReceipt(wine("2026-06-30", 100), changed)).toEqual([]);
    expect(checkReceipt(wine("2026-07-01", 110), changed)).toEqual([]);
    // The right marks, the wrong rate: tax-differs, and not taxable-differs besides.
    expect(checkReceipt(wine("2026-06-30", 110), changed)).toEqual(["tax-differs"]);
  });
});

/** A receipt with no tax lines, for the cases below that vary only its items. */
const groceriesNoTax: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 1_000,
  gst: null,
  qst: null,
  total: 1_000,
  items: [],
};

describe("the taxable marks beside printed taxes that disagree (lg-26, round 1)", () => {
  /**
   * 10,00 $ taxable and 3,49 $ untaxed, from a store whose printed QST (0,97 $)
   * is not the rate's of the GST's taxable part (0,50 $): `tax-differs`, whatever
   * the marks. `flipped` marks the 3,49 $ taxable as well.
   */
  function disagreeing(flipped: boolean): ReceiptProposal {
    return {
      merchant: "Marché Exemple",
      date: "2026-10-04",
      subtotal: 1_349,
      gst: 50,
      qst: 97,
      total: 1_496,
      items: [
        { ...item(2), text: "VIN", price: 1_000, taxable: true },
        { ...item(0), text: "PAIN", price: 349, taxable: flipped },
      ],
    };
  }

  test("still names a flipped mark when the printed taxes themselves raise tax-differs", () => {
    // The marks as read give GST, so they are not the cause and are left alone.
    expect(checkReceipt(disagreeing(false))).toEqual(["tax-differs"]);
    // 13,49 $ taxable gives neither tax: the flipped mark is named beside tax-differs.
    expect(checkReceipt(disagreeing(true))).toEqual(["tax-differs", "taxable-differs"]);
  });

  test("does not blame the marks for a misread tax that the other tax still agrees with", () => {
    // BASKET's soap and six-pack give 17,98 $ taxable; a QST read as 1,90 $ is the cause.
    expect(checkReceipt({ ...BASKET, qst: 190, total: 2_487 })).toEqual(["tax-differs"]);
  });

  test("a store that rounds tax per line can raise it on marks that are right", () => {
    // 1,54 $ and 1,22 $, both taxable: GST 0,08 $ + 0,06 $, QST 0,15 $ + 0,12 $, per line.
    const perLine: ReceiptProposal = {
      merchant: "Marché Exemple",
      date: "2026-10-04",
      subtotal: 276,
      gst: 14,
      qst: 27,
      total: 317,
      items: [
        { ...item(2), text: "A", price: 154, taxable: true },
        { ...item(2), text: "B", price: 122, taxable: true },
      ],
    };

    expect(checkReceipt(perLine)).toEqual(["taxable-differs"]);
  });

  test("lets 5 cents taxable pass on a receipt with no tax lines, and flags 6", () => {
    // GST's zero range is [-10, 9] cents and QST's [-5, 5]; the check takes both.
    const taxable = (price: number): ReceiptProposal => ({
      ...groceriesNoTax,
      subtotal: 1_000 + price,
      total: 1_000 + price,
      items: [
        { ...item(0), text: "PAIN", price: 1_000, taxable: false },
        { ...item(0), text: "BONBON", price, taxable: true },
      ],
    });

    expect(checkReceipt(taxable(5))).toEqual([]);
    expect(checkReceipt(taxable(6))).toEqual(["taxable-differs"]);
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

/** The six-pack the other's; the bread and the soap not shared. */
function NOTHING_LEFT(receipt: ReceiptProposal): ReceiptProposal {
  return {
    ...receipt,
    items: receipt.items.map((each, at) => ({
      ...each,
      share: at === 1 ? ("theirs" as const) : ("not-shared" as const),
    })),
  };
}

describe("a receipt with nothing left shared (lg-32)", () => {
  /** `BASKET` as a refund: every price, deposit, tax and the total negated. */
  const REFUND: ReceiptProposal = {
    ...BASKET,
    subtotal: -2_207,
    gst: -90,
    qst: -179,
    total: -2_476,
    items: BASKET.items.map((each) => ({
      ...each,
      price: -each.price,
      deposit: each.deposit === null ? null : -each.deposit,
    })),
  };

  test("takes the cent the parts were rounded apart by off the not-shared amount", () => {
    // 3,49 $ + 4,99 $ + 0,7472525 $ → 9,23 $, and 15,54 $, come to 24,77 $ rounded
    // apart and 24,76 $ rounded together, which is the total: the cent is rounding.
    expect(splitReceipt(NOTHING_LEFT(BASKET))).toEqual({
      sharedCents: 0,
      notSharedCents: 922,
      chargedCents: 1_554,
      charges: [{ personId: null, cents: 1_554 }],
    });
  });

  test("does the same for the refund of it, negated", () => {
    expect(splitReceipt(NOTHING_LEFT(REFUND))).toEqual({
      sharedCents: 0,
      notSharedCents: -922,
      chargedCents: -1_554,
      charges: [{ personId: null, cents: -1_554 }],
    });
  });

  test("still shows more than was charged, where the parts together come to more", () => {
    const marks = NOTHING_LEFT(BASKET);

    // A cent short together too, so the cent is not rounding: -1 together, -2 apart.
    // Since lg-30 the reason is the printed total: 2,475 is paid under 2,476.
    expect(splitReceipt(marks, SALES_TAX_RATES, 2_475)).toEqual({
      sharedCents: -2,
      notSharedCents: 923,
      chargedCents: 1_554,
      charges: [{ personId: null, cents: 1_554 }],
    });
    expect(splitReceipt(marks, SALES_TAX_RATES, 2_470).sharedCents).toBe(-7);
  });
});

/**
 * Not-shared items of mixed sign and opposite tax treatment can come to 0 cents
 * together and still be there: gate 1's F2 on lg-32, the coupon.
 */
const COUPON: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 504,
  gst: 20,
  qst: 40,
  total: 564,
  items: [
    {
      text: "CAFE",
      price: 100,
      taxable: false,
      deposit: null,
      spendingCategoryId: null,
      share: "not-shared",
      chargedTo: null,
    },
    {
      text: "COUPON",
      price: -87,
      taxable: true,
      deposit: null,
      spendingCategoryId: null,
      share: "not-shared",
      chargedTo: null,
    },
    {
      text: "FROMAGE",
      price: 491,
      taxable: true,
      deposit: null,
      spendingCategoryId: null,
      share: "theirs",
      chargedTo: null,
    },
  ],
};

describe("not-shared items that come to nothing (lg-32, gate 1 F2)", () => {
  test("the cent still comes off the not-shared items, where their amount rounds to 0", () => {
    // 1,00 $ and -0,87 $ taxed come to -0,028 $, which is 0 cents; the cheese is
    // 5,6452 $, 5,65 $ rounded, so the parts apart are 5,65 $ against 5,64 $ paid.
    expect(checkReceipt(COUPON)).toEqual([]);
    expect(splitReceipt(COUPON)).toEqual({
      sharedCents: 0,
      notSharedCents: -1,
      chargedCents: 565,
      charges: [{ personId: null, cents: 565 }],
    });
  });
});

// --- lg-30: a charge per person, and the rounding judged against the printed total ---

/** `BASKET` with each item's share and whose it is, in order. */
function whose(
  receipt: ReceiptProposal,
  ...marks: (ReceiptItem["share"] | [ReceiptItem["share"], string])[]
): ReceiptProposal {
  return {
    ...receipt,
    items: receipt.items.map((each, at) => {
      const mark = marks[at] ?? "shared";
      return typeof mark === "string"
        ? { ...each, share: mark, chargedTo: null }
        : { ...each, share: mark[0], chargedTo: mark[1] };
    }),
  };
}

/** `BASKET` as a refund: every price, deposit, tax and the total negated. */
const BASKET_REFUND: ReceiptProposal = {
  ...BASKET,
  subtotal: -2_207,
  gst: -90,
  qst: -179,
  total: -2_476,
  items: BASKET.items.map((each) => ({
    ...each,
    price: -each.price,
    deposit: each.deposit === null ? null : -each.deposit,
  })),
};

/**
 * Two taxable items, the first not shared and the second someone else's: 10,00 $
 * and `price`. The taxes are the rates' own on the two, each rounded once, as a
 * till prints them, so `checkReceipt` raises nothing.
 */
function TWO_TAXED(price: number): ReceiptProposal {
  const subtotal = 1_000 + price;
  const gst = Math.round((subtotal * 5_000) / 100_000);
  const qst = Math.round((subtotal * 9_975) / 100_000);
  return {
    merchant: "Marché Exemple",
    date: "2026-10-04",
    subtotal,
    gst,
    qst,
    total: subtotal + gst + qst,
    items: [
      {
        text: "VIN",
        price: 1_000,
        taxable: true,
        deposit: null,
        spendingCategoryId: null,
        share: "not-shared",
        chargedTo: null,
      },
      {
        text: "FROMAGE",
        price,
        taxable: true,
        deposit: null,
        spendingCategoryId: null,
        share: "theirs",
        chargedTo: "sam",
      },
    ],
  };
}

describe("a charge per person (lg-30)", () => {
  test("rounds each person's items apart, so the shared amount takes the cent", () => {
    // Apart 15,54 $ and 5,74 $ (21,28 $); together 21,27 $ and 3,49 $ shared.
    const split = splitReceipt(whose(BASKET, "shared", ["theirs", "casey"], ["theirs", "sam"]));

    expect(split).toEqual({
      sharedCents: 348,
      notSharedCents: 0,
      chargedCents: 2_128,
      charges: [
        { personId: "casey", cents: 1_554 },
        { personId: "sam", cents: 574 },
      ],
    });
  });

  test("lists each person once, in the order their first item is printed", () => {
    const split = splitReceipt(
      whose(BASKET, ["theirs", "sam"], ["theirs", "casey"], ["theirs", "sam"]),
    );

    expect(split.charges.map((charge) => charge.personId)).toEqual(["sam", "casey"]);
    // The bread and the soap are sam's together: 3,49 $ + 5,7372525 $ → 9,23 $.
    expect(split.charges.map((charge) => charge.cents)).toEqual([923, 1_553]);
  });

  test("a charge that names nobody is its own entry, and one that comes to nothing is kept", () => {
    const free: ReceiptProposal = {
      ...BASKET,
      items: [
        ...whose(BASKET, ["theirs", "casey"], "theirs").items,
        {
          text: "SAC",
          price: 0,
          taxable: false,
          deposit: null,
          spendingCategoryId: null,
          share: "theirs",
          chargedTo: "sam",
        },
      ],
    };

    expect(splitReceipt(free).charges).toEqual([
      { personId: "casey", cents: 349 },
      { personId: null, cents: 1_554 },
      { personId: "sam", cents: 0 },
    ]);
  });

  test("the three parts make the payment in every split the earlier tests assert", () => {
    const cases: [ReceiptProposal, number][] = [
      [whose(BASKET, "shared", "theirs", "not-shared"), 2_476],
      [whose(BASKET, "not-shared", "not-shared", "not-shared"), 2_476 + 300],
      [whose(BASKET, "not-shared", "theirs", "not-shared"), 2_476],
      [whose(BASKET, "shared", ["theirs", "casey"], ["theirs", "sam"]), 2_476],
      [whose(BASKET, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"]), 2_476],
      [whose(BASKET, "not-shared", ["theirs", "casey"], ["theirs", "sam"]), 2_476],
      [whose(BASKET_REFUND, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"]), -2_476],
      [COUPON, 564],
    ];

    for (const [receipt, paid] of cases) {
      const split = splitReceipt(receipt, SALES_TAX_RATES, paid);
      expect(split.sharedCents + split.notSharedCents + split.chargedCents).toBe(paid);
      expect(split.charges.reduce((sum, charge) => sum + charge.cents, 0)).toBe(split.chargedCents);
    }
  });
});

describe("the rounding judged against the printed total (lg-30)", () => {
  test("with nothing not shared, the cent comes off the charge largest in size", () => {
    // casey 9,23 $ and sam 15,54 $ are 24,77 $ against 24,76 $ paid, the total.
    expect(
      splitReceipt(whose(BASKET, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"])),
    ).toEqual({
      sharedCents: 0,
      notSharedCents: 0,
      chargedCents: 2_476,
      charges: [
        { personId: "casey", cents: 923 },
        { personId: "sam", cents: 1_553 },
      ],
    });
  });

  test("and on the refund of it, off the charge largest in size, not by value", () => {
    expect(
      splitReceipt(
        whose(BASKET_REFUND, ["theirs", "casey"], ["theirs", "sam"], ["theirs", "casey"]),
      ),
    ).toEqual({
      sharedCents: 0,
      notSharedCents: 0,
      chargedCents: -2_476,
      charges: [
        { personId: "casey", cents: -923 },
        { personId: "sam", cents: -1_553 },
      ],
    });
  });

  test("with not-shared items, the cent comes off the not-shared amount", () => {
    // Apart 3,49 $, 15,54 $ and 5,74 $ are 24,77 $; the not-shared bread takes the cent.
    expect(
      splitReceipt(whose(BASKET, "not-shared", ["theirs", "casey"], ["theirs", "sam"])),
    ).toEqual({
      sharedCents: 0,
      notSharedCents: 348,
      chargedCents: 2_128,
      charges: [
        { personId: "casey", cents: 1_554 },
        { personId: "sam", cents: 574 },
      ],
    });
  });

  test("files a payment of the printed total that the items rounded together exceed", () => {
    // 10,00 $ and 10,07 $: GST 1,00 $, QST 2,00 $, 23,07 $ printed. Apart 11,50 $
    // and 11,58 $ (23,08 $); together 23,0790225 $ → 23,08 $, a cent over too.
    const receipt = TWO_TAXED(1_007);
    expect([receipt.gst, receipt.qst, receipt.total]).toEqual([100, 200, 2_307]);
    expect(checkReceipt(receipt)).toEqual([]);

    expect(splitReceipt(receipt)).toEqual({
      sharedCents: 0,
      notSharedCents: 1_149,
      chargedCents: 1_158,
      charges: [{ personId: "sam", cents: 1_158 }],
    });
  });

  test("refuses a payment a cent under the printed total, which the items rounded together allow", () => {
    // 10,00 $ and 10,12 $: GST 1,01 $, QST 2,01 $, 23,14 $ printed, 23,13 $ paid.
    // Together 23,1329 $ → 23,13 $, which is what was paid; apart 23,14 $.
    const receipt = TWO_TAXED(1_012);
    expect([receipt.gst, receipt.qst, receipt.total]).toEqual([101, 201, 2_314]);
    expect(checkReceipt(receipt)).toEqual([]);

    expect(splitReceipt(receipt, SALES_TAX_RATES, 2_313)).toEqual({
      sharedCents: -1,
      notSharedCents: 1_150,
      chargedCents: 1_164,
      charges: [{ personId: "sam", cents: 1_164 }],
    });
  });

  test("one person charged with everything: the printed total still decides", () => {
    // 10,07 $ taxable alone is 11,5779825 $ → 11,58 $, against 11,57 $ printed
    // (GST 0,50 $, QST 1,00 $): one part, rounded once, a cent over the total.
    const one: ReceiptProposal = {
      ...TWO_TAXED(1_007),
      subtotal: 1_007,
      gst: 50,
      qst: 100,
      total: 1_157,
      items: TWO_TAXED(1_007).items.slice(1),
    };
    expect(checkReceipt(one)).toEqual([]);

    expect(splitReceipt(one).charges).toEqual([{ personId: "sam", cents: 1_157 }]);
    expect(splitReceipt(one).sharedCents).toBe(0);
    expect(splitReceipt(one, SALES_TAX_RATES, 1_156).sharedCents).toBe(-2);
  });

  test("five people's parts can round 3 cents over the total, and that is still rounding", () => {
    // Each item a part of its own, each rounded up by almost half a cent, and both
    // printed taxes rounded down: 50,44 $ apart against 50,41 $ printed and paid.
    const prices = [391, 1_172, 785, 384, 1_653];
    const five: ReceiptProposal = {
      merchant: "Marché Exemple",
      date: "2026-10-04",
      subtotal: 4_385,
      gst: 219,
      qst: 437,
      total: 5_041,
      items: prices.map((price, at) => ({
        text: `ARTICLE ${String(at + 1)}`,
        price,
        taxable: true,
        deposit: null,
        spendingCategoryId: null,
        share: "theirs",
        chargedTo: `person${String(at + 1)}`,
      })),
    };
    expect(checkReceipt(five)).toEqual([]);

    const split = splitReceipt(five);

    expect(split.sharedCents).toBe(0);
    expect(split.charges.map((charge) => charge.cents)).toEqual([450, 1_348, 903, 442, 1_898]);
  });

  test("an excess larger than rounding can make is not adjusted", () => {
    // Marked taxable on a receipt with no taxes: 11,50 $ comes off a 10,00 $ total.
    const untaxed: ReceiptProposal = {
      ...TWO_TAXED(1_000),
      subtotal: 1_000,
      gst: null,
      qst: null,
      total: 1_000,
      items: TWO_TAXED(1_000).items.slice(1),
    };

    expect(splitReceipt(untaxed).sharedCents).toBe(-150);
  });

  test("a shared item that costs something takes no adjustment; a free one does not stop it", () => {
    // Nothing left shared is read by cost (lg-30, owner 2026-10-18): a free shared
    // bag beside the 2,307 receipt does not stop the cent being rounding.
    const receipt = TWO_TAXED(1_007);
    const bag = (price: number): ReceiptProposal["items"][number] => ({
      text: "SAC",
      price,
      taxable: false,
      deposit: null,
      spendingCategoryId: null,
      share: "shared",
      chargedTo: null,
    });
    const free: ReceiptProposal = { ...receipt, items: [...receipt.items, bag(0)] };

    expect(splitReceipt(free)).toEqual({
      sharedCents: 0,
      notSharedCents: 1_149,
      chargedCents: 1_158,
      charges: [{ personId: "sam", cents: 1_158 }],
    });

    // A shared item of 0,01 $ beside parts that round 2 cents over: the shared
    // item is something still shared, so the excess is not taken from the parts.
    const priced = (
      price: number,
      share: "not-shared" | "shared" | "theirs",
      chargedTo: string | null,
    ) => ({
      text: "X",
      price,
      taxable: share !== "shared",
      deposit: null,
      spendingCategoryId: null,
      share,
      chargedTo,
    });
    const costly: ReceiptProposal = {
      merchant: null,
      date: "2026-10-04",
      subtotal: 1_249,
      gst: 62,
      qst: 124,
      total: 1_435,
      items: [
        priced(111, "not-shared", null),
        priced(1, "shared", null),
        priced(137, "theirs", "sam"),
        priced(1_000, "theirs", "casey"),
      ],
    };

    expect(checkReceipt(costly)).toEqual([]);
    expect(splitReceipt(costly).sharedCents).toBe(-1);
  });
});

// lg-30, gate 1 F1 and F3, fixed at landing (owner, 2026-10-18).
describe("what still shared means, and where the bound ends (lg-30, gate 1)", () => {
  const line = (
    price: number,
    taxable: boolean,
    share: "not-shared" | "shared" | "theirs",
    chargedTo: string | null = null,
  ): ReceiptItem => ({
    text: "X",
    price,
    taxable,
    deposit: null,
    spendingCategoryId: null,
    share,
    chargedTo,
  });

  test("a free shared item does not stop the cent being rounding", () => {
    // Main files this receipt (2,531 to sam); a `SAC 0,00` line must not refuse it.
    const withFree: ReceiptProposal = {
      merchant: null,
      date: "2026-10-04",
      subtotal: 4_275,
      gst: 214,
      qst: 426,
      total: 4_915,
      items: [
        line(2_074, true, "not-shared"),
        line(0, false, "shared"),
        line(309, true, "theirs", "sam"),
        line(1_892, true, "theirs", "sam"),
      ],
    };

    expect(checkReceipt(withFree)).toEqual([]);
    expect(splitReceipt(withFree)).toEqual({
      sharedCents: 0,
      notSharedCents: 2_384,
      chargedCents: 2_531,
      charges: [{ personId: "sam", cents: 2_531 }],
    });
    // The same receipt without the free item, which both trees already file.
    const without = { ...withFree, items: withFree.items.filter((item) => item.price > 0) };
    expect(splitReceipt(without)).toEqual(splitReceipt(withFree));
  });

  test("an excess one cent past the bound is not adjusted", () => {
    // 0,14 $ marked taxable on a receipt with no taxes costs 0,16 $: 2 cents over
    // for one part, whose bound is 1.
    const untaxed: ReceiptProposal = {
      merchant: null,
      date: "2026-10-04",
      subtotal: 14,
      gst: null,
      qst: null,
      total: 14,
      items: [line(14, true, "theirs", "sam")],
    };

    expect(splitReceipt(untaxed).sharedCents).toBe(-2);
  });
});
