/**
 * `.oxfmtrc.json`'s ignore list, held to the tree it claims to describe.
 *
 * repo-4 is the reason this exists: the entry meant to keep the formatter off
 * checked-in fixtures read `test/fixtures/`, which **matched nothing**, and
 * every fixture in the repo was being formatted like source for months. The
 * entry looked right, the config parsed, `npm run check` was green, and the
 * only way to find out was to notice a captured payload had changed shape.
 *
 * That is the same defect this file's sibling `repo-12` is about — a convention
 * with nothing mechanical behind it — so it is checked the same way: by asking
 * the tool, not by reimplementing its matcher. **oxfmt answers the question
 * directly.** Given a path it is configured to skip it exits 2 with "All
 * matched files may have been excluded by ignore rules"; given one it formats it
 * exits 0 and counts the file. Both halves are asserted, because an oracle that
 * says "excluded" to everything would pass the first on its own.
 *
 * It lives in `packages/core/test/` beside the other repo-wide scans, for the
 * reason `spawn-safety` does: the toolchain is not one tool's, and a check
 * scoped to a tool is a check nobody runs when the second tool arrives.
 *
 * What this cannot cover: `dist/`, `coverage/`, `node_modules/` and `storage/`
 * are generated, so a fresh checkout may hold no file under any of them and
 * "matches something" has no meaning to assert. They are also the entries that
 * cannot rot in repo-4's way — none has an internal slash, so none is anchored.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const REPO = path.resolve(import.meta.dirname, "../../..");
const OXFMT = path.join(REPO, "node_modules", ".bin", "oxfmt");

/** The extensions oxfmt handles here. A path outside this list is never a target,
 *  so including one would let "excluded by ignore rules" mean "nothing to do". */
const FORMATTABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md"]);

/**
 * `.oxfmtrc.json` is JSONC despite the extension, and one of its entries is
 * explained by a comment. Only whole-line comments are stripped: the `$schema`
 * value contains `//` and must survive.
 */
function ignorePatterns(): string[] {
  const text = fs.readFileSync(path.join(REPO, ".oxfmtrc.json"), "utf8");
  const config: unknown = JSON.parse(text.replaceAll(/^\s*\/\/.*$/gmu, ""));
  const patterns = (config as { ignorePatterns?: unknown }).ignorePatterns;
  expect(Array.isArray(patterns)).toBe(true);
  return patterns as string[];
}

/** Tracked files only — `git ls-files` costs one call and cannot wander into
 *  `node_modules`, which a directory walk here would. */
function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", shell: false })
    .split("\n")
    .filter((line) => line !== "");
}

/** oxfmt's own verdict on a set of paths: did its ignore rules take all of them? */
function allExcluded(files: string[]): { excluded: boolean; status: number; output: string } {
  const result = spawnSync(OXFMT, ["--check", ...files], {
    cwd: REPO,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    excluded: /excluded by ignore rules/u.test(output),
    status: result.status ?? -1,
    output,
  };
}

// repo-4's rule, stated once so a future entry cannot repeat it: these are
// gitignore-shaped patterns, an entry with an internal slash is anchored to the
// config's directory, and the config sits at the repo root. So `web/dist/`
// would be inert unless a `web/dist` exists *there* — and `**/` is how you say
// "at any depth". The entry that caused repo-4 fails this and nothing else in
// the list does.
test("an anchored ignore pattern names a path that exists at the root", () => {
  const inert = ignorePatterns().filter((pattern) => {
    const body = pattern.replace(/\/$/u, "");
    if (!body.includes("/") || body.startsWith("**/") || body.startsWith("/")) return false;
    return !fs.existsSync(path.join(REPO, body));
  });
  expect(inert, "anchored to the repo root, where nothing of that name exists").toEqual([]);
});

// The positive half, and the one that would have caught repo-4 the day it
// landed: every checked-in file the config claims to exempt, handed to oxfmt at
// once. If a single one of them were still a target, oxfmt would find work to do
// and say so instead.
test("every checked-in file the config exempts is one oxfmt refuses to touch", () => {
  const exempt = trackedFiles().filter(
    (file) =>
      FORMATTABLE.has(path.extname(file)) &&
      (file.includes("test/fixtures/") ||
        path.basename(file) === "CHANGELOG.md" ||
        file.startsWith(".claude/")),
  );
  // A scan that found nothing would pass the assertion below by default, which
  // is exactly how the original defect stayed invisible.
  expect(exempt.length).toBeGreaterThan(20);

  const { excluded, status, output } = allExcluded(exempt);
  expect(output).toContain("excluded by ignore rules");
  expect(excluded).toBe(true);
  expect(status).toBe(2);
});

// The negative half, twice over. It proves the oracle above discriminates at
// all, and it pins the boundary `.claude/rules/testing.md` warns about:
// broadening the entry to `**/fixtures/` would swallow this file, which is
// TypeScript the repo does want formatted.
test.each([["tools/downloader/e2e/fixtures/hls-origin.ts"], ["scripts/status.mjs"]])(
  "%s is formatted, not exempt",
  (file) => {
    expect(fs.existsSync(path.join(REPO, file)), `${file} moved — repoint this case`).toBe(true);
    expect(allExcluded([file]).excluded).toBe(false);
  },
);
