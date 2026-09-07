---
id: repo-33
tool: repo
title: ADR 004's rename is unfiled, and doing it renames the compose project under a running host
kind: chore
status: ready
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

## Log

**2026-09-07 — filed while doing pl-2's deployment half.** Not started. The
measurement above is the only new fact: the project name really is the clone's
directory basename, which is what makes the rename a migration rather than a
paste.
