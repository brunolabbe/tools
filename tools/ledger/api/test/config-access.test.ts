/**
 * The Access half of the configuration (lg-3), and the admins and the retired
 * `ACCESS_PEOPLE` (lg-20), in a file of its own so `config.test.ts` keeps its
 * lines.
 */

import path from "node:path";
import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { loadApiConfig } from "../src/config.ts";
import { createApp } from "../src/server.ts";
import type { App } from "../src/server.ts";
import { ADMIN, ALEX, SAM, accessConfig, memberDirectory } from "./helpers/access.ts";

/** The message a refused configuration throws, or `undefined` when it loads. */
function refusal(env: NodeJS.ProcessEnv): string | undefined {
  try {
    loadApiConfig({}, env);
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).message;
  }
}

/** An app whose development identity is `devIdentity`, over alex and sam's household. */
async function start(devIdentity: string): Promise<App> {
  return await createApp({
    directory: memberDirectory(),
    config: {
      dataDir: ":memory:",
      logLevel: "silent",
      access: accessConfig({ devIdentity }),
    },
  });
}

describe("loadApiConfig: Access", () => {
  test("defaults to no Access settings, no development identity, not production", () => {
    const config = loadApiConfig({}, {});

    expect(config.production).toBe(false);
    expect(config.access.team).toBeUndefined();
    expect(config.access.audience).toBeUndefined();
    expect(config.access.admins.size).toBe(0);
    expect(config.access.devIdentity).toBeUndefined();
  });

  test("reads the team, the audience and the admins", () => {
    const { access } = loadApiConfig(
      {},
      {
        ACCESS_TEAM: "Household-Test",
        ACCESS_AUD: "an-aud-tag",
        LEDGER_ADMINS: ` Admin@Example.TEST , ${SAM}`,
      },
    );

    expect(access.team).toBe("household-test");
    expect(access.audience).toBe("an-aud-tag");
    expect([...access.admins]).toEqual([ADMIN, SAM]);
  });

  test("the development identity cannot be enabled in production mode", () => {
    const env = { DEV_IDENTITY: ALEX };

    expect(refusal(env)).toBeUndefined();
    expect(refusal({ ...env, NODE_ENV: "production" })).toMatch(/DEV_IDENTITY.*production/u);
    // Through the overrides too, which is how a test or an embedder would try.
    expect(() =>
      loadApiConfig({ production: true, access: accessConfig({ devIdentity: ALEX }) }, {}),
    ).toThrow(/production/u);
  });

  test("and the app built from that configuration refuses to start", async () => {
    // What `main.ts` calls, and what the image runs: the refusal is a failed
    // boot, not a warning in a log nobody reads.
    await expect(
      createApp({
        directory: memberDirectory(),
        config: {
          dataDir: ":memory:",
          logLevel: "silent",
          production: true,
          access: accessConfig({ devIdentity: ALEX }),
        },
      }),
    ).rejects.toThrow(/DEV_IDENTITY/u);
  });

  test("refuses to start with a development identity the directory has no member for", async () => {
    await expect(start("nobody@example.test")).rejects.toThrow(
      /DEV_IDENTITY is not a member of any household/u,
    );
    // An admin is not a member either: development is someone's books.
    await expect(start(ADMIN)).rejects.toThrow(/DEV_IDENTITY/u);
    const app = await start(SAM);
    await app.shutdown();
  });

  test("refuses half an Access configuration", () => {
    expect(refusal({ ACCESS_TEAM: "household-test" })).toMatch(/together/u);
    expect(refusal({ ACCESS_AUD: "an-aud-tag" })).toMatch(/together/u);
  });

  test("refuses a team name that would steer the key set's host", () => {
    for (const team of [
      "evil.example.com/x",
      "team.cloudflareaccess.com",
      "user@host",
      "-team",
      "a/b",
    ]) {
      expect(refusal({ ACCESS_TEAM: team, ACCESS_AUD: "aud" }), team).toMatch(/team name alone/u);
    }
  });

  test("refuses an admin entry that is not an address, without echoing it", () => {
    const message = refusal({ LEDGER_ADMINS: `${ALEX}, sam-without-a-domain` });
    expect(message).toMatch(/LEDGER_ADMINS entry 2/u);
    expect(message).not.toContain("sam");
    expect(message).not.toContain(ALEX);
  });

  // lg-52: a NUL cannot be in a real environment value, so `loadApiConfig` is
  // called with the string; an ESC and a DEL can.
  test("refuses an admin entry with a control character, naming its position and not the entry", () => {
    expect(refusal({ LEDGER_ADMINS: `${ALEX}, ${SAM}` }), "the clean entries").toBeUndefined();
    for (const entry of ["boss@x\u0000.test", "boss@x\u001b.test", "boss\u007f@x.test"]) {
      const message = refusal({ LEDGER_ADMINS: `${ALEX}, ${entry}` });
      expect(message).toMatch(/LEDGER_ADMINS entry 2 is not an address/u);
      expect(message).not.toContain("boss");
    }
  });

  test("refuses ACCESS_PEOPLE, set to anything, so a stale .env cannot look as if it admits people", () => {
    for (const value of [`${ALEX}=alex`, ""]) {
      expect(refusal({ ACCESS_PEOPLE: value }), value).toMatch(/ACCESS_PEOPLE is retired/u);
    }
  });

  test("the directory sits in the data directory unless DIRECTORY_PATH says otherwise", () => {
    expect(loadApiConfig({}, { DATABASE_PATH: "/data" }).directoryPath).toBe(
      path.join(path.resolve("/data"), "directory.db"),
    );
    expect(
      loadApiConfig({}, { DATABASE_PATH: "/data", DIRECTORY_PATH: "/elsewhere/d.db" })
        .directoryPath,
    ).toBe("/elsewhere/d.db");
    expect(loadApiConfig({ dataDir: ":memory:" }, {}).directoryPath).toBe(":memory:");
  });
});

/** Gate 1, F2: the guard reads production mode however it is spelled. */
describe("loadApiConfig: production mode, however it is written", () => {
  test("refuses the development identity for any spelling of production", () => {
    for (const value of ["production", "Production", "PRODUCTION", " production", "production "]) {
      expect(refusal({ NODE_ENV: value, DEV_IDENTITY: ALEX }), value).toMatch(
        /DEV_IDENTITY.*production/u,
      );
    }
  });

  test("and only production: other names still allow it", () => {
    for (const value of ["development", "test", "", "productionish"]) {
      expect(refusal({ NODE_ENV: value, DEV_IDENTITY: ALEX }), value).toBe(undefined);
    }
  });
});

// lg-21, step 9 (lg-20's gate, F4): the directory and the books cannot be one
// file. The books are a directory of files now, and households/ is theirs.
describe("loadApiConfig: the directory is never one of the books", () => {
  test("refuses a DIRECTORY_PATH inside households/, however it is spelled", () => {
    for (const directory of [
      "/data/households/directory.db",
      "/data/households/home.db",
      "/data/households",
      "/data/households/../households/x.db",
      "/data/./households/deeper/d.db",
    ]) {
      expect(refusal({ DATABASE_PATH: "/data", DIRECTORY_PATH: directory }), directory).toMatch(
        /DIRECTORY_PATH is inside the households directory/u,
      );
    }
  });

  test("and allows one beside it, or a name that only starts the same", () => {
    for (const directory of [
      "/data/directory.db",
      "/data/households.db",
      "/data/householdsx/d.db",
      "/elsewhere/households/d.db",
    ]) {
      expect(refusal({ DATABASE_PATH: "/data", DIRECTORY_PATH: directory }), directory).toBe(
        undefined,
      );
    }
  });
});
