import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_ERROR_MESSAGES, ROUTES } from "@planner/contract";
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
    expect(context.model.name).toBe("scripted");
  });

  test("names the grounding provider too, and says nothing else about it", async () => {
    const { server, context } = await startApp();

    const body = (
      await server.inject({ method: "GET", url: ROUTES.health })
    ).json<HealthResponse>();

    // The default reaches nothing and answers from a checked-in table. A
    // deployment that meant to configure a real backend has to be able to see
    // that it did not.
    expect(body.grounding).toEqual({ provider: "fixtures" });
    expect(context.grounding.name).toBe("fixtures");

    // This route is unauthenticated. The name is all it may say — no key, no
    // endpoint, no host. Asserted as the whole key set rather than as an absence
    // of one field, so a later addition has to come past this test.
    expect(Object.keys(body.grounding)).toEqual(["provider"]);
    expect(JSON.stringify(body.grounding)).not.toMatch(/key|token|secret|http|endpoint|host/i);
  });

  test("names a real backend by name, and still says nothing about where it is", async () => {
    app = await createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        groundingProvider: "valhalla",
        groundingEndpoints: {
          routing: "http://valhalla.internal:8002",
          geocoder: "http://nominatim.internal:8080",
          // pl-29's third endpoint, optional though it is — asserted absent
          // from the body below on exactly the same footing as the other two.
          discovery: "http://overpass.internal:8090",
        },
      },
    });

    const body = (
      await app.server.inject({ method: "GET", url: ROUTES.health })
    ).json<HealthResponse>();

    // The whole point of pl-28: there is now something behind the seam worth
    // not advertising. This route is unauthenticated, so the answer is the
    // backend's name and nothing else — asserted on the response body, which is
    // what a stranger actually receives.
    expect(body.grounding).toEqual({ provider: "valhalla" });
    expect(Object.keys(body.grounding)).toEqual(["provider"]);
    expect(JSON.stringify(body)).not.toContain("valhalla.internal");
    expect(JSON.stringify(body)).not.toContain("nominatim.internal");
    expect(JSON.stringify(body)).not.toContain("overpass.internal");
    expect(JSON.stringify(body)).not.toContain("8002");
    expect(JSON.stringify(body)).not.toContain("8090");
  });

  test("boots on valhalla with no OVERPASS_URL at all — discovery is the optional third endpoint", async () => {
    // Unlike VALHALLA_URL and GEOCODER_URL, an unset discovery endpoint is not
    // a boot-time refusal (pl-29): a deployment can measure distances and
    // geocode without discovering anything nearby, so `nearby` degrades to an
    // empty list rather than the run never starting at all.
    app = await createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        groundingProvider: "valhalla",
        groundingEndpoints: {
          routing: "http://valhalla.internal:8002",
          geocoder: "http://nominatim.internal:8080",
          discovery: undefined,
        },
      },
    });

    const body = (
      await app.server.inject({ method: "GET", url: ROUTES.health })
    ).json<HealthResponse>();
    expect(body.grounding).toEqual({ provider: "valhalla" });
  });

  test("refuses to boot when a real backend was named and no endpoint was", async () => {
    // A service that starts here reports healthy and then fails on its first
    // run — as a named travel-time gap, which is the shape of an honest answer,
    // so nothing about it looks wrong. The mistake belongs in front of the
    // person who made it.
    const started = createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        groundingProvider: "valhalla",
        groundingEndpoints: {
          routing: undefined,
          geocoder: "http://nominatim.internal:8080",
          discovery: undefined,
        },
      },
    });

    await expect(started).rejects.toThrow(/VALHALLA_URL is not set/u);
  });

  test("refuses to boot on an endpoint that is not a URL", async () => {
    const started = createApp({
      config: {
        databasePath: ":memory:",
        logLevel: "silent",
        groundingProvider: "valhalla",
        groundingEndpoints: {
          routing: "valhalla:8002",
          geocoder: "http://nominatim:8080",
          discovery: undefined,
        },
      },
    });

    // A typo that survives to the first request arrives as `UNREACHABLE`, which
    // reads as "the instance is down" and sends an operator to the wrong
    // machine.
    await expect(started).rejects.toThrow(/VALHALLA_URL must be an http: or https: address/u);
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

    const { error } = response.json<{ error: { code: string; message: string } }>();
    // Core's code and core's copy: a missing *route*. Answering this with a
    // code about a missing document is what pl-11 retired.
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe(DEFAULT_ERROR_MESSAGES.NOT_FOUND);
  });
});
