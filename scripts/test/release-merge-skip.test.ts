/**
 * repo-142: a release merge skips the gates its pull request already ran. The
 * condition is hand-copied into four workflows, eleven times, because Actions
 * has no shared expression — and the skip is only safe in a file that also
 * splits its concurrency group, or a release merged straight after a code merge
 * cancels that code's `main` run and then skips its own. These read the files
 * as text, since no YAML parser is in the tree.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const RELEASE =
  "startsWith(github.event.head_commit.message, 'chore(') && contains(github.event.head_commit.message, '): release ')";

/** The tool workflows whose every job skips; `ci.yml` skips its matrix only. */
const TOOL_WORKFLOWS = ["ledger", "downloader", "planner"].map((t) => `.github/workflows/${t}.yml`);
const ALL = [".github/workflows/ci.yml", ...TOOL_WORKFLOWS];

/** The top-level job names, by their two-space-indented key under `jobs:`. */
function jobs(text: string): string[] {
  const body = text.slice(text.indexOf("\njobs:\n"));
  return [...body.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1] as string);
}

test("the condition matches the title release-please writes", () => {
  const config = JSON.parse(read("release-please-config.json")) as {
    "pull-request-title-pattern": string;
  };
  expect(config["pull-request-title-pattern"]).toBe("chore(${component}): release ${version}");
});

test("every file that skips also splits its concurrency group, with the same condition", () => {
  for (const file of ALL) {
    const text = read(file);
    const group = text.split("\n").filter((l) => /^ {2}group: /.test(l));
    expect(group, file).toHaveLength(1);
    expect(group[0], file).toContain(`\${{ ${RELEASE} && '-release' || '' }}`);
    expect(text.split(`!(${RELEASE})`).length - 1, file).toBeGreaterThan(0);
  }
});

test("every job in a tool workflow carries the skip", () => {
  for (const file of TOOL_WORKFLOWS) {
    const text = read(file);
    const names = jobs(text);
    expect(names.length, file).toBeGreaterThan(0);
    const ifs = text.split("\n").filter((l) => l === `    if: "\${{ !(${RELEASE}) }}"`);
    expect(ifs, file).toHaveLength(names.length);
  }
});

test("ci.yml skips its test matrix, and only that", () => {
  const text = read(".github/workflows/ci.yml");
  const ifs = text.split("\n").filter((l) => l.includes(RELEASE) && l.startsWith("    if: "));
  expect(ifs).toEqual([`    if: "needs.changes.outputs.code == 'true' && !(${RELEASE})"`]);
  const at = text.indexOf(ifs[0] as string);
  expect(text.lastIndexOf("\n  test:\n", at)).toBeGreaterThan(
    text.lastIndexOf("\n  changes:\n", at),
  );
});
