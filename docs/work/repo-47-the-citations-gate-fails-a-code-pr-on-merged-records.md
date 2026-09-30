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
