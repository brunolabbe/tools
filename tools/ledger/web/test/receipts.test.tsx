// @vitest-environment jsdom

/**
 * The receipt screen (lg-8): a photo kept, read only on the tap that says where
 * it goes, or typed in; the form, checked as it is edited; the rows it may
 * document; and filing as the confirmation. The fakes are the API client
 * modules; every merchant and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReceiptProposal, UploadedReceipt } from "@ledger/contract";
import { MAX_RECEIPT_PHOTO_BYTES } from "@ledger/contract";
import {
  fetchReceiptMatches,
  fileReceipt,
  readReceipt,
  uploadReceipt,
} from "../src/api/receipts.ts";
import { fetchPeople } from "../src/api/rules.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import { Receipts } from "../src/receipts/Receipts.tsx";

vi.mock("../src/api/rules.ts", () => ({ fetchPeople: vi.fn() }));
vi.mock("../src/api/spending.ts", () => ({ fetchSpendingCategories: vi.fn() }));
vi.mock("../src/api/receipts.ts", () => ({
  uploadReceipt: vi.fn(),
  readReceipt: vi.fn(),
  fetchReceiptMatches: vi.fn(),
  fileReceipt: vi.fn(),
}));

const RECEIPT: UploadedReceipt = {
  id: 3,
  mediaType: "image/jpeg",
  bytes: 1_234,
  uploadedAt: "2026-10-05T15:00:00.000Z",
  uploadedBy: "alex",
  reader: "claude-haiku-5-5",
};

const READ: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_500,
  gst: 50,
  qst: 100,
  total: 2_650,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchSpendingCategories).mockResolvedValue([
    { id: 1, name: "Groceries", retired: false, createdAt: "x", createdBy: "migration" },
  ]);
  vi.mocked(uploadReceipt).mockResolvedValue(RECEIPT);
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [{ proposal: READ, flags: [] }],
  });
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    proposal: READ,
    periodLineId: 9,
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
});

afterEach(cleanup);

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

async function takePhoto(size = 1_234): Promise<void> {
  render(<Receipts />);
  const camera = field("Take a photo of a receipt");
  const photo = new File([new Uint8Array(size)], "receipt.jpg", { type: "image/jpeg" });
  fireEvent.change(camera, { target: { files: [photo] } });
}

test("keeps the photo, and says where it goes before anything sends it there", async () => {
  await takePhoto();

  expect(await screen.findByText("Photo kept.")).toBeTruthy();
  expect(uploadReceipt).toHaveBeenCalledTimes(1);
  const notice = screen.getByText(/Reading sends this photo out of the house, to Anthropic/u);
  expect(notice.textContent).toContain("claude-haiku-5-5");
  expect(readReceipt).not.toHaveBeenCalled();
});

test("typing it in never sends the photo, and starts the date at the upload's", async () => {
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));

  expect(field("Date").value).toBe("2026-10-05");
  fireEvent.change(field("Merchant"), { target: { value: "Dépanneur" } });
  fireEvent.change(field("Total"), { target: { value: "12.50" } });
  fireEvent.change(field("Subtotal"), { target: { value: "12.50" } });
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(readReceipt).not.toHaveBeenCalled();
  expect(vi.mocked(fileReceipt).mock.calls[0]).toEqual([
    3,
    {
      proposal: {
        merchant: "Dépanneur",
        date: "2026-10-05",
        subtotal: 1_250,
        gst: null,
        qst: null,
        total: 1_250,
      },
      destination: {
        to: "line",
        date: "2026-10-05",
        amountCents: 1_250,
        spendingCategoryId: null,
        note: "Dépanneur",
        chargedTo: null,
      },
    },
  ]);
  expect(await screen.findByText("Filed as alex's line in the period.")).toBeTruthy();
});

test("reads only on the tap, fills the form, and flags what stops adding up as it is edited", async () => {
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  await waitFor(() => expect(field("Total").value).toBe("26.50"));
  expect(readReceipt).toHaveBeenCalledWith(3);
  expect(screen.getByText("It adds up.")).toBeTruthy();

  fireEvent.change(field("Total"), { target: { value: "26.51" } });

  expect(screen.getByText("The subtotal and the taxes do not add up to the total.")).toBeTruthy();
  // The charge follows the total until it is changed on its own.
  expect(field("Charged to the card (with any tip)").value).toBe("26.51");
});

test("files the charge with its tip, which differs from the total", async () => {
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  fireEvent.change(field("Charged to the card (with any tip)"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1]).toEqual({
    proposal: READ,
    destination: {
      to: "line",
      date: "2026-10-04",
      amountCents: 3_000,
      spendingCategoryId: null,
      note: "Marché Exemple",
      chargedTo: "sam",
    },
  });
});

test("offers the joint-account rows for the charge, and attaches the receipt to the one chosen", async () => {
  vi.mocked(fetchReceiptMatches).mockResolvedValue([
    {
      rowId: 41,
      date: "2026-10-03",
      description: "Achat /Marché Exemple",
      amountCents: -2_650,
      daysApart: 1,
    },
  ]);
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  fireEvent.click(screen.getByRole("button", { name: "Paid with the joint card?" }));
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));

  expect(fetchReceiptMatches).toHaveBeenCalledWith(3, 2_650, "2026-10-04");
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1]).toEqual({
    proposal: READ,
    destination: { to: "row", rowId: 41 },
  });
  expect(await screen.findByText("Attached to the joint-account row.")).toBeTruthy();
});

test("asks which receipt, when the photo holds two", async () => {
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      { proposal: READ, flags: [] },
      { proposal: { ...READ, merchant: "Quincaillerie", total: 999 }, flags: ["parts-differ"] },
    ],
  });
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  fireEvent.click(await screen.findByRole("button", { name: "Quincaillerie, 9.99 $" }));

  expect(field("Merchant").value).toBe("Quincaillerie");
});

test("offers no read when no model is configured", async () => {
  vi.mocked(uploadReceipt).mockResolvedValue({ ...RECEIPT, reader: null });
  await takePhoto();

  expect(await screen.findByText(/Reading receipts is not set up here/u)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();
});

test("refuses a photo over the cap without sending it", async () => {
  await takePhoto(MAX_RECEIPT_PHOTO_BYTES + 1);

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(uploadReceipt).not.toHaveBeenCalled();
});
