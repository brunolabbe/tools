/**
 * End-to-end configuration: a real browser, driving the real UI, against a real
 * API, over a real database.
 *
 * The intake is tested in halves everywhere else. The API suite proves the
 * server's half through `inject()`, and the web suite (pl-12) proves the
 * browser's half against a faked client. Neither can prove the two are wired to
 * each other: that a real `fetch` round-trips an `Answer` through
 * `answerSchema`, that the discard preview a user is shown is the server's own
 * `prune` and not a second implementation in the browser, and that a reload
 * resumes — which needs `localStorage` and a real server at once, and is the
 * claim pl-7 was written for.
 *
 * It serves the bundle from the API rather than from Vite's dev server, because
 * that is the thing that ships: `WEB_DIR` is what the container sets, and until
 * pl-13 nothing read it, so the image served no UI and `/api/health` answered
 * happily anyway.
 *
 * No key and no network: the scripted provider is the default and nothing here
 * overrides it. See `tools/planner/CLAUDE.md`.
 *
 * Run: `npm run e2e:planner` (add `npm run e2e:install` once, for the browser).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/** This tool's directory — `tools/planner`. */
const root = fileURLToPath(new URL(".", import.meta.url));
/** The workspace root, where the npm scripts live. */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const artifacts = path.join(root, "e2e/.artifacts");
const storage = path.join(artifacts, "storage");

/**
 * Not 8090, which is where a dev API very often already is, and not 8099, which
 * is the downloader's e2e port — both suites should be runnable at once.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 8098);
export const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const isCI = process.env["CI"] !== undefined;

/**
 * A run starts from an empty database.
 *
 * Not the developer's `storage/planner/planner.db`: a suite that shares it
 * writes trips into someone's real list, and — worse — inherits whatever is
 * already in there, which is how a spec ends up passing on one machine only.
 * Removed rather than given a unique name so nothing accumulates across runs.
 */
fs.rmSync(storage, { recursive: true, force: true });

export default defineConfig({
  testDir: path.join(root, "e2e"),
  // `.spec.ts` here, `.test.ts` under vitest: neither runner can pick up the
  // other's files by accident.
  testMatch: "**/*.spec.ts",
  outputDir: path.join(artifacts, "results"),

  // Generous. The suite answers its way through the whole core of the tree, one
  // round trip per question, and a slow shared CI runner failing on a timeout
  // teaches nobody anything.
  timeout: 120_000,
  expect: { timeout: 15_000 },

  // Serial. Both specs drive one API over one database, and the trip list is
  // every intake this server holds — parallel workers would be reading each
  // other's trips.
  workers: 1,
  fullyParallel: false,

  // A retry masks exactly the flakiness this suite exists to catch.
  retries: 0,
  forbidOnly: isCI,

  reporter: isCI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Builds the UI first: this serves a bundle off disk, so a stale one would
    // be a suite testing the last change rather than this one.
    command: "npm run e2e:planner:serve",
    // The scripts live in the workspace root's package.json, not this tool's.
    cwd: repoRoot,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOST: "127.0.0.1",
      PORT: String(PORT),
      // Same origin for UI and API, exactly as the container serves it — and
      // the reason there is no CORS configuration anywhere in this file.
      WEB_DIR: path.join(root, "web/dist/app"),
      DATABASE_PATH: path.join(storage, "e2e.db"),
      // Named rather than left to the default, so this suite says out loud that
      // it talks to no model. A real provider here would make it slow, billed
      // and non-deterministic in one step.
      MODEL_PROVIDER: "scripted",
      LOG_LEVEL: "warn",
    },
  },
});
