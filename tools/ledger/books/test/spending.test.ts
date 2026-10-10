/**
 * `spendingCategory` and `spendingMap` (lg-15). Every Desjardins category here is
 * one the sample showed or an invented one; the spending category ids are the
 * list's, and are arbitrary numbers.
 */

import { describe, expect, test } from "vitest";
import { spendingCategory, spendingMap } from "../src/index.ts";

const GROCERIES = 1;
const PHARMACY = 2;
const HOUSEHOLD = 3;

const MAP = spendingMap([
  { id: 1, desjardinsCategory: "Épicerie", spendingCategory: GROCERIES },
  { id: 2, desjardinsCategory: "Virements", spendingCategory: null },
]);

const ROW = { category: "Épicerie" };

describe("spendingCategory, the four-step order", () => {
  test("a row's own override comes first, over its rule's and the map's", () => {
    const rule = { spendingCategoryId: PHARMACY };

    expect(spendingCategory(ROW, rule, MAP, HOUSEHOLD)).toEqual({
      category: HOUSEHOLD,
      source: "override",
    });
  });

  test("the classifying rule's comes next, over the map's", () => {
    const rule = { spendingCategoryId: PHARMACY };

    expect(spendingCategory(ROW, rule, MAP, null)).toEqual({
      category: PHARMACY,
      source: "rule",
    });
  });

  test("the map's entry for the row's Desjardins category comes next", () => {
    expect(spendingCategory(ROW, null, MAP, null)).toEqual({ category: GROCERIES, source: "map" });
    // A rule that names none leaves the row to the map.
    expect(spendingCategory(ROW, { spendingCategoryId: null }, MAP, null)).toEqual({
      category: GROCERIES,
      source: "map",
    });
    expect(spendingCategory(ROW, {}, MAP, null)?.source).toBe("map");
  });

  test("a row none of them answers has none", () => {
    expect(spendingCategory({ category: "Virements" }, null, MAP, null)).toBeNull();
    expect(spendingCategory({ category: "Jamais vue" }, null, MAP, null)).toBeNull();
  });

  test("the map is read the way classify reads a category", () => {
    expect(spendingCategory({ category: "  EPICERIE " }, null, MAP, null)?.category).toBe(
      GROCERIES,
    );
  });
});

describe("spendingMap", () => {
  test("the latest version of a line stands, whatever order they come in", () => {
    const versions = [
      { id: 7, desjardinsCategory: "Épicerie", spendingCategory: HOUSEHOLD },
      { id: 3, desjardinsCategory: "epicerie", spendingCategory: GROCERIES },
    ];

    // The keys are folded text; what a caller sees is what a row gets from them.
    expect(spendingCategory(ROW, null, spendingMap(versions), null)?.category).toBe(HOUSEHOLD);
    expect(spendingCategory(ROW, null, spendingMap(versions.toReversed()), null)?.category).toBe(
      HOUSEHOLD,
    );
  });

  test("a later clearing removes the line", () => {
    const map = spendingMap([
      { id: 1, desjardinsCategory: "Épicerie", spendingCategory: GROCERIES },
      { id: 2, desjardinsCategory: "Épicerie", spendingCategory: null },
    ]);

    expect(spendingCategory(ROW, null, map, null)).toBeNull();
  });
});
