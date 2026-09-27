/** Whether the server is up, and which release it is. */

import { ROUTES } from "@ledger/contract";
import type { HealthResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return await requestJson<HealthResponse>(ROUTES.health, { signal });
}
