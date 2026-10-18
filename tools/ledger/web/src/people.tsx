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
 */

import { createContext, useContext } from "react";

/** Person id to shown name, as `PeopleResponse.names` carries it. */
export type ShownNames = Readonly<Record<string, string>>;

/** How `person` is shown: their name in `names`, or their id. */
export function shownName(names: ShownNames, person: string): string {
  return Object.hasOwn(names, person) ? (names[person] ?? person) : person;
}

const PeopleNames = createContext<ShownNames>({});

export const PeopleNamesProvider = PeopleNames.Provider;

/** The map the shell fetched, or none, which shows everyone under their id. */
export function usePeopleNames(): ShownNames {
  return useContext(PeopleNames);
}
