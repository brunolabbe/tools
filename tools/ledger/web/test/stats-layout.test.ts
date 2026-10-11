/**
 * The stylesheet rules a phone depends on (lg-9). Nothing here measures a width:
 * jsdom has no layout, and its `getComputedStyle` does not read these properties
 * back (tried: it answers an empty string). What is held is that the two
 * declarations which stopped every chart drawing 736px wide on a 360px page are
 * still in the rule for a chart's card and for its measured box. A chart is drawn
 * at its container's measured width; a grid item will not shrink below its
 * content, so without both the SVG sets the width it is then measured at and the
 * page grows past the screen.
 *
 * It is a guard on the declarations, not on the layout. The layout was measured
 * once, in Chromium at 360px, and is in the ticket's Log; a standing guard of that
 * kind is the ledger's first e2e spec, which wants its own CI job.
 */

import { expect, test } from "vitest";
import { readFileSync } from "node:fs";

// Read as text: the test runner turns a `?raw` import of a stylesheet into an empty string.
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** The declarations of the rule whose selector is exactly `selector`, as written. */
function declarations(selector: string): string[] {
  const escaped = selector.replaceAll(".", String.raw`\.`);
  const rule = new RegExp(String.raw`(?:^|[}/])\s*${escaped}\s*\{([^}]*)\}`, "u").exec(styles);
  if (rule === null) return [];
  return (rule[1] ?? "")
    .split(";")
    .map((line) => line.replaceAll(/\s+/gu, " ").trim())
    .filter((line) => line !== "");
}

test("a chart's card has a column that can shrink below its content", () => {
  const card = declarations(".chart-card");

  expect(card).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(card).toContain("min-width: 0");
});

test("the box a chart is measured in can shrink below its content", () => {
  expect(declarations(".chart-box")).toContain("min-width: 0");
});

test("the reader finds a rule by its selector, so a rule removed cannot hide behind a comment", () => {
  expect(declarations(".no-such-rule")).toEqual([]);
});
