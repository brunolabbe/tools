---
id: repo-33
tool: repo
title: ADR 004's rename is unfiled, and doing it renames the compose project under a running host
kind: chore
status: done
milestone: null
depends_on: []
difficulty: hard
---

# repo-33 — The compose rename ADR 004 decided, and the volume it moves

## Why

[adr/004](../adr/004-one-compose-fragment-per-tool.md) ends by saying the split
and the rename "are repo-wide and want a `repo-` ticket". That ticket was never
filed. Between 2026-08-22 and now the ADR has been the only record of a decision
nobody could pick up, which is exactly the shape `CLAUDE.md` warns about: an open
decision left as prose, inherited by the next agent as a fact.

Half of it has since landed by another route.
[`compose.planner.prod.yaml`](../../compose.planner.prod.yaml) gives the planner
the per-tool production fragment the ADR specifies, additively, and pl-2 records
why it stopped there. **What is left is the rename**, and it is not the paste it
looks like.

**The project name is the whole difficulty.** `compose.yaml` sets no `name:`, so
the compose project is the basename of whatever directory the host cloned into.
Measured on this branch, from the worktree it was written in:

```
$ docker compose -f compose.yaml -f compose.prod.yaml config --format json | jq -r .name
pl-2-planner-service
```

That is the directory, not the repository. ADR 004 requires an explicit `name:`
precisely because of it — "a project renamed by moving a file orphans the
volumes". But setting one on a host that is **already running** does the same
thing in the other direction: the project becomes `webtools`, and
`webtools_storage` is not the volume holding `jobs.db` and every file still
inside its retention window. The host comes up looking like a fresh install,
with the real data still on disk under a name nothing references.

[`compose.planner.yaml`](../../compose.planner.yaml) already sets
`name: webtools` and its header says not to merge it with `compose.yaml` by hand
for this reason. So the divergence is live today, not hypothetical: a host that
wants the planner's real distances cannot merge the fragment that provides them.

## Build

1. **Write the volume migration first, and put it in
   [02-DEPLOYMENT.md](../02-DEPLOYMENT.md) rather than in this ticket.** It is
   the step an operator runs on a live machine, so it belongs on the page they
   already have open. `docker volume` has no rename; it is create-and-copy, with
   the stack down, and it must name both the old project (`<basename>_storage`)
   and the new one (`webtools_storage`). The old volume is kept, not removed —
   deleting it is a separate deliberate act once the new one is proven.
2. **Rename to the ADR's five files**: `compose.downloader.yaml`,
   `compose.downloader.prod.yaml`, `compose.planner.yaml`,
   `compose.planner.prod.yaml`, and `compose.prod.yaml` reduced to the tunnel and
   the `edge` network alone. `git mv`, so the history follows.
3. **Set `name: webtools` in every fragment**, in the same change. A fragment
   that omits it reintroduces the basename default the moment it is merged first.
4. **`COMPOSE_FILE` in `.env.prod.example`**, so a deployed host types a bare
   `docker compose up -d` rather than a line of `-f` flags it can get wrong
   during a rollback. That is the ADR's own argument and it is the reason the
   file count is affordable.
5. **The README's one-liner grows a `-f`.** `README.md:26` "docker compose up --build"
   relies on compose finding the file by its default name; after the rename that command reports no configuration file at
   all. ADR 004 names this as the change most likely to be forgotten, because it
   is the one path that never touches `.env` — a fresh clone has none.
6. **Sweep every other mention.** `docs/02-DEPLOYMENT.md` names `compose.yaml` in
   several command blocks and in prose, `docs/03-RELEASING.md` and both tools'
   `CLAUDE.md` may too, and `compose.planner.yaml`'s header carries a "do not
   merge the two by hand" warning that this ticket makes obsolete and must
   delete rather than leave standing.

## Done when

- `docker compose config` over each documented merge resolves, and reports
  `name: webtools` for all of them.
- A downloader-only merge stands up `downloader` and `cloudflared` and no third
  service — the property ADR 004 exists to protect, asserted rather than assumed.
- The README's first-run command works in a fresh clone with no `.env`.
- `02-DEPLOYMENT.md` carries the volume migration, and no file in the repo still
  says not to merge `compose.planner.yaml` with the downloader's.

## Traps

**Do not do this in the same change as anything else.** It is a rename plus a
data migration, and the one thing that must be true afterwards is that an
operator can read the diff and know what to run before their next `up -d`.

**`docker compose down -v` is the command that makes this unrecoverable**, and
it is plausible to type while a rename is half-applied. The tile volumes in
`compose.planner.yaml` are hours of CPU and the downloader's `storage` is the
only copy of anything a user downloaded.

## Review

**Gate: CONCERNS** — 2026-09-12 · `origin/main...c57a3ff` · own defect hunt (ticket-reviewer, no `code-review` dispatch available) at medium depth

| Done when                                                                                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker compose config` over each documented merge resolves, reports `name: webtools` for all of them                                         | **verified** — ran all 6 documented merges by hand at c57a3ff (downloader dev alone, downloader prod 3-file, both-tools prod 4-file, planner prod alone 2-file, planner dev/grounding alone, downloader-dev+planner-dev): each `rc=0`, `name=webtools`. `name:` set explicitly in every fragment — `compose.downloader.yaml:23 "name: webtools"`, `compose.prod.yaml:32 "name: webtools"` ✓                                                                                                                                          |
| A downloader-only merge stands up `downloader` and `cloudflared` and no third service                                                         | **verified** — `docker compose -f compose.downloader.yaml -f compose.prod.yaml -f compose.downloader.prod.yaml config --services` → exactly `downloader`, `cloudflared` (2 lines); `cloudflared.depends_on` correctly scoped to only the tool(s) actually merged, checked across all three prod combinations                                                                                                                                                                                                                         |
| The README's first-run command works in a fresh clone with no `.env`                                                                          | **unproven (gate)** — `README.md:26 "docker compose -f compose.downloader.yaml up --build"` resolves correctly (config succeeds, correct build context: confirmed) but no Docker daemon exists in this container, so `up --build` never completed. The actual proof is `.github/workflows/downloader.yml:163 "docker compose -f compose.downloader.yaml up -d --no-build"`, which has not run on this branch — no PR is open (`gh pr list --head repo-33-compose-rename` empty, `gh run list --branch repo-33-compose-rename` empty) |
| `02-DEPLOYMENT.md` carries the volume migration, and no file in the repo still says not to merge `compose.planner.yaml` with the downloader's | **verified** — `docs/02-DEPLOYMENT.md:378 "Read this before your first"` opens the migration section; repo-wide grep for the old "do not merge by hand" warning returns nothing live anywhere in the tree                                                                                                                                                                                                                                                                                                                            |

- **med (raised and repaired in this round)** · The volume migration as first written (eb4325e) assumed a one-tool host. A host running both tools pre-rename was documented, not hypothetical (on `origin/main`, `02-DEPLOYMENT.md`'s "Adding the second tool" section instructed a 3-file `up -d` including `compose.planner.prod.yaml`, and that fragment set no `name:` on `main`, so both tools' volumes sat under one basename-derived project). Step 2's `down` named only the downloader's files, leaving a co-running planner container as an orphan to that invocation (`docker compose down --help` documents `--remove-orphans` as the flag that would otherwise remove them, which is the evidence `down` doesn't stop them by default); step 4 then risked copying `planner_storage` while that container still had `planner.db` open — the torn-copy failure the section names for the downloader's own volume two paragraphs above. Step 5 also verified only the downloader's volume. **Repaired at c57a3ff**: steps 2, 3, 5, 6 and 7 now all name both tools explicitly — `docs/02-DEPLOYMENT.md:405 "If this host runs both tools"` states the two-tool case up front, step 2 adds a two-tool `down` variant plus a `docker ps` check that must print nothing, step 5 repeats the byte/file comparison for `planner_storage` (`docs/02-DEPLOYMENT.md:518 "this is not optional, it is the one that catches"`), step 6 names per-tool data to check rather than a generic health probe, step 7 promotes the planner volume out of a trailing comment. Re-verified against source: `tools/downloader/api/src/config.ts:228 "databaseFile: "jobs.db""`, `tools/planner/api/src/config.ts:222 "databaseFile: "planner.db""`.
- **low** · `docs/00-TOOLS.md:50 "the login policy"` was edited beyond what the rename required — `compose.prod.yaml` still exists unchanged, so this is a copy-edit rather than a repair of something the rename broke. Harmless (if slightly awkward: "the tunnel, ... compose.prod.yaml's tunnel ... " now says "tunnel" twice), not blocking.
- **dropped** · none — everything the hunt turned up is carried above, either as a finding or as the informational item below.
- **informational, not a defect in this branch** · Docker Compose's own default-file discovery walks up parent directories; from a worktree nested under `/workspaces/tools`, a bare `docker compose config` (no `-f`) silently resolves the shared root's still-present `/workspaces/tools/compose.yaml` rather than erroring — reproduced independently by both the builder and me, from different cwds, both results genuine. This is a second route into the hazard already filed and left open in `docs/work/repo-43-a-worktree-nested-path-shadows-the-shared-root.md`, reached through Compose's own search rather than a typed absolute path. It does not affect anything shipped here — the README and CI commands both name `-f compose.downloader.yaml` explicitly and are immune to the walk-up, confirmed. Not this ticket's decision to resolve; noted for whoever next picks up repo-43.
- **findings** · 2 returned across the round (1 med, 1 low), 2 carried, 0 dropped; 1 additional informational item logged but not counted as a defect.
- NFR: security ✓ (no credential handling changed, `TRUST_PROXY`/`TUNNEL_TOKEN` values relocated but not altered) · performance n/a · reliability ✓ (per-tool `depends_on`/health-check wiring preserved and now correctly scoped; migration repaired to stop-before-copy on every path) · maintainability — above.

## Log

**2026-09-12 — merged `main`, and re-proved `Done when` #3 on the merged tree.**
`main` moved under the open PR (five merges, including pl-2 `d0727a2` / #212,
which edits `docs/02-DEPLOYMENT.md`). Merged rather than rebased: the gate
record is committed, and a rebase moves every coordinate in it with no record
of why. Merge commit `b3b3786`.

**The verdict below was measured on `6fcf4be` and was not carried forward.**
The merge changes the tree that run measured, so the `docker` job was run again
rather than argued about: **run `34718932111`, workflow `downloader`, on
`b3b37860638f77a06c23d570334fd760699d4d5a`, conclusion `success`**; job level
`docker status=completed conclusion=success`; step 5
`docker compose -f compose.downloader.yaml up -d --no-build` and step 6 the
health wait, both `success`. `Done when` #3 is closed against the merged tree by
direct evidence.

That mattered more than it looked. A proposed shortcut — "the merge touches none
of the image-build inputs, so the old run still applies" — named only the _root_
`package.json`, and the merge does touch **`tools/downloader/api/package.json`**
(`0.3.0` → `0.4.0`, from release-please). The bumped manifest builds green on
`main` at `a7f2c86`, and the rename builds green on `6fcf4be`, but no run had
covered **both together** until this one.

**One conflict, and it was not a pick-a-side.**
`pl-38-the-planner-limiter-shares-one-bucket.md`: both branches had repointed
the _same_ two citations, each correct against its own tree — pl-2 to
`docs/02-DEPLOYMENT.md:657` and `:273`, this branch to `:833` and `:231`. In the
merged tree, which carries pl-2's 58-line section _and_ this branch's migration,
**all four are wrong**. Re-resolved by running the checker against the merged
file: `:889` and `:283`. The two this branch repaired that pl-2 never touched
were re-checked rather than assumed to have survived — `compose.prod.yaml:71`
and `compose.planner.prod.yaml:88`, both still correct. pl-2's own
`pl-2-container-image.md:283` repair is unrelated and kept as it merged.

**`docs/02-DEPLOYMENT.md` auto-merged cleanly, which is not the same as being
correct, so it was read end to end.** pl-2's new section lands between steps 1
and 2 of the tunnel walkthrough, above everything this branch wrote; the volume
migration is contiguous with all seven steps in order and the two-tool handling
intact in each. Four `compose.yaml` mentions remain in the file and all four are
deliberate — two historical prose, two in migration step 2's pre-pull command,
which is meant to name the old files.

**The merge's most interesting artefact is a test from the other branch that
reads this branch's files.** pl-2 added `scripts/test/cloudflare-setup.test.ts`,
which globs the compose fragments at the repo root and asserts each tool's
published port. It was written anticipating this rename and finds fragments by
the _service they define_ rather than by filename. Run rather than trusted: 15
tests pass. It is also not vacuous — it guards with
`expect(fragments.length, "found no compose fragments to check against")` and a
per-tool `"no compose fragment defines ${t.tool} with ports"`. The builder read
those guards rather than demonstrating them red, declining to mutate a shared
file mid-merge, and recorded the distinction instead of glossing it — **and the
reviewer then ran the mutation, which is the better outcome and is why the
distinction was worth writing down.** It renamed `compose.downloader.yaml` out
from under the test: `AssertionError: no compose fragment defines downloader
with ports: expected [] to not have a length of +0`, exactly the guard it is
supposed to exercise. Renamed back, `git status --porcelain` empty, 15/15 again.
The test genuinely depends on finding the renamed fragments by content.

**Three citations in the `## Review` section broke and were deliberately not
repaired by the builder.** pl-2's insertion pushed `docs/02-DEPLOYMENT.md:326`, `:353` and
`:466` down to `378`, `405` and `518`. They are the reviewer's own text, so the
failure was sent to it rather than rewritten here. It confirmed all three
against the merged tree itself, proved the fix in a scratch copy before sending
it (`citations.mjs` exit 0, 10 verified), and returned the corrected lines,
which were applied as exactly three coordinate substitutions with nothing else
in either line touched. None of this Log's own citations moved.

**2026-09-12 — `Done when` #3 converted from `unproven (gate)` to verified.**
PR [#211](https://github.com/brunolabbe/tools/pull/211) fired the run that
neither the builder nor the reviewer could: **run `34713750829`, workflow
`downloader`, on `6fcf4bea49baed63c70372a3de68d46f8e456b87`, conclusion
`success`.**

**The workflow's own verdict was not taken as the answer.** A workflow reports
`success` when a job is _skipped_, and a `cancelled` run is a _completed_ run —
either would read as green at a glance. So the `docker` job was read directly,
`gh run view 34713750829 --json jobs`: `docker  status=completed
conclusion=success`, alongside `e2e (direct)` and `e2e (sniffer)`, both also
`success`. Its steps, which are the actual evidence:

```
4. Build the image                                                → success
5. Run docker compose -f compose.downloader.yaml up -d --no-build → success
6. Wait for the service to report healthy                         → success
7. Run docker compose -f compose.downloader.yaml down -v          → success
```

Step 5 is the renamed fragment being found and resolved on a clean machine with
no `.env`, and step 6 is `/api/health` answering from the container it started.

**What this does not prove, stated because a pass is easy to over-read.** CI
builds through buildx and then runs `up -d --no-build`; the README's own verb is
`up --build`. So the compose file, the project name, the service definition and
the boot are all proven, and the literal `--build` path is still inferred from
the fact that the same file's `build:` section is what buildx was pointed at. It
is a much smaller gap than the one this closes, and it is the gap.

**Nor does this run prove the path-filter half of the workflow fix, and it was
never going to.** `.github/workflows/downloader.yml` is in its own filter list
and changed on this branch, and `tools/downloader/Dockerfile` changed too — not
caught by the trailing `!**.md` — so there were at least three independent
reasons this job triggered and the run does not isolate the compose-path
filters. What it proves is exactly what the acceptance line asks, which is the
half that needed proving. (Recorded at the reviewer's request, in its words as
well as these: necessary but not sufficient for the filters, sufficient for the
line.)

**The gate's CONCERNS verdict now rests on nothing.** Its med closed at
`c57a3ff`, its low at `6fcf4be`, and its single `unproven (gate)` line is this
entry. The `## Review` section above is left exactly as raised — it was true of
the tree and the evidence available when it was written, and a verdict that gets
rewritten once the evidence arrives is not a record.

Also green on the same sha: `security` and `pr-title`. `CI` was still
`in_progress` when this was written and is not part of this line's proof.

**2026-09-12 — the gate's low, closed.** The Review above records
`docs/00-TOOLS.md:50` as edited beyond what the rename required, and it was
right: `compose.prod.yaml` still exists, so listing it among the repo-wide
concerns needed no change, and qualifying it to "`compose.prod.yaml`'s tunnel"
made the sentence say "tunnel" twice. Restored to the wording this branch
started from, so the file now drops out of the branch's diff entirely — a
diff of it against `origin/main` is empty. The finding stays in the Review as
raised: it was a true observation about the tree it reviewed, and this entry is
where the repair belongs rather than in an edit to the record.

**2026-09-12 — gate round: the migration was written for a one-tool host.**

**The defect (the gate's finding 1, and it is real).** A host running _both_
tools before this branch was a documented configuration — `origin/main`'s
`02-DEPLOYMENT.md:516` instructs
`-f compose.yaml -f compose.prod.yaml -f compose.planner.prod.yaml up -d`, and
`git show origin/main:compose.planner.prod.yaml | grep -c '^name:'` returns `0`,
so all three files derived the same basename project and both tools' volumes sat
under it. The planner has released versions to fill `PLANNER_TAG`
(`tools/planner/CHANGELOG.md`, 0.5.0 on 2026-09-07), so such a host is
deployable and not merely describable. **Whether one was ever actually deployed
is not knowable from this repository, and I am not claiming it was** — the
procedure has to be safe for it either way.

As written, the procedure was not. Step 2 stopped only the downloader's file
set; step 4 then copied `planner_storage` while a planner container from the
same project could still hold `planner.db` open — the torn copy the section
warns about by name two paragraphs earlier — and step 5 verified only the
downloader's volume, so a torn planner copy would not have been caught before
step 6 started the stack.

**The mechanism, evidenced rather than assumed.** `docker compose down --help`
lists `--remove-orphans` — "Remove containers for services not defined in the
Compose file" — _on `down` itself_. A flag that exists to remove them is the
evidence that `down` does not, so a partial file set leaves the other tool's
container running. I could not run `down` to watch it happen: there is no Docker
daemon in this container, and the ticket forbids running it anyway.

**Both of the gate's two options were taken, not one.** It offered (a) fix step
2's stop command or (b) add the planner check to step 5, and leaned (a) as the
source of the risk. (a) alone leaves an operator who mis-reads step 2 with no
check that catches it; (b) alone leaves the torn copy happening and merely
detected. They close different halves — cause and detection — and a migration
whose failure mode is a silently empty database should have both. Step 2 now
shows the two-tool `down` and a `docker ps --filter label=com.docker.compose.project`
that must print nothing before continuing; step 5 repeats the byte/file
comparison for `planner_storage`.

**The rest of the section carried the same one-tool assumption, which is the
shape rather than the instance.** Step 3's `COMPOSE_FILE` showed only the
downloader's three fragments — a two-tool host that copied it would have brought
up half its stack. Step 6 said to check "the job list", which is the
downloader's; the planner's `/api/health` answers just as happily against an
empty `planner.db`, so it now names the data to look for in each tool and says
not to run step 7 if either is empty. Step 7 promoted the planner volume out of
a trailing comment. Steps 2, 3, 5, 6 and 7 all changed; only step 1 needed
nothing.

Both database filenames in the new text were read out of the source rather than
guessed: `tools/downloader/api/src/config.ts:228` `databaseFile: "jobs.db"`, and
`tools/planner/api/src/config.ts:222` `databaseFile: "planner.db"` with
`tools/planner/Dockerfile:115` `ENV DATABASE_PATH=/data/planner.db` confirming
it sits at the root of the mounted volume.

**A correction to how the rename's breakage was demonstrated (the gate's finding
3, settled by the orchestrator, and re-reproduced here both ways before this
was written).** "The old command fails cleanly after the
rename" is **true only from a directory that is not nested under another
checkout**, and any claim of it needs to say where it was run. Compose's
default-file discovery walks _up_ the directory tree, so from a worktree under
`/workspaces/tools/.claude/worktrees/...` a bare `docker compose config` does
not fail at all — it silently resolves the shared root's `/workspaces/tools/compose.yaml`
and reports `name=tools`, `build.context=/workspaces/tools`. Measured both ways,
same command, no `COMPOSE_FILE` set in either environment:

```
$ cd /tmp/.../freshclone-xyz && docker compose config      # not nested
no configuration file provided: not found

$ cd /workspaces/tools/.claude/worktrees/agent-a46d... && docker compose config --format json | jq -r '.name, .services.downloader.build.context'
tools
/workspaces/tools
```

This is a second route into
[repo-43](./repo-43-a-worktree-nested-path-shadows-the-shared-root.md)'s hazard —
reached through Compose's own file search rather than through a typed absolute
path — and it is that ticket's open question, not this one's. **It changes
nothing about what ships here**: the README and the CI job both name
`-f compose.downloader.yaml` explicitly, which is immune to the walk-up, and the
gate confirmed that resolves correctly regardless of nesting. The claim above
about `.github/workflows/downloader.yml` — that its old bare command "finds no
configuration file" — holds on a CI runner, whose checkout has no compose file
in any ancestor directory; it would not hold in a nested worktree, and that is a
property of where it runs rather than of the fix.

**2026-09-12 — done.** The rename, the split, `name: webtools` in all five
fragments, `COMPOSE_FILE`, and the volume migration in `02-DEPLOYMENT.md`.

**The premise reproduced, in this worktree.** Before any edit,
`docker compose -f compose.yaml -f compose.prod.yaml config --format json | jq -r .name`
printed `agent-a46d027fb77348477` — this worktree's directory basename, not
`webtools` and not anything a human chose. Same defect the brief measured as
`pl-2-planner-service`, which is the point: the name follows whatever directory
the tree happens to sit in.

**What the brief had wrong, or left for the builder to decide.**

- **"Rename to the ADR's five files" is four renames and one split, and only one
  of them is a `git mv`.** `compose.yaml` → `compose.downloader.yaml` is a move.
  `compose.planner.yaml` and `compose.planner.prod.yaml` already have their
  target names. `compose.prod.yaml` keeps its name and _loses_ content: the
  `downloader` service block moved out into a new
  `compose.downloader.prod.yaml`. Doing that as a `git mv` of `compose.prod.yaml`
  and a new file for the tunnel would have made the history follow the smaller
  half — the tunnel and the `edge` network are the bulk of that file and are
  what still belongs to it — so the move was left where the content stayed. One
  `git mv`, as the prompt asked, on the one file whose identity actually moved.

- **`cloudflared`'s `depends_on: downloader` had to move too, and the brief does
  not mention it.** "Reduced to the tunnel and the `edge` network alone" is not
  achievable while the shared overlay still names a tool in a `depends_on`;
  `compose.planner.prod.yaml` already showed the shape, so
  `compose.downloader.prod.yaml` now mirrors it. That is what makes
  `docker compose -f compose.prod.yaml -f compose.planner.prod.yaml` — a
  planner-only host — resolve at all. It could not before: the shared overlay
  carried the downloader's image and its `depends_on`, so every host got a
  downloader whether it asked or not. The ADR claims that property; until today
  the files did not have it.

- **The `.env.prod.example` merge list was already stale in a way the brief did
  not flag.** It documented `-f compose.yaml -f compose.prod.yaml` as "the
  downloader, behind the tunnel", which is now three files, and it had no
  planner-only row because there could not be one.

- **`.github/workflows/downloader.yml` is not in the brief's sweep list and it is
  the only place a stale name is a red build rather than stale prose.** Its
  `docker` job ran a bare `docker compose up -d --no-build`, which after the
  rename finds no configuration file; its two path filters watched
  `compose.yaml`, so a change to the renamed fragments would not have triggered
  the job that tests them. Both fixed, and the filters now also watch
  `compose.downloader.prod.yaml` and `compose.prod.yaml`.

- **Two closed tickets' gate records cite lines this change moves.**
  `scripts/citations-gate.mjs` went red on pl-33 and pl-38 — three anchors in
  `compose.planner.yaml`, one in `compose.prod.yaml` that fell off the end of
  the shortened file, one in `compose.planner.prod.yaml` and two in
  `02-DEPLOYMENT.md`. All seven were confirmed to resolve on `origin/main`
  first, so they were green before and this change broke them; re-resolved
  against the tip.

**The volume migration is `02-DEPLOYMENT.md`'s
`## Migrating the volumes onto the project name`**, seven steps: read the old
prefix off `docker volume ls` rather than deriving it, stop the stack **without
`-v`**, set `COMPOSE_FILE`, `docker volume create` plus a throwaway container
doing `cp -a /from/. /to/` with the source mounted `:ro`, compare byte and file
counts, bring up and check **the job list rather than `/api/health`** — health
answers perfectly against an empty database, which is the failure being
prevented — and remove the old volume later, deliberately. One fact worth having
found: the planner's grounding volumes need no migration at all, because
`compose.planner.yaml` has set `name: webtools` since it was written. Only
`storage` and, on a host already running the planner's image, `planner_storage`
move.

**What was deliberately not done.**

- **`tools/planner/api/src/config.ts:120` still says "which is what
  `compose.yaml` now brings up"**, and it is wrong twice over: that file is gone,
  and the sentence was already wrong before this ticket, since the `overpass`
  service it describes is in `compose.planner.yaml` and never was in
  `compose.yaml`. Left alone because a concurrent ticket (repo-40) owns that
  file; reported to the orchestrator rather than edited, and it is a one-word
  fix for whoever holds the file next.
- **Closed tickets' briefs and reports naming `compose.yaml` were left standing**
  — dl-7, dl-10, pl-2 and pl-28's F4 all describe the file as it was, and
  rewriting a finished record to match a later tree loses the reason it was
  written. pl-28's F4 was the one exception worth making: it asserts in the
  present tense that merging the two fragments orphans the downloader's volume,
  which stopped being true today, so its Log carries a dated correction rather
  than an edit to the finding.

**Not verified, and not verifiable here: nothing was ever started.** There is no
Docker daemon in this container — `docker info` fails — so every check below is
`docker compose config`, which is a pure parse-and-merge and needs no daemon.
The merges resolve and report the right project name and the right service list;
that no volume is actually orphaned by a real `up -d`, and that the `cp -a`
migration preserves a working `jobs.db`, are unrun. Per the brief, nothing that
could remove a volume was executed at any point: no `down`, no `down -v`, no
`up`, no `rm`. The migration section is the procedure an operator runs, written
and reviewed rather than rehearsed.

**2026-09-07 — filed while doing pl-2's deployment half.** Not started. The
measurement above is the only new fact: the project name really is the clone's
directory basename, which is what makes the rename a migration rather than a
paste.
