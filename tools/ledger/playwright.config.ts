/**
 * End-to-end configuration: a real browser, driving the real UI, against a real
 * API, over a real database.
 *
 * It serves the bundle from the API rather than from Vite's dev server, because
 * that is the thing that ships: `WEB_DIR` is what the container sets. The
 * planner's config is where the reasoning for each choice below was worked out,
 * and this is its twin.
 *
 * There is no spec yet — see `e2e/README.md` for what earns the first one.
 *
 * Run: `npm run e2e:ledger` (add `npm run e2e:install` once, for the browser).
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/** This tool's directory — `tools/ledger`. */
const root = fileURLToPath(new URL(".", import.meta.url));
/** The workspace root, where the npm scripts live. */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const artifacts = path.join(root, "e2e/.artifacts");
const storage = path.join(artifacts, "storage");

/**
 * Not 8100, which is where a dev API very often already is, and not 8098 or
 * 8099, which are the planner's and the downloader's e2e ports — every suite
 * should be runnable at once.
 */
const PORT = Number(process.env["E2E_PORT"] ?? 8108);
export const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const isCI = process.env["CI"] !== undefined;

/**
 * A run starts from an empty database — never the developer's
 * `storage/ledger/ledger.db`, which a suite would write into and inherit from.
 * Removed rather than given a unique name so nothing accumulates across runs.
 */
fs.rmSync(storage, { recursive: true, force: true });

export default defineConfig({
  testDir: path.join(root, "e2e"),
  // `.spec.ts` here, `.test.ts` under vitest: neither runner can pick up the
  // other's files by accident.
  testMatch: "**/*.spec.ts",
  outputDir: path.join(artifacts, "results"),

  timeout: 60_000,
  expect: { timeout: 15_000 },

  // Serial: every spec drives one API over one database.
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

  // A phone rather than a desktop: the UI is mobile-first, and a layout that
  // only works wide is the regression this would otherwise never see. Pixel
  // rather than iPhone because it runs on Chromium, the one browser installed.
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],

  webServer: {
    // Builds the UI first: this serves a bundle off disk, so a stale one would
    // be a suite testing the last change rather than this one.
    command: "npm run e2e:ledger:serve",
    // The scripts live in the workspace root's package.json, not this tool's.
    cwd: repoRoot,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    // Every key here wins over the shell — Playwright spreads a config's `env`
    // last. See the planner's config for the measurement.
    env: {
      HOST: "127.0.0.1",
      PORT: String(PORT),
      WEB_DIR: path.join(root, "web/dist/app"),
      DATABASE_PATH: path.join(storage, "e2e.db"),
      LOG_LEVEL: "warn",
    },
  },
});
