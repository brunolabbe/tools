/**
 * End-to-end configuration for the human check against Cloudflare's **real**
 * Turnstile widget (dl-50). Opt-in: nothing runs it but
 * `npm run e2e:downloader:turnstile`, and CI does not.
 *
 * **Why it exists at all.** Everything else about dl-50 is proven without a
 * network — the API against a stubbed `siteverify`, the page against a fake
 * `window.turnstile`, the CSP against scripts a Playwright route serves. What
 * none of those can show is Cloudflare's actual `api.js` loading under this
 * policy, rendering its actual iframe, and handing the page a token the
 * actual `siteverify` accepts — twice, once for the probe and once for the
 * job. That is a Done-when line, and this is where it is measured.
 *
 * **Why opt-in rather than in the fast suite.** It reaches the internet, which
 * no suite here does; the owner chose on 2026-09-22 that live proofs are
 * committed and re-runnable but never a dependency of CI. From inside the
 * devcontainer it also needs the egress firewall opened.
 *
 * **Why its own config.** For the reason `playwright.sniffer.config.ts` gives:
 * `webServer` is config-level, and the keys below must reach only this server.
 * The keys are Cloudflare's published always-pass test pair — valid on any
 * hostname, `localhost` included, and useless for anything but testing.
 */

import path from "node:path";
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";
import { apiServer, root, serverEnv, shared } from "./playwright.config.ts";

/** Beside 8097 (sniffer), 8098 (planner) and 8099 (fast), and clear of all three. */
const PORT = Number(process.env["E2E_TURNSTILE_PORT"] ?? 8096);
const BASE_URL = `http://127.0.0.1:${String(PORT)}`;

export default defineConfig({
  ...shared,
  testDir: path.join(root, "e2e/turnstile"),
  outputDir: path.join(root, "e2e/.artifacts/turnstile-results"),

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    ...apiServer,
    url: `${BASE_URL}/api/health`,
    env: serverEnv({
      port: PORT,
      storageDir: path.join(root, "e2e/.artifacts/turnstile-storage"),
      tiers: {
        // The fast suite's tiers: this suite is about the check in front of
        // the work, not the work.
        ENABLE_BROWSER_RESOLVER: "false",
        ENABLE_YTDLP_RESOLVER: "false",
        ENABLE_DIRECT_RESOLVER: "true",
        // Literals, like every key here, so a shell cannot turn the check off
        // and leave this suite passing without it.
        TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
      },
    }),
  },
});
