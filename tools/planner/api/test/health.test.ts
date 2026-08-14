import { afterEach, describe, expect, test } from "vitest";
import { ROUTES } from "@planner/contract";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import type { HealthResponse } from "../src/routes/health.ts";

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
  test("reports ready, and names the assistant that is actually answering", async () => {
    const { server, context } = await startApp();

    const response = await server.inject({ method: "GET", url: ROUTES.health });
    expect(response.statusCode).toBe(200);

    const body = response.json<HealthResponse>();
    expect(body.ok).toBe(true);
    expect(body.shuttingDown).toBe(false);
    // The default build has no model behind it, and health must say so plainly
    // rather than let a scripted assistant pass for a real one.
    expect(body.agent).toEqual({ provider: "scripted", model: "scripted" });
    expect(body.database).toEqual({ path: ":memory:", open: true });
    expect(context.chat.name).toBe("scripted");
  });

  test("releases the database on shutdown, and can be asked twice", async () => {
    const started = await startApp();
    expect(started.context.isShuttingDown()).toBe(false);

    await started.shutdown();
    app = undefined;

    // The two inputs to health's `ok`. The draining *response* is not asserted
    // here because Fastify refuses `inject` once closed — proving a 503 reaches
    // a load balancer before the sockets go needs a real socket, so it belongs
    // in e2e rather than in a fake one here.
    expect(started.context.isShuttingDown()).toBe(true);
    expect(started.context.db.open).toBe(false);

    // A SIGINT after a SIGTERM must not throw on a closed database.
    await expect(started.shutdown()).resolves.toBeUndefined();
  });

  test("answers an unknown path with the taxonomy, not a bare 404 page", async () => {
    const { server } = await startApp();

    const response = await server.inject({ method: "GET", url: "/api/nope" });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("CONVERSATION_NOT_FOUND");
  });
});
