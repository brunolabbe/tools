/**
 * The admin's screen (lg-22): every household and its members, with adding and
 * removing any member and creating a household. Only an admin is answered
 * (`LEDGER_ADMINS`), whether or not they are in a household, and being one shows
 * no household's books.
 *
 * It lists every household's addresses in one place as well, because each must
 * also be admitted on the ledger's Access policy, which the operator does in the
 * Cloudflare dashboard (`docs/02-DEPLOYMENT.md`, step 2): this is the list to
 * check that policy against.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { AppError } from "@ledger/contract";
import type { AddMemberRequest, AdminHousehold, CreateHouseholdRequest } from "@ledger/contract";
import {
  adminAddMember,
  adminRemoveMember,
  createHousehold,
  fetchAdminHouseholds,
} from "../api/households.ts";
import { ACCESS_POLICY_NOTE, MemberForm } from "../household/MemberForm.tsx";

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

  const addresses = load.households.flatMap((household) =>
    household.members.map((member) => member.address),
  );

  return (
    <section aria-labelledby="admin-heading">
      <h2 id="admin-heading">Households</h2>
      <p className="muted hint">{ACCESS_POLICY_NOTE}</p>

      {load.households.map((household) => (
        <HouseholdCard key={household.id} household={household} onChange={refresh} />
      ))}

      <NewHousehold onCreated={refresh} />

      <section aria-labelledby="admit-heading" className="card">
        <h3 id="admit-heading">Addresses to admit</h3>
        <p className="muted hint">
          Every household&rsquo;s addresses. Each must be on the ledger&rsquo;s Access policy.
        </p>
        {addresses.length === 0 ? (
          <p className="muted">No addresses yet.</p>
        ) : (
          <ul className="members" aria-label="Addresses to admit">
            {addresses.map((address) => (
              <li key={address}>{address}</li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function HouseholdCard(props: {
  household: AdminHousehold;
  onChange: () => Promise<void>;
}): React.ReactElement {
  const { household, onChange } = props;
  const headingId = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const people = [...new Set(household.members.map((member) => member.person))].toSorted();

  const add = async (member: AddMemberRequest) => {
    const added = await adminAddMember(household.id, member);
    await onChange();
    return added;
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
      <h3 id={headingId}>
        {household.name} <span className="muted">({household.id})</span>
      </h3>
      {household.members.length === 0 ? (
        <p className="muted">Nobody yet.</p>
      ) : (
        <ul className="members">
          {household.members.map((member) => (
            <li key={member.address}>
              <span>
                <strong>{member.person}</strong> {member.address}
              </span>
              {confirming === member.address ? (
                <span className="actions">
                  <button
                    type="button"
                    className="small"
                    disabled={busy}
                    onClick={() => void remove(member.address)}
                  >
                    Remove {member.address}
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
                <button
                  type="button"
                  className="small secondary"
                  aria-label={`Remove ${member.address}`}
                  disabled={busy}
                  onClick={() => setConfirming(member.address)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirming !== null && (
        <p className="muted hint">
          Removing an address signs it out of this household on its next request. Its records keep
          the person&rsquo;s name.
        </p>
      )}
      {problem !== null && (
        <p className="bad" role="alert">
          {problem}
        </p>
      )}
      <MemberForm people={people} onAdd={add} />
    </section>
  );
}

function NewHousehold({ onCreated }: { onCreated: () => Promise<void> }): React.ReactElement {
  const id = useId();
  const [householdId, setHouseholdId] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (household: CreateHouseholdRequest): Promise<void> => {
    setBusy(true);
    try {
      await createHousehold(household);
      setHouseholdId("");
      setName("");
      await onCreated();
    } catch (error: unknown) {
      setProblem(AppError.from(error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.SyntheticEvent): void => {
    event.preventDefault();
    if (householdId.trim() === "" || name.trim() === "") {
      setProblem("Give the household an id and a name.");
      return;
    }
    setProblem(null);
    void create({ id: householdId.trim(), name: name.trim() });
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="card">
      <h3 id={`${id}-heading`}>New household</h3>
      <form className="member-form" onSubmit={submit}>
        <label htmlFor={`${id}-id`}>Id</label>
        <input
          id={`${id}-id`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={householdId}
          onChange={(event) => setHouseholdId(event.target.value)}
        />
        <p className="muted hint">One lowercase word, a to z. It cannot be changed.</p>
        <label htmlFor={`${id}-name`}>Name</label>
        <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} />
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
