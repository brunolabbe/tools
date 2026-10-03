// @vitest-environment jsdom

/**
 * The rules screen (lg-4): add, edit and retire, with the other person's change
 * shown rather than overwritten. The fakes are the API client module.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { Rule } from "@ledger/contract";
import { createRule, editRule, fetchPeople, fetchRules, retireRule } from "../src/api/rules.ts";
import { Rules } from "../src/rules/Rules.tsx";

vi.mock("../src/api/rules.ts", () => ({
  fetchRules: vi.fn(),
  fetchPeople: vi.fn(),
  createRule: vi.fn(),
  editRule: vi.fn(),
  retireRule: vi.fn(),
}));

const rules = vi.mocked(fetchRules);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
});

afterEach(cleanup);

const TRANSFER: Rule = {
  id: 7,
  descriptionPattern: "Virement entre folios /Caisse du Lac",
  category: "Virements",
  amountCents: 40000,
  personId: "sam",
  bucket: "mortgage",
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
