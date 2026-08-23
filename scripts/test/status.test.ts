import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  danglingDependencies,
  describeTicket,
  milestones,
  parseFrontmatter,
  readTickets,
  readyTickets,
  renderMarkdown,
} from "../status.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const CLI = path.join(REPO, "scripts", "status.mjs");

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

/** A repo-wide ticket, which is where the real dangling dependency was written. */
const repoTicket = (id: string, over: Record<string, string> = {}) =>
  ticket({
    id,
    tool: "repo",
    title: `the ${id} thing`,
    kind: "chore",
    status: "ready",
    milestone: "null",
    depends_on: "[]",
    ...over,
  });

const atRepo = (id: string) => `docs/work/${id}-slug.md`;

/**
 * Run the CLI the way a person does.
 *
 * repo-1's fourth gate found that the CLI had no test at all — `--check`'s two
 * acceptance rows could only ever be `verified`. The flags added here are
 * covered end to end for that reason: `--tool`, `--show` and `--markdown` are
 * argument parsing and formatting, which is precisely what a pure-function
 * suite cannot see.
 *
 * **The two streams are kept apart**, because repo-6 is a defect about which
 * stream carries what: a warning that lands on stdout corrupts a `--json`
 * consumer, and one merged into stdout by this helper could not tell the two
 * apart. Exit code likewise — the payload and the exit code are separate
 * decisions there, so a test has to be able to see them separately.
 *
 * `spawnSync` rather than `execFileSync`: it returns a non-zero exit as data
 * instead of an exception, with both pipes intact either way. Argument array,
 * never a shell — the repo-wide rule.
 *
 * `root` points the CLI at a throwaway ticket tree from `repoWith`. Without it
 * every case runs against the real tickets, which cannot be malformed on
 * purpose.
 */
function run(args: string[], root?: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    "node",
    [CLI, ...(root === undefined ? [] : ["--root", root]), ...args],
    {
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return { stdout: result.stdout, stderr: result.stderr, status: result.status ?? 1 };
}

/**
 * Four sound tickets and one whose `depends_on` names a ticket nobody filed.
 *
 * The malformed one is a `repo` ticket and the sound ones are the planner's,
 * which is the shape the defect actually arrived in: `--tool planner` narrows
 * to a tool the bad ticket is not in, and used to fail anyway.
 */
function repoWithADanglingDependency(): string {
  return repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2"),
    [at("pl-3")]: pl("pl-3", { depends_on: "[pl-1]" }),
    [atRepo("repo-9")]: repoTicket("repo-9", { depends_on: "[repo-404]" }),
  });
}

/** The message the reader has always produced, and the only one this asserts. */
const DANGLING = `${atRepo("repo-9")}: depends_on "repo-404", which is not a ticket`;

// ---------------------------------------------------------------------------
// The real tickets
// ---------------------------------------------------------------------------

// **The three tests below are the ones a documentation-only pull request needs
// most, and CI runs at most one of them.** `ci.yml`'s `test` matrix is skipped
// for a change that is all `.md` — which is exactly what filing a ticket or
// flipping one to `done` is — so what runs on such a pull request is the
// unfiltered `check` job, and the only thing it knows about tickets is
// `node scripts/status.mjs --json`. That step had a workflow of its own
// (`status.yml`) until repo-2 folded it in.
//
// So, precisely:
//
// - **Covered by `check`:** the parse and `depends_on` resolution the first
//   test asserts. `--json` walks every ticket through the same reader, so a
//   drifted field, a status outside the taxonomy or a dangling dependency fails
//   there by file and line whether or not vitest runs.
// - **Not covered, on any all-`.md` pull request:** the tool-set assertion in
//   the first test, and both tests after it. The second is only ever violated
//   by a misplaced file; the third — `no tool keeps a status page` — is the
//   regression guard repo-2 added, and a pull request that re-adds a
//   `03-STATUS.md` is by construction all markdown, so it is the one change the
//   guard exists for and the one CI will not run it on. Pre-existing and not
//   worth a second workflow: the fix is to run the matrix, and that trade is
//   argued in `ci.yml`'s header.
//
// The point of the strict parser is that the first test is the one that fails,
// by name and by line, when a ticket's frontmatter drifts.
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

test("repo-wide tickets live in docs/work", () => {
  const repoTickets = readTickets(REPO).filter((t) => t.tool === "repo");
  expect(repoTickets.length).toBeGreaterThan(0);
  expect(repoTickets.every((t) => t.file.startsWith("docs/work/"))).toBe(true);
});

// repo-2 deleted both pages. This is the test that fails if one comes back:
// the view is computed on every run, and a copy of it in a file is a copy
// something has to keep true.
test("no tool keeps a status page, and neither does the repo", () => {
  expect(fs.existsSync(path.join(REPO, "docs", "03-STATUS.md"))).toBe(false);
  for (const tool of fs.readdirSync(path.join(REPO, "tools"))) {
    const file = path.join(REPO, "tools", tool, "docs", "03-STATUS.md");
    expect(fs.existsSync(file), `${tool} has a status page again`).toBe(false);
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

// This test used to assert `readTickets` *threw* on a dangling `depends_on`,
// which it did — three lines into `main`, before any view was chosen. One
// ticket naming an id that had not merged yet therefore cost every reader every
// ticket in every mode (repo-6). The condition is still detected, by name and
// by file; what it costs is a warning rather than the command.
test("a dependency on a ticket that does not exist is reported, not thrown", () => {
  const root = repoWithADanglingDependency();
  const tickets = readTickets(root);
  expect(tickets.map((t) => t.id)).toEqual(["pl-1", "pl-2", "pl-3", "repo-9"]);
  expect(danglingDependencies(tickets)).toEqual([
    {
      file: atRepo("repo-9"),
      kind: "dangling-dependency",
      id: "repo-9",
      dependency: "repo-404",
      message: DANGLING,
    },
  ]);
});

test("a repo whose dependencies all resolve reports no problems", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { depends_on: "[pl-1]" }),
  });
  expect(danglingDependencies(readTickets(root))).toEqual([]);
});

// Every edge, not the first one: a reader told about one missing id fixes it,
// re-runs, and is told about the next.
test("every dangling edge is reported, including two on one ticket", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { depends_on: "[pl-98, pl-99]" }),
    [at("pl-2")]: pl("pl-2", { depends_on: "[pl-97]" }),
  });
  expect(danglingDependencies(readTickets(root)).map((p) => [p.id, p.dependency])).toEqual([
    ["pl-1", "pl-98"],
    ["pl-1", "pl-99"],
    ["pl-2", "pl-97"],
  ]);
});

test("a tool with no work directory yet is a young tool, not an error", () => {
  const root = repoWith({ "tools/planner/docs/02-ROADMAP.md": "# roadmap\n" });
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
// One ticket — `--show`
// ---------------------------------------------------------------------------

// The list worth printing is the dependencies that are *not* done, which is not
// the same list as `depends_on`: a mature ticket's are mostly landed, and
// listing them all buries the one that has not.
test("the blockers are the dependencies that are not done, not all of them", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "in-flight" }),
    [at("pl-3")]: pl("pl-3", { depends_on: "[pl-1, pl-2]" }),
  });
  const { ticket: shown, blockers } = describeTicket(readTickets(root), "pl-3");
  expect(shown.file).toBe("tools/planner/docs/work/pl-3-slug.md");
  expect(blockers.map((b) => [b.id, b.status])).toEqual([["pl-2", "in-flight"]]);
});

test("a ticket whose dependencies have all landed reports no blockers", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { depends_on: "[pl-1]" }),
  });
  expect(describeTicket(readTickets(root), "pl-2").blockers).toEqual([]);
});

test("an id nobody filed is named rather than returning nothing", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(() => describeTicket(readTickets(root), "pl-42")).toThrow(/no ticket called "pl-42"/);
});

// The regression guard for repo-6's trap. Dropping the throw out of the reader
// without touching this function made `--show` on the offending ticket *worse*:
// `byId.get` returned `undefined` and the filter read `.status` off it, so the
// named message became an anonymous `TypeError` naming no file at all.
test("a dependency naming no ticket is carried out, not dereferenced", () => {
  const root = repoWithADanglingDependency();
  const { blockers, missing } = describeTicket(readTickets(root), "repo-9");
  expect(blockers).toEqual([]);
  expect(missing).toEqual(["repo-404"]);
});

// `missing` is beside `blockers`, not mixed into it: one is tickets, the other
// is ids of things that are not tickets, and a caller wanting only the first
// must not have to filter the second back out.
test("a real blocker and a dangling id are reported separately, both kept", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "in-flight" }),
    [at("pl-2")]: pl("pl-2", { status: "done" }),
    [at("pl-3")]: pl("pl-3", { depends_on: "[pl-1, pl-2, pl-99]" }),
  });
  const { blockers, missing } = describeTicket(readTickets(root), "pl-3");
  expect(blockers.map((b) => [b.id, b.status])).toEqual([["pl-1", "in-flight"]]);
  expect(missing).toEqual(["pl-99"]);
});

test("a sound ticket in a repo that has a malformed one is described unchanged", () => {
  const root = repoWithADanglingDependency();
  const { ticket: shown, blockers, missing } = describeTicket(readTickets(root), "pl-3");
  expect(shown.file).toBe(at("pl-3"));
  expect(blockers).toEqual([]);
  expect(missing).toEqual([]);
});

// `--ready` was already conservative — a dangling id is not in `done`, so the
// ticket is withheld — and this pins that, because the fix was not allowed to
// make an unstartable ticket look startable.
test("a ticket whose dependency names nothing is withheld from --ready, and only it", () => {
  const tickets = readTickets(repoWithADanglingDependency());
  expect(readyTickets(tickets).map((t) => t.id)).toEqual(["pl-2", "pl-3"]);
});

// ---------------------------------------------------------------------------
// The markdown — `--markdown`
// ---------------------------------------------------------------------------

// The links used to be relative to a `03-STATUS.md` sitting beside `work/`.
// There is no such page any more and the destination is a pull request body, so
// they are repo-root-relative.
test("the markdown links each ticket from the repo root, not from a page beside it", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(renderMarkdown(readTickets(root))).toContain(
    "[pl-1](tools/planner/docs/work/pl-1-slug.md)",
  );
});

test("a note overrides the title, which is the only editorial field there is", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { note: "what the table should say" }) });
  const rendered = renderMarkdown(readTickets(root));
  expect(rendered).toContain("what the table should say");
  expect(rendered).not.toContain("the pl-1 thing");
});

test("a tool with nothing open says so rather than rendering an empty table", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1", { status: "done" }) });
  expect(renderMarkdown(readTickets(root))).toContain(
    "None. Every ticket this tool has is closed.",
  );
});

test("the markdown heads each tool and counts the closed rather than listing them", () => {
  const root = repoWith({
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2", { status: "dropped" }),
    [at("pl-3")]: pl("pl-3"),
  });
  const rendered = renderMarkdown(readTickets(root));
  expect(rendered).toContain("## planner — 1 open of 3");
  expect(rendered).toContain("2 closed tickets not listed.");
  expect(rendered).not.toContain("pl-1-slug.md");
});

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

test("--tool narrows the view to one tool", () => {
  const { stdout, status } = run(["--tool", "downloader", "--ready"]);
  expect(status).toBe(0);
  expect(stdout.length).toBeGreaterThan(0);
  for (const line of stdout.trimEnd().split("\n")) {
    expect(line).toContain("\tdownloader\t");
  }
});

test("--tool with a name no tool has is a named failure, not an empty view", () => {
  const { stdout, stderr, status } = run(["--tool", "sniffer"]);
  expect(status).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toMatch(/no tickets for a tool called "sniffer"/);
});

test("--show prints a ticket's path and the dependencies still open", () => {
  const { stdout, status } = run(["--show", "pl-2"]);
  expect(status).toBe(0);
  expect(stdout).toContain("tools/planner/docs/work/pl-2-container-image.md");
  expect(stdout).toMatch(/unblocked|blocked by/);
});

test("--markdown emits a table, with no generated-region markers to guard", () => {
  const { stdout, status } = run(["--markdown", "--tool", "downloader"]);
  expect(status).toBe(0);
  expect(stdout).toContain("| Ticket ");
  expect(stdout).not.toContain("generated:tickets");
});

// `--write` and `--check` were real until repo-2 retired the file they wrote.
// Ignoring them would hand a reader with muscle memory the default view and let
// them believe a page had just been regenerated.
test("--write and --check are gone, and say so rather than being ignored", () => {
  for (const flag of ["--write", "--check"]) {
    const { stderr, status } = run([flag]);
    expect(status).toBe(1);
    expect(stderr).toContain(`unrecognised argument "${flag}"`);
  }
});

// ---------------------------------------------------------------------------
// One malformed ticket, every mode — repo-6
// ---------------------------------------------------------------------------

// It used to be the whole output, on every one of these, for every tool: the
// reader threw on the third line of `main`, before a view had been chosen. The
// enumeration is deliberate — the defect was not "a mode misbehaves", it was
// "the command does not run" — so each mode asserts that its own payload
// arrived on stdout *and* that the warning arrived on stderr beside it.
test.each([
  ["the default view", [] as string[], "• pl-2"],
  ["--ready", ["--ready"], "pl-2\tplanner"],
  ["--markdown", ["--markdown"], "[pl-2](tools/planner/docs/work/pl-2-slug.md)"],
  ["--tool, on a tool the malformed ticket is not in", ["--tool", "planner"], "• pl-2"],
  ["--show, on an unrelated ticket", ["--show", "pl-3"], "tools/planner/docs/work/pl-3-slug.md"],
])("%s still renders beside a dangling dependency, and exits 0", (_name, args, expected) => {
  const { stdout, stderr, status } = run(args, repoWithADanglingDependency());
  expect(status).toBe(0);
  expect(stdout).toContain(expected);
  expect(stderr.trimEnd().split("\n")).toEqual([DANGLING]);
});

// The negative half of "every other ticket still renders": the same tree minus
// its one malformed ticket produces byte-identical stdout for the views that
// do not list it, and for the ones that do, exactly one row more.
test("a malformed ticket costs its own row and no other", () => {
  const sound = {
    [at("pl-1")]: pl("pl-1", { status: "done" }),
    [at("pl-2")]: pl("pl-2"),
    [at("pl-3")]: pl("pl-3", { depends_on: "[pl-1]" }),
  };
  const healthy = repoWith(sound);
  const malformed = repoWith({
    ...sound,
    [atRepo("repo-9")]: repoTicket("repo-9", { depends_on: "[repo-404]" }),
  });

  for (const args of [["--ready"], ["--tool", "planner"], ["--show", "pl-3"]]) {
    expect(run(args, malformed).stdout, args.join(" ")).toBe(run(args, healthy).stdout);
  }
  // The malformed ticket is a `repo` ticket, so the unnarrowed views gain its
  // section and nothing else loses a line.
  const before = run([], healthy).stdout;
  const after = run([], malformed).stdout;
  expect(after).toContain(before.trimEnd());
  expect(after).toContain("· repo-9");
});

// The sharpest half of the defect: `--json` used to answer a machine with exit
// 1 and zero bytes, which is what "no tickets at all" and "the script is not
// installed" also look like. The payload now says which.
test("--json emits the tickets it could read and a structured account of the one it could not", () => {
  const { stdout, stderr, status } = run(["--json"], repoWithADanglingDependency());
  const payload = JSON.parse(stdout);
  expect(payload.tickets.map((t: { id: string }) => t.id)).toEqual([
    "pl-1",
    "pl-2",
    "pl-3",
    "repo-9",
  ]);
  expect(payload.problems).toEqual([
    {
      file: atRepo("repo-9"),
      kind: "dangling-dependency",
      id: "repo-9",
      dependency: "repo-404",
      message: DANGLING,
    },
  ]);
  expect(stderr.trimEnd().split("\n")).toEqual([DANGLING]);
  // `.github/workflows/ci.yml`'s `check` job is
  // `node scripts/status.mjs --json > /dev/null`, and it is the only thing in
  // CI that reads a ticket at all. It discards stdout, so this exit code is
  // the whole of the strict check — the payload is for a reader, not for it.
  expect(status).toBe(1);
});

test("--json narrowed to a tool still reports a dangling edge outside it", () => {
  const { stdout, status } = run(["--json", "--tool", "planner"], repoWithADanglingDependency());
  const payload = JSON.parse(stdout);
  expect(payload.tickets.map((t: { id: string }) => t.id)).toEqual(["pl-1", "pl-2", "pl-3"]);
  expect(payload.problems).toHaveLength(1);
  expect(status).toBe(1);
});

// The trap in repo-6's Build step 2, end to end: dropping the throw without
// fixing `describeTicket` replaced a named message with a `TypeError`.
test("--show on the malformed ticket names the missing id and does not crash", () => {
  const { stdout, stderr, status } = run(["--show", "repo-9"], repoWithADanglingDependency());
  expect(status).toBe(0);
  expect(stdout).toContain("blocked by  repo-404 (not a ticket)");
  expect(stdout).not.toContain("unblocked");
  expect(stderr).not.toContain("Cannot read properties of undefined");
  expect(stderr.trimEnd().split("\n")).toEqual([DANGLING]);
});

// A healthy tree is silent and exits 0 everywhere, `--json` included — the
// warning is not a thing every run now carries.
test.each([[[] as string[]], [["--ready"]], [["--markdown"]], [["--json"]]])(
  "%s says nothing on stderr when every dependency resolves",
  (args) => {
    const root = repoWith({
      [at("pl-1")]: pl("pl-1", { status: "done" }),
      [at("pl-2")]: pl("pl-2", { depends_on: "[pl-1]" }),
    });
    const { stderr, status } = run(args, root);
    expect(stderr).toBe("");
    expect(status).toBe(0);
  },
);

test("--json on a healthy repo carries an empty problems list, not a missing one", () => {
  const root = repoWith({ [at("pl-1")]: pl("pl-1") });
  expect(JSON.parse(run(["--json"], root).stdout).problems).toEqual([]);
});
