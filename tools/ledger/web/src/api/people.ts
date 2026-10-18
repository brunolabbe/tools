/**
 * How each person is shown (lg-33): `GET /api/people`'s map from id to shown
 * name, which the shell fetches for every screen. The ids alone, for a screen
 * that offers people to pick, are `fetchPeople` in `rules.ts`.
 */

import { ROUTES } from "@ledger/contract";
import type { PeopleResponse } from "@ledger/contract";
import { requestJson } from "./client.ts";

export async function fetchPeopleNames(signal?: AbortSignal): Promise<PeopleResponse["names"]> {
  return (await requestJson<PeopleResponse>(ROUTES.people, { signal })).names;
}
