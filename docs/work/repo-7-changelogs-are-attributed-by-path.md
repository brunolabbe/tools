---
id: repo-7
tool: repo
title: A repo-scoped commit that touches one file under tools/ lands in that tool's changelog
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-7 — release-please attributes by path, and the rule we wrote says scope

**Packages:** `docs`, `release-please-config.json`

## Why

The root `CLAUDE.md` states the rule this way:

> A commit that touches two tools lands in both changelogs under one sentence
> written for one of them, which is the tell that it should have been two
> commits.

That is true and it is not the whole rule. `release-please-config.json` declares
`tools/downloader` and `tools/planner` as `release-type: simple` packages, and
release-please attributes a commit to a package by **the paths it touches**, not
by the scope in its subject. So the sentence generalises: _any_ commit of a
releasable type (`feat`, `fix`, `perf`, `revert` — the four not `hidden` in
`changelog-sections`) that touches **one file** anywhere under `tools/<name>/`
lands in that tool's changelog and bumps its version, whatever its scope says.
**The generalisation is the inference, and it is the part to check** — what is
measured below is the two halves it rests on, that attribution follows the path
and that the scope is not consulted. Build step 2 says how to close the gap.

**This is measured, not predicted**, in the two release-please branches open on
`origin` today. The pending planner `0.4.0` has, under `### Fixes`:

```
* **core:** make the image scan fail by name, and stop it passing blind (pl-17) (#56) (2ea0631)
```

and the pending downloader `0.2.0` — a **minor** bump, from `0.1.1` — is headed
by:

```
### Features
* **planner:** run the fan-out as a job (pl-16) (a112cd4)
```

`2ea0631` is a `fix(core)` that touched both `Dockerfile`s and the planner's
docs, so it is in both tools' notes. `a112cd4` is a `feat(planner)` that lifted
rate limiting into `packages/core` and edited seven files under
`tools/downloader/api/` — which is also every file it touched under
`tools/downloader/`, so no counting convention makes it more — and so decided
the downloader's next minor version.
Neither commit is wrong. Both were attributed by the paths in their diff, and
the scope in the subject — the thing this repo enforces on every commit — had no
part in it.

**What makes it a defect rather than trivia is the collision with the other
convention this repo has.** A finding about a sibling ticket is supposed to be
written onto that sibling, in the same pull request as the fix
([repo-6](./repo-6-dangling-dependency-kills-the-view.md) did exactly that for
[repo-3](./repo-3-show-a-closed-ticket.md), and the review skill asks for it).
repo-3 wanted to append a two-line `_Outcome:_` annotation to a finding in
`tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md` — a pure documentation
edit — from a commit reading `fix(repo): … (repo-3)`. On the mechanism above
that would have cut the planner a patch release whose only changelog line is
about `scripts/status.mjs`; that exact shape has never occurred here, which is
why step 2 asks for it to be run rather than assumed.
repo-3 dropped the annotation for that reason and the loop it wanted to close is
still open, which is the cost being paid today.

Splitting the branch into two commits does not help: this repo **squash-merges**,
so the pull request title is the single commit that lands and it carries every
path in the branch.

## Build

1. **Establish which of the two fixes is wanted, and say so in the Log** — they
   are alternatives, not steps:
   - **Write the rule down as it actually is.** One sentence in the root
     `CLAUDE.md` beside the existing one, and in
     [docs/03-RELEASING.md](../03-RELEASING.md) where the taxonomy lives:
     attribution is by path, a releasable type is enough, and a repo-scoped
     commit that annotates a tool's ticket is a release. Cheapest, changes no
     behaviour, and leaves the annotation blocked.
   - **Exclude documentation from the release paths.** release-please has no
     per-package path exclusion, but a `docs(...)`-typed commit is `hidden` and
     does not release — so an alternative is to require that a cross-tool
     documentation annotation is its own pull request titled `docs(<tool>): …`.
     That is a rule about branches rather than about config, and it costs a
     second pull request per annotation.
2. **One thing above is inferred rather than measured, and it is the one the
   rule turns on.** Both worked examples touched a tool's _code_ as well as its
   documentation, so what is proven is that attribution follows the path and
   ignores the scope. That a commit whose only path under `tools/<name>/` is a
   `.md` file releases that tool follows from the same mechanism but has never
   happened here — no releasable-type commit on `main` has that shape. Prove it
   before writing it down: a scratch branch with a `fix(repo):` subject touching
   only `tools/planner/docs/work/*.md`, run through
   `npx release-please --dry-run` or the same manifest logic, is enough. If it
   turns out release-please ignores such a commit, the annotation repo-3 wanted
   is simply allowed and this ticket collapses to a documentation note.
3. **Do not "fix" it by rewriting history or by editing a generated
   `CHANGELOG.md`.** They are release-please's, and it regenerates them from the
   commits.

## Done when

- The root `CLAUDE.md` (or `03-RELEASING.md`, per step 1) states that changelog
  attribution is by path, in terms an agent about to annotate a sibling ticket
  would read.
- The `fix(core)` line in the planner's pending changelog and the
  `feat(planner)` line in the downloader's are named as the worked examples,
  with their commits, so the next reader does not have to re-derive them.
- Step 2's measurement is in the Log with the command that produced it, and the
  documentation says only what that measurement supports.
- If step 1 chose the second option, the rule says which title a cross-tool
  documentation pull request carries.

## Gate 1A (the measurement) — `repo-7-changelog-attribution` @ `fb33ee6` — **CONCERNS**

Scope: the release-please measurement only. Citation resolution, the `repo-9`
ticket and the repo invariants were gated separately as 1B. This gate was
interrupted mid-run by a session usage limit and resumed; worktree re-verified
clean at `fb33ee6` before any evidence below was gathered.

_Citations in this record were gathered at `fb33ee6` and re-resolved as the last
action before staging, against the commit that carries this record — the commit
that applies the corrections it asked for. The verdict, the findings and their
wording are the gate's own and are unedited; only line numbers moved._

### Was measurement A reproduced? Yes — independently, end to end.

One scratch branch was pushed, the dry run was run fresh, and the output rendered
here is this gate's own, not the builder's paste.

**Safety audit before pushing.** The builder's Log says "all four workflows are
`push: branches: [main]`". **There are seven workflow files, not four** — at the
branch tip and at base `567f9e5`. Every `on:` block was read:

| workflow                  | `push`                     | other triggers                     | fires on a bare branch? |
| ------------------------- | -------------------------- | ---------------------------------- | ----------------------- |
| `ci.yml:57-69`            | `branches: [main]`         | `pull_request`, schedule, dispatch | no                      |
| `downloader.yml`          | `branches: [main]` + paths | `pull_request`                     | no                      |
| `planner.yml`             | `branches: [main]` + paths | `pull_request`                     | no                      |
| `release.yml:18-23`       | `branches: [main]`         | `workflow_dispatch`                | no                      |
| `security.yml:14-22`      | `branches: [main]`         | `pull_request`, schedule, dispatch | no                      |
| `pr-title.yml:16-20`      | none                       | `pull_request` only                | no                      |
| `cache-cleanup.yml:19-21` | none                       | `pull_request: [closed]`           | no                      |

No `push` trigger accepts a non-`main` ref; the `pull_request` triggers need a PR
and none was opened. `gh run list --branch repo-7-verify-scratch` returned empty —
no CI was spent.

**What was run.** Branch `repo-7-verify-scratch` off `567f9e5`, one commit
`bd6b783` — `fix(repo): reviewer A scratch measurement, annotate a planner ticket
only (repo-7)` — whose only file is
`tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md` (`git show --name-only`
confirms exactly one path). Then `release-pr ... --dry-run`, release-please
17.11.1.

```
> Backfilling file list for commit: bd6b783d8976b3a2a9b4a3d44289e5f0f751f749
> Found 1 files
+ Splitting 5 commits by path
+ Building candidate release pull request for path: tools/downloader
> commits: 0
+ No commits for path: tools/downloader, skipping
+ Building candidate release pull request for path: tools/planner
> commits: 1
+ Considering: 1 commits
! pullRequestTitlePattern miss the part of '${scope}'
Would open 1 pull requests
title: chore(planner): release 0.4.1
### Fixes
* **repo:** reviewer A scratch measurement, annotate a planner ticket only (repo-7) ([bd6b783](...))
```

**Measurement A reproduces exactly.** Same title, same section, downloader
skipped at 0 commits, same `Splitting 5 commits by path` mechanism, same benign
`pullRequestTitlePattern` warning. `CLAUDE.md:234-235`'s "cuts planner `0.4.1`"
is true as written.

**Cleanup, proven.** Branch deleted from `origin` and locally as the immediate
next action. `git ls-remote --heads origin | grep -c verify-scratch` -> **0**.

**Not run by this gate:** measurement B (`docs(planner)`), and `perf`/`revert`.
One scratch push was the authorisation and it was spent on A. B remains the
builder's self-report, corroborated by config but not measured here.

### Is the rule stated wider than its evidence? No.

| clause                                                                                      | line    | established by                                 |
| ------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------- |
| "routes a commit to a tool by the files it touched, never by the scope"                     | 231-232 | A + both worked examples                       |
| "a `fix(repo):` whose only path under `tools/` is a single `.md` releases that tool anyway" | 232-234 | A, verbatim                                    |
| "cuts planner `0.4.1`"                                                                      | 235     | A, verbatim                                    |
| "`docs` is `hidden` in `release-please-config.json`"                                        | 236     | config, line-checked                           |
| "the same commit as `docs(planner): ...` releases nothing"                                  | 237     | B (builder's, not re-run; config corroborates) |
| annotation "rides in a pull request titled `docs(<tool>): ...`"                             | 237-238 | follows from B                                 |

No clause overstates. The prose does not claim `perf`/`revert` were measured, and
`03-RELEASING.md:199-209` names the gap. The ironic failure is avoided. The
defect runs the other way — see F2.

### Findings

#### F1 — med. `2ea0631`'s file count is wrong in a landed document, in the passage claiming to have re-derived it

`docs/03-RELEASING.md:110-111` — "both `Dockerfile`s and **three** of the
planner's documents"; `docs/work/repo-7-...md:781-783` — "**three** files,
**two** of them tickets".

Actual `git show --name-only 2ea0631`, planner documents:
`tools/planner/docs/02-ROADMAP.md`, `tools/planner/docs/03-STATUS.md`,
`.../work/pl-17-dockerfile-workspace-scan.md`,
`.../work/pl-21-name-the-bare-fields.md`,
`.../work/pl-5-orchestrator-and-fan-out.md` — **five**, **three** of them
tickets. Both numbers wrong, in both places.

_Failure scenario:_ `03-RELEASING.md` exists so "the next reader does not have to
re-derive them" (`:94-95`); a reader who checks gets 5 against a published 3 and
must re-derive both examples — the cost the section was written to remove. The
conclusion is unaffected (the two `Dockerfile`s alone put the commit in both
changelogs), so this is a citation defect, not a rule defect.

#### F2 — med. The operative rule names `feat`/`fix`; the config's releasing set is `feat`/`fix`/`perf`/`revert`

`CLAUDE.md:238-241` and `docs/03-RELEASING.md:180-182` enumerate two of the four
un-`hidden` types.

_Failure scenario:_ an agent on a `perf(downloader): ...` branch owing a planner
sibling annotation reads `CLAUDE.md:238-241`, sees its type is neither `feat` nor
`fix`, folds the annotation in — and the planner is released off one `.md` file.
Exactly the outcome repo-7 exists to prevent.

Severity is held down by `03-RELEASING.md:199-209` disclosing the gap, by
`CLAUDE.md:246` linking there, and by there being **zero** `perf`/`revert`
commits in all 166 commits of history. It is raised by a **tension inside one
document**: `03-RELEASING.md:68-70` states "a `perf:` commit on its own therefore
releases nothing", while `:203-209` states the "no user facing commits" skip does
not cover `perf`. Both cannot be comfortably true, and `:163-165` picks a side
implicitly. `CLAUDE.md` carries the enumeration with **no caveat at all**, and it
is the document an agent reads by default.

#### F3 — minor. "all four workflows" (ticket Log `:735-740`)

There are seven, at the tip and at the base. The safety conclusion is correct —
all seven were audited here — but an agent repeating the measurement would check
four files and have to redo the audit.

#### F4 — minor. The stated justification for `docs(repo)` over `fix(repo)` contradicts itself

Ticket Log, final section: "`fix(repo)` ... would still have released nothing
here, but it would have put a line about a documentation edit into the next
changelog of whatever it touched." Both clauses cannot hold. The branch touches
nothing under `tools/` (4 files, all `CLAUDE.md`/`docs/`), so release-please
splits by path, finds 0 commits for both packages, and produces no changelog line
anywhere. The **conclusion is right** for the cleaner reason the branch also
gives (documentation with no behaviour, so `docs` is the honest type); only the
supporting sentence is wrong.

#### F5 — no change needed. "heads that release's `### Features`" (`03-RELEASING.md:97-99`)

In `tools/downloader/CHANGELOG.md` the first Features line is the `09bd161`
duplicate (line 8); `a112cd4` is line 9. Same text, and the branch flags the
duplication at `:104-107`. Noted, not a defect.

### Verified correct — no change needed

- Measurement A, reproduced independently; output matches in every load-bearing line.
- `release-please-config.json`: packages exactly `tools/downloader` and
  `tools/planner`, `release-type: simple`; `hidden: true` on `refactor`, `docs`,
  `test`, `build`, `ci`, `chore`; absent on `feat`, `fix`, `perf`, `revert`.
- `a112cd4` — exactly seven files under `tools/downloader/`, all under `api/`.
  `03-RELEASING.md:101-102` is right.
- `tools/planner/CHANGELOG.md:18` and `tools/downloader/CHANGELOG.md:14` are both
  the `2ea0631` line under `### Fixes`. Exact, not "near".
- Both releases shipped (`planner-v0.4.0`, `downloader-v0.2.0` are tags), so the
  ticket's "pending" framing was indeed stale and correctly rewritten.
- Downloader 0.2.0: two `Features`, nine `Fixes`, minor bump from `0.1.1`. The
  corrected "only entry" text is accurate.
- The branch's commit is `docs(repo): ...`; `commit-message.mjs` exit 0. Type and
  title agree, so the squash-merged message lands as `docs(repo)` and releases
  nothing. **Caveat for the merger:** the PR title is what lands — retyping it
  `fix(repo):` would still release nothing (no `tools/` paths) but would disagree
  with the branch's own commit and with the rule the branch documents.

### What this gate did NOT do

- Measurement B, `perf` and `revert`: unmeasured here.
- `npm run build` / `npm run check`: not run; nothing in this scope depends on
  them and `node_modules` was never linked (the dry run uses `npx`).
- The `pullRequestTitlePattern` warning: present in both runs, benign, uninvestigated.

## Gate 1B (documentation, record, invariants) — `repo-7-changelog-attribution` @ `fb33ee6` — **CONCERNS**

Scope: citation resolution, the `repo-9` ticket, and the repo invariants. The
release-please measurement was gated separately as 1A. This gate was interrupted
mid-run by a session usage limit and resumed; worktree re-verified clean at
`fb33ee6` before any evidence below was gathered.

_Citations in this record were gathered at `fb33ee6` and re-resolved as the last
action before staging, against the commit that carries this record — the commit
that applies the corrections it asked for. The verdict, the findings and their
wording are the gate's own and are unedited; only line numbers moved._

**47 citations resolved; 2 failed.** Both failures are numeric claims in the
branch's new prose, and both sit in passages the Log advertises as re-derived
from the repository. Every citation was resolved **after** `npm run check` and
`npx oxfmt --check`, not before.

### Findings, most severe first

#### 1 — med. The rewritten worked example replaces a stale claim with a false one: "three of the planner's documents" is **five**

`docs/03-RELEASING.md:110-111`; `docs/work/repo-7-...md:781-786` ("it is three
files, two of them tickets").

Ground truth for `2ea0631` under `tools/planner/docs/`:
`02-ROADMAP.md`, `03-STATUS.md`, `work/pl-17-dockerfile-workspace-scan.md`,
`work/pl-21-name-the-bare-fields.md`, `work/pl-5-orchestrator-and-fan-out.md` —
**five** files, **three** of them tickets. Neither published number survives.

The original brief said "the planner's docs" — vague and _true_. The Log replaced
it with a specific count and published that count under a heading asserting "Both
worked examples were re-derived from the repository, not taken on trust". The
other example (`a112cd4`, seven files under `tools/downloader/api/`) verifies as
**exactly correct** — so one was genuinely re-derived and one was not, under a
sentence claiming both were.

**This repo has already gated this exact defect on this exact document.**
`docs/work/repo-3-show-a-closed-ticket.md:223` records a prior med-low finding —
"`repo-7` states a measurement that is wrong by four, in the section headed
'measured, not predicted'" — where `a112cd4` was written as eleven files and
corrected to seven. The same species has recurred on the sibling example in the
same passage, and now reads as reviewed.

_Failure scenario:_ a reader checking whether the by-path rule is trustworthy
re-derives the one example the doc offers as evidence, gets 5 against a published
3, and has no way to tell which other number in the section was eyeballed. The
rule itself is unaffected; the document's credibility as a measured record is
what this ticket was for.

#### 2 — low-med. Off-by-one in the evidence-bounding caveat: "the other four hidden types" is **five**

`docs/03-RELEASING.md:199-200`. `release-please-config.json:30-35` declares six hidden
types — `refactor`, `docs`, `test`, `build`, `ci`, `chore` — and
`03-RELEASING.md:149-150` correctly lists all six. `docs` was measured, leaving
**five** unmeasured. The ticket Log gets this right by enumeration (`:838-840`
lists five), so the published summary contradicts its own source.

_Failure scenario:_ this is the sentence whose entire job is to bound what the
measurement supports. A reader who counts the list two paragraphs up gets six,
subtracts `docs`, gets five, and is left wondering which sixth type was quietly
measured — undermining the caveat exactly where it is meant to build trust.

#### 3 — low-med. The document now tells you to split into two commits, and that splitting into two commits does not help

Read in order, as a stranger:

- `CLAUDE.md:224-228` (pre-existing): "...which is the tell that it **should have
  been two commits**."
- `docs/03-RELEASING.md:92` (pre-existing): "...a hint that it **should have been
  two commits**."
- `docs/03-RELEASING.md:193-197` (**added by this branch**, ~70 lines below `:92`,
  same section the branch edited): "**Splitting the branch into two _commits_ does
  not help**: this repo squash-merges, so the title is the one commit that lands
  and it carries every path in the branch."

Both are individually true under different readings of "commit" (`:92` means two
separate changes/PRs; `:193` means two literal commits on one branch). The branch
did not introduce `:92`, but it introduced the sentence that contradicts it into
the same document and section, and it is the new paragraph that makes the old
wording actively hazardous. `CLAUDE.md:230-246` does give the correct remedy, so
a reader who continues is fine; the risk is the reader who stops.

_Failure scenario:_ an agent fixing a downloader bug that also owes a planner
sibling-ticket annotation reads `CLAUDE.md:226-228`, splits its branch into two
commits, opens one PR titled `fix(downloader): ...`, and the planner is released
off one `.md` file — the exact outcome this ticket exists to prevent.

#### 4 — low. `03-RELEASING.md:119-124` cites `01-TICKETS.md` for a convention that is not written there

"This repo asks that a finding about a sibling ticket be written onto that
ticket, in the same pull request as the fix, and [01-TICKETS.md] makes the review
gate work the same way." The link resolves and the _second_ clause is accurate
(`01-TICKETS.md:163-169`). But the sibling-annotation convention appears
**nowhere** in `docs/01-TICKETS.md` and nowhere in
`.claude/skills/review-ticket/SKILL.md` — `git grep -n -i sibling` over
`.claude/ docs/ CLAUDE.md` hits only unrelated usages and ticket prose in
repo-6/repo-7. `CLAUDE.md:238-241` likewise calls it "the sibling-finding note **the
review gate asks for**". The convention is real (repo-6 practised it;
`docs/adr/003:147,180,194` carry the `_Outcome, <date>:_` pattern), but a reader
who follows the pointer to confirm the obligation will not find it. Not a wrong
statement — an unbacked one.

#### 5 — no change needed. `541be9f` / `cafc9aa` are unresolvable outside this checkout

`docs/03-RELEASING.md:146` prints `541be9f` inside verbatim dry-run output. Both
scratch commits resolve here (subjects and single-file diffs match the
documentation exactly — both verified) only because this worktree shares the
builder's object store; they are on no ref and were deleted from `origin`. A
fresh clone cannot look them up. The Log is honest that the branches were
deleted, and a transcript is a transcript. Flagged only so nobody later reads it
as a dangling citation and "fixes" it.

### Findings needing no change (verified, recorded so nobody re-derives them)

- **`repo-9` frontmatter valid**: six parsed fields present; `kind: chore` and
  `status: ready` in `01-TICKETS.md:69-70`'s lists; `depends_on: [repo-7]`
  well-formed; `id` agrees with filename.
- **`repo-9` genuinely free**: `origin/main`'s `docs/work/` stops at `repo-8`;
  `gh pr list --state open` returns `[]`; `git branch -r` shows only
  `origin/pl-17-image-closure` and `origin/worktree-pl-19-pin-through-the-browser`,
  neither containing a `repo-9` file. The `repo-9` strings in
  `scripts/test/status.test.ts` are **already on `origin/main`** (12 occurrences,
  blob `e4cd185`) — pre-existing synthetic fixtures in a `--root` throwaway tree,
  invisible to the real board. No real-ticket collision.
- **`depends_on: [repo-7]` resolves**: `npm run status -- --show repo-9` renders
  and prints `unblocked`; repo-9 appears in `--ready`.
- **The `--json` gate is real, not assumed**: `node scripts/status.mjs --json >
/dev/null` -> **0**. Repointed `depends_on` at `repo-404`: exit **1**, stderr
  `depends_on "repo-404", which is not a ticket`. Restored, re-ran -> **0**,
  `git status --porcelain` empty, HEAD `fb33ee6`. The green is evidence.
- **Formatting gate clean and citation-safe**: `npm run check` exit **0**;
  `npx oxfmt --check` on all four touched `.md` -> "All matched files use the
  correct format", tree unchanged. Citations resolved after that run.
- **The new ticket does not disturb the board-coupled tests**:
  `npx vitest run scripts` -> 76 passed.
- **`CLAUDE.md:230-246`, the Log's own line citation, is exact.**
- **Anchor resolves**: `repo-9:44` ->
  `../03-RELEASING.md#annotating-another-tools-ticket-without-releasing-it`;
  heading at `03-RELEASING.md:117` slugs to exactly that.
- **The pl-26 quotation is accurate**, ellipsis included, against
  `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md:140-147`.
- **The `_Outcome, <date>:_` pattern repo-9 tells the next agent to copy exists**
  at `docs/adr/003-the-status-page-is-generated.md:147,180,194`, applied by repo-6.
- **Config claims check out**: `docs` hidden (`:31`); six hidden types (`:30-35`);
  `perf`/`revert` not hidden (`:28-29`).
- **Changelog shape claims check out**: downloader 0.2.0 is a minor bump from
  0.1.1, exactly 2 Features and 9 Fixes, and the pl-16 entry appears twice
  (`09bd161` and `a112cd4`) — the merge-commit duplication, correctly
  cross-referenced at `:231`.
- **The stale sentence was genuinely removed**: `git grep "only entry"` now hits
  only the Log entry describing the correction. Surviving "pending planner 0.4.0"
  wording at `repo-3:346-348` and `repo-7:35,41` is in ticket _briefs_, which
  `01-TICKETS.md:145` says a review appends to rather than edits — correctly left.
- **`repo-3:336-355` still states the pre-supersession rule** — a `done` ticket's
  Review section, history, correctly untouched.
- **`docs/adr/002-releases-from-conventional-commits.md:33-36`** independently
  states "routes each commit to a component by the files it touched, not by its
  scope" — consistent with the new text.
- **Unfiltered sweeps found nothing else.** `git grep -n -i` with no `--include`
  for `attribut`, `changelog-sections`, `hidden`, `release-please-config`,
  `paths it touches`, `by the path`, `per tool that changed`, `touches two tools`,
  `both changelogs`, `sibling`, `_Outcome`, `only entry`,
  `pending planner|downloader`, `repo-7`, `repo-9`. Workflow YAML, `docs/00-TOOLS.md`
  and root `package.json` carry no attribution statement the new text contradicts;
  `.github/` has no PR or issue templates at all.
- **Commit titles validate**: the branch's `docs(repo): ...` -> 0, and repo-9's
  mandated `docs(planner): ... (repo-9)` -> 0.

### Minor, not counted as findings

- `03-RELEASING.md:97-99` "heads that release's `### Features`" — the first line
  renders under `09bd161`; `a112cd4` is second. Same sentence, duplication
  explained two sentences later. Defensible as written about the entry.
- `CLAUDE.md:240-241` scopes the "own pull request" rule to `feat`/`fix`, omitting
  `perf`/`revert`. `03-RELEASING.md:203-209` flags them and CLAUDE.md points
  there — acceptable **for a summary**. (Gate 1A rates this higher; see its F2 and
  the tension it identifies at `03-RELEASING.md:68-70` vs `:203-209`.)

### What this gate did NOT do

- The release-please dry runs themselves — 1A's scope. The two transcripts at
  `03-RELEASING.md:139-147,153-157` are taken as given; only the two scratch
  commits' subjects and single-file diffs were verified.
- Whether the five unmeasured hidden types behave like `docs` — unmeasured by
  design; finding 2 is about the count, not the assumption.
- CI itself, and the full `npm test` matrix. `npm run check` and the `scripts`
  suite are green locally; `scripts` is the only suite that reads the ticket board.
- Absence of sibling PRs rests on `gh pr list` returning `[]` plus `git branch -r`;
  "none open" could not be distinguished from a token restriction, though the two
  corroborate.

## Gate 2 (narrow — the correction pass) — `repo-7-changelog-attribution` @ `7a07a5a` — **PASS**

Scope: only what the second pass introduced. This gate did **not** re-run the
release-please dry run, re-audit the `on:` blocks beyond counting, re-sweep for
attribution statements, re-verify `a112cd4`, or re-check the changelog-shape
claims — gates 1A and 1B settled those.

_Citations in this record were gathered at `7a07a5a` and re-resolved as the last
action before staging, against the commit that carries this record — the commit
that applies the corrections it asked for. The verdict, the findings and their
wording are the gate's own and are unedited; only line numbers moved._

### The six corrections — each verified by command, not by reading the Log

| #   | Claim                                                           | Result                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `2ea0631` touched **five** planner documents, **three** tickets | verified. `git show --name-only --format="" 2ea0631 \| grep '^tools/planner/docs/'` -> 5 (`02-ROADMAP.md`, `03-STATUS.md`, `pl-17`, `pl-21`, `pl-5`); `\| grep -c '/work/'` -> 3. `03-RELEASING.md:110-111` correct.                                                                                        |
| 2   | **Five** unmeasured hidden types                                | verified. `release-please-config.json:30-35` hides six; `docs` (`:31`) measured; the five named at `:200` are exactly the remainder.                                                                                                                                                                        |
| 3   | "two commits" disambiguated as "two **pull requests**"          | verified at `CLAUDE.md:226-228` and `03-RELEASING.md:193-197`. Read in order, 1B's failure scenario is closed at the point of failure. Two residuals: F3, F4.                                                                                                                                               |
| 4   | **Seven** workflows, five with `push:`, all `branches: [main]`  | verified. 7 files; `grep -l "push:"` -> `ci`, `downloader`, `planner`, `release`, `security`, each `branches: [main]`; `pr-title.yml` and `cache-cleanup.yml` are `pull_request` only.                                                                                                                      |
| 5   | `docs(repo)` justification no longer self-contradicts           | verified at `:819-827` — one consistent claim, and true (no changed file is under `tools/`). But see **F1**.                                                                                                                                                                                                |
| 6   | The `01-TICKETS.md` pointer is backed                           | verified. `adr/003:147,180,194` carry `_Outcome, <date>:_`; repo-6's PR #82 (`8dc9cd4`) wrote a finding onto `docs/work/repo-3-...md` in the same PR as its fix; `01-TICKETS.md:107,163-169` writes down the review gate. `CLAUDE.md`'s "the review gate asks for" clause is gone. See **F5** for one weld. |

**No correction is wrong.** Every published figure the second pass touched
re-derives.

### The reframing — assessed, not rubber-stamped

**Is the mechanism claim right?** Yes against shipped behaviour, but it is an
inference stated as measurement. The skip line
`No user facing commits found since ... - skipping` fires when the generated
release-notes body comes out empty, and `hidden: true` on a `changelog-sections`
entry is what empties it — so "the test is `hidden`, not the type name" is
correct. But only two types were ever run, `fix` (not hidden -> released) and
`docs` (hidden -> skipped), and **both data points are equally consistent with a
hardcoded releasing-type list**. The Log says "the measurement says the
enumeration is the defect"; strictly the measurement is _consistent with_ that
and does not distinguish it. The shipped text is more careful than the Log —
`03-RELEASING.md:175-182` poses it as a question rather than a derivation.

**Does the inference matter?** No, because it errs safe. If the hidden-flag
hypothesis were wrong the new rule over-warns (an agent on a `perf` branch opens
a second PR it did not need); the enumeration it replaced under-warned, which is
the actual hazard.

**Does it close gate 1A's scenario?** Yes. `CLAUDE.md:240-241` and
`03-RELEASING.md:180-181` both name `perf` and `revert`.

**Stays true if a type is added?** `03-RELEASING.md`'s form does. `CLAUDE.md`'s
compressed trailing clause does not — F3.

**Is the bump/skip split fair, or papering over?** Fair. The branch does not
assert the pre-existing sentence is true; it labels which of the two each
sentence is about, says the meeting case is untested, and files `repo-10` with a
`Done when` that forces reconciliation. **One thing for repo-10 to be alert to:**
`03-RELEASING.md:67-68`'s "Only `feat`, `fix` and a breaking change move a
version — that is release-please's rule" may itself be false, since
release-please's default versioning strategy may fall through to a patch bump for
any non-empty, non-breaking, non-`feat` commit set. **Not measured here and not
asserted** — flagged because repo-10 may find both sentences wrong rather than
merely unreconciled, and its brief currently anticipates only the latter.

### Findings, most severe first

#### F1 — low. The `docs(repo)` justification names four files; the branch touches five

`docs/work/repo-7-changelogs-are-attributed-by-path.md:810-817` lists
`CLAUDE.md`, `docs/03-RELEASING.md`, `repo-7` and `repo-9`.
`git diff --name-only origin/main...HEAD` -> **5**;
`docs/work/repo-10-measure-the-unmeasured-types.md` is missing. `:925` in the
same document says five, so the file contradicts itself.

**This is the one genuine instance of the species this gate exists for:** the
second pass added the fifth file and rewrote this exact paragraph without
updating its own count, on a branch whose stated lesson is "every figure below is
the output of a command written down beside it" (`:865-866`). The conclusion is
untouched — `repo-10` is under `docs/work/` too, so "nothing under `tools/`"
still holds and `docs(repo)` remains the right type.

_Failure scenario:_ a reader checking the type justification lists the diff, gets
five against a published four, and has to re-derive whether the fifth file is
under `tools/` — the cost the enumeration exists to remove.

#### F2 — low. Three citations are one line short at a range boundary

Each identifies the correct passage; in each the quoted string runs one line past
the cited range.

- `:223` cites `03-RELEASING.md:93-94` for "the next reader does not have to
  re-derive them" — line 93 is blank, the phrase is at **94-95**.
- `:264` cites `03-RELEASING.md:97-98` for "heads that release's `### Features`" —
  `` `### Features` `` is on **99**. The sibling citation at `:467` gets this
  right with `97-99`.
- `:437` cites `pl-26:140-146` for a quote ending "no ticket filed from here" —
  `filed from here.` is on **147**.

_Failure scenario:_ a reader resolving the F1 failure-scenario citation opens
`03-RELEASING.md:93`, finds a blank line, and widens the window by hand.

#### F3 — low. `CLAUDE.md:243-244` overstates what adding a type to the config does

"Read the test off the config rather than off this sentence; **a type added there
is releasing the day it is added**." The natural referent of "there" is
`changelog-sections`, and a type added there _with_ `hidden: true` is not
releasing. `03-RELEASING.md:175-182` states the same idea precisely.

_Failure scenario:_ someone adds
`{ "type": "style", "section": "Style", "hidden": true }`, reads this clause, and
splits a `style(...)` branch into two pull requests it never needed. Errs safe.

#### F4 — low. The disambiguation points at the wrong section, and `:92`/`:104` are still bare

`03-RELEASING.md:193-195` says "the sentence at the top of **this** section is not
telling you to". The "two commits" sentences are at `:92` and `:104`, in
`### What routes a commit to a tool` (`:86-115`) — the _previous_ section. A
stranger looking at the top of `### Annotating another tool's ticket`
(`:117-119`) finds nothing about commits. Meanwhile `:92` and `:104` remain
un-disambiguated in place, ~75 lines above the correction. The primary read point
— `CLAUDE.md:226-228` — is fixed, so 1B's failure scenario is genuinely closed;
this is the residual for a reader who stops inside `03-RELEASING.md`. "above"
would be correct.

#### F5 — low, no change needed. `03-RELEASING.md:121-122` welds two true halves

"repo-6 did it for repo-3, in the `_Outcome, <date>:_` pattern [adr/003]
carries." Both facts hold separately — repo-6's PR #82 wrote a sibling-finding
section onto repo-3's ticket, and repo-6 put the `_Outcome, 2026-08-23:_` line on
`adr/003:180-199`. But repo-6 did **not** put an `_Outcome_` line on repo-3, and
the sentence reads as though it did. `repo-9:21-22` states it correctly ("the
pattern repo-6 used on ADR 003"). Recorded so the next reader does not resolve it
and think the pointer is broken; the pointer is fine, the sentence is compressed.

#### F6 — no change needed. Gate-record citations resolve to the corrected text, not the defect

Structural, and disclosed by each record's added preamble. Strongest case: 1B
finding 4 cites `CLAUDE.md:238-241` for "the sibling-finding note the review gate asks
for" — correction 6 deleted that clause outright, so nothing at `:238` matches.
Same for 1A F2's `CLAUDE.md:238-241`, which now enumerates all four types.
Inherent to this repo's convention that the builder commits the gate in the branch
that fixes it; flagged only so nobody later reads these as broken citations.

### Mechanical checks

**A. Transplant — clean.** Both records diffed against the scratchpad originals
under heading-demotion normalisation.

- Every finding present, none dropped: 1A's F1-F5 including the "no change
  needed" one, its "Verified correct" list and its "What this gate did NOT do";
  1B's findings 1-5, its 17-item "needing no change" list, its "Minor, not counted
  as findings" and its "What this gate did NOT do".
- Both verdicts recorded **as given** — `CONCERNS` at `:121` and `:297`. Not
  softened.
- **No fenced content altered.** Gate 1A's single fence extracted and
  byte-compared: identical, and the `### Fixes` line inside the dry-run transcript
  survives as `### Fixes` — the corruption the builder hit on its first attempt is
  genuinely fixed. Gate 1B contains no fences.
- Benign deltas: a 4-line preamble added to each record disclosing the
  re-resolution, oxfmt's `*text*` -> `_text_` emphasis normalisation, and oxfmt's
  table-separator padding.

**B. Citations — 78 resolved, 3 failed.** The three failures are F2, all one-line
boundary misses that identify the correct passage. Both classes the builder said
it nearly missed were checked specifically:

- **Gate 1A's evidence-table `line` column** (bare numbers, no file token,
  `:196-201`): all six resolve exactly against `CLAUDE.md` — `231-232`, `232-234`,
  `235`, `236`, `237`, `237-238`.
- **Self-citations into the record's own file**: `:781-783`, `:781-786`,
  `:735-740`, `:838-840`, `:35`, `:41` all resolve.
- Also exact: all five workflow citations, `release-please-config.json:28-29,
30-35, 31`, both CHANGELOG lines, `repo-3:223,336-355,346-348`,
  `01-TICKETS.md:69-70,145,163-169`, `adr/002:33-36`, `adr/003:147,180,194`, and
  `repo-9:44` (anchor slugs to the heading at `03-RELEASING.md:117`).

**C. `repo-10` — valid, free, and the gate is real.**

- Frontmatter: six fields, `id` matches filename, `kind: chore` and
  `status: ready` both in `01-TICKETS.md:69-70`'s lists, `depends_on: [repo-7]`
  well-formed.
- Id genuinely free: `git ls-tree -r origin/main -- docs/work/` stops at `repo-8`;
  the three open PRs (#91, #92, #93) carry no `repo-10` file — checked by
  `gh pr diff --name-only`, not by log subjects or PR titles.
- `npm run status -- --show repo-10` renders and prints `unblocked`.
- **Gate verified by making it fail first**:
  `node scripts/status.mjs --json > /dev/null` -> **0**; repointed `depends_on` at
  `repo-999` -> **1**, stderr `depends_on "repo-999", which is not a ticket`;
  restored -> **0**, `git status --porcelain` empty, HEAD `7a07a5a`.

### Also run

`npm run build` -> exit 0. `npm run check` -> exit 0. `npx oxfmt --check` on all
five changed `.md` -> "All matched files use the correct format", tree unchanged.
**Citations were resolved after this run**, so the formatter has not reflowed
anything resolved here.

### What this gate did NOT verify

- Anything gates 1A/1B settled: the dry runs, the `on:`-block audit beyond
  re-deriving the 7/5 counts, the repo-wide attribution sweep, `a112cd4`'s seven
  files, the changelog shape claims.
- `npm test` — not run. Only `npm run check` and the build.
- `perf` / `revert` behaviour — still unmeasured by anyone. No scratch branch was
  pushed and no release-please was run here. The hidden-flag mechanism statement
  reasons from `release-please-config.json` and the observed skip message, **not**
  from release-please's source; the note about the default versioning strategy is
  recollection, not measurement, and repo-10 should treat it as a hypothesis.
- Whether the five hidden types other than `docs` actually behave like `docs`.

## Log

### 2026-08-23 — measured, and the rule written down

**Step 2 came back outcome 1: it does release the planner.** The inference the
whole ticket rested on is now measured rather than reasoned. A scratch branch off
`main` carrying exactly one commit — `fix(repo): scratch measurement, annotate a
planner ticket only (repo-7)` (`541be9f`), whose only file is
`tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md` — was pushed to `origin`
and run through:

```bash
npx release-please@17.11.1 release-pr --repo-url=brunolabbe/tools \
  --target-branch=repo-7-measure-scratch --token="$(gh auth token)" --dry-run
```

Verbatim, from the tail of that run:

```
❯ Backfilling file list for commit: 541be9ff79e2728d979567feb644c91bab0a6f5a
❯ Found 1 files
✔ Splitting 5 commits by path
✔ Building candidate release pull request for path: tools/downloader
❯ commits: 0
✔ No commits for path: tools/downloader, skipping
✔ Building candidate release pull request for path: tools/planner
❯ commits: 1
✔ Considering: 1 commits
Would open 1 pull requests
title: chore(planner): release 0.4.1
...
### Fixes

* **repo:** scratch measurement, annotate a planner ticket only (repo-7) ([541be9f](...))
```

One `.md` file under `tools/planner/`, a `repo` scope, and the planner gets a
patch release whose one changelog line is about something else. Both scratch
branches were deleted from `origin` and locally as soon as their run finished;
`main` never saw them. `ls .github/workflows/ | wc -l` → **7**, of which
`grep -l "push:" .github/workflows/*.yml` returns five — `ci`, `downloader`,
`planner`, `release`, `security` — every one of them `branches: [main]`, while
`pr-title.yml` and `cache-cleanup.yml` have no `push` trigger at all. So the
pushes cost no CI. The count of four in the first version of this Log was wrong
and the safety conclusion it supported was not.

**A second measurement decided step 1, and it was not in the brief.** The
ticket's option B asserts that a `docs(...)`-typed commit is `hidden` and does not
release — asserted, never run, and step 1 could not be chosen honestly without
it. The identical commit retyped `docs(planner): scratch measurement two …`
(`cafc9aa`), same single file, same command against `repo-7-measure-docs`:

```
✔ Considering: 1 commits
✔ No user facing commits found since ece6ec0fc6410c3d19a92c120860f0982e3a396c - skipping
Would open 0 pull requests
```

So the type is what decides, and the escape hatch is real.

**Step 1: option B, and it swallows option A rather than replacing it.** The
rule had to be written down either way — you cannot say "put the annotation in a
`docs(<tool>)` pull request" without first saying why a `fix(repo)` one is a
release. So B costs one extra paragraph over A and buys back the thing A leaves
broken: this repo's standing convention that a finding about a sibling ticket is
written onto that ticket. A alone would have documented a dead end and left every
future annotation where repo-3 was. B's real cost also turned out smaller than
the brief thought — a second pull request is needed **only** when the branch's own
title is a releasing type; a `docs(repo): …` branch can carry the annotation
itself, because nothing about the paths matters once the type is hidden.

Written in two places, and only what the two runs support:

- `CLAUDE.md:230-246`, beside the existing two-tools sentence — the rule, the
  measured planner `0.4.1`, the `docs(<tool>): …` title, and a pointer out.
- `docs/03-RELEASING.md`, under **What routes a commit to a tool** — both worked
  examples with their commits, then a new subsection **Annotating another tool's
  ticket, without releasing it** carrying both commands and both outputs.

**Both worked examples were re-derived from the repository, not taken on trust,
and one description in `03-RELEASING.md` was stale.**

- `a112cd4` `feat(planner): run the fan-out as a job (pl-16)` —
  `git show --name-only a112cd4 | grep tools/downloader/` returns exactly seven
  files, all under `tools/downloader/api/`. The ticket is right.
- `2ea0631` `fix(core): make the image scan fail by name … (pl-17)` — touches
  `tools/downloader/Dockerfile`, `tools/planner/Dockerfile` and **five** of the
  planner's documents, **three** of them tickets. From
  `git show --name-only --format="" 2ea0631 | grep '^tools/planner/docs/'`:
  `02-ROADMAP.md`, `03-STATUS.md`, `work/pl-17-…md`, `work/pl-21-…md`,
  `work/pl-5-…md` — `| wc -l` → 5, and `| grep -c '/work/'` → 3. It appears in
  **both** `tools/planner/CHANGELOG.md:18` and `tools/downloader/CHANGELOG.md:14`,
  which is the claim.

  **The first version of this Log published "three files, two of them tickets"
  and `03-RELEASING.md` published "three of the planner's documents". Both were
  wrong**, under a heading asserting both examples had been re-derived. One had:
  `a112cd4`'s seven verifies exactly. `2ea0631`'s did not — the brief's own
  wording was "the planner's docs", vague and true, and it was replaced with a
  count that was precise and false. `repo-3`'s gate had already caught this exact
  species on this exact document (`a112cd4` written as eleven, corrected to
  seven), so it is the second instance, not the first. Every figure in this pass
  now carries the command that produced it, immediately beside it.

- Both releases have since **shipped** — `planner-v0.4.0` and `downloader-v0.2.0`
  are tags, so the ticket's "pending" is out of date and the changelogs are the
  released ones. `03-RELEASING.md` also said downloader 0.2.0's "only entry" was
  the `pl-16` line, which was true while it was pending and is not now: the
  released 0.2.0 has two Features lines and nine Fixes. Rewritten.
- `a112cd4` is listed **twice** in downloader 0.2.0, under `09bd161` as well.
  That is the merge-commit duplication already documented under **Merging a pull
  request**, not a second attribution — noted in the new text so the next reader
  does not read it as one.

**This commit's own type was chosen under the rule it documents, and the branch
has since become its own worked example.** `git diff --name-only origin/main` →
**6**, and the same piped through `grep -c '^tools/'` → **1**: `CLAUDE.md`,
`docs/03-RELEASING.md`, `docs/work/repo-7-…md`, `docs/work/repo-9-…md`,
`docs/work/repo-10-…md` and `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md`.
Every earlier version of this paragraph said five and zero, which was true until
the `pl-26` annotation was folded in — see the 2026-08-24 entry below, and note
that gate 2's F1 counted five because five was right at `7a07a5a`.

**The one path under `tools/` is the whole point rather than a problem.** The
change is documentation with no behaviour in it, so `docs(repo)` is the honest
type, and `docs` is `hidden`, so the planner is not released off that path —
measured, as measurement C. `fix(repo)` was defensible from the ticket's
`kind: fix` and is now unambiguously wrong: it would cut the planner a patch
release whose only changelog line is about `scripts/commit-message.mjs` and this
page. That is exactly the defect this ticket was filed to describe, and the
branch would have committed it while documenting it. Checked with
`node scripts/commit-message.mjs --text "docs(repo): …"` → exit 0.

**Filed [repo-9](./repo-9-close-the-pl-26-annotation-loop.md)** for the pl-26
annotation itself. It is now affordable and it is still not written; folding it
into this branch would have widened a ticket whose Build never asked for it.

_Superseded on 2026-08-24: repo-9 was folded into this branch after all. See the
entry below; the reasoning above was right about the brief and wrong about the
economics._

**Unmeasured, and named as such:** only `fix` and `docs` were run through
release-please. `grep -c '"hidden": true' release-please-config.json` → **6**, so
with `docs` measured, **five** are not — `refactor`, `test`, `build`, `ci`,
`chore` — and they are assumed to behave like `docs`. The first version of
`03-RELEASING.md` said "four" in the one sentence whose job is to bound the
evidence; it is now five, and the number is the grep's. `perf` and `revert` are
not hidden (`release-please-config.json:28-29`), so the "no user facing commits"
skip does not cover them and what they do here is untested; `03-RELEASING.md`'s
existing claim that a `perf:` commit releases nothing was left alone rather than
restated as measured, and the two sentences are now explicitly said to be about
different things — the bump and the skip — rather than one implicitly picking a
side. The dry runs also emitted
`⚠ pullRequestTitlePattern miss the part of '${scope}'` on both branches while
still rendering `chore(planner): release 0.4.1` correctly — noted, not
investigated, and out of this ticket's scope.

Gates: `npm run format` then `npm run check`, both green — this is a
documentation-only branch and oxfmt formats markdown here.

### 2026-08-24 — both gates answered, and the numbers re-derived by command

Two gates ran at `fb33ee6`, **1A** over the measurement and **1B** over the
documentation, the record and the repo invariants. Both **CONCERNS**; both records
are above this section, verbatim, with their `file:line` citations re-resolved
against the commit that carries them. The measurement itself survived — 1A pushed
its own scratch branch and reproduced `chore(planner): release 0.4.1` end to end,
and found no clause stated wider than its evidence.

Six corrections, and **every figure below is the output of a command that is
written down beside it** — which is the actual lesson, not any one of the numbers:

1. **`2ea0631` touched five planner documents, three of them tickets** — not the
   three/two published in the first pass. Corrected in `03-RELEASING.md` and in
   the worked-examples note above, with the `git show --name-only` pipeline
   inline. This is the second instance of this species on this document; the
   first is recorded at `repo-3:223`.
2. **Six hidden types, so five unmeasured, not four** —
   `grep -c '"hidden": true' release-please-config.json` → 6. The bounding caveat
   in `03-RELEASING.md` now says five and lists them.
3. **"Two commits" disambiguated.** `CLAUDE.md` and `03-RELEASING.md` both say a
   two-tool commit "should have been two commits"; this branch added a paragraph
   saying splitting into two commits does not help. Both true under different
   senses, and the collision was reachable: an agent could split a `fix(downloader)`
   branch into two commits, open one pull request, and release the planner off one
   `.md`. `CLAUDE.md` now says "two commits — meaning **two pull requests**", and
   the new section says the same in the other direction.
4. **Seven workflows, not four**, five of them carrying a `push:` and all five
   `branches: [main]`. The safety conclusion was right; the count was not.
5. **The `docs(repo)` justification contradicted itself** and is rewritten. A
   `fix(repo)` here would also have released nothing, because the branch has no
   path under `tools/` at all.
6. **The `01-TICKETS.md` pointer was unbacked.** The sibling-annotation
   convention is practised — repo-6 did it, `adr/003` carries the
   `_Outcome, <date>:_` pattern — but it is written down in neither
   `01-TICKETS.md` nor the review skill. The citation now claims only the review
   gate, which it does support, and `CLAUDE.md`'s "the review gate asks for"
   clause is gone.

**The disagreement, and my answer: both gates framed it wrongly, and 1A is right
about the risk.** 1A rates the `perf`/`revert` gap a real finding; 1B rates it
acceptable for a summary. Both were arguing about how many types `CLAUDE.md`
should enumerate — two or four. The measurement says the enumeration is the
defect: the skip I actually observed reads `No user facing commits found`, which
is release-please testing `hidden` in `changelog-sections`, not matching a list of
type names. So the rule now **names that test** and gives today's not-`hidden` set
— `feat`, `fix`, `perf`, `revert` — as what the config currently says rather than
as the rule itself. That covers 1A's failure scenario (a `perf` branch folding in
an annotation), and it cannot go stale the way an enumeration does when a type is
added to the config. 1B's position that a summary may compress is fine in general
and wrong here, because this is the summary an agent reads by default and the
compression dropped exactly the two types nobody has run.

1A also found a real tension inside `03-RELEASING.md`: `"a perf: commit on its
own therefore releases nothing"` (pre-existing, about the **bump**) against this
branch's `"the skip does not cover perf"` (about the **skip**). They are
reconcilable — release-please can decline to skip and still decline to bump — but
nobody has watched it. Rather than pick a side implicitly, the text now says
which of the two each sentence is about and that the case where they meet is
untested. **Filed as [repo-10](./repo-10-measure-the-unmeasured-types.md)**, per
instruction not measured here: it needs another scratch push and is outside this
ticket's Build.

Not changed, deliberately: 1A's F5 and 1B's finding 5 and the "minor, not counted"
items — the `a112cd4` duplicate heading the Features section is explained two
sentences later, and the scratch SHAs printed inside a verbatim transcript are a
transcript, not a citation. Both were raised as no-change and are left as raised.

Gates after the corrections are in the report; the branch stayed within
`CLAUDE.md`, `docs/03-RELEASING.md`, this ticket, `repo-9` and `repo-10`.

### 2026-08-24 — gate 2, and the count that got past its own discipline

A third gate ran at `7a07a5a`, narrow, over the correction pass only: **PASS**.
Its record is above, below 1A's and 1B's. It re-derived all six corrections by
command, byte-compared 1A's fenced transcript to confirm the `### Fixes`
corruption was gone, resolved 78 citations, and upheld the reframing on the
merits while noting — correctly — that two data points cannot _distinguish_ the
hidden-flag mechanism from a hardcoded type list, only be consistent with it. The
shipped text already poses it as a question; the previous Log entry called it a
derivation, and that was one word too strong.

**F1 is the finding worth keeping.** The `docs(repo)` justification listed four
changed files. There are five:

```bash
git diff --name-only origin/main...HEAD          # -> 5
git diff --name-only origin/main...HEAD | grep -c '^tools/'   # -> 0
```

The conclusion is untouched — `repo-10` is under `docs/work/` like the rest, so
"nothing under `tools/`" holds and `docs(repo)` is still the honest type. What
matters is how it happened. **The pass whose stated lesson was "every figure is
the output of a command written down beside it" wrote a figure with no command
beside it, in its own justification paragraph, in the same edit that created the
fifth file.** The discipline was applied to the figures the gates had named and
not to the prose around them, because that paragraph was being edited for a
different reason (F5 of the previous round, the self-contradicting clause) and
was not on the list of numbers to re-derive. So the rule as practised was "verify
the figures under review", and the rule as written was "verify every figure";
this is the third instance on this document of the gap between them. The figure
now carries its command, like the rest.

The lesson generalises past this branch: a number is not safe because it was
correct when written — it is safe when it is re-derived in the same pass that
could have invalidated it, and adding a file to a branch invalidates every count
of that branch's files.

**F2 — three citations one line short**, each identifying the right passage and
each stopping one line before the phrase it quotes. `03-RELEASING.md:93-94` →
`94-95` (93 is blank), `:97-98` → `:97-99` (`### Features` is on 99, and the
sibling citation at `:467` already had it right), `pl-26:140-146` → `:140-147`.
Fixed inside the gate records, which is where they live.

**F3 — fixed.** `CLAUDE.md` said "a type added there is releasing the day it is
added"; a type added with `hidden: true` is not. Now "a type added there
**without `hidden`**". This is exactly the class of overstatement this ticket
exists to remove, and it was in the sentence telling the reader to trust the
config over the sentence.

**F4 — fixed, and more precisely than the gate asked.** The new paragraph said
"the sentence at the top of **this** section", but the "two commits" sentences
are in the previous one. The gate suggested "above"; it now names the section —
"the sentences under **What routes a commit to a tool**" — because "above" is the
word that made the reference vague in the first place. `:92` and `:104` are still
bare in place, deliberately: `:104` is inside a worked example where a
parenthetical would blunt the example, and the primary read point
(`CLAUDE.md:226-228`) is fixed, so 1B's failure scenario stays closed.

**F5 and F6 — no change, as marked.** F5 is a compressed sentence whose two
halves are separately true; `repo-9` states it unambiguously. F6 is structural —
gate citations resolve to the corrected text rather than the defect, which is
what this repo's convention of committing the gate in the fixing branch
necessarily produces, and each record's preamble discloses it.

**Carried into `repo-10`, flagged unmeasured.** Gate 2 suspects
`03-RELEASING.md`'s "only `feat`, `fix` and a breaking change move a version —
that is release-please's rule" may itself be false, if the default versioning
strategy falls through to a patch bump. **It ran no release-please and did not
assert it**, so it is written into `repo-10`'s Why as a hypothesis in those terms,
its Build gains the outcome where `perf` bumps and the sentence is simply wrong,
and its `Done when` now reads "the document agrees with the measurement" rather
than "the two flagged sentences were reconciled". Three sentences may be in play
there, not two.

### 2026-08-24 — the annotation folded in, and the rule was over-specified

**repo-9 is done, on this branch, and the ticket should not have existed.** Its
entire deliverable was one `_Outcome:_` line under one finding in `pl-26`;
its brief was fifty-eight lines. It was filed rather than folded because this
ticket's dispatch said not to widen — and the note recording that choice is what
made the cost findable. Folded now, in the pull request that documents the rule
making it affordable, which is also where a reader will look for it.

**Verified before acting, and it needed a third measurement rather than a
composition of the first two.** The question was whether adding
`tools/planner/docs/work/pl-26-…md` to a `docs(repo): …` pull request releases
the planner. Measurement A had a `repo` scope with a _releasing_ type; measurement
B had a `docs` type with a _planner_ scope; neither is this shape, and the whole
subject of this ticket is not reasoning across that kind of gap. So it was run —
a scratch branch off `main` carrying exactly one commit,
`docs(repo): scratch safety measurement, annotate a planner ticket only (repo-9)`
(`58b2764`), whose only file is the real annotation's file:

```bash
npx release-please@17.11.1 release-pr --repo-url=brunolabbe/tools \
  --target-branch=<scratch> --token="$(gh auth token)" --dry-run
```

```
❯ Backfilling file list for commit: 58b2764e4d800790874e1c47523a68034f4720f0
❯ Found 1 files
✔ Splitting 5 commits by path
✔ Building candidate release pull request for path: tools/downloader
✔ Considering: 0 commits
✔ No commits for path: tools/downloader, skipping
✔ Building candidate release pull request for path: tools/planner
✔ Considering: 1 commits
✔ No user facing commits found since ece6ec0fc6410c3d19a92c120860f0982e3a396c - skipping
Would open 0 pull requests
```

**Measurement C.** Branch deleted from `origin` and locally as the next action.
Three runs now bound the rule from both sides: `fix(repo)` + a planner `.md`
releases planner `0.4.1`; `docs(planner)` + the same file releases nothing;
`docs(repo)` + the same file releases nothing. The scope is not consulted under
either type, which was previously two thirds measured and one third inferred.

**And that third run found the shipped rule over-specified — a real finding, and
mine.** `03-RELEASING.md` said the annotation "rides in a pull request titled
`docs(<tool>): …`", which pins two things where only one is load-bearing. The
constraint is the **type** being `hidden`; `docs` is one of six that qualify, and
the **scope** is not consulted at all. Both documents now say so, and the scope
is described as what it actually is here — the usual convention, naming whatever
the pull request is about. `docs(planner): …` is right when the annotation _is_
the pull request; `docs(repo): …` is right when it rides along, as it does here.
repo-9's Build step 2 said the title "**must** be `docs(planner): …`" and
inherited the error from this page; its Build is left as written and its Log
carries the correction, because a brief records what was believed when the work
was dispatched.

**This branch is now its own worked example**, which is the part worth keeping: a
`docs(repo)` pull request carrying one file under `tools/planner/` and releasing
nothing, sitting in the page that explains why. Had the same branch been titled
`fix(repo)` — defensible from `kind: fix`, and what the first draft of the
justification paragraph half-argued for — it would have cut the planner a patch
release whose only changelog line was about this page. The ticket would have
committed the defect it was filed to describe.

**The file count moved again, and this is the third round in which it has.** Six
files now, one under `tools/`:

```bash
git diff --name-only origin/main            # -> 6
git diff --name-only origin/main | grep -c '^tools/'   # -> 1
```

Gate 2's F1 says five, and five was correct at `7a07a5a`; the record is left as
it was given. The generalisation that round produced — _a number is safe when it
is re-derived in the same pass that could have invalidated it, and adding a file
to a branch invalidates every count of that branch's files_ — was written for
exactly this, and applied to itself here rather than after another gate found it.
