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
 *   members, a new household, and adding or removing any member.
 *
 * Every guard runs before the body is read, so a refusal is the same 403 for
 * any request. Every change is a record the directory appends, signed with the
 * address that made it. A new household's books are made the way lg-21 makes
 * any household's: the first time a request or a probe needs them.
 *
 * **A member is told only that an address cannot be added**, whether it is in a
 * household already or would be a third person (`MEMBER_NOT_ADDED`): the reason
 * would let any member ask whether an address uses the ledger. An admin is told
 * which.
 */

import {
  AppError,
  ROUTES,
  addMemberRequestSchema,
  createHouseholdRequestSchema,
  removeMemberRequestSchema,
} from "@ledger/contract";
import type {
  AdminHouseholdsResponse,
  HouseholdMember,
  HouseholdResponse,
  HouseholdSummary,
} from "@ledger/contract";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppContext } from "../context.ts";
import type { Directory, Household } from "../directory.ts";
import { adminOf, memberOf } from "../identity.ts";
import { rateLimitsFor } from "../rate-limit.ts";

/** The `:id` the route matched. Fastify always gives a string; anything else names nothing. */
function householdIdOf(request: FastifyRequest): string {
  const id = (request.params as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function membersOf(directory: Directory, household: string): HouseholdMember[] {
  return directory.members(household).map(({ address, person }) => ({ address, person }));
}

/** The household an admin named, or `HOUSEHOLD_NOT_FOUND`. */
function namedHousehold(directory: Directory, id: string): Household {
  const household = directory.household(id);
  if (household === undefined) throw new AppError("HOUSEHOLD_NOT_FOUND");
  return household;
}

const ADD_MEMBER_SHAPE = "Send an address and the person's name it stands under.";

export function registerHouseholdRoutes(app: FastifyInstance, context: AppContext): void {
  const { read, write, adminRead, adminWrite } = rateLimitsFor(context);
  const { directory } = context;

  app.get(ROUTES.household, { onRequest: read }, async (request) => {
    const id = householdIdOf(request);
    memberOf(request, id);
    const body: HouseholdResponse = {
      household: namedHousehold(directory, id),
      members: membersOf(directory, id),
      history: directory.history(id),
    };
    return body;
  });

  app.post(ROUTES.householdMembers, { onRequest: write }, async (request) => {
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
      const body: HouseholdMember = { address: added.address, person: added.person };
      return body;
    } catch (error: unknown) {
      if (
        error instanceof AppError &&
        (error.code === "ADDRESS_ALREADY_A_MEMBER" || error.code === "HOUSEHOLD_FULL")
      ) {
        throw new AppError("MEMBER_NOT_ADDED");
      }
      throw error;
    }
  });

  // The admin's. The hooks ask `adminOf` for the bucket's key, so a non-admin
  // is refused there; each handler asks again, so a hook taken off fails closed.
  app.get(ROUTES.adminHouseholds, { onRequest: adminRead }, async (request) => {
    adminOf(request);
    const body: AdminHouseholdsResponse = {
      households: directory.households().map((household) => ({
        ...household,
        members: membersOf(directory, household.id),
      })),
    };
    return body;
  });

  app.post(ROUTES.adminHouseholds, { onRequest: adminWrite }, async (request) => {
    const admin = adminOf(request);
    const draft = createHouseholdRequestSchema.safeParse(request.body);
    if (!draft.success) {
      throw new AppError("BAD_REQUEST", "Send the new household's id and its name.");
    }
    const body: HouseholdSummary = directory.addHousehold({
      ...draft.data,
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
    const added = directory.addMember({
      household: id,
      ...draft.data,
      by: admin,
      at: context.now(),
    });
    const body: HouseholdMember = { address: added.address, person: added.person };
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
    const body: HouseholdMember = { address: removed.address, person: removed.person };
    return body;
  });
}
