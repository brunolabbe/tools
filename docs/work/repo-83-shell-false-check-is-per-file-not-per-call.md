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

## Build (decided: (a); built 2026-10-01)

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

## Done when (decided: (a); built 2026-10-01)

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
- 2026-10-01 — **Deferral lifted and built, option (a).** The owner selected
  repo-83 for this batch at intake on 2026-10-01 (asked via `AskUserQuestion`,
  "which groups go into this batch", the repo-tooling group chosen); the
  deferral's stated reason was repo-47 editing `scripts/preflight.mjs`, and
  repo-47 merged as `9fadda7`. Built at base `b7fb3fb`.
  - **The brief's population was stale, as it warned.** Re-measured by running
    the brief's own `percall.mjs` (extracted from this file's first code block)
    at `b7fb3fb`: `files scanned 493, importing child_process 31, calls 157,
calls lacking own shell:false 12`, against the brief's 28 / 137 / 14. By
    file the brief's `preflight.mjs (2), review-record.mjs (7),
preflight.test.ts (5)` is now `preflight.mjs (2), review-record.mjs (2),
preflight.test.ts (5)` plus three in `scripts/citations-gate.mjs` that did
    not exist at the brief's head. Those three are a false positive of
    `percall.mjs`, not of the new check: each passes `options`, a binding that
    spreads `GIT_EXEC_OPTIONS` (`scripts/citations-gate.mjs:811`, `:362`), which
    says `shell: false` — `percall.mjs` resolves one level of name and not a
    spread, and the new check resolves the chain. Real offenders: **9**.
  - **Red before the fix.** The rewritten test run over the unfixed tree:
    `npx vitest run packages/core/test/spawn-safety.test.ts` failed 1 of 10
    ("every file that spawns says `shell: false` at each of its calls") and
    named exactly the nine — `scripts/preflight.mjs:1011` and `:1658`,
    `scripts/review-record.mjs:317` and `:346`, `scripts/test/preflight.test.ts:76`,
    `:704`, `:810`, `:839`, `:862`. After adding `shell: false` to each, the same
    command passes 10 of 10; `percall.mjs` over the tip reports `calls lacking
own shell:false 3`, only the three spread-resolved ones above.
  - **The guard fails when the call list narrows.** With `SPAWN_CALLS` in
    `packages/core/test/support/spawn-calls.ts` temporarily set to `["spawn"]`,
    the same command failed 3 of 10 — "a call lacking its own `shell: false`
    fails beside one that has it", "a literal that does not say it, or options
    built elsewhere, do not excuse a call" and "every member of SPAWN_CALLS is
    asked" (`expected [ 'spawn' ] to include 'spawnSync'`). The production scan
    itself stays green under that mutation, which is the brief's own finding:
    nothing in the tree differs, so only the fixtures can notice. Restored
    afterwards.
  - **Where the check lives.** `callsWithoutShellFalse` and `SPAWN_CALLS` in
    `packages/core/test/support/spawn-calls.ts`, beside `workspaces.ts`, rather
    than inline in the test, so the fixtures can call it with a narrowed list.
    A call is safe when its own argument list says `shell: false`, or names an
    identifier whose same-file object literal does — directly or through a
    spread, to a fixpoint. **Documented limits**, in that file's header: options
    built by a call, destructured, imported or assigned after the literal read as
    unsafe (say `shell: false` at the call); a safe identifier anywhere in the
    argument list is accepted; string literals are skipped when matching
    brackets, regex literals and template `${}` are not understood.
  - **Citations: no record fails, and none was repointed.**
    `node scripts/citations-gate.mjs --against origin/main` exits 0 with `139
enforced, 0 failing`. The edit still moves lines cited by merged records
    outside this branch, which repo-47 makes reported debt and not a failure:
    at `b7fb3fb` the same command prints 17 moved citations in 10 records outside the
    branch's; at the tip, 36 in 12 (39 before the three repairs below). Three of the
    new ones were breakages and were avoided rather than repointed:
    `spawn-safety.test.ts:45` (repo-75) would have moved by the one import
    line, so the header paragraph was rewrapped one line shorter; `:78`
    (repo-75) anchors "every file that spawns says", so the test keeps that
    wording; `:87` (repo-77) anchors "execFileSync)", so the comment is laid out
    to keep that text on line 87. All three resolve at the tip. **What remains
    is the line shifts from adding `shell: false`**: `scripts/review-record.mjs`
    +1 line at `:347` (15 of the 19 new moved citations sit below it),
    `scripts/preflight.mjs` +3 at `:1011` and +4 at `:1658`,
    `scripts/test/preflight.test.ts` +1 at `:842` and `:863` (3 of the 19; the other is
    `preflight.mjs:1278`). None of those
    records is edited here, so nothing fails; the debt is the same kind the
    repo-47 option-B rule describes and rides on the next branch that edits
    those records.
  - **Could have folded in, did not:** repointing those merged records'
    citations (12 records outside this branch) — repo-47's rule says
    a branch repoints only what it edits, and doing it here would widen a
    one-check change into a record sweep; and `scripts/review-record.mjs`'s
    repo-86 work, held to a later batch and sharing that file.
  - `npm run check` exit 0; `npm test -- --project core --project repo` 19
    files, 689 of 689 passed.
- 2026-10-01 — **Gate 1's round (Opus, CONCERNS at `6970cee`): one med, five
  lows, all reproduced before fixing; owner answers by `AskUserQuestion` the
  same day: fix the med here, and repoint repo-77's row and drop the
  placeholder comment.** This entry supersedes the first entry's `:87` layout
  sentence and its `preflight.mjs` `+3` line.
  - **Med — the guard read comments before strings (reproduced).** Mutating
    `scripts/test/citations-gate.test.ts:287` from `{ ...TEXT, cwd: dir }` to
    `{ encoding: "utf8", cwd: dir }` and then to `{ ...TEXT, cwd: dir, shell: true }`
    left `npx vitest run packages/core/test/spawn-safety.test.ts` at `10 passed`
    both times at `6970cee`: `"docs/work/*.md"` opened a block comment that ran to the
    next `*/`, hiding four calls. Fixed at `f27ecfa` by one tokenizer, `mask` in
    `spawn-calls.ts`, that blanks comments and, unless asked to keep them, string,
    template and regex literal contents; `code()` in `spawn-safety.test.ts` is
    `mask(text, true)`. On `f27ecfa`, control (unmutated) 14 of 14 passed; mutation 1
    failed 1 of 14 — "every file that spawns says `shell: false` at each of its calls",
    naming `scripts/test/citations-gate.test.ts:287`; mutation 2 failed 2 of 14 — that
    one and "no call site sets `shell` to anything truthy". Restored, 14 of 14.
    The fixture test for a `/*` string ahead of a call is "a `/*` inside a string does
    not hide the code up to the next `*/`".
  - **Low — the header's limits were false.** An assignment after the literal, or
    two functions each declaring `options`, passed on the other's `shell: false`.
    Now a name is safe only if _every_ declaration of it in the file is a safe
    literal and nothing assigns to it (fixture: "an assignment, or a second
    declaration of the name, withdraws its `shell: false`"). The header was
    rewritten to list the limits that remain, each one true.
  - **Low — bypass shapes.** Fixed, with fixtures: `shell: false` nested in `env`,
    in a string argument or a JSON payload (only a top-level property of the options
    literal counts), `{ ...BASE, shell: !0 }` and `{ ...BASE, shell: process.env.X }`
    (the last word on `shell` wins), a safe name used as a non-options argument (the
    first argument is never options), `spawnSync as run` and `{ spawnSync: run }`
    aliases, `require(...)`, `import(...)` and the bare `child_process` specifier.
    **Declined, and listed as limits in the header:** `cp["spawnSync"](…)`,
    `promisify(execFile)`, `fork`, and `exec`/`execSync` through a namespace or default
    import — the last needs a ban on the member, which is a different rule from this
    ticket's (the named-import ban is `spawn-safety.test.ts`'s own test), and
    `.exec(` cannot be told from `RegExp#exec` without a parser. A spread of anything
    that is not a safe name is trusted not to carry `shell` — the tree's own
    `...(cwd === undefined ? {} : { cwd })` needs that — which is also a limit.
  - **Low — repo-77's citation.** `docs/work/repo-77-shell-false-check-sees-only-spawn.md`
    row 89 now cites `packages/core/test/support/spawn-calls.ts:53 "execFileSync"`, the
    call list itself, and the placeholder comment is gone from the test. Owning that
    record meant owning its other `moved`: its `repo-83` citation is repointed
    coordinate-only to `…per-call.md@b7fb3fb:108`, where the anchor already sat at the
    base (the brief's `:99` had drifted before this branch). The gate then exits 0.
  - **Low — the injected `spawn` parameter.** Confirmed: `spawnRaw`
    (`scripts/preflight.mjs`) reads only `options.cwd` and sets `shell: false` itself, so
    the flag added to `mergeTreeConflicts`'s call was a no-op that read as a fix. The
    flag is removed and the parameter renamed `run`, which keeps the call out of the
    name match and drops this branch's `+3` lines in that function.
  - `node scripts/citations-gate.mjs --against origin/main` exit 0, `139 enforced, 0
failing`, 34 moved in 11 records outside the branch (base: 17 in 10).
- 2026-10-02 — **Gate 2's round (PASS at `d087dc5`, three new lows), owner
  answer by `AskUserQuestion`: withdraw `shell: false` on a spread that brings in a
  `shell` the file itself declares.** Each finding reproduced against `d087dc5`'s
  helper before fixing; this entry supersedes the previous one's "each one true" and
  its `spawn-calls.ts:53`.
  - **1 — the header was still not true.** Reproduced by the reviewer's probes, and
    by this round's fixtures: four real calls and `review-record.mjs`'s injected
    `spawn` parameter are in the scan, so "none occur in the tree" was false;
    the spread, any-later-argument and not-seen-at-all limits are passes, not
    misses-by-construction; a `/` after `}` is read as a regex (the other way
    round from what the header said) and a nested template in `${}` is masked
    correctly. Rewritten, split into "reported" and "passed without being looked
    at", and **held by tests**: the fixture "every limit the header names behaves
    as it says" has one row per sentence — each is a source and the lines
    flagged — so a header line that stops being true fails a row.
  - **2 — the trusted spread (reproduced, then withdrawn as chosen).**
    `const OTHER = { shell: process.env.X }` with `{ shell: false, ...OTHER }`, and
    `{ shell: false, ...(c ? { shell: process.env.X } : {}) }`, both passed. A spread
    now takes the `false` away when it names a same-file binding that is
    `tainted` (a declaration carries a non-`false` `shell`, or spreads one that
    does, to a fixpoint) or holds an inline literal that carries one. The tree's
    own `...(cwd ? { cwd } : {})` carries no `shell`, so it changes nothing and the
    four real calls keep passing; an unknown name is still trusted (a header
    limit). Fixture "a spread cannot bring back a `shell` the file itself
    declares": red against `git show d087dc5:…/spawn-calls.ts` in place
    (`expected [] to deeply equal [ 4, 5, 6 ]`, 1 of 18 failed), green at the head.
  - **3 — two rules no test held (both reproduced).**
    - Removing the declaration-count check (`if (declarations?.length !==
bodies.length) return false` → `if (declarations === null) return false`)
      kept 14 of 14 at `d087dc5`. Fixture "a name declared twice, once as a literal and
      once not, is not safe": with the check removed, 1 of 18 failed
      (`expected [] to deeply equal [ 2, 3 ]`); at the head it passes.
    - Reverting `code()` (`spawn-safety.test.ts:31`) to the old regex pair kept 14 of 14. `code()` now shares two predicates with the scan, `setsTruthyShell` and
      `importsShellRunner`, declared at the file's foot (hoisted, and comment lines
      compensate so `:45` and `:78` do not move), and the fixture "`code()` reads
      through a `/*` string, so the other two tests do" calls them. With `code()`
      reverted, 1 of 18 failed; with it reverted _and_ `shell: true` planted at
      `scripts/test/citations-gate.test.ts:287`, 2 of 18 (that fixture and the
      per-call scan); at the head with the plant, the truthy test and the per-call scan
      fail (2 of 18). Control, unmutated head: 18 of 18. Plants restored.
  - The guard still reports 0 offenders over the real tree: the scan test passes at
    the head, 18 of 18 (`npx vitest run packages/core/test/spawn-safety.test.ts`).
    Repo-77's record, row 89, is repointed to the new line of
    the call list, `spawn-calls.ts:65 "execFileSync"`, since the longer header moved it.
