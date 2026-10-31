/**
 * The admin's screen (lg-22): every household and its members, with adding and
 * removing any member, changing a member's address (lg-34), renaming a person
 * (lg-33), retiring a person from the books at the next close or bringing them
 * back (lg-35), creating a household by adding its first person (lg-71), and
 * renaming any household (lg-77).
 * Only an admin is answered (`LEDGER_ADMINS`), whether or not they are in a
 * household, and being one shows no household's books.
 *
 * It lists every household's addresses in one place as well, because each must
 * also be admitted on the ledger's Access policy, which the operator does in the
 * Cloudflare dashboard (`docs/02-DEPLOYMENT.md`, step 2): this is the list to
 * check that policy against.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { AppError } from "@ledger/contract";
import type {
  AddMemberRequest,
  AdminHousehold,
  CreateHouseholdRequest,
  PersonStanding,
  RetirePersonRequest,
} from "@ledger/contract";
import {
  adminAddMember,
  adminChangeAddress,
  adminRemoveMember,
  adminRenameHousehold,
  adminRenamePerson,
  adminRetirePerson,
  createHousehold,
  fetchAdminHouseholds,
} from "../api/households.ts";
import {
  ACCESS_POLICY_NOTE,
  MemberForm,
  NO_EMAIL,
  emptyNameHint,
} from "../household/MemberForm.tsx";
import { HouseholdName } from "../household/HouseholdName.tsx";
import { byShownName, shownName } from "../people.tsx";
import type { ShownNames } from "../people.tsx";

type Load =
  | { state: "loading" }
  | { state: "failed"; message: string }
  | { state: "ready"; households: AdminHousehold[] };

export function Admin(): React.ReactElement {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      setLoad({ state: "ready", households: await fetchAdminHouseholds(signal) });
    } catch (error: unknown) {
      if (signal?.aborted !== true) {
        setLoad({ state: "failed", message: AppError.from(error).message });
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // oxlint-disable-next-line react/set-state-in-effect -- `refresh` sets state only after its request settles; the rule cannot see through the await.
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  if (load.state === "loading") return <p className="muted">Loading the households…</p>;
  if (load.state === "failed") {
    return (
      <p className="bad" role="alert">
        {load.message}
      </p>
    );
  }

  const { households } = load;
  // lg-74: a person without an email signs in nowhere, so Access has nothing to admit.
  const addresses = households.flatMap((household) =>
    household.members.flatMap((member) => (member.address === null ? [] : [member.address])),
  );
  // lg-71: the answer to a create is the new card, so it goes in without asking
  // for the list again, where the list puts it: the API orders households by id.
  const created = (household: AdminHousehold): void => {
    setLoad({
      state: "ready",
      households: [...households, household].toSorted((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    });
  };

  return (
    <section aria-labelledby="admin-heading" className="stack">
      <h2 id="admin-heading">Households</h2>
      <p className="muted hint">{ACCESS_POLICY_NOTE}</p>

      {households.map((household) => (
        <HouseholdCard key={household.id} household={household} onChange={refresh} />
      ))}

      <NewHousehold first={households.length === 0} onCreated={created} />

      {households.length > 0 && (
        <section aria-labelledby="admit-heading" className="card">
          <h3 id="admit-heading">Emails to admit</h3>
          <p className="muted hint">
            Every household&rsquo;s emails. Each must be on the ledger&rsquo;s Access policy.
          </p>
          {addresses.length === 0 ? (
            <p className="muted">No emails yet.</p>
          ) : (
            <ul className="members" aria-label="Emails to admit">
              {addresses.map((address) => (
                <li key={address}>{address}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

/**
 * How a household's card is told apart from another's (lg-71). Every household
 * made by adding its first person is called "Home" and its id is a UUID, which
 * says nothing to whoever reads it, so the card names the household's people:
 * everyone it has named, a member who has left included, under the names they
 * are shown by. That list only grows (a name stays in the books), so a card
 * keeps its label as members come and go. A household that has never named
 * anyone, which only one made before lg-71 can be, is told by its id instead.
 */
function householdLabel(household: AdminHousehold, names: ShownNames): string {
  const people = household.people.map((one) => shownName(names, one.person));
  if (people.length === 0) return `${household.name} (${household.id})`;
  return `${household.name}: ${new Intl.ListFormat("en", { type: "conjunction" }).format(people)}`;
}

function HouseholdCard(props: {
  household: AdminHousehold;
  onChange: () => Promise<void>;
}): React.ReactElement {
  const { household, onChange } = props;
  const headingId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  // The address being edited in place (lg-34); at most one, and never with a removal open.
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The listing's own names: an admin may be in no household, so has no other map.
  // Everyone the household has named is in `people` (lg-35), a member who has left included.
  const names: ShownNames = Object.fromEntries([
    ...household.people.map((one) => [one.person, one.name]),
    ...household.members.map((member) => [member.person, member.name]),
  ]);
  // Who an address can be added for: the people who have one now, and those held
  // without one (lg-74), by shown name (lg-76).
  const people = [...new Set(household.members.map((member) => member.person))].toSorted(
    byShownName(names),
  );
  const label = householdLabel(household, names);

  const add = async (member: AddMemberRequest) => {
    const added = await adminAddMember(household.id, member);
    await onChange();
    return added;
  };

  const rename = async (name: string): Promise<void> => {
    await adminRenameHousehold(household.id, { name });
    await onChange();
  };

  const remove = async (address: string): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await adminRemoveMember(household.id, address);
      setConfirming(null);
      await onChange();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="card">
      <HouseholdName
        level="h3"
        headingId={headingId}
        title={label}
        name={household.name}
        onRename={rename}
      />
      {household.members.length === 0 ? (
        <p className="muted">Nobody yet.</p>
      ) : (
        <ul className="members">
          {household.members.map((member) => {
            const { address } = member;
            if (address === null) {
              // lg-74: nothing to edit or remove; an email is given through the form below.
              return (
                <li key={`person:${member.person}`}>
                  <span>
                    <strong>{shownName(names, member.person)}</strong>{" "}
                    <span className="muted">{NO_EMAIL}</span>
                  </span>
                </li>
              );
            }
            return (
              <li key={address}>
                <span>
                  <strong>{shownName(names, member.person)}</strong> {address}
                </span>
                {editing === address ? (
                  <ChangeAddress
                    household={household.id}
                    address={address}
                    onCancel={() => setEditing(null)}
                    onChanged={async () => {
                      setEditing(null);
                      await onChange();
                    }}
                  />
                ) : confirming === address ? (
                  <span className="actions">
                    <button
                      type="button"
                      className="small"
                      disabled={busy}
                      onClick={() => void remove(address)}
                    >
                      Remove {address}
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      disabled={busy}
                      onClick={() => setConfirming(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="actions">
                    <button
                      type="button"
                      className="small secondary"
                      aria-label={`Edit ${address}`}
                      disabled={busy}
                      onClick={() => {
                        setConfirming(null);
                        setEditing(address);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      aria-label={`Remove ${address}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setConfirming(address);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {confirming !== null && (
        <p className="muted hint">
          Removing an email signs it out of this household on its next request. Its records keep the
          person&rsquo;s name.
        </p>
      )}
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      {household.people.length > 0 && (
        <>
          <h4>People</h4>
          <ul className="members" aria-label={`People in ${label}`}>
            {household.people.map((one) => (
              <RenamePerson
                key={one.person}
                household={household.id}
                person={one.person}
                name={shownName(names, one.person)}
                standing={one.standing}
                onChange={onChange}
              />
            ))}
          </ul>
          <p className="muted hint">
            A rename changes how a person is shown on every screen. Their records keep the id they
            were added under.
          </p>
          <p className="muted hint">
            Retiring a person takes effect at the household&rsquo;s next close: they settle the open
            period, and every period after leaves them out. Remove their emails first, if they have
            any. Bringing them back works the same way.
          </p>
        </>
      )}
      <MemberForm people={people} names={names} onAdd={add} />
    </section>
  );
}

/**
 * A member's address, opened in place (lg-34). One request swaps it, so the
 * person is never without an address; the new one still has to be admitted on
 * the Access policy, which the note says.
 */
function ChangeAddress(props: {
  household: string;
  address: string;
  onCancel: () => void;
  onChanged: () => Promise<void>;
}): React.ReactElement {
  const { household, address, onCancel, onChanged } = props;
  const id = useId();
  const [typed, setTyped] = useState(address);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await adminChangeAddress(household, { from: address, to: typed.trim() });
      await onChanged();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (typed.trim() === "") {
      setProblem("Give the email to sign in with.");
      return;
    }
    void save();
  };

  return (
    <form className="member-form" onSubmit={submit}>
      <label htmlFor={`${id}-address`}>New email for {address}</label>
      <input
        id={`${id}-address`}
        type="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <p className="muted hint">{ACCESS_POLICY_NOTE}</p>
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="small" disabled={busy}>
          Save
        </button>
        <button type="button" className="small secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Where a person stands in the books, as the admin's list says it (lg-35). */
const STANDING_LABELS: Record<PersonStanding, string> = {
  in: "in the books",
  retiring: "retiring at the next close",
  retired: "retired",
  returning: "returning at the next close",
};

/**
 * The one request each standing offers (lg-35): retire someone in, undo a
 * retirement or a return no close has applied yet, or bring a retired one back.
 */
const STANDING_ACTIONS: Record<
  PersonStanding,
  { action: RetirePersonRequest["action"]; label: string; named: (name: string) => string }
> = {
  in: { action: "retire", label: "Retire", named: (name) => `Retire ${name}` },
  retiring: { action: "return", label: "Keep in", named: (name) => `Keep ${name} in` },
  retired: { action: "return", label: "Bring back", named: (name) => `Bring ${name} back` },
  returning: {
    action: "retire",
    label: "Keep retired",
    named: (name) => `Keep ${name} retired`,
  },
};

/** One person, shown by name, with a Rename beside them (lg-33) and their standing (lg-35). */
function RenamePerson(props: {
  household: string;
  person: string;
  name: string;
  standing: PersonStanding;
  onChange: () => Promise<void>;
}): React.ReactElement {
  const { household, person, name, standing, onChange } = props;
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = STANDING_ACTIONS[standing];

  const retire = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await adminRetirePerson(household, { person, action: next.action });
      await onChange();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await adminRenamePerson(household, { person, name: typed.trim() });
      setEditing(false);
      await onChange();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (typed.trim() === "") {
      setProblem("Give the name to show them under.");
      return;
    }
    void save();
  };

  if (!editing) {
    return (
      <li>
        <span>
          <strong>{name}</strong> <span className="muted">{STANDING_LABELS[standing]}</span>
        </span>
        <span className="actions">
          <button
            type="button"
            className="small secondary"
            aria-label={`Rename ${name}`}
            disabled={busy}
            onClick={() => {
              setTyped(name);
              setProblem(null);
              setEditing(true);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="small secondary"
            aria-label={next.named(name)}
            disabled={busy}
            onClick={() => void retire()}
          >
            {next.label}
          </button>
        </span>
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
      </li>
    );
  }
  return (
    <li>
      <form className="member-form" onSubmit={submit}>
        <label htmlFor={`${id}-name`}>New name for {name}</label>
        <input
          id={`${id}-name`}
          autoComplete="off"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="small" disabled={busy}>
            Save
          </button>
          <button
            type="button"
            className="small secondary"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

/**
 * A new household, made by adding its first person (lg-71): the email they sign
 * in with and their name, and nothing else. The API gives the household its id
 * and calls it "Home". With no household yet it is the screen's only form. The
 * name may be left empty (lg-76): the API shows the person under the email's
 * part before the @.
 */
function NewHousehold(props: {
  first: boolean;
  onCreated: (household: AdminHousehold) => void;
}): React.ReactElement {
  const { first, onCreated } = props;
  const id = useId();
  const [address, setAddress] = useState("");
  const [person, setPerson] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (household: CreateHouseholdRequest): Promise<void> => {
    setBusy(true);
    try {
      const made = await createHousehold(household);
      setAddress("");
      setPerson("");
      onCreated(made);
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (address.trim() === "") {
      setProblem("Give the first person's email, and their name if you like.");
      return;
    }
    setProblem(null);
    const named = person.trim();
    void create({ address: address.trim(), ...(named === "" ? {} : { person: named }) });
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="card">
      <h3 id={`${id}-heading`}>New household</h3>
      <p className="muted hint">
        {first ? "There is no household yet. " : ""}A household starts with its first person. It is
        called Home.
      </p>
      <form className="member-form" onSubmit={submit}>
        <label htmlFor={`${id}-address`}>Email</label>
        <input
          id={`${id}-address`}
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <label htmlFor={`${id}-person`}>Person</label>
        <input
          id={`${id}-person`}
          autoComplete="off"
          spellCheck={false}
          value={person}
          onChange={(event) => setPerson(event.target.value)}
        />
        <p className="muted hint">{emptyNameHint(address)}</p>
        {problem !== null && (
          <p className="bad" role="alert">
            {problem}
          </p>
        )}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Create household
          </button>
        </div>
      </form>
    </section>
  );
}
