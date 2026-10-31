/**
 * The household directory, from the app (lg-22).
 *
 * Two kinds of route, and neither reads any books:
 *
 * - **A household's own**, under `/api/households/:id`, for its members only
 *   (`memberOf`): who belongs now and every change, adding a member, or a
 *   person with no email who never signs in (lg-74), and renaming the household
 *   (lg-77). There is no removal here. Removing cuts a person off from their own records, so
 *   it goes through an admin (`docs/00-ANALYSIS.md` §7).
 * - **The admin's**, under `/api/admin/`, for an address in `LEDGER_ADMINS` only
 *   (`adminOf`), who need not be in any household: every household and its
 *   members, a new household made by adding its first person (lg-71), renaming
 *   any household (lg-77), adding or removing any member, changing a
 *   member's address in one step (lg-34), and giving a person a shown name
 *   (lg-33); neither of those two changes an id, so neither touches the books.
 *   Retiring a person, or bringing them back (lg-35), is a request the
 *   household's next close applies to its books; the route touches none.
 *
 * Every guard runs in the route's `onRequest` hooks, before the body is
 * parsed, so a refusal is the same 403 whatever the request carries — a body
 * that does not parse included (lg-22's gate 1, F1): the admin's in
 * `adminRead`/`adminWrite`, which ask `adminOf` for the bucket's key, and a
 * household's in `asMember`, ahead of its rate limit. Each handler asks again,
 * so a hook taken off fails closed. Every change is a record the directory
 * appends, signed with the address that made it. A new household's books are made the way lg-21 makes
 * any household's: the first time a request or a probe needs them.
 *
 * **A member is told only that an address cannot be added**, not that it is in
 * a household already (`MEMBER_NOT_ADDED`): the reason would let any member ask
 * which household holds an address. An admin is told it. What it does not hide
 * is that an address is taken at all: a free address succeeds, under any name
 * since a household holds any number of people (lg-23), so success and
 * refusal tell a member whether an address is in some household. The owner
 * accepted that on 2026-10-13 (lg-22's gate 1, F6): any answer that tells an
 * add from a refusal carries it, and an add that succeeds is a record naming
 * the member who made it.
 */

import {
  AppError,
  ROUTES,
  addMemberRequestSchema,
  changeAddressRequestSchema,
  createHouseholdRequestSchema,
  removeMemberRequestSchema,
  renameHouseholdRequestSchema,
  renamePersonRequestSchema,
  retirePersonRequestSchema,
} from "@ledger/contract";
import type {
  AddMemberRequest,
  AdminHousehold,
  AdminHouseholdsResponse,
  AdminPerson,
  CreateHouseholdResponse,
  HouseholdMember,
  HouseholdResponse,
  HouseholdSummary,
  PersonName,
} from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { byShownName, shownName } from "../directory.ts";
import type { Directory, Household, Member } from "../directory.ts";
import { adminOf, memberOf } from "../identity.ts";
import { rateLimitsFor } from "../rate-limit.ts";

/** The `:id` the route matched. Fastify always gives a string; anything else names nothing. */
function householdIdOf(request: FastifyRequest): string {
  const id = (request.params as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

/**
 * A household's members, by how their person is shown, then by address (lg-76):
 * every membership that stands, and every person held without an email who
 * stands now, with no address (lg-74). The sort is stable, so a person's
 * addresses keep the directory's address order.
 */
function membersOf(directory: Directory, household: string): HouseholdMember[] {
  const names = directory.names(household);
  const order = byShownName(names);
  const withoutEmail = directory
    .withoutEmail(household)
    .map((person) => ({ address: null, person }));
  return [...directory.members(household), ...withoutEmail]
    .toSorted((one, other) => order(one.person, other.person))
    .map(({ address, person }) => ({ address, person, name: shownName(names, person) }));
}

/** One membership as the routes answer it, with how its person is shown (lg-33). */
function memberOfHousehold(directory: Directory, member: Member): HouseholdMember {
  const name = shownName(directory.names(member.household), member.person);
  return { address: member.address, person: member.person, name };
}

/**
 * An add as the routes make it: an address as a person (lg-76), or with no
 * address a person who has none (lg-74), answered with `address: null`.
 */
function addAs(
  directory: Directory,
  household: string,
  member: AddMemberRequest,
  change: { by: string; at: Date; newId: () => string },
): HouseholdMember {
  if (member.address === undefined) {
    // The schema refuses a request with neither; this is the narrowing.
    if (member.person === undefined) throw new AppError("BAD_REQUEST", ADD_MEMBER_SHAPE);
    const added = directory.addPerson({ household, person: member.person, ...change });
    return { address: null, person: added.person, name: added.name };
  }
  const added = directory.addMemberByName({
    household,
    address: member.address,
    person: member.person,
    ...change,
  });
  return memberOfHousehold(directory, added);
}

/**
 * Everyone the household has named, a member who has left included, with how
 * each is shown and where they stand in the books (lg-35), by how each is
 * shown (lg-76).
 */
function peopleOf(directory: Directory, household: string): AdminPerson[] {
  const names = directory.names(household);
  const order = byShownName(names);
  return [...directory.standings(household)]
    .toSorted(([one], [other]) => order(one, other))
    .map(([person, standing]) => ({
      person,
      name: shownName(names, person),
      standing,
    }));
}

/**
 * A household as the admin's list shows it: its members, each with when its
 * address first signed in (lg-75), and everyone it has named.
 */
function adminHousehold(
  directory: Directory,
  household: Household,
  signIns: ReadonlyMap<string, string>,
): AdminHousehold {
  return {
    ...household,
    members: membersOf(directory, household.id).map((member) => ({
      ...member,
      firstSignIn: member.address === null ? null : (signIns.get(member.address) ?? null),
    })),
    people: peopleOf(directory, household.id),
  };
}

/** The household an admin named, or `HOUSEHOLD_NOT_FOUND`. */
function namedHousehold(directory: Directory, id: string): Household {
  const household = directory.household(id);
  if (household === undefined) throw new AppError("HOUSEHOLD_NOT_FOUND");
  return household;
}

/** The refusal of a rename's body, from either route (lg-77). */
const RENAME_HOUSEHOLD_SHAPE = "Send the name to call the household by, 1 to 80 characters.";

const ADD_MEMBER_SHAPE =
  "Send an email, the name of the person it stands under, or both; a name with no email is a person who never signs in.";

/** A household route's guard, as a hook: the caller is a member of the household the path names. */
async function asMember(request: FastifyRequest): Promise<void> {
  memberOf(request, householdIdOf(request));
}

export function registerHouseholdRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write, adminRead, adminWrite } = rateLimitsFor(context);
  const { directory } = context;

  app.get(ROUTES.household, { onRequest: [asMember, read] }, async (request) => {
    const id = householdIdOf(request);
    memberOf(request, id);
    const body: HouseholdResponse = {
      household: namedHousehold(directory, id),
      members: membersOf(directory, id),
      history: directory.history(id),
    };
    return body;
  });

  app.post(ROUTES.householdMembers, { onRequest: [asMember, write] }, async (request) => {
    const id = householdIdOf(request);
    const caller = memberOf(request, id);
    const draft = addMemberRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", ADD_MEMBER_SHAPE);
    try {
      // lg-76: `person` is a name as typed; a new one is a person under a UUID.
      // lg-74: with no address, a person who never signs in.
      const body: HouseholdMember = addAs(directory, id, draft.data, {
        by: caller.email.toLowerCase(),
        at: context.now(),
        newId: context.newId,
      });
      return body;
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "ADDRESS_ALREADY_A_MEMBER") {
        throw new AppError("MEMBER_NOT_ADDED");
      }
      throw error;
    }
  });

  // lg-77: a member renames their own household. The record is signed with
  // the caller's address, as an add is, and the households row is not touched.
  app.post(ROUTES.householdRename, { onRequest: [asMember, write] }, async (request) => {
    const id = householdIdOf(request);
    const caller = memberOf(request, id);
    const draft = renameHouseholdRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", RENAME_HOUSEHOLD_SHAPE);
    const body: HouseholdSummary = directory.renameHousehold({
      household: id,
      name: draft.data.name,
      by: caller.email.toLowerCase(),
      at: context.now(),
    });
    return body;
  });

  // The admin's. The hooks ask `adminOf` for the bucket's key, so a non-admin
  // is refused there.
  app.get(ROUTES.adminHouseholds, { onRequest: adminRead }, async (request) => {
    adminOf(request);
    const signIns = directory.firstSignIns();
    const body: AdminHouseholdsResponse = {
      households: directory
        .households()
        .map((household) => adminHousehold(directory, household, signIns)),
    };
    return body;
  });

  // lg-71: a household is made by adding its first person, under a generated
  // UUID and the name "Home", in one transaction; the strict schema refuses a
  // request that still names an id or a name.
  app.post(ROUTES.adminHouseholds, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const draft = createHouseholdRequestSchema.safeParse(request.body);
    if (!draft.success) {
      throw new AppError(
        "BAD_REQUEST",
        "Send the first person's email, and their name if you give one.",
      );
    }
    const { household } = directory.createHousehold({
      id: context.newId(),
      ...draft.data,
      by: admin,
      at: context.now(),
      newId: context.newId,
    });
    const body: CreateHouseholdResponse = adminHousehold(
      directory,
      household,
      directory.firstSignIns(),
    );
    return body;
  });

  // lg-77: an admin renames any household, as its members can.
  app.post(ROUTES.adminHouseholdRename, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = renameHouseholdRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", RENAME_HOUSEHOLD_SHAPE);
    const body: HouseholdSummary = directory.renameHousehold({
      household: id,
      name: draft.data.name,
      by: admin,
      at: context.now(),
    });
    return body;
  });

  app.post(ROUTES.adminMembers, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = addMemberRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", ADD_MEMBER_SHAPE);
    const body: HouseholdMember = addAs(directory, id, draft.data, {
      by: admin,
      at: context.now(),
      newId: context.newId,
    });
    return body;
  });

  app.post(ROUTES.adminMemberRemove, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = removeMemberRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", "Send the address to remove.");
    namedHousehold(directory, id);
    const removed = directory.removeMember({
      address: draft.data.address,
      household: id,
      by: admin,
      at: context.now(),
    });
    const body: HouseholdMember = memberOfHousehold(directory, removed);
    return body;
  });

  // lg-34: the admin's only. One transaction, so a refused new address leaves the
  // old one standing; the person id is unchanged, so no books are touched.
  app.post(ROUTES.adminMemberAddress, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = changeAddressRequestSchema.safeParse(request.body);
    if (!draft.success) {
      throw new AppError("BAD_REQUEST", "Send the address to replace and the one to use instead.");
    }
    namedHousehold(directory, id);
    const changed = directory.changeAddress({
      household: id,
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    const body: HouseholdMember = memberOfHousehold(directory, changed);
    return body;
  });

  // lg-33: the admin's only. A person keeps their id, which every record in the
  // books names, so this writes the directory and nothing else.
  app.post(ROUTES.adminPersonRename, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = renamePersonRequestSchema.safeParse(request.body);
    if (!draft.success) {
      throw new AppError("BAD_REQUEST", "Send the person's id and the name to show them under.");
    }
    namedHousehold(directory, id);
    const body: PersonName = directory.renamePerson({
      household: id,
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    return body;
  });

  // lg-35: the admin's only. A request recorded here and applied to the books by
  // the household's next close, so this reads and writes no books either.
  app.post(ROUTES.adminPersonRetire, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = retirePersonRequestSchema.safeParse(request.body);
    if (!draft.success) {
      throw new AppError("BAD_REQUEST", "Send the person's id, and retire or return.");
    }
    namedHousehold(directory, id);
    const { person, standing } = directory.retirePerson({
      household: id,
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    const body: AdminPerson = {
      person,
      name: shownName(directory.names(id), person),
      standing,
    };
    return body;
  });
}
