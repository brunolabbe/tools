/** What the household says about its mortgage (lg-55): live, ended on a day, or none. */

import { ROUTES } from "@ledger/contract";
import type { MortgageRecordRequest, MortgageResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchMortgage(signal?: AbortSignal): Promise<MortgageResponse> {
  return await requestJson<MortgageResponse>(ROUTES.mortgage, { signal });
}

export async function saveMortgage(request: MortgageRecordRequest): Promise<MortgageResponse> {
  return await requestJson<MortgageResponse>(ROUTES.mortgage, { method: "POST", body: request });
}
