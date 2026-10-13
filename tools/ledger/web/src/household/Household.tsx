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
import type { AddMemberRequest, HouseholdResponse, MembershipRecord } from "@ledger/contract";
import { addHouseholdMember, fetchHousehold } from "../api/households.ts";
import { MemberForm } from "./MemberForm.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; household: HouseholdResponse };

function describe(record: MembershipRecord): string {
  const what = record.action === "add" ? "added" : "removed";
  const by = record.by === "operator" ? "the operator" : record.by;
  return `${record.address} ${what} as ${record.person}, by ${by}`;
}

export function Household({ id }: { id: string }): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });

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
  // Every name the household has held, since a name once in the books can return.
  const people = [...new Set(history.map((record) => record.person))].toSorted();
  const add = async (member: AddMemberRequest) => {
    const added = await addHouseholdMember(id, member);
    await refresh();
    return added;
  };

  return (
    <section aria-labelledby="household-heading" className="card">
      <h2 id="household-heading">Household</h2>
      <p className="muted">{household.name}</p>

      <h3>Members</h3>
      <ul className="members">
        {members.map((member) => (
          <li key={member.address}>
            <strong>{member.person}</strong> <span>{member.address}</span>
          </li>
        ))}
      </ul>

      <h3>Add a member</h3>
      <MemberForm people={people} onAdd={add} />
      <p className="muted hint">
        Only whoever runs the ledger can remove a member, since removing cuts a person off from
        their records.
      </p>

      <h3>History</h3>
      <ol className="members">
        {history.toReversed().map((record, index) => (
          <li key={`${String(history.length - index)}`}>
            <span className="muted">{record.at.slice(0, 10)}</span> <span>{describe(record)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
