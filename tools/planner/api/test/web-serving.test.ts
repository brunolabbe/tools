/**
 * Serving the built UI from the API.
 *
 * The e2e suite proves a real browser gets a real page, and it costs a browser
 * download and a Vite build to say so. These are the cases that do not need
 * either: the boundary between the two things now sharing an origin. An unknown
 * `/api` path must still return a typed error rather than a page, a file in the
 * bundle must never answer where a route should have, and nothing outside the
 * bundle may be reachable at all.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROUTES } from "@planner/contract";
import { afterEach, describe, expect, test } from "vitest";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";

let app: App | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

/** A stand-in for `web/dist/app`: an index, a hashed asset, and a stray dotfile. */
async function buildBundle(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "planner-web-"));
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Planner</title>");
  await fs.writeFile(path.join(root, "assets", "main-abc123.js"), "console.log(1)");
  await fs.writeFile(path.join(root, ".env"), "MODEL_API_KEY=leaked");
  return root;
}

async function startApp(config: { webDir?: string } = {}): Promise<App> {
  app = await createApp({ config: { databasePath: ":memory:", logLevel: "silent", ...config } });
  return app;
}

const HTML = { accept: "text/html,application/xhtml+xml" };

describe("with WEB_DIR set", () => {
  async function serving(): Promise<App> {
    webDir = await buildBundle();
    return startApp({ webDir });
  }

  test("serves index.html at the root, revalidated every time", async () => {
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: "/", headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Planner</title>");
    // index.html names the current asset hashes. Cached, it pins a browser to
    // a bundle that no longer exists.
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  test("hashed assets are immutable, because a changed file is a changed URL", async () => {
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: "/assets/main-abc123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  test("an unknown path a browser asked for falls back to the SPA", async () => {
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: "/trips/some-id", headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Planner</title>");
  });

  test("an unknown /api path still answers with a typed error, not a page", async () => {
    // The fallback answering here is how a client ends up parsing
    // `<!doctype html>` as an `IntakeState`.
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: "/api/nope", headers: HTML });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "CONVERSATION_NOT_FOUND" } });
  });

  test("a fetch for JSON gets the error too, whatever the path", async () => {
    const { server } = await serving();
    const response = await server.inject({
      method: "GET",
      url: "/not-a-page",
      headers: { accept: "application/json" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "CONVERSATION_NOT_FOUND" } });
  });

  test("the API still answers on its own paths", async () => {
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: ROUTES.health });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  test("dotfiles that got swept into the bundle are not fetchable", async () => {
    const { server } = await serving();
    const response = await server.inject({ method: "GET", url: "/.env" });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("leaked");
  });

  test("a traversal out of the bundle is refused", async () => {
    const { server } = await serving();
    for (const url of ["/../package.json", "/assets/../../package.json", "/%2e%2e/package.json"]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await server.inject({ method: "GET", url });
      expect(response.statusCode, url).not.toBe(200);
    }
  });
});

describe("without WEB_DIR", () => {
  test("nothing is served and unknown paths stay typed 404s", async () => {
    const { server } = await startApp();
    const response = await server.inject({ method: "GET", url: "/", headers: HTML });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "CONVERSATION_NOT_FOUND" } });
  });

  test("a WEB_DIR with no index.html is refused at boot rather than 404ing per request", async () => {
    webDir = await fs.mkdtemp(path.join(os.tmpdir(), "planner-web-empty-"));
    const { server } = await startApp({ webDir });

    const response = await server.inject({ method: "GET", url: "/", headers: HTML });
    expect(response.statusCode).toBe(404);
  });
});
