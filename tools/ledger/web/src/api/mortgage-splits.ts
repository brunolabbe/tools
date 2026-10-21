/** How the mortgage splits, from a date (lg-63). A write is a `POST` that appends. */

import { ROUTES } from "@ledger/contract";
import type { MortgageSplit, MortgageSplitRequest, MortgageSplitsResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

/** The split records that stand, and the one in effect today. */
export async function fetchMortgageSplits(signal?: AbortSignal): Promise<MortgageSplitsResponse> {
  return await requestJson<MortgageSplitsResponse>(ROUTES.mortgageSplits, { signal });
}

export async function fileMortgageSplit(request: MortgageSplitRequest): Promise<MortgageSplit> {
  return await requestJson<MortgageSplit>(ROUTES.mortgageSplits, { method: "POST", body: request });
}
