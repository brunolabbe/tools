import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { checkReview } from "../preflight.mjs";
import { readTickets, reviewedButReady } from "../status.mjs";

/**
 * repo-73: `hasGateRecord` reads fences with the same rule `extractSections`
 * does, rather than a looser one of its own — and so does preflight's check 3,
 * which now calls it. repo-76, at the end: an id's number has no leading zero.
 *
 * A file of its own rather than the end of `status.test.ts`, because that
 * suite's end was already claimed by an open pull request (#302, repo-72) whose
 * own review record cites the lines it appends there — appending here too would
 * conflict, and inserting above it would move those citations.
 *
 * Every shape below holds with and without repo-63's `extractSections` fix
 * (a backtick info string containing a backtick opens no fence): no line here
 * starts with a backtick run that is followed by another backtick.
 */
function repoWith(tickets: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "status-gate-"));
  for (const [file, body] of Object.entries(tickets)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  return root;
}

const at = "docs/work/repo-1-slug.md";
const ready = [
  "---",
  "id: repo-1",
  "tool: repo",
  "title: the thing",
  "kind: fix",
  "status: ready",
  "milestone: null",
  "depends_on: []",
  "---",
  "",
  "# repo-1 — the thing",
  "",
].join("\n");
const reviewed = (body: string) => readTickets(repoWith({ [at]: `${ready}${body}` }))[0]?.reviewed;

// repo-63's own brief, reduced: a five-backtick fence quoting a four-backtick
// line. A four-backtick run cannot close a five-backtick fence, so the fence
// closes on the second five-backtick line and the gate record below it is
// real. The loose rule toggled on every one of the three lines, ended inside a
// fence, and read that ticket as ungated — so `reviewedButReady` could not
// catch it landing with `status` left `ready`.
test("a shorter fence quoted inside a longer one does not close it", () => {
  const body = ["`````", "````", "`````", "", "## Review", "", "**Gate: PASS**", ""].join("\n");
  expect(reviewed(body)).toBe(true);
  const root = repoWith({ [at]: `${ready}${body}` });
  expect(reviewedButReady(readTickets(root)).map((p) => p.id)).toEqual(["repo-1"]);
});

// The other direction, which the repo-63 gate worked out from the code and did
// not measure: a tilde line inside a backtick fence is content, not a closer.
// The loose rule closed the fence on it and exposed the quoted `## Review`, so
// an unstarted ticket quoting a gate record read as reviewed-but-ready — a red
// pipeline for every reader over a tree that is fine.
test("a tilde line inside a backtick fence does not close it", () => {
  const body = ["```md", "~~~", "## Review", "~~~", "```", ""].join("\n");
  expect(reviewed(body)).toBe(false);
  const root = repoWith({ [at]: `${ready}${body}` });
  expect(reviewedButReady(readTickets(root))).toEqual([]);
});

// The mirror of the first case with the other character, so the length rule is
// not only proven for backticks.
test("a shorter tilde fence quoted inside a longer one does not close it", () => {
  const body = ["~~~~", "~~~", "~~~~", "", "## Review", ""].join("\n");
  expect(reviewed(body)).toBe(true);
});

// CommonMark lets a fence sit up to three spaces in; the loose rule only saw
// column 0, so an indented example's quoted heading was read as a real one.
test("a fence indented up to three spaces still hides the heading it quotes", () => {
  const body = ["   ```", "## Review", "   ```", ""].join("\n");
  expect(reviewed(body)).toBe(false);
});

// What must not change: only a level-2 `Review` heading counts, as before.
test.each([
  ["## Review", true],
  ["## Review — gate 1", true],
  ["### Review", false],
  ["# Review", false],
  ["## Reviewed", false],
  ["## The gate on this filing", false],
])("%s at the top level reads as reviewed: %s", (heading, expected) => {
  expect(reviewed(`${heading}\n`)).toBe(expected);
});

// ---------------------------------------------------------------------------
// preflight's check 3, the third reader of `## Review` — folded into repo-73
// ---------------------------------------------------------------------------

// `checkReview` grepped `^## Review` over the whole file with no fence rule at
// all, so a ticket marked `done` whose only `## Review` is a quoted example —
// `docs/01-TICKETS.md`'s template shape — passed as gated. The opposite
// failure to `hasGateRecord`'s: a false pass on a landing, not a false alarm.
const done = ready.replace("status: ready", "status: done");
const preflightReview = (body: string) =>
  checkReview("unused", [at], () => `${done}${body}`) as { ok: boolean; lines: string[] };

test("preflight's review check does not count a ## Review quoted in a fence", () => {
  const result = preflightReview(
    ["```md", "## Review", "", "**Gate: PASS**", "```", ""].join("\n"),
  );
  expect(result.ok).toBe(false);
  expect(result.lines).toEqual([`FAIL  ${at} is marked done but has no ## Review section`]);
});

test("preflight's review check reads a real ## Review the way the board does", () => {
  const body = ["`````", "````", "`````", "", "## Review", ""].join("\n");
  expect(preflightReview(body).ok).toBe(true);
  expect(reviewed(body)).toBe(true);
});

// ---------------------------------------------------------------------------
// repo-76: an id with a leading zero is not an id
// ---------------------------------------------------------------------------

// `dl-003` parsed, `Number()` dropped the zeros, and `readTickets` returned it
// beside `dl-3` as a different ticket in the same sort slot; `next-id` read both
// as 3. The owner chose to reject the spelling (2026-09-27): no ticket had one.
test.each([["repo-003"], ["repo-01"], ["repo-0"]])(
  "%s is refused as not <prefix>-<n>, by file",
  (id) => {
    const file = `docs/work/${id}-slug.md`;
    const root = repoWith({ [file]: ready.replace("id: repo-1", `id: ${id}`) });
    expect(() => readTickets(root)).toThrow(`${file}: "${id}" is not "<prefix>-<n>"`);
  },
);

test("an id with a zero that is not leading still parses", () => {
  const file = "docs/work/repo-10-slug.md";
  const root = repoWith({ [file]: ready.replace("id: repo-1", "id: repo-10") });
  expect(readTickets(root).map((t) => [t.id, t.number])).toEqual([["repo-10", 10]]);
});
