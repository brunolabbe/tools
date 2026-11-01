/**
 * lg-72: the terms page says the theme cookie, `webtools-theme`, goes to the
 * ledger with every request and the ledger's server does not read it or write it
 * to its log. This holds the second half: a cookie sent through every door a
 * browser can use reaches no log line.
 *
 * The shape of repo-131's downloader case. Something is asserted to have been
 * logged first, so an empty log is not what passes.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { ROUTES } from "@ledger/contract";
import { createLogger } from "../src/logger.ts";
import type { App } from "../src/server.ts";
import { createApp } from "../src/server.ts";
import { ALEX, accessConfig, memberDirectory } from "./helpers/access.ts";

let app: App | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await app?.shutdown();
  app = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

const PUBLIC = new URL("../../web/public/", import.meta.url);
const COOKIE = "webtools-theme=dark";

test("the page says the cookie is not written to a log, and the page itself names it", async () => {
  const text = (await fs.readFile(new URL("terms.html", PUBLIC), "utf8")).replace(/\s+/gu, " ");

  expect(text).toContain("webtools-theme");
  expect(text).toContain("does not write it to its log");
});

test("the theme cookie reaches no log line, through the page, the API, a refusal or a miss", async () => {
  const lines: string[] = [];
  webDir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-cookie-"));
  await fs.writeFile(path.join(webDir, "index.html"), "<!doctype html><title>Ledger</title>");
  await fs.copyFile(new URL("terms.html", PUBLIC), path.join(webDir, "terms.html"));
  app = await createApp({
    directory: memberDirectory(),
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    config: { dataDir: ":memory:", webDir, access: accessConfig({ devIdentity: ALEX }) },
  });

  const headers = { cookie: COOKIE, accept: "text/html" };
  for (const url of ["/", "/terms.html", ROUTES.health, ROUTES.me, "/api/no-such-route"]) {
    // oxlint-disable-next-line no-await-in-loop -- one app, asked in turn.
    await app.server.inject({ method: "GET", url, headers });
  }
  // A request the API refuses, which logs `request rejected`.
  await app.server.inject({
    method: "POST",
    url: ROUTES.statements,
    headers: { cookie: COOKIE },
    payload: { not: "a statement" },
  });

  expect(lines.some((line) => line.includes('"msg":"request rejected"'))).toBe(true);
  expect(lines.filter((line) => line.includes("webtools-theme"))).toEqual([]);
  expect(lines.filter((line) => line.includes("dark"))).toEqual([]);
});

test("the theme cookie reaches no log line when the token is missing and the request is refused", async () => {
  const lines: string[] = [];
  app = await createApp({
    directory: memberDirectory(),
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    config: { dataDir: ":memory:", access: accessConfig() },
  });

  const response = await app.server.inject({
    method: "GET",
    url: ROUTES.me,
    headers: { cookie: COOKIE },
  });

  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(lines.some((line) => line.includes('"msg":"access token refused"'))).toBe(true);
  expect(lines.filter((line) => line.includes("webtools-theme"))).toEqual([]);
});

test("the theme cookie reaches no log line when the person is rate limited", async () => {
  const lines: string[] = [];
  app = await createApp({
    directory: memberDirectory(),
    logger: createLogger({ level: "debug", write: (line) => void lines.push(line) }),
    config: {
      dataDir: ":memory:",
      access: accessConfig({ devIdentity: ALEX }),
      rateLimitReadsPerMinute: 1,
    },
  });

  // The first read spends the bucket; the second is refused by the limiter.
  const first = await app.server.inject({
    method: "GET",
    url: ROUTES.rows,
    headers: { cookie: COOKIE },
  });
  const second = await app.server.inject({
    method: "GET",
    url: ROUTES.rows,
    headers: { cookie: COOKIE },
  });

  expect(first.statusCode).toBeLessThan(400);
  expect(second.statusCode).toBe(429);
  expect(lines.some((line) => line.includes('"msg":"rate limited"'))).toBe(true);
  expect(lines.filter((line) => line.includes("webtools-theme"))).toEqual([]);
  expect(lines.filter((line) => line.includes("dark"))).toEqual([]);
});
