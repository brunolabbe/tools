/**
 * `fromHistory` (lg-16). Every description is invented.
 */

import { describe, expect, test } from "vitest";
import { fromHistory } from "../src/index.ts";
import type { HistoryAnswer } from "../src/index.ts";

const ROW = { description: "Achat /Marché Exemple" };

function answer(id: number, fields: Partial<HistoryAnswer<string>> = {}): HistoryAnswer<string> {
  return {
    id,
    description: "Achat /Marché Exemple",
    bucket: "current-expenses",
    personId: "alex",
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
