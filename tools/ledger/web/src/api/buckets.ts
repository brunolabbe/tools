/** What each bucket holds and whose it is (lg-5). */

import { ROUTES } from "@ledger/contract";
import type { BucketsResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

/** Today's figures, by the API's clock. */
export async function fetchBuckets(signal?: AbortSignal): Promise<BucketsResponse> {
  return await requestJson<BucketsResponse>(ROUTES.buckets, { signal });
}
