/**
 * Adding an address to a household as a person (lg-22), on the member's screen
 * and on the admin's. The person is a name the household already has, or a
 * new one while it has fewer than two; the API is what refuses a third.
 *
 * Whoever adds an address is told it must also be admitted on the ledger's
 * Access policy, which the operator does in the Cloudflare dashboard
 * (`docs/02-DEPLOYMENT.md`, step 2): until then Access turns the new member
 * away before the ledger ever sees them.
 */

import { useId, useState } from "react";
import { AppError } from "@ledger/contract";
import type { AddMemberRequest, HouseholdMember } from "@ledger/contract";

export const ACCESS_POLICY_NOTE =
  "Every address must also be admitted on the ledger's Access policy, which whoever runs the ledger does in the Cloudflare dashboard. Until it is, that address cannot sign in.";

export interface MemberFormProps {
  /** The names the household holds, offered to pick from. */
  people: readonly string[];
  /** Rejects with an `AppError` to put the server's own sentence in front of the person. */
  onAdd: (member: AddMemberRequest) => Promise<HouseholdMember>;
}

export function MemberForm({ people, onAdd }: MemberFormProps): React.ReactElement {
  const id = useId();
  const [address, setAddress] = useState("");
  const [person, setPerson] = useState(people[0] ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (member: AddMemberRequest): Promise<void> => {
    setBusy(true);
    try {
      const added = await onAdd(member);
      setAddress("");
      setNotice(
        `Added ${added.address} as ${added.person}. Ask whoever runs the ledger to admit ${added.address} on its Access policy, if they have not already.`,
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
    void add({ address: address.trim(), person: person.trim() });
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
        {people.map((name) => (
          <option key={name} value={name}>
            {name}
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
