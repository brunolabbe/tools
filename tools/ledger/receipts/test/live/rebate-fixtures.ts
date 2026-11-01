/**
 * lg-89's three synthetic receipts, and what a read of each must give: the
 * first two rebates folded into their items, the third left an item of its own.
 * The receipts are `test/fixtures/<name>.html`, rendered to the `.png` beside
 * each by `render-rebate-fixtures.ts`; the owner's paid read of the `.png`s is
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
}

export const REBATE_FIXTURES: readonly RebateFixture[] = [
  {
    name: "rebate-under-its-item",
    folded: { words: ["0412", "FROMAGE"], discount: -150 },
    ownItem: null,
  },
  {
    name: "rebate-away-from-its-item",
    folded: { words: ["1185", "DETERGENT", "DÉTERGENT"], discount: -200 },
    ownItem: null,
  },
  { name: "coupon-on-the-whole-receipt", folded: null, ownItem: -200 },
];

/** Why a reading is not what the fixture expects, or `null` when it is. */
export function wrong(fixture: RebateFixture, items: readonly ReceiptItem[]): string | null {
  if (fixture.folded !== null) {
    const { words, discount } = fixture.folded;
    const owner = items.find((item) =>
      words.some((word) => item.text.toUpperCase().includes(word)),
    );
    if (owner === undefined) return `no item naming ${words.join(" or ")}`;
    if (owner.discount !== discount) {
      return `${owner.text} has discount ${String(owner.discount)}, not ${String(discount)}`;
    }
    const left = items.filter((item) => item.price < 0);
    if (left.length > 0)
      return `a negative item is left: ${left.map((item) => item.text).join(", ")}`;
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
