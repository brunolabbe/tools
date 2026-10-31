/**
 * lg-72: the static terms page is wired to the theme and to the app, and its
 * stylesheet answers a chosen theme. What the page says is grounded one claim at
 * a time in the pull request; this holds only its shape.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (name: string): string =>
  readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

test("loads the shared theme from one same-origin module, with no inline script", () => {
  const scripts = [...read("terms.html").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)];

  expect(scripts.map((match) => match[2])).toEqual([""]);
  expect(scripts[0]?.[1]).toContain('type="module"');
  expect(scripts[0]?.[1]).toContain('src="/theme.js"');
});

test("links back to the ledger, and to its own stylesheet and icon", () => {
  const html = read("terms.html");

  expect(html).toContain('<a href="/">Back to the ledger</a>');
  expect([...html.matchAll(/<link[^>]*href="([^"]+)"/giu)].map((match) => match[1])).toEqual([
    "/favicon.svg",
    "/terms.css",
  ]);
});

test("its stylesheet has a block for each chosen theme, after the system one", () => {
  const css = read("terms.css");
  const system = css.indexOf("prefers-color-scheme: dark");

  expect(system).toBeGreaterThan(-1);
  expect(css.indexOf(':root[data-theme="light"]')).toBeGreaterThan(system);
  expect(css.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(system);
});
