/**
 * The whole account's bank rows (lg-41), narrowed and ordered by the server.
 * Kept apart from `fetchSpendingRows`, whose `scope=spending` is its point: this
 * one lists every row, filed or not, whatever it was filed to.
 */

import { ROUTES } from "@ledger/contract";
import type { RowsQuery, RowsResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

/** `GET /api/rows` with the query as given; a field left out narrows nothing. */
export async function fetchRows(query: RowsQuery, signal?: AbortSignal): Promise<RowsResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return await requestJson<RowsResponse>(text === "" ? ROUTES.rows : `${ROUTES.rows}?${text}`, {
    signal,
  });
}
