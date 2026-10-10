// @vitest-environment jsdom

/**
 * The inbox's promises (lg-4): a suggestion is taken in one tap, an answer of the
 * person's own can be offered back as a rule, and a refusal says what the server
 * said. Like the paste screen's, the fakes are the API client modules and never
 * `fetch`, so no route shape is restated here.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { InboxRow, Rule, SpendingCategory } from "@ledger/contract";
import { classifyRow, fetchInbox } from "../src/api/inbox.ts";
import { createRule, fetchPeople } from "../src/api/rules.ts";
import { fetchSpendingCategories, setRowSpendingCategory } from "../src/api/spending.ts";
import { Inbox } from "../src/inbox/Inbox.tsx";

vi.mock("../src/api/inbox.ts", () => ({ fetchInbox: vi.fn(), classifyRow: vi.fn() }));
vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn(), createRule: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({
  fetchSpendingCategories: vi.fn(),
  setRowSpendingCategory: vi.fn(),
}));

const inbox = vi.mocked(fetchInbox);
const classified = vi.mocked(classifyRow);
const created = vi.mocked(createRule);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSpendingCategories).mockResolvedValue(CATEGORIES);
});

afterEach(cleanup);

function category(id: number, name: string): SpendingCategory {
  return {
    id,
    name,
    retired: false,
    createdAt: "2026-10-01T00:00:00.000Z",
    createdBy: "migration",
  };
}

const CATEGORIES = [category(1, "Groceries"), category(4, "Pharmacy")];

const RULE: Rule = {
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

/** A transfer that is not the rule's usual amount, with that rule suggested. */
const ODD: InboxRow = {
  id: 11,
  date: "2026-09-14",
  category: "Virements",
  description: "Virement entre folios /Caisse du Lac",
  amountCents: 45000,
  balanceCents: 123456,
  reason: "differs",
  suggestion: RULE,
  history: null,
  spendingCategory: null,
  matching: [],
};

/** A row no rule is near. */
const GROCERIES: InboxRow = {
  id: 12,
  date: "2026-09-20",
  category: "Épicerie",
  description: "Achat /Marché Exemple",
  amountCents: -12345,
  balanceCents: 111111,
  reason: "no-rule",
  suggestion: null,
  history: null,
  spendingCategory: null,
  matching: [],
};

function rowOf(description: string): HTMLElement {
  const item = screen.getByText(description).closest("li");
  if (item === null) throw new Error(`no row for ${description}`);
  return item;
}

test("shows each waiting row with why it is there and the nearest rule suggested", async () => {
  inbox.mockResolvedValue([ODD, GROCERIES]);

  render(<Inbox />);

  const odd = within(await waitFor(() => rowOf(ODD.description)));
  expect(odd.getByText(/not the category or the amount/u)).toBeTruthy();
  expect(odd.getByText("sam · Mortgage")).toBeTruthy();
  expect(odd.getByText(/400\.00 \$/u)).toBeTruthy();
  // The row with nothing near it offers no suggestion, only the answer.
  expect(within(rowOf(GROCERIES.description)).queryByRole("button", { name: "Accept" })).toBeNull();
  expect(
    within(rowOf(GROCERIES.description)).getByRole("button", { name: "Classify" }),
  ).toBeTruthy();
});

test("accepting a suggestion sends its rule and the row leaves the inbox", async () => {
  inbox.mockResolvedValue([ODD, GROCERIES]);
  classified.mockResolvedValue({
    id: 1,
    rowId: ODD.id,
    bucket: "mortgage",
    personId: "sam",
    ruleId: RULE.id,
    source: "accepted",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "alex",
  });
  const onCount = vi.fn();
  render(<Inbox onCount={onCount} />);
  await waitFor(() => rowOf(ODD.description));

  fireEvent.click(within(rowOf(ODD.description)).getByRole("button", { name: "Accept" }));

  await waitFor(() => expect(screen.queryByText(ODD.description)).toBeNull());
  expect(classified).toHaveBeenCalledTimes(1);
  expect(classified).toHaveBeenCalledWith({ rowId: ODD.id, ruleId: RULE.id });
  // The other row is still waiting, and the count says so.
  expect(screen.getByText(GROCERIES.description)).toBeTruthy();
  expect(onCount).toHaveBeenLastCalledWith(1);
  // An accepted rule already exists, so nothing offers to make another.
  expect(screen.queryByRole("group", { name: "Make a rule from this answer" })).toBeNull();
});

test("answering with a person and a bucket, then taking the offer, creates a rule from the row", async () => {
  inbox.mockResolvedValue([GROCERIES]);
  classified.mockResolvedValue({
    id: 2,
    rowId: GROCERIES.id,
    bucket: "current-expenses",
    personId: null,
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "alex",
  });
  created.mockResolvedValue({ ...RULE, id: 8 });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));

  const row = within(rowOf(GROCERIES.description));
  fireEvent.change(row.getByLabelText("Bucket"), { target: { value: "current-expenses" } });
  fireEvent.click(row.getByRole("button", { name: "Classify" }));

  // Joint is the answer when no person is picked.
  await waitFor(() =>
    expect(classified).toHaveBeenCalledWith({
      rowId: GROCERIES.id,
      personId: null,
      bucket: "current-expenses",
    }),
  );
  const offer = within(await screen.findByRole("group", { name: "Make a rule from this answer" }));
  // The form is filled in from the row, amount included.
  expect(offer.getByLabelText<HTMLInputElement>("Description").value).toBe(GROCERIES.description);
  expect(offer.getByLabelText<HTMLInputElement>("Bank category").value).toBe("Épicerie");
  expect(offer.getByLabelText<HTMLInputElement>("Exact amount").value).toBe("-123.45 $");

  inbox.mockResolvedValue([]);
  fireEvent.click(offer.getByRole("button", { name: "Create rule" }));

  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(created).toHaveBeenCalledWith({
    descriptionPattern: GROCERIES.description,
    category: "Épicerie",
    amountCents: -12345,
    personId: null,
    bucket: "current-expenses",
    spendingCategoryId: null,
  });
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Rule added"));
  expect(screen.queryByRole("group", { name: "Make a rule from this answer" })).toBeNull();
});

test("the offered rule can be loosened before it is created", async () => {
  inbox.mockResolvedValue([GROCERIES]);
  classified.mockResolvedValue({
    id: 2,
    rowId: GROCERIES.id,
    bucket: "mortgage",
    personId: "alex",
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "alex",
  });
  created.mockResolvedValue({ ...RULE, id: 8 });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));
  const row = within(rowOf(GROCERIES.description));
  fireEvent.change(row.getByLabelText("Belongs to"), { target: { value: "alex" } });
  fireEvent.change(row.getByLabelText("Bucket"), { target: { value: "mortgage" } });
  fireEvent.click(row.getByRole("button", { name: "Classify" }));
  const offer = within(await screen.findByRole("group", { name: "Make a rule from this answer" }));

  fireEvent.change(offer.getByLabelText("Description"), { target: { value: "Achat /Marché*" } });
  fireEvent.change(offer.getByLabelText("Exact amount"), { target: { value: "" } });
  fireEvent.click(offer.getByRole("button", { name: "Create rule" }));

  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(created).toHaveBeenCalledWith({
    descriptionPattern: "Achat /Marché*",
    category: "Épicerie",
    amountCents: null,
    personId: "alex",
    bucket: "mortgage",
    spendingCategoryId: null,
  });
});

test("declining the offer creates nothing", async () => {
  inbox.mockResolvedValue([GROCERIES]);
  classified.mockResolvedValue({
    id: 2,
    rowId: GROCERIES.id,
    bucket: "current-expenses",
    personId: null,
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "alex",
  });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));
  fireEvent.click(within(rowOf(GROCERIES.description)).getByRole("button", { name: "Classify" }));
  const offer = within(await screen.findByRole("group", { name: "Make a rule from this answer" }));

  fireEvent.click(offer.getByRole("button", { name: "No thanks" }));

  expect(screen.queryByRole("group", { name: "Make a rule from this answer" })).toBeNull();
  expect(created).not.toHaveBeenCalled();
});

test("a rule changed by someone else is refused in the server's words and the list is reloaded", async () => {
  const message = "There is no such rule in force. It may have been changed or retired.";
  inbox.mockResolvedValue([ODD]);
  classified.mockRejectedValue(new AppError("RULE_NOT_FOUND", message));
  render(<Inbox />);
  await waitFor(() => rowOf(ODD.description));
  inbox.mockResolvedValue([{ ...ODD, suggestion: null, reason: "no-rule" }]);

  fireEvent.click(within(rowOf(ODD.description)).getByRole("button", { name: "Accept" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
  // Reloaded: the stale suggestion is gone and the row is still waiting.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Accept" })).toBeNull());
  expect(screen.getByText(ODD.description)).toBeTruthy();
  expect(inbox).toHaveBeenCalledTimes(2);
});

test("names every rule that matched, when more than one did", async () => {
  const other: Rule = { ...RULE, id: 9, descriptionPattern: "Virement*", amountCents: null };
  inbox.mockResolvedValue([
    { ...ODD, reason: "ambiguous", amountCents: 40000, matching: [RULE, other], suggestion: RULE },
  ]);

  render(<Inbox />);

  const list = within(await screen.findByRole("list", { name: "Rules that match" }));
  expect(list.getAllByRole("listitem")).toHaveLength(2);
  expect(
    screen.getByText(
      /Equally specific rules match this with different answers, so none was applied/u,
    ),
  ).toBeTruthy();
});

test("an empty inbox says so", async () => {
  inbox.mockResolvedValue([]);

  render(<Inbox />);

  expect(await screen.findByText(/Nothing is waiting/u)).toBeTruthy();
});

test("an inbox that cannot be loaded says what the server said", async () => {
  inbox.mockRejectedValue(new AppError("UNREACHABLE", "The ledger API is not answering."));

  render(<Inbox />);

  expect((await screen.findByRole("alert")).textContent).toBe("The ledger API is not answering.");
});

// lg-16: what a person answered before, beside the rule's suggestion.

test("shows what was answered before, and taking it stores that person and bucket", async () => {
  inbox.mockResolvedValue([
    { ...GROCERIES, history: { personId: "alex", bucket: "mortgage", times: 3 } },
  ]);
  classified.mockResolvedValue({
    id: 4,
    rowId: GROCERIES.id,
    bucket: "mortgage",
    personId: "alex",
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "sam",
  });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));
  const row = within(rowOf(GROCERIES.description));
  expect(row.getByText(/alex · Mortgage, the last 3 times/u)).toBeTruthy();

  fireEvent.click(row.getByRole("button", { name: "Use this answer" }));

  // A manual answer, not a rule accepted: no rule id goes with it.
  await waitFor(() =>
    expect(classified).toHaveBeenCalledWith({
      rowId: GROCERIES.id,
      personId: "alex",
      bucket: "mortgage",
    }),
  );
  // The row left the list; the rule offer shows its description once, inside the form.
  await screen.findByRole("group", { name: "Make a rule from this answer" });
  expect(screen.queryByRole("list", { name: "Rows to classify" })?.textContent).toBe("");
});

test("a history answer that agrees with the rule's suggestion is one control, not two", async () => {
  inbox.mockResolvedValue([{ ...ODD, history: { personId: "sam", bucket: "mortgage", times: 2 } }]);
  render(<Inbox />);
  await waitFor(() => rowOf(ODD.description));
  const row = within(rowOf(ODD.description));

  expect(row.getByText(/Answered sam · Mortgage, the last 2 times/u)).toBeTruthy();
  expect(row.getAllByRole("button", { name: /Accept|Use this answer/u })).toHaveLength(1);
  expect(row.getByRole("button", { name: "Accept" })).toBeTruthy();
});

test("a history answer that differs from the suggestion is offered beside it", async () => {
  inbox.mockResolvedValue([
    { ...ODD, history: { personId: "alex", bucket: "current-expenses", times: 1 } },
  ]);
  render(<Inbox />);
  await waitFor(() => rowOf(ODD.description));
  const row = within(rowOf(ODD.description));

  expect(row.getByText("sam · Mortgage")).toBeTruthy();
  expect(row.getByText(/alex · Current expenses, last time/u)).toBeTruthy();
  expect(row.getByRole("button", { name: "Accept" })).toBeTruthy();
  expect(row.getByRole("button", { name: "Use this answer" })).toBeTruthy();
});

// A row's spending category (lg-15), shown where the row is and set there.
test("a row shows its spending category and where it came from, and keeps its place", async () => {
  inbox.mockResolvedValue([
    { ...GROCERIES, spendingCategory: { id: 1, source: "map" } },
    { ...ODD, spendingCategory: null },
  ]);
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));

  const groceries = within(rowOf(GROCERIES.description));
  const select = groceries.getByLabelText<HTMLSelectElement>(
    `Spending category for ${GROCERIES.description}`,
  );
  expect(select.value).toBe("1");
  expect(groceries.getByText("from the bank's category")).toBeTruthy();
  // A row with none says so, and a category never takes it out of the inbox.
  const odd = within(rowOf(ODD.description));
  expect(
    odd.getByLabelText<HTMLSelectElement>(`Spending category for ${ODD.description}`).value,
  ).toBe("");
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
});

test("choosing another writes the row's own, and the row stays in the inbox", async () => {
  inbox.mockResolvedValue([{ ...GROCERIES, spendingCategory: { id: 1, source: "map" } }]);
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: GROCERIES.id,
    spendingCategory: { id: 4, source: "override" },
  });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));
  const label = `Spending category for ${GROCERIES.description}`;

  fireEvent.change(within(rowOf(GROCERIES.description)).getByLabelText(label), {
    target: { value: "4" },
  });

  await waitFor(() => expect(setRowSpendingCategory).toHaveBeenCalledWith(GROCERIES.id, 4));
  await waitFor(() =>
    expect(
      within(rowOf(GROCERIES.description)).getByLabelText<HTMLSelectElement>(label).value,
    ).toBe("4"),
  );
  expect(within(rowOf(GROCERIES.description)).getByText("set on this row")).toBeTruthy();
  expect(classified).not.toHaveBeenCalled();
});

test("withdrawing the row's own choice writes a null, and a row with none of its own writes nothing", async () => {
  inbox.mockResolvedValue([
    { ...GROCERIES, spendingCategory: { id: 4, source: "override" } },
    { ...ODD, spendingCategory: { id: 1, source: "map" } },
  ]);
  vi.mocked(setRowSpendingCategory).mockResolvedValue({
    rowId: GROCERIES.id,
    spendingCategory: null,
  });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));

  // Nothing of its own to withdraw on the mapped row: choosing "no choice" is a no-op.
  fireEvent.change(
    within(rowOf(ODD.description)).getByLabelText(`Spending category for ${ODD.description}`),
    { target: { value: "" } },
  );
  expect(setRowSpendingCategory).not.toHaveBeenCalled();

  fireEvent.change(
    within(rowOf(GROCERIES.description)).getByLabelText(
      `Spending category for ${GROCERIES.description}`,
    ),
    { target: { value: "" } },
  );

  await waitFor(() => expect(setRowSpendingCategory).toHaveBeenCalledWith(GROCERIES.id, null));
});

test("the rule offered from an answer can name a spending category", async () => {
  inbox.mockResolvedValue([GROCERIES]);
  classified.mockResolvedValue({
    id: 2,
    rowId: GROCERIES.id,
    bucket: "current-expenses",
    personId: null,
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-10-03T09:30:00.000Z",
    classifiedBy: "alex",
  });
  created.mockResolvedValue({ ...RULE, id: 9 });
  render(<Inbox />);
  await waitFor(() => rowOf(GROCERIES.description));
  fireEvent.click(within(rowOf(GROCERIES.description)).getByRole("button", { name: "Classify" }));
  const offer = within(await screen.findByRole("group", { name: "Make a rule from this answer" }));

  fireEvent.change(offer.getByLabelText("Spending category"), { target: { value: "1" } });
  inbox.mockResolvedValue([]);
  fireEvent.click(offer.getByRole("button", { name: "Create rule" }));

  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(created).toHaveBeenCalledWith(expect.objectContaining({ spendingCategoryId: 1 }));
});
