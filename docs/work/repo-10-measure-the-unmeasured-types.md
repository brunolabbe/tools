---
id: repo-10
tool: repo
title: Measure what a perf or revert commit actually does to a release
kind: chore
status: done
milestone: null
depends_on: [repo-7]
---

# repo-10 — two sentences about `perf` are in tension, and neither was run

**Packages:** `docs`

## Why

[repo-7](./repo-7-changelogs-are-attributed-by-path.md) measured two types
through `release-please --dry-run`: a `fix` releases the tool whose path it
touched, and a `docs` does not, skipped with `No user facing commits found`. It
did not run `perf` or `revert`, and those two are the ones
[03-RELEASING.md](../03-RELEASING.md) says two different things about:

- `03-RELEASING.md`, under **Writing a commit**: _"A `perf:` commit on its own
  therefore releases nothing"_ — a claim about the **version bump**, and
  pre-existing.
- `03-RELEASING.md`, under **Annotating another tool's ticket**: the
  `No user facing commits` skip does **not** cover `perf` and `revert`, because
  neither is `hidden` in `changelog-sections` — a claim about the **skip**, added
  by repo-7 and measured only for `docs`.

They are reconcilable — release-please can decline to skip and still decline to
bump — but nobody has watched it do so.

**And a third sentence may be wrong, which would make this more than a
reconciliation.** `03-RELEASING.md`, under **Writing a commit**, also says _"Only
`feat`, `fix` and a breaking change move a version — that is release-please's
rule, not a choice made here."_ repo-7's gate 2 flagged that this may itself be
false: release-please's default versioning strategy **may** fall through to a
patch bump for any non-empty, non-breaking commit set, which would mean a `perf`
commit releases after all. **That is recollection, not measurement** — the gate
ran no release-please, read no release-please source, and explicitly declined to
assert it. Treat it as the hypothesis this ticket tests, not as a finding to
write up. It is recorded here only so this ticket does not walk in assuming the
answer is a wording fix. Both gates on repo-7 raised the gap and
disagreed on its severity; repo-7's answer was to stop enumerating types in the
operative rule and point at the config instead, which is correct whatever the
answer here turns out to be. This ticket is the measurement neither gate had.

There are **zero** `perf` and `revert` commits in this repository's history, so
nothing is broken today. What is at risk is the same thing repo-7 was about: a
sentence written down without being run.

## Build

1. Reproduce repo-7's harness, which is recorded with its commands under
   [03-RELEASING.md](../03-RELEASING.md#annotating-another-tools-ticket-without-releasing-it).
   A scratch branch off `main`, one commit, one file under `tools/planner/`,
   pushed to `origin`, run through
   `npx release-please@17.11.1 release-pr --repo-url=… --target-branch=<scratch> --dry-run`.
   All seven workflows are `push: branches: [main]` or have no `push` trigger at
   all, so a scratch branch costs no CI. **Delete the branch from `origin` as the
   next action after the run.**
2. Run it twice: once with a `perf(planner):` subject, once with `revert:`.
   Record whether release-please skips, and if it does not, whether the release
   pull request it would open carries a version bump and under which section.
3. Reconcile what came back with **all three** sentences above, in
   `03-RELEASING.md`, and paste the commands and their real output into this
   ticket's Log. Three outcomes, and the brief does not assume which:
   - the two sentences describe the same behaviour → say it once rather than
     twice;
   - they describe different behaviours that coexist → say which is which;
   - **`perf` bumps a version**, and the "only `feat`, `fix` and a breaking
     change move a version" sentence is wrong → fix that sentence too, and say
     in the Log that it had been wrong since it was written. That is the outcome
     the brief is least prepared for and the one to check first.
4. If `perf` or `revert` does open a release pull request, `CLAUDE.md`'s rule
   already covers it — it names the not-`hidden` set rather than `feat`/`fix` —
   so check that it still reads correctly and change nothing else.

## Done when

- The Log carries the two commands and their verbatim output.
- `03-RELEASING.md` says one thing about `perf` and `revert` where it currently
  says two, and what it says is what the runs showed.
- Every sentence in `03-RELEASING.md` that the runs contradict is corrected —
  including the pre-existing "only `feat`, `fix` and a breaking change move a
  version", if it turns out the runs contradict that one too. The acceptance is
  "the document agrees with the measurement", not "the two flagged sentences
  were reconciled".
- Anything still unmeasured after this — the five hidden types repo-7 assumed
  behave like `docs` — is named as unmeasured rather than quietly folded in.

## Log

### 2026-08-30 — measured. `perf` bumps a version, and the brief's least-expected outcome is the true one

**Result first.** `perf` and `revert` are **not** skipped and **do** bump: on a
single commit touching one file under `tools/planner/`, each takes planner
`0.4.0 → 0.4.1` and lands under `### Performance` / `### Reverts`. Outcome three
of the brief's three. `03-RELEASING.md`'s _"Only `feat`, `fix` and a breaking
change move a version — that is release-please's rule"_ has been wrong since it
was written, and so has _"a `perf:` commit on its own therefore releases
nothing"_. Both are gone.

**The two sentences were not describing two coexisting behaviours.** The version
is computed on **every** run, the `docs` one included, and the skip fires
afterwards and throws it away — so "declines to skip but declines to bump" is not
a state release-please has. Not skipping is releasing.

#### What could not be done, and why the runs are what they are

**The end-to-end `--dry-run` did not happen.** The harness was set up exactly as
step 1 asks — scratch branch `repo-10-verify-scratch`, one commit
`perf(planner): scratch measurement, perf on a planner path only (repo-10)`,
one file `tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md`, pushed to
`origin` — and the run failed on authentication:

```bash
npx release-please@17.11.1 release-pr --repo-url=brunolabbe/tools \
  --target-branch=repo-10-verify-scratch --dry-run
```

```
❯ Fetching release-please-config.json from branch repo-10-verify-scratch
❯ Fetching .release-please-manifest.json from branch repo-10-verify-scratch
✔ Building pull requests
✔ Building strategies by path
❯ tools/downloader: simple
❯ tools/planner: simple
✔ Collecting release commit SHAs
❯ release search depth: 400
❯ Fetching releases with cursor undefined
[…]
HttpError: Bad credentials - https://docs.github.com/rest
  status: 401,
  name: 'GitHubAPIError',
  cause: RequestError [HttpError]: Bad credentials
    request: { method: 'POST', url: 'https://api.github.com/graphql', … }
```

The repository is public (`gh repo view --json visibility` → `PUBLIC`) and the
REST half needs no token — that is how the run got nine lines in — but the
release lookup is **GraphQL**, and GitHub's GraphQL API has an unauthenticated
limit of **0**:

```
$ curl -s https://api.github.com/rate_limit
  "core":    { "limit": 60, "remaining": 56, … }
  "graphql": { "limit": 0,  "remaining": 0,  … }
```

So a token is required, and `.claude/settings.json` denies `Bash(gh auth token*)`.
Per CLAUDE.md that is a stop, not a spelling to route around: no
`git credential fill`, no `~/.config/gh/hosts.yml`, no `--show-token`.
`--local` was checked as a possible way out and is not one —
`LocalGitHub.releaseIterator` (`build/src/local-github.js:510`) delegates
straight to `this.gitHubApi.releaseIterator`.

**The branch was deleted as the immediate next action, before any of this was
written up:**

```
$ git push origin --delete repo-10-verify-scratch
To https://github.com/brunolabbe/tools.git
 - [deleted]         repo-10-verify-scratch

$ git ls-remote --heads origin | grep -c repo-10-verify-scratch
0
```

**Preconditions checked before the push, by reading all seven trigger blocks
rather than counting files.** Two have no `push` trigger at all —
`cache-cleanup.yml` (`pull_request: types: [closed]`) and `pr-title.yml`
(`pull_request: types: [opened, edited, reopened, synchronize]`). Five are
`push: branches: [main]` — `ci.yml`, `downloader.yml`, `planner.yml`,
`release.yml`, `security.yml`. None can fire on a non-`main` ref, and the
`pull_request` triggers need a pull request, which was never opened.
`gh run list --branch repo-10-verify-scratch --limit 10` returned nothing at
all, after the push and after the delete.

#### What was run instead, and its warrant

release-please 17.11.1's **own** decision code, offline, against a synthetic
commit — not a reading of the source and not recollection, but the same two
calls `BaseStrategy.buildReleasePullRequest` makes, in the same order, with this
repository's config:

```js
// /tmp/.../offline-harness.cjs — run as: node offline-harness.cjs "<subject>" …
const RP = "<npx cache>/node_modules/release-please/build/src";
const { parseConventionalCommits } = require(RP + "/commit.js");
const { DefaultVersioningStrategy } = require(RP + "/versioning-strategies/default.js");
const { DefaultChangelogNotes } = require(RP + "/changelog-notes/default.js");
const { Version } = require(RP + "/version.js");
const config = require("/workspaces/tools/release-please-config.json");

const notesBuilder = new DefaultChangelogNotes({});
const strategy = new DefaultVersioningStrategy({ bumpMinorPreMajor: true });
const changelogEmpty = (entry) => entry.split("\n").length <= 1; // base.js:316-318

(async () => {
  for (const subject of process.argv.slice(2)) {
    const commits = parseConventionalCommits([
      {
        sha: "a6bb57b",
        message: subject,
        files: ["tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md"],
      },
    ]);
    const next = strategy.bump(Version.parse("0.4.0"), commits); // base.js:338
    const notes = await notesBuilder.buildNotes(commits, {
      // base.js:113-127
      owner: "brunolabbe",
      repository: "tools",
      version: next.toString(),
      previousTag: "planner-v0.4.0",
      currentTag: "planner-v" + next.toString(),
      changelogSections: config["changelog-sections"],
      commits,
    });
    // base.js:172 — the skip
    console.log(subject, changelogEmpty(notes), next.toString(), notes);
  }
})();
```

Nothing between the parse and those two calls was skipped:
`BaseStrategy.postProcessCommits` is the identity (`base.js:110-112`) and
`Simple` overrides neither `buildReleaseNotes` nor `changelogEmpty`.

**It reproduces both of repo-7's real runs**, which is the reason to trust it on
the types nobody has run:

```
$ node offline-harness.cjs "fix(repo): scratch measurement, annotate a planner ticket only (repo-7)"
subject:            fix(repo): scratch measurement, annotate a planner ticket only (repo-7)
Considering:        1 commits
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.4.1
release notes body:
## [0.4.1](https://github.com/brunolabbe/tools/compare/planner-v0.4.0...planner-v0.4.1) (2026-08-30)


### Fixes

* **repo:** scratch measurement, annotate a planner ticket only (repo-7) ([a6bb57b](https://github.com/brunolabbe/tools/commit/a6bb57b))
```

```
$ node offline-harness.cjs "docs(planner): scratch measurement, annotate a planner ticket only (repo-7)"
changelogEmpty:     true  -> No user facing commits found - skipping
version 0.4.0   ->  0.4.1
release notes body:
## [0.4.1](https://github.com/brunolabbe/tools/compare/planner-v0.4.0...planner-v0.4.1) (2026-08-30)
```

`0.4.1` / `### Fixes` / the identical changelog line, and the identical skip —
against `03-RELEASING.md`'s recorded output for the same two subjects.

#### The two runs the ticket asked for

```
$ node offline-harness.cjs "perf(planner): scratch measurement, perf on a planner path only (repo-10)" \
                           "revert: scratch measurement, revert on a planner path only (repo-10)"
=================================================================
subject:            perf(planner): scratch measurement, perf on a planner path only (repo-10)
Considering:        1 commits
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.4.1
release notes body:
## [0.4.1](https://github.com/brunolabbe/tools/compare/planner-v0.4.0...planner-v0.4.1) (2026-08-30)


### Performance

* **planner:** scratch measurement, perf on a planner path only (repo-10) ([a6bb57b](https://github.com/brunolabbe/tools/commit/a6bb57b))
=================================================================
subject:            revert: scratch measurement, revert on a planner path only (repo-10)
Considering:        1 commits
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.4.1
release notes body:
## [0.4.1](https://github.com/brunolabbe/tools/compare/planner-v0.4.0...planner-v0.4.1) (2026-08-30)


### Reverts

* scratch measurement, revert on a planner path only (repo-10) ([a6bb57b](https://github.com/brunolabbe/tools/commit/a6bb57b))
```

#### The five that were assumed, and two more

```
$ node offline-harness.cjs "refactor(planner): x (repo-10)" "test(planner): x (repo-10)" \
    "build(planner): x (repo-10)" "ci(planner): x (repo-10)" "chore(planner): x (repo-10)"
subject:            refactor(planner): x (repo-10)
changelogEmpty:     true  -> No user facing commits found - skipping
subject:            test(planner): x (repo-10)
changelogEmpty:     true  -> No user facing commits found - skipping
subject:            build(planner): x (repo-10)
changelogEmpty:     true  -> No user facing commits found - skipping
subject:            ci(planner): x (repo-10)
changelogEmpty:     true  -> No user facing commits found - skipping
subject:            chore(planner): x (repo-10)
changelogEmpty:     true  -> No user facing commits found - skipping

$ node offline-harness.cjs "feat(planner): x (repo-10)" "fix(planner)!: x (repo-10)" "chore(planner)!: x (repo-10)"
subject:            feat(planner): x (repo-10)
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.5.0
### Features
subject:            fix(planner)!: x (repo-10)
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.5.0
### ⚠ BREAKING CHANGES
### Fixes
subject:            chore(planner)!: x (repo-10)
changelogEmpty:     false  -> not skipped
version 0.4.0   ->  0.5.0
### ⚠ BREAKING CHANGES
### Chores
```

All five behave like `docs`. **`chore(planner)!:` does not** — a `hidden` type
carrying `!` is _not_ skipped, because the `⚠ BREAKING CHANGES` heading makes
the changelog non-empty on its own. So the page's "is the title's type `hidden`"
test needed a second clause, "and is it free of `!`". Nobody has written a
`chore!` here; it is in the page because the run turned it up.

#### The mechanism, since the doc now states a rule rather than a list

`DefaultVersioningStrategy.determineReleaseType`
(`versioning-strategies/default.js`) counts exactly two things — `commit.breaking`
and `commit.type === 'feat' || 'feature'` — and ends
`return new PatchVersionUpdate()`. **`fix` is not named in that function.** It
gets its patch by the same fall-through `perf` and `revert` get theirs, which is
why "release-please's rule is `feat`/`fix`/breaking" was never true. The release
is stopped, when it is stopped, one level up:
`changelogEmpty(releaseNotesBody)` at `base.js:172`, where
`changelogEmpty` is `entry.split('\n').length <= 1` — empty exactly when every
commit rendered to nothing, i.e. every type in scope is `hidden`.

#### What the brief had wrong

- **"A scratch branch off `main`" no longer gives `Considering: 1 commits`.**
  That was true when repo-7 ran it, because `main` was then at `ece6ec0` =
  `planner-v0.4.0`. Today `git log --oneline ece6ec0..origin/main | wc -l` is
  **17**, and two release pull requests are open (planner 0.5.0, downloader
  0.2.1), so a branch off `main` puts eighteen commits in scope and the perf
  commit's effect is unreadable. The scratch branch was cut from `ece6ec0`
  instead — the last release commit — which is what actually reproduces the
  recorded conditions. `03-RELEASING.md` now says so.
- **The recorded harness cannot be run by an agent at all.** It needs
  `--token="$(gh auth token)"` and that command is denied. The brief and the
  dispatch both read the `--dry-run` as clear of the deny list; the deny it hits
  is the token, one argument in. Recorded on the page.
- **repo-7's gate was right.** The brief says to treat its "release-please may
  fall through to a patch" note as a hypothesis, not a finding. It is a finding:
  the fall-through is the last line of `determineReleaseType`.

#### Folded in

- `scripts/commit-message.mjs`'s header comment carried the same false claim
  the page did — _"`feat` and `fix` are the only two that move a version on
  their own … Everything else lands silently"_ — in the file
  `03-RELEASING.md` calls "the actual specification". Corrected there rather
  than left for a ticket to move one comment.
- `03-RELEASING.md`'s "`feat` and `fix` require one: **they are the two that
  reach a changelog**" is false for the same reason; `perf` and `revert` reach
  one and `SCOPE_REQUIRED` does not ask them for a scope.

#### Not done

- **No end-to-end `--dry-run` for any type in the new section.** Blocked on a
  denied command, not on judgement. Everything in it is offline execution of
  release-please's own code, validated against the two runs that were real, and
  the page says so in those words. A maintainer with a token can settle it in
  two minutes with the harness as recorded.
- **`SCOPE_REQUIRED` was not widened.** `perf` and `revert` now demonstrably
  reach a changelog while the hook lets them through unscoped, so
  `revert: something` would cut a changelog line naming no tool — the exact
  noise the scope requirement exists to prevent. Changing the set is a
  behaviour change to an enforced rule and belongs to whoever owns that
  decision; it is stated as a fact on the page and raised in the build report
  as an open decision.
- **`CLAUDE.md` unchanged**, per step 4. Its rule reads off the config's
  `hidden` flags rather than off a list of types, and the measurement confirms
  the sentence it ends on — "a type added there without `hidden` is releasing
  the day it is added".

_Filed from [repo-7](./repo-7-changelogs-are-attributed-by-path.md) on
2026-08-24, whose two gates disagreed about whether this gap mattered. Gate 2's
side of that disagreement was the correct one._
