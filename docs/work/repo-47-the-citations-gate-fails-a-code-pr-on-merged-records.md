---
id: repo-47
tool: repo
title: The citations gate fails a code PR on citations in merged records that still verify on the base
kind: fix
status: needs-decision
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

## Options — none chosen

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

## Build

Blocked on the decision above.

## Done when

Written once an option is chosen. For A or B, the acceptance must include a
fixture in which a code change moves a line cited by an untouched, enforced
record, together with the gate's exit code on the branch **and** on the merged
tree, since the second is where A's cost shows up.

## Log

- **2026-09-14 — filed by the owner's choice, through AskUserQuestion, taking the
  option marked recommended.** The pl-43 failure and its `origin/main` control
  were reproduced in a scratch worktree, which was then removed. So were the
  pl-42 record's `--rev origin/main` result and the shorthand-pin cost. The
  pl-41, pl-45 and pl-49 counts, the table re-pad cost and the three-branch
  pl-36 count are relayed and labelled as such. One finding the brief did not
  carry: option A, as first worded, only defers the failure to `main` and to the
  next PR, which is why B is listed separately.
