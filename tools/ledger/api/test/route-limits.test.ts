/**
 * Every API route but health is rate limited, per person (lg-4).
 *
 * CodeQL's "missing rate limiting" named three routes; none of the ledger's was
 * limited, so the gap was the tool's and not those routes'. The first test walks
 * `ROUTES` itself, so a route added to the contract without a line here — and so
 * without a limit — fails this file rather than shipping open.
 */

import { RateLimiter } from "@webtools/core/rate-limit";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse } from "@ledger/contract";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AppContext } from "../src/context.ts";
import { createRateLimitHook, rateLimitsFor } from "../src/rate-limit.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { accessConfig, memberDirectory, homeBooks } from "./helpers/access.ts";
import { VERBS } from "./helpers/routes.ts";
import { TRANSFER_RULE, addRule, startApp } from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

const LIMITED = Object.entries(VERBS).filter(([name]) => name !== "health");

/**
 * Both buckets hold one token, so the second request of either kind is the one
 * refused. alex is an admin as well as a member, so the admin routes (lg-22)
 * admit the first request too.
 */
async function startTight(): Promise<App> {
  app = await createApp({
    directory: memberDirectory(),
    config: {
      dataDir: ":memory:",
      logLevel: "silent",
      access: accessConfig({
        devIdentity: "alex@example.test",
        admins: new Set(["alex@example.test"]),
      }),
      rateLimitReadsPerMinute: 1,
      rateLimitWritesPerMinute: 1,
      rateLimitReceiptReadsPerMinute: 1,
    },
  });
  return app;
}

describe("the routes", () => {
  test("every route in the contract is accounted for, so a new one cannot be forgotten", () => {
    expect(Object.keys(VERBS).toSorted()).toEqual(Object.keys(ROUTES).toSorted());
  });

  test.each(LIMITED)(
    "%s refuses the second request in a minute, as RATE_LIMITED",
    async (_name, [method, url]) => {
      const target = await startTight();
      const send = async () =>
        await target.server.inject({ method, url, ...(method === "POST" ? { payload: {} } : {}) });

      const first = await send();
      const second = await send();

      // Whatever the first one was — a 400 for an empty body, a 404 for a rule that
      // is not there — it was admitted, and it is the second that is turned away.
      expect(first.statusCode).not.toBe(429);
      expect(second.statusCode).toBe(429);
      expect(second.json<ErrorResponse>().error.code).toBe("RATE_LIMITED");
      expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
      expect(second.headers["ratelimit-limit"]).toBe("1");
    },
  );

  test("health is never limited, so a probe is always answered", async () => {
    const target = await startTight();

    const statuses = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await target.server.inject({ method: "GET", url: ROUTES.health })).statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  test("reads and writes are separate buckets", async () => {
    const target = await startTight();
    await target.server.inject({ method: "GET", url: ROUTES.rules });
    expect((await target.server.inject({ method: "GET", url: ROUTES.rules })).statusCode).toBe(429);

    const write = await target.server.inject({
      method: "POST",
      url: ROUTES.rules,
      payload: TRANSFER_RULE,
    });

    expect(write.statusCode).toBe(200);
  });

  test("a refused write changes nothing", async () => {
    const target = await startTight();
    await addRule(target, TRANSFER_RULE);

    const refused = await target.server.inject({
      method: "POST",
      url: ROUTES.rules,
      payload: { ...TRANSFER_RULE, descriptionPattern: "Taxes /Ville Exemple" },
    });

    expect(refused.statusCode).toBe(429);
    expect(homeBooks(target).prepare("SELECT count(*) AS n FROM rules").get()).toEqual({ n: 1 });
  });

  test("a limit of zero turns the limiter off", async () => {
    app = await createApp({
      directory: memberDirectory(),
      config: {
        dataDir: ":memory:",
        logLevel: "silent",
        access: accessConfig({ devIdentity: "alex@example.test" }),
        rateLimitReadsPerMinute: 0,
        rateLimitWritesPerMinute: 0,
      },
    });

    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await app.server.inject({ method: "GET", url: ROUTES.rules });
      expect(response.statusCode).toBe(200);
    }
  });

  test("the defaults leave a person tapping through an inbox well inside the limit", async () => {
    const target = await startApp();

    for (let attempt = 0; attempt < 40; attempt++) {
      const response = await target.server.inject({ method: "GET", url: ROUTES.inbox });
      expect(response.statusCode).toBe(200);
    }
    app = target;
  });
});

function hookFor(limiter: RateLimiter) {
  return createRateLimitHook({
    limiter,
    logger: createLogger({ level: "silent" }),
    scope: "test",
  });
}

/** Just what the hook reads: who the request is from, and somewhere to put headers. */
function call(hook: ReturnType<typeof hookFor>, person: string | null, ip: string) {
  const email = `${person ?? "nobody"}@example.test`;
  const request = {
    ip,
    identity:
      person === null
        ? null
        : { email, admin: false, person: { id: person, email, household: "home" } },
  } as unknown as FastifyRequest;
  const reply = { header: vi.fn() } as unknown as FastifyReply;
  return hook(request, reply);
}

describe("the key", () => {
  test("is the person, so two people behind one address have a bucket each", async () => {
    const hook = hookFor(new RateLimiter({ perMinute: 1 }));

    await call(hook, "alex", "10.0.0.1");

    await expect(call(hook, "alex", "10.0.0.1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(call(hook, "sam", "10.0.0.1")).resolves.toBeUndefined();
  });

  test("is not the address, so one person on two networks has one bucket", async () => {
    const hook = hookFor(new RateLimiter({ perMinute: 1 }));

    await call(hook, "alex", "10.0.0.1");

    await expect(call(hook, "alex", "203.0.113.9")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("fails closed when the identity check did not run", async () => {
    const hook = hookFor(new RateLimiter({ perMinute: 5 }));

    await expect(call(hook, null, "10.0.0.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

// lg-5: the table above takes one verb per route, and the salaries and the ratios
// answer a `GET` as well as the `POST` it walks; so do lg-6's recurring items.
describe("the routes that answer two verbs", () => {
  test.each([
    ["salaries", ROUTES.salaries],
    ["ratios", ROUTES.ratios],
    ["recurring", ROUTES.recurring],
    ["periodLines", ROUTES.periodLines],
  ])("GET %s refuses the second request in a minute too", async (_name, url) => {
    const target = await startTight();

    await target.server.inject({ method: "GET", url });
    const second = await target.server.inject({ method: "GET", url });

    expect(second.statusCode).toBe(429);
  });

  // lg-15: the table walks one verb per route, so the other verb of a path two
  // verbs share was never requested. These are the writes whose `GET` it walks.
  test.each([
    ["rules", ROUTES.rules],
    ["spendingCategories", ROUTES.spendingCategories],
    ["spendingCategoryMap", ROUTES.spendingCategoryMap],
    // lg-22: the admin's list of households, whose POST creates one.
    ["adminHouseholds", ROUTES.adminHouseholds],
  ])("POST %s refuses the second request in a minute too", async (_name, url) => {
    const target = await startTight();

    await target.server.inject({ method: "POST", url, payload: {} });
    const second = await target.server.inject({ method: "POST", url, payload: {} });

    expect(second.statusCode).toBe(429);
  });
});

/** The hook, called for a person in a household (lg-21). */
function callIn(hook: ReturnType<typeof hookFor>, household: string, person: string) {
  const email = `${person}@${household}.test`;
  const request = {
    ip: "10.0.0.1",
    identity: { email, admin: false, person: { id: person, email, household } },
  } as unknown as FastifyRequest;
  return hook(request, { header: vi.fn() } as unknown as FastifyReply);
}

// lg-21: a person is a name in a household, and two households can each have an
// alex. The bucket is kept for the household and the name together.
describe("the key, across households", () => {
  test("is the household and the person, so two households' people with one name have a bucket each", async () => {
    const hook = hookFor(new RateLimiter({ perMinute: 1 }));

    await callIn(hook, "home", "alex");

    await expect(callIn(hook, "home", "alex")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(callIn(hook, "away", "alex")).resolves.toBeUndefined();
    await expect(callIn(hook, "away", "alex")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

/** The admin hook, called for an identity (lg-22). */
function callAs(hook: ReturnType<typeof hookFor>, email: string, admin: boolean) {
  const request = {
    ip: "10.0.0.1",
    identity: { email, admin, person: null },
  } as unknown as FastifyRequest;
  return hook(request, { header: vi.fn() } as unknown as FastifyReply);
}

/** The admin routes' write hook, over one limiter, logging into `lines`. */
function adminHook(limiter: RateLimiter, lines: string[] = []) {
  return rateLimitsFor({
    rateLimits: { reads: limiter, writes: limiter },
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
  } as unknown as AppContext).adminWrite;
}

// lg-22: an admin may be in no household, so has no person to key a bucket on.
// The admin routes' hook keys on the admin's address, refuses anyone else before
// it spends a token, and never writes the address into the log.
describe("the key, on an admin route", () => {
  test("is the admin's address, so two admins in no household have a bucket each", async () => {
    const hook = adminHook(new RateLimiter({ perMinute: 1 }));

    await callAs(hook, "admin@example.test", true);

    await expect(callAs(hook, "admin@example.test", true)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
    await expect(callAs(hook, "other.admin@example.test", true)).resolves.toBeUndefined();
  });

  test("refuses a non-admin as FORBIDDEN, spending nothing, with the limits on or off", async () => {
    const limiter = new RateLimiter({ perMinute: 1 });
    const hook = adminHook(limiter);

    await expect(callAs(hook, "member@example.test", false)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Nothing spent, read without naming the key (lg-22's gate 2, N2): the same
    // address as an admin, on the same one-token limiter, is still admitted.
    await expect(callAs(hook, "member@example.test", true)).resolves.toBeUndefined();
    await expect(
      callAs(adminHook(new RateLimiter({ perMinute: 0 })), "member@example.test", false),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("logs a refusal without the address", async () => {
    const lines: string[] = [];
    const hook = adminHook(new RateLimiter({ perMinute: 1 }), lines);

    await callAs(hook, "admin@example.test", true);
    await expect(callAs(hook, "admin@example.test", true)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    expect(lines.some((line) => line.includes("rate limited"))).toBe(true);
    expect(lines.join("\n")).not.toContain("admin@example.test");
  });
});

// lg-22's gate 1, F4: a person's key is `<household>:<name>`, a household may be
// called `admin` and a name is free text, so an admin's key must be one no
// household and name can spell.
describe("the key, on an admin route, against a person's", () => {
  test("is never a person's, even in a household called admin under the admin's address as a name", async () => {
    const limiter = new RateLimiter({ perMinute: 1 });
    const personHook = createRateLimitHook({
      limiter,
      logger: createLogger({ level: "silent" }),
      scope: "test",
    });

    await callIn(personHook, "admin", "admin@example.test");
    await expect(callIn(personHook, "admin", "admin@example.test")).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });

    await expect(callAs(adminHook(limiter), "admin@example.test", true)).resolves.toBeUndefined();
  });
});
