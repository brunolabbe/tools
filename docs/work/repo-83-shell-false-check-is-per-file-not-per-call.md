---
id: repo-83
tool: repo
title: spawn-safety's `shell: false` check is per file, not per call, and nothing guards the widened pattern
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-83 — spawn-safety's `shell: false` check is per file, not per call

## Why

`packages/core/test/spawn-safety.test.ts`'s "every file that spawns says
`shell: false` explicitly" — widened by repo-77 to `spawn`, `spawnSync`,
`execFile` and `execFileSync` — asks whether `shell: false` appears **anywhere
in the file**, not whether each call itself carries it. A file with nine
`spawnSync` calls and one `shell: false` string anywhere passes in full; the
other eight calls are never individually asked.

**Measured at repo-77's pushed head**, `node
<scratch>/gate1/percall.mjs "$(pwd)"` — the gate's own per-call script, not
retyped: 484 files scanned, 28 import `node:child_process`, **137 calls**
total, **14 lacking their own `shell: false`**, 0 files failing the whole-file
test. (The gate reported 17 lacking at repo-77's `42e6405`; this ticket's own
mechanical round fixed 3 of them in `scripts/test/citations.test.ts`, so 14
remain — the same population the gate named minus those three.) The 14 are in
`scripts/preflight.mjs` (2), `scripts/review-record.mjs` (7) and
`scripts/test/preflight.test.ts` (5); none sets a truthy `shell`, so nothing
here runs a shell — the gap is that nothing checks it call by call.

**Nothing guards the widened pattern either.** repo-75 added a test asserting
the scan reaches `scripts/` and `.mjs`, so narrowing the roots back to
workspaces' `src` would fail something. The call pattern has no equivalent: a
scratch copy of the test with the pattern narrowed from
`\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(` back to `\bspawn\s*\(`
alone still passes, 0 offenders, at repo-77's head — every file that has a
`spawnSync`/`execFile`/`execFileSync` call already has a `spawn(` call or a
`shell: false` string somewhere else in the same file, so the widening this
ticket's own commit and repo-77 depend on is not enforced by anything that
would fail if it regressed.

## The decision — answered 2026-09-30: (a), the per-call check, but not this batch

**Asked of the owner** by the orchestrator via `AskUserQuestion` on 2026-09-30,
with three options: build (a) this batch; **(a), but not this batch**; (b)
accept the file-level check. **Answered by the owner: (a), but not this batch.**
The reason: repo-47 was editing `scripts/preflight.mjs` in the same batch, and
(a) rewrites calls in it. The cost carried with the answer: the count of 14
below was measured at `6418f17`, and `scripts/review-record.mjs` has since grown
by about 850 lines (repo-80) and `scripts/preflight.mjs` changed (repo-47), so
the builder re-measures first. Nothing is built; `status` is `ready`.

The options as filed:

- **(a) — recommended.** Make "every file that spawns says `shell: false`
  explicitly" per call: fail a call that neither inlines `shell: false` nor
  references (by name, including a spread) an object literal in the same file
  that does — the same association `percall.mjs`'s heuristic already performs
  for measurement. Add a guard test in the shape of repo-75's, asserting the
  narrowed pattern fails on a fixture, so a future narrowing back to `spawn(`
  regresses loudly instead of silently. Fixes the 14 calls above as part of
  the same ticket, since the rewritten check would fail on them immediately.
  Real cost: the per-call association is heuristic (a call whose options come
  from a destructured, computed, or cross-file constant is not "the same
  file, by name" and would need either a documented limit or more machinery),
  so this is real work, not a rename — worth a `standard` rating, not
  `mechanical`.
- **(b) — don't file further work; accept the file-level check as the
  convention.** The 14 calls set no truthy `shell`, so the actual security
  property — no shell reaches a child process — already holds; a per-call
  check would catch an omission of the explicit marker, not a live
  vulnerability, and the whole-file check already enforces the rule
  `CLAUDE.md` states ("never invoke a shell"). Leaves the call pattern
  unguarded, as-is.

## Build (decided: (a), deferred — not built)

1. Rewrite "every file that spawns says `shell: false` explicitly" to
   evaluate each matched call's own argument list plus, where a call passes a
   named identifier as its options argument, that identifier's own object
   literal in the same file (as `percall.mjs` does) — fail a call neither
   route reaches.
2. Add a test in `spawn-safety.test.ts` asserting the pattern narrowed to
   `spawn(` alone fails against a fixture that only calls `spawnSync` without
   `shell: false` — the guard repo-75 gave the scan's roots, given to the call
   pattern too.
3. Fix the 14 calls the new check finds red: `scripts/preflight.mjs` (2),
   `scripts/review-record.mjs` (7), `scripts/test/preflight.test.ts` (5) —
   re-measure first, this is a snapshot.

## Done when (decided: (a), deferred — not built)

- A call to `spawnSync`, `execFile` or `execFileSync` whose own options carry
  no `shell: false`, in a file that has one elsewhere, fails
  `spawn-safety.test.ts`, shown red before the fix.
- A pattern narrowed back to `spawn(` alone fails the new guard test.
- Every call in the scan passes the per-call check.
- `npm run check` and the `core` and `repo` suites pass.

## Log

- 2026-09-29 — Filed from repo-77's gate finding (`nfr:maintainability`, its
  low: "nothing guards the widened pattern"), on the owner's choice of "File
  it" over "Don't file", put by the orchestrator via `AskUserQuestion`.
  Reproduced both halves at repo-77's head (`42e6405`) before filing: the
  gate's own `percall.mjs` reports 137 calls, 14 lacking their own
  `shell: false` after repo-77's mechanical round fixed 3 in
  `scripts/test/citations.test.ts` (17 before that round); a scratch copy of
  `spawn-safety.test.ts` with the call pattern narrowed to `spawn(` alone
  still passes, 0 offenders, over the same tree. No fix made here — the
  decision above is open.
- 2026-09-29 — **Re-run reproduction, addressing gate 2's finding that this
  ticket's numbers could not be re-run from the repository:** the per-call
  count came from a script living only in a session's scratchpad, the
  narrowed-pattern result gave no command at all, and the Log named `42e6405`
  where the count of 14 holds only at repo-77's later fixer-round head. Both
  numbers hold at **`6418f17`**, repo-77's landed head — reproduced fresh here
  with a script and a command anyone can run from a checkout, no scratchpad
  needed.

  The per-call script (save as `percall.mjs`, run `node percall.mjs
"$(pwd)"` from the repository root):

  ```js
  // Per-call enumeration: every call to spawn/spawnSync/execFile/execFileSync in
  // every scanned source file, and whether that call's own options carry shell:false.
  import { execFileSync } from "node:child_process";
  import fs from "node:fs";
  import path from "node:path";
  const root = process.argv[2];
  const listed = process.argv[3]
    ? fs.readFileSync(process.argv[3], "utf8")
    : execFileSync("g" + "it", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: root,
        encoding: "utf8",
        shell: false,
        maxBuffer: 1 << 26,
      });
  const files = [...new Set(listed.split("\0"))].filter((f) =>
    /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f),
  );
  const blank = (s) => s.replace(/[^\n]/g, " ");
  function code(t) {
    return t
      .replace(/\/\*[\s\S]*?\*\//g, blank)
      .replace(/(^|[^:])(\/\/.*)$/gm, (m, a, b) => a + blank(b));
  }
  let total = 0,
    lacking = [],
    importing = 0,
    fileFail = [];
  for (const f of files) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    const t = code(raw);
    if (!/from\s+["']node:child_process["']/.test(t)) continue;
    importing++;
    const consts = {};
    for (const m of t.matchAll(/const\s+(\w+)\s*=\s*\{([^}]*)\}/g))
      consts[m[1]] = /\bshell\s*:\s*false/.test(m[2]);
    const re = /\b(spawn|spawnSync|execFile|execFileSync)\s*\(/g;
    let m;
    const fileHas = /\bshell\s*:\s*false/.test(t);
    const spawnsAny = /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(/.test(t);
    if (spawnsAny && !fileHas) fileFail.push(f);
    while ((m = re.exec(t))) {
      // skip definitions/imports like "function spawn(" or "import { spawn }"
      const before = t.slice(Math.max(0, m.index - 12), m.index);
      if (/function\s*$/.test(before)) continue;
      let depth = 0,
        i = m.index + m[0].length - 1,
        end = -1;
      for (; i < t.length; i++) {
        const c = t[i];
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const args = t.slice(m.index, end + 1);
      total++;
      const line = t.slice(0, m.index).split("\n").length;
      let ok = /\bshell\s*:\s*false/.test(args);
      let via = ok ? "inline" : "";
      if (!ok)
        for (const [k, v] of Object.entries(consts))
          if (v && new RegExp(`\\b${k}\\b`).test(args)) {
            ok = true;
            via = k;
          }
      if (!ok) lacking.push(`${f}:${line} ${args.replace(/\s+/g, " ").slice(0, 110)}`);
    }
  }
  console.log(
    `files scanned ${files.length}, importing child_process ${importing}, calls ${total}, calls lacking own shell:false ${lacking.length}`,
  );
  console.log(`files failing whole-file test: ${fileFail.length} ${fileFail.join(" ")}`);
  for (const l of lacking) console.log("  " + l);
  ```

  Run at `6418f17` (`node percall.mjs "$(pwd)"` from the repository root):

  ```
  files scanned 484, importing child_process 28, calls 137, calls lacking own shell:false 14
  files failing whole-file test: 0
  ```

  The narrowed-pattern check — does the whole-file test still pass (0
  offenders) if the call pattern is narrowed back to `spawn(` alone — as a
  command with its own output, needing nothing but a checkout (save as
  `narrow-check.mjs`, run `node narrow-check.mjs "$(pwd)"`):

  ```js
  import { execFileSync } from "node:child_process";
  import fs from "node:fs";
  const root = process.argv[2] ?? ".";
  const files = execFileSync(
    "g" + "it",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", shell: false, maxBuffer: 1 << 26 },
  )
    .split("\0")
    .filter(Boolean)
    .filter((f) => /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f));
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const code = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])(\/\/.*)$/gm, (m, a, b) => a + blank(b));
  const fail = [];
  for (const f of files) {
    let raw;
    try {
      raw = fs.readFileSync(`${root}/${f}`, "utf8");
    } catch {
      continue;
    }
    const t = code(raw);
    if (!/from\s+["']node:child_process["']/.test(t)) continue;
    const spawnsNarrow = /\bspawn\s*\(/.test(t);
    const hasFalse = /\bshell\s*:\s*false/.test(t);
    if (spawnsNarrow && !hasFalse) fail.push(f);
  }
  console.log(
    `files failing narrowed-pattern (spawn( only) test: ${fail.length} ${fail.join(" ")}`,
  );
  ```

  Run at `6418f17`:

  ```
  files failing narrowed-pattern (spawn( only) test: 0
  ```

  Both numbers this ticket's Why and Log cite — 137 calls/14 lacking, and 0
  offenders under the narrowed pattern — hold at `6418f17` and are reproduced
  by the two scripts above, run from a plain checkout, no scratchpad path
  required.

- 2026-09-30 — **Decided via AskUserQuestion:** option (a), the per-call check,
  deferred to a later batch because repo-47 was editing `scripts/preflight.mjs` in
  the same batch. The filer's recommendation was chosen. The ticket's count of 14
  calls was measured at `6418f17`. The scripts `scripts/review-record.mjs` and
  `scripts/preflight.mjs` have changed since then, so the builder will
  re-measure before building.
