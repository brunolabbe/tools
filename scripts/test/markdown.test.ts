/**
 * The markdown readers `status.mjs` and `review-record.mjs` share. These cases
 * moved here unchanged from `citations.test.ts` when the citation checker was
 * retired (adr/006): the functions outlived it, so their tests have to.
 */
import { expect, test } from "vitest";
import { extractSections, selectSection, splitLines } from "../markdown.mjs";

/**
 * A heading owns everything down to the next heading of the same level or
 * higher. Getting this wrong drops the citations under a subsection while still
 * printing a confident count, which is the failure the whole script exists to
 * prevent.
 */
test("extractSections gives a heading the span of its subsections", () => {
  const md = ["# Top", "a", "## One", "b", "### Under one", "c", "## Two", "d"].join("\n");
  expect(extractSections(md)).toEqual([
    { title: "Top", level: 1, start: 1, end: 8 },
    { title: "One", level: 2, start: 3, end: 6 },
    { title: "Under one", level: 3, start: 5, end: 6 },
    { title: "Two", level: 2, start: 7, end: 8 },
  ]);
});

/**
 * Records quote changelog fragments, so `### Fixes` inside a fence is common —
 * 40 such lines across the work records when this was measured. Taking one for a
 * heading would end the enclosing section early and silently shrink the count.
 */
test("extractSections does not read a heading out of a fenced block", () => {
  const md = ["## Real", "```md", "## Not a heading", "```", "tail"].join("\n");
  expect(extractSections(md)).toEqual([{ title: "Real", level: 2, start: 1, end: 5 }]);
});

test("selectSection matches case-insensitively, preferring an exact hit to a prefix", () => {
  const sections = extractSections(["## Log", "a", "## Logging notes", "b"].join("\n"));
  expect(selectSection(sections, "log").title).toBe("Log");
  expect(selectSection(sections, "LOGGING").title).toBe("Logging notes");
  // Prefix is the fallback, which is what makes an em-dashed heading typeable.
  expect(selectSection(extractSections("### Gate — 2026-09-01"), "Gate").title).toBe(
    "Gate — 2026-09-01",
  );
});

/**
 * Both refusals, and the reason they are refusals rather than an empty result:
 * `0/0` is already what a real but citation-free section prints, so a silent
 * miss would be indistinguishable from a correct answer.
 */
test("selectSection refuses a name that matches nothing, and one that matches two", () => {
  const sections = extractSections(["## Nested", "a", "## Nothing", "b"].join("\n"));
  expect(() => selectSection(sections, "Missing")).toThrow(/no section matches "Missing"/);
  // The refusal lists what is there, so a typo costs one read rather than two.
  expect(() => selectSection(sections, "Missing")).toThrow(/## Nested/);
  expect(() => selectSection(sections, "N")).toThrow(/"N" matches 2 sections/);
});

/**
 * CommonMark: a backtick fence's info string may not itself contain a
 * backtick, so a line whose backtick run is followed later on the same line
 * by another backtick never opens a fence at all — a reader does not skip
 * past it looking for a closer. `extractSections` used to check only the
 * opening run, which silently swallowed every heading below a line shaped
 * like this (repo-60's own Build, before it worked around the divergence).
 */
test("extractSections does not read a backtick info string as an unclosed fence", () => {
  const md = [
    "## Build",
    "```` ` `` `:99999` `` ` ```` reproduction",
    "## Done when",
    "a",
    "## Log",
    "b",
  ].join("\n");
  expect(extractSections(md)).toEqual([
    { title: "Build", level: 2, start: 1, end: 2 },
    { title: "Done when", level: 2, start: 3, end: 4 },
    { title: "Log", level: 2, start: 5, end: 6 },
  ]);
});

/**
 * The rule is specific to a backtick info string. An ordinary fence — no
 * backtick after the opening run, or a tilde fence even with one — still
 * hides headings inside it, unchanged.
 */
test("extractSections still hides headings inside an ordinary backtick or tilde fence", () => {
  const backtick = ["## Real", "```md", "## Not a heading", "```", "tail"].join("\n");
  expect(extractSections(backtick)).toEqual([{ title: "Real", level: 2, start: 1, end: 5 }]);

  // A tilde fence has no backtick-info-string restriction, so a backtick in
  // its info string does not disqualify it as a fence.
  const tilde = ["## Real", "~~~`md", "## Not a heading", "~~~", "tail"].join("\n");
  expect(extractSections(tilde)).toEqual([{ title: "Real", level: 2, start: 1, end: 5 }]);
});

/**
 * The regex itself, watched failing first — the reproduction the ticket was
 * filed from. `.` and `\S` never match `\r` in a JS regex with no `/s` flag,
 * so a line split out of a `\r\n`-terminated file keeps a trailing `\r` that
 * `[ \t]*$` does not consume, and the heading is invisible to
 * `extractSections`.
 */
test("extractSections reads a heading in a CRLF-terminated record", () => {
  const lf = extractSections("## Review\n\nsome text\n");
  const crlf = extractSections("## Review\r\n\r\nsome text\r\n");
  expect(crlf).toEqual(lf);
  expect(crlf).toEqual([{ title: "Review", level: 2, start: 1, end: 4 }]);
});

test("splitLines strips a trailing carriage return and nothing else", () => {
  expect(splitLines("## Review\r\n  text \r\nlast")).toEqual(["## Review", "  text ", "last"]);
});
