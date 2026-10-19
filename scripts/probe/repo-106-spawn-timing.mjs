/**
 * repo-106's probe: where does `review-record.test.ts` spend its time on the
 * Windows leg? NOT MERGED, ever — this file exists on a throwaway pull request
 * and is deleted with its branch.
 *
 * It lives under `scripts/probe/`, outside `scripts/test/**`, so the `repo`
 * vitest project never runs it and a sibling's preflight merge never reaches it.
 * One file does three jobs, selected by its first argument, because the
 * dispatch allows two new files and the measurement needs three behaviours:
 *
 *   node scripts/probe/repo-106-spawn-timing.mjs timing
 *     Times several `git`, `node` and `oxfmt` spawns and some fixture-shaped
 *     filesystem work, printing every reading. This is the per-spawn number.
 *
 *   node scripts/probe/repo-106-spawn-timing.mjs trace <spec>
 *     Runs vitest on <spec> with this same file preloaded (`--import`) into
 *     every node process in the tree. The preload wraps `spawnSync` and
 *     `execFileSync` and appends one JSON line per spawn to a log file, which
 *     is why the count and time of the `oxfmt` and `git` spawns can be read
 *     even though `review-record.test.ts` mostly runs the CLI as a child
 *     process (where the test's own spy cannot see them). It prints every
 *     record and a summary.
 *
 *   (imported with REPO106_TRACE_LOG set)
 *     The preload itself.
 *
 * Every spawn below passes an argument array and `shell: false`.
 */

import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports, createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const TRACE_LOG = process.env.REPO106_TRACE_LOG;
const IS_MAIN =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]).toLowerCase() === path.resolve(SELF).toLowerCase();

function out(line) {
  process.stdout.write(`${line}\n`);
}

// ---------------------------------------------------------------------------
// The preload: wrap the two synchronous spawners and log each call.
// ---------------------------------------------------------------------------

/** A short label for a spawn: what the repository's own code is asking for. */
function labelFor(file, args) {
  const base = path.basename(String(file)).replace(/\.exe$/iu, "");
  const list = Array.isArray(args) ? args.map(String) : [];
  if (base === "git") {
    // Skip `-C <dir>` pairs so the label is the subcommand.
    const rest = [...list];
    while (rest[0] === "-C" || rest[0] === "-c") rest.splice(0, 2);
    return { kind: "git", label: `git ${rest[0] ?? ""}`.trim() };
  }
  const first = list[0] ?? "";
  if (/oxfmt/u.test(first)) {
    const target = list[list.length - 1] ?? "";
    const section = /review-record-fmt-/u.test(target);
    return { kind: section ? "oxfmt-section" : "oxfmt-ticket", label: "oxfmt" };
  }
  if (first.endsWith("review-record.mjs")) return { kind: "cli", label: "review-record.mjs" };
  return { kind: "other", label: `${base} ${path.basename(first)}`.trim() };
}

function installPreload() {
  const side = (process.argv[1] ?? "").endsWith("review-record.mjs") ? "cli" : "test";
  const wrap = (name) => {
    const original = childProcess[name];
    childProcess[name] = function wrapped(file, args, ...rest) {
      const startedAt = performance.now();
      try {
        return original.call(this, file, args, ...rest);
      } finally {
        const ms = performance.now() - startedAt;
        const { kind, label } = labelFor(file, Array.isArray(args) ? args : []);
        const record = {
          pid: process.pid,
          side,
          kind,
          label,
          epochMs: Date.now(),
          ms: Math.round(ms * 10) / 10,
        };
        try {
          appendFileSync(TRACE_LOG, `${JSON.stringify(record)}\n`);
        } catch {
          // A probe that cannot log must not change what the code under it does.
        }
      }
    };
  };
  wrap("spawnSync");
  wrap("execFileSync");
  // Named imports of a builtin are snapshots; this makes later imports see ours.
  syncBuiltinESMExports();
}

// ---------------------------------------------------------------------------
// timing: per-spawn readings
// ---------------------------------------------------------------------------

const REPEATS = 10;

function stats(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  const median =
    sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    n: values.length,
    min: sorted[0],
    median,
    mean: sum / values.length,
    max: sorted[sorted.length - 1],
  };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function readings(name, fn) {
  const values = [];
  for (let i = 0; i < REPEATS; i += 1) {
    const startedAt = performance.now();
    const status = fn(i);
    const ms = round(performance.now() - startedAt);
    values.push(ms);
    out(`reading ${name} #${i + 1}: ${ms} ms (exit ${status})`);
  }
  const s = stats(values);
  out(
    `summary ${name}: n=${s.n} min=${round(s.min)} median=${round(s.median)} mean=${round(s.mean)} max=${round(s.max)} ms`,
  );
}

function oxfmtEntry() {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("oxfmt/package.json");
  const { bin } = require("oxfmt/package.json");
  return path.resolve(path.dirname(manifest), bin.oxfmt);
}

function spawnStatus(file, args, cwd) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", shell: false });
  return result.error ? `error ${result.error.code}` : String(result.status);
}

function runTiming() {
  out(`platform=${process.platform} node=${process.version} arch=${process.arch}`);
  out(`cpus=${os.cpus().length} ${os.cpus()[0]?.model ?? ""}`);
  const root = mkdtempSync(path.join(os.tmpdir(), "repo106-timing-"));
  const oxfmt = oxfmtEntry();
  try {
    readings("git --version", () => spawnStatus("git", ["--version"], root));
    readings("node -e (empty program)", () => spawnStatus(process.execPath, ["-e", ""], root));

    // The fixture shape: `withTicketRepo` runs init, two configs, add, commit.
    readings("fixture: mkdtemp + writeFile (no spawn)", (i) => {
      const dir = mkdtempSync(path.join(root, `fs-${i}-`));
      writeFileSync(path.join(dir, "a.md"), "# a\n");
      return 0;
    });
    readings("git init -q -b main (fresh dir)", (i) => {
      const dir = mkdtempSync(path.join(root, `init-${i}-`));
      return spawnStatus("git", ["init", "-q", "-b", "main"], dir);
    });

    const repo = mkdtempSync(path.join(root, "repo-"));
    spawnStatus("git", ["init", "-q", "-b", "main"], repo);
    spawnStatus("git", ["config", "user.email", "probe@example.test"], repo);
    spawnStatus("git", ["config", "user.name", "probe"], repo);
    writeFileSync(path.join(repo, "t.md"), "# t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    spawnStatus("git", ["add", "-A"], repo);
    spawnStatus("git", ["commit", "-qm", "seed"], repo);
    readings("git -C <repo> rev-parse --show-toplevel", () =>
      spawnStatus("git", ["-C", repo, "rev-parse", "--show-toplevel"], root),
    );
    readings("git -C <repo> show HEAD:t.md", () =>
      spawnStatus("git", ["-C", repo, "show", "HEAD:t.md"], root),
    );
    readings("git add -A + git commit --allow-empty (two spawns)", (i) => {
      spawnStatus("git", ["add", "-A"], repo);
      return spawnStatus("git", ["commit", "-qm", `c${i}`, "--allow-empty"], repo);
    });

    // The same invocation review-record.mjs uses: oxfmt's own bin under node.
    readings("oxfmt <file.md> (node + oxfmt bin, in place)", (i) => {
      const file = path.join(root, `fmt-${i}.md`);
      writeFileSync(file, "# t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
      return spawnStatus(process.execPath, [oxfmt, file], root);
    });
    readings("oxfmt --version (node + oxfmt bin)", () =>
      spawnStatus(process.execPath, [oxfmt, "--version"], root),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// trace: run vitest with the preload and summarise the log
// ---------------------------------------------------------------------------

function summarise(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.side}-side  ${r.kind.padEnd(13)} ${r.label}`;
    const group = groups.get(key) ?? [];
    group.push(r.ms);
    groups.set(key, group);
  }
  out("== trace summary: spawns by process side, kind and label ==");
  out("side is where the spawn was made: 'test' = the vitest worker, 'cli' = review-record.mjs");
  let testTotal = 0;
  let cliTotal = 0;
  for (const [key, values] of [...groups.entries()].toSorted()) {
    const total = values.reduce((a, b) => a + b, 0);
    if (key.startsWith("test")) testTotal += total;
    else cliTotal += total;
    out(
      `${key}: count=${values.length} total=${Math.round(total)} ms mean=${round(total / values.length)} ms max=${round(Math.max(...values))} ms`,
    );
  }
  out(`test-side spawn time, all kinds: ${Math.round(testTotal)} ms`);
  out(
    `cli-side spawn time, all kinds: ${Math.round(cliTotal)} ms (nested inside the test-side cli rows)`,
  );
  out(`records: ${records.length}`);
}

function runTrace(spec) {
  if (!spec) {
    out("usage: node scripts/probe/repo-106-spawn-timing.mjs trace <spec file>");
    process.exit(2);
  }
  const log = path.join(mkdtempSync(path.join(os.tmpdir(), "repo106-trace-")), "spawns.ndjson");
  writeFileSync(log, "");
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("vitest/package.json");
  const { bin } = require("vitest/package.json");
  const vitestEntry = path.resolve(
    path.dirname(manifest),
    typeof bin === "string" ? bin : bin.vitest,
  );
  const preload = `--import ${pathToFileURL(SELF).href}`;
  const env = {
    ...process.env,
    REPO106_TRACE_LOG: log,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} ${preload}`.trim(),
  };
  const run = spawnSync(
    process.execPath,
    [vitestEntry, "run", spec, "--reporter=verbose", "--slowTestThreshold=0"],
    { env, stdio: "inherit", shell: false },
  );
  const records = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  out(`== trace records (${records.length}), one per spawn ==`);
  for (const r of records) out(JSON.stringify(r));
  summarise(records);
  process.exit(run.status ?? 1);
}

if (TRACE_LOG && !IS_MAIN) {
  installPreload();
} else if (IS_MAIN) {
  const mode = process.argv[2];
  if (mode === "timing") runTiming();
  else if (mode === "trace") runTrace(process.argv[3]);
  else {
    out("usage: node scripts/probe/repo-106-spawn-timing.mjs timing | trace <spec file>");
    process.exit(2);
  }
}
