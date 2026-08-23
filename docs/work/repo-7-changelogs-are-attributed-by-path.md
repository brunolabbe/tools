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
`main` never saw them, and all four workflows are `push: branches: [main]`, so
the pushes cost no CI.

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

- `CLAUDE.md:228-240`, beside the existing two-tools sentence — the rule, the
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
  `tools/downloader/Dockerfile`, `tools/planner/Dockerfile` and three of the
  planner's documents. The ticket says "the planner's docs"; it is three files,
  two of them tickets. It appears in **both** `tools/planner/CHANGELOG.md:18` and
  `tools/downloader/CHANGELOG.md:14`, which is the claim.
- Both releases have since **shipped** — `planner-v0.4.0` and `downloader-v0.2.0`
  are tags, so the ticket's "pending" is out of date and the changelogs are the
  released ones. `03-RELEASING.md` also said downloader 0.2.0's "only entry" was
  the `pl-16` line, which was true while it was pending and is not now: the
  released 0.2.0 has two Features lines and nine Fixes. Rewritten.
- `a112cd4` is listed **twice** in downloader 0.2.0, under `09bd161` as well.
  That is the merge-commit duplication already documented under **Merging a pull
  request**, not a second attribution — noted in the new text so the next reader
  does not read it as one.

**This commit's own type was chosen under the rule it documents.** It touches
`CLAUDE.md`, `docs/03-RELEASING.md`, `docs/work/repo-7-…md` and
`docs/work/repo-9-…md` — nothing under `tools/`, so no attribution arises either
way. The change is documentation with no behaviour in it, so `docs(repo)` is the
honest type and it is also the non-releasing one. `fix(repo)` would have been
defensible from the ticket's `kind: fix` and would still have released nothing
here, but it would have put a line about a documentation edit into the next
changelog of whatever it touched. Checked with
`node scripts/commit-message.mjs --text "docs(repo): …"` → exit 0.

**Filed [repo-9](./repo-9-close-the-pl-26-annotation-loop.md)** for the pl-26
annotation itself. It is now affordable and it is still not written; folding it
into this branch would have widened a ticket whose Build never asked for it.

**Unmeasured, and named as such:** only `fix` and `docs` were run through
release-please. `refactor`, `test`, `build`, `ci` and `chore` are read off
`changelog-sections` as `hidden` and are assumed to behave like `docs`;
`perf` and `revert` are not hidden, so the "no user facing commits" skip does not
cover them and what they do here is untested. `03-RELEASING.md`'s existing claim
that a `perf:` commit releases nothing was left alone rather than restated as
measured. The dry runs also emitted
`⚠ pullRequestTitlePattern miss the part of '${scope}'` on both branches while
still rendering `chore(planner): release 0.4.1` correctly — noted, not
investigated, and out of this ticket's scope.

Gates: `npm run format` then `npm run check`, both green — this is a
documentation-only branch and oxfmt formats markdown here.
