/**
 * The household directory from the app (lg-22): a household's own members and
 * history, for its members, and every household, for an admin. Every write is a
 * `POST` the directory appends.
 */

import { ROUTES } from "@ledger/contract";
import type {
  AddMemberRequest,
  AdminHousehold,
  AdminHouseholdsResponse,
  ChangeAddressRequest,
  CreateHouseholdRequest,
  HouseholdMember,
  HouseholdResponse,
  HouseholdSummary,
  PersonName,
  RenamePersonRequest,
} from "@ledger/contract";
import { requestJson } from "./client.ts";

const at = (route: string, household: string): string =>
  route.replace(":id", encodeURIComponent(household));

export async function fetchHousehold(
  household: string,
  signal?: AbortSignal,
): Promise<HouseholdResponse> {
  return await requestJson<HouseholdResponse>(at(ROUTES.household, household), { signal });
}

export async function addHouseholdMember(
  household: string,
  member: AddMemberRequest,
): Promise<HouseholdMember> {
  return await requestJson<HouseholdMember>(at(ROUTES.householdMembers, household), {
    method: "POST",
    body: member,
  });
}

/** Every household and its members; refused as `FORBIDDEN` for anyone but an admin. */
export async function fetchAdminHouseholds(signal?: AbortSignal): Promise<AdminHousehold[]> {
  return (await requestJson<AdminHouseholdsResponse>(ROUTES.adminHouseholds, { signal }))
    .households;
}

export async function createHousehold(
  household: CreateHouseholdRequest,
): Promise<HouseholdSummary> {
  return await requestJson<HouseholdSummary>(ROUTES.adminHouseholds, {
    method: "POST",
    body: household,
  });
}

export async function adminAddMember(
  household: string,
  member: AddMemberRequest,
): Promise<HouseholdMember> {
  return await requestJson<HouseholdMember>(at(ROUTES.adminMembers, household), {
    method: "POST",
    body: member,
  });
}

export async function adminRemoveMember(
  household: string,
  address: string,
): Promise<HouseholdMember> {
  return await requestJson<HouseholdMember>(at(ROUTES.adminMemberRemove, household), {
    method: "POST",
    body: { address },
  });
}

/** A member's address, swapped in one request (lg-34): the person and their books are the same. */
export async function adminChangeAddress(
  household: string,
  change: ChangeAddressRequest,
): Promise<HouseholdMember> {
  return await requestJson<HouseholdMember>(at(ROUTES.adminMemberAddress, household), {
    method: "POST",
    body: change,
  });
}

/** A person's shown name (lg-33): their id stays, so nothing in the books changes. */
export async function adminRenamePerson(
  household: string,
  rename: RenamePersonRequest,
): Promise<PersonName> {
  return await requestJson<PersonName>(at(ROUTES.adminPersonRename, household), {
    method: "POST",
    body: rename,
  });
}
