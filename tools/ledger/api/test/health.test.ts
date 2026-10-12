import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, ROUTES } from "@ledger/contract";
import type { ErrorResponse, HealthResponse } from "@ledger/contract";
import { householdBooksPath } from "../src/books.ts";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import { ALEX, HOUSEHOLD, memberDirectory } from "./helpers/access.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** In-memory database, silent logs: no file to clean up, no noise in the run. */
async function startApp(): Promise<App> {
  app = await createApp({ config: { dataDir: ":memory:", logLevel: "silent" } });
  return app;
}

describe("GET /api/health", () => {
  test("reports ready with the database and the directory open", async () => {
    const { server } = await startApp();

    const response = await server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.ok).toBe(true);
    expect(body.shuttingDown).toBe(false);
    expect(body.database).toEqual({ open: true });
    expect(body.directory).toEqual({ open: true });
  });

  test("never says where the database or the directory is", async () => {
    // The tool will hold a household's bank history, and health is the one
    // route every probe and every curl reaches. Real files — the books and,
    // beside them by default, the household directory (lg-20) — so there are
    // paths that could leak: `:memory:` would pass whatever the route said.
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-health-"));
    try {
      app = await createApp({
        directory: memberDirectory([[ALEX, "alex"]], path.join(dir, "directory.db")),
        config: { dataDir: dir, logLevel: "silent" },
      });

      expect(app.config.directoryPath).toBe(path.join(dir, "directory.db"));

      const response = await app.server.inject({ method: "GET", url: ROUTES.health });
      const text = response.body;
      expect(response.json<HealthResponse>().directory).toEqual({ open: true });
      expect(response.json<HealthResponse>().database).toEqual({ open: true });
      // The household's books are a file of their own since lg-21.
      expect(existsSync(householdBooksPath(dir, HOUSEHOLD))).toBe(true);
      expect(text).not.toContain(dir);
      expect(text).not.toContain("directory.db");
      expect(text).not.toContain("households");
      expect(text).not.toContain(HOUSEHOLD);
    } finally {
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports the version from its own manifest", async () => {
    const { server } = await startApp();

    const body = (
      await server.inject({ method: "GET", url: ROUTES.health })
    ).json<HealthResponse>();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/u);
  });

  test("answers an unknown API path with core's typed NOT_FOUND", async () => {
    const { server } = await startApp();

    const response = await server.inject({ method: "GET", url: "/api/nothing-here" });
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorResponse>().error).toMatchObject({
      code: "NOT_FOUND",
      message: DEFAULT_ERROR_MESSAGES.NOT_FOUND,
    });
  });

  test("is not ok when the household directory is closed (lg-20)", async () => {
    const target = await startApp();
    target.context.directory.close();

    const response = await target.server.inject({ method: "GET", url: ROUTES.health });

    expect(response.statusCode).toBe(503);
    const body = response.json<HealthResponse>();
    expect(body.ok).toBe(false);
    expect(body.database).toEqual({ open: true });
    expect(body.directory).toEqual({ open: false });
  });
});

/** What the body names that it should not: a household, a file, or a field beyond the contract's. */
function named(text: string): string[] {
  const body = JSON.parse(text) as Record<string, unknown>;
  const fields = [...Object.keys(body), ...Object.keys(body["database"] as object)];
  const extra = fields.filter(
    (field) =>
      !["ok", "shuttingDown", "version", "uptimeSec", "database", "directory", "open"].includes(
        field,
      ),
  );
  const words = [HOUSEHOLD, "away", "households", ".db"].filter((word) => text.includes(word));
  return [...extra, ...words];
}

// lg-21: every household's books are a file of their own, and health answers
// for all of them at once, never naming one, counting them, or saying where.
describe("GET /api/health, with a household's books each", () => {
  const CHANGE = { by: "operator", at: new Date("2026-10-12T00:00:00Z") };

  function withAway(file?: string) {
    const directory = memberDirectory([[ALEX, "alex"]], file);
    directory.addHousehold({ id: "away", name: "Away", ...CHANGE });
    directory.addMember({ household: "away", address: "kim@away.test", person: "kim", ...CHANGE });
    return directory;
  }

  test("is ok with every household's books open, and names none of them", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-health-"));
    try {
      app = await createApp({
        directory: withAway(path.join(dir, "directory.db")),
        config: { dataDir: dir, logLevel: "silent" },
      });

      const response = await app.server.inject({ method: "GET", url: ROUTES.health });

      expect(response.statusCode).toBe(200);
      expect(response.json<HealthResponse>()).toMatchObject({
        ok: true,
        database: { open: true },
        directory: { open: true },
      });
      expect(named(response.body)).toEqual([]);
      expect(response.body).not.toContain(dir);
    } finally {
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("is not ok when any one household's books are closed, and does not say which", async () => {
    app = await createApp({
      directory: withAway(),
      config: { dataDir: ":memory:", logLevel: "silent" },
    });
    app.books.of("away").close();

    const response = await app.server.inject({ method: "GET", url: ROUTES.health });

    expect(response.statusCode).toBe(503);
    const body = response.json<HealthResponse>();
    expect(body.ok).toBe(false);
    expect(body.database).toEqual({ open: false });
    expect(body.directory).toEqual({ open: true });
    expect(named(response.body)).toEqual([]);
  });

  test("opens the books of a household added since boot, so it answers for that one too", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-health-"));
    try {
      const directory = memberDirectory([[ALEX, "alex"]], path.join(dir, "directory.db"));
      app = await createApp({ directory, config: { dataDir: dir, logLevel: "silent" } });
      directory.addHousehold({ id: "away", name: "Away", ...CHANGE });
      expect(existsSync(householdBooksPath(dir, "away"))).toBe(false);

      const response = await app.server.inject({ method: "GET", url: ROUTES.health });

      expect(response.json<HealthResponse>().database).toEqual({ open: true });
      expect(existsSync(householdBooksPath(dir, "away"))).toBe(true);
    } finally {
      await app?.shutdown();
      app = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
