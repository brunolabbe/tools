/** The salaries, and the ratio confirmed from them (lg-5). Every write is a `POST` that appends. */

import { ROUTES } from "@ledger/contract";
import type {
  ConfirmRatioRequest,
  Ratio,
  RatiosResponse,
  SalariesResponse,
  Salary,
  SalaryEntry,
  SalaryEntryResponse,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchSalaries(signal?: AbortSignal): Promise<Salary[]> {
  return (await requestJson<SalariesResponse>(ROUTES.salaries, { signal })).salaries;
}

/** The ratios that stand, and the one in effect today. */
export async function fetchRatios(signal?: AbortSignal): Promise<RatiosResponse> {
  return await requestJson<RatiosResponse>(ROUTES.ratios, { signal });
}

/** Files a year's salaries; the answer proposes the ratio they give. */
export async function enterSalaries(entry: SalaryEntry): Promise<SalaryEntryResponse> {
  return await requestJson<SalaryEntryResponse>(ROUTES.salaries, { method: "POST", body: entry });
}

export async function confirmRatio(request: ConfirmRatioRequest): Promise<Ratio> {
  return await requestJson<Ratio>(ROUTES.ratios, { method: "POST", body: request });
}
