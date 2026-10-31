// @vitest-environment jsdom

/**
 * The import screen (lg-66). The fakes are the API client module; the describe
 * response is the one the API gives for lg-38's `lg37` fixture, kept in
 * `fixtures/lg37-describe.json` and held to the API's own answer by
 * `api/test/workbook-describe.test.ts`. Every name and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { formatCents } from "@ledger/books";
import type { DescribeWorkbookResponse } from "@ledger/contract";
import type * as WorkbookApi from "../src/api/workbook.ts";
import { confirmWorkbook, describeWorkbook } from "../src/api/workbook.ts";
import { ImportWorkbook } from "../src/import/ImportWorkbook.tsx";
import CSV_BALANCE from "./fixtures/csv-balance-describe.json" with { type: "json" };
import LG37 from "./fixtures/lg37-describe.json" with { type: "json" };

vi.mock("../src/api/workbook.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkbookApi>()),
  describeWorkbook: vi.fn(),
  confirmWorkbook: vi.fn(),
}));

/** As the API answered it: lg37 carries money into its first year, so it does not pass. */
const REFUSED = LG37 as DescribeWorkbookResponse;
/** The same reading, as if every verification had held. */
const HOLDS: DescribeWorkbookResponse = { ...REFUSED, ok: true, problems: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(describeWorkbook).mockResolvedValue(REFUSED);
  vi.mocked(confirmWorkbook).mockResolvedValue({
    kind: "xlsx",
    report: "Importing the workbook.\nWritten.\n",
  });
});

afterEach(cleanup);

/** Chooses a file of these bytes under this name. */
async function choose(name = "classeur.xlsx", bytes = [0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  fireEvent.change(input, { target: { files: [new File([new Uint8Array(bytes)], name)] } });
  await screen.findByText("File chosen. Nothing has been sent.");
}

async function describeIt(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Send the samples and describe" }));
  await screen.findByRole("heading", { name: "The date of each row" });
}

test("says what leaves the house before the button, and sends nothing until it is pressed", async () => {
  render(<ImportWorkbook />);
  await choose();

  const note = screen.getByRole("note", { name: "What is sent" });
  expect(note.textContent).toContain("the names of its sheets");
  expect(note.textContent).toContain("its first 12 rows, 6 rows from the middle and its last 3");
  expect(note.textContent).toContain("Nothing else leaves the house.");
  expect(describeWorkbook).not.toHaveBeenCalled();

  await describeIt();
  expect(describeWorkbook).toHaveBeenCalledTimes(1);
  expect(describeWorkbook).toHaveBeenCalledWith(btoa("PK\u0003\u0004\u0001\u0002\u0003"));
});

test("shows the date column's letter, its header and the 3 oldest and 3 newest dates", async () => {
  render(<ImportWorkbook />);
  await choose();
  await describeIt();

  const card = screen.getByRole("heading", { name: "The date of each row" }).closest("section");
  if (card === null) throw new Error("no date card");
  expect(card.textContent).toContain("Read from column B, headed “Date”.");
  const oldest = within(screen.getByRole("list", { name: "The oldest rows read" }));
  const newest = within(screen.getByRole("list", { name: "The newest rows read" }));
  expect(oldest.getAllByRole("listitem")).toHaveLength(3);
  expect(newest.getAllByRole("listitem")).toHaveLength(3);
  for (const row of REFUSED.confirmation.dateColumn.oldest) {
    expect(oldest.getAllByText(row.date).length).toBeGreaterThan(0);
  }
  for (const row of REFUSED.confirmation.dateColumn.newest) {
    expect(newest.getAllByText(row.date).length).toBeGreaterThan(0);
  }
  expect(newest.getByText("Paiement prêt")).toBeTruthy();
});

test("shows each bucket label with its bucket, its row count and 3 of its rows", async () => {
  render(<ImportWorkbook />);
  await choose();
  await describeIt();

  expect(REFUSED.confirmation.buckets).toHaveLength(2);
  for (const entry of REFUSED.confirmation.buckets) {
    const bucket = entry.bucket === "mortgage" ? "Mortgage" : "Current expenses";
    expect(screen.getByRole("heading", { name: `“${entry.label}” → ${bucket}` })).toBeTruthy();
    expect(screen.getByText(`${String(entry.rows)} rows`)).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: `Rows labelled ${entry.label}` }));
    expect(rows.getAllByRole("listitem")).toHaveLength(3);
    for (const example of entry.examples) {
      expect(rows.getAllByText(formatCents(example.amountCents)).length).toBeGreaterThan(0);
    }
  }
});

test("has no confirm control when a verification fails, and shows what failed", async () => {
  render(<ImportWorkbook />);
  await choose();
  await describeIt();

  expect(screen.queryByRole("button", { name: "Confirm and import" })).toBeNull();
  const failed = within(screen.getByRole("list", { name: "What failed" }));
  expect(failed.getAllByRole("listitem")).toHaveLength(REFUSED.problems.length);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

test("has a confirm control when every verification holds, which sends the file and the description", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(HOLDS);
  render(<ImportWorkbook />);
  await choose();
  await describeIt();

  fireEvent.click(screen.getByRole("button", { name: "Confirm and import" }));

  await screen.findByText("The workbook was imported.");
  expect(confirmWorkbook).toHaveBeenCalledWith(
    btoa("PK\u0003\u0004\u0001\u0002\u0003"),
    HOLDS.layout,
  );
  expect(describeWorkbook).toHaveBeenCalledTimes(1);
});

test("Cancel writes nothing and goes back to choosing a file", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(HOLDS);
  render(<ImportWorkbook />);
  await choose();
  await describeIt();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await screen.findByText("Choose an .xlsx workbook or a CSV");
  expect(confirmWorkbook).not.toHaveBeenCalled();
});

test("a file's name decides nothing: one named .csv is sent, for the server to judge its bytes", async () => {
  render(<ImportWorkbook />);
  await choose("releve.csv");
  await describeIt();
  await waitFor(() => expect(describeWorkbook).toHaveBeenCalledTimes(1));
});

// --- lg-67: a bank CSV through the same screen ---

/**
 * What the API answers for csv-balance into empty books, kept in
 * `fixtures/csv-balance-describe.json` and held to the API's own answer by
 * `api/test/csv-import.test.ts`.
 */
const CSV = CSV_BALANCE as DescribeWorkbookResponse;
const CSV_TEXT = "Date,Description,Retrait,Dépôt,Solde\n2024-01-02,DEPOT PAIE,,1823.45,4335.55\n";

function csvBytes(): number[] {
  return [...new TextEncoder().encode(CSV_TEXT)];
}

function asCsv(change: Partial<Extract<DescribeWorkbookResponse, { kind: "csv" }>>) {
  if (CSV.kind !== "csv") throw new Error("the CSV fixture is not a CSV's answer");
  return { ...CSV, ...change };
}

test("csv: the statement says a CSV is sent as statement.csv and never under its name, before the button", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(CSV);
  render(<ImportWorkbook />);
  await choose("zq7tok-releve.csv", csvBytes());

  const note = screen.getByRole("note", { name: "What is sent" });
  expect(note.textContent).toContain("A CSV is one sheet, sent under the name statement.csv");
  expect(note.textContent).toContain("never the file’s name");
  expect(note.textContent).toContain("its first 12 rows, 6 rows from the middle and its last 3");
  expect(describeWorkbook).not.toHaveBeenCalled();

  await describeIt();
  expect(describeWorkbook).toHaveBeenCalledTimes(1);
  // The bytes, and nothing else: the file's name is not among what is sent.
  const sent = vi.mocked(describeWorkbook).mock.calls[0] ?? [];
  expect(sent).toEqual([btoa(String.fromCharCode(...csvBytes()))]);
  expect(JSON.stringify(sent)).not.toContain("zq7tok");
});

test("csv: shows the date column's letter, header and 3 + 3 dates with detail and amount, and no bucket section", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(CSV);
  render(<ImportWorkbook />);
  await choose("releve.csv", csvBytes());
  await describeIt();

  const card = screen.getByRole("heading", { name: "The date of each row" }).closest("section");
  expect(card?.textContent).toContain("Read from column A, headed “Date”.");
  for (const [label, rows] of [
    ["The oldest rows read", CSV.confirmation.dateColumn.oldest],
    ["The newest rows read", CSV.confirmation.dateColumn.newest],
  ] as const) {
    const list = within(screen.getByRole("list", { name: label }));
    const items = list.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const [index, row] of rows.entries()) {
      expect(items[index]?.textContent).toContain(row.date);
      expect(items[index]?.textContent).toContain(row.detail);
      expect(items[index]?.textContent).toContain(formatCents(row.amountCents));
    }
  }
  expect(CSV.confirmation.buckets).toEqual([]);
  expect(screen.queryByRole("heading", { name: "Which bucket each label files in" })).toBeNull();
});

test("csv: the first import says so, and offers Confirm, which reports the rows stored and waiting", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(CSV);
  vi.mocked(confirmWorkbook).mockResolvedValue({
    kind: "csv",
    report: "Storing the CSV's rows.\nWritten.\n",
    rowsAdded: 40,
    rowsInInbox: 33,
    tailBalanceCents: 512_345,
  });
  render(<ImportWorkbook />);
  await choose("releve.csv", csvBytes());
  await describeIt();

  expect(screen.getByText("First import: no history is stored.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm and import" }));

  await screen.findByText("The CSV's 40 rows were stored; 33 wait in the inbox.");
  expect(confirmWorkbook).toHaveBeenCalledWith(
    btoa(String.fromCharCode(...csvBytes())),
    CSV.layout,
  );
});

test("csv: rows that continue the history say from which stored balance and date", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(
    asCsv({ placement: { kind: "continues", date: "2023-12-29", balanceCents: 251_210 } }),
  );
  render(<ImportWorkbook />);
  await choose("releve.csv", csvBytes());
  await describeIt();

  expect(
    screen.getByText(`Continues from the stored balance of ${formatCents(251_210)} on 2023-12-29.`),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Confirm and import" })).toBeTruthy();
});

test("csv: a placement that fails shows its reason and no Confirm", async () => {
  const reason =
    "The file does not continue from the rows already stored: its oldest row opens from 2512.10 $, but the newest stored row, of 2023-12-29, which left 999.99 $: 1512.11 $ is unexplained.";
  vi.mocked(describeWorkbook).mockResolvedValue(
    asCsv({
      ok: false,
      problems: [reason],
      placement: { kind: "gap", date: "2023-12-29", balanceCents: 99_999 },
    }),
  );
  render(<ImportWorkbook />);
  await choose("releve.csv", csvBytes());
  await describeIt();

  expect(screen.queryByRole("button", { name: "Confirm and import" })).toBeNull();
  expect(within(screen.getByRole("list", { name: "What failed" })).getByText(reason)).toBeTruthy();
  expect(screen.queryByText(/First import|Continues from/u)).toBeNull();
  expect(screen.getByText(/the CSV does not pass every check/u)).toBeTruthy();
});

test("csv: a verification that fails shows its reason and no Confirm", async () => {
  const reason =
    "The layout names no balance column, so nothing proves the 32 rows read are all of them or that their amounts are right.";
  vi.mocked(describeWorkbook).mockResolvedValue(
    asCsv({ ok: false, problems: [reason], placement: null }),
  );
  render(<ImportWorkbook />);
  await choose("transactions.csv", csvBytes());
  await describeIt();

  expect(screen.queryByRole("button", { name: "Confirm and import" })).toBeNull();
  expect(screen.getByText(reason)).toBeTruthy();
});

test("csv: a CSV named .xlsx is sent as its bytes, for the server to read as a CSV", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue(CSV);
  render(<ImportWorkbook />);
  await choose("classeur.xlsx", csvBytes());
  await describeIt();
  expect(describeWorkbook).toHaveBeenCalledWith(btoa(String.fromCharCode(...csvBytes())));
});
