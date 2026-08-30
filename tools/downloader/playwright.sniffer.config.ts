/**
 * End-to-end configuration for the one journey the fast suite cannot run: an
 * MSE page whose `<video>` carries a `blob:` URL, found by the browser sniffer,
 * downloaded, and handed to a user as a file (dl-16).
 *
 * **Why a second config file and not a second project in the first one.**
 * `webServer` is config-level, and — measured on Playwright 1.62.1 — *every*
 * `webServer` entry is started even when a single `--project` is selected. So
 * "one config, two projects, two servers" would make `npm run e2e:downloader`
 * boot this Chromium-enabled API, rebuild the UI a second time and hold a
 * second port, for a suite it is not going to run. The third shape — one
 * server with the sniffer enabled for both suites — is worse still: the
 * sniffer is priority 50 and the direct tier 90, so every probe in the fast
 * suite would go through a browser. A second file is the only one of the three
 * that leaves the fast suite's runtime alone, which is dl-16's own acceptance
 * criterion.
 *
 * Everything that is not deliberately different is imported from
 * `playwright.config.ts` rather than restated, so the two cannot drift.
 *
 * Run: `npm run e2e:downloader:sniffer`.
 */

import path from "node:path";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { apiServer, root, serverEnv, shared } from "./playwright.config.ts";

/** Its own port: the two suites must be able to run back to back, or at once. */
const PORT = Number(process.env["E2E_SNIFFER_PORT"] ?? 8098);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  ...shared,
  testDir: path.join(root, "e2e/sniffer"),
  outputDir: path.join(root, "e2e/.artifacts/sniffer-results"),

  use: {
    baseURL: BASE_URL,
    // A sniffer failure is the case where the trace is the whole diagnosis:
    // the probe is 10-20 seconds of a headless browser inside the API, and the
    // only thing this side of it can see is that no variants came back.
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    ...apiServer,
    url: `${BASE_URL}/api/health`,
    env: serverEnv({
      port: PORT,
      storageDir: path.join(root, "e2e/.artifacts/sniffer-storage"),
      tiers: {
        // The whole point of this config.
        ENABLE_BROWSER_RESOLVER: "true",
        // Off, and not incidentally. M2's acceptance criterion is that the
        // sniffer carries the product on its own — yt-dlp is a latency
        // optimisation layered over it. A run that let the extractor answer
        // first would be testing the optimisation and reporting the
        // foundation.
        ENABLE_YTDLP_RESOLVER: "false",
        // Left on so the chain is the real one. The direct tier is priority 90
        // and cannot do anything with an HTML page anyway, which is exactly
        // what makes a pass here attributable to the sniffer: disable the
        // sniffer and this suite goes red rather than falling through.
        ENABLE_DIRECT_RESOLVER: "true",
        // The API launches a browser while Playwright is already running one,
        // on the same machine. One context at a time, ~300 MB, is enough for a
        // single-spec suite and keeps a CI runner from swapping.
        MAX_CONCURRENT_BROWSERS: "1",
      },
    }),
  },
});
