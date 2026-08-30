---
id: repo-12
tool: repo
title: The board shows merged work as ready, and nothing catches it
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-12 — The board shows merged work as ready

## Why

`npm run status -- --ready` is the board, and on 2026-08-30 it was offering work
that had merged the day before. `pl-29` merged in #102 on 2026-08-29 with
`status: ready` still in its frontmatter, so for a day the board listed a
finished ticket as available. At 14,809 est. tokens it was also the largest
candidate on that board, so an orchestrator reading its intake would have spent
more context on merged work than on any live ticket.

Nothing caught it. The convention — _move a ticket to `done` by editing the
ticket, in the commit that earns it_ — is real and is stated in the root
`CLAUDE.md`, but it is a convention, and this is the second class of board defect
that turned out to need a mechanical check rather than a rule. `repo-6` was the
first: a dangling `depends_on` silently emptied the view, and the fix was a
non-zero exit from `status --json` wired into CI.

**The naive check is wrong, and the wrong version is worse than none.** "A merged
PR names ticket `X`, so `X` should be `done`" produces false positives, because a
pull request routinely _files_ a ticket rather than finishing one. Verified while
writing this: `repo-5` reads `status: ready` and its PR #79 merged — and it is
correct, because #79 was `docs(repo): file the dev-server HOST lift as a decision
(repo-5)`, the commit that created it. `concurrency.md` already documents this
shape from the other direction: commit subjects and PR titles both lie.

So the check has to distinguish _a PR that finished a ticket_ from _a PR that
mentioned one_, and that is the decision this ticket carries.

## Build

1. Decide the signal. Candidates, cheapest first:
   - **The ticket file's own diff.** A PR that finishes `X` almost always edits
     `X`'s file (the Log entry and the `status` change are the same commit). A PR
     that merely files `X` also edits it — but it _creates_ it. `git log
--diff-filter=A` distinguishes creation from modification.
   - **The `## Review` section.** A finished ticket carries a gate record; a
     filed one does not. Stronger signal, and it is already required.
     **Falsified on 2026-08-30, one commit after this was written** — see the
     Log. `dl-29` was filed by #107 and its filing pull request was itself
     gated, so a filed ticket can carry a gate record too. The signal survives;
     the convention had to change, in `docs/01-TICKETS.md` and in PR #111.
   - Anything reading PR titles is out, for the reason in _Why_.
2. Implement it where `repo-6` put its check — in `scripts/status.mjs`, reachable
   from `status --json`, so CI gets it for free through the exit code rather than
   through a second workflow.
3. Report it the way `danglingDependencies` reports: named by file and by id, on
   stderr beside the view, so a human running `npm run status` sees it too.
4. Add the case to `scripts/test/status.test.ts`, including **the `repo-5` shape**
   as an explicit non-finding — a ticket that is `ready` with a merged PR that
   created it must not be flagged.

## Done when

- `npm run status -- --json` exits non-zero when a ticket is `ready` while its
  work has demonstrably merged, and names it. **`in-flight` is deliberately out**
  — ruled on 2026-08-30 and recorded in the Log: a ticket that lands as a partial
  reads `in-flight`, so a gate record on one is not a defect.
- A ticket that is `ready` and whose only merged PR _created_ its file is **not**
  reported. `repo-5` is the checked-in case.
- The check is proven by making it fail first: a test asserts the non-zero exit
  and the message, not merely that the happy path is quiet.
- `pl-29` needs no fix — it was corrected by hand on 2026-08-30 — but its shape is
  the fixture.

## Review

### Gate 1 — 2026-08-30

**Gate: FAIL** · `origin/main...4128986` · `review-ticket`. Recorded as given and
not rewritten to "FAIL, addressed": the round that answers it is below, and a
gate that edits itself once the work is done records nothing. The verdict is
about this ticket's own text — the record carried an unresolved decision as prose
while the frontmatter said `done`, which is the shape the root `CLAUDE.md`
forbids and which closing the ticket guaranteed nobody would reopen. No finding
disputed the design.

| Done when                                                                     | Proof                                                                                                                                                    |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--json` exits non-zero when a `ready` ticket's work has merged, and names it | **proven** — `scripts/test/status.test.ts:916` asserts exit 1, the stderr line and the `--json` payload; the reporter itself at `scripts/status.mjs:250` |
| A ticket whose only merged pull request _created_ its file is not reported    | **proven** — `scripts/test/status.test.ts:838`, over `repo-5` and `repo-12` both                                                                         |
| Proven by making it fail first — the exit code and the message, not silence   | **proven** — `scripts/test/status.test.ts:916`; three mutations, each red only in its own case, recorded in the Log                                      |
| `pl-29` needs no fix; its shape is the fixture                                | **verified** — the fixture is `scripts/test/status.test.ts:817`, and the real file at `98b5e61` was run through the CLI at `--root`                      |

**Findings.**

- **F1 · high · fixed** — an open decision left in prose on a ticket marked
  `done`. _Done when_'s first line was corrected to `ready` only, the paragraph
  now records the ruling and its reasoning, and the decision is closed.
- **F2 · med · fixed** — `renderView`'s JSDoc declared
  `ReturnType<typeof danglingDependencies>` while `main` passed a concatenation
  of both checks. Now a named `Problem` typedef, `scripts/status.mjs:598`.
  `checkJs` is off for this file, so nothing would have caught it.
- **F3 · low · fixed** — the tilde-fence branch of `hasGateRecord` was
  hand-verified and uncommitted. `scripts/test/status.test.ts:885`.
- **F4 · low · pinned, not fixed** — an unclosed fence swallows a real gate
  record below it, so a ticket that should be flagged is not.
  `scripts/test/status.test.ts:898` asserts the behaviour and says why: repairing
  it means guessing which of an odd number of fences was the typo, and guessing
  wrong turns a missed row into a red pipeline.
- **F5 · no change** — the gate re-resolved `pl-28`'s two "**`status` stays
  `ready`**" declarations independently and both say what the builder claimed, so
  the premise for excluding `in-flight` held.

**What this gate did not do.** It did not check the counterfactual that the check
would have gone red on #102's own branch before the merge — that claim rests on
the file's content at `98b5e61` being what the branch carried, which is likely
but unverified. It inspected no Actions run, so the depth-1 behaviour of
`ci.yml`'s `check` job is still read off the workflow file rather than observed.
It also predates the `dl-29` false positive found afterwards, against a board it
never saw.

## Log

- Filed 2026-08-30 out of an audit of the orchestrator skill, which measured
  intake cost across the ready board and found `pl-29` on it a day after merging.
  Its status was corrected in the same commit as this ticket; the correction is
  one line and had nothing left to decide, so by `docs/01-TICKETS.md` it was not
  worth a ticket of its own. **The gap that allowed it is**, because which signal
  to check is a real decision with wrong answers.
- `repo-5` was tested against the naive heuristic and is a false positive. It is
  named in _Done when_ so the implementation cannot pass without handling it.

**2026-08-30 — built. The signal is the `## Review` section, and the check is
narrower than this brief asked for.** `scripts/status.mjs` gained
`hasGateRecord` and `reviewedButReady` beside `danglingDependencies`, wired into
`main`'s one `problems` list — so `--json` exits 1 through the exit code
`ci.yml`'s `check` job already reads, every other view prints the warning on
stderr beside the table, and `--json`'s payload carries it as
`kind: "reviewed-but-ready"`. `readTickets` now returns one field read from the
body rather than the frontmatter, `reviewed`. Eleven cases in
`scripts/test/status.test.ts`, and each was proven by mutation rather than by a
green run: reverting the check to `OPEN.has(status)`, removing the fence
handling, and dropping the wiring out of `main` each turn exactly the cases
named for them red.

**Step 1's decision, with the measurements.** Over the 11 open tickets on `main`
at `1d420b7`:

- _The ticket file's git history_ (`--diff-filter=A`) flags `dl-16` and `pl-2`:
  two false positives in 11, both genuinely open, both edited after creation by
  another ticket's pull request — which is the convention that a shape-level
  review finding lands on the sibling tickets in the same PR as the fix, not an
  accident. It is also blind exactly where it must run: `ci.yml`'s `check` job
  has no `fetch-depth`, so it gets a depth-1 checkout with no history, and a
  history-based check would pass there by seeing nothing. **The two candidate
  signals in step 1 therefore disagree on real tickets, and the cheaper one is
  the wrong one.**
- _The `## Review` section_ flags none of the 11, and catches `pl-29` at its
  merge commit `98b5e61` — reproduced by extracting that tree with `git archive`
  and running the CLI at `--root`. It needs no git, no network and no `gh`.
  It would also have gone red on #102's own branch, before the merge.

**Where the brief was wrong: `ready` or `in-flight`.** _Done when_ asks for both,
and the wider rule has a false positive the brief did not know about. Running the
check over the whole board at `98b5e61` returned **two** hits, not one: `pl-29`,
and `pl-28`, which had landed as a partial in #74 with two gate records that each
wrote "**`status` stays `ready`**" and sat on the ready board for seven days
until #104 closed it. That makes `pl-28` a third instance of this defect — but it
also means that flagging `in-flight` would leave a landed partial no correct
status at all, since `done` was a lie while two of its acceptance rows read
`unproven`. So the check fires on `ready` only. That is the claim nothing
disputes — a gate record means the work was picked up, and `ready` means nobody
has — and it is where the harm is, because `--ready` is the board and never
offers an `in-flight` ticket. **Note for the reviewer: this is a deliberate
miss against _Done when_'s first line, not an oversight.**

**What it cannot see.** A ticket can finish without a gate record — `pl-16` is
`done` and carries none, and `pl-5`'s Log records that finding being raised and
dropped — so the check is a floor, not a proof, and the inverse (`done` implies a
gate record) would be false today. Nothing here reads a pull request, merged or
otherwise; "demonstrably merged" is inferred from the ticket's own body, which is
what makes it work in a shallow CI checkout.

**Folded in rather than deferred:** `docs/01-TICKETS.md` said a dangling
`depends_on` was "the one exception" to the strict parser, which this change
falsifies — it is now a two-item list naming both checks. `ci.yml`'s comment
listing what its `--json` step catches gained the new case, and the reason a
history-based check could not have lived there.

**Decided, not left open: a ticket that lands as a partial reads `in-flight`.**
The user ruled on 2026-08-30, and _Done when_'s first line was corrected to match
rather than left overclaiming. The reasoning, so it is not re-litigated: the
history signal costs two false positives in 11 open tickets against the `##
Review` section's zero; `pl-28`'s two gate records each wrote "**`status` stays
`ready`**" for a landing that genuinely had work left, and a rule covering
`in-flight` would have left it no true status, since `done` was a lie while two
acceptance rows read `unproven`; and `--ready` is the view that does the harm,
because it is the board an orchestrator reads and it never offers an `in-flight`
ticket. This paragraph replaces an open question written as prose, which is the
shape the root `CLAUDE.md` forbids — it went stale the moment the ticket closed,
and closing the ticket guaranteed nothing would reopen it.

**Gates:** `npm run check` and the full `npm test` pass; `node scripts/status.mjs
--json` over this branch's board exits 0. No container, e2e or CI run was
exercised — the depth-1 claim about `ci.yml` is read off the workflow file, not
observed in Actions.

**2026-08-30 — gate 1's findings, and a live false positive that holds the
branch.** Gate 1 returned FAIL on the ticket's text, not the code: the record
above carried an unresolved decision in prose while the frontmatter said `done`.
Fixed as described. Two code findings came with it and are fixed: `renderView`'s
JSDoc still declared `ReturnType<typeof danglingDependencies>` after `main`
started passing both kinds — now a named `Problem` typedef — and the tilde-fence
branch of `hasGateRecord` had no committed test. The gate also found that an
**unclosed** fence swallows a real gate record below it; left as it is and pinned
by a test, because repairing it means guessing which of an odd number of fences
was the typo, and guessing wrong turns a missed board row into a red pipeline.

Two fold-ins landed with it, both the user's call: the unhandled `EPIPE` when the
view is piped into `head`, which predates this ticket and was fixed here because
repo-12 was already in the file; and a self-test for `.oxfmtrc.json`'s
`ignorePatterns` in `packages/core/test/`, which asks oxfmt itself whether each
entry excludes anything — repo-4's defect, made mechanical.

**Then the check was re-run against `origin/main` at `6b6c785`, and it fires on
`dl-29`.** That is a false positive and the branch is held for it. `dl-29` was
filed by #107 and is genuinely unbuilt `ready` work, but its filing pull request
was itself gated and the gate was recorded in `## Review` — so the premise this
ticket's _Why_ rests on, "a finished ticket carries a gate record; a filed one
does not", was falsified one commit after the ticket was written. Merging as-is
would redden `ci.yml`'s `check` job on `main` immediately, and the real-board
case in `scripts/test/status.test.ts` with it. The options are in this branch's
report to the orchestrator; none of them is a builder's to take alone.

**2026-08-30 — the `dl-29` false positive, resolved by fixing the concept.** The
user ruled: a gate on a pull request that only _files_ a ticket is not a
`## Review`, because that section answers one question — was _the work_ checked —
and a filing has no work in it. **No code changed.** `dl-29` keeps its gate,
unedited and where its author put it, under `## The gate on this filing`; only
the section title changed, plus a paragraph saying it moved and why (PR #111,
`docs(downloader)`, three insertions and one deletion). The rule it follows is
now in `docs/01-TICKETS.md` under "The review gate", and in
`.claude/skills/review-ticket/SKILL.md`, which `git check-ignore` confirms is
tracked and can carry it — a convention that lives only in a document the
reviewer does not open is a convention that gets broken again next week.

It ships as **two** pull requests because release-please routes a commit to a
tool by the files it touched, never by the scope in its subject: this branch is a
`fix(repo)`, `fix` is not hidden, so one `.md` under `tools/downloader/` in it
would have cut a downloader release for a ticket-file edit. #111 is
`docs(downloader)`, which is hidden, and it must merge first — until it does,
this check reports `dl-29` and `main` goes red.

**The composite signal was considered and not taken, and the objection that
killed it earlier was mine and was wrong.** Requiring a gate record _and_ a file
modified after creation would clear `dl-29` (created by #107, untouched since)
while still catching `pl-29` and `pl-28`: zero false positives across both boards
measured. I first rejected it because `ci.yml`'s `check` job has no `fetch-depth`
and reads a depth-1 checkout — true, but the repository is **535.96 KiB packed
over 182 commits**, so `fetch-depth: 0` costs seconds and that objection was
cheaply removable. It was withdrawn. What replaced it is a real cost and a real
risk: the CLI tests drive throwaway trees that are not git repositories at all,
so the history read needs an injected seam and the fixtures need rework, roughly
40 to 60 lines; and the signal fires again the moment any sibling pull request
edits a gated-but-`ready` filing, which is the same convention that produced the
`dl-16` and `pl-2` false positives in the first place. Fixing the concept costs
four lines of documentation and leaves the check reading nothing but the ticket.
If a filing gate lands in `## Review` again despite both notes, this is the
fallback and the measurements above are the starting point.

**2026-08-30 — the oxfmt scan died on Windows, and not for the reason it was
diagnosed.** `test (windows-latest)` failed on the fold-in above with
`AssertionError: expected '' to contain 'excluded by ignore rules'`, which reads as
a coupling to oxfmt's diagnostic wording. That was the finding handed to me and
it was wrong. The process never started:

```console
$ cat node_modules/oxfmt/bin/oxfmt
#!/usr/bin/env node

import "../dist/cli.js";
```

A shebang script behind a symlink. Windows does not honour `#!`; npm writes
`.cmd` and `.ps1` shims beside it, and node refuses to spawn those without a
shell. So `stdout` and `stderr` came back `undefined`, `?? ""` collapsed them to
`''`, and the assertion blamed a missing _message_ for a missing _process_.
Fixing only the wording would have left the test dead on Windows and looking
repaired.

**The half that is bigger than this ticket: a package's `bin` cannot be spawned
directly on Windows in a repo that forbids `shell: true`** — and this one does,
repo-wide, enforced by `packages/core/test/spawn-safety.test.ts`. Resolve the
package and run its entry under `process.execPath` instead:
`createRequire(import.meta.url).resolve("<pkg>/package.json")`, then its `bin`
field. That has no platform-specific spelling. Anyone here writing a test that
shells out to a tool will hit this, and the easy way out is closed by design.

The scan now also asserts `expect(result.error).toBeUndefined()`, so a spawn that
fails fails **by name** rather than disguising itself as an assertion about
output — which is the whole reason this cost a CI leg to find.
