/**
 * Three rules in `styles.css` that carry behaviour, asserted against the
 * stylesheet's text (dl-43).
 *
 * **This reads the file; it does not render it, and that limit is the point of
 * this docblock.** The suite runs in jsdom, which parses CSS but computes
 * nothing from an animation and honours no media query, and the bundle's
 * stylesheet is applied by Vite at runtime rather than by any test. So what is
 * proved here is that the declarations exist and refer to each other correctly
 * — that a named keyframes block is defined, that the reduced-motion branch
 * turns it off and puts something else in its place. What is *not* proved is
 * that either looks right, and that was checked by hand against the running app
 * and recorded in the ticket's Log.
 *
 * Text assertions are still worth their keep, because each of these was a
 * silent failure before: an animation naming keyframes that do not exist, a
 * reduced-motion block that disables a transition on an element which has none,
 * and two components sharing a selector so a change to one lands on the other.
 * None of those is visible in a diff and none breaks a render.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const CSS = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** The body of the first rule whose selector list matches, `@media` included. */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") {
      depth--;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unterminated rule for ${selector}`);
}

const REDUCED_MOTION = block(CSS, "@media (prefers-reduced-motion: reduce)");

test("the indeterminate bar animates, by a keyframes block that exists", () => {
  const bar = block(CSS, ".progress--indeterminate");
  const animation = /animation:\s*([\w-]+)/u.exec(bar);
  expect(animation, "no animation on .progress--indeterminate").not.toBeNull();

  // The failure this catches is the quiet one: an `animation` naming keyframes
  // that were renamed or never written is not an error anywhere, it is simply a
  // bar that does not move — which is the defect being fixed.
  const name = animation?.[1] ?? "";
  expect(CSS).toContain(`@keyframes ${name}`);
  expect(bar).toContain("background-size");
});

test("Chromium's own track is cleared, or the animated background is painted over", () => {
  // `.progress::-webkit-progress-bar` sets an opaque background, and that
  // pseudo-element paints above the element's own. Without this reset the whole
  // indeterminate treatment is invisible in Chromium — which is how the static
  // barber-pole it replaced went unnoticed.
  const track = block(CSS, ".progress--indeterminate::-webkit-progress-bar");
  expect(track).toMatch(/background:\s*transparent/u);
});

test("reduced motion stops the travel and leaves something a bar at 0% is not", () => {
  expect(REDUCED_MOTION).toContain(".progress--indeterminate");
  const still = block(REDUCED_MOTION, ".progress--indeterminate");
  expect(still).toMatch(/animation:\s*none/u);

  // The fallback must stay unmistakably *not* a determinate bar sitting empty,
  // so it covers the whole track rather than filling part of it.
  expect(still).toContain("repeating-linear-gradient");
});

test("the job card draws no step list, and the analyse panel no stage row (dl-43, dl-109)", () => {
  // The analyse panel lost its five-stage row in dl-43; the job card lost its
  // four steps in dl-109, the bar and the line under it being the progression.
  expect(CSS).not.toContain(".stages");
  expect(CSS).not.toContain(".steps");
});
