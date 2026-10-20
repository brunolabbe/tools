/**
 * Two households and an admin, behind real tokens, for the suites that manage
 * the directory from the app (lg-22): home holds alex and sam, away holds kim,
 * and `ADMIN` is in neither.
 */

import type { LightMyRequestResponse } from "fastify";
import type Database from "better-sqlite3";
import type { Directory } from "../../src/directory.ts";
import { createLogger } from "../../src/logger.ts";
import { createApp } from "../../src/server.ts";
import type { App } from "../../src/server.ts";
import {
  ADMIN,
  HOUSEHOLD,
  accessConfig,
  jwksFetch,
  memberDirectory,
  signToken,
  testKey,
} from "./access.ts";

export const KIM = "kim@away.test";
export const AWAY = "away";

const KEY = testKey("key-1");
export const NOW = new Date("2026-10-13T12:00:00Z");

export function twoHouseholds(): Directory {
  const directory = memberDirectory();
  const change = { by: "operator", at: new Date("2026-10-01T00:00:00Z") };
  directory.addHousehold({ id: AWAY, name: "The other household", ...change });
  directory.addMember({ household: AWAY, address: KIM, person: "kim", ...change });
  return directory;
}

export interface Harness {
  app: App;
  directory: Directory;
}

export async function startHouseholds(
  directory: Directory = twoHouseholds(),
  admins: readonly string[] = [ADMIN],
): Promise<Harness> {
  const app = await createApp({
    directory,
    config: {
      dataDir: ":memory:",
      access: accessConfig({ admins: new Set(admins) }),
      rateLimitReadsPerMinute: 0,
      rateLimitWritesPerMinute: 0,
    },
    logger: createLogger({ level: "silent" }),
    now: () => NOW,
    fetch: jwksFetch(() => [KEY]).fetch,
  });
  return { app, directory };
}

export type Method = "GET" | "HEAD" | "POST";

/**
 * One request as `email`. A `POST` sends `payload`, `{}` by default; a string
 * is sent as it is, as JSON, on any method, so a body that does not parse can be
 * sent too (lg-22's gate 1, F1).
 */
export async function send(
  app: App,
  email: string,
  method: Method,
  url: string,
  payload?: Record<string, unknown> | string,
): Promise<LightMyRequestResponse> {
  const token = signToken({
    key: KEY,
    nowSec: Math.floor(NOW.getTime() / 1000),
    claims: { email },
  });
  if (typeof payload === "string") {
    return await app.server.inject({
      method,
      url,
      headers: { "cf-access-jwt-assertion": token, "content-type": "application/json" },
      payload,
    });
  }
  return await app.server.inject({
    method,
    url,
    headers: { "cf-access-jwt-assertion": token },
    ...(method === "POST" ? { payload: payload ?? {} } : {}),
  });
}

/** Everything the directory holds, every record of every household, to compare before and after. */
export function directorySnapshot(directory: Directory): string {
  return JSON.stringify(
    directory.households().map((household) => ({
      ...household,
      history: directory.history(household.id),
      // lg-35: retirements are no line of the history, so they are read here too.
      retirements: directory.retirements(household.id),
      standings: [...directory.standings(household.id)],
    })),
  );
}

/** Every table of one household's books, with its rows. */
function tablesOf(db: Database.Database): [string, unknown[]][] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]);
}

/** Every table of every household's books, row by row, to compare before and after. */
export function booksSnapshot(app: App, households: readonly string[] = [HOUSEHOLD, AWAY]): string {
  return JSON.stringify(households.map((household) => tablesOf(app.books.of(household))));
}
