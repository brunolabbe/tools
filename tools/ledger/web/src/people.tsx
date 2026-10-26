/**
 * How a person is shown (lg-33). A person's id is what the books store and
 * never changes; the name they are shown under is the household directory's,
 * and an admin can change it. Every screen prints a person through
 * `shownName`, over the one map `GET /api/people` answers, and never prints the
 * id itself: a person with no shown name is in the map under their id, and one
 * the map has not heard of is shown under their id too.
 *
 * The shell fetches the map and hands it down through `PeopleNamesProvider`; a
 * screen rendered without one shows every person under their id, as every
 * screen did before lg-33. A chart colours a person by their place in the list
 * of ids, never by their name, so a rename changes no colour.
 *
 * A person added since lg-76 has a generated id, a UUID, which is never
 * printed: one the map has not heard of, before it answers or when it fails, is
 * "Someone". A person added before keeps their name as their id, and is shown
 * under it as ever.
 */

import { createContext, useContext } from "react";
import { GENERATED_ID } from "@ledger/contract";

/** Person id to shown name, as `PeopleResponse.names` carries it. */
export type ShownNames = Readonly<Record<string, string>>;

/** Said for a person with a generated id whom `names` does not hold (lg-76). */
export const UNNAMED = "Someone";

/** How `person` is shown: their name in `names`, or their id, unless it is a generated one. */
export function shownName(names: ShownNames, person: string): string {
  if (Object.hasOwn(names, person)) return names[person] ?? person;
  return GENERATED_ID.test(person) ? UNNAMED : person;
}

/**
 * The order a person reads a list of people in (lg-76): by how each is shown,
 * then by id where two are shown alike. A generated id's order means nothing.
 */
export function byShownName(names: ShownNames): (one: string, other: string) => number {
  return (one, other) =>
    shownName(names, one).localeCompare(shownName(names, other)) ||
    (one < other ? -1 : one > other ? 1 : 0);
}

const PeopleNames = createContext<ShownNames>({});

export const PeopleNamesProvider = PeopleNames.Provider;

/** The map the shell fetched, or none, which shows everyone under their id. */
export function usePeopleNames(): ShownNames {
  return useContext(PeopleNames);
}
