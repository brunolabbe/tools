/**
 * The receipt check and the row match (lg-8). Every proposal is synthetic: the
 * amounts are invented so that their taxes are what the rates give, or are not.
 */

import { describe, expect, test } from "vitest";
import type { ReceiptProposal } from "@ledger/contract";
import { RECEIPT_MATCH_DAYS, checkReceipt, matchReceipt } from "../src/index.ts";
import type { MatchableRow } from "../src/index.ts";

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
