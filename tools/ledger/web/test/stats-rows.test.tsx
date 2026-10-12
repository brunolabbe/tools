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
import type {
  PeriodLine,
  SpendingCategory,
  SpendingStatsResponse,
  StoredRow,
} from "@ledger/contract";
import { correctLine } from "../src/api/periods.ts";
import {
  fetchSpendingCategories,
  fetchSpendingLines,
  fetchSpendingRows,
  setRowSpendingCategory,
} from "../src/api/spending.ts";
import { fetchSpendingStats } from "../src/api/stats.ts";
import { SpendingCard } from "../src/stats/Cards.tsx";

vi.mock("../src/api/spending.ts", () => ({
  fetchSpendingCategories: vi.fn(),
  fetchSpendingRows: vi.fn(),
  fetchSpendingLines: vi.fn(),
  setRowSpendingCategory: vi.fn(),
}));

vi.mock("../src/api/periods.ts", () => ({
  correctLine: vi.fn(),
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
  vi.mocked(fetchSpendingLines).mockResolvedValue({ lines: [], total: 0 });
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
  // The cards' lines are listed too, over the same days.
  expect(fetchSpendingLines).toHaveBeenCalledWith(
    { from: "2026-02-01", to: "2026-02-28", category: null, offset: 0, limit: 25 },
    expect.anything(),
  );
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

test("a failed read of the chart after a write keeps the chart and the open list, and says so", async () => {
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: SHOP.id,
    spendingCategory: { id: 3, source: "override" },
  });
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  const select = await screen.findByLabelText(`Spending category for ${SHOP.description}`);
  vi.mocked(fetchSpendingStats).mockRejectedValue(
    new AppError("UNREACHABLE", "The books are away."),
  );

  fireEvent.change(select, { target: { value: "3" } });

  await waitFor(() => expect(fetchSpendingStats).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("The books are away."),
  );
  expect(screen.getByRole("slider")).toBeTruthy();
  expect(screen.getByRole("list", { name: "Rows in this period" })).toBeTruthy();
});

test("the open period's last day moving on, as it does at midnight, keeps its list open", async () => {
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: SHOP.id,
    spendingCategory: { id: 3, source: "override" },
  });
  await chart();
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
  const select = await screen.findByLabelText(`Spending category for ${SHOP.description}`);
  const open = AFTER.periods[1] as SpendingStatsResponse["periods"][number];
  vi.mocked(fetchSpendingStats).mockResolvedValue({
    ...AFTER,
    periods: [
      AFTER.periods[0] as SpendingStatsResponse["periods"][number],
      { ...open, end: "2026-03-01" },
    ],
  });

  fireEvent.change(select, { target: { value: "3" } });

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Show the rows for Household" })).toBeTruthy(),
  );
  expect(screen.getByRole("list", { name: "Rows in this period" })).toBeTruthy();
});

test("the readout's buttons are outside its live region, and its figures inside it", async () => {
  await chart();

  const button = screen.getByRole("button", { name: "Show the rows" });
  expect(button.closest("[aria-live]")).toBeNull();
  for (const one of screen.getAllByRole("button", { name: /^Show the rows for / })) {
    expect(one.closest("[aria-live]")).toBeNull();
  }
  const live = button.closest(".readout")?.querySelector("[aria-live]");
  expect(live?.textContent).toContain("Groceries");
});

test("a failed read with no write before it fails the card, on a new range or back on an old one", async () => {
  const A = { from: "2026-01-01", to: "2026-02-28" };
  const B = { from: "2026-02-01", to: "2026-02-28" };
  const { rerender } = render(<SpendingCard range={A} />);
  await screen.findByRole("slider");

  vi.mocked(fetchSpendingStats).mockRejectedValue(
    new AppError("UNREACHABLE", "The books are away."),
  );
  rerender(<SpendingCard range={B} />);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The books are away."));
  expect(screen.queryByRole("slider")).toBeNull();

  // Back on the range read first: it was not written under, so its answer is not held.
  rerender(<SpendingCard range={A} />);
  await waitFor(() => expect(fetchSpendingStats).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The books are away."));
  expect(screen.queryByRole("slider")).toBeNull();
});

// --- lg-19: the card lines behind a period, and correcting one ---

function line(id: number, more: Partial<PeriodLine> = {}): PeriodLine {
  return {
    id,
    personId: "sam",
    date: "2026-01-20",
    amountCents: 5000,
    category: "Épicerie du coin",
    spendingCategoryId: 1,
    note: null,
    source: "manual",
    chargedTo: null,
    supersedes: null,
    enteredAt: "2026-01-20T10:00:00.000Z",
    enteredBy: "sam",
    ...more,
  };
}

const CARD = line(31);

/** The closed period's card line moved from Groceries to Household. */
const CARD_AFTER: SpendingStatsResponse = {
  ...BEFORE,
  periods: [
    {
      ...(BEFORE.periods[0] as SpendingStatsResponse["periods"][number]),
      totalCents: 10000,
      cardCents: 5000,
      accountCents: 5000,
      categories: [
        { categoryId: 1, cents: 5000 },
        { categoryId: 3, cents: 5000 },
      ],
    },
    BEFORE.periods[1] as SpendingStatsResponse["periods"][number],
  ],
};

const CARD_BEFORE: SpendingStatsResponse = {
  ...BEFORE,
  periods: [
    {
      ...(BEFORE.periods[0] as SpendingStatsResponse["periods"][number]),
      totalCents: 10000,
      cardCents: 5000,
      accountCents: 5000,
      categories: [{ categoryId: 1, cents: 10000 }],
    },
    BEFORE.periods[1] as SpendingStatsResponse["periods"][number],
  ],
};

async function openClosedPeriod(): Promise<void> {
  render(<SpendingCard range={NONE} />);
  await screen.findByRole("slider");
  fireEvent.keyDown(screen.getByRole("slider"), { key: "Home" });
  fireEvent.click(screen.getByRole("button", { name: "Show the rows" }));
}

test("a closed period's card line is listed, and given another category it is filed again whole and the chart counts it there", async () => {
  vi.mocked(fetchSpendingStats).mockResolvedValue(CARD_BEFORE);
  vi.mocked(fetchSpendingLines).mockResolvedValue({ lines: [CARD], total: 1 });
  vi.mocked(correctLine).mockResolvedValue(
    line(32, { spendingCategoryId: 3, supersedes: CARD.id }),
  );
  await openClosedPeriod();
  const select = await screen.findByLabelText(
    `Spending category for ${CARD.category ?? ""} of ${CARD.date}`,
  );
  expect(fetchSpendingLines).toHaveBeenLastCalledWith(
    expect.objectContaining({ from: null, to: "2026-01-31" }),
    expect.anything(),
  );
  vi.mocked(fetchSpendingStats).mockResolvedValue(CARD_AFTER);
  vi.mocked(fetchSpendingLines).mockResolvedValue({
    lines: [line(32, { spendingCategoryId: 3, supersedes: CARD.id })],
    total: 1,
  });

  fireEvent.change(select, { target: { value: "3" } });

  // The API takes the whole line: only the category differs from what was stored.
  await waitFor(() =>
    expect(correctLine).toHaveBeenCalledWith(CARD.id, {
      personId: "sam",
      date: "2026-01-20",
      amountCents: 5000,
      category: "Épicerie du coin",
      spendingCategoryId: 3,
      note: null,
      chargedTo: null,
    }),
  );
  await waitFor(() => expect(fetchSpendingStats).toHaveBeenCalledTimes(2));
  // The chart has Household in the closed period, and the list shows the line there.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Show the rows for Household" })).toBeTruthy(),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText<HTMLSelectElement>(
        `Spending category for ${CARD.category ?? ""} of ${CARD.date}`,
      ).value,
    ).toBe("3"),
  );
});

test("a slice of only card lines opens a list that has them, and no bank row is claimed", async () => {
  vi.mocked(fetchSpendingStats).mockResolvedValue({
    ...BEFORE,
    periods: [
      {
        start: "2026-02-01",
        end: "2026-02-28",
        open: true,
        totalCents: 3000,
        cardCents: 3000,
        accountCents: 0,
        categories: [{ categoryId: 3, cents: 3000 }],
      },
    ],
  });
  vi.mocked(fetchSpendingRows).mockResolvedValue({ rows: [], total: 0 });
  vi.mocked(fetchSpendingLines).mockResolvedValue({
    lines: [line(41, { date: "2026-02-10", amountCents: 3000, spendingCategoryId: 3 })],
    total: 1,
  });
  render(<SpendingCard range={NONE} />);
  await screen.findByRole("slider");

  fireEvent.click(screen.getByRole("button", { name: "Show the rows for Household" }));

  const cards = within(await screen.findByRole("list", { name: "Card lines in this period" }));
  expect(cards.getAllByRole("listitem")).toHaveLength(1);
  expect(fetchSpendingLines).toHaveBeenLastCalledWith(
    expect.objectContaining({ category: 3 }),
    expect.anything(),
  );
  expect(screen.getByText("No bank row matches.")).toBeTruthy();
  // The notice that put the whole period's card total on a category's list is gone.
  expect(screen.queryByText(/not listed here/i)).toBeNull();
});

test("choosing a category in the list asks for the card lines of it too, from the first", async () => {
  vi.mocked(fetchSpendingLines).mockResolvedValue({ lines: [CARD], total: 1 });
  await openClosedPeriod();
  await screen.findByRole("list", { name: "Card lines in this period" });

  fireEvent.change(screen.getByLabelText("Spending category"), { target: { value: "none" } });

  await waitFor(() =>
    expect(fetchSpendingLines).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: "none", offset: 0 }),
      expect.anything(),
    ),
  );
});

test("more card lines are asked for by offset, and a refused correction says so and keeps the line", async () => {
  const page = (from: number, count: number): PeriodLine[] =>
    Array.from({ length: count }, (_, at) =>
      line(200 + from + at, { category: `Achat ${String(from + at)}` }),
    );
  vi.mocked(fetchSpendingLines)
    .mockResolvedValueOnce({ lines: page(0, 25), total: 26 })
    .mockResolvedValueOnce({ lines: page(25, 1), total: 26 });
  vi.mocked(correctLine).mockRejectedValue(
    new AppError("SPENDING_CATEGORY_NOT_FOUND", "That spending category is gone."),
  );
  await openClosedPeriod();

  await screen.findByText("25 of 26");
  fireEvent.click(screen.getByRole("button", { name: "Show more card lines" }));
  await screen.findByText("26 of 26");
  expect(fetchSpendingLines).toHaveBeenLastCalledWith({
    from: null,
    to: "2026-01-31",
    category: null,
    offset: 25,
    limit: 25,
  });

  fireEvent.change(screen.getByLabelText("Spending category for Achat 0 of 2026-01-20"), {
    target: { value: "3" },
  });

  expect((await screen.findByRole("alert")).textContent).toContain(
    "That spending category is gone.",
  );
  expect(fetchSpendingStats).toHaveBeenCalledTimes(1);
  expect(screen.getByText("26 of 26")).toBeTruthy();
});
