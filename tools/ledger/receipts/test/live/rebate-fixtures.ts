/**
 * The synthetic rebate receipts, and what a read of each must give: lg-89's
 * three — the first two rebates folded into their items, the third left an item
 * of its own — and lg-101's fourth, whose two items are printed with their
 * rebates already off, so neither rebate is folded. The receipts are
 * `test/fixtures/<name>.html`, rendered to the `.png` beside each by
 * `render-rebate-fixtures.ts`; the owner's paid read of the `.png`s is
 * `read-rebate-fixtures.ts`.
 *
 * Not a suite: nothing here is named `.test.ts`, so vitest never collects it,
 * and it sits under `test/` so `tsconfig.tests.json` typechecks it.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReceiptItem } from "@ledger/contract";

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export interface RebateFixture {
  name: string;
  /**
   * Words of which the rebate's item's text holds one — its product code or its
   * name, since a reader may leave the code out — and the rebate folded into it.
   */
  folded: { words: readonly string[]; discount: number } | null;
  /** The price of the rebate left as an item of its own, or `null` when none may be. */
  ownItem: number | null;
  /**
   * Items printed with their rebate already off (lg-101), each named as `folded`
   * names one: each must be read at `price`, as printed, with no discount, and
   * no rebate may be left as an item of its own.
   */
  unfolded: readonly { words: readonly string[]; price: number }[];
}

export const REBATE_FIXTURES: readonly RebateFixture[] = [
  {
    name: "rebate-under-its-item",
    folded: { words: ["0412", "FROMAGE"], discount: -150 },
    ownItem: null,
    unfolded: [],
  },
  {
    name: "rebate-away-from-its-item",
    folded: { words: ["1185", "DETERGENT", "DÉTERGENT"], discount: -200 },
    ownItem: null,
    unfolded: [],
  },
  { name: "coupon-on-the-whole-receipt", folded: null, ownItem: -200, unfolded: [] },
  {
    name: "rebate-in-the-printed-price",
    folded: null,
    ownItem: null,
    unfolded: [
      { words: ["0412", "FROMAGE"], price: 649 },
      { words: ["0631", "LAIT"], price: 479 },
    ],
  },
];

/** The first item whose text holds one of `words`. */
function naming(items: readonly ReceiptItem[], words: readonly string[]): ReceiptItem | undefined {
  return items.find((item) => words.some((word) => item.text.toUpperCase().includes(word)));
}

/** Why a reading is not what the fixture expects, or `null` when it is. */
export function wrong(fixture: RebateFixture, items: readonly ReceiptItem[]): string | null {
  if (fixture.folded !== null) {
    const { words, discount } = fixture.folded;
    const owner = naming(items, words);
    if (owner === undefined) return `no item naming ${words.join(" or ")}`;
    if (owner.discount !== discount) {
      return `${owner.text} has discount ${String(owner.discount)}, not ${String(discount)}`;
    }
  }
  if (fixture.folded !== null || fixture.unfolded.length > 0) {
    const left = items.filter((item) => item.price < 0);
    if (left.length > 0)
      return `a negative item is left: ${left.map((item) => item.text).join(", ")}`;
  }
  for (const { words, price } of fixture.unfolded) {
    const owner = naming(items, words);
    if (owner === undefined) return `no item naming ${words.join(" or ")}`;
    if (owner.discount !== null) {
      return `${owner.text} has discount ${String(owner.discount)}, not none: folded twice`;
    }
    if (owner.price !== price) {
      return `${owner.text} is priced ${String(owner.price)}, not ${String(price)} as printed`;
    }
  }
  if (fixture.ownItem !== null) {
    if (!items.some((item) => item.price === fixture.ownItem)) {
      return `no item of its own priced ${String(fixture.ownItem)}`;
    }
    const folded = items.filter((item) => item.discount !== null);
    if (folded.length > 0) return `folded into ${folded.map((item) => item.text).join(", ")}`;
  }
  return null;
}
