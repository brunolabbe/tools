/**
 * The Content-Security-Policy, enforced by a real browser (dl-35).
 *
 * `api/test/csp.test.ts` proves the header is on the document and off
 * everything else. It cannot prove the one thing that matters: that a browser
 * *parses* the policy and *acts* on it. A header that is malformed, or that a
 * UA rejects wholesale, is present in every one of those assertions and blocks
 * nothing — which is the specific way a CSP ships looking finished.
 *
 * So each test here is a differential rather than an assertion about a string:
 *
 *  - a cross-origin image is refused **and never leaves the browser**, proven
 *    against the fixture origin's own request log, while the same image on the
 *    same run in the same browser loads from a page carrying no policy;
 *  - an injected inline `<script>` does not execute, which is the attack
 *    `script-src 'self'` exists for;
 *  - the app's own subresources and its one CSSOM write raise no violation, so
 *    the policy is not quietly too strict;
 *  - dl-50's two foreign script origins run, and a third origin serving the
 *    same script is refused before it is fetched.
 *
 * What still is not here: a preview image rendering under this policy. That
 * needs a probe that produces one, and the only resolver that reads an
 * `og:image` is the browser tier, which this config deliberately switches off.
 * It is asserted in `sniffer/mse-page.spec.ts`, on the fixture's `og:image`.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectCspViolations, cspViolationsOn } from "./csp-violations.ts";
import { PREVIEW_PATH, PREVIEW_WIDTH, startHlsOrigin } from "./fixtures/hls-origin.ts";
import type { HlsOrigin } from "./fixtures/hls-origin.ts";

/**
 * The policy, restated rather than imported.
 *
 * `api/src/routes/web.ts` is not on this side of the wire — the point of an
 * e2e assertion is to describe what a browser received, and a constant shared
 * with the server would agree with the server about a policy neither of them
 * had sent.
 */
const EXPECTED_POLICY = [
  "default-src 'self'",
  // dl-50: the Turnstile widget, and Cloudflare Web Analytics' beacon.
  "script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

let hls: HlsOrigin;

test.beforeAll(async () => {
  hls = await startHlsOrigin();
});

test.afterAll(async () => {
  await hls.close();
});

/** Appends an `<img>`, waits for it to settle, and reports whether it decoded. */
async function loadImage(page: Page, src: string): Promise<{ naturalWidth: number }> {
  return await page.evaluate(async (url) => {
    const img = document.createElement("img");
    img.src = url;
    document.body.append(img);
    await new Promise<void>((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      // A CSP refusal fires `error` on the element as well as
      // `securitypolicyviolation` on the document.
      img.addEventListener("error", () => resolve(), { once: true });
      // A ceiling, so a request that hangs fails on the assertion below with
      // the width in the message rather than on the suite's 180 s timeout.
      setTimeout(resolve, 5_000);
    });
    return { naturalWidth: img.naturalWidth };
  }, src);
}

test("the document carries the policy, and it is enforced rather than reported", async ({
  page,
}) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toBe(EXPECTED_POLICY);
  // The suffix that turns every directive below into a console message.
  expect(headers["content-security-policy-report-only"]).toBeUndefined();
});

test("img-src blocks a foreign image that loads perfectly well without the policy", async ({
  page,
}) => {
  await collectCspViolations(page);

  // --- Under the policy ---------------------------------------------------
  await page.goto("/");
  const blocked = await loadImage(page, hls.previewUrl);

  expect(blocked.naturalWidth).toBe(0);

  const violations = await cspViolationsOn(page);
  const imgViolations = violations.filter((v) => v.effectiveDirective === "img-src");
  expect(imgViolations).toHaveLength(1);
  expect(imgViolations[0]?.blockedURI).toContain(hls.origin);

  // The strongest half, and the one a `naturalWidth` of 0 alone does not give:
  // a 404, a dead port or a typo in the fixture would read identically. The
  // fixture server logs every request it receives, and it received nothing —
  // so the refusal happened in the browser, before the socket.
  expect(hls.requests).not.toContain(PREVIEW_PATH);

  // --- The same image, the same browser, a page with no policy ------------
  // Without this the test above proves only that something went wrong. The
  // fixture's watch page is a real cross-origin document that sets no CSP.
  await page.goto(hls.watchUrl);
  const allowed = await loadImage(page, hls.previewUrl);

  expect(allowed.naturalWidth).toBe(PREVIEW_WIDTH);
  expect(hls.requests).toContain(PREVIEW_PATH);
});

test("script-src stops an injected inline script from running", async ({ page }) => {
  await collectCspViolations(page);
  await page.goto("/");

  // The XSS this policy exists for, in its simplest form: markup that reached
  // the DOM and carries script. `page.evaluate` itself runs in an isolated
  // world that CSP does not govern, so the element — not the evaluate — is
  // what is under test here.
  const ran = await page.evaluate(() => {
    const marker = "__cspInlineScriptRan";
    const script = document.createElement("script");
    script.textContent = `window.name = ${JSON.stringify(marker)};`;
    document.body.append(script);
    return window.name === marker;
  });

  expect(ran).toBe(false);

  // Keyed on `blockedURI === "inline"`, not on the directive alone. A
  // `script-src` violation with `blockedURI: "eval"` is a different event
  // entirely — zod's JIT capability probe used to raise one here, and a
  // directive-only assertion would have accepted it as proof of something it
  // says nothing about. `effectiveDirective` is then matched by prefix, because
  // Chrome reports the CSP3 name `script-src-elem` for a policy that writes
  // `script-src`.
  const violations = await cspViolationsOn(page);
  const inline = violations.filter((v) => v.blockedURI === "inline");
  expect(inline).toHaveLength(1);
  expect(inline[0]?.effectiveDirective.startsWith("script-src")).toBe(true);
});

test("the app's own page raises no violation, theme toggle included", async ({ page }) => {
  await collectCspViolations(page);
  await page.goto("/");

  // The bundle's script and stylesheet are same-origin subresources; if
  // `script-src` or `style-src` were wrong, the page would be blank or
  // unstyled and this heading would not be here.
  await expect(page.getByRole("heading", { name: /downloader/iu })).toBeVisible();

  // `lib/theme.ts` writes `root.style.colorScheme`, the only CSSOM style write
  // in the app, and it runs on mount. CSP governs the `style` *content
  // attribute* and not `CSSStyleDeclaration` — but "should not be blocked" is
  // exactly the kind of claim this ticket exists to stop taking on trust, so
  // the write is read back from the live document.
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("light dark");

  // And again down the other branch, driven from the UI. The radio itself is
  // `visually-hidden` (1px, `clip-path: inset(50%)`), so the label is the hit
  // target — clicking the input directly is a pointer-events failure, not a
  // CSP one.
  await page.getByText("dark", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "dark" })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");

  expect(await cspViolationsOn(page)).toEqual([]);
});

/**
 * dl-50's widening, as a differential: a script from each allowed foreign
 * origin runs, and the same script from any other origin does not.
 *
 * The suite reaches no network, so every URL below is answered by a Playwright
 * route rather than by Cloudflare. That is what makes the refused case mean
 * something: its route is installed and would serve the script perfectly well,
 * so if it does not run, the browser refused it — and the route recording no
 * request proves the refusal happened before the socket, as the image test
 * above does with the fixture origin's log.
 */
const BEACON_URL = "https://static.cloudflareinsights.com/beacon.min.js";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const FOREIGN_URL = "https://scripts.example.net/beacon.min.js";

/** Serves a script that records its own URL on `window`, and logs every hit. */
async function serveMarkerScripts(page: Page, urls: readonly string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const url of urls) {
    // oxlint-disable-next-line no-await-in-loop
    await page.route(url, async (route) => {
      hits.push(url);
      await route.fulfill({
        contentType: "text/javascript",
        body: `(window.cspScriptsRan = window.cspScriptsRan || []).push(${JSON.stringify(url)});`,
      });
    });
  }
  return hits;
}

/** Appends `<script src>` and waits for it to load or be refused. */
async function loadScript(page: Page, src: string): Promise<void> {
  await page.evaluate(async (url) => {
    const script = document.createElement("script");
    script.src = url;
    await new Promise<void>((resolve) => {
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => resolve(), { once: true });
      setTimeout(resolve, 5_000);
      document.head.append(script);
    });
  }, src);
}

async function scriptsThatRan(page: Page): Promise<string[]> {
  // Written by the served script in the page's own world; evaluate reads the
  // same window.
  return await page.evaluate(
    () => (window as unknown as { cspScriptsRan?: string[] }).cspScriptsRan ?? [],
  );
}

test("the Web Analytics beacon and the Turnstile script run, with no violation", async ({
  page,
}) => {
  await collectCspViolations(page);
  const hits = await serveMarkerScripts(page, [BEACON_URL, TURNSTILE_URL]);
  await page.goto("/");

  await loadScript(page, BEACON_URL);
  await loadScript(page, TURNSTILE_URL);

  expect(await scriptsThatRan(page)).toEqual([BEACON_URL, TURNSTILE_URL]);
  expect(hits).toEqual([BEACON_URL, TURNSTILE_URL]);
  expect(await cspViolationsOn(page)).toEqual([]);
});

test("a script from any other origin is still refused, before it is fetched", async ({ page }) => {
  await collectCspViolations(page);
  const hits = await serveMarkerScripts(page, [FOREIGN_URL]);
  await page.goto("/");

  await loadScript(page, FOREIGN_URL);

  expect(await scriptsThatRan(page)).toEqual([]);
  // The route would have served it: nothing asked.
  expect(hits).toEqual([]);
  const violations = (await cspViolationsOn(page)).filter((v) => v.blockedURI === FOREIGN_URL);
  expect(violations).toHaveLength(1);
  expect(violations[0]?.effectiveDirective.startsWith("script-src")).toBe(true);
});
