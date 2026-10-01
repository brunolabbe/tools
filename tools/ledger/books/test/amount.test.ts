import { describe, expect, test } from "vitest";
import { formatCents, parseAmountCents } from "../src/index.ts";

describe("parseAmountCents", () => {
  test.each([
    ["U+2212 minus", "−700,00 $", -70000],
    ["hyphen minus", "-700,00 $", -70000],
    ["explicit plus", "+400,00 $", 40000],
    ["no sign", "400,00 $", 40000],
    ["a plain space as the thousands separator", "2 100,00 $", 210000],
    ["a no-break space (U+00A0) as the thousands separator", "2 100,00 $", 210000],
    ["a narrow no-break space (U+202F) as the thousands separator", "2 100,00 $", 210000],
    ["two groups, mixed separators", "−1 234 567,89 $", -123456789],
    ["a no-break space before the dollar sign", "12,34 $", 1234],
    ["surrounding whitespace", "  +5,05 $\t", 505],
  ])("reads %s", (_name, text, cents) => {
    expect(parseAmountCents(text)).toBe(cents);
  });

  test("reads a zero as +0, never -0", () => {
    expect(Object.is(parseAmountCents("−0,00 $"), 0)).toBe(true);
    expect(Object.is(parseAmountCents("0,00 $"), 0)).toBe(true);
  });

  test.each([
    ["one decimal digit", "1,5 $"],
    ["a decimal point", "700.00 $"],
    ["no dollar sign", "700,00"],
    ["a misplaced thousands group", "12 34,00 $"],
    ["a different dash", "–700,00 $"],
    ["words", "abc"],
    ["a sign alone", "−"],
    ["nothing", ""],
  ])("refuses %s", (_name, text) => {
    expect(parseAmountCents(text)).toBeNull();
  });
});

describe("formatCents", () => {
  test("shows a signed amount with its two decimals", () => {
    expect(formatCents(-70000)).toBe("-700.00 $");
    expect(formatCents(5)).toBe("0.05 $");
    expect(formatCents(123456)).toBe("1234.56 $");
  });
});
