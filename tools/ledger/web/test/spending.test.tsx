// @vitest-environment jsdom

/**
 * The spending categories screen (lg-15): the list, the map from Desjardins' own
 * categories, and the rows that still have none. The fakes are the API client
 * module; every description and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { SpendingCategory, SpendingCategoryMapEntry, StoredRow } from "@ledger/contract";
import {
  addSpendingCategory,
  fetchSpendingCategories,
  fetchSpendingMap,
  fetchUncategorisedRows,
  renameSpendingCategory,
  retireSpendingCategory,
  setRowSpendingCategory,
  setSpendingMapEntry,
} from "../src/api/spending.ts";
import { Spending } from "../src/spending/Spending.tsx";

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

function category(id: number, name: string, retired = false): SpendingCategory {
  return { id, name, retired, createdAt: "2026-10-01T00:00:00.000Z", createdBy: "migration" };
}

const GROCERIES = category(1, "Groceries");
const PHARMACY = category(4, "Pharmacy");
const OTHER = category(6, "Other", true);

const MAP: SpendingCategoryMapEntry[] = [
  { desjardinsCategory: "Épicerie", spendingCategoryId: 1, rows: 12 },
  { desjardinsCategory: "Pharmacie", spendingCategoryId: null, rows: 3 },
];

const ROW: StoredRow = {
  id: 31,
  date: "2026-09-14",
  category: "Virements",
  description: "Virement entre folios /Caisse du Lac",
  amountCents: -4500,
  balanceCents: 100000,
  classification: null,
  spendingCategory: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSpendingCategories).mockResolvedValue([GROCERIES, PHARMACY, OTHER]);
  vi.mocked(fetchSpendingMap).mockResolvedValue(MAP);
  vi.mocked(fetchUncategorisedRows).mockResolvedValue({ rows: [ROW], total: 1 });
});

afterEach(cleanup);

function card(name: string): HTMLElement {
  const found = screen.getByRole("heading", { name }).closest("section");
  if (found === null) throw new Error(`no section for ${name}`);
  return found;
}

test("lists the categories, retired ones marked and without controls", async () => {
  render(<Spending />);

  const list = within(await screen.findByRole("list", { name: "Spending categories" }));

  expect(list.getAllByRole("listitem")).toHaveLength(3);
  expect(list.getByText("Other")).toBeTruthy();
  expect(list.getByText("(retired)")).toBeTruthy();
  expect(list.queryByRole("button", { name: "Retire Other" })).toBeNull();
  expect(list.getByRole("button", { name: "Retire Groceries" })).toBeTruthy();
});

test("adds a category, and refuses an empty name before sending anything", async () => {
  vi.mocked(addSpendingCategory).mockResolvedValue(category(7, "Pets"));
  render(<Spending />);
  const form = within(await screen.findByRole("form", { name: "Add a spending category" }));

  fireEvent.click(form.getByRole("button", { name: "Add" }));
  expect(screen.getByRole("alert").textContent).toContain("Give the spending category a name");
  expect(addSpendingCategory).not.toHaveBeenCalled();

  fireEvent.change(form.getByLabelText("New spending category"), { target: { value: " Pets " } });
  fireEvent.click(form.getByRole("button", { name: "Add" }));

  await waitFor(() => expect(addSpendingCategory).toHaveBeenCalledWith("Pets"));
});

test("renames a category under its id, and retires one", async () => {
  vi.mocked(renameSpendingCategory).mockResolvedValue(category(1, "Food"));
  vi.mocked(retireSpendingCategory).mockResolvedValue(category(4, "Pharmacy", true));
  render(<Spending />);

  fireEvent.click(await screen.findByRole("button", { name: "Rename Groceries" }));
  fireEvent.change(screen.getByLabelText("New name"), { target: { value: "Food" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(renameSpendingCategory).toHaveBeenCalledWith(1, "Food"));

  fireEvent.click(await screen.findByRole("button", { name: "Retire Pharmacy" }));
  await waitFor(() => expect(retireSpendingCategory).toHaveBeenCalledWith(4));
});

test("the map has a line per bank category seen, with its spending category or none", async () => {
  render(<Spending />);
  await screen.findByRole("list", { name: "Bank categories" });

  const map = within(card("From the bank’s categories"));

  expect(map.getAllByRole("listitem")).toHaveLength(2);
  expect(map.getByLabelText<HTMLSelectElement>("Spending category for Épicerie").value).toBe("1");
  expect(map.getByLabelText<HTMLSelectElement>("Spending category for Pharmacie").value).toBe("");
  expect(map.getByText(/12 rows/u)).toBeTruthy();
  // A retired category is not offered.
  const options = [
    ...map.getByLabelText<HTMLSelectElement>("Spending category for Pharmacie").options,
  ];
  expect(options.map((option) => option.text)).toEqual(["None", "Groceries", "Pharmacy"]);
});

test("setting a map entry sends the bank category's text and the spending category", async () => {
  vi.mocked(setSpendingMapEntry).mockResolvedValue({
    desjardinsCategory: "Pharmacie",
    spendingCategoryId: 4,
    rows: 3,
  });
  render(<Spending />);
  const select = await screen.findByLabelText("Spending category for Pharmacie");

  fireEvent.change(select, { target: { value: "4" } });

  await waitFor(() => expect(setSpendingMapEntry).toHaveBeenCalledWith("Pharmacie", 4));
  // Reloaded from the API afterwards: the map shown is the server's.
  await waitFor(() => expect(fetchSpendingMap).toHaveBeenCalledTimes(2));
});

test("clearing a map entry sends a null", async () => {
  vi.mocked(setSpendingMapEntry).mockResolvedValue({ ...MAP[0]!, spendingCategoryId: null });
  render(<Spending />);
  const select = await screen.findByLabelText("Spending category for Épicerie");

  fireEvent.change(select, { target: { value: "" } });

  await waitFor(() => expect(setSpendingMapEntry).toHaveBeenCalledWith("Épicerie", null));
});

test("a row with no spending category can be given one there, which writes its override", async () => {
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: ROW.id,
    spendingCategory: { id: 1, source: "override" },
  });
  render(<Spending />);
  const rows = within(await screen.findByRole("list", { name: "Rows with no spending category" }));
  expect(rows.getByText(/Virement entre folios/u)).toBeTruthy();
  vi.mocked(fetchUncategorisedRows).mockResolvedValue({ rows: [], total: 0 });

  fireEvent.change(rows.getByLabelText(`Spending category for ${ROW.date} ${ROW.description}`), {
    target: { value: "1" },
  });

  await waitFor(() => expect(setRowSpendingCategory).toHaveBeenCalledWith(ROW.id, 1));
  // It has one now, so it leaves the list.
  expect(await screen.findByText("Every stored row has one.")).toBeTruthy();
});

test("says how many rows have none when only the newest are listed", async () => {
  vi.mocked(fetchUncategorisedRows).mockResolvedValue({ rows: [ROW], total: 240 });
  render(<Spending />);

  expect(await screen.findByText("240 rows; the newest 1 are here.")).toBeTruthy();
});

test("a category retired by the other person meanwhile is refused in the server's words, and the list reloads", async () => {
  const message = "There is no such spending category in the list.";
  vi.mocked(setSpendingMapEntry).mockRejectedValue(
    new AppError("SPENDING_CATEGORY_NOT_FOUND", message),
  );
  render(<Spending />);
  const select = await screen.findByLabelText("Spending category for Pharmacie");
  vi.mocked(fetchSpendingCategories).mockResolvedValue([GROCERIES, category(4, "Pharmacy", true)]);

  fireEvent.change(select, { target: { value: "4" } });

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
  await waitFor(() => expect(fetchSpendingCategories).toHaveBeenCalledTimes(2));
});
