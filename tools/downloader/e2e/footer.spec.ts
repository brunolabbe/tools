/**
 * repo-131: the built bundle carries the version `api/package.json` holds, and
 * the footer links it to that release.
 *
 * Here and not in a unit test, because this is the one place the bundle under
 * test is the one `vite build` made: `e2e:serve` builds the UI before the API
 * starts, so a `define` that never reached the bundle shows `Changelog` here,
 * whatever `vite-config.test.ts` says about the config.
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
    `https://github.com/brunolabbe/tools/releases/tag/downloader-v${version}`,
  );
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms.html");
  await expect(footer.getByRole("link", { name: "Source" })).toHaveAttribute(
    "href",
    "https://github.com/brunolabbe/tools/tree/main/tools/downloader",
  );
});
