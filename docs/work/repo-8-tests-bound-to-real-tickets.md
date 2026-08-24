---
id: repo-8
tool: repo
title: Two CLI tests assert on the real ticket board, and go red when downloader work finishes
kind: fix
status: done
milestone: null
depends_on: [repo-3, repo-6]
---

# repo-8 — the status CLI suite asserts on the board, not on the CLI

**Packages:** `scripts/test/status.test.ts`

## Why

**Found by [repo-3](./repo-3-show-a-closed-ticket.md)'s Gate 1, finding 5**, not
here. That gate flagged one instance as `pre-existing, low`, declined to widen a
diff it was otherwise closed over, and recorded that it had no id to file it
under — "reported upward for an id". This is that id. This ticket adds the
reproduction, the second instance and the sweep; the observation is repo-3's.

Two cases in `scripts/test/status.test.ts` run the CLI against **the real ticket
tree** and assert on what comes back:

- `:450-457` — `run(["--tool", "downloader", "--ready"])`, asserting every line
  of stdout contains `\tdownloader\t`.
- `:586-591` — `run(["--markdown", "--tool", "downloader"])`, asserting stdout
  contains `| Ticket `.

Both go red when the downloader has no open tickets left. **They fail because
the project succeeded**, which is the same species as the assertion repo-3
rewrote onto a throwaway tree — that one ran `--show pl-2` against the real
`pl-2` and was one frontmatter edit from asserting nothing.

Both were written by [repo-2](./repo-2-retire-the-status-page.md) (`0c67b8e`),
which is before [repo-6](./repo-6-dangling-dependency-kills-the-view.md)
(`8dc9cd4`) added `--root`. At the time there was no seam to write them against,
which is exactly the situation `docs/01-TICKETS.md:246-250` describes. The seam
exists now; these two did not move.

### Reproduced

The honest reproduction is to finish the downloader's work and watch the suite
break. On this tip (`ece6ec0`) the downloader has four open tickets; close them
and run the suite:

```
$ sed -i 's/^status: \(ready\|in-flight\)$/status: done/' \
    tools/downloader/docs/work/dl-16-e2e-through-the-sniffer.md \
    tools/downloader/docs/work/dl-23-rate-limit-the-download-route.md \
    tools/downloader/docs/work/dl-25-srt-row-matches-a-hostname.md \
    tools/downloader/docs/work/dl-27-verify-segment-origins.md
$ npx vitest run scripts

 FAIL  |repo| scripts/test/status.test.ts > --tool narrows the view to one tool
AssertionError: expected 'nothing is ready and unblocked' to contain '\tdownloader\t'

Expected: "	downloader	"
Received: "nothing is ready and unblocked"

 ❯ scripts/test/status.test.ts:455:18
    453|   expect(stdout.length).toBeGreaterThan(0);
    454|   for (const line of stdout.trimEnd().split("\n")) {
    455|     expect(line).toContain("\tdownloader\t");
       |                  ^
    456|   }
    457| });

 FAIL  |repo| scripts/test/status.test.ts > --markdown emits a table, with no generated-region markers to guard
AssertionError: expected '## downloader — 0 open of 27\n\n### M…' to contain '| Ticket '

- Expected
+ Received

- | Ticket
+ ## downloader — 0 open of 27
+
+ ### Milestones
+
+ | Milestone      | Done | Open | Dropped | State    |
+ | -------------- | ---- | ---- | ------- | -------- |
+ | M1             | 1    | 0    | 0       | complete |
+ | M2             | 2    | 0    | 0       | complete |
+ | M3             | 2    | 0    | 0       | complete |
+ | M4             | 2    | 0    | 0       | complete |
+ | _no milestone_ | 20   | 0    | 0       | complete |
+
+ ### Open tickets
+
+ None. Every ticket this tool has is closed.
+

 ❯ scripts/test/status.test.ts:589:18
    587|   const { stdout, status } = run(["--markdown", "--tool", "downloader"…
    588|   expect(status).toBe(0);
    589|   expect(stdout).toContain("| Ticket ");
       |                  ^
    590|   expect(stdout).not.toContain("generated:tickets");
    591| });

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 74 passed (76)
```

The edit was reverted with `git checkout -- tools/downloader/docs/work/`; no
ticket's state was changed by this ticket. The block above is verbatim but for one
character: oxfmt strips trailing whitespace inside a fence, so vitest's
`- | Ticket ` diff line has lost its trailing space here.

### Two things the report got wrong, and one it understated

**The non-empty assertion is not the one that fails.** The defect was reported
as "an assertion that `stdout` is non-empty". `scripts/status.mjs:543` writes
`nothing is ready and unblocked` when the ready list is empty, so
`expect(stdout.length).toBeGreaterThan(0)` at `:453` still passes on a finished
board. What goes red is the per-line `expect(line).toContain("\tdownloader\t")`
at `:455`, against the fallback line. The conclusion survives contact with the
code; the mechanism named does not, and it matters, because a fix aimed at the
length assertion would leave the defect in place.

**`--markdown` fails for a different reason than `--ready` does.**
`renderMarkdown` at `scripts/status.mjs:369-372` replaces the ticket table with
`None. Every ticket this tool has is closed.` and `continue`s, so the
`| Ticket ` header is gone. Only the milestone table remains, which is why the
`status` assertion at `:588` still passes and only the `toContain` fails.

**`--ready` is the wider of the two, and it does not need the project to
finish.** `--ready` is `status: ready` **and** unblocked, so the case at `:451`
goes red the moment the last open downloader ticket is _picked up_, not only
when the last one closes. That is a transient state a parallel batch produces
routinely. Measured: setting the same four tickets to `in-flight` rather than
`done` gives **1 failed / 75 passed** — `:455` alone, with the identical
`nothing is ready and unblocked` message, while `:589` stays green because the
tickets are still open. So the two instances have genuinely different trigger
conditions and neither subsumes the other.

### The sweep

**21 `run(...)` call sites examined** (`grep -n '\brun('` over the file, minus
the definition at `:94`; `:642` carries two). **Four pass no `root`; three of
those reach `readTickets`; two of those three assert on the board's content, and
both are reproduced red above.**

| Line   | Call                             | Root? | What it asserts                                          | What would have to change for it to fail                                                                                     | Risk                                                          |
| ------ | -------------------------------- | ----- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `:451` | `--tool downloader --ready`      | no    | every stdout line is a downloader row                    | no downloader ticket is `ready`-and-unblocked — i.e. the last one closes, **or is merely picked up**                         | **high** — normal work, and reachable transiently mid-batch   |
| `:460` | `--tool sniffer`                 | no    | exit 1, empty stdout, named failure on stderr            | a tool called `sniffer` acquires a ticket. The downloader owns a component by that name (`dl-16-e2e-through-the-sniffer.md`) | low — stable, and its assertion is about absence, not content |
| `:587` | `--markdown --tool downloader`   | no    | stdout contains `\| Ticket `, and no `generated:tickets` | every downloader ticket closes. `in-flight` is not enough — measured green in that state                                     | **medium** — normal work, but only at the end of it           |
| `:598` | `--write` / `--check` (loop, ×2) | no    | exit 1, `unrecognised argument "<flag>"`                 | nothing in the tree. `parseArgs` throws at `scripts/status.mjs:454` before `main` reaches `readTickets` at `:487`            | none — rootless but tree-independent                          |

The other **17 call sites all pass a `root`** and are unaffected: `:485`,
`:496`, `:509`, `:521`, `:537`, `:557`, `:581` (repo-3's `--show` rewrite),
`:620`, `:642` (×2), `:646`, `:647`, `:656`, `:682`, `:692`, `:709`, `:717`
(repo-6's malformed-tree enumeration and its healthy-tree control). Each builds
its tree with `repoWith` or `repoWithADanglingDependency`, so no assertion in
that group can be moved by a ticket landing.

A test pinned to a real ticket that can only fail if someone deletes a file is a
different risk from one that fails when work finishes normally, and the table
separates the two on purpose: `:598` cannot fail, `:460` fails only on a tool
rename nobody has proposed, and `:451` and `:587` fail on the repo doing what it
is for.

## Build

1. **Point `:450-457` at a throwaway tree.** `repoWith` two tools' tickets and
   assert `--tool <one>` returns only that tool's rows. **The tree must have two
   tools in it** — a single-tool tree proves nothing about narrowing, which is
   what the test is named for. `repoWithADanglingDependency` already builds a
   planner-plus-repo tree; a plain two-tool one is three lines with the existing
   `pl`/`at`/`repoTicket`/`atRepo` helpers.
2. **Assert the empty case too, rather than deleting it.** The behaviour this
   defect walked into — `--ready` printing `nothing is ready and unblocked`
   instead of nothing at all (`scripts/status.mjs:543`) — is unasserted anywhere
   in the suite today. A tree whose every ticket is `done` pins it, and it is
   the case a reader of this ticket will look for first.
3. **Point `:586-591` at a throwaway tree**, and **keep both of its
   assertions**: `not.toContain("generated:tickets")` is repo-2's preservation
   criterion — the marker of the generated region in the file it deleted — and
   it must not be lost in the move. Add the closed-board case as its pair: a
   tool with no open tickets renders `None. Every ticket this tool has is
closed.` and no `| Ticket ` header, which is also unasserted today.
4. **Leave `:459-464` and `:596-602` rootless, and say in the Log that you
   did.** They are the suite's only proof that the CLI runs at all against the
   tree it derives itself, and neither asserts anything a ticket can move. Do
   not "finish the sweep" by rooting them; that would trade a real property for
   a tidy grep.
5. **The helpers are planner-shaped.** `pl` and `at` build planner tickets and
   `repoTicket`/`atRepo` build repo ones; there is no downloader helper. Write
   the rewritten cases against `planner`/`repo` rather than adding a third
   helper for one call site — the tool name in these two tests is incidental,
   and that is the whole point of the ticket.

## Done when

- Every `run(...)` in `scripts/test/status.test.ts` that reads the ticket tree
  asserts nothing about which tickets are in it. The Log names the ones left
  rootless and why, so the next reader does not re-derive the sweep.
- The reproduction above no longer reproduces: with all four open downloader
  tickets set to `done`, and again with all four set to `in-flight`,
  `npx vitest run scripts` is green. Both states, measured, in the Log —
  they fail differently and one is not evidence for the other.
- `--ready` on a tree with nothing ready is asserted to print
  `nothing is ready and unblocked`, and `--markdown` on a tool with nothing open
  is asserted to print `None. Every ticket this tool has is closed.`
- The rewritten `--tool` case still fails against a CLI that ignores `--tool` —
  prove it by mutation, not by inspection, since a one-tool tree would pass
  either way.
- `--markdown` still asserts `generated:tickets` is absent.
- `npm run check` and `npm test` are green, and
  `node scripts/status.mjs --json > /dev/null` exits 0.

## Gate 1 — 2026-08-24 · **PASS**

**Gate: `repo-8-tests-off-the-real-board` — PASS.** The reviewer's record
follows whole; only its headings are demoted one level to sit under this one,
and five citations are corrected as recorded at the end of the section. The
reviewer's file is posted unedited on the pull request, so the delta is visible
rather than folded in.

Reviewed at branch tip `b28fbee`. Worktree verified clean at `b28fbee`
(`git status --porcelain` empty, `scripts/status.mjs` md5 identical to a pristine
copy) before any evidence below was gathered, and clean again after.

### 1. The enumeration claim — full sweep, not a sample

**23 `run(...)` call sites** in `scripts/test/status.test.ts` (22 matching lines;
`:713` carries two), excluding the definition at `:94`.
`grep -n 'spawnSync\|execFile\|execSync'` confirms `run` is the only path to the
CLI — no second spawn route.

**21 pass `--root`:** `:466 :485 :521 :532 :545 :557 :573 :593 :617 :636 :652
:691 :713(x2) :717 :718 :727 :753 :763 :780 :788`.

**Exactly 2 are rootless**, and they are the two the Log names — no third
slipped through:

| Line   | Call                                   | Asserts                                                                          | Can a ticket move it?                                                                                                                                                                                               |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:496` | `--tool sniffer`                       | exit 1, `stdout === ""`, stderr matches `no tickets for a tool called "sniffer"` | No. `tool` is derived from directory names under `tools/` plus the literal `repo` (`scripts/status.mjs:234-244`), never from frontmatter — so only creating `tools/sniffer/` moves it. No ticket's frontmatter can. |
| `:669` | `run([flag])` for `--write`, `--check` | exit 1, `unrecognised argument "<flag>"`                                         | No. `parseArgs` throws at `scripts/status.mjs:454` before `main` reaches `readTickets` at `:487`. Tree-independent.                                                                                                 |

Acceptance line satisfied: every `run(...)` that reads the ticket tree is rooted;
the two that are not read it only in the sense of proving the derived root
resolves.

**No change needed —** `scripts/test/status.test.ts:156` and `:167` read the real
board directly via `readTickets(REPO)`, outside the `run(...)` acceptance. They
assert structural invariants (every ticket parses; repo tickets live in
`docs/work/`), never _which_ tickets exist, and are deliberately board-coupled —
they are the guard that real frontmatter parses. Correctly left alone.

### 2. Independent mutation, with its positive control

Did **not** reuse the builder's `:516` mutation. Mutation applied at parse time
instead — `scripts/status.mjs:448`, inserted
`if (arg === "--tool") { i++; continue; }` so the flag and its value are
swallowed before `values` is built. This leaves `--root` intact, so the seam
under test is unaffected.

- **Positive control, unmutated tree, identical command** —
  `npx vitest run scripts -t "narrows the view to one tool"`: **1 passed, exit 0.** Stated explicitly because a runner that exits 1 on a clean tree reports
  itself, not the mutant.
- **Mutated:** red.
  ```
  FAIL scripts/test/status.test.ts > --tool narrows the view to one tool
  AssertionError: expected [ ...(3) ] to have a length of 2 but got 3
   > scripts/test/status.test.ts:469:17
  ```
- **Full suite under this mutation:** 5 failed / 73 passed (78) — the two
  rewritten cases, the `sniffer` case, and two of repo-6's. Same shape and count
  as the builder reported for its _different_ mutation, which is corroboration
  rather than transcription.
- **Restore:** `cp` from a pristine copy, `touch`, then `git status --porcelain`
  empty and md5 matched. Repeated after every mutation below; no mutated byte
  survived any of them.

### 3. The dodge, verified — and the generalised question

**The builder's claim is true, and the tree was rebuilt to check it.**
Reconstructed `repoWithADanglingDependency` (`pl-1` done, `pl-2` ready, `pl-3`
ready -> `[pl-1]`, `repo-9` ready -> `[repo-404]`) and ran both views:

```
--tool planner --ready  ->  pl-2 / pl-3          (+ dangling warning on stderr)
--ready                 ->  pl-2 / pl-3          (+ dangling warning on stderr)
```

Byte-identical stdout. `repo-9` is withheld from `--ready` because its dependency
dangles, so narrowed and unnarrowed coincide and a `--tool` case built on that
tree would have survived the mutation. The builder's decision to build a fresh
tree with a **sound** `repo-9` is what makes `:469` load-bearing.

**Every new/rewritten case, with the mutation that should kill it — all four
die:**

| Case                                               | Mutation                                                | Result                                                                         |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `:460` `--tool narrows the view to one tool`       | `--tool` swallowed at parse time                        | red, `:469`                                                                    |
| `:480` `--ready with nothing ready says so...`     | delete `scripts/status.mjs:543` fallback write          | red, **uniquely** (1 failed / 77)                                              |
| `:631` `--markdown emits a table...`               | `--tool` swallowed                                      | red (repo-9 leaks into output)                                                 |
| `:647` `--markdown on a tool with nothing open...` | delete `scripts/status.mjs:369-372` closed-board branch | red, together with the pre-existing `renderMarkdown` unit case (2 failed / 76) |

No case in this diff passes for a reason other than the one it is named for.

**No change needed —** two weaker properties, both benign. `:480` would also pass
over an empty tree (it cannot distinguish "tickets present, none ready" from "no
tickets"), and `:647` would also pass against a `--tool`-ignoring CLI (its tree
is planner-only). Neither is what those cases are named for, and each is killed
uniquely by the mutation that matters. Not worth churn.

### 4. The preservation criterion — survives, and is not vacuous

`not.toContain("generated:tickets")` is carried at
`scripts/test/status.test.ts:641` (rewritten case) and `:656` (new pair) — one
more site than before. To prove it is asserted against output that _could_
contain the marker rather than against emptiness, `"<!-- generated:tickets -->"`
was injected into `renderMarkdown`'s open-tickets header
(`scripts/status.mjs:366`): **both cases went red.** The assertion is live in
both, and both outputs are substantial markdown, not empty strings.

### 5. Both measured board states — reproduced exactly

Ran the brief's `sed` over the same four downloader tickets, then ran
`origin/main`'s test file (`git show 567f9e5:scripts/test/status.test.ts`) and
this branch's in each state:

| board state         | `origin/main`                                                                                                   | this branch        |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------ |
| four `done`         | **2 failed / 74 (76)** — `--tool` and `--markdown`                                                              | **78 passed (78)** |
| four `in-flight`    | **1 failed / 75 (76)** — `--tool` only, `expected 'nothing is ready and unblocked' to contain '\tdownloader\t'` | **78 passed (78)** |
| untouched (`ready`) | —                                                                                                               | **78 passed (78)** |

Counts match the Log exactly, and the two states do fail differently:
`in-flight` takes down only `:455` because the tickets are still open and
`renderMarkdown` still emits its table. **Restored:** the four tickets are back
to `status: ready` and `git status --porcelain` is empty.

### 6. The repo's own gate, seen red first

```
node scripts/status.mjs --json > /dev/null; echo $?   ->  0
```

Then broke it: added a throwaway `docs/work/repo-999-gate-probe.md` with
`depends_on: [repo-404]` -> gate printed
`depends_on "repo-404", which is not a ticket` and **exited 1**. Removed it ->
back to **0**, `git status` clean. Green here is evidence.

### 7. `repo-9` — no functional collision; recommendation is not to rename here

**Verified by test, not by reading.** The real
`docs/work/repo-9-close-the-pl-26-annotation-loop.md` (`depends_on: [repo-7]`,
from the sibling `repo-7-changelog-attribution` branch) was copied into this
worktree's `docs/work/`, simulating it having landed on `main`:

- Full `npx vitest run scripts`: **78 passed (78)** — unchanged.
- `--root <synthetic tree> --show repo-9` resolved the **synthetic** ticket:
  title `the repo-9 thing`, `file docs/work/repo-9-slug.md`,
  `depends on repo-404` — not the real one sitting in the derived root.
- Sharpest probe: a rooted tree containing **no** `repo-9` at all, with the real
  file on disk -> `no ticket called "repo-9"`, exit 1. The real file is invisible
  to a rooted run.

Structurally airtight: `DEFAULT_ROOT` is read at exactly one place
(`scripts/status.mjs:486`, `values.root ?? DEFAULT_ROOT`), and every filesystem
read in `readTickets`/`ticketDirs` is a `path.join(repoRoot, ...)`. There is no
path by which the real file leaks.

**Recommendation: leave it.** `repo-9` as a fixture id is **not introduced by
this branch** — repo-6 already uses it at `scripts/test/status.test.ts:119, 124,
234, 237, 354, 709, 720, 733, 763`. This branch adds two more (`:464`, `:634`).
Renaming only the two new uses would leave _two_ synthetic repo-id conventions in
one file, which is strictly worse for the grepping reader than one; renaming all
eleven rewrites cases repo-8 has no business touching, including repo-6's
malformed-tree enumeration. A reader grepping `repo-9` already hits this file
today, before this branch.

If it is to be done, it belongs in its own `repo-` ticket covering all eleven
sites, with fixture ids moved to a reserved `-9xx` band (`pl-901`, `repo-901`)
that a real board will never reach — `repo-404` retained as the deliberately
nonexistent id it already is at `:119`. That convention documents itself.

### Findings

**F1 — minor, cosmetic.** In this ticket's own Log, oxfmt reflowed the closing
Gates line so an inline code span breaks across a blank line and the continuation
begins with `>`, rendering as a paragraph ending in an unterminated backtick
followed by a blockquote. `npx oxfmt --check` on both changed files passes, so
**CI will not catch this** — it is oxfmt's own output. The same command is stated
correctly in "Done when", so nothing is lost; only the Log reads garbled.

**No change needed (recorded so the next reader does not re-derive them):** the
sweep count and the two rootless call sites (section 1); the two
`readTickets(REPO)` unit tests correctly left board-coupled (section 1); the two
weaker-than-named properties at `:480` and `:647` (section 3); `repo-9`
(section 7).

### What this gate did NOT do

- Did not re-run `npm run check` or the full `npm test` — settled before this
  gate ran. Did run `npx oxfmt --check` on both changed files (clean) and
  `npx vitest run scripts` many times (78/78 on every clean-tree run).
- Everything above is local. CI was not observed, and nothing here proves the
  `check` job's behaviour on a docs-only push beyond the oxfmt result on the two
  changed files.
- The e2e suites and container image gates do not run in this loop.

### Citations, re-resolved

**Re-resolved against the tree this section is committed with** — one commit
past `b28fbee`, the tip the reviewer read — and checked programmatically after
`npm run format`, not before it: every `file:line` above was re-read and
asserted to still contain the thing it is cited for — 56 of them, 0 unresolved. `scripts/test/status.test.ts`
and `scripts/status.mjs` are byte-identical to `b28fbee`, so the citations into
them resolve against exactly what the reviewer saw; the reflow risk was in this
file, which carries none.

Five were wrong when written, all in the same direction — pointing at the
comment block above a test rather than at its `test(` line — and are corrected
here: `:479` to `:480`, `:627` to `:631`, `:644` to `:647`, `:656` for the
second `generated:tickets` site (`:654` was a comment line), and
`scripts/status.mjs:452` to `:454`, which is the `throw` in `parseArgs` rather
than the `else if` two lines above it. The conclusion each supports is unchanged;
each was verified by re-reading the corrected line.

Left as the reviewer wrote them: `:455` and `:589` in section 5. They cite
`567f9e5:scripts/test/status.test.ts` — the pre-branch file, where the two cases
failed — and both resolve there, which is the whole point of quoting them.

**F1 is fixed** in the closing paragraph of the Log below: the gates line is now
a fenced block, which oxfmt cannot reflow, instead of an inline code span that
wrapped its redirection onto a `>`-leading line.

## Log

### 2026-08-23 — built on `repo-8-tests-off-the-real-board`, base `567f9e5`

Both board-bound cases now run against a throwaway tree from `repoWith`, and two
cases the defect walked past are asserted for the first time. 76 tests before,
78 after.

**The two rewritten cases.**

- `--tool narrows the view to one tool` builds **two tools** — `pl-1`, `pl-2`
  and a sound `repo-9` — runs `--tool planner --ready` against it, and asserts
  exactly two lines, each carrying `\tplanner\t`, with `repo-9` absent. Two
  tools is the whole point: a one-tool tree passes against a CLI that never
  reads `--tool` at all, which is the property the case is named for.
- `--markdown emits a table…` builds `pl-1` plus a sound `repo-9`, runs
  `--markdown --tool planner`, and keeps **both** of its old assertions —
  `toContain("| Ticket ")` and `not.toContain("generated:tickets")`, repo-2's
  preservation criterion for the generated region of the page it deleted — plus
  the link to `pl-1` and the absence of `repo-9`.

**The two cases added.** `--ready with nothing ready says so rather than
printing nothing` pins `scripts/status.mjs:543`'s fallback line, which is what
the old per-line assertion was actually colliding with. `--markdown on a tool
with nothing open says so rather than emitting a table` pins
`None. Every ticket this tool has is closed.` with `| Ticket ` absent.

**Left rootless, deliberately, and commented as such in the file:**

- `--tool with a name no tool has is a named failure, not an empty view`
  (was `:459-464`, now `:495-500`) — asserts exit 1, empty stdout and the named
  failure on stderr. Only a tool literally named `sniffer` could move it.
- `--write and --check are gone, and say so rather than being ignored`
  (was `:596-602`, now `:667-673`) — `parseArgs` throws before `main` ever
  reaches `readTickets`, so no board can move it.

Together they are the suite's only proof that the CLI runs at all against the
root it derives from its own location. Rooting them would have traded that for a
tidy `grep`, which the brief explicitly forbids and which is right.

**Proof 1 — the reproduction no longer reproduces, in both states.** Ran the
brief's `sed` over the same four downloader tickets, twice, and ran the old test
file from `origin/main` in each state as the control that the reproduction is
real here and not just in the brief:

| board state              | `origin/main` tests | this branch's tests |
| ------------------------ | ------------------- | ------------------- |
| all four `done`          | 2 failed / 74 (76)  | **78 passed (78)**  |
| all four `in-flight`     | 1 failed / 75 (76)  | **78 passed (78)**  |
| untouched (four `ready`) | —                   | **78 passed (78)**  |

The two failure counts match the brief's exactly: `done` takes down both
`:455` and `:589`, `in-flight` takes down `:455` alone with the identical
`nothing is ready and unblocked` message. Reverted with
`git checkout -- tools/downloader/docs/work/`; `git status` is clean of any
ticket edit but this file's.

**Proof 2 — mutation, with its control.** `scripts/status.mjs:516` was replaced
with `const selected = all;` — the CLI reading `--tool` and ignoring it.

- Control, unmutated tree, identical command
  (`npx vitest run scripts -t "narrows the view to one tool"`): **exit 0**.
- Mutated: **exit 1**,
  `AssertionError: expected [ …(3) ] to have a length of 2 but got 3` at
  `status.test.ts:469`. The rewritten case dies on the mutant.
- The full suite under the same mutation: 5 failed / 73 — the rewritten `--tool`
  and `--markdown` cases, the `sniffer` case, and two of repo-6's.
- `status.mjs` restored by `cp` from a copy and `touch`ed; `git status` shows it
  unmodified, which is the check that no mutated byte survived.

**What the brief had wrong, and one thing it did not know.**

- **Step 3's "which is also unasserted today" is not quite true.** `renderMarkdown`
  already had a unit case for `None. Every ticket this tool has is closed.` (now
  `:427-432`). What was unasserted is the **CLI** path to it — the flag parse,
  the narrowing and the exit code — and that is what the new case covers. The
  overlap is one string in two layers and worth it; the layer that broke was the
  flag path.
- **Step 1's suggestion to reuse `repoWithADanglingDependency` would have
  produced a test that passes against a CLI ignoring `--tool`.** Its only
  non-planner ticket is `repo-9`, whose `depends_on` names nothing, and a ticket
  with a dangling dependency is withheld from `--ready` anyway (asserted at
  `:401-404`). So `--tool planner --ready` and a bare `--ready` return the same
  two rows over that tree, and the mutation above would not have been caught.
  The new case builds its own tree with a **sound** `repo-9` for exactly that
  reason — which is the same trap the brief warns about one sentence earlier,
  arriving by a different door.
- Everything else in the brief holds: the line numbers, the sweep's four
  rootless call sites, and both measured failure counts.

**Gates.** `npm run check` and `npm test` are both green, and the gate CI reads
exits 0. Written as a fenced block rather than inline, so no reflow can wrap the
redirection onto a line that starts with `>` — which is what happened to this
paragraph the first time round (gate 1, F1):

```bash
node scripts/status.mjs --json > /dev/null; echo $?   # 0
```
