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
}

/** A billion dollars: far past any receipt, and well inside a safe integer. */
const MAX_CENTS = 100_000_000_000;

const cents = z.number().int().min(-MAX_CENTS).max(MAX_CENTS);

export const receiptProposalSchema = z.strictObject({
  merchant: z.string().trim().min(1).max(200).nullable(),
  date: z.iso.date().nullable(),
  subtotal: cents.nullable(),
  gst: cents.nullable(),
  qst: cents.nullable(),
  total: cents.nullable(),
}) satisfies z.ZodType<ReceiptProposal>;

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
 */
export const RECEIPT_FLAGS = [
  "total-missing",
  "subtotal-missing",
  "tax-missing",
  "parts-differ",
  "tax-differs",
  "signs-differ",
] as const;
export type ReceiptFlag = (typeof RECEIPT_FLAGS)[number];

/** A proposal and what the check flagged on it; no flag is a proposal that adds up. */
export interface CheckedProposal {
  proposal: ReceiptProposal;
  flags: ReceiptFlag[];
}

/**
 * How many receipts one photo may hold and each be filed (gate 1, F2): far past
 * the two side by side lg-8 measured.
 */
export const MAX_RECEIPTS_PER_PHOTO = 10;

/**
 * What filed a receipt: a period line, or a joint-account row it documents.
 * A photo holding more than one receipt files each as its own `part`, once.
 */
export interface ReceiptFiling {
  id: number;
  receiptId: number;
  /** Which receipt in the photo, from 1: the read's proposals in order, or 1 for one typed in. */
  part: number;
  /** The proposal as the person confirmed it. */
  proposal: ReceiptProposal;
  /** The line it became, or `null` when it was attached to a row. */
  periodLineId: number | null;
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
