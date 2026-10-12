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
