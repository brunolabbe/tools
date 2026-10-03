/** The rows nobody has classified, and the answer to each (lg-4). */

import { ROUTES } from "@ledger/contract";
import type {
  ClassificationRecord,
  ClassifyRequest,
  InboxResponse,
  InboxRow,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchInbox(signal?: AbortSignal): Promise<InboxRow[]> {
  return (await requestJson<InboxResponse>(ROUTES.inbox, { signal })).rows;
}

/** Accept a rule, or answer with a person and a bucket. The earlier answers are kept. */
export async function classifyRow(request: ClassifyRequest): Promise<ClassificationRecord> {
  return await requestJson<ClassificationRecord>(ROUTES.classifications, {
    method: "POST",
    body: request,
  });
}
