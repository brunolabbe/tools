/**
 * Serving the built UI from the API.
 *
 * The interesting cases are all about the boundary between the two things now
 * sharing an origin: a deep link must reach the SPA, an unknown `/api` path
 * must still return a typed error rather than a page, and a bundle file must
 * never be able to answer where an API route should have.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { createHarness } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

let harness: Harness | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

/** A stand-in for `apps/web/dist/app`: an index, a hashed asset, and a stray dotfile. */
async function buildBundle(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-web-"));
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Downloader</title>");
  await fs.writeFile(path.join(root, "assets", "main-abc123.js"), "console.log(1)");
  await fs.writeFile(path.join(root, ".env"), "SECRET=leaked");
  return root;
}

const HTML = { accept: "text/html,application/xhtml+xml" };

describe("with WEB_DIR set", () => {
  async function serving(): Promise<Harness> {
    webDir = await buildBundle();
    harness = await createHarness({ config: { webDir } });
    return harness;
  }

  test("serves index.html at the root, revalidated every time", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: "/", headers: HTML });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Downloader</title>");
    // index.html names the current asset hashes. Cached, it pins a browser to
    // a bundle that no longer exists.
    expect(response.headers["cache-control"]).toBe("no-cache");
  });

  test("hashed assets are immutable, because a changed file is a changed URL", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: "/assets/main-abc123.js" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  test("a client-side deep link falls back to the SPA", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({
      method: "GET",
      url: "/jobs/some-id",
      headers: HTML,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("<title>Downloader</title>");
  });

  test("an unknown /api path still answers with a typed error, not a page", async () => {
    // The fallback answering here is how a client ends up parsing
    // `<!doctype html>` as a `Job`.
    const app = (await serving()).app;
    const response = await app.server.inject({
      method: "GET",
      url: "/api/nope",
      headers: HTML,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });

  test("a fetch for JSON gets the error too, whatever the path", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({
      method: "GET",
      url: "/not-a-page",
      headers: { accept: "application/json" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });

  test("the API still answers on its own paths", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: ROUTES.health });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  test("dotfiles that got swept into the bundle are not fetchable", async () => {
    const app = (await serving()).app;
    const response = await app.server.inject({ method: "GET", url: "/.env" });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("leaked");
  });

  test("a traversal out of the bundle is refused", async () => {
    const app = (await serving()).app;
    for (const url of ["/../package.json", "/assets/../../package.json", "/%2e%2e/package.json"]) {
      // oxlint-disable-next-line no-await-in-loop
      const response = await app.server.inject({ method: "GET", url });
      expect(response.statusCode, url).not.toBe(200);
    }
  });
});

describe("without WEB_DIR", () => {
  test("nothing is served and unknown paths stay typed 404s", async () => {
    harness = await createHarness();
    const response = await harness.app.server.inject({
      method: "GET",
      url: "/",
      headers: HTML,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "JOB_NOT_FOUND" } });
  });

  test("a WEB_DIR with no index.html is refused at boot rather than 404ing per request", async () => {
    webDir = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-web-empty-"));
    harness = await createHarness({ config: { webDir } });

    const response = await harness.app.server.inject({
      method: "GET",
      url: "/",
      headers: HTML,
    });
    expect(response.statusCode).toBe(404);
  });
});
