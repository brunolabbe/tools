/**
 * lg-89's paid read, without a model: what `read-rebate-fixtures.ts` refuses
 * before it spends, what it prints of a failure, and what `wrong()` calls a
 * pass. No key, no file, no network, nothing spent. The shape of
 * `api/test/layout-live-gate.test.ts`, which pins the layout run's consent.
 */

import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import type { ReceiptItem } from "@ledger/contract";
import { assertPaidReadConsent, failureNote, keyFrom } from "./live/paid-read.ts";
import { REBATE_FIXTURES, wrong } from "./live/rebate-fixtures.ts";
import type { RebateFixture } from "./live/rebate-fixtures.ts";

const ARGS = ["--paid", ".claude/.keys", "out.json"];

describe("the rebate fixtures' paid read: consent", () => {
  test("refuses without --paid, a key file and an output path", () => {
    for (const args of [
      [],
      ["--paid"],
      ["--paid", "keys"],
      ["keys", "out.json"],
      ["-p", "k", "o"],
    ]) {
      expect(() => assertPaidReadConsent(args, {}), args.join(" ")).toThrow("usage:");
    }
    expect(assertPaidReadConsent(ARGS, {})).toEqual({ keyFile: ".claude/.keys", out: "out.json" });
  });

  test("refuses ANTHROPIC_CUSTOM_HEADERS, and never repeats its value", () => {
    const env = { ANTHROPIC_CUSTOM_HEADERS: "x-demo-header: from-the-shell" };
    expect(() => assertPaidReadConsent(ARGS, env)).toThrow("ANTHROPIC_CUSTOM_HEADERS is set");
    expect(() => assertPaidReadConsent(ARGS, env)).not.toThrow("from-the-shell");
    // Blank is unset, as the SDK reads it.
    expect(assertPaidReadConsent(ARGS, { ANTHROPIC_CUSTOM_HEADERS: "  " }).out).toBe("out.json");
  });
});

describe("the rebate fixtures' paid read: the key file", () => {
  test("takes the LEDGER= line among others, or a file holding the key alone", () => {
    expect(keyFrom("PLANNER=sk-planner\nLEDGER=sk-ledger\nOTHER=sk-other\n")).toBe("sk-ledger");
    expect(keyFrom("LEDGER= sk-ledger \r\n")).toBe("sk-ledger");
    expect(keyFrom("sk-alone\n")).toBe("sk-alone");
  });

  test("refuses several lines with no LEDGER= line, and repeats none of them", () => {
    const text = "PLANNER=sk-planner-secret\nOTHER=sk-other-secret\n";
    expect(() => keyFrom(text)).toThrow("none starts LEDGER=");
    try {
      keyFrom(text);
    } catch (error: unknown) {
      const said = error instanceof Error ? error.message : "";
      expect(said).not.toContain("secret");
      expect(said).not.toContain("PLANNER");
    }
  });

  test("prints a failed read's code and never its message or cause", () => {
    const error = new AppError("RECEIPT_UNREADABLE", undefined, {
      cause: new TypeError('Headers.append: "Bearer sk-secret" is an invalid header value'),
    });
    expect(failureNote(error)).toBe("RECEIPT_UNREADABLE");
    expect(failureNote(new TypeError("Bearer sk-secret"))).toBe("an error with no code");
    expect(failureNote(new TypeError("Bearer sk-secret"))).not.toContain("secret");
  });
});

function item(text: string, price: number, discount: number | null = null): ReceiptItem {
  return {
    text,
    price,
    taxable: false,
    deposit: null,
    discount,
    spendingCategoryId: null,
    share: "shared",
    chargedTo: null,
  };
}

function fixture(name: string): RebateFixture {
  const found = REBATE_FIXTURES.find((each) => each.name === name);
  if (found === undefined) throw new Error(`no fixture ${name}`);
  return found;
}

describe("the rebate fixtures' paid read: what a pass is", () => {
  test("a rebate folded into its item, by code or by name, passes", () => {
    expect(wrong(fixture("rebate-under-its-item"), [item("0412 FROMAGE", 799, -150)])).toBeNull();
    expect(wrong(fixture("rebate-under-its-item"), [item("Fromage", 799, -150)])).toBeNull();
    expect(
      wrong(fixture("rebate-away-from-its-item"), [item("1185 DETERGENT", 899, -200)]),
    ).toBeNull();
  });

  test("a folded rebate that is the wrong amount, absent, or left as a negative item fails", () => {
    const under = fixture("rebate-under-its-item");
    expect(wrong(under, [item("0412 FROMAGE", 799, -100)])).toContain("not -150");
    expect(wrong(under, [item("0412 FROMAGE", 799)])).toContain("not -150");
    expect(wrong(under, [item("PAIN", 349, -150)])).toContain("no item naming");
    expect(wrong(under, [item("0412 FROMAGE", 799, -150), item("RABAIS 0412", -150)])).toContain(
      "a negative item is left",
    );
  });

  test("a coupon on the whole receipt passes as an item of its own, and fails folded", () => {
    const coupon = fixture("coupon-on-the-whole-receipt");
    expect(wrong(coupon, [item("CAFE", 899), item("COUPON", -200)])).toBeNull();
    expect(wrong(coupon, [item("CAFE", 899)])).toContain("no item of its own");
    expect(wrong(coupon, [item("CAFE", 899, -200)])).toContain("no item of its own");
    expect(wrong(coupon, [item("CAFE", 899, -50), item("COUPON", -200)])).toContain(
      "folded into CAFE",
    );
  });
});

describe("the rebate fixtures' paid read: a rebate already in the printed price (lg-101)", () => {
  const inPrice = fixture("rebate-in-the-printed-price");
  const asPrinted = [
    item("0412 FROMAGE CHEDDAR", 649),
    item("0631 LAIT 2% 2L", 479),
    item("0907 PAIN BLANC", 349),
    item("0218 POMMES GALA", 350),
  ];

  test("both items at their printed prices with no discount pass, by code or by name", () => {
    expect(wrong(inPrice, asPrinted)).toBeNull();
    expect(wrong(inPrice, [item("Fromage", 649), item("Lait", 479)])).toBeNull();
  });

  test("a rebate folded in, a rebate left as an item, a price read net, or an item missing fails", () => {
    const [cheese, milk, ...rest] = asPrinted;
    if (cheese === undefined || milk === undefined) throw new Error("no items");
    expect(wrong(inPrice, [cheese, { ...milk, discount: -80 }, ...rest])).toContain("folded twice");
    expect(wrong(inPrice, [...asPrinted, item("RABAIS 0631", -80)])).toContain(
      "a negative item is left",
    );
    expect(wrong(inPrice, [{ ...cheese, price: 499 }, milk, ...rest])).toContain("not 649");
    expect(wrong(inPrice, [cheese, ...rest])).toContain("no item naming 0631");
  });

  test("is one of the receipts the paid read and the render take", () => {
    expect(REBATE_FIXTURES.map((each) => each.name)).toEqual([
      "rebate-under-its-item",
      "rebate-away-from-its-item",
      "coupon-on-the-whole-receipt",
      "rebate-in-the-printed-price",
    ]);
  });
});
