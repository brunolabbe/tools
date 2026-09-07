---
id: repo-30
tool: repo
title: The documented id sweep cannot see repo-wide tickets, and fails short instead of failing
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-30 — The id sweep cannot see repo-wide tickets

## Why

`docs/01-TICKETS.md` says the next free id is the union of two lists, and
`.claude/skills/orchestrate-tickets/reference/concurrency.md` gives the command
that computes it. It was at line 139 of that file on this branch's base,
`24e5bf7`; the block moved when this ticket fixed it, so that is deliberately
written as prose rather than as a live citation — a coordinate that now resolves
to the repaired command would misdescribe the defect below.

```bash
{ git ls-tree origin/main tools/<tool>/docs/work/ --name-only
  for pr in $(gh pr list --state open --json number --jq '.[].number'); do
    gh pr diff "$pr" --name-only
  done
} | grep -oE '<prefix>-[0-9]+' | sort -u -t- -k2 -n | tail -1
```

It has two defects, and they compose into a silent wrong answer rather than an
error. **Two id collisions on 2026-09-06/07 are the reproduction.**

### 1. It reads the wrong directory for `repo-` ids — structural, not transient

Repo-wide tickets live in `docs/work/`. The snippet reads
`tools/<tool>/docs/work/`. There is no `tools/repo/`, so run verbatim for a
`repo-` prefix the merged half of the sweep contributes **nothing at all**:

```
git ls-tree origin/main tools/repo/docs/work/ --name-only | grep -oE 'repo-[0-9]+' | sort -u   ->  0 ids
git ls-tree origin/main docs/work/            --name-only | grep -oE 'repo-[0-9]+' | sort -u   -> 26 ids, highest repo-26
```

The whole merged history of `repo-` ids is invisible to the documented command,
and the answer comes from open pull requests alone. This is permanent and
reproduces on a quiet repo with no concurrency at all.

### 2. Nothing checks an exit status, so a failure shortens the list

There is no `set -o pipefail` and no status check anywhere in the pipeline. A
`gh pr diff` that fails for one pull request writes to stderr, contributes no
stdout, and the final `tail -1` still returns a plausible-looking number. The
sweep cannot distinguish "no higher id exists" from "I could not read the pull
request that holds it".

**This trap is sharper than it looks, and it caught the fix for it.** `grep`
exits 1 on _no match_, which is not an error here — a pull request whose diff
touches no ticket file is ordinary. A first cut at the corrected sweep added
`set -euo pipefail` without guarding the greps, and every pull-request-sourced id
vanished from the output while the script still exited 0. The guard belongs in
the Build below because the obvious fix reintroduces the defect it is fixing.

### What it cost, end to end

Recorded from two sessions on 2026-09-06/07, the second half relayed by the peer
session that hit the first (`tools-93`) and reproduced here before being written
down:

1. That session's sweep returned `repo-26` as the highest while `repo-27` was
   already sitting in PR #170's diff. It reserved `repo-27` on that basis.
2. It caught the clash only because its filing agent died to a rate limit and the
   state was re-checked on resume — not because anything in the process looks.
3. Both sessions then filed a `repo-28`: PR #171
   (`repo-28-the-standard-sonnet-trial.md`) and PR #172
   (`repo-28-citations-carry-no-anchor.md`). The lower number kept the id and
   #172 renamed to `repo-29`.

**A misdiagnosis is part of the record**, because it is the reason this ticket
names a mechanism rather than a symptom. The first account attributed the
silence to a `2>/dev/null` wrapping the loop in `concurrency.md`. No such
redirect exists — `grep -rn "gh pr diff" --include="*.md"` returns four hits
across the tree and none redirects stderr. It was in that session's own
invocation, not in the skill. Patching a redirect that was never there would
have left both defects intact.

## Build

1. **Fix the path in `concurrency.md`.** The sweep must read both ticket roots,
   because the ticket format has two: `docs/work/` for `repo-`, and
   `tools/*/docs/work/` for a tool prefix. Do not make the caller substitute a
   `<tool>` that does not exist for repo-wide work.

2. **Make it fail loudly**, and **guard each `grep` while doing so** — `grep`'s
   exit 1 on no-match is not an error, and `pipefail` without the guard silently
   drops every pull-request-sourced id. Verified working, exits 127 rather than
   printing a short list when `gh` is unavailable:

   ```bash
   set -euo pipefail
   prefix="${1:?usage: sweep <prefix>}"
   emit() { { grep -oE "${prefix}-[0-9]+" || true; } | sort -u | sed "s|^|$1 |"; }
   {
     { git ls-tree origin/main docs/work/ --name-only
       git ls-tree -r origin/main tools/ --name-only | { grep '/docs/work/' || true; }
     } | emit "merged"
     for pr in $(gh pr list --state open --json number --jq '.[].number'); do
       gh pr diff "$pr" --name-only | emit "PR#$pr"
     done
   } | sort -u -t- -k2 -n
   ```

3. **Report every claimant with its source, not just the maximum.** `tail -1`
   throws away the provenance that makes a clash legible. The corrected form
   prints `merged repo-26`, `PR#170 repo-27`, `PR#171 repo-28`, `PR#172 repo-29`
   — which names the holder of every id above the merged high-water mark, and is
   what turns "the number looks free" into "here is who has it".

4. **Say in `concurrency.md` that the sweep cannot close the race**, because the
   fix invites the belief that it can. Measured in the same incident: the first
   sweep saw the other session's branch **commitless**, so it read as a possible
   claimant rather than a real one, and a sweep taken minutes earlier would not
   have seen it at all. A branch is not a claim until it carries a commit, and no
   command run at time T sees a claim made at T+1. The page already says to tell
   the other session which ids you hold; this is the measurement that says why
   that sentence is load-bearing rather than polite.

5. **Lift the sweep out of the page into `scripts/next-id.mjs`, with a spec.**
   Added after the first four shipped and were gated. The builder and the
   orchestrator both recommended this as a _separate_ ticket; the repo's owner
   was given that recommendation in those terms and chose to fold it in here, so
   the route is decided and the shape is not. `concurrency.md` keeps the
   reasoning and names the command instead of carrying it. The precedent to
   follow is `scripts/citations.mjs`, whose own header gives the argument: the
   work is mechanical, it must produce the same answer every time, and a snippet
   has nowhere to put a test.

## Done when

1. The sweep in `concurrency.md` reads `docs/work/` as well as
   `tools/*/docs/work/`, and a worked run for a `repo-` prefix returns a non-empty
   merged half.
2. It exits non-zero when `gh` or `git` fails, rather than printing a short list —
   demonstrated by a run with the command unavailable.
3. Each `grep` in it is guarded against its no-match exit, and a pull request whose
   diff contains no ticket file does not truncate the output.
4. The output names the source of each id, not just the highest.
5. `concurrency.md` states that the sweep narrows the race and does not close it,
   with the commitless-branch case as the reason.
6. `npm run check` passes and `npm run status -- --json` exits 0.
7. The sweep is `node scripts/next-id.mjs <prefix>`, `concurrency.md` names it
   rather than carrying it, and lines 1–4 above hold of the script — each as a
   test in `scripts/test/next-id.test.ts` rather than as a worked run in a Log.
8. **Every guard in the script has been watched failing**: removing it turns a
   named test red, demonstrated one guard at a time rather than argued. A
   mutation that fails to apply must report as unapplied, not as a pass.

## Review

**Gate: PASS** — 2026-09-07 · `origin/main@24e5bf7...40e8d1b` · self-run defect hunt at medium depth (no `code-review`/`Skill` tool available to the `ticket-reviewer` subagent)

**Scope note: this gate covers `40e8d1b` only** — the sweep script and its surrounding prose in `concurrency.md`, plus the matching ticket Log entry. It was run before the `scripts/next-id.mjs` lift was folded into this branch and says nothing about that code; a later commit needs its own gate.

| Done when                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sweep reads `docs/work/` as well as `tools/*/docs/work/`, worked run for `repo-` returns a non-empty merged half    | verified — ran the committed script (sed-extracted from the tip, never retyped) against this repo; returned `merged repo-1` through `merged repo-30`, 30 ids                                                                                                                                                                                                                                                        |
| Exits non-zero when `gh` or `git` fails, rather than printing a short list                                              | verified — `gh` removed from PATH via a real symlink farm (not a stub): exit 127; `gh` returning a 401: exit 1; run outside a git repository: exit 128                                                                                                                                                                                                                                                              |
| Each `grep` is guarded, a pull request whose diff has no ticket file does not truncate the output                       | verified — 4-PR stub board (one PR touching no ticket file, ordered first): the sweep continued past it and every ticket-bearing PR's ids reached the output                                                                                                                                                                                                                                                        |
| The output names the source of each id, not just the highest                                                            | verified — same board: `PR#903 repo-30` and `merged repo-30` both printed; `PR#902 repo-99` and `PR#904 repo-99` both printed; neither pair collapsed                                                                                                                                                                                                                                                               |
| `concurrency.md` states the sweep narrows the race and does not close it, with the commitless-branch case as the reason | verified by inspection — the claim and the commitless-branch reasoning are present in the page's prose. No automated check of markdown prose content exists in this repo: read `scripts/citations.mjs` end to end and confirmed it verifies citation _targets_ and anchor text, never a claim's semantic content, and no test file anywhere references `concurrency.md`. Inspection is the ceiling, not a shortcut. |
| `npm run check` passes and `npm run status -- --json` exits 0                                                           | verified — both re-run directly, both exit 0                                                                                                                                                                                                                                                                                                                                                                        |

- **dropped** · my own finding from the first round of this gate: that `sort -t- -k2 -n` (no `-s`) risks non-deterministic ordering among equal-key rows. Measured backwards. GNU sort's `-s` _disables_ last-resort whole-line comparison; without it the sort is fully deterministic, and adding `-s` is what introduces order-dependence on equal keys. Reproduced independently against the builder's own harness (three feed-orders of four equal-key rows, byte-identical without `-s`; two feed-orders of the same two rows, different with `-s`). No action needed; not a defect.
- **low** · addressed on the branch, not left open: a stub `gh` failing after partial stdout (`pr list` or `pr diff` dying mid-write) was unexercised when I raised it. The builder reproduced it — the committed sweep exits 1 in both cases, the un-briefed one-liner it replaces printed a plausible id and exited 0 in both — and recorded it in the ticket's Log with the reproduction. Carried, and resolved within the reviewed range.
- **findings** · self-run defect hunt at medium depth returned 2; 1 dropped (wrong), 1 carried and resolved on the branch before this record.
- The two un-briefed fixes in the diff (hoisting `gh pr list` out of the `for`, dropping `sort -u`) were both reproduced independently against the ticket's own literal Build-step-2 snippet, not just read: the inline form exits 0 with `gh` absent where the hoisted form exits 127, and `sort -u -t- -k2 -n` silently drops a real second claimant of an id on the same stub board that the plain `sort -t- -k2 -n` does not. Both fixes are required by the ticket's own Done-when lines 2 and 4 respectively — not scope added on top of the brief, but a bug in the brief's own illustrative code.
- NFR: security n/a (doc-only change, describes but does not execute anything) · performance n/a · reliability + (the whole change is a reliability improvement — fail loudly, guard the no-match case) · maintainability — see the dropped/low bullets above; no other concern.

**Transcription note, by the builder.** The section above is the reviewer's own text, sent to me as the section it wanted committed and committed as sent. I asked for it rather than composing one from its two conversational messages, which would have put my words over its name. Nothing was altered: the only things dropped are the two `---` rules that fenced the section in the message, and whatever `oxfmt` does to table padding. **There were no `file:line` coordinates to re-resolve**, and that is the reviewer's decision, not an omission — I warned it that the `scripts/next-id.mjs` lift was about to move every line inside the sweep, and it chose prose over coordinates that would be stale before a reader could check them. The scope note is likewise its own, written after I told it the branch would grow past what it gated.

### Gate — 2026-09-07 · `40e8d1b...6a5944b` (the `scripts/next-id.mjs` lift) · self-run defect hunt at medium depth

**PASS**, additive to the gate above — Done-when 1-6 are unchanged from the `40e8d1b` record and were not re-derived here.

| Done when                                                                                                                                             | Proof                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The sweep is `node scripts/next-id.mjs <prefix>`, `concurrency.md` names it rather than carrying it, and lines 1-4 hold of the script, each as a test | verified — ran the CLI directly (`node scripts/next-id.mjs repo`, real output); `concurrency.md`'s fence now reads `node scripts/next-id.mjs <prefix>`; all four properties hold as named tests in `scripts/test/next-id.test.ts`, confirmed both green and — via the mutation harness — red when the guard is removed |
| Every guard has been watched failing, one at a time, source restored byte-identical; a mutation that fails to apply reports as unapplied, not a pass  | verified — re-ran the mutation harness myself (adjusted only its `REPO` path) against the committed source: all 7 mutations turned a named test red, `restored: true`; independently confirmed the SKIPPED-vs-pass distinction is real by corrupting one mutation's anchor on purpose                                  |

- **low** · cosmetic only: the tie-break orders by raw string comparison on the source label, so `PR#902` sorts before `merged` (uppercase before lowercase) — deterministic and tested, just not the ordering a reader might expect at a glance. Not proposing a change.
- **findings** · self-run defect hunt at medium depth returned 1; carried as the low note above, 0 dropped.
- Suite count: 130 files / 2184 tests at `6a5944b`, vs 129/2170 at `40e8d1b` — +1 file, +14 tests, matching the reported delta exactly.
- NFR: security n/a (no user-influenced input, no shell, argument arrays throughout) · performance n/a · reliability + (mutation-verified guards are a stronger bar than the ticket's own Done-when 1-4 asked of the shell version) · maintainability + (see low note above; otherwise no concern).

**Transcription note, by the builder.** The reviewer's text, committed as sent, minus the `---` rules that fenced it in the message. It is a `###` under the first record rather than a peer of it, because the first was committed without one and re-heading somebody else's verbatim section to make the file symmetrical is the edit a gate record exists to forbid. Again no `file:line` coordinates, so again nothing to re-resolve. Four claims in it I checked against the tip rather than relaying: the failure table has **7** data rows and maps one-to-one onto the seven mutations; no "of the six" lead-in survives the revision; `scripts/test/tsconfig.json` carries `../next-id.mjs`; and `"PR#902" < "merged"` is true in JS, so the low note describes real behaviour. **The low note is accepted and deliberately not fixed.** `merged` first would arguably read better — the merged claim is the settled one and the pull requests are the contenders — but the order is deterministic, asserted by a test, and carries no meaning that a reader acts on; changing it would rewrite a test expectation to buy nothing. It is recorded here so the next person to notice it finds a decision rather than an oversight.

### Gate — 2026-09-07 · `6a5944b...4e1e325` (the CI-caught fixture defect) · self-run defect hunt at medium depth

**PASS.** This covers only the fix for the CI failure on `4e1e325`; Done-when 1-8 are unchanged from the prior two records and were not re-derived.

- Reproduced the CI failure independently from the actual run (`34125118107`, both `ubuntu-latest` and `windows-latest`, `expected 128 to be 127`), and reproduced the underlying mechanism by hand-building a checkout matching a default `actions/checkout` (no remote-tracking refs) — confirmed `128` on the default rev with the new advice text, `127` on `--rev HEAD`, without going through any of the builder's own scripts.
- Attacked both things asked: `--rev HEAD` holds in a detached-HEAD, no-remote-tracking checkout (the exact shape I built by hand) — could not break it; the exact-exit-code assertion is justified because `next-id.mjs`'s own docblock makes preserving the child's exit code a documented design claim, which a `not.toBe(0)` assertion would leave unverified.
- **finding, on my own prior work, not on this diff** · my `6a5944b` gate's "verified" line for Done-when 2 had the same blind spot this CI run exposed: my manual PATH-farm reproduction also ran against a checkout with `origin/main` present, so it never isolated "git fails before gh is reached" either. Recorded here rather than silently carried forward; changes no verdict, since the underlying production code was always correct — only the proof was narrower than it read.
- Mutation harness re-run independently (JSON-driven version, `REPO`/`HERE` adjusted only): `mutations: 8 stale: 0 unpinned: 0 restored: true`, matching exactly.
- The Windows `PATHEXT` fix in `pathWithout` is sound reasoning I cannot test directly (no Windows here) — traced it by hand: extension-preserving basename means a farm entry keeps `git.exe`'s own name, which `PATHEXT` resolution needs and a bare `git` link would not satisfy. No regression on Linux, confirmed my own reproduction still passes through the fixed function.
- **findings** · self-run defect hunt at medium depth returned 1 (the self-finding above, not a defect in this diff); 0 dropped.
- NFR: security n/a · performance n/a · reliability + (fixes a real CI-blocking gap in the test's own fixture, not the production code) · maintainability + (the advice text and the `concurrency.md` caveat make the failure legible to the next person who hits a shallow clone).

**Transcription note, by the builder.** Committed as sent. Three claims re-checked against the tip rather than relayed: `gh run view 34125118107` reports `conclusion: failure` on sha `2ab326c`, which was the tip when CI ran; `concurrency.md` contains no stale guard count in prose (`grep` for "seven"/"eight" returns 0 occurrences); and its failure table has 8 data rows, matching the 8 mutations. **The self-finding in the third bullet was volunteered, not extracted** — the reviewer identified that its own earlier "verified" on `Done when` 2 shared the blind spot CI found, and wrote it into its own record. That is the more useful half of this gate: the production code was right the whole time, and what both of us had actually proved was narrower than what either of us wrote down.

## Log

- **2026-09-07** — Filed out of two live collisions rather than a code read. Id
  confirmed free against both lists: `docs/work/` topped out at `repo-27` on this
  branch's base, `git grep "repo-30\b"` returned nothing, and the corrected sweep
  in _Build_ was run against the live board — `merged repo-26`, `PR#170 repo-27`,
  `PR#171 repo-28`, `PR#172 repo-29` — so `repo-30` is the first free id under the
  command this ticket is fixing, which is the only check that would have caught
  either collision.

  **Handed over rather than raced.** The peer session `tools-93` hit the first
  collision, proposed the rename, and declined to file this so the two decisions
  would not share a page — its `repo-29` is about citation anchoring. It
  reproduced the `ls-tree` finding independently before agreeing (0 ids against 26) and corrected its own published account of the cause. Both halves of that
  exchange are in the record above because the misdiagnosis is what makes the
  distinction between mechanism and symptom worth writing down.

  **Not folded in:** nothing in `docs/01-TICKETS.md` changed. Its "union of two
  lists" sentence is correct as written; it is the command in `concurrency.md`
  that does not implement it, and putting the fix in both places would give the
  next reader two commands to keep in sync.

- **2026-09-07** — Built on `repo-30-id-sweep-repo-tickets` off `origin/main`
  at `24e5bf7`. One file changed: the sweep and its surrounding prose in
  `.claude/skills/orchestrate-tickets/reference/concurrency.md`. Every guard was
  measured failing before it was measured holding, with the snippet **extracted
  out of the committed page** rather than retyped, so what was run is what a
  reader would copy.

  **The brief's own replacement snippet had two defects, and both are fixed
  differently here.** Build step 2 asserts it "exits 127 rather than printing a
  short list when `gh` is unavailable". It does not: `for pr in $(gh pr list …)`
  discards the substitution's status even under `set -e`, so with `gh` off the
  PATH the snippet printed the merged half and **exited 0** — the exact failure
  the step exists to fix, surviving inside its own fix. Hoisting the list into
  its own assignment, `prs="$(gh pr list …)"`, makes the same run exit 127. And
  Build step 3 wants every claimant named, but the snippet ends `sort -u -t- -k2
-n`, and `sort -u` dedupes on the **key**, not the line: against a board
  holding `repo-99` in two different pull requests it printed `PR#901 repo-99`
  once and dropped `PR#903` entirely, and an id held both merged and in a PR lost
  its PR row. The clash the sweep exists to surface was the one thing it erased.
  Dropping `-u` fixes it — each `emit` already dedupes within its own source.

  **Measured, on `origin/main@24e5bf7`.** Defect 1: `tools/repo/docs/work/`
  yields 0 ids against 30 in `docs/work/`; run verbatim for `repo-` on today's
  board, whose only open PRs are the two release PRs, the old one-liner printed
  **nothing at all** and exited 0. Defect 2, four ways: `gh` missing — old exit 0
  (empty), new **127**; `gh` present but 401 — old exit 0, new **1**; run outside
  a repository — old printed `repo-99` off the PR half under a `fatal: not a git
repository` line and exited 0, new **128**; `pipefail` with unguarded greps —
  the first PR touching no ticket file aborts the loop and takes every later PR's
  ids with it. The failure injection used a stub `gh` on `PATH` (a four-PR board:
  one touching no ticket file, one holding `repo-99`, one re-touching an already
  merged `repo-30`, one holding `repo-99` a second time) and a `PATH` symlink
  farm with `gh` deliberately absent, so 127 is a real command-not-found rather
  than a stubbed status.

  **Where the ticket's Why is now imprecise, and left standing.** It says the
  unguarded-grep variant loses the PR ids "while the script still exited 0". The
  loss reproduces; the exit-0 half does not in this shape — with `pipefail` on
  the outer pipeline the aborted group surfaces as **exit 1**. Left as written
  because it is a record of what that session saw, and corrected here rather than
  edited there.

  **The line-139 citation into `concurrency.md` in _Why_ was rewritten as
  prose** (spelled out that way here so this sentence is not itself parsed as a
  live citation into a line that moved), naming
  the base commit instead of a line number. The block moved, and a coordinate
  that still resolved would now point at the repaired command while the sentence
  around it describes the broken one — the failure `scripts/citations.mjs` exists
  to catch, in a file the checker would have reported as fine.

  **Not folded in, second time.** `reference/history.md` also describes this
  command's failure, correctly and in the past tense, under a heading that says
  "none fixed here". It is a record of a session, not instructions, so changing
  it would falsify the record. `.claude/skills/orchestrate-tickets/SKILL.md` was
  not read for related wording either: `repo-21` holds that file in another
  worktree, and a second writer there is a merge conflict rather than a fold-in.

- **2026-09-07, after the gate** — The gate passed `f30422d` and reproduced every
  measurement independently. Both of its two informational notes were run rather
  than accepted, and one of them **inverted**, so the page gained a row.

  **`sort -s` is the trap from the other side.** The note read the missing `-s`
  as leaving equal-key rows unordered run to run. GNU `sort --help` says the
  opposite in its own words — "`-s, --stable` stabilize sort by disabling
  last-resort comparison" — so bare `sort` compares whole lines as a last resort
  and is totally ordered. Measured on coreutils 9.4: the four equal-key rows
  `PR#901 repo-99` / `PR#903 repo-99` / `merged repo-30` / `PR#902 repo-30` fed
  in three different input orders came back **identical** all three times without
  `-s`; the same two `repo-99` rows fed in the two possible orders came back in
  **different** orders _with_ `-s`. Adding `-s` buys exactly the instability it
  would be added to prevent, so the code comment and the table now say not to.

  **Partial stdout before a failure is handled, and was the gate's second note.**
  A stub `gh` that prints some of its output and then exits 1 was not exercised
  by anything, so it is now: with `gh pr list` dying half-written the sweep exits
  **1** before reading anything; with `gh pr diff` dying half-written it prints
  the ids it got — `PR#900 repo-77` — and still exits **1**, never reaching the
  later pull request. The old one-liner in both cases printed `repo-88` and
  exited **0**. That is the ticket's whole defect, so the case belonged in the
  record even though it changes no verdict.

  **Also settled with the gate:** the `sort -u` removal is required by the
  ticket's own _Done when_ 4, not scope added on top — the brief's illustrative
  snippet keeps `-u` and therefore fails that line. Neither of us could find
  anything executable behind _Done when_ 5; `scripts/citations.mjs` resolves
  citation targets, not prose claims, and `grep -rn "concurrency.md"` over `.ts`
  and `.mjs` returns nothing outside `node_modules`, so "PASS by inspection" is
  the ceiling and is recorded as such rather than dressed up.

- **2026-09-07, the lift** — The sweep is now `scripts/next-id.mjs` with
  `scripts/test/next-id.test.ts` behind it, and `concurrency.md` names the
  command instead of carrying it. **This was folded in against the
  recommendation of both the builder and the orchestrator**, who each argued for
  a separate ticket; the repo's owner was given that argument in those terms and
  chose to fold it in. Recorded because the next reader should know the shape was
  decided, not defaulted.

  **Seven guards, each watched failing before it was believed.** A harness
  removed one guard at a time from the script and recorded which tests went red —
  reading only the tools root (red: the both-roots test, and two others that
  depend on the merged half), not filtering the tools root to `docs/work/`,
  reading a failed command's stdout, treating a missing command as an ordinary
  failure, deduping across sources as `sort -u` did, breaking ties by input
  order, and swallowing a failing `gh pr list`. Every one produced red in the
  test named for it, and the source was restored byte-identical afterwards
  (asserted by the harness, not assumed). The seventh mutation's anchor went
  stale against the formatter on the first run and reported `SKIPPED` rather than
  passing quietly — which is the only reason it was noticed, and is why the
  harness distinguishes "no test failed" from "the mutation did not apply".

  **A test of mine was wrong before the code was.** The partial-stdout test first
  drove `node -e "<program>"` and asserted the leaked id was absent from the
  thrown message. It went red against a working guard, because the message echoes
  the command's arguments and the program text was in them. An assertion that
  cannot tell leaked stdout from an echoed argument checks nothing, so the child
  is now a file on disk and the payload is nowhere in argv.

  **Two things deliberately not done.** No `npm run next-id` alias: the closest
  sibling, `scripts/citations.mjs`, is invoked as `node scripts/…` and has no
  alias either, and inventing one here would make the two look like different
  kinds of thing. And the script does not restrict matches to paths shaped like a
  ticket file — over-reporting a claim costs a reader a glance, under-reporting
  one is this ticket's entire subject, so the two errors are not weighed equally.

  **One earlier "not folded in" is reversed, and the reason it was declined no
  longer holds.** The first Log entry left `docs/01-TICKETS.md` alone because
  putting the sweep in two places would give the next reader two commands to keep
  in sync. There is now exactly one command in exactly one file, so naming it
  from the ticket-format page duplicates nothing — one sentence added there,
  saying what it computes and, more usefully, the two halves it _cannot_ see (the
  ids promised in Logs, and a peer's unpushed branch).

  **Parity with the shell version it replaces was checked, not assumed:** both
  return 30 merged `repo-` ids on this tip, and the new one adds `next free:
repo-31`. `dl` → `dl-46`, `pl` → `pl-38`.

  **The override produced the better artefact, and that is the note worth
  keeping.** The builder recommended filing the lift as a separate ticket and the
  orchestrator agreed; the owner read both arguments in their own terms and folded
  it in anyway. What our recommendation would have produced is a twenty-line
  untested snippet still sitting in a documentation page, plus a ticket in the
  backlog — which is _exactly the state this ticket was filed to fix_, one layer
  up and with the fix already in hand. Two agents recommending the same thing is
  not a measurement, and the fact that both of us reached for the process answer
  over the cheap one is more interesting than either argument was.

  It also earned the sharpest thing on this page, which is worth stating on its
  own: **a spec over a sweep that was never shown failing is the same defect one
  layer up.** The seven mutations exist because writing tests for a sweep whose
  guards nobody had watched fail would have reproduced repo-30 in TypeScript —
  green, confident, and proving nothing. The gate then did the same thing to the
  harness: it corrupted a mutation's anchor on purpose to confirm that `SKIPPED`
  is genuinely distinct from a pass, which is the same question asked one layer
  further up again. Three layers, and the same trap at each.

- **2026-09-07, the CI red** — PR #176 failed on both `ubuntu-latest` and
  `windows-latest`: `expected 128 to be 127`, in the one test named
  `a command that is not on PATH exits 127`. **The fix is three lines and the
  reason is the entry.**

  **A default `actions/checkout` creates no remote-tracking refs.** It fetches
  one commit; there is no `origin/main`. So `git ls-tree origin/main` exited 128
  and the sweep stopped there, before `gh` — the command the test is about — was
  ever spawned. Reproduced by rebuilding that checkout rather than by reading the
  workflow: `git init`, `git fetch --depth 1 origin <sha>`, `git checkout
FETCH_HEAD`, no remote-tracking refs at all; the CLI returns **128** with the
  default rev and **127** with `--rev HEAD`, through the same `PATH` farm.

  **The assertion had never once observed what its name describes.** It passed
  three times here and twice on the reviewer's machine — five runs across two
  machines — and all five had an `origin/main` to read, because both were working
  clones. This is exactly the shape recorded under _tests that measure the
  sandbox_: the test measured a property of the developer's checkout and
  reported it as a property of the code. Five green runs on two machines is not
  independent evidence when both machines share the assumption.

  **What changed, and what deliberately did not.** The test now passes
  `--rev HEAD`, so the _other_ command succeeds and `gh` is genuinely the one
  that fails — the fixture finally establishing the condition it names. And it
  asserts **which** child failed before it asserts a number: a bare `toBe(127)`
  is equally satisfied by `git` being missing, so the number alone could never
  have told the two apart. The documented promise was not weakened; `Done when` 2
  asks only for a non-zero exit, and it would have been easy to relax the
  assertion to `not.toBe(0)` and go green while learning nothing.

  **Two things folded in, both earned by the incident rather than by tidiness.**
  A failed default-rev `git ls-tree` now appends what to do — `git fetch origin
main`, or `--rev HEAD` — while keeping git's own 128, because a bare
  `fatal: Not a valid object name` is the ordinary experience of anyone running
  this in a shallow clone, and legibility on failure is the entire subject of
  this ticket. It **does not** fall back to `HEAD` on its own: answering
  confidently from a different tree is the defect in one more costume.
  `concurrency.md` gains the caveat that an exit code says _which child failed_,
  not _what went wrong_.

  **And one hazard found while fixing it, not by failing.** The `PATH` farm
  linked `git` under a name with no extension, which Windows' `PATHEXT` lookup
  cannot find for a `git.exe` — the same shims-and-shebang trap
  `.claude/rules/testing.md` records against `node_modules/.bin`. It would not
  have failed loudly: the farm would have supplied neither command, the first
  call would have died, and a `toBe(127)` might well have passed on the wrong
  command. The link now keeps the resolved file's own basename. That this was
  invisible on Linux is the same lesson as the rest of the entry.

  **The guard set is 8 now, not 7**, and the harness re-run against the fixed
  source reports `mutations: 8 stale: 0 unpinned: 0 restored: true`. The gate
  record above says seven and maps them one-to-one onto a seven-row table; that
  was true at `6a5944b` and is left exactly as the reviewer wrote it. The eighth
  is the missing-rev advice, which did not exist when it was gated.

  **Not mine, and not touched:** `scripts/test/citations.test.ts` fails on
  `windows-latest` on `main` at `24e5bf7` too, with none of this branch's work in
  the tree. It arrived with repo-25 and is inherited by every branch; the
  orchestrator is handling it separately.
