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

import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  AdminHouseholdsResponse,
  AdminPerson,
  CreateHouseholdResponse,
  ErrorResponse,
  HouseholdMember,
  HouseholdResponse,
  HouseholdSummary,
  MeResponse,
  PeopleResponse,
  PersonName,
  Rule,
  SalaryEntryResponse,
} from "@ledger/contract";
import { migrateDirectory } from "../src/db/directory-schema.ts";
import { Directory } from "../src/directory.ts";
import { enrollPeople } from "../src/people.ts";
import { ADMIN, ALEX, HOUSEHOLD, SAM, STRANGER } from "./helpers/access.ts";
import {
  AWAY,
  KIM,
  NOW,
  directorySnapshot,
  generatedId,
  send,
  sequentialIds,
  startHouseholds,
  twoHouseholds,
} from "./helpers/households.ts";
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
/** A lowercase UUID as `crypto.randomUUID()` prints it (lg-71). */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("an admin", () => {
  // lg-71: made by adding its first person, under a generated UUID and "Home".
  test("creates a household, adds its members, and they sign in to empty books of their own", async () => {
    // lg-76: each new person is given a generated id, and the name typed is
    // only how they are shown. The household takes the first id, robin the
    // second and lee the third.
    const { app, directory } = await start(twoHouseholds(), [ADMIN], sequentialIds());
    const [cabin, robin, lee] = [generatedId(1), generatedId(2), generatedId(3)];
    const created = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: "Robin@Cabin.TEST",
      person: "robin",
    });
    expect(created.statusCode, created.body).toBe(200);
    const household = created.json<CreateHouseholdResponse>();
    expect(household.id).toMatch(UUID_SHAPE);
    expect(household).toEqual({
      id: cabin,
      name: "Home",
      members: [{ address: "robin@cabin.test", person: robin, name: "robin", firstSignIn: null }],
      people: [{ person: robin, name: "robin", standing: "in" }],
    });
    const added = await send(app, ADMIN, "POST", of("adminMembers", cabin), {
      address: "Lee@Cabin.TEST",
      person: "lee",
    });
    expect(added.json()).toEqual({ address: "lee@cabin.test", person: lee, name: "lee" });

    const me = await send(app, "robin@cabin.test", "GET", ROUTES.me);
    expect(me.json<MeResponse>().person).toEqual({
      id: robin,
      email: "robin@cabin.test",
      household: cabin,
    });
    expect((await send(app, "robin@cabin.test", "GET", ROUTES.rules)).json()).toEqual({
      rules: [],
    });
    expect(
      (await send(app, "robin@cabin.test", "GET", ROUTES.people)).json<PeopleResponse>(),
    ).toEqual({ people: [lee, robin], retired: [], names: { [lee]: "lee", [robin]: "robin" } });

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
    expect(rule.json<Rule>().createdBy).toBe(robin);
    expect(app.books.of(cabin).prepare("SELECT count(*) AS n FROM rules").get()).toEqual({
      n: 1,
    });
    expect(app.books.of(HOUSEHOLD).prepare("SELECT count(*) AS n FROM rules").get()).toEqual({
      n: 0,
    });

    // Each change is a record naming the admin who made it.
    expect(directory.history(cabin)).toEqual([
      {
        address: "robin@cabin.test",
        person: robin,
        action: "add",
        at: NOW.toISOString(),
        by: ADMIN,
      },
      {
        address: "lee@cabin.test",
        person: lee,
        action: "add",
        at: NOW.toISOString(),
        by: ADMIN,
      },
      { action: "name", person: robin, name: "robin", at: NOW.toISOString(), by: ADMIN },
      { action: "name", person: lee, name: "lee", at: NOW.toISOString(), by: ADMIN },
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
          members: [{ address: KIM, person: "kim", name: "kim", firstSignIn: null }],
          people: [{ person: "kim", name: "kim", standing: "in" }],
        },
        {
          id: HOUSEHOLD,
          name: "The test household",
          members: [
            { address: ALEX, person: "alex", name: "alex", firstSignIn: null },
            { address: SAM, person: "sam", name: "sam", firstSignIn: null },
          ],
          people: [
            { person: "alex", name: "alex", standing: "in" },
            { person: "sam", name: "sam", standing: "in" },
          ],
        },
      ],
    });
  });

  // lg-75: an address that has made a request reports when it first did; one
  // that has not reports null, which the screen marks.
  test("lists an address that has signed in with when it first did, and one that has not as never", async () => {
    const { app } = await start();
    await send(app, ALEX, "GET", ROUTES.me);

    const listing = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();

    const members = listing.households.flatMap((household) => household.members);
    expect(members.map((member) => [member.address, member.firstSignIn])).toEqual([
      [KIM, null],
      [ALEX, NOW.toISOString()],
      [SAM, null],
    ]);
  });

  test("starts an address changed in place unmarked, the old one's sign-in left where it was", async () => {
    const { app, directory } = await start();
    await send(app, ALEX, "GET", ROUTES.me);
    const moved = await send(
      app,
      ADMIN,
      "POST",
      ROUTES.adminMemberAddress.replace(":id", HOUSEHOLD),
      { from: ALEX, to: "alexandre@example.test" },
    );
    expect(moved.statusCode, moved.body).toBe(200);

    const listing = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();

    const home = listing.households.find((household) => household.id === HOUSEHOLD);
    expect(home?.members.map((member) => [member.address, member.firstSignIn])).toEqual([
      ["alexandre@example.test", null],
      [SAM, null],
    ]);
    expect([...directory.firstSignIns().keys()]).toEqual([ALEX]);
  });

  test("answers a created household with its first member never signed in", async () => {
    const { app } = await start();

    const created = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: CASEY,
      person: "Casey",
    });

    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<CreateHouseholdResponse>().members).toEqual([
      { address: CASEY, person: expect.any(String) as string, name: "Casey", firstSignIn: null },
    ]);
  });

  test("keeps the sign-in off the household's own route, to its members and to an admin alike", async () => {
    const { app } = await start();
    await send(app, ALEX, "GET", ROUTES.me);

    const own = (
      await send(app, ALEX, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    const added = (
      await send(app, ALEX, "POST", of("householdMembers", HOUSEHOLD), {
        address: CASEY,
        person: "Casey",
      })
    ).json<HouseholdMember>();

    expect(own.members.map((member) => Object.keys(member))).toEqual([
      ["address", "person", "name"],
      ["address", "person", "name"],
    ]);
    expect(JSON.stringify(own)).not.toContain("firstSignIn");
    expect(Object.keys(added)).toEqual(["address", "person", "name"]);
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
      retired: [],
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
      // lg-77: by its name, never its id.
      message: expect.stringContaining(`"The test household"`),
    });
    expect(directorySnapshot(directory)).toBe(before);

    const third = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
      address: CASEY,
      person: "casey",
    });

    expect(third.statusCode, third.body).toBe(200);
    // lg-76: a new name is a new person under a generated id, shown under it.
    const casey = directory.membershipOf(CASEY);
    expect(casey?.household).toBe(HOUSEHOLD);
    expect(casey?.person).toMatch(UUID_SHAPE);
    expect(directory.names(HOUSEHOLD).get(casey?.person ?? "")).toBe("casey");
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
        "address" in record ? record.address : null,
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

// lg-52: the control characters `\s` does not cover, through the two routes that
// add an address. JSON carries a NUL; the web input is `type="email"` and the
// request is not bound to it.
describe("an address with a control character", () => {
  const BAD = ["casey@b\u0000c.test", "casey\u0001@example.test", "casey\u007f@example.test"];

  test("is refused 400 by the admin's add route and by a member's, and no row is written", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    for (const address of BAD) {
      const asAdmin = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
        address,
        person: "casey",
      });
      const asMember = await send(app, ALEX, "POST", of("householdMembers", HOUSEHOLD), {
        address,
        person: "casey",
      });

      for (const refused of [asAdmin, asMember]) {
        expect(refused.statusCode, refused.body).toBe(400);
        expect(refused.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
      }
    }

    expect(directorySnapshot(directory)).toBe(before);
    // The same route takes the clean address, so the refusal is the character's.
    const admin = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
      address: CASEY,
      person: "casey",
    });
    expect(admin.statusCode, admin.body).toBe(200);
  });

  test("on a row that already stands is still removed by the admin's remove route", async () => {
    // Past `Directory`, as a directory made before lg-52 holds it.
    const db = new Database(":memory:");
    migrateDirectory(db);
    const stored = new Directory(db);
    stored.addHousehold({ id: HOUSEHOLD, name: "Home", by: "operator", at: NOW });
    db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, ?, 'mallory', 'add', 'x', 'operator')`,
    ).run("mallory@evil\u0000.test", HOUSEHOLD);
    const running = await start(stored);

    const removed = await send(running.app, ADMIN, "POST", of("adminMemberRemove", HOUSEHOLD), {
      address: "mallory@evil\u0000.test",
    });

    expect(removed.statusCode, removed.body).toBe(200);
    expect(stored.membershipOf("mallory@evil\u0000.test")).toBeUndefined();
  });
});

// lg-57: the C1 controls and the zero-width characters, through the same two routes.
describe("an address with a C1 control or a zero-width character", () => {
  const BAD = ["casey@b\u0085c.test", "casey\u009f@example.test", "casey\u200b@example.test"];

  test("is refused 400 by the admin's add route and by a member's, and no row is written", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    for (const address of BAD) {
      const asAdmin = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
        address,
        person: "casey",
      });
      const asMember = await send(app, ALEX, "POST", of("householdMembers", HOUSEHOLD), {
        address,
        person: "casey",
      });

      for (const refused of [asAdmin, asMember]) {
        expect(refused.statusCode, refused.body).toBe(400);
        expect(refused.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
      }
    }

    expect(directorySnapshot(directory)).toBe(before);
    const admin = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
      address: CASEY,
      person: "casey",
    });
    expect(admin.statusCode, admin.body).toBe(200);
  });

  test("on a row that already stands is still removed by the admin's remove route", async () => {
    // Past `Directory`, as a directory made before lg-57 holds it.
    const db = new Database(":memory:");
    migrateDirectory(db);
    const stored = new Directory(db);
    stored.addHousehold({ id: HOUSEHOLD, name: "Home", by: "operator", at: NOW });
    db.prepare(
      `INSERT INTO memberships (address, household_id, person, action, changed_at, changed_by)
       VALUES (?, ?, 'mallory', 'add', 'x', 'operator')`,
    ).run("mallory@evil\u200b.test", HOUSEHOLD);
    const running = await start(stored);

    const removed = await send(running.app, ADMIN, "POST", of("adminMemberRemove", HOUSEHOLD), {
      address: "mallory@evil\u200b.test",
    });

    expect(removed.statusCode, removed.body).toBe(200);
    expect(stored.membershipOf("mallory@evil\u200b.test")).toBeUndefined();
  });
});

// lg-71: the admin's create takes the first person, and nothing else.
describe("a household made by adding its first person", () => {
  test("is refused, and nothing is made, when the first address cannot be added", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const taken = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: KIM,
      person: "kim",
    });
    const notOne = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: "not an email",
      person: "casey",
    });
    const unseen = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: "casey@b\u200bc.test",
      person: "casey",
    });

    expect(taken.statusCode).toBe(409);
    expect(taken.json<ErrorResponse>().error.code).toBe("ADDRESS_ALREADY_A_MEMBER");
    expect(taken.json<ErrorResponse>().error.message).toBe(
      `That email already belongs to the household "The other household", as kim. Remove it first.`,
    );
    expect(notOne.statusCode).toBe(400);
    expect(unseen.statusCode).toBe(400);
    expect(directory.households()).toHaveLength(2);
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("is refused when the request still names an id or a name, or lacks the email", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    for (const body of [
      { address: CASEY, person: "casey", id: "cabin" },
      { address: CASEY, person: "casey", name: "The cabin" },
      { id: "cabin", name: "The cabin" },
      // lg-76: the person may be left out; the email may not.
      { person: "casey" },
    ]) {
      const response = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    }

    expect(directorySnapshot(directory)).toBe(before);
  });

  test("gets a new UUID each time, and two of them are both Home", async () => {
    const { app, directory } = await start();

    const first = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: CASEY,
      person: "casey",
    });
    const second = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: "robin@cabin.test",
      person: "robin",
    });

    const ids = [first, second].map((response) => response.json<CreateHouseholdResponse>().id);
    for (const id of ids) {
      expect(id).toMatch(UUID_SHAPE);
      expect(directory.household(id)).toEqual({ id, name: "Home" });
    }
    expect(new Set(ids).size).toBe(2);
    // The word ids made before stand beside them.
    expect(directory.households().map((household) => household.id)).toEqual(
      expect.arrayContaining([AWAY, HOUSEHOLD, ...ids]),
    );
  });
});

// lg-76: the name typed in a request is matched against how the household
// shows its people; a name nobody has is a new person under a generated id.
describe("a person added by name (lg-76)", () => {
  async function startWithIds(): Promise<Harness> {
    return await start(twoHouseholds(), [ADMIN], sequentialIds());
  }

  async function add(
    app: Harness["app"],
    as: string,
    body: Record<string, unknown>,
    household = HOUSEHOLD,
  ): Promise<HouseholdMember> {
    const route = as === ADMIN ? of("adminMembers", household) : of("householdMembers", household);
    const response = await send(app, as, "POST", route, body);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<HouseholdMember>();
  }

  test("a member adds a new name: a person under a generated id, shown under the name, in one step", async () => {
    const { app, directory } = await startWithIds();

    const added = await add(app, ALEX, { address: CASEY, person: "Casey" });

    expect(added).toEqual({ address: CASEY, person: generatedId(1), name: "Casey" });
    expect(directory.membershipOf(CASEY)).toEqual({ household: HOUSEHOLD, person: generatedId(1) });
    expect(directory.names(HOUSEHOLD)).toEqual(new Map([[generatedId(1), "Casey"]]));
    const household = (
      await send(app, ALEX, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(household.history.at(-1)).toEqual({
      action: "name",
      person: generatedId(1),
      name: "Casey",
      at: NOW.toISOString(),
      by: ALEX,
    });
  });

  test("an address for an existing person, by their shown name, reuses their id, legacy or generated", async () => {
    const { app, directory } = await startWithIds();
    // alex is a person from before lg-76, renamed since; casey is one since.
    await send(app, ADMIN, "POST", ROUTES.adminPersonRename.replace(":id", HOUSEHOLD), {
      person: "alex",
      name: "Alexandre",
    });
    const casey = await add(app, ADMIN, { address: CASEY, person: "casey" });

    const alexByName = await add(app, SAM, { address: "alex@work.test", person: "Alexandre" });
    const alexById = await add(app, ADMIN, { address: "alex@phone.test", person: "alex" });
    const samByName = await add(app, ALEX, { address: "sam@work.test", person: "sam" });
    const caseyByName = await add(app, ALEX, { address: "casey@work.test", person: "casey" });

    expect(casey.person).toBe(generatedId(1));
    expect(alexByName).toEqual({ address: "alex@work.test", person: "alex", name: "Alexandre" });
    expect(alexById).toEqual({ address: "alex@phone.test", person: "alex", name: "Alexandre" });
    expect(samByName).toEqual({ address: "sam@work.test", person: "sam", name: "sam" });
    expect(caseyByName).toEqual({
      address: "casey@work.test",
      person: generatedId(1),
      name: "casey",
    });
    expect(directory.heldPeople(HOUSEHOLD)).toEqual([generatedId(1), "alex", "sam"]);
  });

  test("with no name, the person is shown under the email's part before the @, numbered when taken", async () => {
    const { app, directory } = await startWithIds();

    // Two addresses with one local part, in one household, and one taken by an id.
    const first = await add(app, ALEX, { address: "robin@one.test" });
    const second = await add(app, ADMIN, { address: "robin@two.test" });
    const third = await add(app, ALEX, { address: "sam@other.test" });

    expect(first).toEqual({ address: "robin@one.test", person: generatedId(1), name: "robin" });
    expect(second).toEqual({ address: "robin@two.test", person: generatedId(2), name: "robin 2" });
    expect(third).toEqual({ address: "sam@other.test", person: generatedId(3), name: "sam 2" });
    expect(directory.people(HOUSEHOLD)).toHaveLength(5);
  });

  test("a household made with no name shows its first person under the email's part before the @", async () => {
    const { app } = await startWithIds();

    const created = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, {
      address: "Robin@Cabin.TEST",
    });

    expect(created.statusCode, created.body).toBe(200);
    expect(created.json<CreateHouseholdResponse>()).toEqual({
      id: generatedId(1),
      name: "Home",
      members: [
        { address: "robin@cabin.test", person: generatedId(2), name: "robin", firstSignIn: null },
      ],
      people: [{ person: generatedId(2), name: "robin", standing: "in" }],
    });
  });

  test("an empty name is refused, as it was", async () => {
    const { app, directory } = await startWithIds();
    const before = directorySnapshot(directory);

    for (const person of ["", "   ", "x".repeat(65)]) {
      const response = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
        address: CASEY,
        person,
      });
      expect(response.statusCode, JSON.stringify(person)).toBe(400);
    }
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("people are listed by how they are shown, not by id", async () => {
    const { app } = await startWithIds();
    await send(app, ADMIN, "POST", ROUTES.adminPersonRename.replace(":id", HOUSEHOLD), {
      person: "alex",
      name: "Zoé",
    });
    await add(app, ALEX, { address: CASEY, person: "casey" });

    const people = (await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>();
    const admin = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();
    const home = admin.households.find((household) => household.id === HOUSEHOLD);

    expect(people.people.map((person) => people.names[person])).toEqual(["casey", "sam", "Zoé"]);
    expect(home?.members.map((member) => member.name)).toEqual(["casey", "sam", "Zoé"]);
    expect(home?.people.map((person) => person.name)).toEqual(["casey", "sam", "Zoé"]);
  });

  test("a person with a generated id who shares a name with an id only the books hold is numbered, never shown by id", async () => {
    const { app } = await startWithIds();
    // jordan is a person an old rule named, whom no membership has: the
    // directory cannot see them, so it lets a new person be named jordan too.
    enrollPeople(app.books.of(HOUSEHOLD), ["jordan"], NOW);
    await add(app, ALEX, { address: "jordan@example.test", person: "jordan" });

    const people = (await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>();

    expect(people.names).toEqual({
      alex: "alex",
      jordan: "jordan",
      sam: "sam",
      [generatedId(1)]: "jordan 2",
    });
  });
});

describe("a person without an email (lg-74)", () => {
  const RENAME = ROUTES.adminPersonRename.replace(":id", HOUSEHOLD);
  const RETIRE = ROUTES.adminPersonRetire.replace(":id", HOUSEHOLD);
  const ROBIN = "robin@example.test";

  async function startWithIds(): Promise<Harness> {
    return await start(twoHouseholds(), [ADMIN], sequentialIds());
  }

  async function addAs(
    app: Harness["app"],
    as: string,
    body: Record<string, unknown>,
  ): Promise<HouseholdMember> {
    const route = as === ADMIN ? of("adminMembers", HOUSEHOLD) : of("householdMembers", HOUSEHOLD);
    const response = await send(app, as, "POST", route, body);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<HouseholdMember>();
  }

  // Done when 1, a member's half.
  test("a member adds one by name alone, and the books enrol them on the next request", async () => {
    const { app, directory } = await startWithIds();

    const added = await addAs(app, ALEX, { person: "Robin" });

    expect(added).toEqual({ address: null, person: generatedId(1), name: "Robin" });
    expect(directory.membershipOf(ROBIN)).toBeUndefined();
    expect(directory.people(HOUSEHOLD)).toEqual([generatedId(1), "alex", "sam"]);
    const household = (
      await send(app, ALEX, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(household.members).toEqual([
      { address: ALEX, person: "alex", name: "alex" },
      { address: null, person: generatedId(1), name: "Robin" },
      { address: SAM, person: "sam", name: "sam" },
    ]);
    // The add, then the name it was made under, at the same instant.
    expect(household.history.slice(-2)).toEqual([
      { action: "add-person", person: generatedId(1), at: NOW.toISOString(), by: ALEX },
      { action: "name", person: generatedId(1), name: "Robin", at: NOW.toISOString(), by: ALEX },
    ]);
    // The books' own table, read by the next request.
    const people = (await send(app, SAM, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(people.people).toContain(generatedId(1));
    expect(people.names[generatedId(1)]).toBe("Robin");
  });

  // Done when 1, the admin's half; Build step 4's "to admit" list reads `members`' addresses.
  test("an admin adds one the same way, listed with no address and nothing for Access to admit", async () => {
    const { app } = await startWithIds();

    const added = await addAs(app, ADMIN, { person: "Robin" });

    expect(added).toEqual({ address: null, person: generatedId(1), name: "Robin" });
    const listing = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();
    const home = listing.households.find((household) => household.id === HOUSEHOLD);
    expect(home?.members).toContainEqual({
      address: null,
      person: generatedId(1),
      name: "Robin",
      firstSignIn: null,
    });
    expect(home?.people).toContainEqual({ person: generatedId(1), name: "Robin", standing: "in" });
    const people = (await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(people.people).toContain(generatedId(1));
  });

  test("a name someone in the household holds already is refused, and so is a request with neither field", async () => {
    const { app, directory } = await startWithIds();
    await send(app, ADMIN, "POST", RENAME, { person: "alex", name: "Alexandre" });
    await addAs(app, ALEX, { person: "Robin" });
    const before = directorySnapshot(directory);

    // An id, a shown name, and a person who has no email either.
    for (const person of ["sam", "Alexandre", "Robin"]) {
      for (const as of [ALEX, ADMIN]) {
        const route =
          as === ADMIN ? of("adminMembers", HOUSEHOLD) : of("householdMembers", HOUSEHOLD);
        const response = await send(app, as, "POST", route, { person });
        expect(response.statusCode, `${person} as ${as}`).toBe(409);
        expect(response.json<ErrorResponse>().error.code).toBe("PERSON_NAME_TAKEN");
      }
    }
    for (const body of [{}, { person: "" }, { address: "" }]) {
      const response = await send(app, ALEX, "POST", of("householdMembers", HOUSEHOLD), body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
    }

    expect(directorySnapshot(directory)).toBe(before);
  });

  // Done when 2.
  test("is given an email later, and signs in as the same person id", async () => {
    const { app } = await startWithIds();
    const robin = await addAs(app, ALEX, { person: "Robin" });

    const given = await addAs(app, SAM, { address: ROBIN, person: "Robin" });

    expect(given).toEqual({ address: ROBIN, person: robin.person, name: "Robin" });
    const me = await send(app, ROBIN, "GET", ROUTES.me);
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json<MeResponse>().person).toEqual({
      id: robin.person,
      email: ROBIN,
      household: HOUSEHOLD,
    });
    // Listed under the email now, once.
    const household = (
      await send(app, ROBIN, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(household.members.filter((member) => member.person === robin.person)).toEqual([
      { address: ROBIN, person: robin.person, name: "Robin" },
    ]);
  });

  // Done when 3.
  test("lg-71's create request still refuses a household made with no email", async () => {
    const { app, directory } = await startWithIds();
    const before = directorySnapshot(directory);

    const response = await send(app, ADMIN, "POST", ROUTES.adminHouseholds, { person: "Robin" });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<ErrorResponse>().error.code).toBe("BAD_REQUEST");
    expect(directorySnapshot(directory)).toBe(before);
  });

  // Done when 4, renaming.
  test("is renamed by an admin, keeping their id", async () => {
    const { app, directory } = await startWithIds();
    const robin = await addAs(app, ALEX, { person: "Robin" });

    const renamed = await send(app, ADMIN, "POST", RENAME, { person: robin.person, name: "Robyn" });

    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json<PersonName>()).toEqual({ person: robin.person, name: "Robyn" });
    expect(directory.names(HOUSEHOLD).get(robin.person)).toBe("Robyn");
    const people = (await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(people.names[robin.person]).toBe("Robyn");
  });

  // Done when 4, retiring; Build step 5.
  test("is retired with no email to remove first, leaves the members, and the close applies it", async () => {
    const { app, directory } = await startWithIds();
    const robin = await addAs(app, ALEX, { person: "Robin" });
    // The open period is weighed with robin in it: their salary sets the ratio.
    const entered = await send(app, ALEX, "POST", ROUTES.salaries, {
      year: 2026,
      salaries: ["alex", "sam", robin.person].map((personId) => ({
        personId,
        amountCents: 4_000_000,
      })),
    });
    expect(entered.statusCode, entered.body).toBe(200);
    const ratio = await send(app, ALEX, "POST", ROUTES.ratios, {
      effectiveFrom: "2026-01-01",
      salaryIds: entered.json<SalaryEntryResponse>().salaries.map((salary) => salary.id),
    });
    expect(ratio.statusCode, ratio.body).toBe(200);

    const retired = await send(app, ADMIN, "POST", RETIRE, {
      person: robin.person,
      action: "retire",
    });

    expect(retired.statusCode, retired.body).toBe(200);
    expect(retired.json<AdminPerson>()).toEqual({
      person: robin.person,
      name: "Robin",
      standing: "retiring",
    });
    expect(directory.people(HOUSEHOLD)).toEqual(["alex", "sam"]);
    const household = (
      await send(app, ALEX, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(household.members.map((member) => member.person)).toEqual(["alex", "sam"]);

    const closed = await send(app, ALEX, "POST", ROUTES.periodClose, {
      start: null,
      end: "2026-09-30",
    });

    expect(closed.statusCode, closed.body).toBe(200);
    const people = (await send(app, ALEX, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(people.retired).toEqual([robin.person]);
    expect(people.people).not.toContain(robin.person);
  });
});

describe("a household renamed (lg-77)", () => {
  const RENAME_OWN = ROUTES.householdRename.replace(":id", HOUSEHOLD);
  const renameAsAdmin = (id: string) => ROUTES.adminHouseholdRename.replace(":id", id);

  test("by a member of it, signed with their address, and every listing shows the new name", async () => {
    const { app } = await start();

    const renamed = await send(app, SAM, "POST", RENAME_OWN, { name: "  Our place  " });

    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json<HouseholdSummary>()).toEqual({ id: HOUSEHOLD, name: "Our place" });
    const household = (
      await send(app, ALEX, "GET", of("household", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(household.household).toEqual({ id: HOUSEHOLD, name: "Our place" });
    expect(household.history.at(-1)).toEqual({
      action: "rename-household",
      name: "Our place",
      at: NOW.toISOString(),
      by: SAM,
    });
    const listed = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();
    expect(listed.households.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: AWAY, name: "The other household" },
      { id: HOUSEHOLD, name: "Our place" },
    ]);
  });

  test("by an admin, any household, signed with the admin's address", async () => {
    const { app, directory } = await start();

    const renamed = await send(app, ADMIN, "POST", renameAsAdmin(AWAY), { name: "Le chalet" });

    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json<HouseholdSummary>()).toEqual({ id: AWAY, name: "Le chalet" });
    expect(directory.household(AWAY)).toEqual({ id: AWAY, name: "Le chalet" });
    const own = (await send(app, KIM, "GET", of("household", AWAY))).json<HouseholdResponse>();
    expect(own.household.name).toBe("Le chalet");
    expect(own.history.at(-1)).toEqual({
      action: "rename-household",
      name: "Le chalet",
      at: NOW.toISOString(),
      by: ADMIN,
    });
  });

  test("is a household_names row, and the households row is as it was made", async () => {
    const file = new Database(":memory:");
    migrateDirectory(file);
    const directory = new Directory(file);
    const change = { by: "operator", at: new Date("2026-10-01T00:00:00Z") };
    directory.addHousehold({ id: HOUSEHOLD, name: "Home", ...change });
    directory.addMember({ household: HOUSEHOLD, address: ALEX, person: "alex", ...change });
    const { app } = await start(directory);
    const before = file.prepare("SELECT * FROM households").all();

    const own = await send(app, ALEX, "POST", RENAME_OWN, { name: "Our place" });
    const admin = await send(app, ADMIN, "POST", renameAsAdmin(HOUSEHOLD), { name: "Chez nous" });

    expect([own.statusCode, admin.statusCode]).toEqual([200, 200]);
    expect(file.prepare("SELECT * FROM households").all()).toEqual(before);
    expect(before).toEqual([
      { id: HOUSEHOLD, name: "Home", created_at: change.at.toISOString(), created_by: "operator" },
    ]);
    expect(
      file.prepare("SELECT household_id, name, named_by FROM household_names ORDER BY id").all(),
    ).toEqual([
      { household_id: HOUSEHOLD, name: "Our place", named_by: ALEX },
      { household_id: HOUSEHOLD, name: "Chez nous", named_by: ADMIN },
    ]);
    expect(directory.household(HOUSEHOLD)).toEqual({ id: HOUSEHOLD, name: "Chez nous" });
  });

  test("is refused to a member of another household and to a caller who is neither, with the same 403", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const otherMember = await send(app, KIM, "POST", RENAME_OWN, { name: "Mine now" });
    const adminOnOwnRoute = await send(app, ADMIN, "POST", RENAME_OWN, { name: "Mine now" });
    const memberOnAdminRoute = await send(app, ALEX, "POST", renameAsAdmin(HOUSEHOLD), {
      name: "Mine now",
    });
    const stranger = await send(app, STRANGER, "POST", RENAME_OWN, { name: "Mine now" });

    for (const refused of [otherMember, adminOnOwnRoute, memberOnAdminRoute, stranger]) {
      expect(refused.statusCode, refused.body).toBe(403);
      expect(refused.json<ErrorResponse>().error.code).toBe("FORBIDDEN");
    }
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("refuses a name that is empty, blank, over 80 characters or beside another field, and a household that is not there", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    const refusals = [
      await send(app, ALEX, "POST", RENAME_OWN, { name: "" }),
      await send(app, ALEX, "POST", RENAME_OWN, { name: "   " }),
      await send(app, ALEX, "POST", RENAME_OWN, { name: "H".repeat(81) }),
      await send(app, ALEX, "POST", RENAME_OWN, { name: "Ours", id: "elsewhere" }),
      await send(app, ADMIN, "POST", renameAsAdmin(HOUSEHOLD), {}),
    ];
    const nowhere = await send(app, ADMIN, "POST", renameAsAdmin("nowhere"), { name: "Ours" });

    expect(refusals.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
    expect(nowhere.statusCode).toBe(404);
    expect(nowhere.json<ErrorResponse>().error.code).toBe("HOUSEHOLD_NOT_FOUND");
    expect(directorySnapshot(directory)).toBe(before);

    const longest = await send(app, ALEX, "POST", RENAME_OWN, { name: "H".repeat(80) });

    expect(longest.statusCode, longest.body).toBe(200);
    expect(directory.household(HOUSEHOLD)?.name).toBe("H".repeat(80));
  });

  test("names the household by its new name when an admin is told an address is taken", async () => {
    const { app } = await start();
    await send(app, KIM, "POST", ROUTES.householdRename.replace(":id", AWAY), {
      name: "Le chalet",
    });

    const taken = await send(app, ADMIN, "POST", of("adminMembers", HOUSEHOLD), {
      address: KIM,
      person: "kim",
    });

    expect(taken.statusCode).toBe(409);
    expect(taken.json<ErrorResponse>().error.message).toBe(
      `That email already belongs to the household "Le chalet", as kim. Remove it first.`,
    );
  });
});
