/**
 * `.oxfmtrc.json`'s ignore list, held to the tree it claims to describe.
 *
 * repo-4 is the reason this exists: the entry meant to keep the formatter off
 * checked-in fixtures read `test/fixtures/`, which **matched nothing**, and
 * every fixture in the repo was being formatted like source for months. The
 * entry looked right, the config parsed, `npm run check` was green, and the only
 * way to find out was to notice that a captured payload had changed shape.
 *
 * It lives in `packages/core/test/` beside the other repo-wide scans, for the
 * reason `spawn-safety` does: the toolchain is not one tool's, and a check
 * scoped to a tool is a check nobody runs when the second tool arrives.
 *
 * **Ask oxfmt, and ask it for an effect rather than a sentence.** Reimplementing
 * its matcher here would test this file's copy of the rule instead of the rule.
 * But the first version of this test asked oxfmt and then asserted on the
 * *wording* of its diagnostic — "All matched files may have been excluded by
 * ignore rules" — which pinned the suite to a string outside this repo's
 * control. So the probe below writes deliberately misformatted files at paths
 * the config claims to exempt, runs the formatter over them, and asks whether
 * the bytes moved. A reworded diagnostic cannot break that, and neither can a
 * platform that routes streams differently.
 *
 * **Every "must not move" file has a same-content twin that must**, which is
 * what stops the assertion passing vacuously: if oxfmt simply had nothing to say
 * about that content, the twin would prove it.
 *
 * What this cannot see: whether the tree still *keeps* its fixtures where the
 * pattern looks. `git ls-files` answers that separately below, and the rule that
 * fixtures are real captured payloads under `test/fixtures/` lives in the root
 * `CLAUDE.md`. `dist/`, `coverage/`, `node_modules/` and `storage/` are also out
 * of scope: they are generated, so a fresh checkout may hold no file under any
 * of them, and none has an internal slash, so none can rot in repo-4's way.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { expect, test } from "vitest";

const REPO = path.resolve(import.meta.dirname, "../../..");

/**
 * The formatter, launched as a script under this same node rather than through
 * `node_modules/.bin/oxfmt`.
 *
 * That shim is a symlink to a file whose only portability is a `#!` line, so
 * spawning it without a shell works on Linux and fails on Windows, where npm
 * writes `.cmd` and `.ps1` shims beside it and node refuses to spawn those
 * without a shell — which this repo forbids. The Windows leg of CI found this
 * the honest way: the spawn failed, both pipes came back empty, and the
 * assertion that read them reported a missing *message* rather than a missing
 * *process*. Resolving the package and running its `bin` entry under
 * `process.execPath` has no platform-specific spelling at all.
 */
const require = createRequire(import.meta.url);
const OXFMT = (() => {
  const manifest = require.resolve("oxfmt/package.json");
  const { bin } = require("oxfmt/package.json") as { bin: { oxfmt: string } };
  return path.resolve(path.dirname(manifest), bin.oxfmt);
})();

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

/** Run the formatter in write mode over one path, and refuse to be quiet about
 *  a process that never ran — the failure mode that cost a Windows CI leg. */
function format(target: string): void {
  const result = spawnSync(process.execPath, [OXFMT, target], {
    cwd: REPO,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  expect(result.error, `oxfmt did not run: ${result.error?.message ?? ""}`).toBeUndefined();
  expect(result.status, `${result.stdout ?? ""}${result.stderr ?? ""}`).toBe(0);
}

// repo-4's rule, stated once so a future entry cannot repeat it: these are
// gitignore-shaped patterns, an entry with an internal slash is anchored to the
// config's directory, and the config sits at the repo root. So `web/dist/` would
// be inert unless a `web/dist` exists *there* — and `**/` is how you say "at any
// depth". The entry that caused repo-4 fails this; nothing in the list does now.
test("an anchored ignore pattern names a path that exists at the root", () => {
  const inert = ignorePatterns().filter((pattern) => {
    const body = pattern.replace(/\/$/u, "");
    if (!body.includes("/") || body.startsWith("**/") || body.startsWith("/")) return false;
    return !fs.existsSync(path.join(REPO, body));
  });
  expect(inert, "anchored to the repo root, where nothing of that name exists").toEqual([]);
});

// The other half of repo-4, and the half a pattern test cannot give: the entry
// has to point where the fixtures actually are. A tree that moved them to
// `test/data/` would satisfy every assertion below and protect nothing.
test("the tree still keeps its fixtures where the pattern looks for them", () => {
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: REPO,
    encoding: "utf8",
    shell: false,
  }).split("\n");
  expect(tracked.filter((file) => file.includes("test/fixtures/")).length).toBeGreaterThan(20);
});

// One throwaway directory inside the repo — it has to be inside, because the
// config is anchored to the repo root and a tree somewhere else would be
// answering a different question.
//
// Each `true` is a file the config claims to exempt; each `false` is the same
// content at a path it does not, which is what makes the exemption observable
// rather than a coincidence. `fixtures/probe.json` is the boundary
// `.claude/rules/testing.md` names from the other side: broadening the entry to
// `**/fixtures/` would exempt it here, and would exempt
// `tools/downloader/e2e/fixtures/hls-origin.ts` in the real tree, which is
// TypeScript the repo does want formatted. Written as line comments because
// `**/` closes a block comment, which is a mistake worth making only once.
const UGLY_JSON = '{ "a":1,   "b": [ 1,2 ] }\n';
const UGLY_MD = "#  Title\n\n\n\nText  with   spaces.\n";

const PROBE: Array<{ file: string; body: string; exempt: boolean }> = [
  { file: "test/fixtures/probe.json", body: UGLY_JSON, exempt: true },
  { file: "CHANGELOG.md", body: UGLY_MD, exempt: true },
  { file: "probe.json", body: UGLY_JSON, exempt: false },
  { file: "notes.md", body: UGLY_MD, exempt: false },
  { file: "fixtures/probe.json", body: UGLY_JSON, exempt: false },
];

test("the formatter rewrites what the config does not exempt, and only that", () => {
  // The pid keeps two suites running at once from writing over each other.
  const dir = `oxfmt-probe-${process.pid}`;
  const root = path.join(REPO, dir);
  try {
    for (const { file, body } of PROBE) {
      const full = path.join(root, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, body);
    }

    format(dir);

    const moved = PROBE.filter(
      ({ file, body }) => fs.readFileSync(path.join(root, file), "utf8") !== body,
    ).map(({ file }) => file);

    expect(moved.toSorted()).toEqual(
      PROBE.filter((probe) => !probe.exempt)
        .map((probe) => probe.file)
        .toSorted(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
