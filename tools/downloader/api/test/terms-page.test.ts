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
import { ROUTES } from "@downloader/contract";
import { afterEach, describe, expect, test } from "vitest";
import { API_DEFAULTS } from "../src/config.ts";
import { FINISHED_JOB_CLEAR_AFTER_MS, JOB_RETENTION_DAYS } from "../src/jobs/links.ts";
import { createLogger } from "../src/logger.ts";
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

const COMPOSE = new URL("../../../../compose.downloader.prod.yaml", import.meta.url);

/**
 * The days the production log cap holds, by the arithmetic the compose comment
 * gives: a visit is 6 KB and the cap was sized for 600 a day. Read from the file
 * itself, so a change to `max-size` or `max-file` that the page does not follow
 * fails the test that quotes it (dl-107).
 */
async function logDaysFromCompose(): Promise<number> {
  const compose = await fs.readFile(COMPOSE, "utf8");
  const size = /max-size:\s*"(\d+)m"/u.exec(compose)?.[1];
  const files = /max-file:\s*"(\d+)"/u.exec(compose)?.[1];
  expect(size).toBeDefined();
  expect(files).toBeDefined();
  const bytes = Number(size) * 1024 * 1024 * Number(files);
  return Math.round(bytes / (6_000 * 600));
}

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

  test("the page needs nothing the policy refuses: no inline script, no <style>, no style attribute", async () => {
    const text = await page();

    // One script, the theme module the web build writes beside the page
    // (repo-131), by a same-origin path and with no body: `script-src 'self'`.
    // Opening tags are counted, never paired with a closing one: a closing tag
    // has spellings a pattern misses (`</script >`), and a second script hidden
    // behind one would go uncounted (gate 1, F2).
    const opening = [...text.matchAll(/<script\b[^>]*>/giu)];
    expect(opening.map((match) => match[0])).toHaveLength(1);
    const tag = opening[0]?.[0] ?? "";
    expect(tag).toContain('type="module"');
    expect(tag).toContain('src="/theme.js"');
    // Empty: the very next characters close it.
    const after = text.slice((opening[0]?.index ?? 0) + tag.length);
    expect(after.toLowerCase().startsWith("</script>")).toBe(true);
    expect(text).not.toMatch(/<style/iu);
    expect(text).not.toMatch(/\sstyle=/iu);
    // What it links, the stylesheet and the icon, are same-origin paths.
    expect([...text.matchAll(/<link[^>]*href="([^"]+)"/giu)].map((match) => match[1])).toEqual([
      "/favicon.svg",
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
    expect(text).toContain(`about ${await logDaysFromCompose()} days`);
  });

  test("the minutes after which a finished download's addresses are erased are the sweep's", async () => {
    const text = (await page()).replace(/\s+/gu, " ");

    expect(FINISHED_JOB_CLEAR_AFTER_MS % 60_000).toBe(0);
    const minutes = FINISHED_JOB_CLEAR_AFTER_MS / 60_000;
    expect(text).toContain(`${minutes} minutes after it ends`);
    expect(text).toContain(`for ${minutes} minutes after`);
  });

  test("the log's days are what the compose cap holds at the traffic it was sized for", async () => {
    // 5 MB x 5 files at 6 KB a visit and 600 visits a day is a week. If the cap
    // moves, the page has to move with it: this is the number the page quotes.
    expect(await logDaysFromCompose()).toBe(7);
  });

  test("it says what a log line holds and what it does not", async () => {
    const text = (await page()).replace(/\s+/gu, " ");

    expect(text).toContain("never your whole address");
    expect(text).toContain("that page's domain, never its path");
    expect(text).not.toContain("domain and path");
    expect(text).toContain(
      "keep your address in the server's memory (for IPv6, its first 64 bits)",
    );
  });

  test("it names the person in charge and the contact, and says where the traffic goes", async () => {
    const text = (await page()).replace(/\s+/gu, " ");

    expect(text).toContain("The person in charge of the personal information");
    expect(text).toContain("the operator of this service");
    expect(text).toContain('href="mailto:abuse@oludoi.com"');
    expect(text).toContain("Cloudflare, a company based in the United States");
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

  test("the theme cookie it says the service never logs reaches no log line (repo-131)", async () => {
    // The page says the cookie goes with every request and the service does not
    // write it to its log. Every door a browser can send it through: the page,
    // the static terms file, the API, a miss.
    const text = (await page()).replace(/\s+/gu, " ");
    expect(text).toContain("webtools-theme");
    expect(text).toContain("does not write it to its log");

    const raw: string[] = [];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "downloader-terms-"));
    await fs.writeFile(path.join(root, "index.html"), "<!doctype html><title>Downloader</title>");
    await fs.copyFile(new URL("terms.html", PUBLIC), path.join(root, "terms.html"));
    webDir = root;
    harness = await createHarness({
      config: { webDir: root },
      logger: createLogger({ level: "debug", write: (line) => void raw.push(line) }),
    });
    const cookie = "webtools-theme=dark";
    for (const url of ["/", "/terms.html", ROUTES.health, "/api/no-such-route"]) {
      await harness.app.server.inject({
        method: "GET",
        url,
        headers: { cookie, accept: "text/html" },
      });
    }
    await harness.app.server.inject({
      method: "POST",
      url: ROUTES.probe,
      headers: { cookie },
      payload: { url: "not a url" },
    });

    // Something was logged, so an empty log is not what passes this.
    expect(raw.filter((line) => line.includes('"msg":"request"')).length).toBeGreaterThan(0);
    expect(raw.filter((line) => line.includes("webtools-theme"))).toEqual([]);
  });
});
