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
 *
 * **Items** (lg-10). A read proposes each item line with a category from the
 * household's list, and names the category this merchant was last given. A
 * filing with items is refused unless they make the total
 * (`RECEIPT_DOES_NOT_ADD_UP`); then what is not shared and what is the other's
 * come off the line, computed by the books from the items (`splitReceipt`), and
 * the other's part is filed as a charge of its own. The items are stored with
 * the filing.
 */

import {
  checkReceipt,
  itemsAddUp,
  matchReceipt,
  normalizeDescription,
  splitReceipt,
} from "@ledger/books";
import type { MatchableRow } from "@ledger/books";
import { AppError, MAX_RECEIPTS_PER_PHOTO } from "@ledger/contract";
import type {
  FileReceiptRequest,
  ItemShare,
  ReadReceiptResponse,
  Receipt,
  ReceiptFiling,
  ReceiptItem,
  ReceiptMatchesResponse,
  ReceiptMediaType,
  ReceiptProposal,
} from "@ledger/contract";
import type { CategoryChoice, ReceiptReader } from "@ledger/receipts";
import type { Database } from "better-sqlite3";
import { addLine } from "./periods.ts";
import type { PeriodContext } from "./periods.ts";
import type { PhotoStore } from "./receipt-photos.ts";
import { requireSpendingCategory, spendingCategories } from "./spending-categories.ts";

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
  charge_line_id: number | null;
}

interface ItemColumns {
  text: string;
  price_cents: number;
  taxable: 0 | 1;
  deposit_cents: number | null;
  spending_category_id: number | null;
  share: ItemShare;
}

function toItem(columns: ItemColumns): ReceiptItem {
  return {
    text: columns.text,
    price: columns.price_cents,
    taxable: columns.taxable === 1,
    deposit: columns.deposit_cents,
    spendingCategoryId: columns.spending_category_id,
    share: columns.share,
  };
}

function itemsOf(db: Database, filingId: number): ReceiptItem[] {
  return (
    db
      .prepare("SELECT * FROM receipt_items WHERE filing_id = ? ORDER BY position")
      .all(filingId) as ItemColumns[]
  ).map(toItem);
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

function toFiling(db: Database, columns: FilingColumns): ReceiptFiling {
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
      items: itemsOf(db, columns.id),
    },
    periodLineId: columns.period_line_id,
    chargeLineId: columns.charge_line_id,
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
  const offered: CategoryChoice[] = spendingCategories(context.db)
    .filter((category) => !category.retired)
    .map(({ id: categoryId, name }) => ({ id: categoryId, name }));
  const bytes = await context.photos.load(context.household, receipt.photo);
  const proposals = await reader.read({ bytes, mediaType: receipt.media_type }, signal, offered);
  const ids = new Set(offered.map((category) => category.id));
  return {
    receiptId: receipt.id,
    model: reader.model,
    // No more than a photo can file, each as its part (gate 2, N2).
    proposals: proposals.slice(0, MAX_RECEIPTS_PER_PHOTO).map((read) => {
      const proposal = withOfferedCategories(read, ids);
      return {
        proposal,
        flags: checkReceipt(proposal),
        merchantCategoryId: merchantCategory(context.db, proposal.merchant, ids),
      };
    }),
  };
}

/**
 * The proposal with any item category not in the list dropped (the owner's
 * answer of 2026-10-16): the reader already drops a name it was not offered, and
 * this holds whatever reader is plugged in to the same, by id.
 */
function withOfferedCategories(
  proposal: ReceiptProposal,
  offered: ReadonlySet<number>,
): ReceiptProposal {
  return {
    ...proposal,
    items: proposal.items.map((item) =>
      item.spendingCategoryId === null || offered.has(item.spendingCategoryId)
        ? item
        : { ...item, spendingCategoryId: null },
    ),
  };
}

/**
 * The spending category a merchant's receipts were last given (lg-10), which the
 * screen proposes first. Newest filing first, the first that was given one
 * decides: the category of the line it became, when the person gave it one,
 * otherwise the one most of its items were given (the earlier on a tie). The
 * merchant is compared folded, as a rule compares a description, so case,
 * accents and spacing do not make another merchant. A category retired since is
 * not proposed.
 *
 * **The line is read as it now stands** (the owner's answer of 2026-10-17, gate
 * 1's F3): a correction supersedes the line the filing named, so the chain of
 * `supersedes` is followed to its newest version. **A line since removed still
 * sets its merchant's category** (the owner's answer of 2026-10-17, gate 2's
 * N1): its chain ends on the retirement, which copies the line, and a removal
 * undoes an entry, not what the merchant sells.
 *
 * The walk stops at a depth of 10 000 (gate 2's N2). Nothing in the tool writes
 * a cycle into `supersedes`, but nothing in the schema refuses one either, and a
 * file edited by hand that holds one would otherwise never return from a
 * synchronous query.
 */
export function merchantCategory(
  db: Database,
  merchant: string | null,
  offered: ReadonlySet<number>,
): number | null {
  if (merchant === null) return null;
  const wanted = normalizeDescription(merchant);
  // A version is superseded at most once (`period_lines_supersedes`), so the
  // chain from the filed line is a single path, and its deepest step is newest.
  const filings = db
    .prepare(
      `SELECT receipt_filings.id, receipt_filings.merchant,
         (WITH RECURSIVE chain (id, category, depth) AS (
            SELECT id, spending_category_id, 0 FROM period_lines
            WHERE id = receipt_filings.period_line_id
            UNION ALL
            SELECT newer.id, newer.spending_category_id, chain.depth + 1
            FROM period_lines newer JOIN chain ON newer.supersedes = chain.id
            WHERE chain.depth < 10000
          )
          SELECT category FROM chain ORDER BY depth DESC LIMIT 1) AS line_category
       FROM receipt_filings
       WHERE receipt_filings.merchant IS NOT NULL
       ORDER BY receipt_filings.id DESC`,
    )
    .all() as { id: number; merchant: string; line_category: number | null }[];
  const mostItems = db.prepare(
    `SELECT spending_category_id AS category FROM receipt_items
     WHERE filing_id = ? AND spending_category_id IS NOT NULL
     GROUP BY spending_category_id
     ORDER BY count(*) DESC, min(position)
     LIMIT 1`,
  );
  for (const filing of filings) {
    if (normalizeDescription(filing.merchant) !== wanted) continue;
    const category =
      filing.line_category ??
      (mostItems.get(filing.id) as { category: number } | undefined)?.category ??
      null;
    if (category !== null) return offered.has(category) ? category : null;
  }
  return null;
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
 * confirmed, its items with it (lg-10).
 *
 * Items must make the total, or nothing is filed (`RECEIPT_DOES_NOT_ADD_UP`).
 * Each item's category must be in the list. On a row every item is shared (the
 * owner's answer of 2026-10-17): the money left the joint account, so there is
 * no payer for an item to stay with, nor one the other's would owe.
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
      // Items that do not make the total are corrected first, never filed (lg-10).
      if (!itemsAddUp(proposal)) throw new AppError("RECEIPT_DOES_NOT_ADD_UP");
      for (const item of proposal.items) {
        requireSpendingCategory(context.db, item.spendingCategoryId);
      }
      let periodLineId: number | null = null;
      let chargeLineId: number | null = null;
      let rowId: number | null = null;
      if (destination.to === "line") {
        [periodLineId, chargeLineId] = fileLines(context, receipt.uploaded_by, request);
      } else {
        if (proposal.items.some((item) => item.share !== "shared")) {
          throw new AppError(
            "BAD_REQUEST",
            "A receipt on a joint-account row is shared whole: every item on it stays shared.",
          );
        }
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
          `INSERT INTO receipt_filings (receipt_id, part, merchant, date, subtotal_cents, gst_cents, qst_cents, total_cents, period_line_id, charge_line_id, row_id, filed_at, filed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          chargeLineId,
          rowId,
          context.now().toISOString(),
          context.personId,
        );
      const filingId = Number(result.lastInsertRowid);
      const insertItem = context.db.prepare(
        `INSERT INTO receipt_items (filing_id, position, text, price_cents, taxable, deposit_cents, spending_category_id, share)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const [index, item] of proposal.items.entries()) {
        insertItem.run(
          filingId,
          index + 1,
          item.text,
          item.price,
          item.taxable ? 1 : 0,
          item.deposit,
          item.spendingCategoryId,
          item.share,
        );
      }
      return toFiling(
        context.db,
        context.db
          .prepare("SELECT * FROM receipt_filings WHERE id = ?")
          .get(filingId) as FilingColumns,
      );
    })
    .immediate();
}

/**
 * The lines a receipt filed as a line becomes (lg-10), as `[line, charge]`:
 *
 * - **the shared line**: what the card was charged, less what is not shared
 *   and what is the other's, each computed from the items (`splitReceipt`). A
 *   receipt the person marked as the other's whole (`chargedTo`) is still one
 *   line, charged to them, as lg-8 filed it.
 * - **the charge**: the other's items, owed in full by the other person to
 *   whoever uploaded the photo, under their category when they share one.
 *
 * A part that comes to nothing files no line, and the first line filed is the
 * one the filing names first. A receipt of which nothing is left to file — every
 * item not shared and no tip — is refused: it is nobody's business but the
 * payer's, and a filing must name a line.
 */
function fileLines(
  context: PeriodContext,
  payer: string,
  request: FileReceiptRequest,
): [number, number | null] {
  const { destination, proposal } = request;
  if (destination.to !== "line") throw new AppError("INTERNAL", "Only a line is split.");
  const split =
    proposal.items.length === 0
      ? { sharedCents: destination.amountCents, notSharedCents: 0, chargedCents: 0 }
      : splitReceipt(proposal, undefined, destination.amountCents);
  if (
    split.sharedCents !== 0 &&
    Math.sign(split.sharedCents) !== Math.sign(destination.amountCents)
  ) {
    throw new AppError(
      "BAD_REQUEST",
      "More comes off this receipt than the card was charged. Check the amount charged and the items.",
    );
  }
  const other = [...context.people].find((person) => person !== payer) ?? null;
  if (split.chargedCents !== 0 && other === null) {
    throw new AppError(
      "BAD_REQUEST",
      "There is nobody else in the household to charge an item to.",
    );
  }

  const filed: number[] = [];
  if (split.sharedCents !== 0) {
    const line = addLine(
      context,
      {
        personId: payer,
        date: destination.date,
        amountCents: split.sharedCents,
        category: null,
        spendingCategoryId: destination.spendingCategoryId,
        note: destination.note,
        chargedTo: destination.chargedTo,
      },
      "receipt",
    );
    filed.push(line.id);
  }
  if (split.chargedCents !== 0) {
    const theirs = proposal.items.filter((item) => item.share === "theirs");
    const [first] = theirs;
    const alike =
      first !== undefined &&
      theirs.every((item) => item.spendingCategoryId === first.spendingCategoryId);
    const charge = addLine(
      context,
      {
        personId: payer,
        date: destination.date,
        amountCents: split.chargedCents,
        category: null,
        spendingCategoryId: alike ? first.spendingCategoryId : destination.spendingCategoryId,
        note: destination.note,
        chargedTo: other,
      },
      "receipt",
    );
    filed.push(charge.id);
  }
  const [line, charge] = filed;
  if (line === undefined) {
    throw new AppError(
      "BAD_REQUEST",
      "Nothing on this receipt is shared or the other's, so there is nothing to file.",
    );
  }
  return [line, charge ?? null];
}
