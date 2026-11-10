/**
 * What the split of a tool's tests into an isolated and a non-isolated vitest
 * project must not lose (repo-129). The split is made by `vitest.isolation.ts`
 * and a container file per tool; the claim worth holding is the one the owner
 * would otherwise find out the hard way: `--project <tool>` still runs every
 * one of the tool's test files, each exactly once, and a file that mocks a
 * module is never in the half that shares a module graph between files.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { NEEDS_ISOLATION } from "../../vitest.isolation.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The test files on disk under `<parent>/<package>/test`, found without vitest. */
function testFilesOnDisk(parent: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })) {
    const dir = `${parent}/${entry.name}/test`;
    if (!entry.isDirectory() || !fs.existsSync(path.join(REPO_ROOT, dir))) continue;
    for (const file of fs.readdirSync(path.join(REPO_ROOT, dir), {
      recursive: true,
      encoding: "utf8",
    })) {
      const parts = file.split(/[\\/]/u);
      if (/\.test\.tsx?$/u.test(file) && !parts.includes("node_modules")) {
        found.push(`${dir}/${parts.join("/")}`);
      }
    }
  }
  return found.toSorted();
}

/** `vitest list --filesOnly` through the installed entry under this node, never a shell. */
function listed(projects: string[]): { project: string; file: string }[] {
  const manifest = createRequire(import.meta.url).resolve("vitest/package.json");
  const bin = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { bin: { vitest: string } }).bin
    .vitest;
  const vitest = path.join(path.dirname(manifest), bin);
  const result = spawnSync(
    process.execPath,
    [vitest, "list", "--filesOnly", ...projects.flatMap((project) => ["--project", project])],
    { cwd: REPO_ROOT, encoding: "utf8", shell: false },
  );
  // The spawn itself, so a process that never started cannot read as an empty list.
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout
    .split("\n")
    .map((line) => /^\[([^\]]+)\] (\S+)$/u.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => ({ project: match[1] ?? "", file: match[2] ?? "" }));
}

const SPLIT_TOOLS = ["downloader", "planner", "ledger"];

test("--project <tool> lists every one of the tool's test files, once each (repo-129)", () => {
  for (const tool of SPLIT_TOOLS) {
    const files = listed([tool]).map((entry) => entry.file);
    expect(files.toSorted(), tool).toEqual(testFilesOnDisk(`tools/${tool}`));
  }
});

test("a test file that mocks, stubs or resets modules is in the isolated half (repo-129)", () => {
  const everything = listed([]);
  const byTool = new Map<string, string[]>();
  for (const { project, file } of everything) {
    if (!project.endsWith(" (isolated)")) continue;
    const tool = project.slice(0, -" (isolated)".length);
    byTool.set(tool, [...(byTool.get(tool) ?? []), file]);
  }
  for (const tool of SPLIT_TOOLS) {
    const mocking = testFilesOnDisk(`tools/${tool}`).filter((file) =>
      NEEDS_ISOLATION.test(fs.readFileSync(path.join(REPO_ROOT, file), "utf8")),
    );
    expect(mocking.length, `${tool} has files that mock`).toBeGreaterThan(0);
    expect(byTool.get(tool) ?? [], tool).toEqual(expect.arrayContaining(mocking));
  }
  // And nothing is run twice across the halves of any project.
  const seen = everything.map((entry) => entry.file);
  expect(new Set(seen).size).toBe(seen.length);
});
