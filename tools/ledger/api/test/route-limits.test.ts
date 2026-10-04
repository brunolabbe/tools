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
import { createRateLimitHook } from "../src/rate-limit.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { accessConfig } from "./helpers/access.ts";
import { TRANSFER_RULE, addRule, startApp } from "./helpers/classification.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** Every route the API answers, with the verb a request to it takes. */
const VERBS = {
  health: ["GET", ROUTES.health],
  me: ["GET", ROUTES.me],
  statements: ["POST", ROUTES.statements],
  rules: ["GET", ROUTES.rules],
  rule: ["POST", ROUTES.rule.replace(":id", "1")],
  ruleRetire: ["POST", ROUTES.ruleRetire.replace(":id", "1")],
  inbox: ["GET", ROUTES.inbox],
  classifications: ["POST", ROUTES.classifications],
  people: ["GET", ROUTES.people],
  buckets: ["GET", ROUTES.buckets],
  salaries: ["POST", ROUTES.salaries],
  ratios: ["POST", ROUTES.ratios],
} as const satisfies Record<keyof typeof ROUTES, readonly ["GET" | "POST", string]>;

const LIMITED = Object.entries(VERBS).filter(([name]) => name !== "health");

/** Both buckets hold one token, so the second request of either kind is the one refused. */
async function startTight(): Promise<App> {
  app = await createApp({
    config: {
      databasePath: ":memory:",
      logLevel: "silent",
      access: accessConfig({ devIdentity: "alex@example.test" }),
      rateLimitReadsPerMinute: 1,
      rateLimitWritesPerMinute: 1,
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
    expect(target.context.db.prepare("SELECT count(*) AS n FROM rules").get()).toEqual({ n: 1 });
  });

  test("a limit of zero turns the limiter off", async () => {
    app = await createApp({
      config: {
        databasePath: ":memory:",
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
  const request = {
    ip,
    person: person === null ? null : { id: person, email: `${person}@example.test` },
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
// answer a `GET` as well as the `POST` it walks.
describe("the routes that answer two verbs", () => {
  test.each([
    ["salaries", ROUTES.salaries],
    ["ratios", ROUTES.ratios],
  ])("GET %s refuses the second request in a minute too", async (_name, url) => {
    const target = await startTight();

    await target.server.inject({ method: "GET", url });
    const second = await target.server.inject({ method: "GET", url });

    expect(second.statusCode).toBe(429);
  });
});
