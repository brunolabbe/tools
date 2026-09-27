import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, ROUTES } from "@ledger/contract";
import type { ErrorResponse, HealthResponse } from "@ledger/contract";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";

let app: App | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
});

/** In-memory database, silent logs: no file to clean up, no noise in the run. */
async function startApp(): Promise<App> {
  app = await createApp({ config: { databasePath: ":memory:", logLevel: "silent" } });
  return app;
}

describe("GET /api/health", () => {
  test("reports ready with the database open", async () => {
    const { server } = await startApp();

    const response = await server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.ok).toBe(true);
    expect(body.shuttingDown).toBe(false);
    expect(body.database).toEqual({ open: true });
  });

  test("never says where the database is", async () => {
    // The tool will hold a household's bank history, and health is the one
    // route every probe and every curl reaches. A real file, so there is a
    // path that could leak — `:memory:` would pass whatever the route said.
    const dir = mkdtempSync(path.join(os.tmpdir(), "ledger-health-"));
    try {
      const databasePath = path.join(dir, "ledger.db");
      app = await createApp({ config: { databasePath, logLevel: "silent" } });

      const text = (await app.server.inject({ method: "GET", url: ROUTES.health })).body;
      expect(text).not.toContain(dir);
      expect(text).not.toContain("ledger.db");
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
});
