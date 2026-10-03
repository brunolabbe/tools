// @vitest-environment jsdom

/**
 * The shell's three screens (lg-4): the inbox tab carries the number of rows
 * waiting, so a paste that left some is not missed, and each tab shows its own
 * screen. The fakes are the API client modules.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InboxRow } from "@ledger/contract";
import { fetchHealth } from "../src/api/health.ts";
import { fetchInbox } from "../src/api/inbox.ts";
import { fetchPeople, fetchRules } from "../src/api/rules.ts";
import { App } from "../src/App.tsx";

vi.mock("../src/api/health.ts", () => ({ fetchHealth: vi.fn() }));
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

test("each tab shows its own screen, and the paste is the first", async () => {
  vi.mocked(fetchInbox).mockResolvedValue([]);
  render(<App />);
  expect(screen.getByRole("heading", { name: "Paste a statement" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Rules" }));
  expect(await screen.findByRole("heading", { name: "Rules" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Paste a statement" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
  expect(await screen.findByRole("heading", { name: "Inbox" })).toBeTruthy();
});
