/**
 * A member's own household (lg-22): its name, with a Rename beside it (lg-77),
 * who belongs now, every change to that and
 * who made it, and adding a member. There is no removal here — removing cuts a
 * person off from their own records, so it goes through an admin
 * (`docs/00-ANALYSIS.md` §7).
 *
 * It shows the addresses of the household's own members only: the API answers
 * this household's records to its members and nobody else.
 */

import { useQuery } from "@tanstack/react-query";
import type { AddMemberRequest, HouseholdResponse } from "@ledger/contract";
import { byShownName, shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import { failureOf, householdQuery } from "../queries.ts";
import { useWrite } from "../writes.ts";
import { HouseholdName } from "./HouseholdName.tsx";
import { MemberForm, NO_EMAIL } from "./MemberForm.tsx";
import { MortgageSetting } from "./MortgageSetting.tsx";

type HistoryRecord = HouseholdResponse["history"][number];

/**
 * Each record in words, oldest first. A person is named as they are shown now,
 * and a rename by what they were shown as before it and what after (lg-33). A
 * person's first name, given with the add that made them (lg-76), is no change
 * of its own: it is `null`, and only tells a later rename what they were. A
 * rename of the household itself names who renamed it (lg-77).
 */
function describeAll(history: readonly HistoryRecord[], names: ShownNames): (string | null)[] {
  const before = new Map<string, string>();
  return history.map((record) => {
    const by = record.by === "operator" ? "the operator" : record.by;
    if (record.action === "rename-household") return `Household renamed ${record.name}, by ${by}`;
    if (record.action === "name") {
      before.set(record.person, record.name);
      return null;
    }
    if (record.action === "rename") {
      const was = before.get(record.person) ?? shownName({}, record.person);
      before.set(record.person, record.name);
      return `${was} renamed ${record.name}, by ${by}`;
    }
    if (record.action === "add-person") {
      return `${shownName(names, record.person)} added without an email, by ${by}`;
    }
    const what = record.action === "add" ? "added" : "removed";
    return `${record.address} ${what} as ${shownName(names, record.person)}, by ${by}`;
  });
}

export function Household({ id }: { id: string }): React.ReactElement {
  const read = useQuery(householdQuery(id));
  const shown = usePeopleNames();
  const addHouseholdMember = useWrite("addHouseholdMember");
  const renameHousehold = useWrite("renameHousehold");

  const failure = failureOf(read);
  if (failure !== null) {
    return (
      <p className="bad" role="alert">
        {failure}
      </p>
    );
  }
  if (read.data === undefined) return <p className="muted">Loading the household…</p>;

  const { household, members, history } = read.data;
  // The shell's map, with the history's names over it, then the members' own:
  // this answer is the newer, and its history names everyone the household has
  // held, a person who left before the books ever enrolled them included (lg-76).
  const names: ShownNames = {
    ...shown,
    ...Object.fromEntries(
      history.flatMap((record) =>
        record.action === "name" || record.action === "rename"
          ? [[record.person, record.name]]
          : [],
      ),
    ),
    ...Object.fromEntries(members.map((member) => [member.person, member.name])),
  };
  // Every person the household has held, since a person once in the books can
  // return, in the order a person reads them (lg-76).
  const people = [
    ...new Set(
      history.flatMap((record) => (record.action === "rename-household" ? [] : [record.person])),
    ),
  ].toSorted(byShownName(names));
  // Newest first, and only the records that are a change of their own.
  const described = describeAll(history, names)
    .map((text, index) => ({ text, at: history[index]?.at ?? "", index }))
    .filter((line): line is { text: string; at: string; index: number } => line.text !== null)
    .toReversed();
  // Each resolves once the household is read again (`writes.ts`).
  const add = async (member: AddMemberRequest) => await addHouseholdMember(id, member);
  const rename = async (name: string): Promise<void> => {
    await renameHousehold(id, { name });
  };

  return (
    <>
      <section aria-labelledby="household-heading" className="card">
        <HouseholdName
          level="h2"
          headingId="household-heading"
          title={household.name}
          name={household.name}
          onRename={rename}
        />

        <h3>Members</h3>
        <ul className="members">
          {members
            .toSorted((one, other) => byShownName(names)(one.person, other.person))
            .map((member) =>
              member.address === null ? (
                // lg-74: a person who counts in the books and never signs in.
                <li key={`person:${member.person}`}>
                  <strong>{shownName(names, member.person)}</strong>{" "}
                  <span className="muted">{NO_EMAIL}</span>
                </li>
              ) : (
                <li key={member.address}>
                  <strong>{shownName(names, member.person)}</strong> <span>{member.address}</span>
                </li>
              ),
            )}
        </ul>

        <h3>Add a member</h3>
        <MemberForm people={people} names={names} onAdd={add} />
        <p className="muted hint">
          Only whoever runs the ledger can remove a member, since removing cuts a person off from
          their records.
        </p>

        <h3>History</h3>
        <ol className="members">
          {described.map((line) => (
            <li key={String(line.index)}>
              <span className="muted">{line.at.slice(0, 10)}</span> <span>{line.text}</span>
            </li>
          ))}
        </ol>
      </section>
      <MortgageSetting />
    </>
  );
}
