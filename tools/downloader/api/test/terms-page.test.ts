/**
 * dl-54: the terms page is served same-origin, from the real file, and says what
 * the service does.
 *
 * It reads `web/public/terms.html` itself rather than a copy, so a number in the
 * page that drifts from the one the code uses fails here. What it cannot prove
 * is that the words are right: the owner approves those in the pull request.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { API_DEFAULTS } from "../src/config.ts";
import { JOB_RETENTION_DAYS } from "../src/jobs/links.ts";
import { createHarness } from "./helpers.ts";
import type { Harness } from "./helpers.ts";

const PUBLIC = new URL("../../web/public/", import.meta.url);

let harness: Harness | undefined;
let webDir: string | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
  if (webDir !== undefined) await fs.rm(webDir, { recursive: true, force: true });
  webDir = undefined;
});

const page = (): Promise<string> => fs.readFile(new URL("terms.html", PUBLIC), "utf8");

/** What `vite build` does with `public/`: copies it beside `index.html`. */
async function serving(): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-terms-"));
  await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Downloader</title>");
  for (const name of ["terms.html", "terms.css"]) {
    // oxlint-disable-next-line no-await-in-loop
    await fs.copyFile(new URL(name, PUBLIC), path.join(root, name));
  }
  webDir = root;
  harness = await createHarness({ config: { webDir: root } });
  return harness;
}

describe("served by the API", () => {
  test("the page and its stylesheet answer 200 under the document policy, with no widening", async () => {
    const app = (await serving()).app;
    const html = await app.server.inject({
      method: "GET",
      url: "/terms.html",
      headers: { accept: "text/html" },
    });
    const css = await app.server.inject({ method: "GET", url: "/terms.css" });

    expect(html.statusCode).toBe(200);
    expect(html.headers["content-type"]).toContain("text/html");
    expect(html.headers["content-security-policy"]).toContain("style-src 'self';");
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
  });

  test("the page needs nothing the policy refuses: no script, no <style>, no style attribute", async () => {
    const text = await page();

    expect(text).not.toMatch(/<script/iu);
    expect(text).not.toMatch(/<style/iu);
    expect(text).not.toMatch(/\sstyle=/iu);
    // The one stylesheet it links is a same-origin path.
    expect([...text.matchAll(/<link[^>]*href="([^"]+)"/giu)].map((match) => match[1])).toEqual([
      "/terms.css",
    ]);
  });
});

describe("what it says", () => {
  test("the retention it states are the ones the code applies", async () => {
    const text = (await page()).replace(/\s+/gu, " ");

    expect(text).toContain(`${JOB_RETENTION_DAYS} days`);
    expect(text).toContain(`${API_DEFAULTS.outcomeRetentionDays} days`);
    // The log's "about" is the figure compose's size cap was derived from.
    expect(text).toContain(`about ${JOB_RETENTION_DAYS} days`);
  });

  test("it carries each thing the ticket requires", async () => {
    const text = (await page()).replace(/\s+/gu, " ");

    expect(text).toContain("abuse@oludoi.com");
    expect(text).toMatch(/DRM/u);
    expect(text).toContain("No video is stored");
    expect(text).toContain("the page's domain only");
    expect(text).toMatch(/Use it for video you have the right to save/u);
    // The page links back to the app and the app links to the page.
    expect(text).toContain('href="/"');
  });
});
