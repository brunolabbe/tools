---
id: repo-7
tool: repo
title: A repo-scoped commit that touches one file under tools/ lands in that tool's changelog
kind: fix
status: ready
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
rate limiting into `packages/core` and edited eleven files under
`tools/downloader/api/`, so it decided the downloader's next minor version.
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
edit — from a commit reading `fix(repo): … (repo-3)`. That would have cut the
planner a patch release whose only changelog line is about `scripts/status.mjs`.
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

_Not started. Filed from [repo-3](./repo-3-show-a-closed-ticket.md) on
2026-08-23, which hit it and worked around it._
