/**
 * repo-131: the built bundle carries the version `api/package.json` holds.
 *
 * Here and not in a unit test, because this is the one place the bundle under
 * test is the one `vite build` made: `e2e:serve` builds the UI before the API
 * starts, so a `define` that never reached the bundle leaves the version out
 * here, whatever `vite-config.test.ts` says about the config.
 */

import fs from "node:fs";
import { expect, test } from "@playwright/test";

const API_MANIFEST = new URL("../api/package.json", import.meta.url);

test("the footer shows the API's version, and links only to the terms", async ({ page }) => {
  const { version } = JSON.parse(fs.readFileSync(API_MANIFEST, "utf8")) as { version: string };
  await page.goto("/");

  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText(version, { exact: true })).toBeVisible();
  await expect(footer.getByRole("link")).toHaveCount(1);
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms.html");
});
