// @vitest-environment jsdom

/**
 * A rule and the rows it would file (lg-98, gate 1's F2). `GET /api/rows` gives
 * a row nobody has filed the spending category of the rule that would file it,
 * so a rule added, edited or retired changes what the Spending tab lists as
 * having none. The API's own test asserts it:
 * `api/test/spending-categories.test.ts` › "a rule that matches a row filed
 * before the rule existed" › "gives the unfiled row its category in the inbox
 * and in the rows list alike". The fake below answers the same way: the row is
 * uncategorised until the rule is stored, and has the rule's category after.
 *
 * The path is the one a person takes: Spending read, Rules opened and a rule
 * added, then Spending opened again well within `staleTime`.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Rule, SpendingCategory, StoredRow } from "@ledger/contract";
import { fetchPeople } from "../src/api/people.ts";
import { createRule, editRule, fetchRules, retireRule } from "../src/api/rules.ts";
import {
  fetchSpendingCategories,
  fetchSpendingMap,
  fetchUncategorisedRows,
} from "../src/api/spending.ts";
import { Rules } from "../src/rules/Rules.tsx";
import { Spending } from "../src/spending/Spending.tsx";
import { peopleAnswer } from "./people-answer.ts";
import { renderWithClient, testQueryClient } from "./render-with-client.tsx";

vi.mock("../src/api/rules.ts", () => ({
  fetchRules: vi.fn(),
  createRule: vi.fn(),
  editRule: vi.fn(),
  retireRule: vi.fn(),
}));
vi.mock("../src/api/people.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({
  fetchSpendingCategories: vi.fn(),
  fetchSpendingMap: vi.fn(),
  fetchUncategorisedRows: vi.fn(),
  addSpendingCategory: vi.fn(),
  renameSpendingCategory: vi.fn(),
  retireSpendingCategory: vi.fn(),
  setSpendingMapEntry: vi.fn(),
  setRowSpendingCategory: vi.fn(),
}));

const PHARMACY: SpendingCategory = {
  id: 4,
  name: "Pharmacy",
  retired: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "migration",
};

const ROW: StoredRow = {
  id: 31,
  date: "2026-09-14",
  category: "Pharmacie",
  description: "Pharmacie Exemple",
  amountCents: -4500,
  balanceCents: 100000,
  classification: null,
  spendingCategory: null,
};

const RULE: Rule = {
  id: 7,
  descriptionPattern: "Pharmacie Exemple",
  category: null,
  amountCents: null,
  personId: null,
  bucket: "current-expenses",
  spendingCategoryId: PHARMACY.id,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "alex",
};

/** The rules the fake API holds; the rows list follows them, as `GET /api/rows` does. */
let held: Rule[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  held = [];
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "sam"]));
  vi.mocked(fetchSpendingCategories).mockResolvedValue([PHARMACY]);
  vi.mocked(fetchSpendingMap).mockResolvedValue([]);
  vi.mocked(fetchRules).mockImplementation(async () => held);
  vi.mocked(fetchUncategorisedRows).mockImplementation(async () =>
    held.some((rule) => rule.descriptionPattern === ROW.description)
      ? { rows: [], total: 0 }
      : { rows: [ROW], total: 1 },
  );
  vi.mocked(createRule).mockImplementation(async () => {
    held = [RULE];
    return RULE;
  });
});

afterEach(cleanup);

test("a rule added on the Rules tab takes its row off the Spending tab's uncategorised list (lg-98)", async () => {
  const client = testQueryClient();
  const spending = renderWithClient(<Spending />, { client });
  expect(await screen.findByText(/Pharmacie Exemple/u)).toBeTruthy();
  spending.unmount();

  const rules = renderWithClient(<Rules />, { client });
  fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: RULE.descriptionPattern },
  });
  fireEvent.change(screen.getByLabelText("Spending category"), {
    target: { value: String(PHARMACY.id) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Add rule" })).toBeNull());
  rules.unmount();

  renderWithClient(<Spending />, { client });
  expect(await screen.findByText("Every stored row has one.")).toBeTruthy();
  expect(screen.queryByText(/Pharmacie Exemple/u)).toBeNull();
  expect(fetchUncategorisedRows).toHaveBeenCalledTimes(2);
  // Not used here, and so not sent.
  expect(editRule).not.toHaveBeenCalled();
  expect(retireRule).not.toHaveBeenCalled();
});
