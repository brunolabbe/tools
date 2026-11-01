/**
 * lg-72: what the shell no longer writes itself. The header and footer are
 * `@webtools/ui`'s, so `App.tsx` carries no `<header>` of its own and no line
 * that asks the server how it is. A read of the source, because a rendered page
 * cannot say a component is absent from the file that would draw it.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

test("App.tsx writes no <header> element of its own", () => {
  expect(source).not.toMatch(/<header\b/u);
  expect(source).toMatch(/<AppHeader\b/u);
});

test("App.tsx has no Health component and fetches no /health", () => {
  expect(source).not.toMatch(/\bHealth\b|fetchHealth|\/health/u);
  expect(source).toMatch(/<AppFooter\b/u);
});
