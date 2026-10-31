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
  AdminPerson,
  ChangeAddressRequest,
  CreateHouseholdRequest,
  CreateHouseholdResponse,
  HouseholdMember,
  HouseholdResponse,
  HouseholdSummary,
  PersonName,
  RenameHouseholdRequest,
  RenamePersonRequest,
  RetirePersonRequest,
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

/** The member's own household renamed (lg-77); the answer is it under its new name. */
export async function renameHousehold(
  household: string,
  rename: RenameHouseholdRequest,
): Promise<HouseholdSummary> {
  return await requestJson<HouseholdSummary>(at(ROUTES.householdRename, household), {
    method: "POST",
    body: rename,
  });
}

/** Any household renamed by an admin (lg-77), as its members can rename their own. */
export async function adminRenameHousehold(
  household: string,
  rename: RenameHouseholdRequest,
): Promise<HouseholdSummary> {
  return await requestJson<HouseholdSummary>(at(ROUTES.adminHouseholdRename, household), {
    method: "POST",
    body: rename,
  });
}

/** Every household and its members; refused as `FORBIDDEN` for anyone but an admin. */
export async function fetchAdminHouseholds(signal?: AbortSignal): Promise<AdminHousehold[]> {
  return (await requestJson<AdminHouseholdsResponse>(ROUTES.adminHouseholds, { signal }))
    .households;
}

/**
 * A new household, made by adding its first person (lg-71). The answer is the
 * household as the admin's list shows it, so the screen needs no second request.
 */
export async function createHousehold(
  household: CreateHouseholdRequest,
): Promise<CreateHouseholdResponse> {
  return await requestJson<CreateHouseholdResponse>(ROUTES.adminHouseholds, {
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

/**
 * A person retired from the books at the next close, or brought back at the next
 * close after it (lg-35). The answer is where they stand afterwards.
 */
export async function adminRetirePerson(
  household: string,
  request: RetirePersonRequest,
): Promise<AdminPerson> {
  return await requestJson<AdminPerson>(at(ROUTES.adminPersonRetire, household), {
    method: "POST",
    body: request,
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
