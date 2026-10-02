/** Store a pasted statement; the API's answer is what the paste did to the books. */

import { ROUTES } from "@ledger/contract";
import type { ImportStatementReport, ImportStatementRequest } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function importStatement(
  text: string,
  signal?: AbortSignal,
): Promise<ImportStatementReport> {
  const body: ImportStatementRequest = { text };
  return await requestJson<ImportStatementReport>(ROUTES.statements, {
    method: "POST",
    body,
    signal,
  });
}
