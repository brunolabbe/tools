/** Who the API says the caller is (lg-3), and whether they are an admin (lg-20). */

import { ROUTES } from "@ledger/contract";
import type { MeResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return await requestJson<MeResponse>(ROUTES.me, { signal });
}
