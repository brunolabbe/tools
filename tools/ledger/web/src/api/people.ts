/**
 * `GET /api/people` (lg-33, lg-35): who is in from the open period on, who was
 * retired at a close, and how each person is shown. One answer, cached whole
 * under one key (`queries.ts`): the shell takes the names from it, and a screen
 * that offers people to pick takes the ids.
 */

import { ROUTES } from "@ledger/contract";
import type { PeopleResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchPeople(signal?: AbortSignal): Promise<PeopleResponse> {
  return await requestJson<PeopleResponse>(ROUTES.people, { signal });
}
