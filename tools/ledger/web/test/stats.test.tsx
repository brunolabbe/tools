// @vitest-environment jsdom

/**
 * The stats screen (lg-9): every chart drawn from fixture series, the figures a
 * person reads off it, the table twin, the range that scopes them all, and the
 * phone. The fake is the API client module; every figure is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type {
  BufferStatsResponse,
  ClosedPeriod,
  ContributionsResponse,
  FixedItemsResponse,
  MortgageOwnResponse,
  MortgagePaymentsResponse,
  SalariesStatsResponse,
  SettlementsStatsResponse,
  SpendingStatsResponse,
} from "@ledger/contract";
import {
  fetchBufferStats,
  fetchContributions,
  fetchFixedItems,
  fetchMortgageOwn,
  fetchMortgagePayments,
  fetchSalariesStats,
  fetchSettlementsStats,
  fetchSpendingStats,
} from "../src/api/stats.ts";
import { Stats } from "../src/stats/Stats.tsx";

vi.mock("../src/api/stats.ts", () => ({
  fetchMortgagePayments: vi.fn(),
  fetchSalariesStats: vi.fn(),
  fetchContributions: vi.fn(),
  fetchMortgageOwn: vi.fn(),
  fetchBufferStats: vi.fn(),
  fetchSpendingStats: vi.fn(),
  fetchFixedItems: vi.fn(),
  fetchSettlementsStats: vi.fn(),
}));

const NONE = { from: null, to: null };

const PAYMENTS: MortgagePaymentsResponse = {
  range: NONE,
  payments: [
    { date: "2026-01-15", cents: 70000, previousCents: null, changed: false },
    { date: "2026-02-15", cents: 70000, previousCents: 70000, changed: false },
    { date: "2026-03-15", cents: 82001, previousCents: 70000, changed: true },
  ],
};

const OWN: MortgageOwnResponse = {
  range: NONE,
  people: ["alex", "sam"],
  points: [
    {
      date: "2026-01-05",
      balanceCents: 50000,
      own: [
        { personId: "alex", ownCents: 50000 },
        { personId: "sam", ownCents: 0 },
      ],
    },
    {
      date: "2026-03-15",
      balanceCents: 47999,
      own: [
        { personId: "alex", ownCents: 9000 },
        { personId: "sam", ownCents: 38999 },
      ],
    },
  ],
};

const CONTRIBUTIONS: ContributionsResponse = {
  range: NONE,
  people: ["alex", "sam"],
  series: [
    {
      bucket: "mortgage",
      points: [
        {
          date: "2026-01-05",
          contributions: [
            { personId: "alex", contributedCents: 50000 },
            { personId: "sam", contributedCents: 0 },
          ],
        },
      ],
    },
    { bucket: "current-expenses", points: [] },
  ],
};

const BUFFER: BufferStatsResponse = {
  range: NONE,
  minDropCents: 50000,
  points: [
    { date: "2026-01-10", balanceCents: 200000 },
    { date: "2026-02-20", balanceCents: 107655 },
  ],
  drops: [
    {
      rowId: 7,
      date: "2026-02-20",
      description: "Achat /Entrepreneur Exemple",
      amountCents: -80000,
      balanceAfterCents: 107655,
    },
  ],
};

const SALARIES: SalariesStatsResponse = {
  range: NONE,
  years: [
    {
      year: 2025,
      salaries: [
        { personId: "alex", amountCents: 5_000_000 },
        { personId: "sam", amountCents: 4_000_000 },
      ],
      ratio: {
        effectiveFrom: "2025-01-01",
        shares: [
          { personId: "alex", partsPerMillion: 555_556 },
          { personId: "sam", partsPerMillion: 444_444 },
        ],
      },
      changes: [
        {
          effectiveFrom: "2025-01-01",
          shares: [
            { personId: "alex", partsPerMillion: 555_556 },
            { personId: "sam", partsPerMillion: 444_444 },
          ],
        },
      ],
    },
    {
      year: 2026,
      salaries: [
        { personId: "alex", amountCents: 5_200_000 },
        { personId: "sam", amountCents: 4_400_000 },
      ],
      ratio: {
        effectiveFrom: "2026-03-01",
        shares: [
          { personId: "alex", partsPerMillion: 541_667 },
          { personId: "sam", partsPerMillion: 458_333 },
        ],
      },
      changes: [
        {
          effectiveFrom: "2026-03-01",
          shares: [
            { personId: "alex", partsPerMillion: 541_667 },
            { personId: "sam", partsPerMillion: 458_333 },
          ],
        },
      ],
    },
  ],
};

/** The whole list, in its own order, whatever a range has an amount in. */
const CATEGORIES: SpendingStatsResponse["categories"] = [
  { id: 1, name: "Groceries", retired: false },
  { id: 2, name: "Alcohol", retired: false },
  { id: 3, name: "Household", retired: false },
  { id: 4, name: "Pharmacy", retired: false },
  { id: 5, name: "Restaurant", retired: false },
  { id: 6, name: "Other", retired: false },
];

const SPENDING: SpendingStatsResponse = {
  range: NONE,
  categories: CATEGORIES,
  periods: [
    {
      start: null,
      end: "2026-01-31",
      open: false,
      totalCents: 15000,
      cardCents: 10000,
      accountCents: 5000,
      categories: [
        { categoryId: 1, cents: 12000 },
        { categoryId: 4, cents: 3000 },
      ],
    },
    {
      start: "2026-02-01",
      end: "2026-02-28",
      open: true,
      totalCents: 16345,
      cardCents: 4000,
      accountCents: 12345,
      categories: [
        { categoryId: 1, cents: 12345 },
        {
          categoryId: null,
          cents: 4000,
          detail: [{ label: "Café", cents: 4000 }],
        },
      ],
    },
  ],
};

const FIXED: FixedItemsResponse = {
  range: NONE,
  months: ["2026-01", "2026-02", "2026-03"],
  series: [
    { label: "Insurance", cents: [12000, 12000, 13000] },
    { label: "Internet", cents: [0, 7000, 7000] },
  ],
};

function closed(
  id: number,
  end: string,
  formula: ClosedPeriod["settlement"]["formula"],
  netCents: number,
): ClosedPeriod {
  return {
    id,
    start: null,
    end,
    closedAt: `${end}T12:00:00Z`,
    closedBy: "alex",
    settlement: {
      formula,
      ratioId: 1,
      shares: [],
      payerId: "alex",
      recipientId: "sam",
      depositCents: netCents * 2,
      netCents,
    },
    deposit: { status: "expected", rowId: null },
  };
}

const SETTLEMENTS: SettlementsStatsResponse = {
  range: NONE,
  periods: [
    closed(1, "2026-01-31", "v1", 6000),
    closed(2, "2026-02-28", "v2", 7000),
    closed(3, "2026-03-31", "v3", 8000),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMortgagePayments).mockResolvedValue(PAYMENTS);
  vi.mocked(fetchMortgageOwn).mockResolvedValue(OWN);
  vi.mocked(fetchContributions).mockResolvedValue(CONTRIBUTIONS);
  vi.mocked(fetchBufferStats).mockResolvedValue(BUFFER);
  vi.mocked(fetchSalariesStats).mockResolvedValue(SALARIES);
  vi.mocked(fetchSpendingStats).mockResolvedValue(SPENDING);
  vi.mocked(fetchFixedItems).mockResolvedValue(FIXED);
  vi.mocked(fetchSettlementsStats).mockResolvedValue(SETTLEMENTS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // A test that gave the page a width removes it, so the next one has none.
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

/** A promise settled from outside, for a request that is still in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const held: { settle?: (value: T) => void } = {};
  const promise = new Promise<T>((done) => {
    held.settle = done;
  });
  return { promise, resolve: (value) => held.settle?.(value) };
}

/** The card with this heading, once its chart has loaded. */
async function card(title: string): Promise<ReturnType<typeof within>> {
  let found: HTMLElement | null = null;
  // The loading card and the drawn one are different elements, so look again each time.
  await waitFor(() => {
    const section = screen.getByRole("heading", { name: title }).closest("section");
    if (section === null) throw new Error(`no card for ${title}`);
    within(section).getByRole("slider");
    found = section;
  });
  if (found === null) throw new Error(`no card for ${title}`);
  return within(found);
}

function slider(from: ReturnType<typeof within>): HTMLElement {
  return from.getByRole("slider");
}

test("draws every chart from its series, each with the figures for the latest date", async () => {
  render(<Stats />);

  const payment = await card("Mortgage payment");
  expect(payment.getByText("2026-03-15")).toBeTruthy();
  expect(payment.getByText("820.01 $")).toBeTruthy();
  expect(payment.getByText("Changed from 700.00 $ to 820.01 $.")).toBeTruthy();

  const own = await card("Own money in the mortgage");
  expect(own.getByText("90.00 $")).toBeTruthy();
  expect(own.getByText("389.99 $")).toBeTruthy();
  expect(own.getByText("In the bucket: 479.99 $")).toBeTruthy();

  const mortgagePutIn = await card("Put into the mortgage");
  expect(mortgagePutIn.getByText("500.00 $")).toBeTruthy();

  const buffer = await card("Buffer balance");
  expect(buffer.getByText("1076.55 $")).toBeTruthy();
  expect(buffer.getByText("Achat /Entrepreneur Exemple: -800.00 $")).toBeTruthy();

  const salaries = await card("Salaries by year");
  // The year on the axis and the year the figures are for.
  expect(salaries.getAllByText("2026")).toHaveLength(2);
  expect(salaries.getByText("52000.00 $")).toBeTruthy();

  const ratio = await card("Ratio by year");
  expect(ratio.getByText("54.1667 %")).toBeTruthy();

  const spending = await card("Spending by period");
  expect(spending.getByText("Total")).toBeTruthy();
  expect(spending.getByText("Uncategorised: Café, 40.00 $")).toBeTruthy();

  const fixed = await card("Fixed items by month");
  expect(fixed.getByText("200.00 $")).toBeTruthy();

  const settlements = await card("Settlements");
  expect(settlements.getByText("Formula v3: the tool's formula.")).toBeTruthy();
});

test("a nothing-in-this-range bucket says so instead of drawing an empty frame", async () => {
  render(<Stats />);

  await card("Put into the mortgage");

  expect(await screen.findByText("Nothing was filed to a person in this range.")).toBeTruthy();
});

test("a larger dot marks the payment that changed, and the large drop", async () => {
  render(<Stats />);

  const payment = await card("Mortgage payment");
  const buffer = await card("Buffer balance");

  expect(slider(payment).querySelectorAll("circle.marker")).toHaveLength(1);
  expect(slider(buffer).querySelectorAll("circle.marker")).toHaveLength(1);
});

test("the arrow keys move the figures to another date", async () => {
  render(<Stats />);
  const payment = await card("Mortgage payment");

  fireEvent.keyDown(slider(payment), { key: "ArrowLeft" });

  expect(payment.getByText("2026-02-15")).toBeTruthy();
  expect(payment.getByText("700.00 $")).toBeTruthy();
  expect(payment.queryByText(/Changed from/u)).toBeNull();
  expect(slider(payment).getAttribute("aria-valuetext")).toBe("2026-02-15");

  fireEvent.keyDown(slider(payment), { key: "Home" });
  expect(payment.getByText("The first payment in the books.")).toBeTruthy();
  fireEvent.keyDown(slider(payment), { key: "End" });
  expect(payment.getByText("2026-03-15")).toBeTruthy();
});

test("a ratio change inside a year is said under the year's column", async () => {
  render(<Stats />);
  const ratio = await card("Ratio by year");

  expect(ratio.getByText("From 2026-03-01: alex 54.1667 %, sam 45.8333 %")).toBeTruthy();

  fireEvent.keyDown(slider(ratio), { key: "Home" });

  expect(ratio.getByText("From 2025-01-01: alex 55.5556 %, sam 44.4444 %")).toBeTruthy();
});

test("every chart has a table twin with the same figures", async () => {
  render(<Stats />);
  const payment = await card("Mortgage payment");

  fireEvent.click(payment.getByRole("button", { name: "Show as a table" }));

  const table = payment.getByRole("table");
  const rows = within(table).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "DatePaymentChange",
    "2026-01-15700.00 $",
    "2026-02-15700.00 $",
    "2026-03-15820.01 $+120.01 $",
  ]);
  expect(payment.queryByRole("slider")).toBeNull();

  fireEvent.click(payment.getByRole("button", { name: "Show the chart" }));
  expect(payment.getByRole("slider")).toBeTruthy();
});

test("the settlements table names the formula each period was settled by", async () => {
  render(<Stats />);
  const settlements = await card("Settlements");

  fireEvent.click(settlements.getByRole("button", { name: "Show as a table" }));

  const rows = within(settlements.getByRole("table")).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toEqual([
    "ClosedFormulaWho owesDirectInto the buffer",
    "2026-01-31v1alex owes sam60.00 $120.00 $",
    "2026-02-28v2alex owes sam70.00 $140.00 $",
    "2026-03-31v3alex owes sam80.00 $160.00 $",
  ]);
});

test("the spending legend names each category and the grey for none, and the table totals", async () => {
  render(<Stats />);
  const spending = await card("Spending by period");

  const legend = spending.getByRole("list", { name: "Legend" });
  expect(
    within(legend)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Groceries", "Pharmacy", "Uncategorised"]);

  fireEvent.click(spending.getByRole("button", { name: "Show as a table" }));
  const rows = within(spending.getByRole("table")).getAllByRole("row");
  expect(rows[0]?.textContent).toBe("PeriodCardsAccountTotalGroceriesPharmacyUncategorised");
  expect(rows[2]?.textContent).toBe(
    "2026-02-01 to 2026-02-28 (open)40.00 $123.45 $163.45 $123.45 $0.00 $40.00 $",
  );
});

test("a category keeps its colour whatever the others in the range are", async () => {
  vi.mocked(fetchSpendingStats).mockResolvedValue({
    ...SPENDING,
    // A range with nothing in Groceries: Pharmacy is still the list's fourth.
    periods: [
      {
        start: null,
        end: "2026-01-31",
        open: false,
        totalCents: 3000,
        cardCents: 0,
        accountCents: 3000,
        categories: [
          { categoryId: 4, cents: 2500 },
          { categoryId: null, cents: 500, detail: [{ label: null, cents: 500 }] },
        ],
      },
    ],
  });
  render(<Stats />);
  const spending = await card("Spending by period");

  const swatches = spending.getByRole("list", { name: "Legend" }).querySelectorAll(".swatch");

  expect(swatches).toHaveLength(2);
  expect((swatches[0] as HTMLElement).style.background).toBe("var(--series-4)");
});

test("a range is chosen once, above the charts, and every chart is asked for it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
  render(<Stats />);
  await card("Settlements");
  expect(vi.mocked(fetchSettlementsStats).mock.calls[0]?.[0]).toEqual({ from: null, to: null });

  fireEvent.click(screen.getByRole("button", { name: "This year" }));

  await waitFor(() =>
    expect(vi.mocked(fetchSettlementsStats).mock.calls.at(-1)?.[0]).toEqual({
      from: "2026-01-01",
      to: null,
    }),
  );
  for (const fetcher of [
    fetchMortgagePayments,
    fetchMortgageOwn,
    fetchContributions,
    fetchBufferStats,
    fetchSalariesStats,
    fetchSpendingStats,
    fetchFixedItems,
  ]) {
    expect(vi.mocked(fetcher).mock.calls.at(-1)?.[0]).toEqual({ from: "2026-01-01", to: null });
  }

  fireEvent.click(screen.getByRole("button", { name: "Last 12 months" }));

  await waitFor(() =>
    expect(vi.mocked(fetchMortgagePayments).mock.calls.at(-1)?.[0]).toEqual({
      from: "2025-10-10",
      to: null,
    }),
  );
});

test("days picked by hand are sent, and a first day after the last is not", async () => {
  render(<Stats />);
  await card("Settlements");

  fireEvent.click(screen.getByRole("button", { name: "Pick days" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-02-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-01" } });
  await waitFor(() =>
    expect(vi.mocked(fetchBufferStats).mock.calls.at(-1)?.[0]).toEqual({
      from: "2026-02-01",
      to: "2026-03-01",
    }),
  );
  const asked = vi.mocked(fetchBufferStats).mock.calls.length;

  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-01-01" } });

  expect((await screen.findByRole("alert")).textContent).toBe("The first day is after the last.");
  expect(vi.mocked(fetchBufferStats).mock.calls).toHaveLength(asked);
});

test("while a new range loads the old charts stay, dimmed", async () => {
  render(<Stats />);
  const payment = await card("Mortgage payment");
  const later = deferred<MortgagePaymentsResponse>();
  vi.mocked(fetchMortgagePayments).mockReturnValue(later.promise);

  fireEvent.click(screen.getByRole("button", { name: "This year" }));

  await waitFor(() => {
    const section = screen.getByRole("heading", { name: "Mortgage payment" }).closest("section");
    expect(section?.classList.contains("stale")).toBe(true);
  });
  expect(payment.getByText("820.01 $")).toBeTruthy();

  later.resolve({ ...PAYMENTS, payments: [] });

  expect(
    await screen.findByText("No payment came out of the mortgage bucket in this range."),
  ).toBeTruthy();
});

test("one chart failing says what the server said and leaves the others drawn", async () => {
  vi.mocked(fetchBufferStats).mockRejectedValue(
    new AppError("UNREACHABLE", "The ledger API is not answering."),
  );
  render(<Stats />);

  expect((await screen.findByRole("alert")).textContent).toBe("The ledger API is not answering.");
  await card("Mortgage payment");
  await card("Settlements");
});

test("on a 360px phone a line chart is drawn 360px wide and a long column chart scrolls", async () => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 360 });
  vi.mocked(fetchFixedItems).mockResolvedValue({
    range: NONE,
    months: Array.from(
      { length: 24 },
      (_, at) => `${at < 12 ? "2025" : "2026"}-${String((at % 12) + 1).padStart(2, "0")}`,
    ),
    series: [{ label: "Internet", cents: Array<number>(24).fill(7000) }],
  });
  render(<Stats />);

  const payment = await card("Mortgage payment");
  const fixed = await card("Fixed items by month");

  expect(slider(payment).getAttribute("width")).toBe("360");
  // 24 columns at 28px, and the axis, do not fit in 360px; the chart is wider and scrolls.
  expect(Number(slider(fixed).getAttribute("width"))).toBeGreaterThan(360);
  expect(slider(fixed).closest(".chart-scroll")).not.toBeNull();
});
