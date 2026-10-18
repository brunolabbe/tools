/**
 * Adding an address to a household as a person (lg-22), on the member's screen
 * and on the admin's. The person is one the household already has, or a
 * new one: a household holds any number of people (lg-23).
 *
 * A person already there is offered by the name they are shown under, and the
 * form sends their id, which is what the directory and the books key on
 * (lg-33). Text that is no one's shown name is sent as it was typed, and is
 * the new person's id.
 *
 * Whoever adds an address is told it must also be admitted on the ledger's
 * Access policy, which the operator does in the Cloudflare dashboard
 * (`docs/02-DEPLOYMENT.md`, step 2): until then Access turns the new member
 * away before the ledger ever sees them.
 */

import { useId, useState } from "react";
import { AppError } from "@ledger/contract";
import type { AddMemberRequest, HouseholdMember } from "@ledger/contract";
import { shownName } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

export const ACCESS_POLICY_NOTE =
  "Every address must also be admitted on the ledger's Access policy, which whoever runs the ledger does in the Cloudflare dashboard. Until it is, that address cannot sign in.";

export interface MemberFormProps {
  /** The person ids the household holds, offered to pick from by their shown names. */
  people: readonly string[];
  /** How each of them is shown. */
  names: ShownNames;
  /** Rejects with an `AppError` to put the server's own sentence in front of the person. */
  onAdd: (member: AddMemberRequest) => Promise<HouseholdMember>;
}

/** The id of the person shown as `typed`, or what was typed: a new person's id. */
function personFor(typed: string, people: readonly string[], names: ShownNames): string {
  return people.find((person) => shownName(names, person) === typed) ?? typed;
}

export function MemberForm({ people, names, onAdd }: MemberFormProps): React.ReactElement {
  const id = useId();
  const [address, setAddress] = useState("");
  const first = people[0];
  const [person, setPerson] = useState(first === undefined ? "" : shownName(names, first));
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (member: AddMemberRequest): Promise<void> => {
    setBusy(true);
    try {
      const added = await onAdd(member);
      setAddress("");
      setNotice(
        `Added ${added.address} as ${added.name}. Ask whoever runs the ledger to admit ${added.address} on its Access policy, if they have not already.`,
      );
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    setNotice(null);
    if (address.trim() === "" || person.trim() === "") {
      setProblem("Give the address and the person's name it stands under.");
      return;
    }
    setProblem(null);
    void add({ address: address.trim(), person: personFor(person.trim(), people, names) });
  };

  return (
    <form className="member-form" onSubmit={submit}>
      <label htmlFor={`${id}-address`}>Address</label>
      <input
        id={`${id}-address`}
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <label htmlFor={`${id}-person`}>Person</label>
      <input
        id={`${id}-person`}
        list={`${id}-people`}
        autoComplete="off"
        spellCheck={false}
        value={person}
        onChange={(event) => setPerson(event.target.value)}
      />
      <datalist id={`${id}-people`}>
        {people.map((one) => (
          <option key={one} value={shownName(names, one)}>
            {shownName(names, one)}
          </option>
        ))}
      </datalist>
      <p className="muted hint">{ACCESS_POLICY_NOTE}</p>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {notice !== null && <output>{notice}</output>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Add member
        </button>
      </div>
    </form>
  );
}
