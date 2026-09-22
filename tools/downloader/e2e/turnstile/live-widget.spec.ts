/**
 * dl-50, in a real browser against Cloudflare's real Turnstile: one analysis
 * makes both checked calls — the probe, then the job — each with a token the
 * widget produced for it, and neither is refused.
 *
 * Runs only under `playwright.turnstile.config.ts`, which starts the API with
 * Cloudflare's always-pass test keys; see that file for why it is opt-in. The
 * test site key's widget always hands out the same documented dummy token, so
 * "a fresh token each time" cannot be read off the token's value here. What
 * proves it is that the job is accepted at all: the page awaits a new widget
 * callback for every checked request (`web/src/lib/human-check.ts`), so a job
 * request cannot be sent until the widget has been reset and has answered a
 * second time. `web/test/human-check.test.ts` pins the reset itself.
 */

import { expect, test } from "@playwright/test";
import type { Request } from "@playwright/test";
import { collectCspViolations, cspViolationsOn } from "../csp-violations.ts";
import { startHlsOrigin } from "../fixtures/hls-origin.ts";
import type { HlsOrigin } from "../fixtures/hls-origin.ts";

let hls: HlsOrigin;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
});

test.afterAll(async () => {
  await hls.close();
});

function tokenOf(request: Request): unknown {
  return (request.postDataJSON() as { humanCheckToken?: unknown } | null)?.humanCheckToken;
}

test("one analysis passes the real widget twice, under the real policy", async ({ page }) => {
  await collectCspViolations(page);
  const cloudflare: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "challenges.cloudflare.com") {
      cloudflare.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByLabel("Page address").fill(hls.masterUrl);

  const probeRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/probe",
  );
  await page.getByRole("button", { name: "Analyse" }).click();
  const probe = await probeRequest;
  const probeResponse = await probe.response();

  expect(probeResponse?.status()).toBe(200);
  expect(typeof tokenOf(probe)).toBe("string");
  await expect(page.getByRole("table")).toBeVisible();

  const jobRequest = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/jobs",
  );
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const job = await jobRequest;
  const jobResponse = await job.response();

  expect(jobResponse?.status()).toBe(201);
  expect(typeof tokenOf(job)).toBe("string");

  // The widget really came from Cloudflare — its script, then its iframe —
  // rather than the check being off and both calls passing for that reason.
  expect(cloudflare.some((url) => url.includes("/turnstile/v0/api.js"))).toBe(true);
  expect(page.frames().some((frame) => frame.url().includes("challenges.cloudflare.com"))).toBe(
    true,
  );

  // And the policy let all of it through: a widget the CSP half-blocked can
  // still produce a token, so a pass above is not enough on its own.
  expect(await cspViolationsOn(page)).toEqual([]);
});
