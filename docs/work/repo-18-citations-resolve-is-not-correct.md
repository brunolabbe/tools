---
id: repo-18
tool: repo
title: citations.mjs reports that a line resolves, not that it says what was claimed
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-18 — A resolved citation is not a correct one

**Packages:** `scripts` (`citations.mjs`, `test/citations.test.ts`).

## Why

`scripts/citations.mjs` exists so a record's `file:line` citations can be trusted.
It checks that the cited line **exists** at the rev. It does not check that the
line says what the citation claims — so a citation whose referent has _moved_
lands on whatever now occupies that number and is reported as **resolved**.

**This is the dominant case for a gate record, not an edge.** A record is
committed on a branch whose fix moved lines; that is what a fix does. So the tool
is at its least reliable exactly where it is most used.

It is the same failure shape as
[repo-14](./repo-14-citations-section-flag-is-a-no-op.md) — a confident wrong
answer rather than an error — and the two may be one ticket. See _Open question_.

## Reproduction

Measured on `dl-36-orchestrated`, whose fix inserted 28 lines above the code its
ticket cites. The ticket's `Done when` 4 cites `tls-origin.ts:143-149`.

```
$ git show dl-36-fixture-serial-numbers:tools/downloader/api/test/helpers/tls-origin.ts | sed -n '144,149p'
  // Defence in depth, and **not** what fixes the collision — a mutation run
  // proved it: reverting this to a constant `01` while keeping distinct common
  ...                                                    # the dl-21 comment

$ git show dab661c:tools/downloader/api/test/helpers/tls-origin.ts | sed -n '144,149p'
export async function createFixtureCertificate(names: {
  dnsNames?: readonly string[];
  ...                                # a function signature and a doc comment

$ git show dab661c:tools/downloader/api/test/helpers/tls-origin.ts | grep -n "Defence in depth"
170:  // Defence in depth, ...       # where the comment actually went
```

`node scripts/citations.mjs <ticket> --rev dab661c` reported **9/9 resolve**
throughout, with three of the nine pointing at the wrong code.

**A dangling citation would have been better.** It fails loudly; this one reads
as verified. The builder that found it judged all nine printed lines by hand and
noted that **comparing totals would have shown 9/9 at every point in that work** —
so the summary line is not merely uninformative, it is actively misleading.

### The upstream error this pairs with, worth fixing in prose either way

The citation was wrong before anything moved: the comment is exactly six lines and
the cited start `143` is `149 − 6` — an end anchor minus a length, missing the
`+1` an inclusive range needs. That diagnosis is falsifiable and was checked: had
the author cited the window they viewed through, the cited **end** would have read
151, not 149. The rule that prevents it: **cite what you read, never compute one
citation from another.** Already recorded in
[`records.md`](../../.claude/skills/orchestrate-tickets/reference/records.md).

## Build

1. **Re-run the reproduction against the tip first.** The three commands above are
   the whole of it and cost seconds. `dl-36-orchestrated` may be merged or gone by
   the time this is picked up — any branch whose fix inserted lines above a cited
   region reproduces it.
2. **Decide what "correct" means** — this is the open question below, and it
   changes the whole implementation. Do not start before it is answered.
3. **Whatever the check becomes, make the failure loud and make the summary line
   honest.** `N/N resolve` must stop being printable when a citation resolves onto
   something the citation does not describe. A count that cannot distinguish the
   two states is the defect, not the wording around it.
4. **Test it against a fixture where the referent moved**, not only against one
   where it vanished. The existing suite (`scripts/test/citations.test.ts`) covers
   dangling; this ticket is about the case where nothing dangles. Run it red first.

## Open question — do not settle it here

**How does the tool know a citation is _right_?** Three answers, with different
costs, and the choice decides the build:

- **Anchor text.** Require citations to carry a fragment of what they point at
  (`tls-origin.ts:144 "Defence in depth"`), and check the text is on the line.
  Precise, and it changes the citation _format_ — every existing record becomes
  legacy, so it needs a migration story or a two-format reader.
- **Content hash at a pinned rev.** Cheap to check, brittle to whitespace, and it
  says nothing useful when it fails ("the line changed" — into what?).
- **Report drift instead of failing.** Keep resolution as-is but additionally say
  _"this line moved between the pinned rev and HEAD"_, leaving the judgement to a
  reader. Cheapest and least protective; it would have caught this instance.

**A lean, not a decision:** the third is the smallest change that would have
surfaced this case, and it does not invalidate a single existing citation. The
first is the only one that actually verifies the claim.

## Also here, and not this ticket's job

[dl-30](../../tools/downloader/docs/work/dl-30-measure-a-rendition.md)'s Log says
"See the Review section for why…" and the file has **no `## Review` heading at
all** — a merged ticket pointing at a section that does not exist. Noticed while
sampling for this reproduction. It is the same family (a reference nothing
validates) and it is a separate fix; file it or fold it, but do not let it ride
along here.

## Done when

1. A citation whose referent has moved is reported differently from one that
   still points at what it claims — proven by a test using a fixture where lines
   were inserted above the cited region, not one where the file was deleted.
2. That test failed before the change. Say so, with the output.
3. The summary line cannot read `N/N` while any citation is in the moved state.
4. The open question is recorded on this ticket with its answer and its reason,
   and if the answer changes the citation format, the migration story is written
   down before any record is rewritten.
5. `npm run check` and `npx vitest run scripts` pass.

## Review

**Gate: PASS** — 2026-09-05 · `origin/main...23d3b56` · defect hunt run directly (subagent, no `code-review` delegate), medium depth

_Citations below resolve against `23d3b56`, the sha this gate reviewed, and were
verified against it — not against this branch's tip. `82ad6ab`
(`--require-anchors`) landed after this gate began, moved several of the cited
lines, and is outside its scope: the reviewer declined to extend its round to it
without the orchestrator's word, and that question is open in the Log below._

| Done when                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A citation whose referent moved is reported differently from one that still points at what it claims, proven by an insertion fixture | `citations.test.ts:274` "expect(after?.state).toBe(" ✓, end to end at `citations.test.ts:576` "expect(atTip.stdout).toMatch(summary(0, 1, 0, 0, 1))" ✓                                                                                                                                                                                                                                   |
| That test failed before the change, shown with output                                                                                | **verified** — reran `npx vitest run scripts/test/citations.test.ts` against `origin/main:scripts/citations.mjs` restored into the worktree: 18 of 33 failed, 15 passed, and every failure is an `AssertionError` (`expected undefined to be 'moved'`, etc.) — none is a missing-export `SyntaxError`. Matches the Log's count exactly.                                                  |
| The summary line cannot read `N/N` while any citation is in the moved state                                                          | `citations.mjs:413` "${counts.verified} verified, ${counts.moved} moved" ✓ (no `N/N` template anywhere in `summarize`), `citations.test.ts:599` "expect(result.stdout).not.toMatch(SAME_OVER_SAME)" ✓                                                                                                                                                                                    |
| Open question recorded with answer and reason; migration story written before any record rewritten                                   | `repo-18-citations-resolve-is-not-correct.md:146` "The open question is answered: anchor text" ✓, `records.md:299` "Migration: nothing already committed is rewritten" ✓ — **verified** no record besides this ticket and `records.md` itself was touched: `git diff --name-only origin/main...23d3b56` names only `records.md`, this ticket file, `citations.mjs`, `citations.test.ts`. |
| `npm run check` and `npx vitest run scripts` pass                                                                                    | **verified** — reran both after `worktree-farm.sh` + `npm run build`: `npm run check` exit 0, `npx vitest run scripts` 137 passed (3 files), matching the Log. `npm run status -- --json` also exit 0.                                                                                                                                                                                   |

- **Reproduced the engineered red independently**, per the prompt's highest-priority ask: restored `origin/main:scripts/citations.mjs` into this worktree, ran the new suite against it, got 18/33 failed exactly as claimed, confirmed by grepping the failure log for `SyntaxError`/`does not provide an export` (zero hits) — every failure is an assertion. Branch version restored afterwards; worktree left clean (`git status --porcelain` empty).
- **`13 anchored of 965 citations across 136 md files` reproduced exactly**, independent of the ticket's own throwaway sweep script: materialized `origin/main` with `git archive | tar -x`, concatenated every tracked `.md` file, ran `extractCitations` over the concatenation. Got `total=965 anchored=13`, `136` files via `find -name '*.md' | wc -l`, and traced all 13 anchors back to `dl-23`, `dl-29`, `pl-24`, `pl-25`, `repo-7` by grep — matches the Log's attribution.
- **The live finding (pl-24's `grounding-fixtures.test.ts` anchor) reproduced exactly**: `node scripts/citations.mjs tools/planner/docs/work/pl-24-*.md` on this branch prints `MOVED …anchor … is not in 29 — it is at 53`, summary `3 verified, 1 moved, 2 unanchored, 1 unresolvable — of 7 citations`. Line 29 (`grounding-fixtures.test.ts:29 "As a candidate names one"`) is the doc comment; line 53 is the real `test(...)`. Running the same record through `origin/main:citations.mjs` prints `ok` for that same citation (`6/7 resolve`) — the old script really did call a doc comment resolved.
- **The repo-7 joined-string case is real, and the boundary is pinned by a test.** `docs/03-RELEASING.md` has "heads that release's `### Features`" at lines 118–119, not the cited 97–99 — confirmed by direct `grep`/`sed`. Feeding the tool the _correct_ range (118-119) verifies successfully only because lines are joined into one string first (`citations.mjs:275-302 "haystack.indexOf(needle)"`, `locateAnchor`); a synthetic single-line-only matcher would report "not anywhere in the file" for this exact text. The comment-boundary limitation (an anchor spanning `//`) is pinned by `citations.test.ts:310 "spanning a comment's continuation marker does not match"`, not just described in a comment.
- **`ok: boolean` removal checked for orphaned consumers** — `grep -rn "checkCitations"` across the tree finds only `citations.mjs` and its own test file as callers; the only other `.ok` usages in `scripts/` belong to the unrelated `commit-message.mjs`'s `validate()`/`check()`. Nothing else reads the removed field.
- **low** · The unanchored-note-on-stdout-vs-stderr choice is a real tradeoff (keeps the pre-existing `stderr === ""` iff `exit 0` invariant that `citations.test.ts:195 "result.stderr).toBe("` already asserted before this ticket touched it), not a defect — recorded as a judged decision, not carried as a finding.
- **dropped** · none — every finder-equivalent check (self-run defect hunt, no delegated `code-review`) reconciles into the bullets above; nothing surfaced and discarded.
- **findings** · 0 returned as defects; 1 `low` judged as a deliberate, defensible tradeoff rather than carried against the gate.
- NFR: security ✓ (no shell, `execFileSync` with argument arrays throughout, no user-facing network surface) · performance n/a · reliability ✓ (ambiguous-file, past-end-of-file, missing-section and multi-match-section all covered) · maintainability ✓ (extensive docblocks tying every branch to the case that earned it).

### Gate 2 — 2026-09-05 · `82ad6ab` folded in on the orchestrator's word · `origin/main...2de66cd` · defect hunt run directly (subagent, no `code-review` delegate), medium depth

Scope resolved by the orchestrator, not by the builder or me: `--require-anchors`
(`82ad6ab`) was owner-directed and is folded into this same ticket's round rather
than treated as new scope, per Done-when 4's own instruction to record the
open question's answer and reason. `2de66cd` adds only the Log entries above
(87 insertions, one file, no source) — confirmed by `git diff --stat 82ad6ab..2de66cd`.

Reviewed on **Sonnet** (this agent). Builder recorded as **Opus** per the
orchestrator's original task assignment — **not confirmed via `resolvedModel`**,
because the orchestrator dispatched the builder in the background, which returns
no such field. The attribution rests on background builders inheriting the
dispatching session's own model, and the orchestrator here runs Opus; it is an
inference from dispatch practice, not a direct readout, and is recorded as such
rather than left to read as a checked fact.

_Builder's note, added at commit time: the inference above does not hold in this
instance. This builder's own system context states directly, "You are powered by
the model named Sonnet 5" — a self-report, not `resolvedModel`, but a more direct
source than dispatch practice and one the reviewer had no way to obtain. The
builder on this ticket is **Sonnet 5**, not Opus. Left uncorrected, this is
exactly the class of unverified claim the rest of this ticket exists to catch;
corrected here rather than transcribed, and flagged to the orchestrator
separately since the skill's own dispatch table assumes "inherit → Opus, in
practice" as close to certain, which this instance contradicts._

| Check                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The four original Done-when rows still hold with `82ad6ab` applied                  | **verified** — full suite re-run at `82ad6ab`/`2de66cd`: `npx vitest run scripts` 141 passed (up from 137; +4 for the new flag), `npm run check` exit 0, `npm run status -- --json` exit 0. No existing assertion was reworded to pass; the diff of `citations.test.ts` between `23d3b56` and `82ad6ab` only adds tests and a `marks` helper, confirmed by reading it.                                                                                                                                                 |
| `parseArgs`'s restructuring (arity-as-data) does not regress `--rev` or `--section` | **verified**, not just read — ran `node scripts/citations.mjs docs/work/repo-18-....md --rev HEAD --section "Open question"` and the same flags reversed, both orders: identical output, exit 1 (the illustrative anchor in that section is itself `MOVED`, expected and unrelated to this check). `citations.test.ts:738-739 "toEqual(expected)"` covers both orders for `--rev` in the suite; `--section`'s own suite (`citations.test.ts` "section narrows the check…") is untouched by this diff and still passes. |
| The naive `expect(status).not.toBe(0)` trap is real, not asserted                   | **verified directly** — restored `23d3b56`'s `citations.mjs`, ran `node … /tmp/legacy.md --require-anchors`: exit 1, empty stdout, stderr `unknown option --require-anchors`. A naive `not.toBe(0)` assertion is green on that. The suite's real assertion at `citations.test.ts:651` "expect(strict.stderr).not.toMatch(/unknown option/)" fails against that exact output (stderr does contain it) — confirmed by running it, not inferred.                                                                          |
| The `/--[a-z]+/g` → `/--[a-z][a-z-]*/g` fix is real                                 | **verified** — ran both regexes against the CLI's own usage string: old regex yields `--require` for `--require-anchors` (stops at the hyphen), so it would have compared `--require` across docblock/USAGE/FLAGS and rubber-stamped a match without ever seeing the real flag; new regex at `citations.test.ts:719 "matchAll(/--[a-z][a-z-]*/g)"` yields `--require-anchors` intact.                                                                                                                                  |
| No export was forced                                                                | **verified independently** — `diff <(git show origin/main:scripts/citations.mjs \| grep '^export ') <(grep '^export ' scripts/citations.mjs)` exits 0 at `82ad6ab`. `locateAnchor`/`summarize`/`STATES` stay unexported per `citations.mjs:400 "Deliberately not exported, along with"`; `FLAGS`/`parseArgs` were already exported, so nothing new appears in the diff.                                                                                                                                                |
| Red count against `origin/main` is stronger, not weaker                             | **verified** — restored `origin/main`'s script at this tip and reran the suite: **23 of 37 failed, 14 passed**, all three new flag tests among the failures. Grepped the full log for `SyntaxError`/`does not provide an export`: zero hits. One of the 23 is a thrown `Error: unknown option --require-anchors` from `parseArgs` rather than a vitest `AssertionError` — still a behavioural/runtime failure, not a module-load failure, so the "none is a missing-export error" claim holds on an honest reading.    |

- **The tool found two mistakes in my own draft before I sent it, and I am recording that it did rather than that the section is clean.** I ran `node scripts/citations.mjs` against Gate 1's `## Review` text before sending it to the builder. First pass: one anchor was silently truncated because it embedded a literal `"` (the anchor delimiter itself), and a bare mention of `grounding-fixtures.test.ts:29` without an anchor came back `unanchored` as a duplicate of an anchored citation two lines later. Both are exactly the class of mistake a human proofreading would also miss, and the tool caught both mechanically. Fixed, reran: `10 verified, 0 moved, 0 unanchored, 0 unresolvable`, exit 0, before it was sent.
- **This ticket's own thesis, reproduced independently on this ticket's own gate record, not taken from the builder's Log.** Ran `origin/main`'s (pre-repo-18) `citations.mjs` against `docs/work/repo-18-....md --section Review` at the current tip: **10/10 resolve, exit 0** — including `ok` on `citations.mjs:413` (now pointing at `: "";`, not the summary template) and `citations.test.ts:599` (now pointing at a stray `*/`, not the `SAME_OVER_SAME` assertion). Ran the branch's own tool over the same section: **2 verified, 8 moved, 0 unanchored, 0 unresolvable**. Both counts match what the builder's Log at `2de66cd` reports; I did not take its word for either number.
- **findings** · 0 returned as defects against the extended scope; nothing carried, nothing dropped.
- NFR: security ✓ (new code paths are pure argument/string handling, no new shell or network surface) · performance n/a · reliability ✓ (the flag's own three new tests cover lenient/strict/all-clear) · maintainability ✓ (docblocks on `summarize`, `FLAGS` and `parseArgs` explain the arity change and why it was needed).

**Gate: PASS**, extended to `82ad6ab`/`2de66cd`. Gate 1's PASS on `23d3b56` above is unchanged and not reissued; this entry only certifies that folding in `--require-anchors` did not disturb it and that the flag itself meets the same bar.

## Log

- **2026-09-02** — Filed off `origin/main@7fe18af`. Found by a builder during an
  orchestrated run of `dl-36`, which was told to run `citations.mjs` before
  committing its gate record and judged the nine printed lines individually rather
  than reading the total. Reproduced independently here, and again by that run's
  reviewer, which re-derived the post-fix line numbers (169 / 170-175 / 176 / 177)
  from the file without prompting.

  **Not fixed here, and the reason is the open question**: "resolves" and "is
  correct" need a definition before a check can exist, and all three candidate
  definitions have real costs — one of them invalidates the format every existing
  record uses. Filing without settling it would hand the next agent a build step
  it cannot start.

  `repo-18` confirmed free against both lists: `docs/work/` tops out at `repo-17`,
  a grep over the tree adds only `repo-404`, `repo-808`, `repo-901` and `repo-999`
  (all `scripts/status.mjs` fixtures), and no remote branch or pull request in any
  state names it.

- **2026-09-04** — Built on `repo-18-citation-anchors`, off `origin/main@c37cab9`.

  **The open question is answered: anchor text** — a citation carries a fragment
  of what it points at, and the script checks the fragment is inside the cited
  range. Answered by the repo's owner, over this ticket's own lean toward
  reporting drift, with the format cost known. The reason it is affordable turned
  out to be measurable, and the ticket did not know it: **the format already
  exists in this repo.** 13 citations across six records were written as
  `` `file.ts:NNN` "anchor" `` by reviewers before anything could read one —
  `dl-23`, `dl-29`, `pl-24`, `pl-25`, `repo-7`. The chosen answer standardises a
  convention that was already here rather than inventing one.

  **The route is a two-format reader, and no existing record is rewritten.** The
  ticket offers "a migration story or a two-format reader" as alternatives; with
  the code in front of me they are the same thing, because the migration story is
  _that there is no rewrite_. The number that settles it:

  ```
  $ node scratchpad/sweep.mjs        # extractCitations over every tracked .md
  13 anchored of 965 citations across 136 md files
  ```

  Re-deriving anchors for the other 952 means re-reading, at the rev each was
  written against, what every merged record claimed — re-judging finished work,
  not migrating a format. So an unanchored citation is reported as `unanchored`
  forever: never `verified`, never an error. Written down in
  `.claude/skills/orchestrate-tickets/reference/records.md` before any record was
  touched, per `Done when` 4, and no record was touched.

  **Reproduction re-run first, per Build 1.** `dl-36-orchestrated` is gone; the
  work merged as `e9f516b` (#134) and reproduces there unchanged:

  ```
  $ node scripts/citations.mjs .../dl-36-...-negative.md --rev e9f516b
    ok   tls-origin.ts:144-149 -> .../tls-origin.ts  (record line 110, inline)
         export async function createFixtureCertificate(names: {
  9/9 resolve
  ```

  **`Done when` 1 and 2 — red first, on an insertion fixture.** Two commits over
  one file, the second inserting three lines above the cited comment and changing
  nothing else, the same record and citation run against both revs. Old script
  against the _post-insertion_ rev:

  ```
  $ node <origin/main citations.mjs> drift.md --rev HEAD
    ok   src/tls.ts:2-3  (record line 3, inline)
         // inserted
  1/1 resolve
  EXIT=0
  ```

  `ok`, for a citation whose text is now `// inserted`. New script, same fixture:

  ```
    MOVED      src/tls.ts:2-3 "Defence in depth"  (record line 3, inline)
               anchor "Defence in depth" is not in 2-3 — it is at 5
  0 verified, 1 moved, 0 unanchored, 0 unresolvable — of 1 citation
  EXIT=1
  ```

  and against the _pre-insertion_ rev the same citation is `1 verified` — which
  is the control that makes it a drift test rather than a wrong-when-written one.

  The suite itself was run against `origin/main:scripts/citations.mjs`:
  **18 of 33 failed, every one on an assertion**, none on a missing export. The
  two that carry the acceptance:

  ```
  × the CLI tells a citation whose referent moved from one that still points at it
    expected '1 citations in drift.md, resolved aga…' to match
    /1 verified, 0 moved, 0 unanchored, 0 unresolvable — of 1 citation/
  × the summary cannot read N/N while a citation is in the moved state
    + "  ok   src/tls.ts:2-3  (record line 3, inline)
       + //  inserted
       + 3/4 resolve"
  ```

  **That red is deliberate design, not luck.** `locateAnchor`, `summarize` and
  `STATES` are **not exported**, so this module's export list is byte-identical
  to the pre-ticket one and the new suite links against the old source. Exporting
  them would have turned the whole red into
  `SyntaxError: does not provide an export named 'summarize'`, which proves the
  API changed and proves nothing about behaviour. Both are covered through
  `checkCitations` and the CLI's own stdout.

  **`Done when` 3 — the summary, checked as its own path.** `N/N` is gone
  outright; the line is `V verified, M moved, U unanchored, X unresolvable — of N
citations`, every bucket printed even at zero. The test asserts the buckets by
  name _and_ that no `/\b(\d+)\/\1\b/` survives anywhere in stdout, on a record
  holding all four states at once.

  **It found a real defect in a merged record on its first run over live data**,
  which is the strongest evidence the check is worth its cost:

  ```
  $ node scripts/citations.mjs tools/planner/docs/work/pl-24-....md
    MOVED  .../grounding-fixtures.test.ts:29 "finds a place the checked-in candidate sets name…"
           anchor … is not in 29 — it is at 53
  3 verified, 1 moved, 2 unanchored, 1 unresolvable — of 7 citations
  ```

  The old script reported line 29 as resolved. It is a doc comment.

  ### What the ticket had wrong, and what I chose against
  - **"a migration story _or_ a two-format reader" is a false alternative.** See
    above; the two-format reader is the entire migration.
  - **The upstream-error section is right and is already fixed in prose**, so
    nothing here re-litigates it. `records.md` keeps _cite what you read_.
  - **Anchors are matched against the file joined into one string**, because the
    text worth anchoring wraps — repo-7 cites `03-RELEASING.md:97-99` for text
    that spans lines 118 and 119 of the target and is on neither. Line-by-line
    matching reports "not anywhere in the file" and is wrong.
  - **Lines are joined raw, so an anchor spanning a comment's `//` does not
    match.** Not fixed, and the boundary has a test on it rather than a comment:
    of 13 hand-written anchors, one needs the join and none needs a marker
    stripped, so stripping `//`/`*`/`#` would be built for a case nothing has
    asked for. The reason printed — `not anywhere in the file` — is the hint, and
    the fix is a shorter anchor.
  - **A trailing `...` in an anchor is a truncation mark, not text.** Two of the
    13 end in one; treating the dots literally reports both as moved.
  - **The unanchored note prints on stdout, not stderr.** The existing suite
    asserts `stderr === ""` on a zero exit, and that invariant is worth more than
    putting advice next to the failures.
  - **`ok: boolean` is gone from `checkCitations`.** A boolean is the two-state
    model the ticket calls the defect; every caller now has to name which of four
    it means.
  - **Not folded in: `dl-30`'s dangling `## Review` reference**, per instruction.
    Confirmed still present at `c37cab9` — `dl-30`'s Log line 440 reads "The
    record is in the Review section above", and `grep -n '^#'` on that file lists
    `## Why`, `## Build`, `## Done when`, `### Gate 1`, `## Log` and no `Review`.
    The gate record is the `### Gate 1` nested under `## Done when`. Unchanged
    here; it is the owner's call to file or fold.

  ### Not measured, and one decision left open
  - **No existing record was rewritten or re-anchored**, deliberately. So the
    tool's behaviour on the other 952 citations is measured only as
    `unanchored` — I have not verified any of them.
  - **`--section` interaction with anchors is untested beyond the existing
    span-filter tests.** Filtering happens before checking and does not touch
    anchors, but I did not add a case for it.
  - **Open decision for the owner, not settled here:** should an unanchored
    citation eventually be an _error_? Turning it on today fails every gate run
    against every record in the tree, so it needs a ticket and a moment, not a
    default flip. Options: (a) leave it advisory — recommended, and what shipped;
    (b) add a `--require-anchors` flag for new records, ~5 lines, dead until
    something passes it; (c) flip the default once a later ticket finds the
    active records anchored.
  - **This ticket's own file now contains an extractable anchored citation** —
    the `tls-origin.ts:144 "Defence in depth"` in _Open question_ is an
    illustration of the format, and a run over this record reports it `MOVED`.
    That is the carve-out `records.md` already names: a citation that is a
    finding's own evidence stays as written.

  `npm run check` and `npx vitest run scripts` pass; commands and totals in the
  gate section above this Log.

- **2026-09-05** — `--require-anchors` added on the owner's instruction, after
  the entry above closed with this as an open decision. I recommended leaving it
  advisory — a flag nothing uses is a flag nobody maintains, and this repo builds
  for the second real consumer rather than the first guess. **The owner chose to
  build it**: a branch can hold itself to the stricter standard now, and a later
  ticket flipping the default finds the machinery tested. Recorded because the
  recommendation and the decision differ, and the next reader should see both.

  **It changes the exit code and nothing else.** A citation's state is a fact
  about the record; whether `unanchored` is tolerable is the caller's policy. So
  there is no fifth state and no repainting — the per-citation lines and all four
  buckets are byte-identical with and without the flag, asserted by comparing the
  two runs' mark lines directly. The default is untouched: exit 0, every existing
  record still passes.

  ```
  $ node scripts/citations.mjs <dl-36 record> --rev e9f516b
  0 verified, 0 moved, 9 unanchored, 0 unresolvable — of 9 citations
  exit=0
  $ node scripts/citations.mjs <dl-36 record> --rev e9f516b --require-anchors
  0 verified, 0 moved, 9 unanchored, 0 unresolvable — of 9 citations, anchors required
  exit=1
  ```

  The `, anchors required` suffix rides on the summary line so a CI log names the
  policy beside the numbers it judged, and the unanchored note moves from stdout
  to stderr **only** when the flag is on — which preserves the invariant the
  suite already leaned on, that stderr is empty exactly when the exit is 0.

  **The estimate of "~5 lines" was wrong, and the reason is worth keeping.**
  `FLAGS` was documented "All take a value" and `parseArgs` consumed
  `argv[++i]` for every flag it recognised, so `--require-anchors` is the first
  valueless flag this CLI has had. Left alone it would have swallowed the ticket
  file as its value — repo-14's defect one flag over. `FLAGS` now carries arity
  as data (`{option, takesValue}`) and `parseArgs` assigns by option name into a
  keyed object, which also deletes the `if (option === "rev") … else …` branch
  that was there. Both argument orders are tested.

  **A rubber stamp found and fixed on the way.** The existing test asserting that
  the docblock, `USAGE` and `FLAGS` name the same flags matched them with
  `/--[a-z]+/g`, which stops at a hyphen: it read `--require-anchors` as
  `--require` in all three sources at once and compared them equal without ever
  seeing the flag. Now `/--[a-z][a-z-]*/g`. It is the same agreeing-while-wrong
  shape this ticket is about, inside the test that was supposed to catch it.

  **Red before green, and the naive version of this test is green on unfixed
  code** — worth stating because it nearly shipped that way. The old script also
  exits 1 on `--require-anchors`, with `unknown option`, so
  `expect(status).not.toBe(0)` passes against a source that has no flag at all.
  Measured on the pre-ticket source, same record:

  ```
  --- stdout ---            (empty)
  --- stderr ---
  unknown option --require-anchors
  usage: node scripts/citations.mjs <ticket-file> [--rev <sha>] [--section <name>]
  --- exit=1 ---
  ```

  So the test asserts the run _happened_: the summary present on stdout, the
  count named on stderr, and stderr **not** matching `/unknown option/`. All
  three fail against the output above. The whole suite against
  `origin/main:scripts/citations.mjs` is now **23 of 37 failed**, all three flag
  tests among them, still every failure an assertion and none a missing export.

  **The unexported-internals property survives, and was checked rather than
  assumed.** `FLAGS` and `parseArgs` were already exported, so nothing new was
  added:

  ```
  $ diff <(git show origin/main:scripts/citations.mjs | grep '^export ') \
         <(grep '^export ' scripts/citations.mjs)
  $ echo $?
  0
  ```

  Unchanged, as instructed: no existing record rewritten, `records.md` keeps the
  migration story — extended with the flag's contract and with the stale sentence
  saying the question "is not settled" corrected, since it now is, as an opt-in.

  Coordinated with the gating reviewer (`abf27c3dcbe4fe477`) before committing,
  since a new commit moves the lines a gate record cites.

  `npm run check` and `npx vitest run scripts` pass — 141 tests.

- **2026-09-05** — Gate on `23d3b56` came back from `abf27c3dcbe4fe477`: **PASS**,
  every claim in the prior two entries independently reproduced by methods of its
  own choosing (its own extraction script rather than mine, its own materialized
  copy of the tree rather than a shared one), not by re-running mine. Committed
  above as `## Review`, verbatim, with all ten of its own citations re-checked
  against `23d3b56` with this ticket's own tool before commit — `10 verified, 0
moved, 0 unanchored, 0 unresolvable`.

  **This ticket's thesis, demonstrated on this ticket's own gate record.** The
  `## Review` section above is a record whose citations were resolved against
  `23d3b56` and committed after `82ad6ab` had moved the lines. Run the branch's
  own tool over it twice, from the tip (`951fb6f`):

  ```
  $ node scripts/citations.mjs docs/work/repo-18-citations-resolve-is-not-correct.md \
      --section Review --rev 23d3b56
  10 verified, 0 moved, 0 unanchored, 0 unresolvable — of 10 citations

  $ node scripts/citations.mjs docs/work/repo-18-citations-resolve-is-not-correct.md \
      --section Review
  2 verified, 8 moved, 0 unanchored, 0 unresolvable — of 10 citations
  ```

  Every one of the eight, with where it went:

  ```
  "expect(after?.state).toBe("                            274 -> 277
  "expect(atTip.stdout).toMatch(summary(0, 1, 0, 0, 1))"  576 -> 586
  "${counts.verified} verified, ${counts.moved} moved"    413 -> 432
  "expect(result.stdout).not.toMatch(SAME_OVER_SAME)"     599 -> 609
  "The open question is answered: anchor text"            146 -> 139, 174
  "Migration: nothing already committed is rewritten"     299 -> 306
  "spanning a comment's continuation marker does not…"    310 -> 313
  "result.stderr).toBe("                                  195 -> 198, 703
  ```

  **The old tool would have called this record `10/10 resolve` and exited 0.**
  Every one of those ten line numbers still exists in its file; not one of them
  dangles. Eight point at something else. That is the whole ticket, measured on
  the artefact that gates the ticket — and it is why the pin line above the
  reviewer's table is not bookkeeping. Two of the eight resolve to more than one
  line (`139, 174` and `198, 703`) because the anchor text now appears in this Log
  as well as at its referent; `locateAnchor` reports every occurrence rather than
  the first, which is what makes that visible instead of arbitrary.

  **Scope question, raised by the reviewer and now answered by the owner's side:
  fold `82ad6ab` into this gate round.** The reviewer declined to extend its own
  review to the new commit without being told to, on two grounds it raised itself
  — extending scope mid-gate is not its call, and it could not verify from inside
  its sandbox that "the owner directed this" was true rather than a relayed
  claim. Both were right, and the second is a real structural gap: **a builder can
  claim owner authority and a reviewer has no way to check it.** The orchestrator
  has confirmed the provenance — put to the owner through `AskUserQuestion` with
  three costed options, this ticket's recommendation to leave the flag advisory
  quoted first with its objection intact, and the owner chose to build it anyway
  — and is recording the gap in the skill's reference, since the fix is that an
  owner decision must travel with its provenance and not only its content. The
  reviewer is re-running its reproduction set against the new tip.

- **2026-09-05** — Gate extended: `abf27c3dcbe4fe477` folded `82ad6ab` into its
  round on the orchestrator's instruction and returned **PASS** on
  `82ad6ab`/`2de66cd`, committed above as `### Gate 2`, verbatim, immediately
  after `### Gate 1`. Every check in it was run independently rather than read
  off this Log — including, unprompted, running the pre-repo-18 tool against
  this ticket's own `## Review` section a second time and getting the same
  `10/10 resolve, exit 0` I had already reported, with the same two damning
  lines (`citations.mjs:413`, `citations.test.ts:599`).

  **One correction made at commit time, not by the reviewer's request.** Gate 2
  records the builder as "Opus" by inference from dispatch practice, flagged by
  the reviewer itself as unconfirmed. This builder's own system context states
  directly that it is **Sonnet 5**, which the Gate 2 text now says, with the
  correction marked as mine and the reviewer's original reasoning left intact
  above it rather than silently replaced. Worth surfacing beyond this ticket: the
  orchestrating skill's own dispatch table treats "difficulty absent → inherit,
  Opus in practice" as close to certain, and this build is the case where that
  did not hold.

  Both gates are final. `npm run check`, `npx vitest run scripts` (141 passed)
  and `npm run status -- --json` all pass at `2de66cd`. Opening the PR next.
