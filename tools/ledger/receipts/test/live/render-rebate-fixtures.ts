/**
 * Renders lg-89's three synthetic receipts, `test/fixtures/<name>.html`, to the
 * `.png` beside each, through the Chromium Playwright already installs for the
 * e2e suites. Costs nothing and reaches no network: run it after editing a
 * receipt's HTML, from the repository root:
 *
 *     node --import tsx tools/ledger/receipts/test/live/render-rebate-fixtures.ts
 *
 * Not a suite (`rebate-fixtures.ts` says why it lives here).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";
import { FIXTURES, REBATE_FIXTURES } from "./rebate-fixtures.ts";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const fixture of REBATE_FIXTURES) {
    const html = readFileSync(path.join(FIXTURES, `${fixture.name}.html`), "utf8");
    await page.setContent(html);
    const png = path.join(FIXTURES, `${fixture.name}.png`);
    await page.locator(".receipt").screenshot({ path: png });
    process.stdout.write(`wrote ${png}\n`);
  }
} finally {
  await browser.close();
}
