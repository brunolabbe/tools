/**
 * `classify` (lg-4). Every description, category and amount here is invented;
 * the shapes are the ones `00-ANALYSIS.md` §3 describes.
 */

import { describe, expect, test } from "vitest";
import { classify, matchesPattern } from "../src/index.ts";
import type { MatchableRule } from "../src/index.ts";

/** A rule with what the caller keeps beside it, to prove it comes back untouched. */
interface TestRule extends MatchableRule {
  bucket: string;
  personId: string | null;
}

function rule(id: number, fields: Partial<TestRule> = {}): TestRule {
  return {
    id,
    descriptionPattern: "Virement entre folios /Caisse du Lac",
    category: null,
    amountCents: null,
    bucket: "mortgage",
    personId: "alex",
    ...fields,
  };
}

const TRANSFER = {
  category: "Virements",
  description: "Virement entre folios /Caisse du Lac",
  amountCents: 40000,
};

describe("classify, on an exact match", () => {
  test("a row matching one rule on every criterion takes it", () => {
    const only = rule(1, { category: "Virements", amountCents: 40000 });

    expect(classify(TRANSFER, [only])).toEqual({ kind: "classified", rule: only });
  });

  test("a rule that names no category and no amount matches on its pattern alone", () => {
    const only = rule(1);

    expect(classify({ ...TRANSFER, amountCents: 12345 }, [only])).toEqual({
      kind: "classified",
      rule: only,
    });
  });

  test("a negative amount matches its own sign and not the other", () => {
    const out = rule(1, { amountCents: -40000 });

    expect(classify({ ...TRANSFER, amountCents: -40000 }, [out]).kind).toBe("classified");
    expect(classify(TRANSFER, [out]).kind).toBe("inbox");
  });

  test("case, accents and runs of spaces do not make a difference", () => {
    const only = rule(1, {
      descriptionPattern: "  hypotheque   /PRETEUR exemple",
      category: "loyer/pret hypothecaire",
    });

    const result = classify(
      {
        category: "Loyer/Prêt hypothécaire",
        description: "Hypothèque /Prêteur Exemple",
        amountCents: -70000,
      },
      [only],
    );

    expect(result).toEqual({ kind: "classified", rule: only });
  });

  test("the rule comes back as the caller gave it, with what it carries", () => {
    const joint = rule(7, { personId: null, bucket: "current-expenses" });

    const result = classify(TRANSFER, [joint]);

    expect(result.kind === "classified" && result.rule).toBe(joint);
  });
});

describe("classify, when nothing matches exactly", () => {
  test("no rules at all is the inbox with nothing to suggest", () => {
    expect(classify(TRANSFER, [])).toEqual({
      kind: "inbox",
      reason: "no-rule",
      suggestion: null,
      matching: [],
    });
  });

  test("no pattern matching is the inbox, and a rule on the amount alone suggests nothing", () => {
    const elsewhere = rule(1, { descriptionPattern: "Taxes /Ville Exemple", amountCents: 40000 });

    expect(classify(TRANSFER, [elsewhere])).toMatchObject({
      kind: "inbox",
      reason: "no-rule",
      suggestion: null,
    });
  });

  test("a transfer that is not its usual amount is the inbox, with that rule suggested", () => {
    const usual = rule(1, { amountCents: 40000 });

    const result = classify({ ...TRANSFER, amountCents: 45000 }, [usual]);

    expect(result).toEqual({ kind: "inbox", reason: "differs", suggestion: usual, matching: [] });
  });

  test("a category that is not the rule's is the inbox too", () => {
    const usual = rule(1, { category: "Virements" });

    const result = classify({ ...TRANSFER, category: "Autres" }, [usual]);

    expect(result).toMatchObject({ kind: "inbox", reason: "differs", suggestion: usual });
  });

  test("of two rules for one transfer, the nearer amount is suggested", () => {
    const four = rule(1, { amountCents: 40000 });
    const five = rule(2, { amountCents: 50000, bucket: "current-expenses" });

    const result = classify({ ...TRANSFER, amountCents: 47000 }, [four, five]);

    expect(result).toMatchObject({ kind: "inbox", reason: "differs", suggestion: five });
  });

  test("a rule failing one criterion is nearer than one failing two", () => {
    const wrongAmount = rule(1, { category: "Virements", amountCents: 41000 });
    const wrongBoth = rule(2, { category: "Autres", amountCents: 40100 });

    const result = classify({ ...TRANSFER, amountCents: 40500 }, [wrongBoth, wrongAmount]);

    expect(result).toMatchObject({ suggestion: wrongAmount });
  });

  test("two rules equally near suggest nothing, rather than the older of them", () => {
    const below = rule(1, { amountCents: 39000 });
    const above = rule(2, { amountCents: 41000 });

    const result = classify(TRANSFER, [below, above]);

    expect(result).toMatchObject({ kind: "inbox", reason: "differs", suggestion: null });
  });
});

describe("classify, when two rules match one row", () => {
  test("the row takes neither, and goes to the inbox naming both", () => {
    const first = rule(1);
    const second = rule(2, { bucket: "current-expenses", personId: null });

    const result = classify(TRANSFER, [first, second]);

    expect(result.kind).toBe("inbox");
    expect(result).toMatchObject({ reason: "ambiguous", matching: [first, second] });
  });

  test("never the first of them, whatever order they are given in", () => {
    const first = rule(1);
    const second = rule(2, { bucket: "current-expenses" });

    expect(classify(TRANSFER, [second, first]).kind).toBe("inbox");
    expect(classify(TRANSFER, [first, second]).kind).toBe("inbox");
  });

  test("the more specific of the two is what is suggested, for a person to take", () => {
    const broad = rule(1, { descriptionPattern: "Virement*" });
    const exact = rule(2, { amountCents: 40000 });

    const result = classify(TRANSFER, [broad, exact]);

    expect(result).toMatchObject({ reason: "ambiguous", suggestion: exact });
  });

  test("two identical rules are level, so nothing is suggested", () => {
    const result = classify(TRANSFER, [rule(1), rule(2)]);

    expect(result).toMatchObject({ reason: "ambiguous", suggestion: null });
  });

  test("a rule that matches the pattern but not the amount is not one of the two", () => {
    const usual = rule(1, { amountCents: 40000 });
    const other = rule(2, { amountCents: 50000 });

    expect(classify(TRANSFER, [usual, other])).toEqual({ kind: "classified", rule: usual });
  });
});

describe("matchesPattern", () => {
  test.each([
    ["the whole description", "Taxes /Ville Exemple", "Taxes /Ville Exemple", true],
    ["a prefix is not the whole", "Taxes", "Taxes /Ville Exemple", false],
    ["a star at the end", "Taxes*", "Taxes /Ville Exemple", true],
    ["a star at the start", "*Ville Exemple", "Taxes /Ville Exemple", true],
    ["a star in the middle", "Taxes*Exemple", "Taxes /Ville Exemple", true],
    ["a star standing for nothing", "Taxes /Ville Exemple*", "Taxes /Ville Exemple", true],
    ["two stars", "*Ville*", "Taxes /Ville Exemple", true],
    ["a star alone", "*", "anything at all", true],
    ["a literal that is missing", "Taxes*Autre", "Taxes /Ville Exemple", false],
    ["the literal's order", "*Exemple*Taxes*", "Taxes /Ville Exemple", false],
    ["a star that needs to give back", "*a*b", "aab", true],
    ["a regular expression is only text", "Taxes.*", "Taxes /Ville Exemple", false],
  ])("%s", (_name, pattern, text, expected) => {
    expect(matchesPattern(pattern, text)).toBe(expected);
  });

  test("many stars against a long text that cannot match answers at once", () => {
    const pattern = `${"*a".repeat(30)}*b`;

    expect(matchesPattern(pattern, "a".repeat(2000))).toBe(false);
  });
});
