// @vitest-environment jsdom

/**
 * The shell's screens (lg-4, lg-5, lg-6): the inbox tab carries the number of rows
 * waiting, so a paste that left some is not missed, each tab shows its own
 * screen, and the home screen is the first. The fakes are the API client modules.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { InboxRow } from "@ledger/contract";
import { fetchBuckets } from "../src/api/buckets.ts";
import { fetchHealth } from "../src/api/health.ts";
import { fetchAdminHouseholds, fetchHousehold } from "../src/api/households.ts";
import { fetchAutoFiled, fetchInbox } from "../src/api/inbox.ts";
import { fetchMe } from "../src/api/me.ts";
import { fetchMortgage } from "../src/api/mortgage.ts";
import { fetchPeopleNames } from "../src/api/people.ts";
import { importStatement } from "../src/api/statements.ts";
import { fetchPeople, fetchRules } from "../src/api/rules.ts";
import { fetchRatios, fetchSalaries } from "../src/api/salaries.ts";
import { App } from "../src/App.tsx";
import { LIVE } from "./mortgage-fixtures.ts";

vi.mock("../src/api/health.ts", () => ({ fetchHealth: vi.fn() }));
vi.mock("../src/api/me.ts", () => ({ fetchMe: vi.fn() }));
vi.mock("../src/api/mortgage.ts", () => ({ fetchMortgage: vi.fn(), saveMortgage: vi.fn() }));
vi.mock("../src/api/people.ts", () => ({ fetchPeopleNames: vi.fn() }));
vi.mock("../src/api/statements.ts", () => ({ importStatement: vi.fn() }));
vi.mock("../src/api/buckets.ts", () => ({ fetchBuckets: vi.fn() }));
vi.mock("../src/api/salaries.ts", () => ({
  fetchSalaries: vi.fn(),
  fetchRatios: vi.fn(),
  enterSalaries: vi.fn(),
  confirmRatio: vi.fn(),
}));
vi.mock("../src/api/inbox.ts", () => ({
  fetchInbox: vi.fn(),
  fetchAutoFiled: vi.fn(),
  classifyRow: vi.fn(),
}));
vi.mock("../src/api/rules.ts", () => ({
  fetchRules: vi.fn(),
  fetchPeople: vi.fn(),
  createRule: vi.fn(),
  editRule: vi.fn(),
  retireRule: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchHealth).mockResolvedValue({
    ok: true,
    shuttingDown: false,
    version: "0.0.0",
    uptimeSec: 1,
    database: { open: true },
    directory: { open: true },
  });
  vi.mocked(fetchMe).mockResolvedValue({
    person: { id: "alex", email: "alex@example.test", household: "home" },
    admin: false,
  });
  vi.mocked(fetchMortgage).mockResolvedValue(LIVE);
  vi.mocked(fetchRules).mockResolvedValue([]);
  vi.mocked(fetchAutoFiled).mockResolvedValue([]);
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchPeopleNames).mockResolvedValue({ alex: "alex", sam: "sam" });
  vi.mocked(fetchBuckets).mockResolvedValue({
    asOf: "2026-10-03",
    mortgage: { balanceCents: 0, own: [], lead: null },
    buffer: { balanceCents: 0, contributions: [] },
    unclassified: 0,
  });
  vi.mocked(fetchSalaries).mockResolvedValue([]);
  vi.mocked(fetchRatios).mockResolvedValue({ asOf: "2026-10-03", ratios: [], inEffect: null });
});

afterEach(cleanup);

const WAITING: Omit<InboxRow, "id" | "description" | "amountCents"> = {
  date: "2026-09-20",
  category: "Épicerie",
  balanceCents: 111111,
  reason: "no-rule",
  suggestion: null,
  history: null,
  spendingCategory: null,
  matching: [],
};

test("the inbox tab carries the number of rows waiting", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([
    { ...WAITING, id: 1, description: "Achat /Marché Exemple", amountCents: -100 },
    { ...WAITING, id: 2, description: "Achat /Autre Exemple", amountCents: -200 },
  ]);

  render(<App />);

  expect(await screen.findByRole("button", { name: "Inbox (2)" })).toBeTruthy();
});

test("an empty inbox carries no number", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);

  render(<App />);

  await screen.findByRole("button", { name: "Inbox" });
  expect(screen.queryByRole("button", { name: /Inbox \(/u })).toBeNull();
});

test("each tab shows its own screen, and the home screen is the first", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);
  expect(await screen.findByRole("heading", { name: "Mortgage" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  expect(screen.getByRole("heading", { name: "Paste a statement" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Rules" }));
  expect(await screen.findByRole("heading", { name: "Rules" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Paste a statement" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
  expect(await screen.findByRole("heading", { name: "Inbox" })).toBeTruthy();
});

test("the salaries tab shows the salaries screen", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Salaries" }));

  expect(await screen.findByRole("heading", { name: "Salaries" })).toBeTruthy();
});

// lg-6: the period tab. Its client is faked here like every other screen's.
vi.mock("../src/api/periods.ts", () => ({
  fetchMe: vi.fn().mockResolvedValue("alex"),
  fetchOpenPeriod: vi.fn().mockResolvedValue({
    start: null,
    end: "2026-10-03",
    first: true,
    lines: [],
    settlement: null,
  }),
  fetchPeriods: vi.fn().mockResolvedValue([]),
  fetchRecurring: vi.fn().mockResolvedValue([]),
}));

// lg-15: the screens that pick a spending category read the list; the categories tab shows it.
vi.mock("../src/api/spending.ts", () => ({
  fetchSpendingCategories: vi.fn().mockResolvedValue([]),
  fetchSpendingMap: vi.fn().mockResolvedValue([]),
  fetchUncategorisedRows: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
  setRowSpendingCategory: vi.fn(),
}));

// lg-41: the history tab lists the bank rows through its own client module.
vi.mock("../src/api/rows.ts", () => ({
  fetchRows: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

test("the categories tab shows the spending categories screen", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Categories" }));

  expect(await screen.findByRole("heading", { name: "Spending categories" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("the period tab shows the period screen", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Period" }));

  expect(await screen.findByRole("heading", { name: "Open period" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

// lg-9: the stats tab. Its client is faked here like every other screen's, with a
// bucket that never moved, so every chart says there is nothing in its range.
vi.mock("../src/api/stats.ts", () => {
  const none = { from: null, to: null };
  return {
    fetchMortgagePayments: vi.fn().mockResolvedValue({ range: none, payments: [] }),
    fetchMortgageOwn: vi.fn().mockResolvedValue({ range: none, people: [], points: [] }),
    fetchContributions: vi.fn().mockResolvedValue({ range: none, people: [], series: [] }),
    fetchBufferStats: vi
      .fn()
      .mockResolvedValue({ range: none, minDropCents: 50000, points: [], drops: [] }),
    fetchSalariesStats: vi.fn().mockResolvedValue({ range: none, people: [], years: [] }),
    fetchSpendingStats: vi.fn().mockResolvedValue({ range: none, categories: [], periods: [] }),
    fetchFixedItems: vi.fn().mockResolvedValue({ range: none, months: [], series: [] }),
    fetchSettlementsStats: vi.fn().mockResolvedValue({ range: none, periods: [] }),
  };
});

test("the stats tab shows the history, with its one range above the charts", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "Stats" }));

  expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  expect(
    await screen.findByText("No payment came out of the mortgage bucket in this range."),
  ).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("an address in no household sees one page saying so, naming nobody, and no screens (lg-20)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  vi.mocked(fetchMe).mockRejectedValue(new AppError("FORBIDDEN"));

  render(<App />);

  expect(await screen.findByRole("heading", { name: "No household" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Screens" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
  const page = document.body.textContent ?? "";
  expect(page).not.toMatch(/@|alex|sam|home\b/u);
});

test("any other failure of /api/me leaves the screens as they are (lg-20)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  vi.mocked(fetchMe).mockRejectedValue(new AppError("UNREACHABLE"));

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Mortgage" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "No household" })).toBeNull();
});

// lg-22: the household tab for a member, the admin tab for an admin, and the
// admin's screen alone for an admin in no household. The directory's client is
// faked like every other screen's; by default it refuses, as for a non-admin.
vi.mock("../src/api/households.ts", () => ({
  fetchHousehold: vi.fn(),
  addHouseholdMember: vi.fn(),
  fetchAdminHouseholds: vi.fn(),
  createHousehold: vi.fn(),
  adminAddMember: vi.fn(),
  adminRemoveMember: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(fetchAdminHouseholds).mockRejectedValue(new AppError("FORBIDDEN"));
  vi.mocked(fetchHousehold).mockResolvedValue({
    household: { id: "home", name: "The test household" },
    members: [{ address: "alex@example.test", person: "alex", name: "alex" }],
    history: [],
  });
});

test("a member has a household tab showing their own household, and no admin tab (lg-22)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Household" }));

  expect(await screen.findByRole("heading", { name: "Household" })).toBeTruthy();
  expect(vi.mocked(fetchHousehold).mock.calls[0]?.[0]).toBe("home");
  expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
});

test("an admin who is a member has the admin tab as well (lg-22)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  vi.mocked(fetchMe).mockResolvedValue({
    person: { id: "alex", email: "alex@example.test", household: "home" },
    admin: true,
  });
  vi.mocked(fetchAdminHouseholds).mockResolvedValue([]);
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "Admin" }));

  expect(await screen.findByRole("heading", { name: "Households" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
});

test("an admin in no household sees the admin's screen alone, and no books (lg-22)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  vi.mocked(fetchMe).mockRejectedValue(new AppError("FORBIDDEN"));
  vi.mocked(fetchAdminHouseholds).mockResolvedValue([]);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Households" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "Screens" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Mortgage" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "No household" })).toBeNull();
});

// lg-22's gate 1, F2: only the admin list's FORBIDDEN means nobody the ledger
// knows. Any other failure of it leaves the shell, as /api/me's own does.
test.each(["UNREACHABLE", "RATE_LIMITED", "INTERNAL"] as const)(
  "a %s from the admin list after /api/me's FORBIDDEN leaves the shell, not 'No household' (lg-22)",
  async (code) => {
    vi.mocked(fetchInbox).mockResolvedValue([]);
    vi.mocked(fetchMe).mockRejectedValue(new AppError("FORBIDDEN"));
    vi.mocked(fetchAdminHouseholds).mockRejectedValue(new AppError(code));

    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Screens" })).toBeTruthy();
    await waitFor(() => expect(vi.mocked(fetchAdminHouseholds)).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("heading", { name: "No household" })).toBeNull();
  },
);

// lg-33: the shell asks how each person is shown and every screen prints it; a
// rename made meanwhile is on the next tab opened.
test("the shell hands every screen the shown names, asked again on a change of tab (lg-33)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  vi.mocked(fetchRatios).mockResolvedValue({
    asOf: "2026-10-03",
    ratios: [],
    inEffect: {
      id: 1,
      effectiveFrom: "2025-01-01",
      shares: [
        { personId: "alex", partsPerMillion: 600_000, salaryId: 1 },
        { personId: "sam", partsPerMillion: 400_000, salaryId: 2 },
      ],
      supersedes: null,
      enteredAt: "2026-10-03T09:30:00.000Z",
      enteredBy: "alex",
    },
  });
  render(<App />);
  await waitFor(() => expect(vi.mocked(fetchPeopleNames)).toHaveBeenCalled());

  vi.mocked(fetchPeopleNames).mockResolvedValue({ alex: "Alex", sam: "sam" });
  fireEvent.click(screen.getByRole("button", { name: "Salaries" }));

  expect(
    await screen.findByText("Ratio in effect: Alex 60.0000 % · sam 40.0000 %, since 2025-01-01."),
  ).toBeTruthy();
  expect(screen.getByLabelText("Alex’s salary")).toBeTruthy();
});

// lg-41: after Period, a screen listing every bank row.
test("the history tab follows the period tab and shows the history screen (lg-41)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);

  const tabs = within(screen.getByRole("navigation", { name: "Screens" }))
    .getAllByRole("button")
    .map((button) => button.textContent);
  expect(tabs.indexOf("History")).toBe(tabs.indexOf("Period") + 1);
  fireEvent.click(screen.getByRole("button", { name: "History" }));

  expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  expect(await screen.findByText("0 rows match.")).toBeTruthy();
});

// lg-54: the count is asked again when a paste is stored, not only on the next tab.
test("the inbox tab's count changes when a paste is stored, with no change of tab (lg-54)", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);
  await screen.findByRole("button", { name: "Inbox" });
  fireEvent.click(screen.getByRole("button", { name: "Paste" }));
  fireEvent.change(screen.getByLabelText("Transactions copied from AccèsD"), {
    target: {
      value: [
        "Septembre 2026",
        "Date\tDescription\tMontant\tSolde\tlien",
        "12 SEP12 Septembre",
        "Loyer/Prêt hypothécaire",
        "Hypothèque /Prêteur Exemple",
        "",
        "−700,00 $\t2 100,00 $\t",
        "12 Septembre Hypothèque /Prêteur Exemple −700,00 $",
        "Total\t−700,00 $",
        "",
      ].join("\n"),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  vi.mocked(importStatement).mockResolvedValue({
    rowsAdded: 1,
    rowsAlreadyPresent: 0,
    tailBalanceCents: 210_000,
    rowsInInbox: 1,
  });
  vi.mocked(fetchInbox).mockResolvedValue([
    { ...WAITING, id: 1, description: "Hypothèque /Prêteur Exemple", amountCents: -70_000 },
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Confirm and store" }));

  expect(await screen.findByRole("button", { name: "Inbox (1)" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Statement stored" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Open the inbox" }));
  expect(await screen.findByRole("heading", { name: "Inbox" })).toBeTruthy();
});
