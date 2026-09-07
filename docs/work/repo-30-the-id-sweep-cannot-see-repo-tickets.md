---
id: repo-30
tool: repo
title: The documented id sweep cannot see repo-wide tickets, and fails short instead of failing
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-30 — The id sweep cannot see repo-wide tickets

## Why

`docs/01-TICKETS.md` says the next free id is the union of two lists, and
`.claude/skills/orchestrate-tickets/reference/concurrency.md:139 "git ls-tree origin/main"`
gives the command that computes it:

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
