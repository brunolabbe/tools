// @vitest-environment jsdom

/**
 * The period screen (lg-6): the open period's lines per person, a line or a
 * charge entered by hand, the recurring items, the close button with who
 * deposits what, and the deposits no paste has brought in yet. The fakes are
 * the API client modules; every amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type {
  ClosedPeriod,
  OpenPeriodResponse,
  RecurringItem,
  SettlementFigures,
} from "@ledger/contract";
import { fetchPeople } from "../src/api/rules.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import {
  addLine,
  addRecurring,
  changeRecurring,
  closePeriod,
  fetchMe,
  fetchOpenPeriod,
  fetchPeriods,
  fetchRecurring,
  retireLine,
} from "../src/api/periods.ts";
import { Periods } from "../src/periods/Periods.tsx";

vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({ fetchSpendingCategories: vi.fn() }));
vi.mock("../src/api/periods.ts", () => ({
  fetchMe: vi.fn(),
  fetchOpenPeriod: vi.fn(),
  fetchPeriods: vi.fn(),
  closePeriod: vi.fn(),
  addLine: vi.fn(),
  retireLine: vi.fn(),
  fetchRecurring: vi.fn(),
  addRecurring: vi.fn(),
  changeRecurring: vi.fn(),
}));

const SHARES = [
  { personId: "alex", partsPerMillion: 600_000, salaryId: 1 },
  { personId: "sam", partsPerMillion: 400_000, salaryId: 2 },
];

const OWED: SettlementFigures = {
  formula: "v3",
  ratioId: 1,
  shares: SHARES,
  payerId: "alex",
  recipientId: "sam",
  depositCents: 15_000,
  netCents: 6_000,
};

const OPEN: OpenPeriodResponse = {
  start: "2026-07-01",
  end: "2026-10-03",
  first: false,
  lines: [
    {
      date: "2026-07-10",
      personId: "alex",
      amountCents: 8_000,
      chargedTo: null,
      category: "Internet",
      spendingCategoryId: null,
      note: null,
      lineId: null,
      recurringItemId: 4,
      late: false,
    },
    {
      date: "2026-08-02",
      personId: "sam",
      amountCents: 12_345,
      chargedTo: null,
      category: "Épicerie",
      spendingCategoryId: null,
      note: null,
      lineId: 7,
      recurringItemId: null,
      late: false,
    },
    {
      date: "2026-08-03",
      personId: "sam",
      amountCents: 2_000,
      chargedTo: "alex",
      category: null,
      spendingCategoryId: null,
      note: "A book",
      lineId: 8,
      recurringItemId: null,
      late: false,
    },
  ],
  settlement: OWED,
};

const ITEM: RecurringItem = {
  id: 4,
  personId: "alex",
  monthlyCents: 8_000,
  startDate: "2026-01-10",
  endDate: null,
  label: "Internet",
  supersedes: null,
  enteredAt: "2026-01-10T12:00:00.000Z",
  enteredBy: "alex",
};

function closed(id: number, end: string, status: ClosedPeriod["deposit"]["status"]): ClosedPeriod {
  return {
    id,
    start: null,
    end,
    closedAt: `${end}T20:00:00.000Z`,
    closedBy: "sam",
    settlement: { ...OWED, depositCents: id * 1_000 },
    deposit: { status, rowId: status === "matched" ? 99 : null },
  };
}

const SPENDING_CATEGORIES = [
  { id: 1, name: "Groceries", retired: false, createdAt: "x", createdBy: "migration" },
  { id: 4, name: "Pharmacy", retired: false, createdAt: "x", createdBy: "migration" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSpendingCategories).mockResolvedValue(SPENDING_CATEGORIES);
  vi.mocked(fetchMe).mockResolvedValue("sam");
  vi.mocked(fetchOpenPeriod).mockResolvedValue(OPEN);
  vi.mocked(fetchPeriods).mockResolvedValue([
    closed(3, "2026-06-30", "expected"),
    closed(2, "2026-03-31", "folded"),
    closed(1, "2025-12-31", "matched"),
  ]);
  vi.mocked(fetchRecurring).mockResolvedValue([ITEM]);
});

afterEach(cleanup);

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name });
  const found = heading.closest("section");
  if (found === null) throw new Error(`no section for ${name}`);
  return found;
}

test("shows the open period's lines per person, with what each paid toward shared costs", async () => {
  render(<Periods />);

  const open = await screen.findByRole("heading", { name: "Open period, since 2026-07-01" });
  const card = open.closest("section") as HTMLElement;
  // The charge is not shared, so sam's shared total is the groceries alone.
  expect(within(card).getByText("Paid by alex").nextSibling?.textContent).toBe("80.00 $");
  expect(within(card).getByText("Paid by sam").nextSibling?.textContent).toBe("123.45 $");
  expect(within(card).getByText("2026-07-10 · Internet (monthly)")).toBeTruthy();
  expect(within(card).getByText("2026-08-03 · A book, alex's")).toBeTruthy();
  // Only a stored line can be removed; a monthly one is the recurring item's.
  expect(within(card).getAllByRole("button", { name: /^Remove/u })).toHaveLength(2);
});

test("the close button shows who deposits what, and closing sends the period as seen", async () => {
  vi.mocked(closePeriod).mockResolvedValue(closed(4, "2026-10-02", "expected"));
  render(<Periods />);
  await screen.findByRole("heading", { name: "Close the period" });

  const card = section("Close the period");
  expect(within(card).getByText("alex deposits 150.00 $ into the buffer.")).toBeTruthy();
  expect(within(card).getByText("Or pays sam 60.00 $ directly.")).toBeTruthy();

  fireEvent.change(field("Last day"), { target: { value: "2026-10-02" } });
  await waitFor(() =>
    expect(fetchOpenPeriod).toHaveBeenLastCalledWith({ end: "2026-10-02" }, undefined),
  );
  fireEvent.click(within(card).getByRole("button", { name: "Close the period" }));

  await waitFor(() =>
    expect(closePeriod).toHaveBeenCalledWith({ start: "2026-07-01", end: "2026-10-02" }),
  );
  expect(
    await screen.findByText("Period closed. alex deposits 40.00 $ into the buffer."),
  ).toBeTruthy();
  // Reloaded as of today: the period just closed is over.
  expect(fetchOpenPeriod).toHaveBeenLastCalledWith({}, undefined);
});

test("with no ratio in effect, the period cannot be closed", async () => {
  vi.mocked(fetchOpenPeriod).mockResolvedValue({ ...OPEN, settlement: null });
  render(<Periods />);
  await screen.findByRole("heading", { name: "Close the period" });

  const card = section("Close the period");
  expect(within(card).getByText(/No ratio is in effect on that day/u)).toBeTruthy();
  expect(
    (within(card).getByRole("button", { name: "Close the period" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

test("the first period asks since when the two were even", async () => {
  vi.mocked(fetchOpenPeriod).mockResolvedValue({ ...OPEN, start: null, first: true });
  vi.mocked(closePeriod).mockResolvedValue(closed(1, "2026-10-03", "expected"));
  render(<Periods />);
  await screen.findByRole("heading", { name: "Open period" });

  fireEvent.change(field("Since (when the two were last even)"), {
    target: { value: "2026-04-01" },
  });
  await waitFor(() =>
    expect(fetchOpenPeriod).toHaveBeenLastCalledWith(
      { start: "2026-04-01", end: "2026-10-03" },
      undefined,
    ),
  );
});

test("a line entered by hand, ticked as the other person's, is a charge to them", async () => {
  vi.mocked(addLine).mockResolvedValue({
    id: 9,
    personId: "sam",
    date: "2026-09-12",
    amountCents: 4_520,
    category: null,
    spendingCategoryId: 4,
    note: null,
    source: "manual",
    chargedTo: "alex",
    supersedes: null,
    enteredAt: "2026-09-12T12:00:00.000Z",
    enteredBy: "sam",
  });
  render(<Periods />);
  const form = await screen.findByRole("form", { name: "Add a line" });

  // Paid by whoever is signed in, unless they choose another.
  expect((within(form).getByLabelText("Paid by") as HTMLSelectElement).value).toBe("sam");
  fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-12" } });
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "45.20" } });
  fireEvent.change(within(form).getByLabelText("Spending category"), { target: { value: "4" } });
  fireEvent.click(within(form).getByLabelText("This was alex's"));
  fireEvent.click(within(form).getByRole("button", { name: "Add the line" }));

  await waitFor(() =>
    expect(addLine).toHaveBeenCalledWith({
      personId: "sam",
      date: "2026-09-12",
      amountCents: 4_520,
      category: null,
      spendingCategoryId: 4,
      note: null,
      chargedTo: "alex",
    }),
  );
  expect(await screen.findByText("Charged to alex.")).toBeTruthy();
});

test("an amount that is not one is refused before anything is sent", async () => {
  render(<Periods />);
  const form = await screen.findByRole("form", { name: "Add a line" });

  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "lots" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add the line" }));

  expect((await screen.findByRole("alert")).textContent).toMatch(/not one/u);
  expect(addLine).not.toHaveBeenCalled();
});

test("removing a stored line retires it", async () => {
  vi.mocked(retireLine).mockResolvedValue({} as never);
  render(<Periods />);

  fireEvent.click(await screen.findByRole("button", { name: "Remove 2026-08-02 Épicerie" }));

  await waitFor(() => expect(retireLine).toHaveBeenCalledWith(7));
  expect(await screen.findByText("Line removed.")).toBeTruthy();
});

test("the recurring items: one is added, and one is ended on a day", async () => {
  vi.mocked(addRecurring).mockResolvedValue({ ...ITEM, id: 5, label: "Assurance" });
  vi.mocked(changeRecurring).mockResolvedValue({ ...ITEM, id: 6, endDate: "2026-12-31" });
  render(<Periods />);
  await screen.findByRole("heading", { name: "Every month" });
  const card = section("Every month");
  expect(within(card).getByText("Internet · alex")).toBeTruthy();
  expect(within(card).getByText("80.00 $ a month")).toBeTruthy();

  const form = within(card).getByRole("form", { name: "Add a recurring item" });
  fireEvent.change(within(form).getByLabelText("What"), { target: { value: "Assurance" } });
  fireEvent.change(within(form).getByLabelText("Each month"), { target: { value: "62.50" } });
  fireEvent.change(within(form).getByLabelText("First month’s date"), {
    target: { value: "2026-11-01" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "Add the item" }));
  await waitFor(() =>
    expect(addRecurring).toHaveBeenCalledWith({
      personId: "sam",
      monthlyCents: 6_250,
      startDate: "2026-11-01",
      endDate: null,
      label: "Assurance",
    }),
  );

  fireEvent.change(within(card).getByLabelText("Internet ends on"), {
    target: { value: "2026-12-31" },
  });
  fireEvent.click(within(card).getByRole("button", { name: "End" }));
  await waitFor(() =>
    expect(changeRecurring).toHaveBeenCalledWith(4, {
      personId: "alex",
      monthlyCents: 8_000,
      startDate: "2026-01-10",
      endDate: "2026-12-31",
      label: "Internet",
    }),
  );
});

test("the deposits not seen yet are the expected ones, and not those matched or folded", async () => {
  render(<Periods />);
  await screen.findByRole("heading", { name: "Deposits not seen yet" });

  const items = within(section("Deposits not seen yet")).getAllByRole("listitem");

  expect(items.map((item) => item.textContent)).toEqual([
    "alex, for the period ending 2026-06-3030.00 $",
  ]);
});

test("the day a period is closed, the next one cannot be closed before it starts", async () => {
  vi.mocked(fetchOpenPeriod).mockResolvedValue({
    ...OPEN,
    start: "2026-10-04",
    end: "2026-10-03",
    lines: [],
  });
  render(<Periods />);
  await screen.findByRole("heading", { name: "Close the period" });

  const card = section("Close the period");
  expect(within(card).getByText("This period starts on 2026-10-04.")).toBeTruthy();
  expect(
    (within(card).getByRole("button", { name: "Close the period" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

// Gate 1, med 3: a line entered after its period closed is listed, marked, and
// counted in its payer's figure, since the next close counts it.
test("a line entered after its period closed is listed as late, and in its payer's figure", async () => {
  vi.mocked(fetchOpenPeriod).mockResolvedValue({
    ...OPEN,
    lines: [
      {
        date: "2026-06-20",
        personId: "alex",
        amountCents: 4_000,
        chargedTo: null,
        category: "Épicerie",
        spendingCategoryId: null,
        note: null,
        lineId: 12,
        recurringItemId: null,
        late: true,
      },
    ],
  });
  render(<Periods />);

  const open = await screen.findByRole("heading", { name: "Open period, since 2026-07-01" });
  const card = open.closest("section") as HTMLElement;
  expect(
    within(card).getByText("2026-06-20 · Épicerie, entered after its period closed"),
  ).toBeTruthy();
  expect(within(card).getByText("Paid by alex").nextSibling?.textContent).toBe("40.00 $");
});

// Spending categories on period lines (lg-15).
test("a line is named by its spending category, and an older one shows its text as it was", async () => {
  vi.mocked(fetchOpenPeriod).mockResolvedValue({
    ...OPEN,
    lines: [
      {
        date: "2026-08-02",
        personId: "sam",
        amountCents: 12_345,
        chargedTo: null,
        category: null,
        spendingCategoryId: 1,
        note: null,
        lineId: 7,
        recurringItemId: null,
        late: false,
      },
      {
        date: "2026-08-04",
        personId: "sam",
        amountCents: 2_500,
        chargedTo: null,
        category: "pharmacie du coin",
        spendingCategoryId: null,
        note: null,
        lineId: 9,
        recurringItemId: null,
        late: false,
      },
    ],
  });
  render(<Periods />);

  const open = await screen.findByRole("heading", { name: "Open period, since 2026-07-01" });
  const card = open.closest("section") as HTMLElement;
  expect(within(card).getByText("2026-08-02 · Groceries")).toBeTruthy();
  expect(within(card).getByText("2026-08-04 · pharmacie du coin")).toBeTruthy();
});

test("the line form offers the list, and sends none when none is picked", async () => {
  vi.mocked(addLine).mockResolvedValue({
    id: 10,
    personId: "sam",
    date: "2026-09-12",
    amountCents: 1_000,
    category: null,
    spendingCategoryId: null,
    note: null,
    source: "manual",
    chargedTo: null,
    supersedes: null,
    enteredAt: "2026-09-12T12:00:00.000Z",
    enteredBy: "sam",
  });
  render(<Periods />);
  const form = await screen.findByRole("form", { name: "Add a line" });
  const picker = within(form).getByLabelText<HTMLSelectElement>("Spending category");
  expect([...picker.options].map((option) => option.text)).toEqual([
    "None",
    "Groceries",
    "Pharmacy",
  ]);

  fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-12" } });
  fireEvent.change(within(form).getByLabelText("Amount"), { target: { value: "10" } });
  fireEvent.click(within(form).getByRole("button", { name: "Add the line" }));

  await waitFor(() =>
    expect(addLine).toHaveBeenCalledWith(
      expect.objectContaining({ category: null, spendingCategoryId: null }),
    ),
  );
});
