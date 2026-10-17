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
  items: [],
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
    proposals: [{ proposal: READ, flags: [], merchantCategoryId: null }],
  });
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: READ,
    periodLineId: 9,
    chargeLineId: null,
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
      part: 1,
      proposal: {
        merchant: "Dépanneur",
        date: "2026-10-05",
        subtotal: 1_250,
        gst: null,
        qst: null,
        total: 1_250,
        items: [],
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
    part: 1,
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
    part: 1,
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
      { proposal: READ, flags: [], merchantCategoryId: null },
      {
        proposal: { ...READ, merchant: "Quincaillerie", total: 999 },
        flags: ["parts-differ"],
        merchantCategoryId: null,
      },
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

// Gate 1, F2: each receipt in a photo of two is filed, as its own part.
test("files each receipt in a photo of two, and goes back to the one not filed yet", async () => {
  const second = { ...READ, merchant: "Quincaillerie", total: 999 };
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      { proposal: READ, flags: [], merchantCategoryId: null },
      { proposal: second, flags: ["parts-differ"], merchantCategoryId: null },
    ],
  });
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  fireEvent.click(await screen.findByRole("button", { name: "Quincaillerie, 9.99 $" }));
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  fireEvent.click(await screen.findByRole("button", { name: "Marché Exemple, 26.50 $" }));
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(fileReceipt).mock.calls;
  expect(calls.map(([, request]) => [request.part, request.proposal.merchant])).toEqual([
    [2, "Quincaillerie"],
    [1, "Marché Exemple"],
  ]);
  expect(await screen.findByText("Filed as alex's line in the period.")).toBeTruthy();
  // Both filed: nothing more to pick, and no second read.
  expect(screen.queryByRole("button", { name: /Quincaillerie|Marché/u })).toBeNull();
  expect(readReceipt).toHaveBeenCalledTimes(1);
});

// --- lg-10: the items ---

/**
 * Bread, zero-rated; a six-pack, taxable, with its deposit; soap, taxable: the
 * total 24,76 $. The six-pack with its deposit and taxes is 15,54 $.
 */
const BASKET: ReceiptProposal = {
  merchant: "Marché Exemple",
  date: "2026-10-04",
  subtotal: 2_207,
  gst: 90,
  qst: 179,
  total: 2_476,
  items: [
    {
      text: "PAIN",
      price: 349,
      taxable: false,
      deposit: null,
      spendingCategoryId: 1,
      share: "shared",
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      spendingCategoryId: 2,
      share: "shared",
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      spendingCategoryId: null,
      share: "shared",
    },
  ],
};

async function readBasket(merchantCategoryId: number | null = null): Promise<void> {
  vi.mocked(fetchSpendingCategories).mockResolvedValue([
    { id: 1, name: "Groceries", retired: false, createdAt: "x", createdBy: "migration" },
    { id: 2, name: "Alcohol", retired: false, createdAt: "x", createdBy: "migration" },
  ]);
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [{ proposal: BASKET, flags: [], merchantCategoryId }],
  });
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
}

function shared(): string {
  return screen.getByLabelText("What is shared").textContent ?? "";
}

test("a tap cycles an item through shared, not shared and the other's, and the amounts follow live", async () => {
  await readBasket();

  expect(shared()).toBe("Not shared 0.00 $ · sam's 0.00 $ · Shared 24.76 $");

  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Shared" }));
  expect(shared()).toBe("Not shared 15.54 $ · sam's 0.00 $ · Shared 9.22 $");

  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Not shared" }));
  expect(shared()).toBe("Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $");

  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, sam's" }));
  expect(screen.getByRole("button", { name: "BIERE 6X355, Shared" })).toBeTruthy();
});

test("files the items as marked, on what the card was charged", async () => {
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: 9,
    chargeLineId: 10,
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Not shared" }));

  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
  expect(request?.proposal.items.map((item) => item.share)).toEqual(["shared", "theirs", "shared"]);
  // The API takes the parts off: the form sends what the card was charged.
  expect(request?.destination).toMatchObject({ to: "line", amountCents: 2_476 });
  expect(
    await screen.findByText("Filed as alex's line in the period, and sam's items as a charge."),
  ).toBeTruthy();
});

test("each item's category is editable, and the merchant's last category is proposed first", async () => {
  await readBasket(2);

  // The line takes the merchant's category, and every picker lists it first.
  expect((screen.getByLabelText("Spending category") as HTMLSelectElement).value).toBe("2");
  const picker = screen.getByLabelText("Category of SAVON") as HTMLSelectElement;
  expect([...picker.options].map((option) => option.text)).toEqual([
    "None",
    "Alcohol",
    "Groceries",
  ]);
  // The model proposed none for the soap; the person picks one.
  expect(picker.value).toBe("");
  fireEvent.change(picker, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items.map((item) => item.spendingCategoryId),
  ).toEqual([1, 2, 1]);
});

test("items that do not add up to the total are shown for correction and not filed", async () => {
  await readBasket();

  fireEvent.change(field("Price of PAIN"), { target: { value: "3.48" } });

  expect(
    screen.getByText(
      "The items, deposits and taxes do not add up to the total. Correct them to file.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("What is shared")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(fileReceipt).not.toHaveBeenCalled();

  fireEvent.change(field("Price of PAIN"), { target: { value: "3.49" } });
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
});

test("keeps an item left out off a joint-account row, before asking the server", async () => {
  vi.mocked(fetchReceiptMatches).mockResolvedValue([
    {
      rowId: 41,
      date: "2026-10-03",
      description: "Achat /Marché Exemple",
      amountCents: -2_476,
      daysApart: 1,
    },
  ]);
  await readBasket();
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Shared" }));

  fireEvent.click(screen.getByRole("button", { name: "Paid with the joint card?" }));
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));

  const said = (await screen.findByRole("alert")).textContent ?? "";
  expect(said).toContain("shared whole");
  // Never sent to file it as a line: a line is paid by whoever took the photo (gate 1, F1).
  expect(said).not.toContain("line");
  expect(fileReceipt).not.toHaveBeenCalled();
});
