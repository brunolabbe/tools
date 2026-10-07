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

  test("two rules level at the top with different answers suggest nothing", () => {
    const result = classify(TRANSFER, [rule(1), rule(2, { personId: "sam" })]);

    expect(result).toMatchObject({ reason: "ambiguous", suggestion: null });
  });

  test("two rules differing only in the person are different answers", () => {
    const result = classify(TRANSFER, [rule(1, { personId: null }), rule(2)]);

    expect(result).toMatchObject({ kind: "inbox", reason: "ambiguous" });
  });

  test("a rule that matches the pattern but not the amount is not one of the two", () => {
    const usual = rule(1, { amountCents: 40000 });
    const other = rule(2, { amountCents: 50000 });

    expect(classify(TRANSFER, [usual, other])).toEqual({ kind: "classified", rule: usual });
  });
});

describe("classify, when the most specific rule takes the row (lg-16)", () => {
  // The caisse names the person, so a broad rule on it is the household's, and a
  // narrower rule with the person's own fixed amount sits beside it.
  const broad = rule(1, {
    descriptionPattern: "Virement entre folios /Caisse*",
    personId: null,
    bucket: "current-expenses",
  });
  const narrow = rule(2, { amountCents: 40000 });

  test("a broad pattern rule and a narrower fixed-amount rule: the narrower takes the row", () => {
    expect(classify(TRANSFER, [broad, narrow])).toEqual({ kind: "classified", rule: narrow });
  });

  test("the same, with the two rules in the other order", () => {
    expect(classify(TRANSFER, [narrow, broad])).toEqual({ kind: "classified", rule: narrow });
  });

  test("a fixed amount outranks a longer pattern", () => {
    const long = rule(3, {
      descriptionPattern: "Virement entre folios /Caisse du Lac",
      bucket: "current-expenses",
    });
    const short = rule(4, { descriptionPattern: "Virement*", amountCents: 40000 });

    expect(classify(TRANSFER, [long, short])).toEqual({ kind: "classified", rule: short });
  });

  test("with as many criteria named, the longer literal part of the pattern wins", () => {
    const short = rule(3, { descriptionPattern: "Virement*", personId: null });
    const long = rule(4, { descriptionPattern: "Virement entre folios*" });

    expect(classify(TRANSFER, [short, long])).toEqual({ kind: "classified", rule: long });
    expect(classify(TRANSFER, [long, short])).toEqual({ kind: "classified", rule: long });
  });

  test("stars are not literal characters", () => {
    const stars = rule(3, { descriptionPattern: "*Virement*folios*", personId: null });
    const plain = rule(4, { descriptionPattern: "Virement entre folios /Caisse du Lac" });

    expect(classify(TRANSFER, [stars, plain])).toEqual({ kind: "classified", rule: plain });
  });

  test("level at the top with the same answer, the row is classified by the newest", () => {
    const older = rule(5, { descriptionPattern: "Virement entre folios*" });
    const newer = rule(9, { descriptionPattern: "VIREMENT ENTRE FOLIOS*" });

    expect(classify(TRANSFER, [older, newer])).toEqual({ kind: "classified", rule: newer });
    expect(classify(TRANSFER, [newer, older])).toEqual({ kind: "classified", rule: newer });
  });

  test("a lower rank cannot break a tie above it, and is not listed in it", () => {
    const one = rule(5, { descriptionPattern: "Virement entre folios*" });
    const other = rule(6, { descriptionPattern: "VIREMENT ENTRE FOLIOS*", personId: "sam" });
    const lowest = rule(7, {
      descriptionPattern: "*",
      personId: "alex",
      bucket: "current-expenses",
    });

    const result = classify(TRANSFER, [lowest, one, other]);

    expect(result).toMatchObject({ kind: "inbox", reason: "ambiguous" });
    expect(result.kind === "inbox" && result.matching.map((r) => r.id).toSorted()).toEqual([5, 6]);
  });

  test("a rule whose pattern does not match is no rival at all", () => {
    // No narrower rule's pattern matches, so nothing outranks the broad one.
    const elsewhere = rule(3, { descriptionPattern: "Taxes /Ville Exemple", amountCents: 40000 });

    expect(classify(TRANSFER, [broad, elsewhere])).toEqual({ kind: "classified", rule: broad });
  });
});

describe("classify, when a rule the row does not fit would outrank the one it does (lg-16)", () => {
  const broad = rule(1, {
    descriptionPattern: "Virement entre folios /Caisse*",
    personId: null,
    bucket: "current-expenses",
  });
  const narrow = rule(2, { amountCents: 40000 });
  const unusual = { ...TRANSFER, amountCents: 45000 };

  test("the row goes to the inbox as differs, with the outranking rule suggested", () => {
    expect(classify(unusual, [broad, narrow])).toEqual({
      kind: "inbox",
      reason: "differs",
      suggestion: narrow,
      matching: [broad],
    });
  });

  test("whatever order the rules are given in", () => {
    expect(classify(unusual, [narrow, broad])).toMatchObject({
      kind: "inbox",
      reason: "differs",
      suggestion: narrow,
    });
  });

  test("a category the row is not in outranks too", () => {
    const only = rule(2, { category: "Virements" });

    expect(classify({ ...TRANSFER, category: "Autres" }, [broad, only])).toMatchObject({
      kind: "inbox",
      reason: "differs",
      suggestion: only,
    });
  });

  test("an exact match that outranks every rule the row does not fit takes the row", () => {
    // The longer pattern wins the tie on criteria named, so the rule that fits
    // outranks the one that does not.
    const fits = rule(3, { category: "Virements" });
    const misses = rule(4, { descriptionPattern: "Virement*", amountCents: 1 });

    expect(classify(TRANSFER, [fits, misses])).toEqual({ kind: "classified", rule: fits });
  });

  test("a rule the row does not fit that is only level with the exact match does not stop it", () => {
    const fits = rule(3, { amountCents: 45000 });
    const misses = rule(4, { amountCents: 1, bucket: "current-expenses" });

    expect(classify(unusual, [fits, misses])).toEqual({ kind: "classified", rule: fits });
  });

  test("two outranking rules equally near suggest nothing", () => {
    const below = rule(3, { amountCents: 44000 });
    const above = rule(4, { amountCents: 46000, bucket: "current-expenses" });

    expect(classify(unusual, [broad, below, above])).toMatchObject({
      kind: "inbox",
      reason: "differs",
      suggestion: null,
    });
  });

  test("of two outranking rules, the nearer is suggested", () => {
    const near = rule(3, { amountCents: 44000 });
    const far = rule(4, { amountCents: 20000, bucket: "current-expenses" });

    expect(classify(unusual, [far, broad, near])).toMatchObject({
      reason: "differs",
      suggestion: near,
    });
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
