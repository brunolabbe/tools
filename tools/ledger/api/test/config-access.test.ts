/**
 * The Access half of the configuration (lg-3), in a file of its own so
 * `config.test.ts` keeps its lines.
 */

import { describe, expect, test } from "vitest";
import { AppError } from "@ledger/contract";
import { loadApiConfig } from "../src/config.ts";
import { createApp } from "../src/server.ts";
import { ALEX, SAM, accessConfig } from "./helpers/access.ts";

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

const PEOPLE = `${ALEX}=alex, ${SAM}=sam`;

describe("loadApiConfig: Access", () => {
  test("defaults to no Access settings, no development identity, not production", () => {
    const config = loadApiConfig({}, {});

    expect(config.production).toBe(false);
    expect(config.access.team).toBeUndefined();
    expect(config.access.audience).toBeUndefined();
    expect(config.access.people.size).toBe(0);
    expect(config.access.devIdentity).toBeUndefined();
  });

  test("reads the team, the audience and the people", () => {
    const { access } = loadApiConfig(
      {},
      {
        ACCESS_TEAM: "Household-Test",
        ACCESS_AUD: "an-aud-tag",
        ACCESS_PEOPLE: `Alex@Example.TEST=alex , ${SAM}=sam`,
      },
    );

    expect(access.team).toBe("household-test");
    expect(access.audience).toBe("an-aud-tag");
    expect([...access.people]).toEqual([
      [ALEX, "alex"],
      [SAM, "sam"],
    ]);
  });

  test("the development identity cannot be enabled in production mode", () => {
    const env = { DEV_IDENTITY: ALEX, ACCESS_PEOPLE: PEOPLE };

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
        config: {
          databasePath: ":memory:",
          logLevel: "silent",
          production: true,
          access: accessConfig({ devIdentity: ALEX }),
        },
      }),
    ).rejects.toThrow(/DEV_IDENTITY/u);
  });

  test("refuses a development identity the people map does not know", () => {
    expect(refusal({ DEV_IDENTITY: "nobody@example.test", ACCESS_PEOPLE: PEOPLE })).toMatch(
      /not an address in ACCESS_PEOPLE/u,
    );
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

  test("refuses a malformed people entry without echoing the address", () => {
    const message = refusal({ ACCESS_PEOPLE: `${ALEX}=alex, sam-without-a-person` });
    expect(message).toMatch(/entry 2/u);
    expect(message).not.toContain("sam");
    expect(message).not.toContain(ALEX);

    expect(refusal({ ACCESS_PEOPLE: `${ALEX}=alex, ${ALEX.toUpperCase()}=other` })).toMatch(
      /twice/u,
    );
  });
});
