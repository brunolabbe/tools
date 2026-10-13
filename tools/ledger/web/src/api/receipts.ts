/**
 * Receipts (lg-8): the photo up, the read the person asks for, the rows it may
 * document, and the filing that is the confirmation.
 */

import { ROUTES } from "@ledger/contract";
import type {
  FileReceiptRequest,
  ReadReceiptResponse,
  ReceiptFiling,
  ReceiptMatch,
  ReceiptMatchesResponse,
  UploadedReceipt,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

function withId(route: string, id: number): string {
  return route.replace(":id", String(id));
}

/** Keeps the photo on the household's own server. Nothing reads it yet. */
export async function uploadReceipt(photo: Blob): Promise<UploadedReceipt> {
  return await requestJson<UploadedReceipt>(ROUTES.receipts, { method: "POST", body: photo });
}

/** Sends the photo to the model: only ever on the person's tap. */
export async function readReceipt(id: number): Promise<ReadReceiptResponse> {
  return await requestJson<ReadReceiptResponse>(withId(ROUTES.receiptRead, id), {
    method: "POST",
  });
}

export async function fetchReceiptMatches(
  id: number,
  amountCents: number,
  date: string,
): Promise<ReceiptMatch[]> {
  const query = new URLSearchParams({ amountCents: String(amountCents), date });
  const url = `${withId(ROUTES.receiptMatches, id)}?${query.toString()}`;
  return (await requestJson<ReceiptMatchesResponse>(url)).matches;
}

/** The confirmation: the only call that files anything. */
export async function fileReceipt(id: number, request: FileReceiptRequest): Promise<ReceiptFiling> {
  return await requestJson<ReceiptFiling>(withId(ROUTES.receiptFile, id), {
    method: "POST",
    body: request,
  });
}
