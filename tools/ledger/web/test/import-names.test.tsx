// @vitest-environment jsdom

/**
 * lg-78: the import screen asks who each name the workbook uses is, when the
 * household holds no one by it. The describe response is lg37's
 * (`fixtures/lg37-describe.json`) with two such names added, one long; the
 * fakes are the API client module. Every name is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AppError } from "@ledger/contract";
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

const ALEX = "4f9c2d8e-1b3a-4c5d-9e6f-7a8b9c0d1e2f";
const SAMANTHA = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LONG = "Marie-Ève Bélanger-Lacroix de Saint-Jean-sur-Richelieu";

/** lg37's reading, every verification holding, with two names the household lacks. */
const NAMES: DescribeWorkbookResponse = {
  ...(LG37 as DescribeWorkbookResponse & { kind: "xlsx" }),
  ok: true,
  problems: [],
  unresolved: [
    { name: "Sam", where: "2022!E6", rows: 5 },
    { name: LONG, where: "2023!E9", rows: 1 },
  ],
  held: [
    { person: ALEX, name: "alex" },
    { person: SAMANTHA, name: "Samantha" },
  ],
};

const FILE = btoa("PK\u0003\u0004\u0001\u0002\u0003");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(describeWorkbook).mockResolvedValue(NAMES);
  vi.mocked(confirmWorkbook).mockResolvedValue({
    kind: "xlsx",
    report: "Importing the workbook.\nWritten.\n",
  });
});

afterEach(cleanup);

async function read(): Promise<void> {
  render(<ImportWorkbook />);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  fireEvent.change(input, {
    target: { files: [new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], "c.xlsx")] },
  });
  await screen.findByText("File chosen. Nothing has been sent.");
  fireEvent.click(screen.getByRole("button", { name: "Send the samples and describe" }));
  await screen.findByRole("heading", { name: "Names the household does not have" });
}

function choose(name: string, option: string): void {
  const select = screen.getByRole("combobox", { name: `Who is “${name}”?` });
  const value = within(select)
    .getAllByRole<HTMLOptionElement>("option")
    .find((each) => each.textContent === option)?.value;
  if (value === undefined) throw new Error(`no option ${option}`);
  fireEvent.change(select, { target: { value } });
}

const confirmButton = () => screen.queryByRole("button", { name: "Confirm and import" });

test("lists each name with where it first appears and how many rows name it, offering everyone held and a new person", async () => {
  await read();

  const names = within(screen.getByRole("list", { name: "Names to answer" }));
  const items = names.getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]?.textContent).toContain("First in 2022!E6; 5 rows");
  expect(items[1]?.textContent).toContain("First in 2023!E9; 1 row");
  const options = within(screen.getByRole("combobox", { name: "Who is “Sam”?" }))
    .getAllByRole("option")
    .map((option) => option.textContent);
  expect(options).toEqual(["Choose…", "alex", "Samantha", "A new person"]);
  // No generated id is ever printed.
  expect(document.body.textContent).not.toContain(SAMANTHA);
});

test("Confirm is not offered while a name is unanswered, and is once every one is", async () => {
  await read();

  expect(confirmButton()).toBeNull();
  expect(screen.getByText("Say who each name above is to confirm the import.")).toBeTruthy();

  choose("Sam", "Samantha");
  expect(confirmButton()).toBeNull();

  choose(LONG, "A new person");
  expect(confirmButton()).not.toBeNull();

  // A new person with no name is not an answer.
  const typed = screen.getByRole("textbox", { name: "The new person’s name" });
  expect((typed as HTMLInputElement).value).toBe(LONG);
  fireEvent.change(typed, { target: { value: "  " } });
  expect(confirmButton()).toBeNull();
  fireEvent.change(typed, { target: { value: " Marie-Ève " } });
  expect(confirmButton()).not.toBeNull();

  // Back to "Choose…" withdraws it again.
  choose("Sam", "Choose…");
  expect(confirmButton()).toBeNull();
});

test("Confirm sends each answer beside the file and the description", async () => {
  await read();
  choose("Sam", "Samantha");
  choose(LONG, "A new person");

  fireEvent.click(screen.getByRole("button", { name: "Confirm and import" }));

  await screen.findByText("The workbook was imported.");
  expect(confirmWorkbook).toHaveBeenCalledWith(FILE, NAMES.layout, [
    { name: "Sam", as: "held", person: SAMANTHA },
    { name: LONG, as: "new", shownAs: LONG },
  ]);
});

test("a Confirm refused with the answers applied lists what failed, and stays on the reading", async () => {
  const failed =
    "'$ (Avril-Août)'!A1: row 1 names 1 of the household (Période, Alex, Sam); a period sheet names two.";
  vi.mocked(confirmWorkbook).mockRejectedValue(
    new AppError("WORKBOOK_IMPORT_REFUSED", undefined, { details: { problems: [failed] } }),
  );
  await read();
  choose("Sam", "alex");
  choose(LONG, "A new person");

  fireEvent.click(screen.getByRole("button", { name: "Confirm and import" }));

  const refused = await screen.findByRole("list", { name: "What the import refused" });
  expect(within(refused).getByText(failed)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Names the household does not have" })).toBeTruthy();
});

test("a reading with no such name asks nothing", async () => {
  vi.mocked(describeWorkbook).mockResolvedValue({ ...NAMES, unresolved: [] });
  render(<ImportWorkbook />);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  fireEvent.change(input, { target: { files: [new File([new Uint8Array([1])], "c.xlsx")] } });
  await screen.findByText("File chosen. Nothing has been sent.");
  fireEvent.click(screen.getByRole("button", { name: "Send the samples and describe" }));
  await screen.findByRole("heading", { name: "The date of each row" });

  expect(screen.queryByRole("heading", { name: "Names the household does not have" })).toBeNull();
  expect(confirmButton()).not.toBeNull();
});
