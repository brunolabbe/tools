/**
 * Households and their members, managed from the app (lg-22).
 *
 * An admin creates a household and adds and removes anyone, and is told why an
 * address cannot be added; the new household signs in to empty books of its
 * own. A member sees their household's members and its history and adds a
 * member, is told only that an address cannot be added whatever the reason, and
 * can remove nobody. Every change is a record signed by the address that made
 * it. Who may call which route at all is `authority.test.ts`.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  AdminHouseholdsResponse,
  ErrorResponse,
  HouseholdResponse,
  MeResponse,
  PeopleResponse,
  Rule,
} from "@ledger/contract";
import { ADMIN, ALEX, HOUSEHOLD, SAM } from "./helpers/access.ts";
import { AWAY, KIM, NOW, directorySnapshot, send, startHouseholds } from "./helpers/households.ts";
import type { Harness } from "./helpers/households.ts";
import { VERBS } from "./helpers/routes.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.shutdown();
  harness = undefined;
});

async function start(...args: Parameters<typeof startHouseholds>): Promise<Harness> {
  harness = await startHouseholds(...args);
  return harness;
}

const of = (
  route: "household" | "householdMembers" | "adminMembers" | "adminMemberRemove",
  id: string,
) => ROUTES[route].replace(":id", id);

const CASEY = "casey@example.test";

describe("an admin", () => {
  test("creates a household, adds its members, and they sign in to empty books of their own", async () => {
    const { app, directory } = await start();
    const created = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      id: "cabin",
      name: "The cabin",
    });
    expect(created.statusCode, created.body).toBe(200);
    const added = await send(app, ADMIN, "POST", of("adminMembers", "cabin"), {
      address: "Robin@Cabin.TEST",
      person: "robin",
    });
    expect(added.json()).toEqual({ address: "robin@cabin.test", person: "robin", name: "robin" });

    const me = await send(app, "robin@cabin.test", "GET", ROUTES.me);
    expect(me.json<MeResponse>().person).toEqual({
      id: "robin",
      email: "robin@cabin.test",
      household: "cabin",
    });
    expect((await send(app, "robin@cabin.test", "GET", ROUTES.rules)).json()).toEqual({
      rules: [],
    });
    expect(
      (await send(app, "robin@cabin.test", "GET", ROUTES.people)).json<PeopleResponse>(),
    ).toEqual({ people: ["robin"], names: { robin: "robin" } });

    // Books of its own: a rule filed there is not home's, and home's file is untouched.
    const rule = await send(app, "robin@cabin.test", "POST", ROUTES.rules, {
      descriptionPattern: "Hypothèque /Cabane*",
      category: null,
      amountCents: null,
      personId: null,
      bucket: "mortgage",
      spendingCategoryId: null,
    });
    expect(rule.statusCode, rule.body).toBe(200);
    expect(rule.json<Rule>().createdBy).toBe("robin");
    expect(app.books.of("cabin").prepare("SELECT count(*) AS n FROM rules").get()).toEqual({
      n: 1,
    });
    expect(app.books.of(HOUSEHOLD).prepare("SELECT count(*) AS n FROM rules").get()).toEqual({
      n: 0,
    });

    // Each change is a record naming the admin who made it.
    expect(directory.history("cabin")).toEqual([
      {
        address: "robin@cabin.test",
        person: "robin",
        action: "add",
        at: NOW.toISOString(),
        by: ADMIN,
      },
    ]);
  });

  test("lists every household and its members, so the operator sees every address to admit", async () => {
    const { app } = await start();

    const response = await send(app, ADMIN, "GET", ROUTES.adminHouseholds);

    expect(response.json<AdminHouseholdsResponse>()).toEqual({
      households: [
        {
          id: AWAY,
          name: "The other household",
          members: [{ address: KIM, person: "kim", name: "kim" }],
        },
        {
          id: HOUSEHOLD,
          name: "The test household",
          members: [
            { address: ALEX, person: "alex", name: "alex" },
            { address: SAM, person: "sam", name: "sam" },
          ],
        },
      ],
    });
  });

  test("removes a member, who is refused on the next request; their name stays in the books", async () => {
    const { app, directory } = await start();
    expect((await send(app, SAM, "GET", ROUTES.me)).statusCode).toBe(200);

    const removed = await send(app, ADMIN, "POST", of("adminMemberRemove", HOUSEHOLD), {
      address: SAM,
    });

    expect(removed.json()).toEqual({ address: SAM, person: "sam", name: "sam" });
    expect((await send(app, SAM, "GET", ROUTES.me)).statusCode).toBe(403);
    expect((await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>()).toEqual({
      people: ["alex", "sam"],
      names: { alex: "alex", sam: "sam" },
    });
    expect(directory.history(HOUSEHOLD).at(-1)).toEqual({
      address: SAM,
      person: "sam",
      action: "remove",
      at: NOW.toISOString(),
      by: ADMIN,
    });
  });

  test("moves an address between households as a removal, then an add", async () => {
    const { app } = await start();

    const refused = await send(app, ADMIN, "POST", of("adminMembers", AWAY), {
      address: SAM,
      person: "sam",
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<ErrorResponse>().error.code).toBe("ADDRESS_ALREADY_A_MEMBER");

    await send(app, ADMIN, "POST", of("adminMemberRemove", HOUSEHOLD), { address: SAM });
    const moved = await send(app, ADMIN, "POST", of("adminMembers", AWAY), {
      address: SAM,
      person: "sam",
    });

    expect(moved.statusCode, moved.body).toBe(200);
    expect((await send(app, SAM, "GET", ROUTES.me)).json<MeResponse>().person.household).toBe(AWAY);
  });

  // lg-23: lg-22's admin was also told "a third person"; a household now holds
  // any number, so a third is added.
  test("is told why an address in a household already is refused, and adds a third person", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const taken = await send(app, ADMIN, "POST", of("adminMembers", AWAY), {
      address: ALEX,
      person: "kim",
    });

    expect(taken.statusCode).toBe(409);
    expect(taken.json<ErrorResponse>().error).toMatchObject({
      code: "ADDRESS_ALREADY_A_MEMBER",
      message: expect.stringContaining(`"${HOUSEHOLD}"`),
    });
    expect(directorySnapshot(directory)).toBe(before);

    const third = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
      address: CASEY,
      person: "casey",
    });

    expect(third.statusCode, third.body).toBe(200);
    expect(directory.membershipOf(CASEY)).toEqual({ household: HOUSEHOLD, person: "casey" });
  });

  test("is refused a household or a member that is not there, and nothing changes", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const nowhere = await send(app, ADMIN, "POST", of("adminMembers", "nowhere"), {
      address: CASEY,
      person: "casey",
    });
    const removeNowhere = await send(app, ADMIN, "POST", of("adminMemberRemove", "nowhere"), {
      address: SAM,
    });
    // sam is home's: a screen gone stale that names away removes nobody.
    const elsewhere = await send(app, ADMIN, "POST", of("adminMemberRemove", AWAY), {
      address: SAM,
    });
    const again = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      id: HOUSEHOLD,
      name: "Again",
    });

    expect(nowhere.json<ErrorResponse>().error.code).toBe("HOUSEHOLD_NOT_FOUND");
    expect(nowhere.statusCode).toBe(404);
    expect(removeNowhere.json<ErrorResponse>().error.code).toBe("HOUSEHOLD_NOT_FOUND");
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json<ErrorResponse>().error.code).toBe("MEMBER_NOT_FOUND");
    expect(again.statusCode).toBe(400);
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("reads no household's books by being one", async () => {
    const { app } = await start();

    expect((await send(app, ADMIN, "GET", ROUTES.rules)).statusCode).toBe(403);
    expect((await send(app, ADMIN, "GET", of("household", HOUSEHOLD))).statusCode).toBe(403);
  });
});

describe("a member", () => {
  test("sees their household's members and its history, with who made each change", async () => {
    const { app, directory } = await start();
    directory.removeMember({ address: SAM, by: ADMIN, at: NOW });
    directory.addMember({
      household: HOUSEHOLD,
      address: SAM,
      person: "sam",
      by: ADMIN,
      at: NOW,
    });

    const response = await send(app, ALEX, "GET", of("household", HOUSEHOLD));

    const body = response.json<HouseholdResponse>();
    expect(body.household).toEqual({ id: HOUSEHOLD, name: "The test household" });
    expect(body.members).toEqual([
      { address: ALEX, person: "alex", name: "alex" },
      { address: SAM, person: "sam", name: "sam" },
    ]);
    expect(
      body.history.map((record) => [
        record.action,
        record.action === "rename" ? null : record.address,
        record.by,
      ]),
    ).toEqual([
      ["add", ALEX, "operator"],
      ["add", SAM, "operator"],
      ["remove", SAM, ADMIN],
      ["add", SAM, ADMIN],
    ]);
  });

  test("sees no other household's members or history, in their own or by asking for it", async () => {
    const { app } = await start();

    const own = await send(app, KIM, "GET", of("household", AWAY));
    const other = await send(app, KIM, "GET", of("household", HOUSEHOLD));

    expect(own.statusCode).toBe(200);
    expect(own.body).toContain(KIM);
    for (const mark of [ALEX, SAM, "sam", `"${HOUSEHOLD}"`, "The test household"]) {
      expect(own.body, mark).not.toContain(mark);
      expect(other.body, mark).not.toContain(mark);
    }
    expect(other.statusCode).toBe(403);
  });

  test("adds a member to their own household, signed with their address", async () => {
    const { app, directory } = await start();

    const response = await send(app, SAM, "POST", of("householdMembers", HOUSEHOLD), {
      address: "Sam.Phone@Example.test",
      person: "sam",
    });

    expect(response.json()).toEqual({
      address: "sam.phone@example.test",
      person: "sam",
      name: "sam",
    });
    expect(directory.history(HOUSEHOLD).at(-1)).toMatchObject({
      address: "sam.phone@example.test",
      action: "add",
      by: SAM,
    });
    expect((await send(app, "sam.phone@example.test", "GET", ROUTES.me)).statusCode).toBe(200);
  });

  test("is told only that an address cannot be added, the same for every reason", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);
    const add = async (address: string, person: string) =>
      await send(app, SAM, "POST", of("householdMembers", HOUSEHOLD), { address, person });

    // In another household; in this one. A third person with a free address is
    // no longer a reason (lg-23): a household holds any number.
    const answers = [await add(KIM, "sam"), await add(ALEX, "sam")];

    for (const answer of answers) {
      expect(answer.statusCode).toBe(409);
      expect(answer.body).toBe(answers[0]?.body);
      expect(answer.json<ErrorResponse>().error.code).toBe("MEMBER_NOT_ADDED");
      for (const mark of [AWAY, "kim", "two", "belongs"]) expect(answer.body).not.toContain(mark);
    }
    expect(directorySnapshot(directory)).toBe(before);

    const third = await add(CASEY, "casey");
    expect(third.statusCode, third.body).toBe(200);
  });

  test("can remove nobody, through any route", async () => {
    const { app, directory } = await start();
    const attempts = [
      ...Object.values(VERBS),
      ["POST", ROUTES.adminHouseholds] as const,
      ["POST", `${of("householdMembers", HOUSEHOLD)}/remove`] as const,
      ["POST", `${of("household", HOUSEHOLD)}/remove`] as const,
    ];

    // Each shape a removal could take, since a route refuses keys it does not read.
    const bodies = [
      { address: ALEX },
      { address: ALEX, person: "alex" },
      { address: ALEX, id: HOUSEHOLD },
    ];
    for (const [method, url] of attempts) {
      for (const body of bodies) await send(app, SAM, method, url, body);
    }

    expect(directory.history(HOUSEHOLD).filter((record) => record.action === "remove")).toEqual([]);
    expect(directory.membershipOf(ALEX)).toEqual({ household: HOUSEHOLD, person: "alex" });
    expect(directory.membershipOf(KIM)).toEqual({ household: AWAY, person: "kim" });
    expect(attempts.length).toBeGreaterThan(40);
  });
});
