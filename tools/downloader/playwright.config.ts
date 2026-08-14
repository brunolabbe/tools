/**
 * End-to-end configuration: a real browser, driving the real UI, against a
 * real API, downloading a real file.
 *
 * These are the only tests in the repo that run the whole stack in one piece.
 * Everything below them — routes, orchestrator, engine, resolvers — has unit
 * coverage against fixtures; what nothing else can prove is that the pieces
 * are wired to each other, that SSE reaches the browser, and that the link at
 * the end returns bytes. So this suite stays small and stays honest, and it
 * still talks to no third-party site: the stream comes from a local origin
 * that generates it with ffmpeg. See `e2e/fixtures/hls-origin.ts`.
 *
 * Run: `npm run e2e` (add `npm run e2e:install` once, for the browser).
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

/** This tool's directory — `tools/downloader`. */
const root = fileURLToPath(new URL(".", import.meta.url));
/** The workspace root, where the npm scripts live. */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Not 8080: a dev API is very often already sitting there. */
const PORT = Number(process.env["E2E_PORT"] ?? 8099);
export const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

const isCI = process.env["CI"] !== undefined;

export default defineConfig({
  testDir: path.join(root, "e2e"),
  // `.spec.ts` here, `.test.ts` under vitest: neither runner can pick up the
  // other's files by accident.
  testMatch: "**/*.spec.ts",
  outputDir: path.join(root, "e2e/.artifacts/results"),

  // ffmpeg has to segment a clip and then download it. Generous, because a
  // slow shared CI runner failing on a timeout teaches nobody anything.
  timeout: 180_000,
  expect: { timeout: 30_000 },

  // Serial. The suite drives one API with one job queue and one storage dir;
  // parallel workers would be contending for worker slots and reading each
  // other's downloads.
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
    // Builds the UI first: the bundle bakes in its transport at build time
    // (`VITE_API_MOCK`), so testing a stale one would be testing the mock.
    command: "npm run e2e:serve",
    // The scripts live in the workspace root's package.json, not this tool's.
    cwd: repoRoot,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      HOST: "127.0.0.1",
      PORT: String(PORT),
      // Same origin for UI and API, exactly as the container serves it.
      WEB_DIR: path.join(root, "web/dist/app"),
      STORAGE_DIR: path.join(root, "e2e/.artifacts/storage"),
      DATABASE_PATH: path.join(root, "e2e/.artifacts/storage/e2e.db"),

      // The direct tier alone. The browser sniffer and yt-dlp have their own
      // tests against their own fixtures; dragging Chromium and a network
      // extractor into a UI test would make it slow and flaky without telling
      // us anything the resolver suites do not.
      ENABLE_BROWSER_RESOLVER: "false",
      ENABLE_YTDLP_RESOLVER: "false",
      ENABLE_DIRECT_RESOLVER: "true",

      // The one place this is ever set. The fixture origin is on loopback,
      // which the guard blocks by design — that is the whole point of it — so
      // the test has to open the door explicitly rather than the guard being
      // lax by default.
      SSRF_ALLOW_HOSTS: "127.0.0.1",

      // A test that probes and downloads several times in a minute is exactly
      // the traffic the limiter exists to refuse. `rate-limit.test.ts` covers
      // the limiter itself.
      RATE_LIMIT_PROBE_PER_MINUTE: "0",
      RATE_LIMIT_JOBS_PER_MINUTE: "0",

      // Nothing should be swept mid-run, and nothing should outlive the run.
      FILE_RETENTION_HOURS: "1",
      LOG_LEVEL: "warn",
    },
  },
});
