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
  const text = read("terms.html");
  // Opening tags are counted, never paired with a closing one: a closing tag has
  // spellings a pattern misses (`</script >`), and a second script hidden behind
  // one would go uncounted. The same shape as the downloader's terms test.
  const opening = [...text.matchAll(/<script\b[^>]*>/giu)];

  expect(opening).toHaveLength(1);
  const tag = opening[0]?.[0] ?? "";
  expect(tag).toContain('type="module"');
  expect(tag).toContain('src="/theme.js"');
  // Empty: the very next characters close it.
  expect(
    text
      .slice((opening[0]?.index ?? 0) + tag.length)
      .toLowerCase()
      .startsWith("</script>"),
  ).toBe(true);
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
