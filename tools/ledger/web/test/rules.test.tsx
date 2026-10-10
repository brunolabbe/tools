// @vitest-environment jsdom

/**
 * The rules screen (lg-4): add, edit and retire, with the other person's change
 * shown rather than overwritten. The fakes are the API client module.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { Rule, SpendingCategory } from "@ledger/contract";
import { createRule, editRule, fetchPeople, fetchRules, retireRule } from "../src/api/rules.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import { Rules } from "../src/rules/Rules.tsx";

vi.mock("../src/api/rules.ts", () => ({
  fetchRules: vi.fn(),
  fetchPeople: vi.fn(),
  createRule: vi.fn(),
  editRule: vi.fn(),
  retireRule: vi.fn(),
}));

const rules = vi.mocked(fetchRules);

vi.mock("../src/api/spending.ts", () => ({ fetchSpendingCategories: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSpendingCategories).mockResolvedValue(CATEGORIES);
});

afterEach(cleanup);

function category(id: number, name: string, retired = false): SpendingCategory {
  return { id, name, retired, createdAt: "2026-10-01T00:00:00.000Z", createdBy: "migration" };
}

const CATEGORIES = [category(1, "Groceries"), category(4, "Pharmacy"), category(6, "Other", true)];

const TRANSFER: Rule = {
  id: 7,
  descriptionPattern: "Virement entre folios /Caisse du Lac",
  category: "Virements",
  amountCents: 40000,
  personId: "sam",
  bucket: "mortgage",
  spendingCategoryId: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdBy: "alex",
};

const TAXES: Rule = {
  ...TRANSFER,
  id: 8,
  descriptionPattern: "Taxes /Ville Exemple",
  category: null,
  amountCents: null,
  personId: null,
  bucket: "current-expenses",
};

test("lists the rules in force with what each asks and what it assigns", async () => {
  rules.mockResolvedValue([TRANSFER, TAXES]);

  render(<Rules />);

  const list = within(await screen.findByRole("list", { name: "Rules in force" }));
  expect(list.getAllByRole("listitem")).toHaveLength(2);
  expect(list.getByText("Virements, 400.00 $ → sam · Mortgage")).toBeTruthy();
  expect(list.getByText("any category, any amount → Joint · Current expenses")).toBeTruthy();
});

test("says so when there are no rules, and nothing is seeded", async () => {
  rules.mockResolvedValue([]);

  render(<Rules />);

  expect(await screen.findByText("There are no rules yet.")).toBeTruthy();
});

test("adds a rule from the form, with an amount read the way it is typed", async () => {
  rules.mockResolvedValue([]);
  vi.mocked(createRule).mockResolvedValue(TRANSFER);
  render(<Rules />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));

  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Virement entre folios*" },
  });
  fireEvent.change(screen.getByLabelText("Exact amount"), { target: { value: "400.50" } });
  fireEvent.change(screen.getByLabelText("Belongs to"), { target: { value: "sam" } });
  fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "mortgage" } });
  rules.mockResolvedValue([TRANSFER]);
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  expect(createRule).toHaveBeenCalledWith({
    descriptionPattern: "Virement entre folios*",
    category: null,
    amountCents: 40050,
    personId: "sam",
    bucket: "mortgage",
    spendingCategoryId: null,
  });
  // The form closes and the list is the server's.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Add rule" })).toBeNull());
  expect(await screen.findByText(/Virements, 400.00 \$/u)).toBeTruthy();
});

test("an amount that is not an amount is refused before anything is sent", async () => {
  rules.mockResolvedValue([]);
  render(<Rules />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Taxes*" } });
  fireEvent.change(screen.getByLabelText("Exact amount"), { target: { value: "lots" } });

  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

  expect(screen.getByRole("alert").textContent).toContain("not an amount");
  expect(createRule).not.toHaveBeenCalled();
});

test("editing a rule sends the new version for that rule's id", async () => {
  rules.mockResolvedValue([TRANSFER]);
  vi.mocked(editRule).mockResolvedValue({ ...TRANSFER, id: 9, amountCents: 42000 });
  render(<Rules />);

  fireEvent.click(
    await screen.findByRole("button", { name: `Edit ${TRANSFER.descriptionPattern}` }),
  );
  const amount = screen.getByLabelText<HTMLInputElement>("Exact amount");
  expect(amount.value).toBe("400.00 $");
  fireEvent.change(amount, { target: { value: "420" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(editRule).toHaveBeenCalledTimes(1));
  expect(editRule).toHaveBeenCalledWith(7, {
    descriptionPattern: TRANSFER.descriptionPattern,
    category: "Virements",
    amountCents: 42000,
    personId: "sam",
    bucket: "mortgage",
    spendingCategoryId: null,
  });
});

test("retiring a rule asks the API and reloads what is in force", async () => {
  rules.mockResolvedValue([TRANSFER, TAXES]);
  vi.mocked(retireRule).mockResolvedValue(TAXES);
  render(<Rules />);
  await screen.findByRole("list", { name: "Rules in force" });
  rules.mockResolvedValue([TRANSFER]);

  fireEvent.click(screen.getByRole("button", { name: `Retire ${TAXES.descriptionPattern}` }));

  await waitFor(() => expect(retireRule).toHaveBeenCalledWith(8));
  await waitFor(() => expect(screen.queryByText(TAXES.descriptionPattern)).toBeNull());
  expect(screen.getByText(TRANSFER.descriptionPattern)).toBeTruthy();
});

test("a rule the other person already changed is refused in the server's words, and the list reloads", async () => {
  const message = "There is no such rule in force. It may have been changed or retired.";
  rules.mockResolvedValue([TRANSFER]);
  vi.mocked(editRule).mockRejectedValue(new AppError("RULE_NOT_FOUND", message));
  render(<Rules />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Edit ${TRANSFER.descriptionPattern}` }),
  );
  const theirs: Rule = { ...TRANSFER, id: 9, amountCents: 45000 };
  rules.mockResolvedValue([theirs]);

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  // Said once, by the page, and the list now shows their version.
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(await screen.findByText(/Virements, 450.00 \$/u)).toBeTruthy();
});

// A rule's spending category (lg-15): optional, part of the version, and over the map.
test("a new rule can name a spending category, and a retired one is not offered", async () => {
  rules.mockResolvedValue([]);
  vi.mocked(createRule).mockResolvedValue({ ...TRANSFER, spendingCategoryId: 4 });
  render(<Rules />);
  fireEvent.click(await screen.findByRole("button", { name: "Add a rule" }));
  const picker = screen.getByLabelText<HTMLSelectElement>("Spending category");
  expect(picker.value).toBe("");
  expect([...picker.options].map((option) => option.text)).toEqual([
    "Use the bank category's",
    "Groceries",
    "Pharmacy",
  ]);

  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Pharmacie*" } });
  fireEvent.change(picker, { target: { value: "4" } });
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));

  await waitFor(() => expect(createRule).toHaveBeenCalledTimes(1));
  expect(createRule).toHaveBeenCalledWith(
    expect.objectContaining({ descriptionPattern: "Pharmacie*", spendingCategoryId: 4 }),
  );
});

test("the list says which spending category a rule gives, and editing it sends the new version", async () => {
  const pharmacy: Rule = { ...TRANSFER, spendingCategoryId: 4 };
  rules.mockResolvedValue([pharmacy, TAXES]);
  vi.mocked(editRule).mockResolvedValue({ ...pharmacy, id: 9, spendingCategoryId: 1 });
  render(<Rules />);

  const list = within(await screen.findByRole("list", { name: "Rules in force" }));
  expect(list.getByText("Spending category: Pharmacy")).toBeTruthy();
  // A rule naming none says nothing about it.
  expect(list.getAllByText(/Spending category:/u)).toHaveLength(1);

  fireEvent.click(
    await screen.findByRole("button", { name: `Edit ${TRANSFER.descriptionPattern}` }),
  );
  const picker = screen.getByLabelText<HTMLSelectElement>("Spending category");
  expect(picker.value).toBe("4");
  fireEvent.change(picker, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(editRule).toHaveBeenCalledTimes(1));
  expect(editRule).toHaveBeenCalledWith(
    7,
    expect.objectContaining({ spendingCategoryId: 1, bucket: "mortgage" }),
  );
});

test("a rule that names a retired category still shows it while it is edited", async () => {
  const other: Rule = { ...TRANSFER, spendingCategoryId: 6 };
  rules.mockResolvedValue([other]);
  render(<Rules />);

  fireEvent.click(
    await screen.findByRole("button", { name: `Edit ${TRANSFER.descriptionPattern}` }),
  );

  const picker = screen.getByLabelText<HTMLSelectElement>("Spending category");
  expect(picker.value).toBe("6");
  expect(picker.selectedOptions[0]?.text).toBe("Other (retired)");
});
