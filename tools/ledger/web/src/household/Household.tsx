/**
 * A member's own household (lg-22): who belongs now, every change to that and
 * who made it, and adding a member. There is no removal here — removing cuts a
 * person off from their own records, so it goes through an admin
 * (`docs/00-ANALYSIS.md` §7).
 *
 * It shows the addresses of the household's own members only: the API answers
 * this household's records to its members and nobody else.
 */

import { useCallback, useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { AddMemberRequest, HouseholdResponse } from "@ledger/contract";
import { addHouseholdMember, fetchHousehold } from "../api/households.ts";
import { byShownName, shownName, usePeopleNames } from "../people.tsx";
import type { ShownNames } from "../people.tsx";
import { MemberForm } from "./MemberForm.tsx";
import { MortgageSetting } from "./MortgageSetting.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; household: HouseholdResponse };

type HistoryRecord = HouseholdResponse["history"][number];

/**
 * Each record in words, oldest first. A person is named as they are shown now,
 * and a rename by what they were shown as before it and what after (lg-33). A
 * person's first name, given with the add that made them (lg-76), is no change
 * of its own: it is `null`, and only tells a later rename what they were.
 */
function describeAll(history: readonly HistoryRecord[], names: ShownNames): (string | null)[] {
  const before = new Map<string, string>();
  return history.map((record) => {
    const by = record.by === "operator" ? "the operator" : record.by;
    if (record.action === "name") {
      before.set(record.person, record.name);
      return null;
    }
    if (record.action === "rename") {
      const was = before.get(record.person) ?? shownName({}, record.person);
      before.set(record.person, record.name);
      return `${was} renamed ${record.name}, by ${by}`;
    }
    const what = record.action === "add" ? "added" : "removed";
    return `${record.address} ${what} as ${shownName(names, record.person)}, by ${by}`;
  });
}

export function Household({ id }: { id: string }): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const shown = usePeopleNames();

  const refresh = useCallback(
    async (signal?: AbortSignal): Promise<void> => {
      try {
        setLoad({ state: "ready", household: await fetchHousehold(id, signal) });
      } catch (error: unknown) {
        if (signal?.aborted !== true) {
          setLoad({ state: "failed", message: AppError.from(error).message });
        }
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- `refresh` sets state only after its request settles; the rule cannot see through the await.
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Loading the household…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { household, members, history } = load.household;
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
  const people = [...new Set(history.map((record) => record.person))].toSorted(byShownName(names));
  // Newest first, and only the records that are a change of their own.
  const described = describeAll(history, names)
    .map((text, index) => ({ text, at: history[index]?.at ?? "", index }))
    .filter((line): line is { text: string; at: string; index: number } => line.text !== null)
    .toReversed();
  const add = async (member: AddMemberRequest) => {
    const added = await addHouseholdMember(id, member);
    await refresh();
    return added;
  };

  return (
    <>
      <section aria-labelledby="household-heading" className="card">
        <h2 id="household-heading">Household</h2>
        <p className="muted">{household.name}</p>

        <h3>Members</h3>
        <ul className="members">
          {members
            .toSorted((one, other) => byShownName(names)(one.person, other.person))
            .map((member) => (
              <li key={member.address}>
                <strong>{shownName(names, member.person)}</strong> <span>{member.address}</span>
              </li>
            ))}
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
