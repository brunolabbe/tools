/**
 * Renaming a person from the app (lg-33): an admin gives a person a shown name,
 * every answer that lists people carries it, and the books keep the id they
 * stored before. Who may call the route at all is `authority.test.ts`, and its
 * limiter is `route-limits.test.ts`.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type {
  AdminHouseholdsResponse,
  ErrorResponse,
  HouseholdResponse,
  PeopleResponse,
  Rule,
  RulesResponse,
  SalariesResponse,
} from "@ledger/contract";
import { ADMIN, ALEX, HOUSEHOLD, SAM, homeBooks, memberDirectory } from "./helpers/access.ts";
import { HISTORY, TRANSFER, paste } from "./helpers/classification.ts";
import { directorySnapshot, send, startHouseholds } from "./helpers/households.ts";
import type { Harness } from "./helpers/households.ts";

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.app.shutdown();
  harness = undefined;
});

/** home holds bruno (alex's address) and sam; the admin is in no household. */
async function start(): Promise<Harness> {
  harness = await startHouseholds(
    memberDirectory([
      [ALEX, "bruno"],
      [SAM, "sam"],
    ]),
  );
  return harness;
}

const RENAME = ROUTES.adminPersonRename.replace(":id", HOUSEHOLD);

describe("an admin renames a person", () => {
  test("and GET /api/people keeps the ids, shows the name, and the books still read bruno", async () => {
    const { app } = await start();
    // Stored before the rename: a rule, a classification and a salary naming bruno.
    const rule = await send(app, ALEX, "POST", ROUTES.rules, {
      descriptionPattern: TRANSFER,
      category: "Virements",
      amountCents: 40000,
      personId: "bruno",
      bucket: "mortgage",
      spendingCategoryId: null,
    });
    expect(rule.statusCode, rule.body).toBe(200);
    const pasted = await send(app, ALEX, "POST", ROUTES.statements, { text: paste() });
    expect(pasted.statusCode, pasted.body).toBe(200);
    const groceries = HISTORY.at(-1);
    const row = homeBooks(app)
      .prepare("SELECT id FROM statement_rows WHERE amount_cents = ?")
      .get(groceries?.amountCents) as { id: number };
    const classified = await send(app, SAM, "POST", ROUTES.classifications, {
      rowId: row.id,
      personId: "bruno",
      bucket: "current-expenses",
    });
    expect(classified.statusCode, classified.body).toBe(200);
    const salaries = await send(app, ALEX, "POST", ROUTES.salaries, {
      year: 2025,
      salaries: [
        { personId: "bruno", amountCents: 6_000_000 },
        { personId: "sam", amountCents: 4_000_000 },
      ],
    });
    expect(salaries.statusCode, salaries.body).toBe(200);
    const before = (await send(app, SAM, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(before).toEqual({ people: ["bruno", "sam"], names: { bruno: "bruno", sam: "sam" } });

    const renamed = await send(app, ADMIN, "POST", RENAME, { person: "bruno", name: "Bruno" });

    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toEqual({ person: "bruno", name: "Bruno" });
    const after = (await send(app, SAM, "GET", ROUTES.people)).json<PeopleResponse>();
    expect(after.people).toEqual(before.people);
    expect(after.names.bruno).toBe("Bruno");
    expect(after.names.sam).toBe("sam");

    const rules = (await send(app, ALEX, "GET", ROUTES.rules)).json<RulesResponse>().rules;
    expect(rules.map((one: Rule) => one.personId)).toEqual(["bruno"]);
    expect(
      homeBooks(app)
        .prepare("SELECT person_id FROM classifications WHERE row_id = ? ORDER BY id")
        .all(row.id),
    ).toEqual([{ person_id: "bruno" }]);
    const stood = (await send(app, ALEX, "GET", ROUTES.salaries)).json<SalariesResponse>();
    expect(stood.salaries.map((salary) => salary.personId).toSorted()).toEqual(["bruno", "sam"]);
    // The caller is still bruno: the identity is the id, not the shown name.
    expect((await send(app, ALEX, "GET", ROUTES.me)).json()).toMatchObject({
      person: { id: "bruno" },
    });
  });

  test("and every listing of the household's members shows the name beside the id", async () => {
    const { app } = await start();

    await send(app, ADMIN, "POST", RENAME, { person: "bruno", name: "Bruno" });

    const admin = (
      await send(app, ADMIN, "GET", ROUTES.adminHouseholds)
    ).json<AdminHouseholdsResponse>();
    expect(admin.households.find((household) => household.id === HOUSEHOLD)?.members).toEqual([
      { address: ALEX, person: "bruno", name: "Bruno" },
      { address: SAM, person: "sam", name: "sam" },
    ]);
    const own = (
      await send(app, SAM, "GET", ROUTES.household.replace(":id", HOUSEHOLD))
    ).json<HouseholdResponse>();
    expect(own.members).toEqual([
      { address: ALEX, person: "bruno", name: "Bruno" },
      { address: SAM, person: "sam", name: "sam" },
    ]);
    // The rename is its own line in the household's history, signed by the admin.
    expect(own.history.at(-1)).toMatchObject({
      action: "rename",
      person: "bruno",
      name: "Bruno",
      by: ADMIN,
    });
    const added = await send(app, ADMIN, "POST", ROUTES.adminMembers.replace(":id", HOUSEHOLD), {
      address: "bruno.phone@example.test",
      person: "bruno",
    });
    expect(added.json()).toEqual({
      address: "bruno.phone@example.test",
      person: "bruno",
      name: "Bruno",
    });
  });
});

describe("a rename is refused", () => {
  test("for a person no membership has named, as PERSON_NOT_FOUND, and nothing changes", async () => {
    const { app, directory } = await start();
    // A person id the books hold from an old rule, which no membership named.
    homeBooks(app).prepare("INSERT INTO people (id, added_at) VALUES ('casey', 'x')").run();
    expect((await send(app, SAM, "GET", ROUTES.people)).json<PeopleResponse>().people).toEqual([
      "bruno",
      "casey",
      "sam",
    ]);
    const before = directorySnapshot(directory);

    const response = await send(app, ADMIN, "POST", RENAME, { person: "casey", name: "Casey" });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error.code).toBe("PERSON_NOT_FOUND");
    expect(directorySnapshot(directory)).toBe(before);
    expect((await send(app, SAM, "GET", ROUTES.people)).json<PeopleResponse>().names.casey).toBe(
      "casey",
    );
  });

  test("for a name another person is shown under or has as their id, as PERSON_NAME_TAKEN", async () => {
    const { app, directory } = await start();
    await send(app, ADMIN, "POST", RENAME, { person: "sam", name: "Samantha" });
    const before = directorySnapshot(directory);

    for (const name of ["Samantha", "sam"]) {
      const response = await send(app, ADMIN, "POST", RENAME, { person: "bruno", name });
      expect(response.statusCode, name).toBe(409);
      expect(response.json<ErrorResponse>().error.code, name).toBe("PERSON_NAME_TAKEN");
    }
    expect(directorySnapshot(directory)).toBe(before);
  });

  test("for a body that is not a person and a name, or a household that is not there", async () => {
    const { app, directory } = await start();
    const before = directorySnapshot(directory);

    for (const payload of [{}, { person: "bruno" }, { person: "bruno", name: "" }, { name: "B" }]) {
      const response = await send(app, ADMIN, "POST", RENAME, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const nowhere = await send(
      app,
      ADMIN,
      "POST",
      ROUTES.adminPersonRename.replace(":id", "nowhere"),
      { person: "bruno", name: "Bruno" },
    );
    expect(nowhere.json<ErrorResponse>().error.code).toBe("HOUSEHOLD_NOT_FOUND");
    expect(directorySnapshot(directory)).toBe(before);
  });
});
