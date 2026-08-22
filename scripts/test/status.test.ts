import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  extractRegion,
  milestones,
  parseFrontmatter,
  readTickets,
  readyTickets,
  renderRegion,
  replaceRegion,
} from "../status.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");

/**
 * A throwaway repo root with the tickets a case needs.
 *
 * Fixtures here are a directory tree rather than a checked-in file, because
 * what is under test is the walk as much as the parse — a `work/` that does not
 * exist, a filename that disagrees with its own id, two tools side by side.
 */
function repoWith(tickets: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "status-"));
  for (const [file, body] of Object.entries(tickets)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  return root;
}

const ticket = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\n---\n\n# body\n`;

const pl = (id: string, over: Record<string, string> = {}) =>
  ticket({
    id,
    tool: "planner",
    title: `the ${id} thing`,
    kind: "chore",
    status: "ready",
    milestone: "null",
    depends_on: "[]",
    ...over,
  });

const at = (id: string) => `tools/planner/docs/work/${id}-slug.md`;

// ---------------------------------------------------------------------------
// The real tickets
// ---------------------------------------------------------------------------

// The point of the strict parser is that this test is the one that fails, by
// name and by line, when a ticket's frontmatter drifts. CI skips `**.md`, so a
// documentation-only pull request never reaches this suite — `status.yml` runs
// the same walk on every pull request for exactly that reason.
test("every ticket in the repo parses, and its dependencies resolve", () => {
  const tickets = readTickets(REPO);
  expect(tickets.length).toBeGreaterThan(0);
  // Every tool the repo has, plus `repo` itself for work that belongs to none
  // of them — `docs/work/`, which ADR 003 opened.
  expect([...new Set(tickets.map((t) => t.tool))].toSorted()).toEqual([
    ...fs.readdirSync(path.join(REPO, "tools")).toSorted(),
    "repo",
  ]);
});

test("repo-wide tickets live in docs/work and have no status page to write into", () => {
  const repoTickets = readTickets(REPO).filter((t) => t.tool === "repo");
  expect(repoTickets.length).toBeGreaterThan(0);
  expect(repoTickets.every((t) => t.file.startsWith("docs/work/"))).toBe(true);
  expect(fs.existsSync(path.join(REPO, "docs", "03-STATUS.md"))).toBe(false);
});

test("every tool's status page has a region to write into", () => {
  for (const tool of fs.readdirSync(path.join(REPO, "tools"))) {
    const file = path.join(REPO, "tools", tool, "docs", "03-STATUS.md");
    if (!fs.existsSync(file)) continue;
    expect(extractRegion(fs.readFileSync(file, "utf8")), `${tool} has no markers`).not.toBeNull();
  }
});

// ---------------------------------------------------------------------------
// The parser refuses what it does not understand
// ---------------------------------------------------------------------------

test("a field nobody has agreed on is named, not ignored", () => {
  expect(() => parseFrontmatter(pl("pl-1", { owner: "bruno" }), "t.md")).toThrow(
    /"owner" is not a ticket field/,
  );
});

test("a status outside the taxonomy is a failure, not a row", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { status: "blocked" }) });
  expect(() => readTickets(root)).toThrow(/"blocked" is not a status/);
});

test("a kind outside the taxonomy is a failure too", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { kind: "epic" }) });
  expect(() => readTickets(root)).toThrow(/"epic" is not a kind/);
});

test("a missing required field is named", () => {
  const withoutMilestone = ticket({
    id: "pl-1",
    tool: "planner",
    title: "t",
    kind: "chore",
    status: "ready",
    depends_on: "[]",
  });
  expect(() => parseFrontmatter(withoutMilestone, "t.md")).toThrow(/"milestone" is missing/);
});

test("depends_on has to be a list, so a bare id cannot read as a string", () => {
  expect(() => parseFrontmatter(pl("pl-1", { depends_on: "pl-2" }), "t.md")).toThrow(
    /must be an inline list/,
  );
});

test("an id that disagrees with its filename is caught", () => {
  const root = repoWith({ "tools/planner/docs/work/pl-2-slug.md": pl("pl-1") });
  expect(() => readTickets(root)).toThrow(/does not match the filename/);
});

test("a dependency on a ticket that does not exist is caught", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { depends_on: "[pl-99]" }) });
  expect(() => readTickets(root)).toThrow(/depends_on "pl-99", which is not a ticket/);
});

test("a tool with no work directory yet is a young tool, not an error", () => {
  const root = repoWith({ "tools/planner/docs/03-STATUS.md": "# status\n" });
  expect(readTickets(root)).toEqual([]);
});

// ---------------------------------------------------------------------------
// The projections
// ---------------------------------------------------------------------------

test("ids sort by number, so pl-9 comes before pl-10", () => {
  const root = repoWith({
    [at("pl-9")]: pl("pl-9"),
    [at("pl-10")]: pl("pl-10"),
    [at("pl-2")]: pl("pl-2"),
  });
  expect(readTickets(root).map((t) => t.id)).toEqual(["pl-2", "pl-9", "pl-10"]);
});

test("ready means ready and unblocked — a ticket waiting on open work is a queue", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "ready", depends_on: "[pl-1]" }),
    [at("pl-3")]: pl("pl-3", { status: "ready", depends_on: "[pl-2]" }),
  });
  expect(readyTickets(readTickets(root)).map((t) => t.id)).toEqual(["pl-2"]);
});

test("a milestone is complete when nothing under it is open, dropped included", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done", milestone: "P1" }),
    [at("pl-2")]: pl("pl-2", { status: "dropped", milestone: "P1" }),
    [at("pl-3")]: pl("pl-3", { status: "ready", milestone: "P2" }),
    [at("pl-4")]: pl("pl-4", { status: "in-flight", milestone: "P3" }),
  });
  expect(milestones(readTickets(root))).toEqual([
    { milestone: "P1", done: 1, open: 0, dropped: 1, state: "complete" },
    { milestone: "P2", done: 0, open: 1, dropped: 0, state: "not started" },
    { milestone: "P3", done: 0, open: 1, dropped: 0, state: "in progress" },
  ]);
});

test("unmilestoned tickets sort last, under their own heading", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { milestone: "null" }),
    [at("pl-2")]: pl("pl-2", { milestone: "P1" }),
  });
  expect(milestones(readTickets(root)).map((row) => row.milestone)).toEqual(["P1", null]);
});

// ---------------------------------------------------------------------------
// The region
// ---------------------------------------------------------------------------

test("the region links each ticket relative to the status page beside it", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(renderRegion(readTickets(root))).toContain("[pl-1](./work/pl-1-slug.md)");
});

test("a note overrides the title, which is the only editorial field there is", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { note: "what the table should say" }) });
  const region = renderRegion(readTickets(root));
  expect(region).toContain("what the table should say");
  expect(region).not.toContain("the pl-1 thing");
});

test("a tool with nothing open says so rather than rendering an empty table", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { status: "done" }) });
  expect(renderRegion(readTickets(root))).toContain("None. Every ticket this tool has is closed.");
});

test("writing the region leaves everything around it exactly as it was", () => {
  const page =
    "# Status\n\nprose above\n\n<!-- generated:tickets -->\nold\n<!-- /generated:tickets -->\n\nprose below\n";
  const written = replaceRegion(
    page,
    "<!-- generated:tickets -->\nnew\n<!-- /generated:tickets -->",
    "t.md",
  );
  expect(written).toBe(
    "# Status\n\nprose above\n\n<!-- generated:tickets -->\nnew\n<!-- /generated:tickets -->\n\nprose below\n",
  );
});

// Guessing where the region belongs would rewrite someone's page. The position
// is editorial — under the orientation, above "Running things" — so a page that
// has not opted in is a named error rather than a file to append to.
test("a page with no markers is refused rather than appended to", () => {
  expect(() => replaceRegion("# Status\n", "x", "t.md")).toThrow(/no .* region to write into/);
});

test("markers the wrong way round are refused", () => {
  const page = "<!-- /generated:tickets -->\n<!-- generated:tickets -->\n";
  expect(() => replaceRegion(page, "x", "t.md")).toThrow(/wrong way round/);
  expect(extractRegion(page)).toBeNull();
});
