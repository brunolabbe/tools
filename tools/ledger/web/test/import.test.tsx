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
  vi.mocked(confirmWorkbook).mockResolvedValue({ report: "Importing the workbook.\nWritten.\n" });
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

  await screen.findByText("Choose an .xlsx workbook");
  expect(confirmWorkbook).not.toHaveBeenCalled();
});

test("a file's name decides nothing: one named .csv is sent, for the server to judge its bytes", async () => {
  render(<ImportWorkbook />);
  await choose("releve.csv");
  await describeIt();
  await waitFor(() => expect(describeWorkbook).toHaveBeenCalledTimes(1));
});
