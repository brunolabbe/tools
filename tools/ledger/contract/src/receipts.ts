/**
 * Receipts (lg-8): a photo is uploaded, read by a model when the person asks,
 * checked, edited, and filed on the person's confirmation — as a line in the
 * open period for whoever uploaded it, or attached to a joint-account row it
 * documents (`docs/00-ANALYSIS.md` §6).
 *
 * A file of its own rather than more of `api.ts`, because it is one seam that
 * `receipts` (the reader), `books` (the check and the match), `api` and `web` all
 * read. The routes are in `ROUTES`, with every other path.
 *
 * Every amount is in cents. A refund is negative, as the models measured on lg-8
 * read one.
 *
 * lg-10 adds the items: each line of the receipt, whether it is shared, and its
 * spending category, so that what one person alone pays for comes off the shared
 * amount (`docs/00-ANALYSIS.md` §6, _Items that are not shared_).
 */

import { z } from "zod";

/**
 * What a receipt photo may be: the image types the model reads that a phone
 * camera makes. GIF is the fourth the API takes, and no camera makes one. The
 * type is read from the photo's first bytes, never from its name or a header
 * (`api/src/receipts.ts`).
 */
export const RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

/**
 * The largest photo accepted, in bytes. The API takes an image of up to 10 MB
 * once base64-encoded, which is 7.5 MB of photo; 7 MiB stays under it with room,
 * and over what a phone's camera makes of one receipt. The web checks it before
 * sending, the API refuses over it (`SIZE_LIMIT_EXCEEDED`).
 */
export const MAX_RECEIPT_PHOTO_BYTES = 7 * 1024 * 1024;

/**
 * What becomes of one item (lg-10). A person taps an item through the three.
 *
 * - `shared`: the default, and all a reader ever answers.
 * - `not-shared`: it stays with whoever paid, and comes off the shared amount.
 * - `theirs`: the other person's, and becomes a charge they owe in full; it
 *   comes off the shared amount exactly as a `not-shared` item does.
 */
export const ITEM_SHARES = ["shared", "not-shared", "theirs"] as const;
export type ItemShare = (typeof ITEM_SHARES)[number];

/**
 * One item line of a receipt (lg-10), as read and then as the person confirmed
 * it. The reader reads the text, the price, the taxable mark and the deposit,
 * and proposes a category; it decides no `share`, and computes nothing.
 */
export interface ReceiptItem {
  text: string;
  /** As printed. A discount or a returned item is negative. */
  price: number;
  /** Marked taxable on the receipt: GST and QST are charged on its price. */
  taxable: boolean;
  /** The deposit (`consigne`) printed for it, or `null`. A deposit carries no tax. */
  deposit: number | null;
  /**
   * A category from lg-15's list: the model's proposal until the person
   * confirms. `null` when it proposed none, or one that is not in the list.
   */
  spendingCategoryId: number | null;
  share: ItemShare;
}

/** Far past any grocery receipt's lines; a reading past it is cut there. */
export const MAX_RECEIPT_ITEMS = 200;

/**
 * What a reader proposes from one receipt in a photo. A photo can hold more than
 * one (lg-8 measured two side by side), so a reader returns a list. Every field
 * is `null` when it was not read: a receipt with no tax lines has `gst` and `qst`
 * `null`, and a photo with no date has `date` `null`.
 */
export interface ReceiptProposal {
  merchant: string | null;
  /** `yyyy-mm-dd`. */
  date: string | null;
  subtotal: number | null;
  /** TPS. */
  gst: number | null;
  /** TVQ. */
  qst: number | null;
  total: number | null;
  /**
   * The item lines, in the order printed (lg-10). Empty for a receipt typed in
   * without them, or one whose items were not read: such a receipt is filed on
   * its total, as lg-8 filed every receipt.
   */
  items: ReceiptItem[];
}

/** A billion dollars: far past any receipt, and well inside a safe integer. */
const MAX_CENTS = 100_000_000_000;

const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);

export const receiptItemSchema = z.strictObject({
  text: z.string().trim().min(1).max(200),
  price: cents,
  taxable: z.boolean(),
  deposit: cents.nullable(),
  spendingCategoryId: z.number().int().positive().nullable(),
  share: z.enum(ITEM_SHARES),
}) satisfies z.ZodType<ReceiptItem>;

export const receiptProposalSchema = z.strictObject({
  merchant: z.string().trim().min(1).max(200).nullable(),
  date: z.iso.date().nullable(),
  subtotal: cents.nullable(),
  gst: cents.nullable(),
  qst: cents.nullable(),
  total: cents.nullable(),
  // A proposal sent with no items is filed on its total, as lg-8 filed one.
  items: z.array(receiptItemSchema).max(MAX_RECEIPT_ITEMS).default([]),
}) satisfies z.ZodType<ReceiptProposal, unknown>;

/**
 * What the arithmetic check (`checkReceipt` in `books`) says of a proposal. It
 * flags and never corrects.
 *
 * - `total-missing`, `subtotal-missing`: the line was not read.
 * - `tax-missing`: one tax was read and the other was not.
 * - `parts-differ`: subtotal + GST + QST is not the total, to the cent.
 * - `tax-differs`: no taxable part of the subtotal gives both taxes, GST at 5 %
 *   and QST at 9.975 %, each rounded to the cent.
 * - `signs-differ`: some parts are a purchase and some a refund.
 * - `taxable-differs` (lg-26): the prices of the items marked taxable, taken as
 *   the taxable part, do not give both printed taxes; a receipt with items and no
 *   tax lines counts both as zero. It points at the Taxable boxes, and does not
 *   block filing. Where it is **not** raised: a receipt with no items; one tax
 *   read and the other not (`tax-missing`); mixed signs (`signs-differ`). Beside
 *   `tax-differs`, where no marks can give both taxes, it is raised only when the
 *   marks give neither tax on its own, so a misread tax is not blamed on the
 *   marks. A store that rounds tax per line can raise it on marks that are right.
 * - `items-differ` (lg-10): the items, their deposits and the two taxes do not
 *   make the total, to the cent. Unlike the others it **blocks filing**: the
 *   shared amount is computed from the items, so items that do not add up would
 *   file an amount nobody paid (`RECEIPT_DOES_NOT_ADD_UP`).
 *
 * The taxes are checked at the rates in effect on the receipt's date
 * (`ratesOn` in `books`).
 */
export const RECEIPT_FLAGS = [
  "total-missing",
  "subtotal-missing",
  "tax-missing",
  "parts-differ",
  "tax-differs",
  "signs-differ",
  "items-differ",
  "taxable-differs",
] as const;
export type ReceiptFlag = (typeof RECEIPT_FLAGS)[number];

/** A proposal and what the check flagged on it; no flag is a proposal that adds up. */
export interface CheckedProposal {
  proposal: ReceiptProposal;
  flags: ReceiptFlag[];
  /**
   * The spending category this merchant's receipts were last given (lg-10), which
   * the screen proposes first; `null` for a merchant never categorised, or none
   * read. A category retired since is not proposed.
   */
  merchantCategoryId: number | null;
}

/**
 * How many receipts one photo may hold and each be filed (gate 1, F2): far past
 * the two side by side lg-8 measured. A read answers no more proposals than this
 * (gate 2, N2).
 */
export const MAX_RECEIPTS_PER_PHOTO = 10;

/**
 * What filed a receipt: a period line, or a joint-account row it documents.
 * A photo holding more than one receipt files each as its own `part`, once.
 *
 * "Once" is per part, and the part is the person's word: a read stores nothing,
 * so the server does not know how many receipts a photo holds, and any part
 * from 1 to `MAX_RECEIPTS_PER_PHOTO` may be filed (gate 2, N1). That is no new
 * capability — `POST /api/period-lines` adds any line — and the screen files
 * each receipt it offers once. Storing the count would buy nothing more.
 */
export interface ReceiptFiling {
  id: number;
  receiptId: number;
  /** Which receipt in the photo, from 1: the read's proposals in order, or 1 for one typed in. */
  part: number;
  /** The proposal as the person confirmed it. */
  proposal: ReceiptProposal;
  /**
   * The line it became, or `null` when it was attached to a row. It carries the
   * shared amount (lg-10); when nothing on the receipt is shared but some of it
   * is the other's, it is the charge.
   */
  periodLineId: number | null;
  /**
   * The charge the other person's items became (lg-10), when the receipt also
   * left a shared line; `null` otherwise.
   */
  chargeLineId: number | null;
  /** The stored row it documents, or `null` when it became a line. */
  rowId: number | null;
  filedAt: string;
  filedBy: string;
}

/**
 * `POST /api/receipts`: a photo stored, read by nothing yet. `uploadedBy` is the
 * person a line filed from it is paid by.
 */
export interface Receipt {
  id: number;
  mediaType: ReceiptMediaType;
  bytes: number;
  uploadedAt: string;
  uploadedBy: string;
}

/**
 * `POST /api/receipts`'s answer: the receipt, and the model a read would send
 * its photo to — which the screen names before the person asks — or `null` when
 * none is configured and the receipt is typed in.
 */
export interface UploadedReceipt extends Receipt {
  reader: string | null;
}

/**
 * `POST /api/receipts/:id/read`: what the model read, each receipt checked.
 * `model` names the model that read it, which the screen says the photo went to.
 */
export interface ReadReceiptResponse {
  receiptId: number;
  model: string;
  proposals: CheckedProposal[];
}

/** A day, and an amount that is not zero, written in digits with an optional minus. */
export const receiptMatchesQuerySchema = z.strictObject({
  amountCents: z
    .string()
    .regex(/^-?\d{1,12}$/u)
    .transform(Number)
    .refine((amount) => amount !== 0),
  date: z.iso.date(),
});

/**
 * A stored joint-account row a receipt may document: the card charge for the
 * amount, within a few days of the receipt's date (`matchReceipt` in `books`).
 */
export interface ReceiptMatch {
  rowId: number;
  date: string;
  description: string;
  /** As the statement holds it: a purchase is negative. */
  amountCents: number;
  /** How many days the row is from the receipt's date, either way. */
  daysApart: number;
}

/**
 * `GET /api/receipts/:id/matches?amountCents=&date=`: the rows the amount the
 * person confirmed may be, nearest first, leaving out rows a receipt already
 * documents.
 */
export interface ReceiptMatchesResponse {
  matches: ReceiptMatch[];
}

/**
 * What a confirmed receipt becomes. A line is paid by whoever uploaded the
 * photo, never by whoever names it here, so the line takes no `personId`.
 * `amountCents` is what the card was charged, which a tip printed under the
 * total makes differ from it.
 *
 * With items (lg-10) the line is not `amountCents`: the API takes off what is
 * not shared and what is the other's, computed from the items (`splitReceipt`
 * in `books`), files the rest as the line, and files the other's part as a
 * charge of its own. A tip stays shared. A receipt attached to a row is shared
 * whole: its items carry categories, and none may be `not-shared` or `theirs`.
 */
export type ReceiptDestination =
  | {
      to: "line";
      date: string;
      amountCents: number;
      spendingCategoryId: number | null;
      note: string | null;
      chargedTo: string | null;
    }
  | { to: "row"; rowId: number };

/** `POST /api/receipts/:id/file`: the confirmation. Nothing is filed without it. */
export interface FileReceiptRequest {
  /** Which receipt in the photo is filed, from 1; each is filed once. */
  part: number;
  proposal: ReceiptProposal;
  destination: ReceiptDestination;
}

export const fileReceiptRequestSchema = z.strictObject({
  part: z.number().int().min(1).max(MAX_RECEIPTS_PER_PHOTO),
  proposal: receiptProposalSchema,
  destination: z.discriminatedUnion("to", [
    z.strictObject({
      to: z.literal("line"),
      date: z.iso.date(),
      amountCents: cents.refine((amount) => amount !== 0),
      spendingCategoryId: z.number().int().positive().nullable(),
      note: z.string().trim().min(1).max(500).nullable(),
      chargedTo: z.string().min(1).max(100).nullable(),
    }),
    z.strictObject({ to: z.literal("row"), rowId: z.number().int().positive() }),
  ]),
}) satisfies z.ZodType<FileReceiptRequest>;
