/**
 * The household directory, from the app (lg-22).
 *
 * Two kinds of route, and neither reads any books:
 *
 * - **A household's own**, under `/api/households/:id`, for its members only
 *   (`memberOf`): who belongs now and every change, and adding a member. There
 *   is no removal here. Removing cuts a person off from their own records, so
 *   it goes through an admin (`docs/00-ANALYSIS.md` §7).
 * - **The admin's**, under `/api/admin/`, for an address in `LEDGER_ADMINS` only
 *   (`adminOf`), who need not be in any household: every household and its
 *   members, a new household made by adding its first person (lg-71), adding
 *   or removing any member, changing a
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

import { randomUUID } from "node:crypto";
import {
  AppError,
  ROUTES,
  addMemberRequestSchema,
  changeAddressRequestSchema,
  createHouseholdRequestSchema,
  removeMemberRequestSchema,
  renamePersonRequestSchema,
  retirePersonRequestSchema,
} from "@ledger/contract";
import type {
  AdminHousehold,
  AdminHouseholdsResponse,
  AdminPerson,
  CreateHouseholdResponse,
  HouseholdMember,
  HouseholdResponse,
  PersonName,
} from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import { shownName } from "../directory.ts";
import type { Directory, Household, Member } from "../directory.ts";
import { adminOf, memberOf } from "../identity.ts";
import { rateLimitsFor } from "../rate-limit.ts";

/** The `:id` the route matched. Fastify always gives a string; anything else names nothing. */
function householdIdOf(request: FastifyRequest): string {
  const id = (request.params as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function membersOf(directory: Directory, household: string): HouseholdMember[] {
  const names = directory.names(household);
  return directory
    .members(household)
    .map(({ address, person }) => ({ address, person, name: shownName(names, person) }));
}

/** One membership as the routes answer it, with how its person is shown (lg-33). */
function memberOfHousehold(directory: Directory, member: Member): HouseholdMember {
  const name = shownName(directory.names(member.household), member.person);
  return { address: member.address, person: member.person, name };
}

/**
 * Everyone the household has named, a member who has left included, with how
 * each is shown and where they stand in the books (lg-35), by id.
 */
function peopleOf(directory: Directory, household: string): AdminPerson[] {
  const names = directory.names(household);
  return [...directory.standings(household)].map(([person, standing]) => ({
    person,
    name: shownName(names, person),
    standing,
  }));
}

/** A household as the admin's list shows it: its members, and everyone it has named. */
function adminHousehold(directory: Directory, household: Household): AdminHousehold {
  return {
    ...household,
    members: membersOf(directory, household.id),
    people: peopleOf(directory, household.id),
  };
}

/** The household an admin named, or `HOUSEHOLD_NOT_FOUND`. */
function namedHousehold(directory: Directory, id: string): Household {
  const household = directory.household(id);
  if (household === undefined) throw new AppError("HOUSEHOLD_NOT_FOUND");
  return household;
}

const ADD_MEMBER_SHAPE = "Send an address and the person's name it stands under.";

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
      const added = directory.addMember({
        household: id,
        ...draft.data,
        by: caller.email.toLowerCase(),
        at: context.now(),
      });
      const body: HouseholdMember = memberOfHousehold(directory, added);
      return body;
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "ADDRESS_ALREADY_A_MEMBER") {
        throw new AppError("MEMBER_NOT_ADDED");
      }
      throw error;
    }
  });

  // The admin's. The hooks ask `adminOf` for the bucket's key, so a non-admin
  // is refused there.
  app.get(ROUTES.adminHouseholds, { onRequest: adminRead }, async (request) => {
    adminOf(request);
    const body: AdminHouseholdsResponse = {
      households: directory.households().map((household) => adminHousehold(directory, household)),
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
      throw new AppError("BAD_REQUEST", "Send the first person's email and their name.");
    }
    const { household } = directory.createHousehold({
      id: randomUUID(),
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    const body: CreateHouseholdResponse = adminHousehold(directory, household);
    return body;
  });

  app.post(ROUTES.adminMembers, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const id = householdIdOf(request);
    const draft = addMemberRequestSchema.safeParse(request.body);
    if (!draft.success) throw new AppError("BAD_REQUEST", ADD_MEMBER_SHAPE);
    const added = directory.addMember({
      household: id,
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    const body: HouseholdMember = memberOfHousehold(directory, added);
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
