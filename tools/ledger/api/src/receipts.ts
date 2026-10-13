/**
 * Receipts (lg-8): a photo uploaded, read by the model when the person asks,
 * and filed on the person's confirmation.
 *
 * The three steps are three requests, and only the middle one reaches a model:
 *
 * 1. **Upload** stores the photo and records who took it. It reads nothing and
 *    files nothing.
 * 2. **Read** sends the photo to the reader and answers its proposals, each with
 *    what the arithmetic check flagged on it. It stores nothing: a proposal is
 *    the person's to edit. A receipt typed by hand never takes this step.
 * 3. **File** is the confirmation, and the only step that writes to the books:
 *    the receipt becomes a line in the period for **whoever uploaded it**, paid
 *    by them whoever confirms, or is attached to the joint-account row it
 *    documents, which is not a line since the money already left the buffer
 *    (`docs/00-ANALYSIS.md` §6).
 *
 * All of it in the caller's own household's books and photos (lg-21): the route
 * passes `booksOf(request)` and the household the identity check attached.
 */

import { checkReceipt, matchReceipt } from "@ledger/books";
import type { MatchableRow } from "@ledger/books";
import { AppError, MAX_RECEIPTS_PER_PHOTO } from "@ledger/contract";
import type {
  FileReceiptRequest,
  ReadReceiptResponse,
  Receipt,
  ReceiptFiling,
  ReceiptMatchesResponse,
  ReceiptMediaType,
} from "@ledger/contract";
import type { ReceiptReader } from "@ledger/receipts";
import type { Database } from "better-sqlite3";
import { addLine } from "./periods.ts";
import type { PeriodContext } from "./periods.ts";
import type { PhotoStore } from "./receipt-photos.ts";

/**
 * The type a photo's first bytes say it is, or `null`. Never the name it was
 * sent under or the type its request claimed: either is the sender's word.
 */
export function imageTypeOf(bytes: Uint8Array): ReceiptMediaType | null {
  const starts = (offset: number, ...expected: number[]): boolean =>
    expected.every((byte, index) => bytes[offset + index] === byte);
  if (starts(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  // "RIFF", four bytes of length, "WEBP".
  if (starts(0, 0x52, 0x49, 0x46, 0x46) && starts(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

interface ReceiptColumns {
  id: number;
  photo: string;
  media_type: ReceiptMediaType;
  bytes: number;
  uploaded_at: string;
  uploaded_by: string;
}

interface FilingColumns {
  id: number;
  receipt_id: number;
  part: number;
  merchant: string | null;
  date: string | null;
  subtotal_cents: number | null;
  gst_cents: number | null;
  qst_cents: number | null;
  total_cents: number | null;
  period_line_id: number | null;
  row_id: number | null;
  filed_at: string;
  filed_by: string;
}

function toReceipt(columns: ReceiptColumns): Receipt {
  return {
    id: columns.id,
    mediaType: columns.media_type,
    bytes: columns.bytes,
    uploadedAt: columns.uploaded_at,
    uploadedBy: columns.uploaded_by,
  };
}

function toFiling(columns: FilingColumns): ReceiptFiling {
  return {
    id: columns.id,
    receiptId: columns.receipt_id,
    part: columns.part,
    proposal: {
      merchant: columns.merchant,
      date: columns.date,
      subtotal: columns.subtotal_cents,
      gst: columns.gst_cents,
      qst: columns.qst_cents,
      total: columns.total_cents,
    },
    periodLineId: columns.period_line_id,
    rowId: columns.row_id,
    filedAt: columns.filed_at,
    filedBy: columns.filed_by,
  };
}

function storedReceipt(db: Database, id: number): ReceiptColumns {
  const found = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id) as
    | ReceiptColumns
    | undefined;
  if (found === undefined) throw new AppError("RECEIPT_NOT_FOUND");
  return found;
}

/** Who uploads, into which household's books and photos, and when. */
export interface UploadContext {
  db: Database;
  photos: PhotoStore;
  household: string;
  personId: string;
  now: () => Date;
}

/**
 * Keeps the photo and records the receipt. Refuses anything whose bytes are not
 * a JPEG, a PNG or a WebP image, an empty upload included.
 */
export async function uploadReceipt(context: UploadContext, body: unknown): Promise<Receipt> {
  const bytes = body instanceof Uint8Array ? body : null;
  const mediaType = bytes === null ? null : imageTypeOf(bytes);
  if (bytes === null || mediaType === null) throw new AppError("RECEIPT_NOT_AN_IMAGE");

  const photo = await context.photos.save(context.household, bytes, mediaType);
  try {
    const result = context.db
      .prepare(
        "INSERT INTO receipts (photo, media_type, bytes, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?)",
      )
      .run(photo, mediaType, bytes.byteLength, context.now().toISOString(), context.personId);
    return toReceipt(storedReceipt(context.db, Number(result.lastInsertRowid)));
  } catch (error: unknown) {
    // A photo no receipt names would be kept for nobody.
    await context.photos.discard(context.household, photo);
    throw error;
  }
}

/**
 * What the reader makes of the receipt's photo, each proposal checked. Only
 * this reaches a model, and only when the person asks; nothing is stored.
 *
 * A receipt with anything filed from it is not read again (gate 1, F4): the
 * screen holds the proposals it filed from, and another read would be paid for
 * nothing. `signal` is the request's, so a caller who hangs up stops the call.
 */
export async function readReceipt(
  context: { db: Database; photos: PhotoStore; household: string },
  reader: ReceiptReader | undefined,
  id: number,
  signal?: AbortSignal,
): Promise<ReadReceiptResponse> {
  const receipt = storedReceipt(context.db, id);
  const filed = context.db.prepare("SELECT id FROM receipt_filings WHERE receipt_id = ?").get(id);
  if (filed !== undefined) throw new AppError("RECEIPT_ALREADY_FILED");
  if (reader === undefined) throw new AppError("RECEIPT_READER_UNCONFIGURED");
  const bytes = await context.photos.load(context.household, receipt.photo);
  const proposals = await reader.read({ bytes, mediaType: receipt.media_type }, signal);
  return {
    receiptId: receipt.id,
    model: reader.model,
    // No more than a photo can file, each as its part (gate 2, N2).
    proposals: proposals
      .slice(0, MAX_RECEIPTS_PER_PHOTO)
      .map((proposal) => ({ proposal, flags: checkReceipt(proposal) })),
  };
}

/**
 * The stored rows the confirmed amount may be the card charge of, leaving out
 * the rows a receipt already documents.
 */
export function receiptMatches(
  db: Database,
  id: number,
  query: { amountCents: number; date: string },
): ReceiptMatchesResponse {
  storedReceipt(db, id);
  const rows = db
    .prepare(
      `SELECT id, date, description, amount_cents AS amountCents FROM statement_rows
       WHERE amount_cents = ?
         AND NOT EXISTS (SELECT 1 FROM receipt_filings WHERE receipt_filings.row_id = statement_rows.id)`,
    )
    .all(-query.amountCents) as MatchableRow[];
  return {
    matches: matchReceipt(rows, query).map(({ row, daysApart }) => ({
      rowId: row.id,
      date: row.date,
      description: row.description,
      amountCents: row.amountCents,
      daysApart,
    })),
  };
}

/**
 * Files one receipt in the photo as the person confirmed it — its `part`, once;
 * a photo of two receipts files twice (gate 1, F2). A line is paid by
 * whoever uploaded the photo, and entered by whoever confirms; a row is only
 * documented, and gains no line. Either way the filing records the proposal as
 * confirmed, which lg-10 reads its items against.
 */
export function fileReceipt(
  context: PeriodContext,
  id: number,
  request: FileReceiptRequest,
): ReceiptFiling {
  return context.db
    .transaction(() => {
      const receipt = storedReceipt(context.db, id);
      const filed = context.db
        .prepare("SELECT id FROM receipt_filings WHERE receipt_id = ? AND part = ?")
        .get(id, request.part);
      if (filed !== undefined) throw new AppError("RECEIPT_ALREADY_FILED");

      const { destination, proposal } = request;
      let periodLineId: number | null = null;
      let rowId: number | null = null;
      if (destination.to === "line") {
        const line = addLine(
          context,
          {
            personId: receipt.uploaded_by,
            date: destination.date,
            amountCents: destination.amountCents,
            category: null,
            spendingCategoryId: destination.spendingCategoryId,
            note: destination.note,
            chargedTo: destination.chargedTo,
          },
          "receipt",
        );
        periodLineId = line.id;
      } else {
        const row = context.db
          .prepare("SELECT id FROM statement_rows WHERE id = ?")
          .get(destination.rowId);
        if (row === undefined) throw new AppError("ROW_NOT_FOUND");
        const documented = context.db
          .prepare("SELECT id FROM receipt_filings WHERE row_id = ?")
          .get(destination.rowId);
        if (documented !== undefined) throw new AppError("ROW_ALREADY_DOCUMENTED");
        rowId = destination.rowId;
      }

      const result = context.db
        .prepare(
          `INSERT INTO receipt_filings (receipt_id, part, merchant, date, subtotal_cents, gst_cents, qst_cents, total_cents, period_line_id, row_id, filed_at, filed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          request.part,
          proposal.merchant,
          proposal.date,
          proposal.subtotal,
          proposal.gst,
          proposal.qst,
          proposal.total,
          periodLineId,
          rowId,
          context.now().toISOString(),
          context.personId,
        );
      return toFiling(
        context.db
          .prepare("SELECT * FROM receipt_filings WHERE id = ?")
          .get(Number(result.lastInsertRowid)) as FilingColumns,
      );
    })
    .immediate();
}
