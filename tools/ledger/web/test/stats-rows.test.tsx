// @vitest-environment jsdom

/**
 * The rows behind a period of the spending chart (lg-18): opened from the
 * readout under the chart, a row given a category of its own, and the chart
 * counting it under the new one. The fakes are the API client modules; every
 * description and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { SpendingCategory, SpendingStatsResponse, StoredRow } from "@ledger/contract";
import {
  fetchSpendingCategories,
  fetchSpendingRows,
  setRowSpendingCategory,
} from "../src/api/spending.ts";
import { fetchSpendingStats } from "../src/api/stats.ts";
import { SpendingCard } from "../src/stats/Cards.tsx";

vi.mock("../src/api/spending.ts", () => ({
  fetchSpendingCategories: vi.fn(),
  fetchSpendingRows: vi.fn(),
  setRowSpendingCategory: vi.fn(),
}));

vi.mock("../src/api/stats.ts", () => ({
  fetchSpendingStats: vi.fn(),
}));

const NONE = { from: null, to: null };

function category(id: number, name: string): SpendingCategory {
  return {
    id,
    name,
    retired: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "migration",
  };
}

const GROCERIES = category(1, "Groceries");
const HOUSEHOLD = category(3, "Household");

const NAMES: SpendingStatsResponse["categories"] = [
  { id: 1, name: "Groceries", retired: false },
  { id: 3, name: "Household", retired: false },
];

/** The closed period holds a groceries row; the open one a groceries row and a shop's. */
const BEFORE: SpendingStatsResponse = {
  range: NONE,
  categories: NAMES,
  periods: [
    {
      start: null,
      end: "2026-01-31",
      open: false,
      totalCents: 5000,
      cardCents: 0,
      accountCents: 5000,
      categories: [{ categoryId: 1, cents: 5000 }],
    },
    {
      start: "2026-02-01",
      end: "2026-02-28",
      open: true,
      totalCents: 16345,
      cardCents: 4000,
      accountCents: 12345,
      categories: [
        { categoryId: 1, cents: 10345 },
        { categoryId: null, cents: 6000, detail: [{ label: "Divers", cents: 2000 }] },
      ],
    },
  ],
};

/** The shop's row, moved to Household. */
const AFTER: SpendingStatsResponse = {
  ...BEFORE,
  periods: [
    BEFORE.periods[0] as SpendingStatsResponse["periods"][number],
    {
      start: "2026-02-01",
      end: "2026-02-28",
      open: true,
      totalCents: 16345,
      cardCents: 4000,
      accountCents: 12345,
      categories: [
        { categoryId: 1, cents: 10345 },
        { categoryId: 3, cents: 2000 },
        { categoryId: null, cents: 4000, detail: [{ label: "Café", cents: 4000 }] },
      ],
    },
  ],
};

function row(id: number, description: string, amountCents: number, more: Partial<StoredRow> = {}) {
  return {
    id,
    date: "2026-02-10",
    category: "Divers",
    description,
    amountCents,
    balanceCents: 100000,
    classification: { bucket: "current-expenses", personId: null, source: "rule" },
    spendingCategory: null,
    ...more,
  } satisfies StoredRow;
}

const SHOP = row(21, "Achat /Dépanneur Exemple", -2000);
const MARKET = row(22, "Achat /Marché Exemple", -10345, {
  spendingCategory: { id: 1, source: "map" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSpendingStats).mockResolvedValue(BEFORE);
  vi.mocked(fetchSpendingCategories).mockResolvedValue([GROCERIES, HOUSEHOLD]);
  vi.mocked(fetchSpendingRows).mockResolvedValue({ rows: [SHOP, MARKET], total: 2 });
});

afterEach(cleanup);

async function chart(): Promise<void> {
  render(<SpendingCard range={NONE} />);
  await screen.findByRole("slider");
}

test("the readout opens the rows of the selected period, over that period's own days", async () => {
  await chart();

  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));

  const list = within(await screen.findByRole("list", { name: "Rows in this period" }));
  expect(list.getAllByRole("listitem")).toHaveLength(2);
  expect(fetchSpendingRows).toHaveBeenCalledWith(
    { from: "2026-02-01", to: "2026-02-28", category: null, offset: 0, limit: 25 },
    expect.anything(),
  );
  // The cards' lines are in the totals and not in the list, and it says so.
  expect(screen.getByText(/cards paid 40\.00 \$ in it too/i)).toBeTruthy();
});

test("a category's own button opens that category, the uncategorised as none", async () => {
  await chart();

  fireEvent.click(screen.getByRole("button", { name: "Show the rows for Groceries" }));
  await screen.findByRole("list", { name: "Rows in this period" });
  expect(fetchSpendingRows).toHaveBeenLastCalledWith(
    expect.objectContaining({ category: 1 }),
    expect.anything(),
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Spending category").value).toBe("1");

  fireEvent.click(screen.getByRole("button", { name: "Show the rows for Uncategorised" }));
  await waitFor(() =>
    expect(fetchSpendingRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "none" }),
      expect.anything(),
    ),
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Spending category").value).toBe("none");
});

test("another period's readout opens that period's days", async () => {
  await chart();

  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));

  await screen.findByRole("list", { name: "Rows in this period" });
  expect(fetchSpendingRows).toHaveBeenLastCalledWith(
    expect.objectContaining({ from: null, to: "2026-01-31" }),
    expect.anything(),
  );
});

test("a row given a category of its own is written, and the chart counts it under the new one", async () => {
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: SHOP.id,
    spendingCategory: { id: 3, source: "override" },
  });
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  const select = await screen.findByLabelText(`Spending category for ${SHOP.description}`);
  vi.mocked(fetchSpendingStats).mockResolvedValue(AFTER);
  vi.mocked(fetchSpendingRows).mockResolvedValue({
    rows: [{ ...SHOP, spendingCategory: { id: 3, source: "override" } }, MARKET],
    total: 2,
  });

  fireEvent.change(select, { target: { value: "3" } });

  await waitFor(() => expect(setRowSpendingCategory).toHaveBeenCalledWith(SHOP.id, 3));
  // The chart is read again and now has Household in the open period.
  await waitFor(() => expect(fetchSpendingStats).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Show the rows for Household" })).toBeTruthy(),
  );
  // And the list shows where it came from.
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>(`Spending category for ${SHOP.description}`).value,
    ).toBe("3"),
  );
  expect(screen.getByText("set on this row")).toBeTruthy();
});

test("a row that no longer belongs to the category being shown leaves the list", async () => {
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: SHOP.id,
    spendingCategory: { id: 3, source: "override" },
  });
  vi.mocked(fetchSpendingRows).mockResolvedValue({ rows: [SHOP], total: 1 });
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows for Uncategorised" }));
  const select = await screen.findByLabelText(`Spending category for ${SHOP.description}`);
  vi.mocked(fetchSpendingRows).mockResolvedValue({ rows: [], total: 0 });

  fireEvent.change(select, { target: { value: "3" } });

  await waitFor(() => expect(screen.queryByText(SHOP.description)).toBeNull());
  expect(screen.getByText("No bank row matches.")).toBeTruthy();
});

test("a refused write says so and keeps the row where it was", async () => {
  vi.mocked(setRowSpendingCategory).mockRejectedValue(
    new AppError("SPENDING_CATEGORY_NOT_FOUND", "That spending category is gone."),
  );
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  const select = await screen.findByLabelText(`Spending category for ${SHOP.description}`);

  fireEvent.change(select, { target: { value: "3" } });

  expect((await screen.findByRole("alert")).textContent).toContain(
    "That spending category is gone.",
  );
  expect(fetchSpendingStats).toHaveBeenCalledTimes(1);
});

test("more rows are asked for by offset, and the total does not move", async () => {
  const page = (from: number, count: number): StoredRow[] =>
    Array.from({ length: count }, (_, at) =>
      row(100 + from + at, `Achat ${String(from + at)}`, -100),
    );
  vi.mocked(fetchSpendingRows)
    .mockResolvedValueOnce({ rows: page(0, 25), total: 27 })
    .mockResolvedValueOnce({ rows: page(25, 2), total: 27 });
  await chart();

  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  await screen.findByText("25 of 27");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));

  await screen.findByText("27 of 27");
  expect(fetchSpendingRows).toHaveBeenLastCalledWith({
    from: "2026-02-01",
    to: "2026-02-28",
    category: null,
    offset: 25,
    limit: 25,
  });
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(27);
});

test("choosing a category in the list asks for it, and closing puts the list away", async () => {
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  await screen.findByRole("list", { name: "Rows in this period" });

  fireEvent.change(screen.getByLabelText("Spending category"), { target: { value: "3" } });

  await waitFor(() =>
    expect(fetchSpendingRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 3, offset: 0 }),
      expect.anything(),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close the rows" }));
  expect(screen.queryByRole("list", { name: "Rows in this period" })).toBeNull();
});

test("More categories opens the whole period, not a category", async () => {
  // Nine categories: seven get a colour of their own and the last two share the eighth,
  // drawn as one "More categories" line that has no category id to ask for.
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  vi.mocked(fetchSpendingStats).mockResolvedValue({
    range: NONE,
    categories: ids.map((id) => ({ id, name: `Category ${String(id)}`, retired: false })),
    periods: [
      {
        start: "2026-02-01",
        end: "2026-02-28",
        open: true,
        totalCents: 9000,
        cardCents: 0,
        accountCents: 9000,
        categories: ids.map((id) => ({ categoryId: id, cents: 1000 })),
      },
    ],
  });
  await chart();

  fireEvent.click(screen.getByRole("button", { name: "Show the rows for More categories" }));

  await screen.findByRole("list", { name: "Rows in this period" });
  expect(fetchSpendingRows).toHaveBeenLastCalledWith(
    { from: "2026-02-01", to: "2026-02-28", category: null, offset: 0, limit: 25 },
    expect.anything(),
  );
});
