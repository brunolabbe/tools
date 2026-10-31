/**
 * lg-72: the built bundle carries the version `api/package.json` holds, the
 * footer links it to that release, and the terms page it links to takes the theme
 * the header's switch stored.
 *
 * Here and not in a unit test, because this is the one place the bundle under
 * test is the one `vite build` made: `e2e:ledger:serve` builds the UI before the
 * API starts, so a `define` that never reached the bundle shows `Changelog`
 * here, whatever `vite-config.test.ts` says about the config.
 */

import fs from "node:fs";
import { expect, test } from "@playwright/test";

const API_MANIFEST = new URL("../api/package.json", import.meta.url);

test("the footer shows the API's version and links to its release", async ({ page }) => {
  const { version } = JSON.parse(fs.readFileSync(API_MANIFEST, "utf8")) as { version: string };
  await page.goto("/");

  const footer = page.getByRole("contentinfo");
  const link = footer.getByRole("link", { name: `v${version}` });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    `https://github.com/brunolabbe/tools/releases/tag/ledger-v${version}`,
  );
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms.html");
  await expect(footer.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    "https://github.com/brunolabbe/tools/tree/main/tools/ledger",
  );
});

test("the footer's Terms link opens the terms page, which links back", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();

  await expect(page).toHaveURL(/\/terms\.html$/u);
  await page.getByRole("link", { name: "Back to the ledger" }).click();
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
});

test("a theme chosen in the header is the one the terms page opens in", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByTitle("Dark").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goto("/terms.html");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // The ledger's dark `--bg`, #111418, so the stylesheet answered the attribute and not only the script ran.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    "rgb(17, 20, 24)",
  );
});
