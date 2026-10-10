/**
 * The rows nobody has classified, and the answer to each (lg-4); and the rows
 * history filed with nobody tapping, for review (lg-17).
 */

import { ROUTES } from "@ledger/contract";
import type {
  AutoFiledResponse,
  AutoFiledRow,
  ClassificationRecord,
  ClassifyRequest,
  InboxResponse,
  InboxRow,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchInbox(signal?: AbortSignal): Promise<InboxRow[]> {
  return (await requestJson<InboxResponse>(ROUTES.inbox, { signal })).rows;
}

/** Filed automatically and not yet confirmed or changed. Either is `classifyRow`. */
export async function fetchAutoFiled(signal?: AbortSignal): Promise<AutoFiledRow[]> {
  return (await requestJson<AutoFiledResponse>(ROUTES.autoFiled, { signal })).rows;
}

/** Accept a rule, or answer with a person and a bucket. The earlier answers are kept. */
export async function classifyRow(request: ClassifyRequest): Promise<ClassificationRecord> {
  return await requestJson<ClassificationRecord>(ROUTES.classifications, {
    method: "POST",
    body: request,
  });
}
