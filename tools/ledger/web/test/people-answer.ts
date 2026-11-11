/**
 * `GET /api/people`'s whole answer, as the cache holds it (lg-98): a test names
 * who is in, and who was retired if anyone, and how each is shown if not by id.
 */

import type { PeopleResponse } from "@ledger/contract";

export function peopleAnswer(
  people: readonly string[],
  retired: readonly string[] = [],
  names: Readonly<Record<string, string>> = {},
): PeopleResponse {
  return {
    people: [...people],
    retired: [...retired],
    // Only the names a test gives: a person missing from it is shown under their id,
    // or as "Someone" for a generated one (`people.tsx`).
    names: { ...names },
  };
}
