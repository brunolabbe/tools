// @vitest-environment jsdom

/**
 * The paste screen's three promises (lg-2): the rows are read back before
 * anything is stored, a paste is stored only when the user confirms, and a
 * refusal says what the server said without losing the text.
 *
 * **The fake is the API client module, never `fetch`** — `src/api/statements.ts`
 * is the one seam, so no route shape is restated here. The parser is not faked:
 * the preview is the real `parseStatement`, which is the point of running it in
 * the browser.
 *
 * The DOM arrives as a docblock rather than a vitest project of its own, for
 * the reason `tools/planner/web/test/controls.test.tsx` gives.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppError } from "@ledger/contract";
import { importStatement } from "../src/api/statements.ts";
import { StatementPaste } from "../src/statements/StatementPaste.tsx";

vi.mock("../src/api/statements.ts", () => ({ importStatement: vi.fn() }));

const stored = vi.mocked(importStatement);

beforeEach(() => {
  vi.clearAllMocks();
});

// `globals: false`, so Testing Library registers no cleanup of its own.
afterEach(cleanup);

/** Two rows, newest first, invented: one credit and one payment. */
const PASTE = [
  "Septembre 2026",
  "Date\tDescription\tMontant\tSolde\tlien",
  "12 SEP12 Septembre",
  "Loyer/Prêt hypothécaire",
  "Hypothèque /Prêteur Exemple",
  "",
  "−700,00 $\t2 100,00 $\t",
  "12 Septembre Hypothèque /Prêteur Exemple −700,00 $",
  "11 SEP11 Septembre",
  "Virements",
  "Virement entre folios /Caisse du Lac",
  "",
  "+400,00 $\t2 800,00 $\t",
  "11 Septembre Virement entre folios /Caisse du Lac +400,00 $",
  "Total\t−300,00 $",
  "",
].join("\n");

function paste(text: string): void {
  render(<StatementPaste />);
  fireEvent.change(screen.getByLabelText("Transactions copied from AccèsD"), {
    target: { value: text },
  });
}

test("previews the parsed rows, newest first, and stores nothing until confirmed", () => {
  paste(PASTE);

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain("Hypothèque /Prêteur Exemple");
  expect(rows[0]?.textContent).toContain("2026-09-12");
  expect(rows[0]?.textContent).toContain("-700.00 $");
  expect(rows[0]?.textContent).toContain("2100.00 $");
  expect(rows[1]?.textContent).toContain("Virement entre folios /Caisse du Lac");
  expect(screen.getByText(/Nothing is stored until you confirm/u)).toBeTruthy();
  expect(stored).not.toHaveBeenCalled();
});

test("confirming sends the pasted text and shows the report", async () => {
  stored.mockResolvedValue({ rowsAdded: 1, rowsAlreadyPresent: 1, tailBalanceCents: 210_000 });
  paste(PASTE);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  fireEvent.click(screen.getByRole("button", { name: "Confirm and store" }));

  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("1 row added"));
  expect(stored).toHaveBeenCalledTimes(1);
  expect(stored.mock.calls[0]?.[0]).toBe(PASTE);
  const report = screen.getByRole("status").textContent;
  expect(report).toContain("1 already stored");
  expect(report).toContain("2100.00 $");
});

test("a refusal shows the server's own words and keeps the text and the preview", async () => {
  const message =
    "The oldest row of the paste opens from 2100.00 $, but the newest stored row left 1500.00 $: 600.00 $ is unexplained.";
  stored.mockRejectedValue(new AppError("STATEMENT_CHAIN_BROKEN", message));
  paste(PASTE);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  fireEvent.click(screen.getByRole("button", { name: "Confirm and store" }));

  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  const box = screen.getByLabelText<HTMLTextAreaElement>("Transactions copied from AccèsD");
  expect(box.value).toBe(PASTE);
});

test("a paste that does not parse is refused before anything is sent, naming the line", () => {
  paste(PASTE.replace("Virements", "Quelque chose d'autre\nencore"));

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  expect(screen.getByRole("alert").textContent).toMatch(
    /Line \d+ of the paste was not recognised/u,
  );
  expect(screen.queryByRole("button", { name: "Confirm and store" })).toBeNull();
  expect(stored).not.toHaveBeenCalled();
});

test("editing the text after a preview takes the preview away", () => {
  paste(PASTE);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  fireEvent.change(screen.getByLabelText("Transactions copied from AccèsD"), {
    target: { value: `${PASTE}\n` },
  });

  expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Confirm and store" })).toBeNull();
});

test("a paste with a header and no rows is refused before anything is sent", () => {
  paste("Date\tDescription\tMontant\tSolde\tlien\n");

  fireEvent.click(screen.getByRole("button", { name: "Preview" }));

  expect(screen.getByRole("alert").textContent).toContain("no statement rows");
  expect(screen.queryByRole("button", { name: "Confirm and store" })).toBeNull();
  expect(stored).not.toHaveBeenCalled();
});

test("Paste another empties the box and goes back to the start", async () => {
  stored.mockResolvedValue({ rowsAdded: 2, rowsAlreadyPresent: 0, tailBalanceCents: 210_000 });
  paste(PASTE);
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm and store" }));
  await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Paste another" }));

  const box = screen.getByLabelText<HTMLTextAreaElement>("Transactions copied from AccèsD");
  expect(box.value).toBe("");
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
});
