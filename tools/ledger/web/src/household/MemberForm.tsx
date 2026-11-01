/**
 * Adding an address to a household as a person (lg-22), on the member's screen
 * and on the admin's. The person is one the household already has, or a
 * new one: a household holds any number of people (lg-23).
 *
 * A person already there is offered by the name they are shown under, and the
 * form sends the name as typed (lg-76): the API finds the person shown under
 * it, or one added before lg-76 whose id it is. Text that names nobody is a new
 * person, whom the API gives a generated id and shows under that text; left
 * empty, under the email's part before the @, numbered if someone already is.
 *
 * Whoever adds an address is told it must also be admitted on the ledger's
 * Access policy, which the operator does in the Cloudflare dashboard
 * (`docs/02-DEPLOYMENT.md`, step 2): until then Access turns the new member
 * away before the ledger ever sees them.
 *
 * The email may be left empty (lg-74): a name alone is a new person who counts
 * in the books and never signs in, so has nothing for Access to admit. Picking
 * such a person from the list and typing an email gives them one, as the same
 * person.
 */

import { useId, useState } from "react";
import { AppError } from "@ledger/contract";
import type { AddMemberRequest, HouseholdMember } from "@ledger/contract";
import { shownName } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

export const ACCESS_POLICY_NOTE =
  "Every email must also be admitted on the ledger's Access policy, which whoever runs the ledger does in the Cloudflare dashboard. Until it is, that email cannot sign in.";

/** What the member lists show in place of an address for a person who has none (lg-74). */
export const NO_EMAIL = "no email";

/** The Email field's hint (lg-74): what leaving it empty makes. */
export const NO_EMAIL_HINT =
  "Email may be left empty: a person without one counts in the books but cannot sign in. You can add an email for them later.";

export interface MemberFormProps {
  /** The person ids the household holds, offered to pick from by their shown names. */
  people: readonly string[];
  /** How each of them is shown. */
  names: ShownNames;
  /** Rejects with an `AppError` to put the server's own sentence in front of the person. */
  onAdd: (member: AddMemberRequest) => Promise<HouseholdMember>;
}

/**
 * What the Person field says it does when left empty (lg-76): the name the API
 * will show a new person under, from the email typed so far.
 */
export function emptyNameHint(address: string): string {
  const typed = address.trim().toLowerCase();
  const at = typed.lastIndexOf("@");
  const local = at > 0 ? typed.slice(0, at) : "";
  return local === ""
    ? "Person may be left empty when an email is given: they are then shown under the email's part before the @, numbered if someone here already is."
    : `Person may be left empty: they are then shown as ${local}, numbered if someone here already is.`;
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
        added.address === null
          ? `Added ${added.name}, who counts in the books and cannot sign in.`
          : `Added ${added.address} as ${added.name}. Ask whoever runs the ledger to admit ${added.address} on its Access policy, if they have not already.`,
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
    const typed = address.trim();
    const named = person.trim();
    if (typed === "" && named === "") {
      setProblem("Give an email, the person's name, or both.");
      return;
    }
    setProblem(null);
    void add({
      ...(typed === "" ? {} : { address: typed }),
      ...(named === "" ? {} : { person: named }),
    });
  };

  return (
    <form className="member-form" onSubmit={submit}>
      <label htmlFor={`${id}-address`}>Email</label>
      <input
        id={`${id}-address`}
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        value={address}
        onChange={(event) => setAddress(event.target.value)}
      />
      <p className="muted hint">{NO_EMAIL_HINT}</p>
      <label htmlFor={`${id}-person`}>Person</label>
      <input
        id={`${id}-person`}
        list={`${id}-people`}
        autoComplete="off"
        spellCheck={false}
        value={person}
        onChange={(event) => setPerson(event.target.value)}
      />
      <p className="muted hint">{emptyNameHint(address)}</p>
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
        <button className="primary" type="submit" disabled={busy}>
          Add member
        </button>
      </div>
    </form>
  );
}
