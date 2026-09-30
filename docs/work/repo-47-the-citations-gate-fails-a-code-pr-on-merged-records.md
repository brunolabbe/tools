---
id: repo-47
tool: repo
title: The citations gate fails a code PR on citations in merged records that still verify on the base
kind: fix
status: ready
difficulty: hard
milestone: null
depends_on: []
---

# repo-47 — The citations gate bills whoever moves a cited line

**Packages:** `scripts/citations-gate.mjs`, possibly `scripts/citations.mjs`, and
the one gate step in `.github/workflows/ci.yml`.

## Why

The gate checks every enforced `## Review` record against the pull request's own
working tree:

`.github/workflows/ci.yml@95c6403:190` "node scripts/citations-gate.mjs --against"

`scripts/citations-gate.mjs@95c6403:567` "const read = makeReader(repo, null);"

So a pull request that changes **code** fails whenever its diff moves a line that
a record already merged to `main` cites. The PR never touches that record; the
citation is still true on the base, and it goes `moved` only because the PR
shifted the lines above it. The fix in use is to edit the other record and pin
each moved citation to a `main` commit, as in `<file>@95c6403:<line>`. That fix
is correct and it has a real per-PR cost, measured below. In this batch four
branches paid it.

This is not a new judgement about enforcement. repo-29's owner chose enforcement
in its [Decision](./repo-29-citations-carry-no-anchor.md) (option D, as a first
slice of C) and later accepted the cost of an unrelated branch turning the gate
red:

`docs/work/repo-29-citations-carry-no-anchor.md@95c6403:1290` "The cost was accepted knowingly rather than discovered."

**That acceptance was made about the grandfathered ratchet**, where a count rises
when someone else moves a cited line, and its reasoning was that the failure is
"better loud than silent". This ticket asks whether the same trade still holds
for enforced records, now that the frequency is measured. It does not reopen
whether to enforce.

## The reproduction

### One branch, reproduced here

pl-43's pushed tip `2f101f3`, in a throwaway detached worktree under the session
scratchpad. Its merge base with `origin/main` is `95c6403`, from
`git merge-base 2f101f3 origin/main`, so the branch sits directly on the base it
is compared with.

```
$ git worktree add --detach <scratchpad>/repo-46-47/wt-pl43 2f101f3
HEAD is now at 2f101f3 feat(planner): re-plan named days, apply an edit, restore and diff revisions (pl-43)
$ node scripts/citations-gate.mjs --against origin/main
citation gate — the "Review" section of 80 record(s), distinct anchors required

  FAIL  tools/planner/docs/work/pl-42-the-revision-contract.md — 1 moved, 20 verified
         moved        <the plan.ts citation, line 555 — path elided, see below>  (record line 370)
                      anchor "export interface RevisionDiff {" is not in 555 — it is at 571

73 enforced, 1 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored.
7 entr(y/ies) compared against origin/main: 0 raised.
exit=1
```

One line of that output has been changed: the gate printed the record's own
relative path followed by line 555, and that path is elided above. Left as it
was, this ticket's own checker reads the quoted output as an unanchored citation.

**pl-43 never edits pl-42's record.**
`git diff --stat 95c6403 2f101f3 -- tools/planner/contract/src/plan.ts tools/planner/docs/work/pl-42-the-revision-contract.md`
lists one file, `plan.ts` (20 insertions, 4 deletions). pl-42's record merged
separately, as `caeeb44` (#228).

**The control, the same gate at `origin/main`**, run in this ticket's worktree
before any edit:

```
$ git log --oneline -1
95c6403 docs(downloader): count visitors with Cloudflare Web Analytics, and rule out ads (dl-49, dl-50) (#240)
$ node scripts/citations-gate.mjs --against origin/main
citation gate — the "Review" section of 80 record(s), distinct anchors required

73 enforced, 0 failing; 7 grandfathered, holding 2 unresolvable, 21 unanchored.
7 entr(y/ies) compared against origin/main: 0 raised.
exit=0
```

**The same record at `2f101f3`, first against the branch's own tree and then
against the base:**

```
$ node scripts/citations.mjs tools/planner/docs/work/pl-42-the-revision-contract.md --section Review
20 verified, 1 moved, 0 unanchored, 0 unresolvable, 0 unchecked, 0 evidence — of 21 references
exit 2 — 1 moved
$ node scripts/citations.mjs tools/planner/docs/work/pl-42-the-revision-contract.md --section Review --rev origin/main
21 verified, 0 moved, 0 unanchored, 0 unresolvable, 0 unchecked, 0 evidence — of 21 references
exit 0 — nothing to fix
```

On the base, the citation is exactly where the record says:

`tools/planner/contract/src/plan.ts@95c6403:555` "export interface RevisionDiff {"

Afterwards the worktree was removed with `git worktree remove`, and
`git worktree list` no longer lists any path under the scratchpad.

### The same failure on three more branches, measured by the filer and not re-run here

Every branch was measured with the same `--against origin/main` gate at its
pushed tip, exit 1 each time:

- pl-41 at `7e72ce5`: pl-33 (2 moved), pl-36 (1), pl-37 (1);
- pl-43 at `2f101f3`: pl-42 (1), which is the run reproduced above;
- pl-45 at `f796e8b`: pl-10 (7), pl-24 (1), pl-27 (1), pl-29 (2), pl-36 (3);
- pl-49 (PR #242), measured by its builder: pl-20, pl-36, pl-37, repo-37, pl-39,
  pl-42, six records in all.

The filer also confirmed one of pl-49's records verifies on the base:
`node scripts/citations.mjs <pl-39> --section Review --rev origin/main` gave
`14 verified, 0 moved`, exit 0.

**So four code branches in one batch each had to edit between one and six
records they did not otherwise touch**, and pl-36 was edited by three of them.

## What the repair costs

The repair is pinning each moved citation to a `main` commit, with precedent in
`1bb63fa` (repo-44, #223). repo-44 also records why the pin has to name `main`
and not the branch: a branch sha does not survive the squash merge.

`docs/work/repo-44-the-rest-of-the-review-corpus-and-the-pin-wait-class.md@95c6403:260` "never a branch sha: every reviewed sha this needed had been squashed away"

pl-49's builder measured three costs of this repair. The first is reproduced
here, and the other two are relayed.

1. **A shorthand citation cannot carry its own pin, so the pin goes on the
   citation it inherits its file from.** That pins a citation that had not
   moved, and it stays pinned for good. Reproduced here with a three-line
   probe record at `2f101f3`, deleted afterwards. The record held a full
   citation to `plan.ts` line 306, then a shorthand for line 555 carrying
   `@95c6403` after its line number, then a full pin of the same line. The
   shorthand is described rather than written out, because written out it would
   make this ticket fail its own check:

   ```
   $ node scripts/citations.mjs docs/work/probe-record.md --section Review --require-anchors
     MALFORMED  :555@95c6403  (record line 5, shorthand)
                ":555@95c6403" is not a pin this can read — … a shorthand takes the pin of the citation it inherits from
     ok         tools/planner/contract/src/plan.ts@95c6403:555 "export interface RevisionDiff {"  (record line 6, inline)
   2 verified, 0 moved, 0 unanchored, 0 unresolvable, 0 unchecked, 0 evidence, 1 malformed-pin — of 3 references, 1 pinned, anchors required
   exit 32 — 1 malformed pin
   ```

   The rule is deliberate, and its docblock says why:

   `scripts/citations.mjs@95c6403:268` "const SHORTHAND_PIN ="

   The gate fails `malformed-pin` like any other state:

   `scripts/citations-gate.mjs@95c6403:269` "const FAILING = new Set(["

2. **A pin inside a markdown table widens its row, so oxfmt re-pads the whole
   table**, and the diff shows rows that did not change. Relayed, not reproduced.
3. **Concurrent branches pin the same record**: pl-36 was pinned by three
   branches in this batch, so their PRs edit one file and can conflict. The
   count is relayed. The overlap in the list above is consistent with it.

The gate's printed advice is to **repoint** rather than pin. That goes stale
again the next time any branch shifts the file, and when two open branches both
shift it, whichever merges second makes the other's repoint wrong. This is
reasoning, not a measurement, and it is presumably why the batch pinned instead.

## What `--against` already compares, and what it does not

The gate already reads the base branch, but only for **one** fact: the base's
`GRANDFATHERED` list, parsed as text, to catch an entry whose number went up.

`scripts/citations-gate.mjs@95c6403:371` "export function compareAgainst(repo, ref, current = GRANDFATHERED) {"

`scripts/citations-gate.mjs@95c6403:454` "if (allowed > was) raised.push({ record, was, now: allowed });"

That is the `7 entr(y/ies) compared against origin/main: 0 raised` line in both
runs above. **It never resolves a citation against the base.** Every citation is
read from the working tree. The tool that could resolve against a commit exists,
since `citations.mjs --rev` gave the second result above, through:

`scripts/citations.mjs@95c6403:726` "export function makeReader(repo, rev) {"

So "does this citation verify on the base?" is the same machinery run twice, not
a new mechanism. Two facts constrain any option built on that:

- CI passes `origin/<base_ref>`, **the base branch's tip, not the merge base**.
  For pl-43 they are the same commit. For an older branch they are not, and a
  citation moved by a commit already on `main` is `main`'s debt, not the PR's.
  An option that asks about the base has to say which of the two it means.
- **After the PR merges, `main`'s tree holds the moved citation.** The push run
  on `main` and the nightly run read that tree, and so does every later PR. Any
  option that lets the PR through without a repair needs an answer for what
  those runs do next. Otherwise the failure lands on the next, unrelated PR, whose
  merge base now also has the citation moved. This follows from
  `makeReader(repo, null)` above. It has not been run.

## Options — B chosen, 2026-09-29

**The owner chose B: enforce only the records the branch itself changes.** The
options stay below as filed, because they are what the choice was costed against.
The measurement it was made on, and where the answer came from, are in the dated
Log entry.

### A. A citation that verifies at the merge base and moved on the branch is reported, not failed

The gate resolves each failing citation a second time, against
`git merge-base HEAD <against>`, and prints the ones that verify there under
their own heading, at exit 0.

- Puts the cost on nobody at PR time: none of the four branches above would have
  edited another record.
- **On its own, it moves the red build rather than removing it.** After the
  merge the citation is moved on `main`, so the next PR's merge base has it
  moved too, and that PR fails on a record it has never seen. That is worse
  than today, because the author with the context has already merged. Workable
  only with something that repairs or excuses it: automatic pinning at merge,
  or relaxing `main` in the same way, which amounts to B.
- Adds a second resolution per failing citation. No cost for a passing record.

### B. Enforce only the records the branch itself changes

A `moved` in a record that the branch's diff does not touch is reported, not
failed. A record the branch edits is still fully enforced.

- Matches where repo-29 option D put enforcement: at the moment a gate record is
  written. repo-29's option A, anchor on touch, already covers the rest by
  convergence.
- **It gives up the loud failure the owner accepted in repo-29**: moved
  citations then pile up on `main` in enforced records, visible only in the
  report, until someone touches the record or sweeps.
- Needs the base ref's diff, which the `check` job already fetches with
  `fetch-depth: 0`.

### C. A repair tool: `citations.mjs --pin <rev>`

Keep the rule, and make the repair one command: rewrite each `moved` citation
that verifies at `<rev>` into a pin at that rev.

- Keeps enforcement exactly as repo-29 left it, and cuts the labour of the
  repair to one command.
- **It does not remove any of the three measured costs**. It still has to pin
  the parent of a shorthand (cost 1), still re-pads a table (cost 2), and still
  edits the same record from several branches (cost 3). It only automates
  producing them.
- Touches the file with the longest adversarial review history in the repo
  (repo-18, -25, -29, -35, -36), so its own gate will not be cheap.

### D. Keep the rule, and document the per-PR pin cost

Write the repair and its three costs into `docs/01-TICKETS.md` or the
`review-ticket` skill, so a builder expects it.

- No code. Keeps the owner's trade exactly as made.
- The costs stay: one to six records per code PR in this batch, and conflicts on
  shared records.

### E. A repeatable pin sweep, run at close-out rather than per PR

Added 2026-09-28. Build C's `--pin <rev>` tool, but run it over every merged,
enforced record at each batch close-out, not inside the PR that moved a line.
Once, it clears the records written before repo-78. After that, it pins the
citations of content that a branch introduced to that branch's squash commit
on `main`, where the content now exists.

- It turns the per-PR cost into a close-out cost, and a PR that lands between
  two sweeps can still go red.
- Why a one-time sweep is not enough: repo-78, open as #312 on branch
  `repo-78-gate-records-pin-to-base`, pins every citation of pre-existing
  content to the base. It also keeps citations of content the branch itself
  introduced unpinned for good. Its own gate 1 (finding F1) measured the
  consequence. After the squash, those citations point at `main` lines that
  any later branch can move, so new debt keeps arriving without anyone
  writing an unpinned citation.

## Build

Option B, in `scripts/citations-gate.mjs`:

- **The touched set is the branch's diff from the merge base**, meaning
  `git merge-base HEAD <against>` and not `<against>`'s tip. Diff it against the
  working tree, so that a local run sees uncommitted edits. In CI the working
  tree is `HEAD`. The merge base is what the Why's first constraint asks for: a
  citation moved by a commit already on `main` is `main`'s debt, not the PR's.
- **An enforced record outside that set does not fail on `moved`.** Print its
  moved citations under a heading of their own and leave the exit code alone.
  Every other state (`unresolvable`, `unanchored`, `malformed-pin`) stays
  failing as it does today. The chosen option covers `moved` only, and a code
  change that only shifts lines cannot produce the others.
- **A record in the touched set is enforced exactly as today.** That includes a
  record the branch creates, which keeps enforcement where repo-29's option D
  put it: at the moment a gate record is written.
- **Without `--against`** there is no base, so every record is enforced, as
  today.
- **The grandfathered ratchet does not change.**
- **The push and nightly runs on `main`** compare `main` with itself. The touched
  set is empty, so every moved citation is reported and none fails. That is the
  cost the owner accepted with B: moved citations accumulate on `main`, visible
  in the report, until a branch touches the record or someone sweeps it.

Also update:

- the comment above the gate step in `.github/workflows/ci.yml`, which describes
  what `--against` compares;
- `scripts/preflight.mjs`, which runs the gate on a scratch merge of several
  heads (repo-79). Decide there whether the touched set is the union of the
  folded heads' diffs, and say which in the Log;
- `.claude/skills/orchestrate-tickets/reference/records.md`, in the bullet that
  says whose repoint it is when a later commit moves a cited line. It names this
  ticket as undecided and states today's rule, "the branch whose change moves
  the line repoints it". Under B, that branch repoints only the records it also
  edits.

## Done when

- **A fixture repository** in which a code change moves a line cited by an
  enforced record that the branch does not touch. The gate exits 0 on the
  branch, and the moved citation is printed under its own heading.
- **The same fixture after the merge**, with `--against` naming the merged tip
  itself, which is what the push run does. The gate exits 0, and the citation is
  still reported.
- **The control:** the same branch also edits that record, and the gate exits
  non-zero on the same `moved`.
- **A merge-base fixture:** `<against>` has moved on past the merge base with a
  commit that edits the record. The record is not in the branch's touched set,
  so it does not fail.
- **A created record** carrying a `moved` citation fails.
- Each of the five fails with the change reverted, and the Log says how that
  was checked.
- `.github/workflows/ci.yml`'s comment, `scripts/preflight.mjs` and
  `records.md`'s bullet agree with the new rule.
- `npm run check` and `npm test` pass.

## Review

### Gate 1

**Gate: PASS** — 2026-09-30 · `git diff e79b04f...3487667` (`origin/main` was `e79b04f` at the first fetch and at a second one at the end, so the base did not move) · code-review at medium · reviewed at `3487667db46cc8c771d4b6e5d71a4b233ac68c1e` · gate model Sonnet 5.5 (`claude-sonnet-5-5`); the builder was rated `hard` (Opus)

Re-issued at gate 2 with every coordinate re-resolved against `982bd152fdbb83510fb1e8aab5f493a0f3188313`, and otherwise as gate 1 returned it at `3487667`, except that four claims which round 2 corrected are prose naming that sha and not citations (F2's demotion line, F3's `countLine` line and its old heading, and F5's `touchedPaths` call), and that F1's counts of 34 in 12 were measured at `3487667` (the same command at `982bd15` gives 30 in 11, since round 2 pinned repo-51's four). Citations of content this branch introduces are unpinned, against `982bd15`. Citations of content that predates it are pinned to `e79b04f`. `.claude/` content is named by page and heading, with no line number.

| Done when                                                                                               | Proof                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixture: a code change moves a line an untouched enforced record cites; exit 0; printed under a heading | `scripts/test/citations-gate.test.ts:1180 "MOVED docs\/work\/a\.md"` (heading and coordinate), `scripts/test/citations-gate.test.ts:1181 "0 failing"`, exit 0 at line 1182 — **proven**. Mutation M1, below, turns it red                                                                                    |
| The same fixture after the merge, `--against` naming the merged tip: exit 0, still reported             | `scripts/test/citations-gate.test.ts:1207 "0 path\(s\) changed since the merge base with main"`, heading at line 1208, exit 0 at line 1209 — **proven**. Mutation M4 turns it red, and only it                                                                                                               |
| The control: the branch also edits the record, and the gate exits non-zero on the same `moved`          | `scripts/test/citations-gate.test.ts:1215-1226 "the control — a branch that also edits the record fails on the same moved"`, FAIL line at 1223, exit 1 at 1226 — **proven**. Mutation M9 turns it red at the FAIL line                                                                                       |
| Merge-base fixture: the base moved past the merge base with a commit editing the record; no failure     | `scripts/test/citations-gate.test.ts:1251 "1 path\(s\) changed since the merge base with main"`, precondition at line 1247, exit 0 at line 1252 — **proven**. Mutation M3 turns it red, and only it                                                                                                          |
| A created record carrying a `moved` citation fails                                                      | `scripts/test/citations-gate.test.ts:1267 "FAIL {2}docs\/work\/b\.md — 1 moved"`, exit 1 at line 1270 — **proven**. Mutations M5 and M9 turn it red at that line                                                                                                                                             |
| Each of the five fails with the change reverted, and the Log says how                                   | **verified.** The Log's whole-file revert reproduces exactly: 7 failed, 1 passed of 8. The control and the created-record test go red under that revert through the new report line and not their exit code, so M9 and M5 are the proof that each fails for its own reason                                   |
| `ci.yml`'s comment, `preflight.mjs` and `records.md` agree with the rule                                | **verified** by reading: `.github/workflows/ci.yml:185 "It also decides which enforced records fail on"`, `scripts/preflight.mjs:27 "check 2 imports"`, `scripts/preflight.mjs:1278 "repo-47, option B, and the choice"`, and `records.md`'s bullet on whose repoint it is, under its Since repo-47 sentence |
| `npm run check` and `npm test` pass                                                                     | **verified** at the tip: `npm run check` exit 0; `npm test` 3487 passed and 2 skipped of 3489, exit 0; the two changed files 144 of 144 (55 gate, 89 preflight), and the same 144 in a depth-1 clone. The base's own count was not run                                                                       |

- **open decision** · F1 · `moved` is two states and option B as decided excuses both, so a branch that rewrites or deletes text a merged record cites is excused exactly like one that shifts a line. Measured with `node scripts/citations-gate.mjs --against e79b04f` at the tip (exit 0): **34** moved citations reported, in **12** of 135 enforced records. **32 of 34** are found on another line, and **2 of 34** are "not anywhere in" the file. Of the 32, **31** are pure line shifts (each old line, mapped through `git diff -U0 e79b04f 3487667` for its file, lands on the line the gate reports), and **1** is `repo-51`'s citation of the test the branch rewrote (F4). The 2 are one call site cited by two records: `docs/work/repo-51-one-preflight-command-before-a-pull-request.md@e79b04f:127 "from the reviewing checkout's module"` and `docs/work/repo-64-record-the-2026-09-27-batch.md@e79b04f:157 "Check 2 does not"`, both citing `scripts/preflight.mjs@e79b04f:753 "citationsGate(repo, SCOPE, grandfathered)"`. At the tip that call is `scripts/preflight.mjs:780 "touchedPaths(repo, base)"`, two arguments longer, so the anchor's closing parenthesis is gone. **Neither claim is false on the tip, both are merely unlocatable**: repo-51 says the call takes `SCOPE` from the reviewing checkout and the grandfather list from the target repo, and `scripts/preflight.mjs:779 "grandfathered = grandfatheredFor(repo)"` still does; repo-64 says check 2 reads the working tree, and it still does. **Options, open for the owner.** (A, recommended) Keep it as built: at this tip a split would have caught 0 false claims, because the one citation whose meaning did change sits in the found-elsewhere class and the two not-in-file ones are still true, and it would have billed this branch two record edits for nothing. (B) Split it: keep reporting `moved` with a `foundAt` hit, and fail one with none in an untouched record. The field is already on every result (`scripts/citations.mjs@e79b04f:1400 "foundAt: hits,"`, beside the reason text at `scripts/citations.mjs@e79b04f:1394 "and not anywhere in"`), so it is one predicate at `scripts/citations-gate.mjs:711 "const failures = result.failures.filter"`. The cost is the two pins now and, after that, a branch that rewrites a cited line pays for that record. One branch is the whole sample.
- **low** · F2 · a mutation of the demotion survives all 144 tests. Replacing the `const failures = result.failures.filter(…)` line in the demotion, as it stood at `3487667`, with `const failures = [];` parses, and 55 of 55 gate and 89 of 89 preflight tests still pass (M6). The guard `scripts/test/citations-gate.test.ts:1288 "1 indistinct"` runs a record with no `moved` in it, so the demotion block is never entered. The code is right: on a stand-in (the tip plus a commit deleting `scripts/test/preflight.test.ts`) the untouched `repo-79` record fails with `16 unresolvable, 8 moved`, exit 1, its 8 moved under the heading, and 5 of that run's 6 failing records were mixed the same way. Remedy: one fixture, an untouched record holding one `moved` and one `unresolvable`, asserting exit 1, the FAIL line, and the `moved` under the heading.
- **low** · F3 · four presentation findings, one mechanism: the demotion changes the verdict and not what is printed. (a) The FAIL line still counts what was demoted, `16 unresolvable, 8 moved, 1 verified`, because `countLine(result.counts)` in the FAIL line, as it stood at `3487667`, reads the pre-demotion tally, so a reader is told 8 moved failed the record. (b) The reported block prints before every FAIL line (the heading `Moved in records this branch does not change`, as it stood at `3487667`); in the stand-in run above the first FAIL is line 82 of 191, and FAIL lines are what turn the build red. (c) The `preflight.mjs` note names all 12 records on one line of about 900 characters, once per fold. (d) The heading says "this branch" on `main`'s own push run, where nothing is a branch.
- **low** · F4 · the branch rewrote a test a merged record cites, and the gate can only half see it. `docs/work/repo-51-one-preflight-command-before-a-pull-request.md@e79b04f:109 "non-zero on a moved citation in a merged record"` proves that row with `scripts/test/preflight.test.ts@e79b04f:293-294 "toBe(EXIT.citations)"`, a two-line range. At the tip the same lines sit in a test that asserts the opposite, `scripts/test/preflight.test.ts:292-293 "note {2}1 moved citation\(s\) in 1 record"`. The first is reported moved to a different test, the control the branch appended; the second still verifies at its old coordinate and is not reported at all. The Log names the first and not the second. When a later branch edits repo-51 it should pin both to `e79b04f` and ignore the gate's "it is at" hint. The only merged record citing that region is repo-51's, from a grep of `docs` and `tools` for citations of that file's lines 270 to 299.
- **low** · F5 · a mistyped or unfetched `--against` ref now gets the merge-base message. the `touchedPaths` call in `main()`, as it stood at `3487667`, runs before `compareAgainst`, so the advice at `scripts/citations-gate.mjs@e79b04f:405 "no such commit. In CI that means"` is shadowed for the CLI and for check 2. Measured in a depth-1 clone of the tip with no `origin/main`: exit 1, `--against origin/main: no merge base with HEAD, so which records this branch changes cannot be told`, then git's `fatal: Not a valid object name origin/main`. Both messages name `fetch-depth: 0`, so this is wording only.
- **low** · F6 · two comments the branch leaves stale, with no ticket filed. `.github/workflows/ci.yml@e79b04f:170 "Same depth-1 caveat as the two steps above"` says the gate reads the checkout and never the history, and now sits directly above the paragraph saying `--against` reads history. `.github/workflows/ci.yml@e79b04f:93 "The citation gate's"` names the base's `GRANDFATHERED` list as the only reason `check` fetches depth 0, and the merge base is a second. The Log declines the first because repo-46 edits the same job. CLAUDE.md's rule for a stale sentence is to fix it or file it, and a one-sentence comment edit costs a rebase line where a filing costs an intake slot.
- **note** · F7 · the transition and the debt, both by design and both the Log's own claims, re-measured. Until this merges, an older gate over the tip's tree fails 11 records and 33 moved citations (a stand-in with the base's `citations-gate.mjs` written over the tip's; the Log says 34, and the 34th is `repo-50`'s citation into the gate file I overwrote), so a branch that folds this head under its own pre-B preflight goes red on records it never touched: merge this before its siblings' last preflight. And the debt stays on `main`: the next branch to append even a Log line to one of the 12 records owns every `moved` in it, `repo-79` 8, `repo-82` 7, `repo-51` and `repo-65` 4 each.
- **dropped** · "the fold, using only `HEAD`'s diff, lets a pair of branches merge to a red `main`". Not reachable through `moved`: `main`'s push and nightly runs compute an empty touched set and fail nothing on it, and every other state is enforced on every record in every fold. Emptying the fold's set turns 4 tests red (P4), so that half is tested; a pair whose second branch opens after the first's last preflight is not folded by either, before or after this change (reasoned from what preflight folds, not run).
- **dropped** · "no merge base in CI". `touchedPaths` throws, `main()` catches it and exits 1 (measured in the depth-1 clone), and the path is unreachable in `check`: it fetches depth 0, a pull request run's `HEAD` is a merge whose first parent is the base tip, and a push run's `HEAD` is `origin/main`.
- **dropped** · "an untracked new record escapes the touched set locally". The gate never reads an untracked record, before or after (`findRecords` is `git ls-files`); a staged one is read and enforced (measured: `136 enforced, 1 failing`, the scratch record failing on its `moved`). Not this branch's.
- **findings** · code-review at medium returned 13; 10 carried in 7 bullets (F3 is four findings in one), 3 dropped.
- NFR: security ✓ (`execFileSync` with argument arrays and `shell: false` through `GIT_EXEC_OPTIONS`; `against` reaches a git argument only, and CI prefixes it `origin/`) · performance ✓ (two extra git subprocesses per run, not timed) · reliability — an unfindable merge base throws rather than returning an empty set, and a test asserts it (`scripts/test/citations-gate.test.ts:1320 "no merge base with HEAD"`); the wording is F5 · maintainability — F3 and F6. Invariants walked: no shell, no `console`, the tests typechecked by `npm run check` (the `.mjs` is not, since `checkJs` is off in `scripts/test/tsconfig.json`), no new test file to register. Skipped, not touched by the diff: tool imports, `AppError`, redaction, SSRF, progress, contracts, the image's workspace list.

**Method, mutations.** Range `git diff e79b04f...3487667`: 7 files, all read, the ticket's Log last. Tree detached at the tip, farm and build first. Nine mutations of `citations-gate.mjs` and five of `preflight.mjs`, each parse-checked with `node --check` and restored; a first `sed` mutation that did not parse was discarded and redone, and none counted. Gate side: M1 the demotion condition replaced by `if (false) {`, 4 red of 8; M2 an always-empty touched set, 3 red; M3 the diff taken from the base's tip, 1 red; M4 an empty set treated as no set, 1 red; M5 `--diff-filter=M`, 1 red; M6 the survivor of F2, 0 red; M7 no `--against` read as an empty set, 1 red; M8 the no-merge-base error swallowed, 1 red; M9 the `!touched.has(record)` condition dropped, 2 red, which is the Log's own claim reproduced. Preflight side: P1 check 2's set `null`, 1 red; P2 check 2's set empty, 1 red; P3 the fold's set `null`, 1 red; P4 the fold's set empty, 4 red; P5 the fold's set the union of the folded heads', 1 red, which is the Log's own union claim reproduced.

**Method, what CI computes.** A scratch repository holding the real history to `e79b04f` and the tip, plus two commits that move the base: one edits `repo-79`'s record, one inserts a line in `preflight.mjs`. A `pull_request` run: the tip merged onto that base with `--no-ff`, `HEAD` the merge, `origin/main` the base's tip. It touched 7 paths, all the branch's own, and not the base-only edit to `repo-79`; `0 failing`, exit 0, 35 moved reported in 12 records. The same merge with `origin/main` moved on again by a commit editing `repo-82`'s record, as when a merge ref predates the base: the same 7 paths, exit 0. A `push` run: the tip squash-merged onto that base with `HEAD` and `origin/main` the same commit: `0 path(s) changed`, 35 reported, exit 0. No merge base: a depth-1 clone with no `origin/main` exits 1 with the message in F5.

**Method, depth 1 and preflight.** Depth 1: `git clone --depth 1` of the tip with a farm, the two changed files 144 of 144 and `--project repo` 630 of 630; every new test builds its own fixture repository and reads no real history. Preflight at the tip, `node scripts/preflight.mjs --base origin/main --title "fix(repo): enforce only the citation records a branch changes (repo-47)"`: exit 0, with `check`, `ciCommands`, `citations` (141 records, 34 moved noted), `review`, `title` and `mergeTree` all ok (2 open heads, both clean, each fold noting the same 34). Check 2 and the fold apply CI's rule as a set; they differ in that check 2 diffs to the working tree and the fold to the committed head. Records the branch itself edits: the `repo-47` ticket verified 11 of 11 anchored citations, 0 moved, exit 0, and `records.md` is a `.claude` page outside `SCOPE.records`. Not run: the base's `npm test` count, the e2e and container gates (the branch touches neither), and a real GitHub `pull_request` run, which the stand-ins above replace.

## Log

- **2026-09-14 — filed by the owner's choice, through AskUserQuestion, taking the
  option marked recommended.** The pl-43 failure and its `origin/main` control
  were reproduced in a scratch worktree, which was then removed. So were the
  pl-42 record's `--rev origin/main` result and the shorthand-pin cost. The
  pl-41, pl-45 and pl-49 counts, the table re-pad cost and the three-branch
  pl-36 count are relayed and labelled as such. One finding the brief did not
  carry: option A, as first worded, only defers the failure to `main` and to the
  next PR, which is why B is listed separately.
- **2026-09-28 — put to the owner, and deferred by the owner's choice: wait
  for repo-78 (#312) to merge, then re-measure.** Asked with options B, C, D
  and E above. The owner first asked whether repo-78 contradicts this ticket.
  It does not: #312 states today's rule (the branch whose change moves a line
  repoints it) and links here without deciding it. It does change what this
  ticket measures. Records written after it pin pre-existing content at
  write time, so the four-branches-in-one-batch rate in the Why describes
  pre-repo-78 records. Its F1 names the two groups that are still exposed:
  merged records written before the rule, and every citation of
  branch-introduced content. **What to measure before asking again:** after
  #312 merges, the number of code PRs in the next batch that had to repair a
  record they never touched, split by those two groups. Still
  `needs-decision`.
- **2026-09-28 — baseline before #312 merges, from #314 (repo-79):** one code PR
  repointed citations in five merged records it did not write (repo-51, repo-64,
  repo-67, repo-71, repo-75) — gate 1 found "29 citations changed" across five
  records, gate 2 found "29 citations changed this round", gate 3 found "6
  citations changed this round". These counts are quoted directly from the
  respective gate sections in repo-79's review record as landed.
- **2026-09-29 — re-measured after #312, and decided: option B, by the owner's
  choice through AskUserQuestion, taking the option marked recommended.**
  #312 merged as `9cae329`. The first code PR after it, #316 (repo-82, which
  changed `scripts/citations.mjs` and `scripts/preflight.mjs`), repointed
  citations in eight merged records it did not write. Counted from the removed
  lines of `git diff 2ffb72a^ 2ffb72a`, per record: repo-48 3, repo-50 7,
  repo-51 3, repo-52 7, repo-60 6, repo-64 2, repo-67 4, repo-79 13. repo-75
  changed too but counted 0, because its citations are line ranges this
  count's pattern does not match. So the total is at least 45. Split by the
  two groups the 2026-09-28 entry named:
  - **written before repo-78:** seven records, about 32 citations;
  - **citations of branch-introduced content:** repo-79's record, 13
    citations of `preflight.mjs` code that repo-79 added. It was written
    after repo-78 and merged in #314, in the same batch as #316, so option E's
    close-out sweep would not have reached it in time.

  Options B, E, C and D were offered. B was the only one that removes the cost
  measured on #316, and the cost of choosing it was stated: it gives up the
  loud failure accepted in repo-29.

- **2026-09-30 — built, option B, off `e79b04f`.** `citations-gate.mjs` gains
  `touchedPaths(repo, against, head = null)` — `git merge-base <head|HEAD>
<against>`, then `git diff --name-only --no-renames -z` from that merge base
  to the working tree (or to `head`) — and `gate()` a fifth parameter,
  `touched`. An enforced record outside it has its `moved` failures taken out
  and returned as `reported`; the CLI prints them under "Moved in records this
  branch does not change" and leaves the exit code alone. A grandfathered
  record, a touched record, and every state but `moved` are untouched. Without
  `--against` the touched set is `null` and every record is enforced, and the
  run now says which of the two rules it applied on every run, as the history
  line already did. A merge base that cannot be found throws rather than
  returning an empty set, which would excuse every `moved` in the corpus.
  - **What `main`'s push and nightly runs do under B**, measured, not argued:
    `HEAD` is `main`'s tip, the merge base with `origin/main` is `HEAD`, the
    touched set is empty, and every `moved` is reported and none fails. The
    test "after the merge, a run against the merged tip itself still passes
    and still reports" squash-merges the branch and runs the fixture's own copy
    of the CLI with `--against main`: `0 path(s) changed since the merge base
with main`, the moved citation under the heading, exit 0. **In a pull
    request run**, `HEAD` is GitHub's merge of the branch into its base, so the
    merge base with the base tip is that tip and the diff is the branch's net
    change as it would land — the same set the local run computes from the
    fork point.
  - **`preflight.mjs`, the choice the Build left here: `HEAD`'s own committed
    diff, not the union of the folded heads'.** Check 2 passes
    `touchedPaths(repo, base)`, the same set CI computes. The scratch fold
    computes `touchedPaths(repo, base, headOid)` once and uses it for every
    fold. A fold asks whether _this_ branch's records survive another head
    landing; a union would bill this branch for the other head's record, the
    cost B removed, and that head's own preflight folds this one in and does
    enforce it. Both directions are one test, "checkScratchMergeCitations
    enforces HEAD's own records, not the folded head's": from "mine" the
    fold's `moved` in b's record is a note and `ok`; from "b" the same fold
    fails. Mutated to the union, it fails (below).
  - **Done when, and how each was made to fail.** Five fixtures, plus three
    guards, appended to `scripts/test/citations-gate.test.ts` under
    "repo-47". Each builds a repository carrying its own copy of the gate, its
    `GRANDFATHERED` emptied, and runs that CLI end to end with `--against
main`. `npx vitest run scripts/test/citations-gate.test.ts`: 55 of 55
    (47 at the base). With the whole change reverted —
    `git show e79b04f:scripts/citations-gate.mjs` written over the file —
    `-t repo-47` gave 7 failed, 1 passed of 8: every fixture fails, and the
    one that passes is the guard that an untouched record still fails on
    `indistinct`, which holds before and after by design. Three targeted
    mutations, each applied and restored by a script in the scratch
    directory: the merge base replaced by `against`'s tip fails only the
    merge-base fixture; the `!touched.has(record)` condition dropped fails
    the control and the created-record fixture; `--diff-filter=M` fails the
    created-record fixture. In `preflight.test.ts`, passing `null` for check
    2's touched set fails the rewritten repo-51 test, and the union mutation
    fails the new fold test; 89 of 89 unmutated.
  - `npm run check` exit 0; `npm test` exit 0, 3487 passed and 2 skipped of
    3489; `npm test -- --project repo` 630 of 630.
  - **What the brief had wrong.** (1) `moved` is broader than a shift:
    `citations.mjs` returns `moved` both when the anchor is found on another
    line and when it is "not anywhere in" the file. So B also excuses an
    untouched record whose cited text a branch rewrote or deleted, which the
    Build's "a code change that only shifts lines cannot produce the others"
    does not say. This branch is an example of that: repo-51's record cites
    `citationsGate(repo, SCOPE, grandfathered)` in `preflight.mjs`, which the
    change rewrote, and it is reported, not failed. (2) repo-51's own test
    "checkCitations fails and names the record when a merged citation's
    target line moves" asserted the rule B reverses. It is rewritten in place,
    so no line below it moves, as "checkCitations reports, and does not fail,
    a moved citation in a record the branch leaves alone", and the control is
    appended at the end of the file. repo-51's record cites that test's
    `toBe(EXIT.citations)` line. The anchor now also matches the new control
    test, so the gate reports it "at 2109". A later repoint that follows that
    hint would land on a different test. The correct repair is a pin to
    `e79b04f`.
  - **The debt this branch leaves, by B's rule.** `node
scripts/citations-gate.mjs --against e79b04f` on the tip: `135 enforced,
0 failing`, `34 moved citation(s) reported in 12 record(s)` — repo-29,
    -31, -34, -41, -50, -51, -64, -65, -67, -75, -79 and -82, almost all of
    them citing `preflight.mjs` or `citations-gate.mjs` lines this change
    shifted. None is repointed, since that is exactly the cost B removed.
    **Until this merges, any branch whose preflight folds this head runs its
    own pre-B gate, so its scratch-merge check fails on those 34.** It clears
    once that branch has `main` with this in it.
  - **Disclosed, not changed:** the grandfathered ratchet is as it was, as the
    Build says, so an unrelated branch that raises one of the six listed
    records' counts still fails `WORSE`. The `--against` paragraph in the
    gate's header docblock was rewritten line for line, so no line under it
    moved. The dynamic import in the last new test is there for the same
    reason.
  - **Fold-in considered and declined.** `ci.yml`'s "Same depth-1 caveat …
    it reads the checkout, never the history" has been stale since
    `--against` began reading history, and it is more so now. Not edited:
    the dispatch confined this branch's `ci.yml` edit to the comment the
    Build names, because repo-46 edits the same job. Other skill pages still
    say "repoint what you moved" (`roles/builder.md`). They stay true under
    B, since the branch only fails on its own records, so they were left
    alone.
  - Spawn calls: two new `execFileSync("git", …)` calls in `touchedPaths`,
    `shell: false` via `GIT_EXEC_OPTIONS`. No existing spawn call was edited,
    and none of `preflight.mjs`'s `spawnSync` calls (repo-83's) was touched.
- **2026-09-30 — round 2: gate 1's F2–F6 fixed, and F1 kept by the owner.**
  Gate 1 (at `3487667`) raised one open decision, F1: `moved` also covers an
  anchor that is no longer in the file at all. The owner kept B as built,
  choosing through AskUserQuestion, so nothing was built for it, and the
  demotion's comment now says `moved` covers both. The owner chose fixing the
  five lows now over disclosing them.
  - **F2, reproduced, then fixed.** Replacing the demotion's `const failures =
result.failures.filter(…)` with `const failures = [];` left 144 of 144
    passing across `citations-gate.test.ts` and `preflight.test.ts`, run by
    `mutate-m6.mjs` in the scratch directory. The new fixture is "an untouched
    record with a moved and an unresolvable fails on the unresolvable alone":
    `c.md` sits on `main`, and the branch shifts one file it cites and deletes
    the other. It asserts exit 1, the FAIL line, and the `moved` under the
    heading. Under the same mutation the result is 1 failed, 145 passed of 146. The fixture was red before the fix too.
  - **F3, fixed.** (a) The demotion now also subtracts from the record's
    `counts`, so the FAIL line reads `1 unresolvable` and no longer counts
    what was demoted. (b) The reported block prints after every FAIL, WORSE,
    STALE and RAISED line. The same fixture asserts the order. (d) The heading
    is now "Moved in records not changed since the merge base with <ref>", so
    it is also true on `main`'s push run. `records.md` quotes the new wording.
    (c) `preflight.mjs`'s note is now a summary line plus one line per record.
    A fold lists at most three and then "… and N more; check 2 lists every
    one". Covered by the new test "the moved note lists one record per line in
    check 2, and at most three in a fold", which was red first (no such line)
    and now passes. My round-1 fold test's regex was widened to cross the new
    line break.
  - **F5, reproduced, then fixed.** `node scripts/citations-gate.mjs --against
no-such-ref` printed `--against no-such-ref: no merge base with HEAD, …`
    and exited 1. `touchedPaths` now runs `git rev-parse --verify` first and
    throws `compareAgainst`'s own wording, `no such commit. In CI that means
the checkout was shallow`. That fixes the CLI and preflight's check 2,
    since both call it before `compareAgainst`. The test "an --against ref
    that does not resolve says so, not that the merge base is missing" was red
    first, on that exact message.
  - **F4: pinned.** The alternative was a Log note naming both lines for the
    next editor. Editing repo-51 makes it a record this branch changes, so B
    enforces it here, and every moved citation in it has to be repaired. So
    all five of its citations whose content this branch shifted or rewrote
    are pinned to `e79b04f`. These are the two on the "non-zero on a moved
    citation in a merged record" row (test lines 293 and 294), plus
    `preflight.mjs` lines 1448, 1369 and 753. Each verifies there:
    `node scripts/citations.mjs <repo-51> --section Review --rev e79b04f` gave
    `21 verified, 0 moved`, exit 0. After pinning, the same record with
    `--require-anchors` gives `21 verified … 5 pinned`, exit 0. The table
    re-pad the Why relayed as cost 2 is now measured: five pins changed 12
    lines of the record, most of them table padding. The gate's exit status
    either way: pinned, `node scripts/citations-gate.mjs --against
origin/main` exits 0 with `30 moved citation(s) reported in 11 record(s)`.
    With a Log note instead, repo-51 stays untouched, as at `3487667`, which
    exited 0 with 34 in 12 (round 1's measurement, not re-run).
  - **F6, fixed.** Rewrote `ci.yml`'s `fetch-depth: 0` comment, which named
    the base's `GRANDFATHERED` list as the only reason for depth 0; the merge
    base is now named as the second. Also rewrote the "Same depth-1 caveat …
    never the history" paragraph, and in the ticket-check comment "needs the
    base branch's copy of one file" became "the base branch's history". The
    dispatch lifted its narrow-edit constraint for these.
