/**
 * dl-114: `sameDocument` without a browser. The departure guard asks it whether
 * the URL the top frame moved to is still the page it landed on (dl-55); the
 * browser-level proof that the guard is wired to it is `browser-resolver.test.ts`
 * (the `?t=` row of "play-time query rewrites", and the `history.pushState`
 * departure above it). Each row below that was once a probe of its own through
 * Chromium names the fixture query it stands for.
 */

import { describe, expect, test } from "vitest";
import { sameDocument } from "../../src/resolvers/browser.ts";

const PAGE = "https://example.test/watch";

describe("sameDocument", () => {
  test.each([
    // The rows that were `guard-query.html?rewrite=<key>`: the page adds the key
    // on play through `history.replaceState`.
    ["adding ?t= (the browser keeps this row)", `${PAGE}?rewrite=t`, `${PAGE}?rewrite=t&t=5`, true],
    ["adding ?start=", `${PAGE}?rewrite=start`, `${PAGE}?rewrite=start&start=10`, true],
    ["adding ?autoplay=", `${PAGE}?rewrite=autoplay`, `${PAGE}?rewrite=autoplay&autoplay=1`, true],
    [
      "adding another key (`?rewrite=other` added `v=other`): a departure",
      `${PAGE}?rewrite=other`,
      `${PAGE}?rewrite=other&v=other`,
      false,
    ],
    [
      "the same two keys in the other order (`?rewrite=reorder&v=abc&list=PL1`)",
      `${PAGE}?rewrite=reorder&v=abc&list=PL1`,
      `${PAGE}?rewrite=reorder&list=PL1&v=abc`,
      true,
    ],
    // The ticket's remaining rows: what the exception covers and what it does not.
    ["changing ?t=", `${PAGE}?t=5`, `${PAGE}?t=90`, true],
    ["removing ?start=", `${PAGE}?start=10`, PAGE, true],
    ["a fragment only", PAGE, `${PAGE}#chapter-2`, true],
    ["a fragment and ?t= together", `${PAGE}?v=abc`, `${PAGE}?v=abc&t=5#chapter-2`, true],
    ["the same URL", `${PAGE}?v=abc`, `${PAGE}?v=abc`, true],
    ["the video id changing", `${PAGE}?v=abc`, `${PAGE}?v=def`, false],
    ["the video id removed", `${PAGE}?v=abc`, PAGE, false],
    ["another key beside ?t=", `${PAGE}?v=abc`, `${PAGE}?v=abc&t=5&list=PL1`, false],
    ["another path", `${PAGE}?v=abc`, "https://example.test/embed?v=abc", false],
    ["another origin", `${PAGE}?v=abc`, "https://other.test/watch?v=abc", false],
    ["another scheme", `${PAGE}?v=abc`, "http://example.test/watch?v=abc", false],
  ] as const)("%s", (_name, landing, after, expected) => {
    expect(sameDocument(after, landing)).toBe(expected);
    // Symmetric: neither side is privileged.
    expect(sameDocument(landing, after)).toBe(expected);
  });

  test("a URL that does not parse is the same only as itself", () => {
    expect(sameDocument("not a url", "not a url")).toBe(true);
    expect(sameDocument("not a url", PAGE)).toBe(false);
  });
});
