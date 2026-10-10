/**
 * `fromHistory` (lg-16) and `autoFile` (lg-17). Every description is invented.
 */

import { describe, expect, test } from "vitest";
import { autoFile, fromHistory } from "../src/index.ts";
import type { HistoryAnswer } from "../src/index.ts";

const ROW = { description: "Achat /Marché Exemple" };

function answer(id: number, fields: Partial<HistoryAnswer<string>> = {}): HistoryAnswer<string> {
  return {
    id,
    description: "Achat /Marché Exemple",
    bucket: "current-expenses",
    personId: "alex",
    amountCents: -10000,
    ...fields,
  };
}

describe("fromHistory", () => {
  test("no answer for the description is null", () => {
    expect(fromHistory(ROW, [])).toBeNull();
    expect(fromHistory(ROW, [answer(1, { description: "Taxes /Ville Exemple" })])).toBeNull();
  });

  test("the only answer, once", () => {
    expect(fromHistory(ROW, [answer(1)])).toEqual({
      bucket: "current-expenses",
      personId: "alex",
      times: 1,
    });
  });

  test("the latest answer wins, whatever order the answers come in", () => {
    const earlier = answer(3, { bucket: "mortgage", personId: "sam" });
    const latest = answer(8);

    expect(fromHistory(ROW, [latest, earlier])).toMatchObject({ personId: "alex", times: 1 });
    expect(fromHistory(ROW, [earlier, latest])).toMatchObject({ personId: "alex", times: 1 });
  });

  test("counts the latest answers that agree, back from the latest, up to the first that differs", () => {
    const answers = [answer(1), answer(2, { bucket: "mortgage" }), answer(3), answer(4), answer(5)];

    expect(fromHistory(ROW, answers)).toEqual({
      bucket: "current-expenses",
      personId: "alex",
      times: 3,
    });
  });

  test("the person is part of the answer, and joint is a person's absence", () => {
    const answers = [answer(1, { personId: null }), answer(2, { personId: null }), answer(3)];

    expect(fromHistory(ROW, answers)).toMatchObject({ personId: "alex", times: 1 });
    expect(fromHistory(ROW, answers.slice(0, 2))).toMatchObject({ personId: null, times: 2 });
  });

  test("case, accents and runs of spaces do not make a description different", () => {
    const answers = [
      answer(1, { description: "achat   /marche exemple" }),
      answer(2, { description: "ACHAT /MARCHÉ EXEMPLE" }),
    ];

    expect(fromHistory(ROW, answers)).toMatchObject({ times: 2 });
  });

  test("another description's answers neither count nor interrupt the run", () => {
    const answers = [
      answer(1),
      answer(2, { description: "Taxes /Ville Exemple", bucket: "mortgage", personId: "sam" }),
      answer(3),
    ];

    expect(fromHistory(ROW, answers)).toMatchObject({ bucket: "current-expenses", times: 2 });
  });
});

/** A row with the description the answers are for; a debit of groceries unless told otherwise. */
function row(
  amountCents: number,
  category = "Épicerie",
): {
  description: string;
  category: string;
  amountCents: number;
} {
  return { description: "Achat /Marché Exemple", category, amountCents };
}

/** Three agreeing answers, the latest (id 3) at `latestCents`, the two before at other amounts. */
function threeAnswers(latestCents: number): HistoryAnswer<string>[] {
  return [
    answer(1, { amountCents: latestCents * 2 }),
    answer(2, { amountCents: latestCents * 3 }),
    answer(3, { amountCents: latestCents }),
  ];
}

describe("autoFile (lg-17)", () => {
  test("a debit 15 % above the latest answer's amount is filed, on the three answers it rests on", () => {
    // -100.00 $ last time; -115.00 $ now: 5 × 1500 = 7500 ≤ 10000.
    expect(autoFile(row(-11500), threeAnswers(-10000))).toEqual({
      kind: "filed",
      bucket: "current-expenses",
      personId: "alex",
      restsOn: [3, 2, 1],
    });
  });

  test("a debit 25 % above it goes to the inbox", () => {
    // 5 × 2500 = 12500 > 10000.
    expect(autoFile(row(-12500), threeAnswers(-10000))).toEqual({ kind: "ask", reason: "amount" });
  });

  test("the 20 % line is inclusive and drawn in whole cents, on both sides of the latest", () => {
    const answers = threeAnswers(-12345);
    // |−12345| / 5 = 2469 exactly: 2469 cents away is on the line, 2470 is past it.
    expect(autoFile(row(-12345 - 2469), answers)).toMatchObject({ kind: "filed" });
    expect(autoFile(row(-12345 - 2470), answers)).toEqual({ kind: "ask", reason: "amount" });
    expect(autoFile(row(-12345 + 2469), answers)).toMatchObject({ kind: "filed" });
    expect(autoFile(row(-12345 + 2470), answers)).toEqual({ kind: "ask", reason: "amount" });
    // A small amount: one cent past -1.20 $ against -1.00 $ is past the line.
    expect(autoFile(row(-120), threeAnswers(-100))).toMatchObject({ kind: "filed" });
    expect(autoFile(row(-121), threeAnswers(-100))).toEqual({ kind: "ask", reason: "amount" });
  });

  test("the ±20 % is measured against the latest of the three, not any of them", () => {
    // The two earlier answers were -200.00 $ and -300.00 $; only -100.00 $ counts.
    expect(autoFile(row(-20000), threeAnswers(-10000))).toEqual({ kind: "ask", reason: "amount" });
  });

  test("a debit against a latest answer that was a credit has the wrong sign", () => {
    const answers = [answer(1), answer(2), answer(3, { amountCents: 1000 })];

    expect(autoFile(row(-1000), answers)).toEqual({ kind: "ask", reason: "amount" });
  });

  test("a transfer at a different amount goes to the inbox, and at one of the three amounts is filed", () => {
    const answers = [
      answer(1, { amountCents: -40000 }),
      answer(2, { amountCents: -45000 }),
      answer(3, { amountCents: -40000 }),
    ];

    // 1 % off, well inside what a debit may drift, and still a question for a transfer.
    expect(autoFile(row(-40400, "Virements"), answers)).toEqual({
      kind: "ask",
      reason: "amount",
    });
    // Equal to the second-latest's, to the cent: filed.
    expect(autoFile(row(-45000, "Virements"), answers)).toMatchObject({
      kind: "filed",
      restsOn: [3, 2, 1],
    });
  });

  test("`Virements` is folded as a category is, and every credit is a transfer", () => {
    const answers = [
      answer(1, { amountCents: 40000 }),
      answer(2, { amountCents: 40000 }),
      answer(3, { amountCents: 40000 }),
    ];
    const folded = [
      answer(1, { amountCents: -40000 }),
      answer(2, { amountCents: -40000 }),
      answer(3, { amountCents: -40000 }),
    ];

    expect(autoFile(row(-40100, "  VIREMENTS "), folded)).toEqual({
      kind: "ask",
      reason: "amount",
    });
    // A credit in a category that is not a transfer's is held to the exact amount too.
    expect(autoFile(row(40100, "Dépôts"), answers)).toEqual({ kind: "ask", reason: "amount" });
    expect(autoFile(row(40000, "Dépôts"), answers)).toMatchObject({ kind: "filed" });
  });

  test("fewer than three answers do not file, however well they agree", () => {
    expect(autoFile(row(-10000), [])).toEqual({ kind: "ask", reason: "too-few" });
    expect(autoFile(row(-10000), [answer(1), answer(2)])).toEqual({
      kind: "ask",
      reason: "too-few",
    });
    // Another description's answers are not this one's.
    expect(
      autoFile(row(-10000), [answer(1), answer(2), answer(3, { description: "Taxes /Ville" })]),
    ).toEqual({ kind: "ask", reason: "too-few" });
  });

  test("three answers where one disagrees do not file, whichever one it is", () => {
    for (const odd of [1, 2, 3]) {
      const answers = [1, 2, 3].map((id) =>
        answer(id, id === odd ? { personId: "sam" } : { amountCents: -10000 }),
      );
      expect(autoFile(row(-10000), answers)).toEqual({ kind: "ask", reason: "disagree" });
    }
    const bucket = [answer(1), answer(2, { bucket: "mortgage" }), answer(3)];
    expect(autoFile(row(-10000), bucket)).toEqual({ kind: "ask", reason: "disagree" });
  });

  test("only the latest three count: an older disagreement does not stop it, a newer one does", () => {
    const older = [answer(1, { personId: "sam" }), answer(2), answer(3), answer(4)];
    const newer = [answer(1), answer(2), answer(3), answer(4, { personId: "sam" })];

    expect(autoFile(row(-10000), older)).toMatchObject({ kind: "filed", restsOn: [4, 3, 2] });
    expect(autoFile(row(-10000), newer)).toEqual({ kind: "ask", reason: "disagree" });
  });

  test("joint is an answer like a person's, and the order the answers come in changes nothing", () => {
    const answers = [
      answer(3, { personId: null }),
      answer(1, { personId: null }),
      answer(2, { personId: null }),
    ];

    expect(autoFile(row(-10000), answers)).toEqual({
      kind: "filed",
      bucket: "current-expenses",
      personId: null,
      restsOn: [3, 2, 1],
    });
  });
});
