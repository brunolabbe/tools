// @vitest-environment jsdom

/**
 * The history screen (lg-41): every bank row, searched, filtered and sorted by the
 * server. The fakes are the API client modules; every description and amount is
 * invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import type { ClosedPeriod, RowsQuery, StoredRow } from "@ledger/contract";
import { classifyRow } from "../src/api/inbox.ts";
import { fetchPeriods } from "../src/api/periods.ts";
import { fetchRows } from "../src/api/rows.ts";
import { fetchPeople } from "../src/api/rules.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import { History, closedPeriodOf } from "../src/history/History.tsx";

vi.mock("../src/api/rows.ts", () => ({ fetchRows: vi.fn() }));
vi.mock("../src/api/inbox.ts", () => ({ classifyRow: vi.fn() }));
vi.mock("../src/api/periods.ts", () => ({ fetchPeriods: vi.fn() }));
vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({ fetchSpendingCategories: vi.fn() }));

function row(id: number, description: string, amountCents: number, more: Partial<StoredRow> = {}) {
  return {
    id,
    date: "2026-09-20",
    category: "Épicerie",
    description,
    amountCents,
    balanceCents: 100000,
    classification: { bucket: "current-expenses", personId: null, source: "manual" },
    spendingCategory: { id: 1, source: "map" },
    ...more,
  } satisfies StoredRow;
}

/** What each call to the fake asked for, in order. */
function asked(): RowsQuery[] {
  return vi.mocked(fetchRows).mock.calls.map(([query]) => query);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSpendingCategories).mockResolvedValue([
    {
      id: 1,
      name: "Groceries",
      retired: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      createdBy: "migration",
    },
  ]);
  vi.mocked(fetchRows).mockResolvedValue({ rows: [], total: 0 });
  vi.mocked(fetchPeriods).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Fake timers that still advance with the clock (lg-69), so `waitFor` and
 * `findBy*` keep polling; the search's 300 ms pause is then crossed by
 * advancing it rather than waited out.
 */
function fakeClock(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

/** Lets the search's pause (`SEARCH_DELAY_MS`, 300) elapse inside `act`. */
async function pass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

test("a search and a sort reach the request, the list is what the server answered, and Show more asks for the next offset", async () => {
  fakeClock();
  const first = Array.from({ length: 50 }, (_, index) =>
    row(index + 1, `Marché ${String(index)}`, -100),
  );
  vi.mocked(fetchRows).mockResolvedValue({ rows: first, total: 52 });
  render(<History />);

  const list = await screen.findByRole("list", { name: "Bank rows" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(50);
  expect(screen.getByText("52 rows match.")).toBeTruthy();
  // Opening the screen asks for the first page and nothing narrows it.
  expect(asked()[0]).toEqual({ offset: 0, limit: 50 });

  vi.mocked(fetchRows).mockResolvedValue({
    rows: [row(70, "ÉPICERIE METRO", -2000), row(71, "iga extra", -1500)],
    total: 2,
  });
  fireEvent.change(screen.getByLabelText("Search the description"), {
    target: { value: "epicerie" },
  });
  fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "amount-asc" } });
  await pass(300);

  await waitFor(() => {
    expect(asked().at(-1)).toEqual({
      q: "epicerie",
      sort: "amount",
      order: "asc",
      offset: 0,
      limit: 50,
    });
  });
  const narrowed = await screen.findByRole("list", { name: "Bank rows" });
  expect(
    within(narrowed)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([expect.stringContaining("ÉPICERIE METRO"), expect.stringContaining("iga extra")]);
  expect(screen.getByText("2 rows match.")).toBeTruthy();

  // Back to a list of two pages: Show more asks for the offset after the rows shown.
  vi.mocked(fetchRows).mockResolvedValue({ rows: first, total: 52 });
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await screen.findByText("52 rows match.");
  vi.mocked(fetchRows).mockResolvedValue({
    rows: [row(90, "Dernier", -300), row(91, "Avant-dernier", -400)],
    total: 52,
  });
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));

  await waitFor(() => {
    expect(asked().at(-1)).toEqual({ offset: 50, limit: 50 });
  });
  const all = await screen.findByRole("list", { name: "Bank rows" });
  expect(within(all).getAllByRole("listitem")).toHaveLength(52);
  expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  expect(screen.getByText("52 of 52")).toBeTruthy();
});

test("each filter is sent as the query field the route takes", async () => {
  render(<History />);
  await screen.findByText("0 rows match.");
  await screen.findByRole("option", { name: "sam" });

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });
  fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "unfiled" } });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "joint" } });
  fireEvent.change(screen.getByLabelText("Spending category"), { target: { value: "none" } });
  fireEvent.change(screen.getByLabelText("Money"), { target: { value: "out" } });
  fireEvent.change(screen.getByLabelText("At least ($)"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("At most ($)"), { target: { value: "99.50" } });

  await waitFor(() => {
    expect(asked().at(-1)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      bucket: "unfiled",
      person: "joint",
      spendingCategory: "none",
      direction: "out",
      minCents: 1000,
      maxCents: 9950,
      offset: 0,
      limit: 50,
    });
  });
  fireEvent.change(screen.getByLabelText("Person"), { target: { value: "sam" } });
  fireEvent.change(screen.getByLabelText("Spending category"), { target: { value: "1" } });
  await waitFor(() => {
    expect(asked().at(-1)).toMatchObject({ person: "sam", spendingCategory: 1 });
  });
});

test("the search waits for a pause in typing, and a filter change drops the request in flight", async () => {
  fakeClock();
  const late: { release?: (value: { rows: StoredRow[]; total: number }) => void } = {};
  let aborted = false;
  vi.mocked(fetchRows).mockImplementationOnce(
    (_query, signal) =>
      new Promise((resolve) => {
        late.release = resolve;
        signal?.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  );
  render(<History />);
  await waitFor(() => expect(asked()).toHaveLength(1));

  fireEvent.change(screen.getByLabelText("Money"), { target: { value: "in" } });
  await waitFor(() => expect(asked()).toHaveLength(2));
  expect(aborted).toBe(true);
  // The old answer arriving late changes nothing.
  expect(late.release).toBeDefined();
  late.release?.({ rows: [row(5, "Réponse tardive", -100)], total: 1 });
  await screen.findByText("0 rows match.");
  expect(screen.queryByText("Réponse tardive")).toBeNull();

  fireEvent.change(screen.getByLabelText("Search the description"), { target: { value: "i" } });
  fireEvent.change(screen.getByLabelText("Search the description"), { target: { value: "ig" } });
  fireEvent.change(screen.getByLabelText("Search the description"), { target: { value: "iga" } });
  expect(asked()).toHaveLength(2);
  // Three keystrokes, one request once the pause is over. (Not a 299 then a 1:
  // `shouldAdvanceTime` also moves the clock by real time, which a loaded
  // machine makes more than the tick.)
  await pass(300);
  await waitFor(() => expect(asked()).toHaveLength(3));
  expect(asked().at(-1)).toMatchObject({ q: "iga", direction: "in" });
});

test("shows each row's date, amount, bucket, person and spending category, and Clear filters empties every control", async () => {
  vi.mocked(fetchRows).mockResolvedValue({
    rows: [
      row(1, "Virement Sam", 40000, {
        classification: { bucket: "mortgage", personId: "sam", source: "manual" },
        spendingCategory: null,
      }),
      row(2, "Café du coin", -500, { classification: null, spendingCategory: null }),
    ],
    total: 2,
  });
  render(<History />);

  const list = await screen.findByRole("list", { name: "Bank rows" });
  const [credit, unfiled] = within(list).getAllByRole("listitem");
  expect(credit?.textContent).toContain("2026-09-20");
  expect(credit?.textContent).toContain("400.00 $");
  expect(credit?.textContent).toContain("sam · Mortgage");
  expect(credit?.textContent).toContain("No spending category");
  expect(unfiled?.textContent).toContain("-5.00 $");
  expect(unfiled?.textContent).toContain("Not filed yet");

  fireEvent.change(screen.getByLabelText("Money"), { target: { value: "in" } });
  fireEvent.change(screen.getByLabelText("Search the description"), { target: { value: "sam" } });
  fireEvent.click(await screen.findByRole("button", { name: "Clear filters" }));

  expect((screen.getByLabelText("Money") as HTMLSelectElement).value).toBe("");
  expect((screen.getByLabelText("Search the description") as HTMLInputElement).value).toBe("");
  await waitFor(() => expect(asked().at(-1)).toEqual({ offset: 0, limit: 50 }));
  expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
});

test("a bound that is not an amount, or that crosses, is said and not sent", async () => {
  render(<History />);
  await screen.findByText("0 rows match.");
  const before = asked().length;

  fireEvent.change(screen.getByLabelText("At least ($)"), { target: { value: "abc" } });
  expect((await screen.findByRole("alert")).textContent).toContain("amount like 12.50");
  fireEvent.change(screen.getByLabelText("At least ($)"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("At most ($)"), { target: { value: "20" } });
  expect((await screen.findByRole("alert")).textContent).toContain("above the largest");
  expect(asked()).toHaveLength(before + 1);
});

test("a failed read is said in the taxonomy's words", async () => {
  vi.mocked(fetchRows).mockRejectedValue(
    new AppError("UNREACHABLE", "The ledger API is not answering."),
  );
  render(<History />);

  expect((await screen.findByRole("alert")).textContent).toContain("not answering");
});

test("a Show more answer that arrives after a filter change is not appended to the new list", async () => {
  fakeClock();
  const first = Array.from({ length: 50 }, (_, index) =>
    row(index + 1, `Marché ${String(index)}`, -100),
  );
  const late: { release?: (value: { rows: StoredRow[]; total: number }) => void } = {};
  let aborted = false;
  vi.mocked(fetchRows)
    .mockResolvedValueOnce({ rows: first, total: 52 })
    .mockImplementationOnce(
      (_query, signal) =>
        new Promise((resolve) => {
          late.release = resolve;
          signal?.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    )
    .mockResolvedValue({ rows: [row(80, "Seule réponse", 700), row(81, "Autre", 800)], total: 2 });
  render(<History />);
  await screen.findByText("52 rows match.");

  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  await waitFor(() => expect(asked().at(-1)).toEqual({ offset: 50, limit: 50 }));

  // The filter changes while the further page is still on its way.
  fireEvent.change(screen.getByLabelText("Money"), { target: { value: "in" } });
  await screen.findByText("2 rows match.");
  expect(aborted).toBe(true);

  // The old filter's page arriving now must not be added to the new filter's list.
  expect(late.release).toBeDefined();
  late.release?.({ rows: [row(90, "Réponse tardive", -300)], total: 52 });
  // Let the late answer settle and render, if it were going to.
  await pass(20);
  expect(screen.queryByText("Réponse tardive")).toBeNull();
  expect(screen.getByText("2 rows match.")).toBeTruthy();
  const list = screen.getByRole("list", { name: "Bank rows" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(2);
});

// lg-95: a row a person already answered can be filed again, from the history.

/** A closed period as the API lists it; only the span matters to this screen. */
function closed(start: string | null, end: string): ClosedPeriod {
  return { id: 1, start, end } as ClosedPeriod;
}

test("a row answered by a person is filed again from the history, the list is read again, and no undo is offered (lg-95)", async () => {
  vi.mocked(fetchRows)
    .mockResolvedValueOnce({
      rows: [
        row(7, "Virement Sam", 40000, {
          classification: { bucket: "current-expenses", personId: "alex", source: "manual" },
        }),
      ],
      total: 1,
    })
    .mockResolvedValue({
      rows: [
        row(7, "Virement Sam", 40000, {
          classification: { bucket: "mortgage", personId: "sam", source: "manual" },
        }),
      ],
      total: 1,
    });
  vi.mocked(classifyRow).mockResolvedValue({
    id: 9,
    rowId: 7,
    bucket: "mortgage",
    personId: "sam",
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-11-01T00:00:00.000Z",
    classifiedBy: "alex",
  });
  render(<History />);

  const item = (await screen.findByRole("list", { name: "Bank rows" })).querySelector("li");
  if (item === null) throw new Error("no row listed");
  expect(item.textContent).toContain("alex · Current expenses");
  expect(item.textContent).toContain("answered by a person");

  fireEvent.click(within(item).getByRole("button", { name: "Change who and what" }));
  fireEvent.change(within(item).getByLabelText("Belongs to"), { target: { value: "sam" } });
  fireEvent.change(within(item).getByLabelText("Bucket"), { target: { value: "mortgage" } });
  fireEvent.click(within(item).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(classifyRow).toHaveBeenCalledTimes(1));
  expect(classifyRow).toHaveBeenCalledWith({ rowId: 7, personId: "sam", bucket: "mortgage" });
  // The list is what the server answered the second time, not the first one patched.
  await waitFor(() => expect(asked()).toHaveLength(2));
  expect(asked().at(-1)).toEqual({ offset: 0, limit: 50 });
  const list = screen.getByRole("list", { name: "Bank rows" });
  await waitFor(() => expect(list.textContent).toContain("sam · Mortgage"));
  expect(list.textContent).not.toContain("alex · Current expenses");
  // A row in the open period is not told anything about a close.
  expect(screen.getByRole("status").textContent).toBe("Virement Sam is now sam · Mortgage.");
  // The earlier answer is kept by the API; the screen offers no way to take this one back.
  expect(screen.queryByRole("button", { name: /undo|revert|restore/iu })).toBeNull();
  expect(screen.queryByRole("group")).toBeNull();
});

test("a row in a closed period says what the change reaches, and the next close carries it (lg-95)", async () => {
  vi.mocked(fetchPeriods).mockResolvedValue([closed(null, "2026-09-30")]);
  vi.mocked(fetchRows).mockResolvedValue({
    rows: [
      row(1, "Old row", -2500, { date: "2026-09-20" }),
      row(2, "New row", -900, { date: "2026-10-04" }),
    ],
    total: 2,
  });
  vi.mocked(classifyRow).mockResolvedValue({
    id: 9,
    rowId: 1,
    bucket: "mortgage",
    personId: null,
    ruleId: null,
    source: "manual",
    classifiedAt: "2026-11-01T00:00:00.000Z",
    classifiedBy: "alex",
  });
  render(<History />);

  const [old, recent] = within(await screen.findByRole("list", { name: "Bank rows" })).getAllByRole(
    "listitem",
  );
  if (old === undefined || recent === undefined) throw new Error("two rows expected");

  fireEvent.click(within(recent).getByRole("button", { name: "Change who and what" }));
  expect(within(recent).queryByText(/closed period/u)).toBeNull();
  fireEvent.click(within(recent).getByRole("button", { name: "Cancel" }));

  fireEvent.click(within(old).getByRole("button", { name: "Change who and what" }));
  const said = within(old).getByText(/closed period/u).textContent;
  expect(said).toContain("from the first row to 2026-09-30");
  expect(said).toContain("recorded for it stays as it was paid");
  expect(said).toContain("the next close carries the correction");

  fireEvent.change(within(old).getByLabelText("Bucket"), { target: { value: "mortgage" } });
  fireEvent.click(within(old).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(classifyRow).toHaveBeenCalledWith({ rowId: 1, personId: null, bucket: "mortgage" }),
  );
  expect((await screen.findByRole("status")).textContent).toBe(
    "Old row is now Joint · Mortgage. The next close will carry this correction.",
  );
});

test("a refused change is said and leaves the control open (lg-95)", async () => {
  vi.mocked(fetchRows).mockResolvedValue({ rows: [row(1, "Épicerie", -500)], total: 1 });
  vi.mocked(classifyRow).mockRejectedValue(new AppError("UNREACHABLE", "The ledger API is down."));
  render(<History />);

  fireEvent.click(await screen.findByRole("button", { name: "Change who and what" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect((await screen.findByRole("alert")).textContent).toContain("down");
  expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  expect(asked()).toHaveLength(1);
});

test("a row not filed yet is not offered a change here; the inbox files it (lg-95)", async () => {
  vi.mocked(fetchRows).mockResolvedValue({
    rows: [row(1, "Café du coin", -500, { classification: null })],
    total: 1,
  });
  render(<History />);

  await screen.findByText("Café du coin");
  expect(screen.queryByRole("button", { name: "Change who and what" })).toBeNull();
});

test("closedPeriodOf holds a period's first and last day, and the first period has no start (lg-95)", () => {
  const periods = [closed("2026-10-01", "2026-10-31"), closed(null, "2026-09-30")];
  expect(closedPeriodOf("2026-09-30", periods)?.end).toBe("2026-09-30");
  expect(closedPeriodOf("2026-10-01", periods)?.end).toBe("2026-10-31");
  expect(closedPeriodOf("2026-10-31", periods)?.end).toBe("2026-10-31");
  expect(closedPeriodOf("2000-01-01", periods)?.end).toBe("2026-09-30");
  expect(closedPeriodOf("2026-11-01", periods)).toBeNull();
  expect(closedPeriodOf("2026-11-01", [])).toBeNull();
});
