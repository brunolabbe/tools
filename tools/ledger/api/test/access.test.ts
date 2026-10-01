import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, ROUTES } from "@ledger/contract";
import type { ErrorResponse, HealthResponse, MeResponse } from "@ledger/contract";
import type { AccessConfig } from "../src/config.ts";
import { createLogger } from "../src/logger.ts";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import {
  ALEX,
  AUDIENCE,
  JWKS_URL,
  SAM,
  STRANGER,
  accessConfig,
  jwksFetch,
  signToken,
  testKey,
} from "./helpers/access.ts";
import type { TestKey } from "./helpers/access.ts";

const HEADER = "cf-access-jwt-assertion";

// Generated once: an RSA key pair costs tens of milliseconds, and every test
// here needs one.
const KEY = testKey("key-1");
const OTHER_KEY = testKey("key-1-impostor");
const ROTATED_KEY = testKey("key-2");

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

interface Harness {
  app: App;
  urls: string[];
  clock: { now: Date };
  lines: string[];
  nowSec: () => number;
}

async function start(
  options: { access?: AccessConfig; keys?: () => TestKey[]; fetch?: typeof fetch } = {},
): Promise<Harness> {
  const clock = { now: new Date("2026-10-01T12:00:00Z") };
  const served = jwksFetch(options.keys ?? (() => [KEY]));
  const lines: string[] = [];
  app = await createApp({
    config: { databasePath: ":memory:", access: options.access ?? accessConfig() },
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    now: () => clock.now,
    fetch: options.fetch ?? served.fetch,
  });
  return {
    app,
    urls: served.urls,
    clock,
    lines,
    nowSec: () => Math.floor(clock.now.getTime() / 1000),
  };
}

async function me(harness: Harness, token?: string) {
  return await harness.app.server.inject({
    method: "GET",
    url: ROUTES.me,
    headers: token === undefined ? {} : { [HEADER]: token },
  });
}

function expectRefused(response: Awaited<ReturnType<typeof me>>, code: string, status: number) {
  expect(response.statusCode).toBe(status);
  const { error } = response.json<ErrorResponse>();
  // One answer per code, whichever check failed: no details, and the
  // taxonomy's own sentence, so the caller cannot tell the checks apart.
  expect(error).toEqual({
    code,
    message: DEFAULT_ERROR_MESSAGES[code as keyof typeof DEFAULT_ERROR_MESSAGES],
    retryable: false,
  });
}

describe("the Access identity check", () => {
  test("a valid token reaches the route as the mapped person", async () => {
    const harness = await start();

    const response = await me(harness, signToken({ key: KEY, nowSec: harness.nowSec() }));

    expect(response.statusCode).toBe(200);
    expect(response.json<MeResponse>()).toEqual({ person: { id: "alex", email: ALEX } });
    // The key set came from the host built out of the team name, and nowhere else.
    expect(harness.urls).toEqual([JWKS_URL]);
  });

  test("the second person maps to theirs, and the address is matched without case", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();

    const sam = await me(harness, signToken({ key: KEY, nowSec, claims: { email: SAM } }));
    const shouting = await me(
      harness,
      signToken({ key: KEY, nowSec, claims: { email: "Alex@Example.TEST" } }),
    );

    expect(sam.json<MeResponse>().person.id).toBe("sam");
    expect(shouting.json<MeResponse>().person.id).toBe("alex");
  });

  test("a missing token is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    expectRefused(await me(harness), "UNAUTHENTICATED", 403);
  });

  test("a token with a bad signature is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    // Names the published key's id, signed by a key that is not it.
    const forged = signToken({ key: KEY, signWith: OTHER_KEY, nowSec: harness.nowSec() });
    expectRefused(await me(harness, forged), "UNAUTHENTICATED", 403);
  });

  test("a token for another audience is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    const token = signToken({
      key: KEY,
      nowSec: harness.nowSec(),
      claims: { aud: ["some-other-application"] },
    });
    expectRefused(await me(harness, token), "UNAUTHENTICATED", 403);
  });

  test("an expired token is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    const issued = harness.nowSec() - 7200;
    const token = signToken({ key: KEY, nowSec: issued, claims: { exp: issued + 3600 } });
    expectRefused(await me(harness, token), "UNAUTHENTICATED", 403);
  });

  test("a valid token for an address the configuration does not know is a 403", async () => {
    const harness = await start();
    const token = signToken({ key: KEY, nowSec: harness.nowSec(), claims: { email: STRANGER } });
    expectRefused(await me(harness, token), "FORBIDDEN", 403);
  });

  test("/api/health answers without a token, and fetches no keys", async () => {
    const harness = await start();

    const response = await harness.app.server.inject({ method: "GET", url: ROUTES.health });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>().ok).toBe(true);
    expect(harness.urls).toEqual([]);
  });

  test("the algorithm is never the token's to choose", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();
    const valid = signToken({ key: KEY, nowSec });
    const [, body] = valid.split(".");
    const unsigned = `${Buffer.from(JSON.stringify({ alg: "none", kid: KEY.kid })).toString("base64url")}.${body}.`;
    const hmac = signToken({ key: KEY, nowSec, header: { alg: "HS256" } });

    expectRefused(await me(harness, unsigned), "UNAUTHENTICATED", 403);
    expectRefused(await me(harness, hmac), "UNAUTHENTICATED", 403);
  });

  test("a token from another team, or one that is not a token at all, is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();
    const otherIssuer = signToken({
      key: KEY,
      nowSec,
      claims: { iss: "https://someone-else.cloudflareaccess.com" },
    });

    expectRefused(await me(harness, otherIssuer), "UNAUTHENTICATED", 403);
    expectRefused(await me(harness, "not-a-token"), "UNAUTHENTICATED", 403);
    expectRefused(await me(harness, "a.b.c"), "UNAUTHENTICATED", 403);
  });

  test("a token not valid yet is UNAUTHENTICATED, a 403", async () => {
    const harness = await start();
    const later = harness.nowSec() + 600;
    const token = signToken({ key: KEY, nowSec: later });
    expectRefused(await me(harness, token), "UNAUTHENTICATED", 403);
  });

  test("with no Access settings at all, every API route but health is refused", async () => {
    const harness = await start({
      access: accessConfig({ team: undefined, audience: undefined }),
    });

    expectRefused(
      await me(harness, signToken({ key: KEY, nowSec: harness.nowSec() })),
      "UNAUTHENTICATED",
      403,
    );
    expect(harness.urls).toEqual([]);
    const health = await harness.app.server.inject({ method: "GET", url: ROUTES.health });
    expect(health.statusCode).toBe(200);
  });

  test("the development identity reaches the route with no token and no key fetch", async () => {
    const harness = await start({ access: accessConfig({ devIdentity: SAM }) });

    const response = await me(harness);

    expect(response.statusCode).toBe(200);
    expect(response.json<MeResponse>()).toEqual({ person: { id: "sam", email: SAM } });
    expect(harness.urls).toEqual([]);
  });
});

describe("the key set", () => {
  test("is fetched once and reused", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();

    for (let i = 0; i < 5; i += 1) {
      expect((await me(harness, signToken({ key: KEY, nowSec }))).statusCode).toBe(200);
    }

    expect(harness.urls).toHaveLength(1);
  });

  test("is fetched again when a token names a key it lacks, which picks up a rotation", async () => {
    let published = [KEY];
    const harness = await start({ keys: () => published });
    expect((await me(harness, signToken({ key: KEY, nowSec: harness.nowSec() }))).statusCode).toBe(
      200,
    );

    published = [KEY, ROTATED_KEY];
    harness.clock.now = new Date(harness.clock.now.getTime() + 60_000);
    const rotated = await me(harness, signToken({ key: ROTATED_KEY, nowSec: harness.nowSec() }));

    expect(rotated.statusCode).toBe(200);
    expect(harness.urls).toHaveLength(2);
  });

  test("a flood of tokens naming unknown keys costs at most one fetch per window", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();
    // Warm: the first fetch.
    expect((await me(harness, signToken({ key: KEY, nowSec }))).statusCode).toBe(200);
    harness.clock.now = new Date(harness.clock.now.getTime() + 60_000);

    const strangers = Array.from({ length: 20 }, (_, i) => `unknown-${i}`);
    const responses = await Promise.all(
      strangers.map((kid) => me(harness, signToken({ key: KEY, nowSec, header: { kid } }))),
    );
    for (const response of responses) expectRefused(response, "UNAUTHENTICATED", 403);
    // One refresh for all twenty, concurrent as they were.
    expect(harness.urls).toHaveLength(2);

    // And none for the next one inside the window.
    expectRefused(
      await me(harness, signToken({ key: KEY, nowSec, header: { kid: "unknown-again" } })),
      "UNAUTHENTICATED",
      403,
    );
    expect(harness.urls).toHaveLength(2);
  });

  test("an unreachable key endpoint is not reported as the caller's bad token", async () => {
    const harness = await start({
      fetch: async () => new Response("down", { status: 503 }),
    });

    const response = await me(harness, signToken({ key: KEY, nowSec: harness.nowSec() }));

    expect(response.statusCode).toBe(502);
    expect(response.json<ErrorResponse>().error.code).toBe("UNREACHABLE");
  });
});

describe("what the check never does", () => {
  test("logs the token or its header", async () => {
    const harness = await start();
    const nowSec = harness.nowSec();
    const tokens = [
      signToken({ key: KEY, signWith: OTHER_KEY, nowSec }),
      signToken({ key: KEY, nowSec, claims: { email: STRANGER } }),
      signToken({ key: KEY, nowSec }),
    ];

    for (const token of tokens) await me(harness, token);

    expect(harness.lines.length).toBeGreaterThan(0);
    for (const token of tokens) {
      const signature = token.split(".")[2] ?? "";
      for (const line of harness.lines) {
        expect(line).not.toContain(token);
        expect(line).not.toContain(signature);
        expect(line.toLowerCase()).not.toContain(HEADER);
      }
    }
    // The reason a token was refused is the operator's to read.
    expect(harness.lines.some((line) => line.includes('"reason":"signature"'))).toBe(true);
  });

  test("lets a path spelled another way past it", async () => {
    const harness = await start();
    // Valid, but for an address nobody is mapped to: the hook answers that
    // with `FORBIDDEN`, and only the hook does — a route reached without it
    // would fail closed in `personOf` with `UNAUTHENTICATED` instead. Both are
    // 403s, so the code, not the status, proves the hook ran on the route the
    // URL actually reached.
    const stranger = signToken({ key: KEY, nowSec: harness.nowSec(), claims: { email: STRANGER } });
    const ask = async (url: string) =>
      await harness.app.server.inject({ method: "GET", url, headers: { [HEADER]: stranger } });

    // Measured: the router decodes these, so they reach `GET /api/me`.
    for (const url of ["/%61pi/me", "/api/%6de", "/api/me?x=1"]) {
      expectRefused(await ask(url), "FORBIDDEN", 403);
    }
    // And these reach no route at all.
    for (const url of ["//api/me", "/api/me/"]) {
      expect((await ask(url)).statusCode, url).toBe(404);
    }
  });

  test("trusts the audience the token names over the configured one", async () => {
    // A token carrying several audiences is fine as long as ours is among
    // them; one that merely mentions ours elsewhere is not.
    const harness = await start();
    const nowSec = harness.nowSec();
    const several = signToken({ key: KEY, nowSec, claims: { aud: ["another", AUDIENCE] } });
    const elsewhere = signToken({
      key: KEY,
      nowSec,
      claims: { aud: "another", note: AUDIENCE },
    });

    expect((await me(harness, several)).statusCode).toBe(200);
    expectRefused(await me(harness, elsewhere), "UNAUTHENTICATED", 403);
  });
});
