// @vitest-environment jsdom

/**
 * The receipt screen (lg-8): a photo kept, read only on the tap that says where
 * it goes, or typed in; the form, checked as it is edited; the rows it may
 * document; and filing as the confirmation. The fakes are the API client
 * modules; every merchant and amount is invented.
 */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  HouseholdResponse,
  ReadReceiptResponse,
  ReceiptProposal,
  UploadedReceipt,
} from "@ledger/contract";
import { AppError, MAX_RECEIPT_PHOTO_BYTES } from "@ledger/contract";
import { fetchHousehold } from "../src/api/households.ts";
import { fetchMe } from "../src/api/me.ts";
import {
  fetchReceiptMatches,
  fileReceipt,
  readReceipt,
  uploadReceipt,
} from "../src/api/receipts.ts";
import { fetchPeople } from "../src/api/people.ts";
import { fetchSpendingCategories } from "../src/api/spending.ts";
import { useReceiptQueue } from "../src/receipts/Queue.tsx";
import { Receipts } from "../src/receipts/Receipts.tsx";
import { peopleAnswer } from "./people-answer.ts";
import { clientWrapper, renderWithClient } from "./render-with-client.tsx";

vi.mock("../src/api/people.ts", () => ({ fetchPeople: vi.fn() }));
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
    members: people.map((person) => ({ address: address(person), person, name: person })),
    history: [
      ...[...people, ...left].map((person) => record(person, "add")),
      ...left.map((person) => record(person, "remove")),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "sam"]));
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

/**
 * The receipt open in the form, filed from the list (lg-102): back to the queue,
 * every receipt not filed selected, and File selected.
 */
async function fileFromQueue(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
  const all = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
  if (!all.checked) fireEvent.click(all);
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));
  // The bar's button says Filing… until every selected receipt has its answer.
  await waitFor(() => expect(screen.queryByRole("button", { name: "Filing…" })).toBeNull());
}

/** Why the list did not file a receipt, as its row says it. */
async function rowRefusal(): Promise<string> {
  const said = (await screen.findByText(/^Not filed: /u)).textContent ?? "";
  return said.replace(/^Not filed: /u, "");
}

/** The one receipt not filed in the list, opened again. */
function reopen(): void {
  const parts = screen.getByRole("list", { name: /^Receipts in /u });
  // The row's first button opens it; the other takes it out of the list.
  fireEvent.click(within(parts).getAllByRole("button")[0] as HTMLElement);
}

/** Paid with the joint card (lg-91), and the rows it may be looked for with File it (lg-102). */
function payJointly(): void {
  fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "File it" }));
}

/** Paid by a member again, from the joint card or another member (lg-102). */
function payBy(person: string): void {
  fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: person } });
}

async function takePhoto(size = 1_234): Promise<void> {
  renderWithClient(<Receipts />);
  const camera = field("Take a photo of a receipt");
  const photo = new File([new Uint8Array(size)], "receipt.jpg", { type: "image/jpeg" });
  fireEvent.change(camera, { target: { files: [photo] } });
}

test("keeps the photo, and says where it goes before anything sends it there", async () => {
  await takePhoto();

  expect(await screen.findByText("Kept, not read yet.")).toBeTruthy();
  expect(uploadReceipt).toHaveBeenCalledTimes(1);
  const notice = screen.getByText(/Reading sends this photo out of the house, to Anthropic/u);
  // "Claude", never the one model the upload names: a flagged reading is read
  // again by a second (lg-105, the owner's answer of 2026-11-10).
  expect(notice.textContent).toContain("where it is read by Claude.");
  expect(notice.textContent).not.toContain("claude-haiku-5-5");
  expect(readReceipt).not.toHaveBeenCalled();
});

test("typing it in never sends the photo, and starts the date at the upload's", async () => {
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));

  expect(field("Date").value).toBe("2026-10-05");
  fireEvent.change(field("Merchant"), { target: { value: "Dépanneur" } });
  fireEvent.change(field("Total"), { target: { value: "12.50" } });
  fireEvent.change(field("Subtotal"), { target: { value: "12.50" } });
  await fileFromQueue();

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
        paidBy: null,
      },
    },
  ]);
  expect(await screen.findByText("Filed as alex's line in the period.")).toBeTruthy();
});

test("reads only on the tap, fills the form, and flags what stops adding up as it is edited", async () => {
  await takePhoto();
  await readOne();

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
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  fireEvent.change(field("Charged to the card (with any tip)"), { target: { value: "30" } });
  fireEvent.change(screen.getByLabelText("Whose"), { target: { value: "sam" } });
  await fileFromQueue();

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
      paidBy: null,
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
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  payJointly();
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

  // The second receipt opened, back to the list, and filed alone (lg-102: filing is the list's).
  fireEvent.click(await screen.findByRole("button", { name: "Quincaillerie, 9.99 $" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Quincaillerie, 9.99 $" }));
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  // The list is where it comes back to, with the one not filed yet still to pick.
  await screen.findByText("Quincaillerie, 9.99 $, filed");
  expect(screen.queryByRole("form", { name: "The receipt" })).toBeNull();
  const first = screen.getByRole("checkbox", {
    name: "Select Marché Exemple, 26.50 $",
  }) as HTMLInputElement;
  expect(first.checked).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Marché Exemple, 26.50 $" }));
  expect(field("Merchant").value).toBe("Marché Exemple");
  await fileFromQueue();

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(fileReceipt).mock.calls;
  expect(calls.map(([, request]) => [request.part, request.proposal.merchant])).toEqual([
    [2, "Quincaillerie"],
    [1, "Marché Exemple"],
  ]);
  expect(await screen.findAllByText("Filed as alex's line in the period.")).toHaveLength(2);
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
      discount: null,
      spendingCategoryId: 1,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "BIERE 6X355",
      price: 1_299,
      taxable: true,
      deposit: 60,
      discount: null,
      spendingCategoryId: 2,
      share: "shared",
      chargedTo: null,
    },
    {
      text: "SAVON",
      price: 499,
      taxable: true,
      deposit: null,
      discount: null,
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
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
}

function shared(): string {
  return screen.getByLabelText("What is shared").textContent ?? "";
}

/** An item's Shared box (lg-90). */
function sharedBox(item: string): HTMLInputElement {
  return screen.getByRole("checkbox", { name: `${item} is shared` });
}

/** The choice of whose an unchecked item is; it exists only while the box is unchecked. */
function whoseSelect(item: string): HTMLSelectElement {
  return screen.getByLabelText(`Whose is ${item}`);
}

function optionsOf(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.text);
}

/** Unchecks an item; it starts with whoever paid. */
function leaveOut(item: string): void {
  fireEvent.click(sharedBox(item));
}

test("unchecking an item leaves it out, picking a person charges it, and checking it again shares it (lg-90)", async () => {
  await readBasket();

  expect(shared()).toBe("Not shared 0.00 $ · sam's 0.00 $ · Shared 24.76 $");
  expect(sharedBox("BIERE 6X355").checked).toBe(true);
  expect(screen.queryByLabelText("Whose is BIERE 6X355")).toBeNull();

  // Unchecked, it is Mine: it stays with whoever paid, and the split moves by its cost.
  leaveOut("BIERE 6X355");
  expect(sharedBox("BIERE 6X355").checked).toBe(false);
  expect(whoseSelect("BIERE 6X355").value).toBe("");
  expect(shared()).toBe("Not shared 15.54 $ · sam's 0.00 $ · Shared 9.22 $");

  // A person is the choice made on purpose, and the charge moves with it.
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });
  expect(shared()).toBe("Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $");

  // Checking it again shares it, and nothing of the choice is left.
  fireEvent.click(sharedBox("BIERE 6X355"));
  expect(sharedBox("BIERE 6X355").checked).toBe(true);
  expect(screen.queryByLabelText("Whose is BIERE 6X355")).toBeNull();
  expect(shared()).toBe("Not shared 0.00 $ · sam's 0.00 $ · Shared 24.76 $");

  // Unchecked again, it starts on Mine and not on the person picked before.
  leaveOut("BIERE 6X355");
  expect(whoseSelect("BIERE 6X355").value).toBe("");
});

test("files the items as marked, on what the card was charged", async () => {
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: 9,
    chargeLineId: 10,
    charges: [{ chargedTo: "sam", lineId: 10, owedToPot: false }],
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();
  leaveOut("BIERE 6X355");
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });

  await fileFromQueue();

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
  expect(request?.proposal.items.map((item) => item.share)).toEqual(["shared", "theirs", "shared"]);
  // The API takes the parts off: the form sends what the card was charged.
  expect(request?.destination).toMatchObject({ to: "line", amountCents: 2_476 });
  expect(
    await screen.findByText(
      "Filed 9.22 $ as alex's line in the period, and sam's 15.54 $ as a charge.",
    ),
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
  await fileFromQueue();

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
      "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("What is shared")).toBeNull();
  await fileFromQueue();
  expect(await rowRefusal()).toBe(
    "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
  );
  expect(fileReceipt).not.toHaveBeenCalled();

  reopen();
  fireEvent.change(field("Price of PAIN"), { target: { value: "3.49" } });
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
});

// lg-91 supersedes "shared whole": an item left out of a joint row must name
// whose it is, and one left as Mine names nobody once paid jointly.
test("keeps an item left out that names nobody off a joint-account row, before asking the server", async () => {
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
  leaveOut("BIERE 6X355");

  payJointly();
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));

  const said = (await screen.findByRole("alert")).textContent ?? "";
  expect(said).toBe(
    "Choose whose each item left out is: a joint-account purchase has no payer to keep one.",
  );
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
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items.map((each) => each.taxable),
  ).toEqual([false, false, true]);
});

// lg-23 gate 1, F2: among more than two, "the other's" named nobody, and the
// screen did not offer it. lg-30 names whose on each item, from a picker.
test("among three people, an unchecked item names whose it is from one select (lg-23, lg-30, lg-90)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: 9,
    chargeLineId: 10,
    charges: [
      { chargedTo: "sam", lineId: 10, owedToPot: false },
      { chargedTo: "casey", lineId: 11, owedToPot: false },
    ],
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();

  expect(shared()).toBe("Not shared 0.00 $ · Shared 24.76 $");
  leaveOut("BIERE 6X355");
  // Mine first, then each of the others; nobody is charged until one is picked.
  const beer = whoseSelect("BIERE 6X355");
  expect([...beer.options].map((option) => option.value)).toEqual(["", "casey", "sam"]);
  expect(optionsOf(beer)).toEqual(["Mine", "casey", "sam"]);
  expect(beer.value).toBe("");
  fireEvent.change(beer, { target: { value: "sam" } });
  expect(beer.value).toBe("sam");
  leaveOut("SAVON");
  fireEvent.change(whoseSelect("SAVON"), { target: { value: "casey" } });
  expect(whoseSelect("SAVON").value).toBe("casey");

  // Apart 15,54 $ and 5,74 $; the shared amount takes the cent.
  expect(shared()).toBe("Not shared 0.00 $ · sam's 15.54 $ · casey's 5.74 $ · Shared 3.48 $");
  await fileFromQueue();

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
      "Filed 3.48 $ as alex's line in the period, and sam's 15.54 $ and casey's 5.74 $ as charges.",
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
      { address: "alex@example.test", person: "alex", name: "alex" },
      { address: "alex@work.example", person: "alex", name: "alex" },
      { address: "sam@example.test", person: "sam", name: "sam" },
    ],
  });
  await readBasket();

  expect(fetchMe).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchHousehold).mock.calls[0]?.[0]).toBe("maison");
  expect(fetchPeople).not.toHaveBeenCalled();
  // alex and sam, so the two-person screen: the whole receipt can be sam's (lg-102).
  expect(optionsOf(screen.getByLabelText("Whose"))).toEqual(["Shared", "sam's — owes all of it"]);
});

test("two current members and one who has left: the screen is the two-person one", async () => {
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "casey", "sam"]));
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "sam"], ["casey"]));
  await readBasket();

  leaveOut("BIERE 6X355");
  // Mine and the one other current member; casey has left and is not offered.
  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["Mine", "sam"]);
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });
  // The whole receipt is the one other current member's, or shared; casey is not offered.
  expect(optionsOf(screen.getByLabelText("Whose"))).toEqual(["Shared", "sam's — owes all of it"]);
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items[1]).toMatchObject({
    share: "theirs",
    chargedTo: null,
  });
});

test("among three people, the whole receipt can be someone else's, picked by name", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("26.50"));

  expect(screen.queryByText(/as a line charged to them/u)).toBeNull();
  const whose = screen.getByLabelText("Whose") as HTMLSelectElement;
  expect([...whose.options].map((option) => option.value)).toEqual(["", "casey", "sam"]);
  expect(whose.value).toBe("");
  fireEvent.change(whose, { target: { value: "sam" } });
  await fileFromQueue();

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
  await readOne();
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
  await fileFromQueue();
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

  // Not by role: the queue's read count is an output too, until the form opens.
  expect((await screen.findByText("Loading the household…")).tagName).toBe("OUTPUT");
  expectNoTwoPersonForm();
});

test("categories failing to load do not hold the form, and can be asked for again (lg-39)", async () => {
  vi.mocked(fetchSpendingCategories).mockRejectedValueOnce(new Error("boom"));
  await readBasketWithTheirs();

  await waitFor(() => expect(field("Total").value).toBe("24.76"));
  // The household loaded, so the form is the household's own, with the failure beside it.
  expect(optionsOf(screen.getByLabelText("Whose"))).toEqual(["Shared", "sam's — owes all of it"]);
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The spending categories did not load");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fetchSpendingCategories).toHaveBeenCalledTimes(2);
  expect(fetchHousehold).toHaveBeenCalledTimes(1);
});

// --- lg-39: a household with nobody else in it ---

test.each([
  ["one member", ["alex"]],
  ["no member", []],
])(
  "%s: nobody to charge, so no one else's box, no one else's share, and a read one is not filed (lg-39)",
  async (_name, members) => {
    vi.mocked(fetchHousehold).mockResolvedValue(household(members));
    await readBasketWithTheirs();
    await waitFor(() => expect(field("Total").value).toBe("24.76"));

    // The whole receipt cannot be someone else's.
    expect(optionsOf(screen.getByLabelText("Whose"))).toEqual(["Shared"]);
    // Unchecking offers Mine alone: nobody else is there to be picked.
    leaveOut("PAIN");
    expect(optionsOf(whoseSelect("PAIN"))).toEqual(["Mine"]);
    fireEvent.click(sharedBox("PAIN"));
    expect(sharedBox("PAIN").checked).toBe(true);

    // The six-pack was read as someone else's: it is said, and nothing is filed.
    await fileFromQueue();
    expect(await rowRefusal()).toBe("There is nobody else in the household to charge an item to.");
    expect(fileReceipt).not.toHaveBeenCalled();

    // The read item is someone else's, which the select says; Mine moves it off, and then it files, charging nobody.
    reopen();
    expect(whoseSelect("BIERE 6X355").value).toBe("");
    fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "" } });
    await fileFromQueue();
    await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
    const filed = vi.mocked(fileReceipt).mock.calls[0]?.[1];
    expect(filed?.proposal.items.map((item) => item.share)).not.toContain("theirs");
    expect(filed?.destination).toMatchObject({ to: "line", chargedTo: null });
  },
);

// --- lg-89: a rebate folded into the item it reduces ---

test("entering a rebate on an item updates the add-up check and the split live, and files it (lg-89)", async () => {
  await readBasket();
  leaveOut("BIERE 6X355");
  expect(shared()).toBe("Not shared 15.54 $ · sam's 0.00 $ · Shared 9.22 $");
  expect(field("Rebate on BIERE 6X355").value).toBe("");

  // 2,00 $ off the six-pack: the printed total no longer matches the items.
  fireEvent.change(field("Rebate on BIERE 6X355"), { target: { value: "-2.00" } });
  expect(
    screen.getByText(
      "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
    ),
  ).toBeTruthy();
  expect(screen.queryByLabelText("What is shared")).toBeNull();

  // The receipt as printed with the rebate: taxes on 15,98 $, total 22,46 $.
  fireEvent.change(field("Subtotal"), { target: { value: "20.07" } });
  fireEvent.change(field("GST (TPS)"), { target: { value: "0.80" } });
  fireEvent.change(field("QST (TVQ)"), { target: { value: "1.59" } });
  fireEvent.change(field("Total"), { target: { value: "22.46" } });
  expect(screen.getByText("It adds up.")).toBeTruthy();
  // The six-pack takes its rebate and the taxes on it off with it.
  expect(shared()).toBe("Not shared 13.24 $ · sam's 0.00 $ · Shared 9.22 $");

  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
  expect(request?.proposal.items.map((item) => item.discount)).toEqual([null, -200, null]);
  expect(request?.destination).toMatchObject({ to: "line", amountCents: 2_246 });
});

test("shows a rebate the reader folded into an item, and refuses one that is not an amount (lg-89)", async () => {
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          subtotal: 2_007,
          gst: 80,
          qst: 159,
          total: 2_246,
          items: BASKET.items.map((item, index) =>
            index === 1 ? { ...item, discount: -200 } : item,
          ),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("22.46"));

  expect(field("Rebate on BIERE 6X355").value).toBe("2.00");
  expect(screen.getByText("It adds up.")).toBeTruthy();

  fireEvent.change(field("Rebate on BIERE 6X355"), { target: { value: "two" } });
  expect(
    screen.getByText("An item needs its text and its price before the receipt can be filed."),
  ).toBeTruthy();
});

// lg-89 gate 1, the second low, undone: a rebate is typed positive, so the field says only what it is.
test("the Rebate field's placeholder names it and nothing more", async () => {
  await readBasket();

  expect(field("Rebate on BIERE 6X355").placeholder).toBe("Rebate");
});

// --- lg-92: several photos at once, read one at a time, confirmed from a queue ---

function jpeg(name: string, size = 1_234): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

/** Each upload is its own receipt, numbered from 11 in the order they go up. */
function uploadsNumbered(): void {
  let next = 10;
  vi.mocked(uploadReceipt).mockImplementation(async () => {
    next += 1;
    return { ...RECEIPT, id: next };
  });
}

function readOf(merchant: string, total: number): ReadReceiptResponse["proposals"][number] {
  return { proposal: { ...READ, merchant, total }, flags: [], merchantCategoryId: null };
}

/** One shop per photo, named by the photo's receipt id. */
function oneShopEach(id: number): ReadReceiptResponse {
  return {
    receiptId: id,
    model: "claude-haiku-5-5",
    proposals: [readOf(`Shop ${String(id)}`, 1_000)],
  };
}

function chooseSeveral(files: File[]): ReturnType<typeof renderWithClient> {
  const screenRendered = renderWithClient(<Receipts />);
  fireEvent.change(field("Choose photos of receipts"), { target: { files } });
  return screenRendered;
}

const THREE = ["a.jpg", "b.jpg", "c.jpg"];

test("three photos go up one at a time and nothing is read before Read all, then three reads, one at a time (lg-92)", async () => {
  uploadsNumbered();
  let inFlight = 0;
  let widest = 0;
  vi.mocked(readReceipt).mockImplementation(async (id) => {
    inFlight += 1;
    widest = Math.max(widest, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return oneShopEach(id);
  });

  chooseSeveral(THREE.map((name) => jpeg(name)));
  const notice = await screen.findByText(/Reading sends these photos out of the house/u);
  expect(notice.textContent).toContain("where they are read by Claude, one at a time.");
  expect(uploadReceipt).toHaveBeenCalledTimes(3);
  expect(vi.mocked(uploadReceipt).mock.calls.map(([photo]) => (photo as File).name)).toEqual(THREE);
  expect(readReceipt).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Read all" }));
  await screen.findByText("3 of 3 read");
  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12, 13]);
  expect(widest).toBe(1);
  expect(screen.getByRole("button", { name: "Shop 12, 10.00 $" })).toBeTruthy();
});

test("a 429 with Retry-After delays that read, drops nothing, and the count reaches 3 of 3 (lg-92)", async () => {
  uploadsNumbered();
  let refusedOnce = false;
  vi.mocked(readReceipt).mockImplementation(async (id) => {
    if (id === 12 && !refusedOnce) {
      refusedOnce = true;
      throw new AppError("RATE_LIMITED", undefined, { details: { retryAfterSec: 7 } });
    }
    return oneShopEach(id);
  });
  vi.useFakeTimers();
  try {
    chooseSeveral(THREE.map((name) => jpeg(name)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Read all" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The first is read, the second was refused and is waiting; the third is not asked yet.
    expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12]);
    expect(screen.getByText("1 of 3 read")).toBeTruthy();
    expect(screen.getByText(/Waiting 7 s/u)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_999);
    });
    expect(readReceipt).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12, 12, 13]);
    expect(screen.getByText("3 of 3 read")).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("a read that fails for another reason keeps that photo with a retry and reads the rest (lg-92)", async () => {
  uploadsNumbered();
  let failing = true;
  vi.mocked(readReceipt).mockImplementation(async (id) => {
    if (id === 12 && failing) throw new AppError("INTERNAL", "The reader broke.");
    return oneShopEach(id);
  });

  chooseSeveral(THREE.map((name) => jpeg(name)));
  fireEvent.click(await screen.findByRole("button", { name: "Read all" }));

  await screen.findByText("2 of 3 read");
  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12, 13]);
  expect(screen.getByText("The read failed: The reader broke.")).toBeTruthy();

  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("3 of 3 read");
  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12, 13, 12]);
  expect(screen.queryByText(/The read failed/u)).toBeNull();
});

test("a photo of two receipts gives two entries, and filing one marks only that one (lg-92)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 11,
    model: "claude-haiku-5-5",
    proposals: [readOf("Café Un", 1_000), readOf("Café Deux", 2_000)],
  });

  chooseSeveral([jpeg("two.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Café Un, 10.00 $" }));
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await screen.findByText("Café Un, 10.00 $, filed");
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[0]).toBe(11);
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1]).toMatchObject({ part: 1 });
  expect(screen.getByRole("button", { name: "Café Deux, 20.00 $" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Café Un, 10.00 $" })).toBeNull();

  // Opened and left again, the second stays unfiled.
  fireEvent.click(screen.getByRole("button", { name: "Café Deux, 20.00 $" }));
  fireEvent.click(await screen.findByRole("button", { name: "Back to the queue" }));
  expect(screen.getByRole("button", { name: "Café Deux, 20.00 $" })).toBeTruthy();
  expect(fileReceipt).toHaveBeenCalledTimes(1);
});

test("a photo over the size limit is listed as left out and the rest go on (lg-92)", async () => {
  uploadsNumbered();
  chooseSeveral([
    jpeg("small.jpg"),
    jpeg("huge.jpg", MAX_RECEIPT_PHOTO_BYTES + 1),
    jpeg("also.jpg"),
  ]);

  await screen.findByRole("button", { name: "Read all" });
  expect(screen.getByRole("list", { name: "Photos left out" }).textContent).toContain("huge.jpg");
  expect(vi.mocked(uploadReceipt).mock.calls.map(([photo]) => (photo as File).name)).toEqual([
    "small.jpg",
    "also.jpg",
  ]);
});

// --- lg-92 round 1: gate 1's findings ---

/**
 * The first photo's next receipt typed in — "Type another receipt from this
 * photo" once one is filed, "Type it in" before — a total typed, and filed from
 * the list (lg-102).
 */
async function typeInFirstAndFile(total: string): Promise<void> {
  const another = screen.queryAllByRole("button", { name: "Type another receipt from this photo" });
  const typing = another[0] ?? screen.getAllByRole("button", { name: "Type it in" })[0];
  fireEvent.click(typing as HTMLElement);
  fireEvent.change(await screen.findByLabelText("Total"), { target: { value: total } });
  await fileFromQueue();
  await screen.findByText(`Unnamed, ${total} $, filed`);
}

test("a receipt typed in from a kept photo shows it filed, files the next one as part 2, and Read all spends no read on it (lg-92 F2)", async () => {
  uploadsNumbered();
  chooseSeveral([jpeg("a.jpg"), jpeg("b.jpg")]);
  await screen.findByRole("button", { name: "Read all" });

  await typeInFirstAndFile("10.00");
  expect(screen.getByText("Filed as alex's line in the period.")).toBeTruthy();

  // Another from the same photo is the photo's part 2, not part 1 again.
  await typeInFirstAndFile("20.00");
  expect(vi.mocked(fileReceipt).mock.calls.map(([id, request]) => [id, request.part])).toEqual([
    [11, 1],
    [11, 2],
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Read it" }));
  await screen.findByText("1 of 1 read");
  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([12]);
});

test("a receipt typed in from a photo whose read failed shows it filed and drops the failure (lg-92 F2)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockRejectedValue(new AppError("INTERNAL", "The reader broke."));
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await screen.findByText("The read failed: The reader broke.");

  await typeInFirstAndFile("10.00");

  expect(screen.getByText("Filed as alex's line in the period.")).toBeTruthy();
  expect(screen.queryByText(/The read failed/u)).toBeNull();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("Start over waits while photos are still going up (lg-92 F4)", async () => {
  let finish: (receipt: UploadedReceipt) => void = () => {};
  vi.mocked(uploadReceipt).mockReturnValue(
    new Promise<UploadedReceipt>((resolve) => {
      finish = resolve;
    }),
  );
  chooseSeveral([jpeg("a.jpg")]);

  const startOver = await screen.findByRole("button", { name: "Start over" });
  expect((startOver as HTMLButtonElement).disabled).toBe(true);

  await act(async () => {
    finish(RECEIPT);
    await Promise.resolve();
  });
  await waitFor(() => expect((startOver as HTMLButtonElement).disabled).toBe(false));
});

test("a second Read all while one is running reads nothing twice (lg-92 F5)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockImplementation(async (id) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return oneShopEach(id);
  });
  const { result } = renderHook(() => useReceiptQueue(), { wrapper: clientWrapper() });
  await act(async () => {
    result.current.add([jpeg("a.jpg"), jpeg("b.jpg")]);
  });
  await waitFor(() => expect(result.current.photos.every((p) => p.phase === "kept")).toBe(true));

  // Both calls in one tick: the second meets the first's guard, not its disabled button.
  await act(async () => {
    result.current.readAll();
    result.current.readAll();
  });
  await waitFor(() => expect(result.current.photos.every((p) => p.phase === "read")).toBe(true));

  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11, 12]);
});

test("a photo refused five times in a row is reported failed, with a retry, and not asked again (lg-92 F5)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockRejectedValue(
    new AppError("RATE_LIMITED", undefined, { details: { retryAfterSec: 1 } }),
  );
  vi.useFakeTimers();
  try {
    chooseSeveral([jpeg("a.jpg")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // The first ask and five waits: six asks, then it stops.
    expect(readReceipt).toHaveBeenCalledTimes(6);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText(/The read failed/u)).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});

test("leaving the screen during a wait reads nothing more (lg-92 F5)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockRejectedValue(
    new AppError("RATE_LIMITED", undefined, { details: { retryAfterSec: 5 } }),
  );
  vi.useFakeTimers();
  try {
    const { unmount } = chooseSeveral([jpeg("a.jpg")]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Read it" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readReceipt).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(readReceipt).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

// --- lg-90: a Shared box on each item, and a select of whose it is once unchecked ---

test.each([
  ["two", ["alex", "sam"], ["Mine", "sam"]],
  ["three", ["alex", "casey", "sam"], ["Mine", "casey", "sam"]],
])(
  "on a household of %s an unchecked item offers Mine and each other member, and a checked one offers nothing (lg-90)",
  async (_name, members, offered) => {
    vi.mocked(fetchHousehold).mockResolvedValue(household(members));
    await readBasket();

    expect(screen.queryByLabelText(/^Whose is/u)).toBeNull();
    leaveOut("SAVON");

    expect(optionsOf(whoseSelect("SAVON"))).toEqual(offered);
    // Mine is the start; a person is only ever picked.
    expect(whoseSelect("SAVON").value).toBe("");
    // Only the unchecked item carries one.
    expect(screen.getAllByLabelText(/^Whose is/u)).toHaveLength(1);
  },
);

test("among three people, checking a charged item again files it shared with nobody charged (lg-90)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: 9,
    chargeLineId: 10,
    charges: [{ chargedTo: "casey", lineId: 10, owedToPot: false }],
    rowId: null,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();
  leaveOut("BIERE 6X355");
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });
  leaveOut("SAVON");
  fireEvent.change(whoseSelect("SAVON"), { target: { value: "casey" } });
  // The six-pack is shared after all: the person it was charged to is gone with the box.
  fireEvent.click(sharedBox("BIERE 6X355"));
  expect(shared()).toBe("Not shared 0.00 $ · casey's 5.74 $ · Shared 19.02 $");

  await fileFromQueue();

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi
      .mocked(fileReceipt)
      .mock.calls[0]?.[1].proposal.items.map((item) => [item.share, item.chargedTo]),
  ).toEqual([
    ["shared", null],
    ["shared", null],
    ["theirs", "casey"],
  ]);
});

test("each unchecked item shows what it takes off, and one person's items sum to their total (lg-90)", async () => {
  await readBasket();

  // Checked items show nothing.
  expect(screen.queryByText(/^Takes off/u)).toBeNull();
  leaveOut("PAIN");
  leaveOut("SAVON");

  const list = screen.getByRole("list", { name: "The items" });
  const takes = within(list)
    .getAllByText(/^Takes off/u)
    .map((node) => node.textContent);
  // Each item through `sharedAmount` alone: the bread has no tax, the soap has both.
  expect(takes).toEqual(["Takes off 3.49 $", "Takes off 5.74 $"]);
  // Both are Mine, so the live line's "Not shared" is their sum, 9.23 $.
  expect(shared()).toBe("Not shared 9.23 $ · sam's 0.00 $ · Shared 15.53 $");

  // Handed to sam, the same two sum to what sam is charged.
  fireEvent.change(whoseSelect("PAIN"), { target: { value: "sam" } });
  fireEvent.change(whoseSelect("SAVON"), { target: { value: "sam" } });
  expect(shared()).toBe("Not shared 0.00 $ · sam's 9.23 $ · Shared 15.53 $");
  // Checking one back takes its amount off the page, and the total follows.
  fireEvent.click(sharedBox("SAVON"));
  expect(within(list).getAllByText(/^Takes off/u)).toHaveLength(1);
  expect(shared()).toBe("Not shared 0.00 $ · sam's 3.49 $ · Shared 21.27 $");
});

// Each item is rounded alone, as `sharedAmount` is asked of it, and the split
// rounds a person's items together once: two taxable items can differ by a cent.
// Pinned so the difference is a known one, not a surprise (lg-90's Log).
test("two taxable items can show a cent more apart than the split takes off together (lg-90)", async () => {
  await readBasket();
  leaveOut("BIERE 6X355");
  leaveOut("SAVON");

  const list = screen.getByRole("list", { name: "The items" });
  expect(
    within(list)
      .getAllByText(/^Takes off/u)
      .map((node) => node.textContent),
  ).toEqual(["Takes off 15.54 $", "Takes off 5.74 $"]);
  expect(shared()).toBe("Not shared 21.27 $ · sam's 0.00 $ · Shared 3.49 $");
});

// The Mine choice's value is one no person id can take: the contract's
// `chargedTo` is `z.string().min(1).max(100)`, so "" is refused there. A member
// whose id was the sentinel itself was filed `not-shared` (lg-90's gate 1).
test("a member whose person id is mine is charged as theirs, not kept as Mine (lg-90)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "mine", "sam"]));
  await readBasket();
  leaveOut("BIERE 6X355");
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "mine" } });
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  const filed = vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items[1];
  expect([filed?.share, filed?.chargedTo]).toEqual(["theirs", "mine"]);
});

test("the camera and the gallery feed one queue, and its words follow the count", async () => {
  uploadsNumbered();
  await takePhoto();

  await screen.findByRole("button", { name: "Read it" });
  expect(screen.getByRole("heading", { name: "Receipt" })).toBeTruthy();
  expect(screen.getByText(/Reading sends this photo out of the house/u)).toBeTruthy();

  fireEvent.change(field("Choose photos of receipts"), { target: { files: [jpeg("b.jpg")] } });

  await screen.findByRole("button", { name: "Read all" });
  expect(screen.getByRole("heading", { name: "Receipts" })).toBeTruthy();
  expect(screen.getByText(/Reading sends these photos out of the house/u)).toBeTruthy();
});

test("a photo of one receipt is summed up in the queue, opens from it, files back, and offers another", async () => {
  await takePhoto();
  await readOne();
  await screen.findByLabelText("Total");
  await fileFromQueue();

  await screen.findByText("Marché Exemple, 26.50 $, filed");
  fireEvent.click(screen.getByRole("button", { name: "Type another receipt from this photo" }));

  expect(field("Merchant").value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
  expect(readReceipt).toHaveBeenCalledTimes(1);
});

// --- lg-91: an item left out of a joint-account row, owed to the pot ---

/** The basket's row on the joint account, for its whole total. */
function basketRow(): void {
  vi.mocked(fetchReceiptMatches).mockResolvedValue([
    {
      rowId: 41,
      date: "2026-10-03",
      description: "Achat /Marché Exemple",
      amountCents: -2_476,
      daysApart: 1,
    },
  ]);
}

const NOBODY_CHOSEN =
  "Choose whose each item left out is: a joint-account purchase has no payer to keep one.";

test("paid with the joint card, an item left out offers every member and no Mine, and nothing is chosen until one is picked (lg-91)", async () => {
  basketRow();
  await readBasket();
  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });

  leaveOut("BIERE 6X355");

  // alex took the photo, and is offered too: a joint purchase has no payer.
  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["Whose?", "alex", "sam"]);
  expect(whoseSelect("BIERE 6X355").value).toBe("");
  expect(shared()).toBe("Whose not chosen yet 15.54 $ · Shared 9.22 $");
  expect(screen.getByText(NOBODY_CHOSEN)).toBeTruthy();
  // No line to file: the joint account paid.
  expect(screen.queryByRole("button", { name: /^File as/u })).toBeNull();

  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });

  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["alex", "sam"]);
  expect(shared()).toBe("Owed to the pot by sam 15.54 $ · Shared 9.22 $");
  expect(screen.queryByText(NOBODY_CHOSEN)).toBeNull();
  // Picking whose keeps the rows found.
  expect(screen.getByRole("button", { name: "Attach to this row" })).toBeTruthy();
});

test.each(["sam", "alex"])(
  "attached to a joint-account row, an item left out is filed as the person chosen's, %s (lg-91)",
  async (person) => {
    basketRow();
    vi.mocked(fileReceipt).mockResolvedValue({
      id: 1,
      receiptId: 3,
      part: 1,
      proposal: BASKET,
      periodLineId: null,
      chargeLineId: null,
      charges: [{ chargedTo: person, lineId: 10, owedToPot: true }],
      rowId: 41,
      filedAt: "x",
      filedBy: "alex",
    });
    await readBasket();
    payJointly();
    await screen.findByRole("button", { name: "Attach to this row" });
    leaveOut("BIERE 6X355");
    fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: person } });

    fireEvent.click(screen.getByRole("button", { name: "Attach to this row" }));

    await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
    const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
    expect(request?.destination).toEqual({ to: "row", rowId: 41 });
    expect(request?.proposal.items.map((item) => [item.share, item.chargedTo])).toEqual([
      ["shared", null],
      ["theirs", person],
      ["shared", null],
    ]);
    expect(
      await screen.findByText(
        `Attached to the joint-account row, and ${person}'s items as a charge to the pot.`,
      ),
    ).toBeTruthy();
  },
);

test("an item left as Mine names nobody once paid jointly, and is Mine again on my own card (lg-91)", async () => {
  basketRow();
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "casey", "sam"]));
  await readBasket();
  leaveOut("BIERE 6X355");
  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["Mine", "casey", "sam"]);

  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });

  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["Whose?", "alex", "casey", "sam"]);
  expect(whoseSelect("BIERE 6X355").value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Attach to this row" }));
  expect((await screen.findByRole("alert")).textContent).toBe(NOBODY_CHOSEN);
  expect(fileReceipt).not.toHaveBeenCalled();

  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "alex" } });
  payBy("alex");

  // Charged to whoever took the photo is theirs to keep, on their own card.
  expect(optionsOf(whoseSelect("BIERE 6X355"))).toEqual(["Mine", "casey", "sam"]);
  expect(whoseSelect("BIERE 6X355").value).toBe("");
  expect(screen.queryByRole("button", { name: "Attach to this row" })).toBeNull();
  // A line is filed from the list (lg-102): the receipt has no File it off the joint card.
  expect(screen.queryByRole("button", { name: "File it" })).toBeNull();
  // And it files as alex's line, the six-pack alex's to keep.
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
  expect(request?.destination).toMatchObject({ to: "line", paidBy: null, chargedTo: null });
  expect(request?.proposal.items.map((item) => [item.share, item.chargedTo])).toEqual([
    ["shared", null],
    ["not-shared", null],
    ["shared", null],
  ]);
});

const UNPICKED_CHARGE =
  "Choose whose each item left out is: the receipt's charge for it names no other member of the household.";

/** A read item marked someone else's, charged to a person who has left or to nobody (lg-94). */
async function readBasketCharged(chargedTo: string | null): Promise<void> {
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          items: BASKET.items.map((item) =>
            item.text === "BIERE 6X355" ? { ...item, share: "theirs" as const, chargedTo } : item,
          ),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
}

function filedItems(): unknown {
  const filed = vi.mocked(fileReceipt).mock.calls.at(-1)?.[1];
  return filed?.proposal.items.map((item) => [item.text, item.share, item.chargedTo]);
}

test.each([
  ["C1 two+left dana", ["alex", "sam"], ["dana"], "dana", null],
  ["C2 three+left dana", ["alex", "casey", "sam"], ["dana"], "dana", "casey"],
  ["C3 three, read null", ["alex", "casey", "sam"], [], null, "casey"],
])(
  "a read item charged to someone who has left, or to nobody, files nothing until a current member is picked: %s (lg-94)",
  async (_name, members, left, chargedTo, picked) => {
    vi.mocked(fetchHousehold).mockResolvedValue(household(members, left));
    await readBasketCharged(chargedTo);

    // Not the first other, and not Mine: nobody, said on the select.
    const select = whoseSelect("BIERE 6X355");
    expect(select.selectedOptions[0]?.text).toBe("Whose?");
    expect(select.selectedOptions[0]?.disabled).toBe(true);
    expect(optionsOf(select)).toEqual(["Whose?", "Mine", ...members.slice(1)]);
    expect(screen.getByText(UNPICKED_CHARGE)).toBeTruthy();
    // The live line does not charge the first other either.
    expect(shared()).toBe("Not shared 0.00 $ · Whose not chosen yet 15.54 $ · Shared 9.22 $");

    await fileFromQueue();
    expect(await rowRefusal()).toBe(UNPICKED_CHARGE);
    expect(fileReceipt).not.toHaveBeenCalled();

    // Picking a current member is the choice, and the form files it.
    reopen();
    fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: members[1] } });
    expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe(members[1]);
    // The refusal's hint is gone.
    expect(document.querySelector("p.hint.bad")).toBeNull();
    await fileFromQueue();
    await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
    expect(filedItems()).toEqual([
      ["PAIN", "shared", null],
      ["BIERE 6X355", "theirs", picked === null ? null : members[1]],
      ["SAVON", "shared", null],
    ]);
  },
);

test("an unpicked read charge can be answered Mine, which files it not shared (lg-94)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"], ["dana"]));
  await readBasketCharged("dana");

  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "" } });

  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Mine");
  expect(screen.queryByText(UNPICKED_CHARGE)).toBeNull();
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "shared", null],
    ["BIERE 6X355", "not-shared", null],
    ["SAVON", "shared", null],
  ]);
});

test("a read charge to a member who is still here keeps its person, and nothing is unpicked (lg-94)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  await readBasketCharged("sam");

  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("sam");
  expect(screen.queryByText(UNPICKED_CHARGE)).toBeNull();
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "shared", null],
    ["BIERE 6X355", "theirs", "sam"],
    ["SAVON", "shared", null],
  ]);
});

test("with nobody else, a read charge to someone who has left is refused as before (lg-94 C0)", async () => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex"], ["dana"]));
  await readBasketCharged("dana");

  await fileFromQueue();

  expect(await rowRefusal()).toBe("There is nobody else in the household to charge an item to.");
  expect(fileReceipt).not.toHaveBeenCalled();
});

test.each([
  ["nobody", null],
  ["the payer", "alex"],
])(
  "a read charge to %s is still unpicked after the joint card and back to my own, and files nothing (lg-94)",
  async (_name, chargedTo) => {
    basketRow();
    vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
    vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "casey", "sam"]));
    await readBasketCharged(chargedTo);
    expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Whose?");

    payJointly();
    await screen.findByRole("button", { name: "Attach to this row" });
    payBy("alex");

    // Not turned into Mine on the way back: nobody chose that.
    expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Whose?");
    await fileFromQueue();
    expect(await rowRefusal()).toBe(UNPICKED_CHARGE);
    expect(fileReceipt).not.toHaveBeenCalled();
  },
);

test("an item the person picked on the joint card is Mine again on my own card, a read one or not (lg-94)", async () => {
  basketRow();
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "casey", "sam"]));
  await readBasketCharged(null);

  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "alex" } });
  payBy("alex");

  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Mine");
});

test("a refusal's words are true for a name the books never held, the payer and a departed member alike (lg-94)", async () => {
  // Each charge is a different reason for the same refusal: a name the books never held (zed),
  // the payer (alex), a member who has left (dana).
  for (const [chargedTo, left] of [
    ["zed", []],
    ["alex", []],
    ["dana", ["dana"]],
  ] as const) {
    vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"], left));
    await readBasketCharged(chargedTo);

    expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Whose?");
    expect(screen.getByText(UNPICKED_CHARGE)).toBeTruthy();
    cleanup();
  }
  // The words claim nothing about why: a departed member, the payer and nobody are all named by it.
  expect(UNPICKED_CHARGE).not.toMatch(/has left|to nobody/u);
});

test("an item unchecked while paid jointly is Mine again on my own card, though the read charged it to nobody (lg-94)", async () => {
  basketRow();
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "casey", "sam"]));
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "casey", "sam"]));
  await readBasketCharged(null);

  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });
  // The person's own taps on the Shared box clear what the read proposed.
  fireEvent.click(sharedBox("BIERE 6X355"));
  fireEvent.click(sharedBox("BIERE 6X355"));
  payBy("alex");

  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("Mine");
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "shared", null],
    ["BIERE 6X355", "not-shared", null],
    ["SAVON", "shared", null],
  ]);
});

test("with one other member, a read charge to nobody stays theirs through the joint card and back (lg-94)", async () => {
  basketRow();
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex", "sam"]));
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex", "sam"]));
  await readBasketCharged(null);
  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("sam");

  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });
  payBy("alex");

  // Not Mine: nobody chose that, and the one other member is still the item's.
  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("sam");
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "shared", null],
    ["BIERE 6X355", "theirs", null],
    ["SAVON", "shared", null],
  ]);
});

test("with nobody else, a read charge to nobody is still refused after the joint card and back (lg-94)", async () => {
  basketRow();
  vi.mocked(fetchHousehold).mockResolvedValue(household(["alex"]));
  vi.mocked(fetchPeople).mockResolvedValue(peopleAnswer(["alex"]));
  await readBasketCharged(null);

  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });
  payBy("alex");

  await fileFromQueue();
  expect(await rowRefusal()).toBe("There is nobody else in the household to charge an item to.");
  expect(fileReceipt).not.toHaveBeenCalled();
});

// --- The receipt view's QoL pass: one receipt summed up, a rebate typed positive, the marks held ---

const TAXABLE_MATTERS =
  "The items marked taxable do not give the taxes printed, and they set what an item left out or each category comes to. Check which items are taxable to file.";

/**
 * "Read it", then the one receipt it read opened from the queue: even a single
 * receipt is summed up in the list before its form opens.
 */
async function readOne(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  const parts = await screen.findByRole("list", { name: /^Receipts in /u });
  // The row's first button opens it; the other takes it out of the list.
  fireEvent.click(within(parts).getAllByRole("button")[0] as HTMLElement);
}

test("reading one photo of one receipt stays on the queue, with the receipt summed up there", async () => {
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  const parts = await screen.findByRole("list", { name: "Receipts in receipt.jpg" });
  expect(within(parts).getByRole("button", { name: "Marché Exemple, 26.50 $" })).toBeTruthy();
  expect(screen.queryByLabelText("Total")).toBeNull();
});

test("a rebate typed positive comes off a purchase, and a typed minus is the same rebate", async () => {
  await readBasket();
  fireEvent.change(field("Subtotal"), { target: { value: "20.07" } });
  fireEvent.change(field("GST (TPS)"), { target: { value: "0.80" } });
  fireEvent.change(field("QST (TVQ)"), { target: { value: "1.59" } });
  fireEvent.change(field("Total"), { target: { value: "22.46" } });

  fireEvent.change(field("Rebate on BIERE 6X355"), { target: { value: "2.00" } });
  expect(screen.getByText("It adds up.")).toBeTruthy();
  fireEvent.change(field("Rebate on BIERE 6X355"), { target: { value: "-2.00" } });
  expect(screen.getByText("It adds up.")).toBeTruthy();

  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items.map((item) => item.discount),
  ).toEqual([null, -200, null]);
});

test("a rebate typed positive on a refunded item is filed against the refund", async () => {
  await readBasket();
  fireEvent.click(screen.getByRole("button", { name: "Add an item" }));
  fireEvent.change(field("Text of item 4"), { target: { value: "RETOUR" } });
  fireEvent.change(field("Price of RETOUR"), { target: { value: "-5.00" } });
  fireEvent.change(field("Rebate on RETOUR"), { target: { value: "1.00" } });
  // The items now make 4.00 $ less: a rebate turned against the refund would make 2.00 $ less.
  fireEvent.change(field("Total"), { target: { value: "20.76" } });
  expect(
    screen.queryByText(
      "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
    ),
  ).toBeNull();

  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(
    vi.mocked(fileReceipt).mock.calls[0]?.[1].proposal.items.map((item) => item.discount),
  ).toEqual([null, null, null, 100]);
});

test("a wrong Taxable mark refuses filing once an item is left out, and not on a shared receipt of one category", async () => {
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          items: BASKET.items.map((item) => ({ ...item, spendingCategoryId: 1 })),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
  fireEvent.click(screen.getAllByLabelText("Taxable")[1] as HTMLElement);

  // All shared, one category: the mark moves no money, so it is only flagged.
  expect(screen.queryByText(TAXABLE_MATTERS)).toBeNull();

  leaveOut("BIERE 6X355");
  expect(screen.getByText(TAXABLE_MATTERS)).toBeTruthy();
  await fileFromQueue();
  expect(await rowRefusal()).toBe(TAXABLE_MATTERS);
  expect(fileReceipt).not.toHaveBeenCalled();

  reopen();
  fireEvent.click(sharedBox("BIERE 6X355"));
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
});

test("a line the reader made up is deleted from a small mark at its row's end", async () => {
  await readBasket();
  const deleting = screen.getByRole("button", { name: "Delete SAVON" });
  expect(deleting.textContent).toBe("×");
  expect(deleting.title).toBe("Delete this line, if it is not on the receipt");

  fireEvent.click(deleting);

  expect(screen.queryByLabelText("Text of SAVON")).toBeNull();
  expect(
    screen.getByText(
      "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
    ),
  ).toBeTruthy();
});

test("paid with the joint card, a wrong Taxable mark refuses attaching items in several categories to the row", async () => {
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
  fireEvent.click(screen.getAllByLabelText("Taxable")[1] as HTMLElement);

  // All shared and filed as a line, the basket's three categories divide nothing.
  expect(screen.queryByText(TAXABLE_MATTERS)).toBeNull();

  // On the row they do: the chart splits it by its items' categories (`splitByCategory`).
  payJointly();
  expect(screen.getByText(TAXABLE_MATTERS)).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));
  expect((await screen.findByRole("alert")).textContent).toBe(TAXABLE_MATTERS);
  expect(fileReceipt).not.toHaveBeenCalled();

  fireEvent.click(screen.getAllByLabelText("Taxable")[1] as HTMLElement);
  fireEvent.click(screen.getByRole("button", { name: "File it" }));
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toEqual({ to: "row", rowId: 41 });
});

test("paid with the joint card, a wrong Taxable mark still attaches a shared receipt of one category", async () => {
  vi.mocked(fetchReceiptMatches).mockResolvedValue([
    {
      rowId: 41,
      date: "2026-10-03",
      description: "Achat /Marché Exemple",
      amountCents: -2_476,
      daysApart: 1,
    },
  ]);
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          items: BASKET.items.map((item) => ({ ...item, spendingCategoryId: 1 })),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
  fireEvent.click(screen.getAllByLabelText("Taxable")[1] as HTMLElement);

  // One category on the row: the split gives it the whole amount whatever the marks.
  payJointly();
  expect(screen.queryByText(TAXABLE_MATTERS)).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Attach to this row" }));
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toEqual({ to: "row", rowId: 41 });
});

// --- lg-102: who paid and whose, picked in the list, and several receipts filed at once ---

/** Three photos read, one shop each (Shop 11, 12 and 13), every receipt selected. */
async function threeReadAndSelected(): Promise<void> {
  uploadsNumbered();
  vi.mocked(readReceipt).mockImplementation(async (id) => oneShopEach(id));
  chooseSeveral(THREE.map((name) => jpeg(name)));
  fireEvent.click(await screen.findByRole("button", { name: "Read all" }));
  await screen.findByText("3 of 3 read");
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select all" }));
}

/** Each filing's receipt id, as the list sent them. */
function filedIds(): number[] {
  return vi.mocked(fileReceipt).mock.calls.map(([id]) => id);
}

test("Paid by and Whose set on three selected rows file three receipts, one at a time, each marked filed (lg-102)", async () => {
  let inFlight = 0;
  let widest = 0;
  vi.mocked(fileReceipt).mockImplementation(async (id, request) => {
    inFlight += 1;
    widest = Math.max(widest, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return {
      id,
      receiptId: id,
      part: request.part,
      proposal: request.proposal,
      periodLineId: id * 10,
      chargeLineId: null,
      charges: [],
      rowId: null,
      filedAt: "x",
      filedBy: "alex",
    };
  });
  await threeReadAndSelected();

  // Each row carries both picks: whoever took the photo paid, and it is shared.
  const row = screen.getByLabelText("Paid by, Shop 12, 10.00 $") as HTMLSelectElement;
  expect(optionsOf(row)).toEqual(["alex", "sam", "Joint card"]);
  expect(row.value).toBe("alex");
  expect(optionsOf(screen.getByLabelText("Whose, Shop 12, 10.00 $"))).toEqual([
    "Shared",
    "sam's — owes all of it",
  ]);

  // Each row's picks are set on the row; the bar only selects and files (the owner, 2026-11-08).
  for (const shop of ["Shop 11", "Shop 12", "Shop 13"]) {
    fireEvent.change(screen.getByLabelText(`Paid by, ${shop}, 10.00 $`), {
      target: { value: "sam" },
    });
    fireEvent.change(screen.getByLabelText(`Whose, ${shop}, 10.00 $`), {
      target: { value: "alex" },
    });
  }
  expect(screen.queryByLabelText(/for the selected$/u)).toBeNull();
  for (const shop of ["Shop 11", "Shop 12", "Shop 13"]) {
    expect((screen.getByLabelText(`Paid by, ${shop}, 10.00 $`) as HTMLSelectElement).value).toBe(
      "sam",
    );
    expect((screen.getByLabelText(`Whose, ${shop}, 10.00 $`) as HTMLSelectElement).value).toBe(
      "alex",
    );
  }

  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await screen.findByText("Shop 13, 10.00 $, filed");
  expect(filedIds()).toEqual([11, 12, 13]);
  expect(widest).toBe(1);
  for (const [, request] of vi.mocked(fileReceipt).mock.calls) {
    expect(request.destination).toEqual({
      to: "line",
      date: "2026-10-04",
      amountCents: 1_000,
      spendingCategoryId: null,
      note: request.proposal.merchant,
      chargedTo: "alex",
      paidBy: "sam",
    });
  }
  expect(screen.getByText("Shop 11, 10.00 $, filed")).toBeTruthy();
  expect(screen.getByText("Shop 12, 10.00 $, filed")).toBeTruthy();
  expect(screen.getAllByText("Filed as sam's line in the period.")).toHaveLength(3);
  // Nothing is left to select, so the bar is gone.
  expect(screen.queryByRole("button", { name: "File selected" })).toBeNull();
});

test("each row shows Filing… while its own filing is out, and not before (lg-102)", async () => {
  const answers: (() => void)[] = [];
  vi.mocked(fileReceipt).mockImplementation(
    (id, request) =>
      new Promise((resolve) => {
        answers.push(() =>
          resolve({
            id,
            receiptId: id,
            part: request.part,
            proposal: request.proposal,
            periodLineId: id * 10,
            chargeLineId: null,
            charges: [],
            rowId: null,
            filedAt: "x",
            filedBy: "alex",
          }),
        );
      }),
  );
  await threeReadAndSelected();
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await waitFor(() => expect(answers).toHaveLength(1));
  const rows = within(screen.getByRole("list", { name: "The photos" })).getAllByRole("list");
  expect(rows.map((list) => within(list).queryByText("Filing…") !== null)).toEqual([
    true,
    false,
    false,
  ]);

  await act(async () => {
    answers[0]?.();
  });
  await waitFor(() => expect(answers).toHaveLength(2));
  expect(screen.getByText("Shop 11, 10.00 $, filed")).toBeTruthy();
  expect(rows.map((list) => within(list).queryByText("Filing…") !== null)).toEqual([
    false,
    true,
    false,
  ]);
  await act(async () => {
    answers[1]?.();
  });
  await waitFor(() => expect(answers).toHaveLength(3));
  await act(async () => {
    answers[2]?.();
  });
  await screen.findByText("Shop 13, 10.00 $, filed");
});

/** Three photos, the second read as `second`; every receipt selected and filed from the bar. */
async function fileThreeWithSecond(second: ReceiptProposal): Promise<void> {
  uploadsNumbered();
  vi.mocked(readReceipt).mockImplementation(async (id) =>
    id === 12
      ? {
          receiptId: id,
          model: "claude-haiku-5-5",
          proposals: [{ proposal: second, flags: [], merchantCategoryId: null }],
        }
      : oneShopEach(id),
  );
  chooseSeveral(THREE.map((name) => jpeg(name)));
  fireEvent.click(await screen.findByRole("button", { name: "Read all" }));
  await screen.findByText("3 of 3 read");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));
  await screen.findByText("Shop 13, 10.00 $, filed");
}

test("a selected row whose items do not add up is not filed and says why, and the others file (lg-102)", async () => {
  await fileThreeWithSecond({
    ...BASKET,
    items: BASKET.items.map((item) => (item.text === "PAIN" ? { ...item, price: 348 } : item)),
  });

  expect(filedIds()).toEqual([11, 13]);
  expect(screen.getByText("Shop 11, 10.00 $, filed")).toBeTruthy();
  expect(await rowRefusal()).toBe(
    "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
  );
  // Still in the list, selected, to be opened and corrected.
  const basket = screen.getByRole("checkbox", {
    name: "Select Marché Exemple, 24.76 $",
  }) as HTMLInputElement;
  expect(basket.checked).toBe(true);
  expect(screen.getByRole("button", { name: "Marché Exemple, 24.76 $" })).toBeTruthy();
});

test("a selected row whose Taxable marks are held is not filed and says why, and the others file (lg-102)", async () => {
  // The six-pack's mark misread, and the six-pack left out: the mark moves money (#748).
  await fileThreeWithSecond({
    ...BASKET,
    items: BASKET.items.map((item) =>
      item.text === "BIERE 6X355"
        ? { ...item, taxable: false, share: "not-shared" as const, spendingCategoryId: 1 }
        : { ...item, spendingCategoryId: 1 },
    ),
  });

  expect(filedIds()).toEqual([11, 13]);
  expect(await rowRefusal()).toBe(TAXABLE_MATTERS);
});

test("paid with the joint card, a row is attached on exactly one match, and left for the person on none or two (lg-102)", async () => {
  const row = (rowId: number) => ({
    rowId,
    date: "2026-10-04",
    description: `Achat /Shop ${String(rowId)}`,
    amountCents: -1_000,
    daysApart: 0,
  });
  vi.mocked(fetchReceiptMatches).mockImplementation(async (id) =>
    id === 11 ? [row(41)] : id === 12 ? [row(42), row(43)] : [],
  );
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 11,
    part: 1,
    proposal: READ,
    periodLineId: null,
    chargeLineId: null,
    charges: [],
    rowId: 41,
    filedAt: "x",
    filedBy: "alex",
  });
  await threeReadAndSelected();

  for (const shop of ["Shop 11", "Shop 12", "Shop 13"]) {
    fireEvent.change(screen.getByLabelText(`Paid by, ${shop}, 10.00 $`), { target: { value: "" } });
  }
  // Whose each item is goes item by item on the joint card (lg-91): the whole receipt's is held.
  expect((screen.getByLabelText("Whose, Shop 11, 10.00 $") as HTMLSelectElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await screen.findByText("Shop 11, 10.00 $, filed");
  expect(screen.getByText("Attached to the joint-account row.")).toBeTruthy();
  await waitFor(() => expect(fetchReceiptMatches).toHaveBeenCalledTimes(3));
  expect(vi.mocked(fetchReceiptMatches).mock.calls).toEqual([
    [11, 1_000, "2026-10-04"],
    [12, 1_000, "2026-10-04"],
    [13, 1_000, "2026-10-04"],
  ]);
  expect(vi.mocked(fileReceipt).mock.calls).toEqual([
    [11, { part: 1, proposal: readAs("Shop 11"), destination: { to: "row", rowId: 41 } }],
  ]);
  // Two rows, and none: both are left for the person to choose, opened.
  await waitFor(() =>
    expect(screen.getAllByText("Not filed: Open it to choose the row.")).toHaveLength(2),
  );
  expect(screen.getByRole("button", { name: "Shop 12, 10.00 $" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Shop 13, 10.00 $" })).toBeTruthy();

  // Opened, the receipt is on the joint card, and File it lists both rows to choose from.
  fireEvent.click(screen.getByRole("button", { name: "Shop 12, 10.00 $" }));
  expect((screen.getByLabelText("Paid by") as HTMLSelectElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "File it" }));
  expect(await screen.findAllByRole("button", { name: "Attach to this row" })).toHaveLength(2);
});

/** `READ` as the list files it, under another merchant: one shop per photo. */
function readAs(merchant: string): ReceiptProposal {
  return { ...READ, merchant, total: 1_000 };
}

test("an edit made in the receipt view is still there after Back to the queue, and is what the batch files (lg-102)", async () => {
  await threeReadAndSelected();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));

  fireEvent.click(screen.getByRole("button", { name: "Shop 12, 10.00 $" }));
  fireEvent.change(field("Merchant"), { target: { value: "Boulangerie" } });
  fireEvent.change(field("Total"), { target: { value: "12.00" } });
  fireEvent.change(screen.getByLabelText("Paid by"), { target: { value: "sam" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));

  // The row reads as edited, with its picks.
  expect(screen.getByRole("button", { name: "Boulangerie, 12.00 $" })).toBeTruthy();
  expect((screen.getByLabelText("Paid by, Boulangerie, 12.00 $") as HTMLSelectElement).value).toBe(
    "sam",
  );
  // Opened again, the form is as it was left.
  fireEvent.click(screen.getByRole("button", { name: "Boulangerie, 12.00 $" }));
  expect(field("Merchant").value).toBe("Boulangerie");
  expect(field("Charged to the card (with any tip)").value).toBe("12.00");
  expect((screen.getByLabelText("Paid by") as HTMLSelectElement).value).toBe("sam");
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));

  fireEvent.click(screen.getByRole("checkbox", { name: "Select Boulangerie, 12.00 $" }));
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]).toEqual([
    12,
    {
      part: 1,
      proposal: { ...READ, merchant: "Boulangerie", total: 1_200 },
      destination: {
        to: "line",
        date: "2026-10-04",
        amountCents: 1_200,
        spendingCategoryId: null,
        note: "Boulangerie",
        chargedTo: null,
        paidBy: "sam",
      },
    },
  ]);
});

test.each([
  ["two", ["alex", "sam"]],
  ["three", ["alex", "casey", "sam"]],
])(
  "on a household of %s the receipt view has no line-filing button and no This was …'s box (lg-102)",
  async (_name, members) => {
    vi.mocked(fetchHousehold).mockResolvedValue(household(members));
    await readBasket();

    expect(screen.queryByRole("button", { name: /^File as/u })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /^This was/u })).toBeNull();
    expect(screen.queryByText(/^This was/u)).toBeNull();
    expect(screen.queryByLabelText("Whose it was")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Paid with/u })).toBeNull();
    // Off the joint card there is nothing to file here: File it is the joint card's.
    expect(screen.queryByRole("button", { name: "File it" })).toBeNull();
    // Their meaning is the two selects at the top, which the row in the list shares.
    expect(optionsOf(screen.getByLabelText("Paid by"))).toEqual([...members, "Joint card"]);
    expect(optionsOf(screen.getByLabelText("Whose"))).toEqual([
      "Shared",
      ...members.slice(1).map((person) => `${person}'s — owes all of it`),
    ]);
    payJointly();
    expect(screen.getByRole("button", { name: "File it" })).toBeTruthy();
    expect((screen.getByLabelText("Whose") as HTMLSelectElement).disabled).toBe(true);
  },
);

test("who paid carries each item's choice with it: the old payer's item is charged to them, and the new payer's is theirs to keep (lg-102)", async () => {
  await readBasket();
  leaveOut("PAIN");
  leaveOut("SAVON");
  fireEvent.change(whoseSelect("SAVON"), { target: { value: "sam" } });
  expect(shared()).toBe("Not shared 3.49 $ · sam's 5.74 $ · Shared 15.53 $");

  payBy("sam");

  // The bread stayed with alex, who did not pay; the soap is sam's, who did.
  expect(optionsOf(whoseSelect("PAIN"))).toEqual(["sam", "alex"]);
  expect(whoseSelect("PAIN").value).toBe("alex");
  expect(whoseSelect("SAVON").value).toBe("");
  expect(shared()).toBe("Not shared 5.74 $ · alex's 3.49 $ · Shared 15.53 $");
  await fileFromQueue();

  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "theirs", null],
    ["BIERE 6X355", "shared", null],
    ["SAVON", "not-shared", null],
  ]);
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toMatchObject({
    to: "line",
    paidBy: "sam",
    chargedTo: null,
  });
});

test("a receipt typed in and left blank leaves no row, and one typed is listed to be filed (lg-102)", async () => {
  uploadsNumbered();
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));

  expect(screen.getByText("Kept, not read yet.")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Receipts in a.jpg" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Type it in" }));
  fireEvent.change(field("Merchant"), { target: { value: "Dépanneur" } });
  fireEvent.change(field("Total"), { target: { value: "4.00" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));

  const parts = screen.getByRole("list", { name: "Receipts in a.jpg" });
  expect(within(parts).getByRole("button", { name: "Dépanneur, 4.00 $" })).toBeTruthy();
  // Typed in, it is handled: Read it no longer spends a read on the photo.
  expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();
});

// --- lg-102 round 1: gate 1's surviving plants ---

test("a receipt with no amount charged, or no date, is held in the list and says why, as its form would (lg-102 gate 1, M13)", async () => {
  uploadsNumbered();
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));
  fireEvent.change(field("Merchant"), { target: { value: "Kiosque" } });
  await fileFromQueue();

  expect(await rowRefusal()).toBe("The amount charged and the date are needed to file it.");
  expect(fileReceipt).not.toHaveBeenCalled();

  // A charge, and the date cleared: still held, for the date.
  reopen();
  fireEvent.change(field("Total"), { target: { value: "5.00" } });
  fireEvent.change(field("Date"), { target: { value: "" } });
  await fileFromQueue();
  expect(await rowRefusal()).toBe("The amount charged and the date are needed to file it.");
  expect(fileReceipt).not.toHaveBeenCalled();

  reopen();
  fireEvent.change(field("Date"), { target: { value: "2026-10-05" } });
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toMatchObject({
    to: "line",
    amountCents: 500,
    date: "2026-10-05",
  });
});

test("with two members, a read charge to nobody was the other's: paid by that other, it is theirs to keep (lg-102 gate 1, M15)", async () => {
  await readBasketCharged(null);
  // Read as someone else's, naming nobody: with two members, sam's.
  expect(shared()).toBe("Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $");

  payBy("sam");

  expect(whoseSelect("BIERE 6X355").value).toBe("");
  expect(whoseSelect("BIERE 6X355").selectedOptions[0]?.text).toBe("sam");
  expect(shared()).toBe("Not shared 15.54 $ · alex's 0.00 $ · Shared 9.22 $");
  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(filedItems()).toEqual([
    ["PAIN", "shared", null],
    ["BIERE 6X355", "not-shared", null],
    ["SAVON", "shared", null],
  ]);
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toMatchObject({ paidBy: "sam" });
});

test("a receipt is never wholly its payer's: Whose goes back to Shared when its person pays, and stays there (lg-102 gate 1, M17)", async () => {
  await takePhoto();
  await readOne();
  await waitFor(() => expect(field("Total").value).toBe("26.50"));
  const whose = (): HTMLSelectElement => screen.getByLabelText("Whose");

  fireEvent.change(whose(), { target: { value: "sam" } });
  expect(whose().value).toBe("sam");
  payBy("sam");
  expect(whose().value).toBe("");
  expect(optionsOf(whose())).toEqual(["Shared", "alex's — owes all of it"]);
  // Back to alex paying, sam is offered again and not chosen: nobody picked sam since.
  payBy("alex");
  expect(whose().value).toBe("");

  await fileFromQueue();
  await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fileReceipt).mock.calls[0]?.[1].destination).toMatchObject({
    to: "line",
    chargedTo: null,
    paidBy: null,
  });
});

test("a row's refusal goes when one of its picks changes in the list (lg-102 gate 1, M19)", async () => {
  await fileThreeWithSecond({
    ...BASKET,
    items: BASKET.items.map((item) => (item.text === "PAIN" ? { ...item, price: 348 } : item)),
  });
  expect(await rowRefusal()).toBe(
    "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
  );

  fireEvent.change(screen.getByLabelText("Paid by, Marché Exemple, 24.76 $"), {
    target: { value: "sam" },
  });

  expect(screen.queryByText(/^Not filed: /u)).toBeNull();
  // Filed again, it is held again for the same reason, which it says.
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));
  expect(await rowRefusal()).toBe(
    "The items, deposits, rebates and taxes do not add up to the total. Correct them to file.",
  );
});

// --- lg-102 round 1: the owner's answers to gate 1 ---

/** The row in the list a receipt's box is on. */
function rowOf(label: string): HTMLElement {
  const box = screen.getByRole("checkbox", { name: `Select ${label}` });
  const row = box.closest("li");
  if (row === null) throw new Error(`no row for ${label}`);
  return row;
}

test("a receipt typed in and left half done can be removed, which hands its photo back to the reader (lg-102 gate 1)", async () => {
  uploadsNumbered();
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Type it in" }));
  fireEvent.change(field("Merchant"), { target: { value: "D" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
  // Typed in, the photo is handled: no read is offered while the row stands.
  expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Remove D" }));

  expect(screen.queryByRole("list", { name: "Receipts in a.jpg" })).toBeNull();
  expect(screen.getByText("Kept, not read yet.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Read it" }));
  await screen.findByText("1 of 1 read");
  expect(vi.mocked(readReceipt).mock.calls.map(([id]) => id)).toEqual([11]);
});

test("a receipt typed in from a photo whose read failed can be removed, and the retry is back (lg-102 gate 1)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockRejectedValueOnce(new AppError("INTERNAL", "The reader broke."));
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await screen.findByText("The read failed: The reader broke.");
  fireEvent.click(screen.getByRole("button", { name: "Type it in" }));
  fireEvent.change(field("Merchant"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Remove x" }));

  expect(screen.getByText("The read failed: The reader broke.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("1 of 1 read");
});

test("a receipt the model made up is removed from its photo, the other stays, and the last removed hands the photo back (lg-102 gate 1)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 11,
    model: "claude-haiku-5-5",
    proposals: [readOf("Café Un", 1_000), readOf("Café Deux", 2_000)],
  });
  chooseSeveral([jpeg("two.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  fireEvent.click(await screen.findByRole("button", { name: "Remove Café Deux, 20.00 $" }));

  expect(screen.queryByRole("button", { name: "Café Deux, 20.00 $" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "File selected" }));
  await screen.findByText("Café Un, 10.00 $, filed");
  expect(vi.mocked(fileReceipt).mock.calls.map(([id, request]) => [id, request.part])).toEqual([
    [11, 1],
  ]);
  // A filed receipt has nothing to remove.
  expect(screen.queryByRole("button", { name: /^Remove /u })).toBeNull();
});

test("removing every receipt read from a photo, none filed, hands it back to the reader (lg-102 gate 1)", async () => {
  uploadsNumbered();
  chooseSeveral([jpeg("a.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));

  fireEvent.click(await screen.findByRole("button", { name: "Remove Marché Exemple, 26.50 $" }));

  expect(screen.getByText("Kept, not read yet.")).toBeTruthy();
  expect(screen.queryByText(/Nothing in the photo was read/u)).toBeNull();
  expect(screen.getByRole("button", { name: "Read it" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Type it in" })).toBeTruthy();
});

test("each row says Filing…, why not and what it was filed as in a live region that was there before it spoke (lg-102 gate 1)", async () => {
  vi.mocked(fileReceipt).mockImplementation(async (id, request) => {
    if (id === 12) throw new AppError("RECEIPT_ALREADY_FILED", "That receipt is filed already.");
    return {
      id,
      receiptId: id,
      part: request.part,
      proposal: request.proposal,
      periodLineId: id * 10,
      chargeLineId: null,
      charges: [],
      rowId: null,
      filedAt: "x",
      filedBy: "alex",
    };
  });
  await threeReadAndSelected();
  const said = ["Shop 11", "Shop 12"].map((shop) =>
    within(rowOf(`${shop}, 10.00 $`)).getByRole("status"),
  );
  expect(said.map((region) => region.textContent)).toEqual(["", ""]);

  fireEvent.click(screen.getByRole("button", { name: "File selected" }));

  await screen.findByText("Shop 13, 10.00 $, filed");
  // The same regions, still on the page, now say what happened.
  expect(said.map((region) => document.body.contains(region))).toEqual([true, true]);
  expect(said.map((region) => region.textContent)).toEqual([
    "Filed as alex's line in the period.",
    "Not filed: That receipt is filed already.",
  ]);
});

test("Remove cannot be tapped while a filing is out: the three are all filed, none lost from the list (lg-102 gate 2, N1a)", async () => {
  const held: Record<number, () => void> = {};
  vi.mocked(fileReceipt).mockImplementation(
    (id, request) =>
      new Promise((resolve) => {
        held[id] = () =>
          resolve({
            id,
            receiptId: id,
            part: request.part,
            proposal: request.proposal,
            periodLineId: id * 10,
            chargeLineId: null,
            charges: [],
            rowId: null,
            filedAt: "x",
            filedBy: "alex",
          });
      }),
  );
  await threeReadAndSelected();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "File selected" }));
  });
  await waitFor(() => expect(Object.keys(held)).toEqual(["11"]));

  const remove = screen.getByRole("button", { name: "Remove Shop 11, 10.00 $" });
  expect((remove as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(remove);
  expect(screen.getByRole("button", { name: "Remove Shop 11, 10.00 $" })).toBeTruthy();

  await act(async () => held[11]?.());
  await waitFor(() => expect(Object.keys(held)).toEqual(["11", "12"]));
  await act(async () => held[12]?.());
  await waitFor(() => expect(Object.keys(held)).toEqual(["11", "12", "13"]));
  await act(async () => held[13]?.());
  await screen.findByText("Shop 13, 10.00 $, filed");
  expect(filedIds()).toEqual([11, 12, 13]);
  for (const shop of ["Shop 11", "Shop 12", "Shop 13"]) {
    expect(screen.getByText(`${shop}, 10.00 $, filed`)).toBeTruthy();
  }
});

test("removing one of two receipts read from a photo leaves the photo read: 1 of 1 read stays and no read is offered (lg-102 gate 2, N1c)", async () => {
  uploadsNumbered();
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 11,
    model: "claude-haiku-5-5",
    proposals: [readOf("Café Un", 1_000), readOf("Café Deux", 2_000)],
  });
  chooseSeveral([jpeg("two.jpg")]);
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await screen.findByRole("button", { name: "Remove Café Un, 10.00 $" });
  expect(screen.getByText("1 of 1 read")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Remove Café Un, 10.00 $" }));

  expect(screen.getByText("1 of 1 read")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Remove Café Deux, 20.00 $" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read it" })).toBeNull();
  expect(screen.queryByText("Kept, not read yet.")).toBeNull();
});

// --- lg-100: a person's items in two categories, one charge to the pot each ---

test("attached to a joint-account row, a person with two charges to the pot is named once (lg-100)", async () => {
  basketRow();
  vi.mocked(fileReceipt).mockResolvedValue({
    id: 1,
    receiptId: 3,
    part: 1,
    proposal: BASKET,
    periodLineId: null,
    chargeLineId: null,
    // The beer's and the soap's categories differ: one charge each, both sam's.
    charges: [
      { chargedTo: "sam", lineId: 10, owedToPot: true },
      { chargedTo: "sam", lineId: 11, owedToPot: true },
    ],
    rowId: 41,
    filedAt: "x",
    filedBy: "alex",
  });
  await readBasket();
  payJointly();
  await screen.findByRole("button", { name: "Attach to this row" });
  leaveOut("BIERE 6X355");
  leaveOut("SAVON");
  fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: "sam" } });
  fireEvent.change(whoseSelect("SAVON"), { target: { value: "sam" } });

  fireEvent.click(screen.getByRole("button", { name: "Attach to this row" }));

  expect(
    await screen.findByText(
      "Attached to the joint-account row, and sam's items as charges to the pot.",
    ),
  ).toBeTruthy();
});

test.each([
  [
    "kept by the payer",
    "alex",
    "Filed 9.22 $ as alex's line in the period; 15.54 $ kept as alex's own.",
  ],
  [
    "charged to sam",
    "sam",
    "Filed 9.22 $ as alex's line in the period, and sam's 15.54 $ as a charge.",
  ],
])(
  "an item unchecked and %s, filed from the list, says the amounts, not only the printed total (the owner, 2026-11-08)",
  async (_name, whose, said) => {
    vi.mocked(fileReceipt).mockImplementation(async (id, request) => ({
      id: 1,
      receiptId: id,
      part: request.part,
      proposal: request.proposal,
      periodLineId: 1,
      chargeLineId: null,
      charges: whose === "alex" ? [] : [{ lineId: 2, chargedTo: whose, owedToPot: false }],
      rowId: null,
      filedAt: "x",
      filedBy: "alex",
    }));
    await readBasket();
    fireEvent.click(sharedBox("BIERE 6X355"));
    fireEvent.change(whoseSelect("BIERE 6X355"), { target: { value: whose } });
    fireEvent.click(screen.getByRole("button", { name: "Back to the queue" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("button", { name: "File selected" }));

    expect(await screen.findByText(said)).toBeTruthy();
    // The request is the one the server splits the same way: the whole charge, the item not shared.
    const request = vi.mocked(fileReceipt).mock.calls[0]?.[1];
    expect(request?.destination).toMatchObject({ to: "line", amountCents: 2_476 });
  },
);
