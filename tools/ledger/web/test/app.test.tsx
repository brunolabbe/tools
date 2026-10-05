// @vitest-environment jsdom

/**
 * The shell's screens (lg-4, lg-5): the inbox tab carries the number of rows
 * waiting, so a paste that left some is not missed, each tab shows its own
 * screen, and the home screen is the first. The fakes are the API client modules.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InboxRow } from "@ledger/contract";
import { fetchBuckets } from "../src/api/buckets.ts";
import { fetchHealth } from "../src/api/health.ts";
import { fetchInbox } from "../src/api/inbox.ts";
import { fetchPeople, fetchRules } from "../src/api/rules.ts";
import { fetchRatios, fetchSalaries } from "../src/api/salaries.ts";
import { App } from "../src/App.tsx";

vi.mock("../src/api/health.ts", () => ({ fetchHealth: vi.fn() }));
vi.mock("../src/api/buckets.ts", () => ({ fetchBuckets: vi.fn() }));
vi.mock("../src/api/salaries.ts", () => ({
  fetchSalaries: vi.fn(),
  fetchRatios: vi.fn(),
  enterSalaries: vi.fn(),
  confirmRatio: vi.fn(),
}));
vi.mock("../src/api/inbox.ts", () => ({ fetchInbox: vi.fn(), classifyRow: vi.fn() }));
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
  });
  vi.mocked(fetchRules).mockResolvedValue([]);
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
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
