/**
 * The identity check reads the household directory (lg-20).
 *
 * A member gets their person and household on the request; an admin in no
 * household is identified and refused by every books route; an address that is
 * neither — never filed, or since removed — is refused at the hook. The
 * directory is read on every request, so a change applies without a restart.
 * Real tokens throughout: the development identity is checked once at boot, and
 * what is under test here is what each request finds.
 */

import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import type { ErrorResponse, MeResponse, PeopleResponse } from "@ledger/contract";
import { createIdentityVerifier } from "../src/access.ts";
import type { Directory } from "../src/directory.ts";
import { createLogger } from "../src/logger.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import {
  ADMIN,
  ALEX,
  HOUSEHOLD,
  SAM,
  STRANGER,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./helpers/access.ts";
import { VERBS } from "./helpers/routes.ts";

const KEY = testKey("key-1");
const HEADER = "cf-access-jwt-assertion";
const NOW = new Date("2026-10-12T12:00:00Z");
const CHANGE = { by: "operator", at: NOW };

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

interface Harness {
  app: App;
  directory: Directory;
  lines: string[];
}

async function start(
  directory: Directory = memberDirectory(),
  admins: readonly string[] = [ADMIN],
): Promise<Harness> {
  const lines: string[] = [];
  app = await createApp({
    directory,
    config: {
      dataDir: ":memory:",
      access: accessConfig({ admins: new Set(admins) }),
    },
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
  });
  return { app, directory, lines };
}

function tokenFor(email: string): string {
  return signToken({ key: KEY, nowSec: Math.floor(NOW.getTime() / 1000), claims: { email } });
}

async function send(target: App, email: string, method: "GET" | "POST", url: string) {
  return await target.server.inject({
    method,
    url,
    headers: { [HEADER]: tokenFor(email) },
    ...(method === "POST" ? { payload: {} } : {}),
  });
}

async function me(target: App, email: string) {
  return await send(target, email, "GET", ROUTES.me);
}

const BOOKS_ROUTES = Object.entries(VERBS).filter(([name]) => name !== "health");

describe("a member", () => {
  test("gets their person and household on the request", async () => {
    const { app: target } = await start();

    const response = await me(target, SAM);

    expect(response.statusCode).toBe(200);
    expect(response.json<MeResponse>()).toEqual({
      person: { id: "sam", email: SAM, household: HOUSEHOLD },
      admin: false,
    });
  });

  test("who is also an admin is told so, and still reads their books", async () => {
    const { app: target } = await start(memberDirectory(), [ALEX]);

    const response = await me(target, ALEX);

    expect(response.json<MeResponse>()).toEqual({
      person: { id: "alex", email: ALEX, household: HOUSEHOLD },
      admin: true,
    });
    expect((await send(target, ALEX, "GET", ROUTES.people)).statusCode).toBe(200);
  });

  test("added while the app runs is let in on the next request, and enrolled into the books", async () => {
    const directory = memberDirectory([[ALEX, "alex"]]);
    const { app: target } = await start(directory);
    expect((await me(target, SAM)).statusCode).toBe(403);
    expect((await send(target, ALEX, "GET", ROUTES.people)).json<PeopleResponse>()).toEqual({
      people: ["alex"],
    });

    directory.addMember({ household: HOUSEHOLD, address: SAM, person: "sam", ...CHANGE });

    expect((await me(target, SAM)).json<MeResponse>().person.id).toBe("sam");
    // The first request anyone in the household makes enrols the new name:
    // the salaries screen asks for every person, before the new one signs in.
    expect((await send(target, ALEX, "GET", ROUTES.people)).json<PeopleResponse>()).toEqual({
      people: ["alex", "sam"],
    });
  });
});

describe("an admin in no household", () => {
  test("is identified, and refused by /api/me as by every books route", async () => {
    const { app: target } = await start();

    for (const [name, [method, url]] of BOOKS_ROUTES) {
      const response = await send(target, ADMIN, method, url);
      expect(response.statusCode, name).toBe(403);
      expect(response.json<ErrorResponse>().error.code, name).toBe("FORBIDDEN");
    }
    expect(BOOKS_ROUTES.length).toBeGreaterThan(30);
  });

  test("is identified as an admin with no person, which is what lg-22's adminOf will read", async () => {
    const directory = memberDirectory();
    const verifier = createIdentityVerifier({
      config: accessConfig(),
      directory,
      fetch: jwksFetch(() => [KEY]).fetch,
      now: () => NOW,
      logger: createLogger({ level: "silent" }),
    });

    await expect(verifier.identify(tokenFor(ADMIN))).resolves.toEqual({
      email: ADMIN,
      admin: true,
      person: null,
    });
    await expect(verifier.identify(tokenFor(SAM))).resolves.toEqual({
      email: SAM,
      admin: false,
      person: { id: "sam", email: SAM, household: HOUSEHOLD },
    });
    directory.close();
  });
});

describe("an address that is neither a member nor an admin", () => {
  test("is refused at the hook, and the operator's log names it at info", async () => {
    const { app: target, lines } = await start();

    const response = await me(target, STRANGER);

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorResponse>().error.code).toBe("FORBIDDEN");
    expect(response.body).not.toContain(STRANGER);
    const named = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line["msg"] === "access identity is in no household");
    expect(named).toMatchObject({ level: "info", email: STRANGER });
  });

  test("once removed, is refused on the next request, without a restart", async () => {
    const { app: target, directory } = await start();
    expect((await me(target, SAM)).statusCode).toBe(200);

    directory.removeMember({ address: SAM, ...CHANGE });

    const after = await me(target, SAM);
    expect(after.statusCode).toBe(403);
    expect(after.json<ErrorResponse>().error.code).toBe("FORBIDDEN");
    // The other member is untouched.
    expect((await me(target, ALEX)).statusCode).toBe(200);
  });

  test("an admin removed from LEDGER_ADMINS with no household is the same stranger", async () => {
    const { app: target } = await start(memberDirectory(), []);

    expect((await me(target, ADMIN)).json<ErrorResponse>().error.code).toBe("FORBIDDEN");
  });
});
