/**
 * The guard for repo-130: every tool is reset onto one base layer, and a tool
 * differs from it by setting a property the base reads with a fallback, never by
 * declaring the rule again.
 *
 * Without this the reset decays the way the three stylesheets did: a tool adds
 * `button { ... }` for one screen, the next tool copies it, and the base is a
 * file nobody reads. The synthetic cases at the end pin that the checker itself
 * fails, since a selector reader that found nothing would pass every tool.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { redeclaredSelectors, ruleSelectors, selectorsWithSpecificity } from "./support/base.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const BASE = fs.readFileSync(path.join(REPO_ROOT, "packages", "ui", "src", "base.css"), "utf8");

/**
 * The tools already moved onto the base. A tool is added here by the ticket that
 * moves it (lg-73 for the ledger, dl-135 for the downloader), in the same pull
 * request that deletes its own copies: from then on it must import the base and
 * declare none of its selectors.
 */
const MOVED = ["ledger", "planner"];

const tools = fs
  .readdirSync(path.join(REPO_ROOT, "tools"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(REPO_ROOT, "tools", name, "web", "src", "main.tsx")))
  .toSorted();

const read = (tool: string, file: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, "tools", tool, "web", "src", file), "utf8");

describe("base.css", () => {
  test("holds the rules the table names", () => {
    // A reader that matched nothing would pass every other test here.
    expect(ruleSelectors(BASE)).toEqual(
      expect.arrayContaining([
        "body",
        "code",
        ":focus-visible",
        "button",
        ".button",
        ".primary",
        "select",
        "textarea",
        ".card",
        ".stack",
        ".shell",
        ".muted",
      ]),
    );
  });

  test("wraps every selector in :where(), so any class beats it whatever the load order", () => {
    expect(selectorsWithSpecificity(BASE)).toEqual([]);
  });

  test("keeps its fallback-read properties out of tokens.css", () => {
    // A name `tokens.css` declares must be read by a tool; these are read by the
    // base and set, where a tool needs another value, in the tool's own `:root`.
    const tokens = fs.readFileSync(
      path.join(REPO_ROOT, "packages", "ui", "src", "tokens.css"),
      "utf8",
    );
    expect(tokens).not.toMatch(/--card-(?:shadow|padding)\s*:/u);
  });
});

describe("each tool imports the base layer in its place", () => {
  test("the scan found the tools it is meant to guard", () => {
    expect(tools).toEqual(expect.arrayContaining(["downloader", "ledger", "planner"]));
  });

  test("a moved tool imports base.css, and every importer does so after tokens and before the rest", () => {
    const problems: string[] = [];
    for (const tool of tools) {
      const main = read(tool, "main.tsx");
      const at = (name: string): number => main.indexOf(`import "${name}"`);
      const base = at("@webtools/ui/base.css");
      if (base === -1) {
        if (MOVED.includes(tool)) problems.push(`${tool} is moved and does not import base.css`);
        continue;
      }
      if (at("@webtools/ui/tokens.css") === -1 || at("@webtools/ui/tokens.css") > base) {
        problems.push(`${tool} imports base.css before tokens.css`);
      }
      const later = ["@webtools/ui/chrome.css", "./styles.css"].map((name) => at(name));
      for (const position of later) {
        if (position !== -1 && position < base) {
          problems.push(`${tool} imports base.css after a stylesheet that should follow it`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("a moved tool declares none of the base's selectors in its own styles.css", () => {
    const problems = MOVED.flatMap((tool) =>
      redeclaredSelectors(BASE, read(tool, "styles.css")).map(
        (selector) =>
          `${tool}/web/src/styles.css declares \`${selector}\`: set a property the base reads instead`,
      ),
    );
    expect(problems).toEqual([]);
  });
});

describe("the checker itself", () => {
  const base =
    ":where(button, .button) { color: red; }\n:where(.card > :is(h2, h3):first-child) { margin: 0; }";

  test("fails on a tool that declares a base selector again, alone or in a list", () => {
    expect(redeclaredSelectors(base, "button { padding: 0; }")).toEqual(["button"]);
    expect(redeclaredSelectors(base, "h1,\n.button  { padding: 0; }")).toEqual([".button"]);
  });

  test("fails on a base selector inside a media query, and one that is itself a list", () => {
    expect(redeclaredSelectors(base, "@media (min-width: 48rem) { button { x: y } }")).toEqual([
      "button",
    ]);
    expect(redeclaredSelectors(base, ".card > :is(h2, h3):first-child { margin: 1rem; }")).toEqual([
      ".card > :is(h2, h3):first-child",
    ]);
  });

  test("does not fail on a selector that only contains a base one", () => {
    const own = "button.link { x: y }\n.card.warn { x: y }\n.row .field { x: y }";
    expect(redeclaredSelectors(base, own)).toEqual([]);
  });

  test("reads a declaration's value and a comment as no selector", () => {
    expect(ruleSelectors("/* button { } */ .a { color: red; }\n.b { margin: 0; }")).toEqual([
      ".a",
      ".b",
    ]);
  });

  test("names a selector that is not wrapped in :where()", () => {
    expect(selectorsWithSpecificity(":where(a) { x: y }\nb, :where(c) { x: y }")).toEqual(["b"]);
  });
});
