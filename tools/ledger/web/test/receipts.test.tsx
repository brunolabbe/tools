// @vitest-environment jsdom

/**
 * The receipt screen (lg-8): a photo kept, read only on the tap that says where
 * it goes, or typed in; the form, checked as it is edited; the rows it may
 * document; and filing as the confirmation. The fakes are the API client
 * modules; every merchant and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HouseholdResponse, ReceiptProposal, UploadedReceipt } from "@ledger/contract";
import { MAX_RECEIPT_PHOTO_BYTES } from "@ledger/contract";
import { fetchHousehold } from "../src/api/households.ts";
import { fetchMe } from "../src/api/me.ts";
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
vi.mock("../src/api/me.ts", () => ({ fetchMe: vi.fn() }));
vi.mock("../src/api/households.ts", () => ({ fetchHousehold: vi.fn() }));
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

/**
 * The household's record (lg-22) with `people` as its current members, each
 * under one address, and `left` in its history only, as someone who has left.
 */
function address(person: string): string {
  return `${person}@example.test`;
}

function household(people: readonly string[], left: readonly string[] = []): HouseholdResponse {
  const record = (person: string, action: "add" | "remove") => ({
    address: address(person),
    person,
    action,
    at: "2026-10-01T00:00:00.000Z",
    by: "operator",
  });
  return {
    household: { id: "home", name: "Home" },
    members: people.map((person) => ({ address: address(person), person })),
    history: [
      ...[...people, ...left].map((person) => record(person, "add")),
      ...left.map((person) => record(person, "remove")),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "sam"]);
  vi.mocked(fetchMe).mockResolvedValue({
    person: { id: "alex", email: "alex@example.test", household: "home" },
    admin: false,
  });
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "sam"]));
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
    charges: [],
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
      chargedTo: null,
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      spendingCategoryId: 2,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      spendingCategoryId: null,
      share: "shared",
      chargedTo: null,
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
    charges: [{ chargedTo: "sam", lineId: 10 }],
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

test("shows the Taxable check when a mark does not give the printed taxes, and still files (lg-26)", async () => {
  await readBasket();
  const label =
    "The items marked taxable do not give the taxes printed. Check which items are taxable.";
  expect(screen.getByText("It adds up.")).toBeTruthy();
  expect(screen.queryByText(label)).toBeNull();

  // The six-pack's mark misread: its Taxable box is the second of the three.
  fireEvent.click(screen.getAllByLabelText("Taxable")[1] as HTMLElement);

  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText("It adds up.")).toBeNull();
  // Not blocked: the items still make the total, and the person files.
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items.map((each) => each.taxable),
  ).toEqual([false, false, true]);
});

// lg-23 gate 1, F2: among more than two, "the other's" named nobody, and the
// screen did not offer it. lg-30 names whose on each item, from a picker.
test("among three people, an item cycles to someone else's and names whose it is", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: 9,
    chargeLineId: 10,
    charges: [
      { chargedTo: "sam", lineId: 10 },
      { chargedTo: "casey", lineId: 11 },
    ],
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();

  expect(shared()).toBe("Not shared 0.00 $ · Shared 24.76 $");
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Not shared" }));
  // Someone else's, starting on the first of the others.
  const beer = screen.getByLabelText("Whose is BIERE 6X355") as HTMLSelectElement;
  expect([...beer.options].map((option) => option.value)).toEqual(["casey", "sam"]);
  fireEvent.change(beer, { target: { value: "sam" } });
  expect(screen.getByRole("button", { name: "BIERE 6X355, sam's" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "SAVON, Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "SAVON, Not shared" }));
  expect(screen.getByRole("button", { name: "SAVON, casey's" })).toBeTruthy();

  // Apart 15,54 $ and 5,74 $; the shared amount takes the cent.
  expect(shared()).toBe("Not shared 0.00 $ · sam's 15.54 $ · casey's 5.74 $ · Shared 3.48 $");
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi
      .mocked(fileReceipt)
      .mock.calls[0]?.[1].proposal.items.map((item) => [item.share, item.chargedTo]),
  ).toEqual([
    ["shared", null],
    ["theirs", "sam"],
    ["theirs", "casey"],
  ]);
  expect(
    await screen.findByText(
      "Filed as alex's line in the period, and sam's and casey's items as charges.",
    ),
  ).toBeTruthy();
});

// --- lg-30: the people counted are the household's current members ---

test("counts the household's current members from its record, not every name the books hold", async () => {
  vi.mocked(fetchMe).mockResolvedValue({
    person: { id: "alex", email: "alex@example.test", household: "maison" },
    admin: false,
  });
  // One person under two addresses is one member.
  vi.mocked(fetchHousehold).mockResolvedValue({
    ...household(["alex", "sam"]),
    members: [
      { address: "alex@example.test", person: "alex" },
      { address: "alex@work.example", person: "alex" },
      { address: "sam@example.test", person: "sam" },
    ],
  });
  await readBasket();

  expect(fetchMe).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchHousehold).mock.calls[0]?.[0]).toBe("maison");
  expect(fetchPeople).not.toHaveBeenCalled();
  // alex and sam, so the two-person screen.
  expect(screen.getByRole("checkbox", { name: "This was sam's" })).toBeTruthy();
});

test("two current members and one who has left: the screen is the two-person one", async () => {
  vi.mocked(fetchPeople).mockResolvedValue(["alex", "casey", "sam"]);
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "sam"], ["casey"]));
  await readBasket();

  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "BIERE 6X355, Not shared" }));

  expect(screen.getByRole("button", { name: "BIERE 6X355, sam's" })).toBeTruthy();
  expect(screen.queryByLabelText(/^Whose is/u)).toBeNull();
  expect(screen.queryByText("This was someone else's")).toBeNull();
  expect(screen.queryByLabelText("Whose it was")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items[1]).toMatchObject({
    share: "theirs",
    chargedTo: null,
  });
});

test("among three people, the whole receipt can be someone else's, picked by name", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  expect(screen.queryByText(/as a line charged to them/u)).toBeNull();
  expect(screen.queryByLabelText("Whose it was")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "This was someone else's" }));
  const whose = screen.getByLabelText("Whose it was") as HTMLSelectElement;
  expect([...whose.options].map((option) => option.value)).toEqual(["casey", "sam"]);
  fireEvent.change(whose, { target: { value: "sam" } });
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toMatchObject({
    to: "line",
    chargedTo: "sam",
  });
});

// --- lg-39: the household has not loaded ---

/** The basket read from a photo, its six-pack marked someone else's. */
async function readBasketWithTheirs(): Promise<void> {
  vi.mocked(fetchSpendingCategories).mockResolvedValue([
    { id: 1, name: "Groceries", retired: false, createdAt: "x", createdBy: "migration" },
    { id: 2, name: "Alcohol", retired: false, createdAt: "x", createdBy: "migration" },
  ]);
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          items: BASKET.items.map((item) =>
            item.text === "BIERE 6X355" ? { ...item, share: "theirs" as const } : item,
          ),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
}

function expectNoTwoPersonForm(): void {
  expect(screen.queryByRole("form", { name: "The receipt" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(screen.queryByRole("button", { name: /^File as/u })).toBeNull();
  expect(screen.queryByLabelText("What is shared")).toBeNull();
  expect(fileReceipt).not.toHaveBeenCalled();
}

test("the household's record failing holds the form, says so where the person is, and retries (lg-39)", async () => {
  vi.mocked(fetchHousehold).mockRejectedValueOnce(new Error("boom"));
  await readBasketWithTheirs();

  // The failure is in the screen the person is on, not only on the first one.
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The household did not load");
  expectNoTwoPersonForm();

  // Retrying asks for the record again, and not for the categories again.
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
  expect(fetchHousehold).toHaveBeenCalledTimes(2);
  expect(fetchSpendingCategories).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).toBeNull();
  // The categories the other request returned were kept.
  const category = screen.getByLabelText("Category of BIERE 6X355") as HTMLSelectElement;
  expect([...category.options].map((option) => option.text)).toContain("Alcohol");
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
});

test("the signed-in person failing to load holds the form the same way (lg-39)", async () => {
  vi.mocked(fetchMe).mockRejectedValue(new Error("boom"));
  await readBasketWithTheirs();

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The household did not load");
  expect(fetchHousehold).not.toHaveBeenCalled();
  expectNoTwoPersonForm();
});

test("a household that has not answered yet holds the form, and files nothing (lg-39)", async () => {
  vi.mocked(fetchHousehold).mockReturnValue(new Promise(() => undefined));
  await readBasketWithTheirs();

  expect((await screen.findByRole("status")).textContent).toBe("Loading the household…");
  expectNoTwoPersonForm();
});

test("categories failing to load do not hold the form, and can be asked for again (lg-39)", async () => {
  vi.mocked(fetchSpendingCategories).mockRejectedValueOnce(new Error("boom"));
  await readBasketWithTheirs();

  await waitFor(() => expect(field("Total").value).toBe("24.76"));
  // The household loaded, so the form is the household's own, with the failure beside it.
  expect(screen.getByRole("checkbox", { name: "This was sam's" })).toBeTruthy();
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The spending categories did not load");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fetchSpendingCategories).toHaveBeenCalledTimes(2);
  expect(fetchHousehold).toHaveBeenCalledTimes(1);
});
