/**
 * The rules routes (lg-4): add, edit, retire, and who a rule may name. Every
 * write appends, so each test that changes a rule also reads the table to show
 * the earlier version is still there.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, PeopleResponse, Rule, RulesResponse } from "@ledger/contract";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { SAM, accessConfig } from "./helpers/access.ts";
import { MORTGAGE_RULE, TRANSFER_RULE, addRule, startApp } from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

async function start(...args: Parameters<typeof startApp>): Promise<App> {
  app = await startApp(...args);
  return app;
}

async function listed(target: App): Promise<Rule[]> {
  const response = await target.server.inject({ method: "GET", url: ROUTES.rules });
  return response.json<RulesResponse>().rules;
}

function versions(target: App): number {
  return (target.context.db.prepare("SELECT count(*) AS n FROM rules").get() as { n: number }).n;
}

describe("GET /api/rules", () => {
  test("a new database has no rule: nothing is seeded", async () => {
    const target = await start();

    expect(await listed(target)).toEqual([]);
  });

  test("lists the rules in force, oldest first", async () => {
    const target = await start();
    const first = await addRule(target, TRANSFER_RULE);
    const second = await addRule(target, MORTGAGE_RULE);

    expect((await listed(target)).map((rule) => rule.id)).toEqual([first.id, second.id]);
  });

  test("is behind the identity check", async () => {
    app = await createApp({
      config: { databasePath: ":memory:", logLevel: "silent", access: accessConfig() },
    });

    const response = await app.server.inject({ method: "GET", url: ROUTES.rules });

    expect(response.statusCode).toBe(403);
  });
});

describe("POST /api/rules", () => {
  test("adds a rule, recording who and when from the identity", async () => {
    const target = await start(SAM);

    const rule = await addRule(target, TRANSFER_RULE);

    expect(rule).toEqual({
      ...TRANSFER_RULE,
      id: expect.any(Number),
      createdAt: "2026-10-03T09:30:00.000Z",
      createdBy: "sam",
    });
    expect(await listed(target)).toEqual([rule]);
  });

  test("a person nobody has heard of is refused, and nothing is stored", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.rules,
      payload: { ...TRANSFER_RULE, personId: "mallory" },
    });

    expect(response.statusCode).toBe(400);
    expect(versions(target)).toBe(0);
  });

  test.each([
    ["an empty pattern", { descriptionPattern: "  " }, "descriptionPattern"],
    ["a bucket that is not one of the two", { bucket: "savings" }, "bucket"],
    ["an amount that is not whole cents", { amountCents: 40.5 }, "amountCents"],
    ["an empty category", { category: "" }, "category"],
  ])("%s is refused naming the field and not the value", async (_name, change, field) => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: ROUTES.rules,
      payload: { ...TRANSFER_RULE, ...change },
    });

    expect(response.statusCode).toBe(400);
    const { error } = response.json<ErrorResponse>();
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.message).toContain(field);
    expect(error.message).not.toContain("Caisse du Lac");
    expect(versions(target)).toBe(0);
  });
});

describe("POST /api/rules/:id", () => {
  test("files a new version that replaces the old, and keeps the old", async () => {
    const target = await start();
    const original = await addRule(target, TRANSFER_RULE);

    const response = await target.server.inject({
      method: "POST",
      url: `${ROUTES.rules}/${original.id}`,
      payload: { ...TRANSFER_RULE, amountCents: 42000 },
    });

    const edited = response.json<Rule>();
    expect(edited).toMatchObject({ amountCents: 42000, createdBy: "alex" });
    expect(edited.id).not.toBe(original.id);
    expect(await listed(target)).toEqual([edited]);
    // The version it replaced is still stored, exactly as it was.
    const old = target.context.db
      .prepare("SELECT amount_cents FROM rules WHERE id = ?")
      .get(original.id);
    expect(old).toEqual({ amount_cents: 40000 });
    expect(versions(target)).toBe(2);
  });

  test("a version already replaced cannot be edited again, which is what two people at once meet", async () => {
    const target = await start();
    const original = await addRule(target, TRANSFER_RULE);
    const edit = async (amountCents: number) =>
      await target.server.inject({
        method: "POST",
        url: `${ROUTES.rules}/${original.id}`,
        payload: { ...TRANSFER_RULE, amountCents },
      });

    expect((await edit(41000)).statusCode).toBe(200);
    const second = await edit(42000);

    expect(second.statusCode).toBe(404);
    expect(second.json<ErrorResponse>().error.code).toBe("RULE_NOT_FOUND");
    expect(await listed(target)).toHaveLength(1);
    expect(versions(target)).toBe(2);
  });

  test("a rule that never existed is refused the same way", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: `${ROUTES.rules}/404`,
      payload: TRANSFER_RULE,
    });

    expect(response.json<ErrorResponse>().error.code).toBe("RULE_NOT_FOUND");
  });

  test("a rule's number is a number", async () => {
    const target = await start();

    const response = await target.server.inject({
      method: "POST",
      url: `${ROUTES.rules}/one`,
      payload: TRANSFER_RULE,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/rules/:id/retire", () => {
  test("takes the rule out of force and keeps every version of it", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);
    const kept = await addRule(target, MORTGAGE_RULE);

    const response = await target.server.inject({
      method: "POST",
      url: `${ROUTES.rules}/${rule.id}/retire`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<Rule>().id).toBe(rule.id);
    expect(await listed(target)).toEqual([kept]);
    expect(versions(target)).toBe(3);
  });

  test("a retired rule is not retired twice", async () => {
    const target = await start();
    const rule = await addRule(target, TRANSFER_RULE);
    const retire = async () =>
      await target.server.inject({ method: "POST", url: `${ROUTES.rules}/${rule.id}/retire` });

    await retire();
    const again = await retire();

    expect(again.json<ErrorResponse>().error.code).toBe("RULE_NOT_FOUND");
    expect(versions(target)).toBe(2);
  });
});

describe("GET /api/people", () => {
  test("lists the configured people, once each and in order", async () => {
    app = await createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        access: accessConfig({
          devIdentity: SAM,
          people: new Map([
            ["sam@example.test", "sam"],
            ["sam.work@example.test", "sam"],
            ["alex@example.test", "alex"],
          ]),
        }),
      },
    });

    const response = await app.server.inject({ method: "GET", url: ROUTES.people });

    expect(response.json<PeopleResponse>()).toEqual({ people: ["alex", "sam"] });
  });
});
