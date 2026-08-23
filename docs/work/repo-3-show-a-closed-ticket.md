---
id: repo-3
tool: repo
title: Say that a closed ticket is closed, instead of reporting it unblocked
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-3 — `--show` on a closed ticket reports `unblocked`

**Packages:** `scripts`

## Why

`npm run status -- --show <id>` is the one-ticket view, and
[docs/01-TICKETS.md](../01-TICKETS.md) advertises it as _"one ticket: its
fields, its blockers, its path"_. It ends every ticket with one of two words,
`unblocked` or `blocked by …`, and it prints the first of them for tickets that
are closed.

Reproduced on `origin/main` at `0c67b8e`. `pl-1` is `dropped`:

```
$ npm run status -- --show pl-1

pl-1  The conversation loop, end to end

  tool        planner
  kind        work-package
  status      dropped
  milestone   —
  depends on  nothing
  note        —
  file        tools/planner/docs/work/pl-1-conversation-loop.md

  unblocked
```

**A `done` ticket does it too**, which is what sets this ticket's scope — the
defect is about closed tickets, not about `dropped` specifically:

```
$ npm run status -- --show pl-25

pl-25  Cache grounding with a TTL that varies by kind
  …
  status      done
  depends on  pl-24
  …
  unblocked
```

The failure that matters is an agent asking what the state of a ticket is. It
runs `--show pl-26`, reads the last line, and picks the work up — because
`unblocked` is the word this view uses for _pickable_, and nothing further down
the output contradicts it. The `status` line four rows above says `dropped`, but
the closing line is the verdict the view exists to give, and it is the one being
given wrongly. A ticket that was deliberately taken out of the queue gets built
anyway, which is the exact outcome dropping it was meant to prevent.

That is not hypothetical: it was found on the `pl-26-not-ready-yet` branch,
where [pl-26](../../tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md) is
moved to `dropped` precisely so it would stop being advertised as ready work.
Applying that frontmatter change locally and re-running reproduces the same
output for `pl-26` — `status dropped`, then `unblocked`. So the one view a
person would use to double-check the deferral undoes it.

Two lines are responsible, both in `scripts/status.mjs`:

- **`describeTicket`, at `:325-329`.** It computes blockers from `depends_on`
  and nothing else:

  ```js
  for (const dependency of ticket.depends_on) {
    const found = byId.get(dependency);
    if (found === undefined) missing.push(dependency);
    else if (found.status !== "done") blockers.push(found);
  }
  ```

  The ticket's own `status` is never read. This much is arguably right — the
  function's JSDoc says it returns _"what is actually blocking it"_, and a
  closed ticket has the same dependency graph it always had.

- **`printTicket`, at `:591-597`.** This is the actual defect. It has exactly
  two branches and neither of them is "closed":

  ```js
  const holding = [
    ...blockers.map((blocker) => `${blocker.id} (${blocker.status})`),
    ...missing.map((dependency) => `${dependency} (not a ticket)`),
  ];
  process.stdout.write(
    holding.length === 0 ? "\n  unblocked\n\n" : `\n  blocked by  ${holding.join(", ")}\n\n`,
  );
  ```

  Blocked and unblocked are both statements about work that has not happened.
  Applied to a ticket that is over, either one is a category error.

The script already knows what closed means: `OPEN` is
`new Set(["ready", "in-flight"])` at `:48`, and `milestones` and both table
renderers key off it (`:286`, `:348-349`, `:551`). Only the single-ticket view
does not.

The mirror case is reachable and is worse to read: a closed ticket with a
dependency that is still open prints `blocked by …`, as though something were
holding up work that has already landed. No ticket is in that shape on `main`
today — a scan of `--json` finds zero closed tickets with a non-`done`
dependency — so the fix should cover it rather than wait for the first one.

## Build

1. **`scripts/status.mjs`, `printTicket` (`:575-598`).** Branch on the ticket's
   own status before branching on blockers. A ticket whose status is not in
   `OPEN` gets a closing line that says so — `done` and `dropped` word
   differently, and `dropped` should carry the `note` where there is one, since
   that field is where the reason lives (pl-26's is
   `Deferred until the existence slice is filed — not refused`). Suggested
   shape, not binding:

   ```
     done — nothing to pick up
     dropped — nothing to pick up (Deferred until the existence slice is filed)
   ```

   The requirement is only that the last line of a closed ticket's output cannot
   be read as "this is available".

2. **Decide `describeTicket` deliberately, and say which you chose in the Log.**
   Either leave it returning the true blocker list and let `printTicket` decide
   what to print — the smaller change, and it keeps `--json`-shaped consumers
   honest — or return a `closed` flag alongside `{ ticket, blockers, missing }`
   so the decision is made once. Do not silently empty `blockers` for a closed
   ticket:
   that would make the two existing `describeTicket` tests pass while destroying
   information the function is documented to carry.

3. **Tests, in `scripts/test/status.test.ts`.** The file already covers
   `describeTicket` directly (`:324-379`) and `--show` end to end (`:449-454`),
   with a `repoWith` helper that builds a throwaway repo of ticket files — use
   it rather than asserting against real tickets, which move. Cover:
   - a `dropped` ticket with no dependencies does not print `unblocked`;
   - a `done` ticket whose dependencies all landed does not print `unblocked`;
   - a closed ticket with an open dependency does not print `blocked by`;
   - a `ready` ticket still prints `unblocked`, and an `in-flight` one blocked
     by an open dependency still prints `blocked by` — the existing behaviour
     has to survive, and `:449-454` asserts only `/unblocked|blocked by/`, which
     both of the new cases would also satisfy. Tighten it or add beside it.

4. **Check nothing else states the two-branch rule.** `git grep -n unblocked`
   unfiltered — the word appears in `docs/01-TICKETS.md`'s `--ready`
   description, and `--ready` is not changing.

5. **[repo-6](./repo-6-dangling-dependency-kills-the-view.md) landed first and
   moved these lines.** Every `file:line` above was re-resolved against it on
   2026-08-23, and both code blocks in `## Why` are quoted as they read now —
   the earlier ones no longer existed anywhere in the file. Three things it
   changed that this ticket has to know:
   - `describeTicket` returns `{ ticket, blockers, missing }`. `blockers` is
     untouched — real, non-`done` tickets — and `missing` is a `string[]` of
     ids no ticket carries. Step 2's first option is therefore already the
     shape on `main`; its second option is now a fourth field, not a third.
   - `printTicket` gates `unblocked` on `holding.length === 0`, where `holding`
     is `blockers` and `missing` rendered together. **The closed branch step 1
     asks for goes in front of that condition, not in place of it** — replacing
     it would silently drop `repo-404 (not a ticket)`, which repo-6 pins at
     `scripts/test/status.test.ts:561-570`.
   - The CLI now takes `--root <dir>`, so a `--show` case can run end to end
     against a throwaway tree from `repoWith` instead of the real tickets. The
     `run()` helper takes it as a second argument and returns `stdout`,
     `stderr` and `status` separately.

   The defect itself is unchanged: `--show` on a `dropped` or `done` ticket
   with no open dependencies still ends in `unblocked`, because both lists are
   empty and neither branch reads the ticket's own status.

This is one file's worth of change plus its tests. It does not touch the parser,
the taxonomy, or any ticket's frontmatter.

## Done when

- `npm run status -- --show pl-1` prints a closing line that names the ticket as
  closed, and the string `unblocked` does not appear in its output.
- The same is true of a `done` ticket — check `pl-25` and `repo-2`.
- `npm run status -- --show dl-16` (a `ready`, unblocked ticket) still prints
  `unblocked`, and a ticket blocked by an open dependency still prints
  `blocked by …` naming it.
- `scripts/test/status.test.ts` has a test per bullet in Build step 3, each
  failing against `origin/main`'s `printTicket`.
- `npm run check` and `npm test` are green.

## Log

### 2026-08-23 — built on `repo-3-show-a-closed-ticket`, base `848af10`

**Reproduced first, on unfixed code**, against the real tickets. `--show pl-1`
(`dropped`, no dependencies), `--show pl-25` and `--show repo-2` (`done`) each
printed `status dropped` / `status done` four rows above a closing line reading
`unblocked`, exit 0. `--show pl-26` — the ticket the defect was found on —
printed its `note` row saying _Deferred until the existence slice is filed_ and
then `unblocked` under it. Four for four; the brief's account is exact.

After: `dropped — nothing to pick up`, `done — nothing to pick up`, and for
pl-26 `dropped — nothing to pick up (Deferred until the existence slice is
filed — not refused)`. `--show dl-16` (`ready`) and `--show pl-2` (`in-flight`)
still end in `unblocked`; `--show pl-29` still ends in
`blocked by  pl-28 (ready)`.

**Build step 2, decided: `describeTicket` is left alone.** It keeps returning
`{ ticket, blockers, missing }` with `blockers` the real, non-`done` tickets,
and `printTicket` makes the call. Three reasons, in order of weight. It is a
function about the _dependency graph_, and "is this ticket closed" is not a fact
about the graph — a closed ticket has exactly the dependencies it always had,
which is what its own JSDoc claims to report. A `closed` flag would have exactly
one consumer (`printTicket`, at `scripts/status.mjs:512`, the only caller in the
repo), and it would compute `OPEN.has(ticket.status)` at a distance from the
`ticket` object it hands back anyway — the caller can read the field it is
already given. And it keeps the mirror case _findable_: a `done` ticket that
still names an open dependency is a real anomaly in the graph, and the function
that answers "what is not landed" is where a future `--json` consumer or a lint
would look for it. The prohibition is respected and now pinned:
`scripts/test/status.test.ts:379-388` asserts a `done` ticket still reports both
its open blocker and its dangling id, so emptying `blockers` for a closed ticket
fails a test instead of quietly passing the two that existed.

**The closed branch goes in front of the pair, and keeps their payload.** repo-6
warned that replacing the `holding.length === 0` gate would drop
`repo-404 (not a ticket)`. Preceding it would drop the same thing for a closed
ticket, one case further in — so the closed line _carries_ the list rather than
discarding it: `done — nothing to pick up; depends_on still lists repo-404 (not
a ticket)`. Measured on a throwaway tree: `--show` on a `done` ticket whose only
dependency is dangling prints exactly that, exit 0, with repo-6's stderr warning
beside it. That is what keeps
[docs/01-TICKETS.md](../01-TICKETS.md)'s claim — _`--show` on the offending one
prints `repo-404 (not a ticket)` where a blocker would be_ — true rather than
nearly true, and it is why no documentation needed editing for this change.

**`dropped` carries its `note` and `done` does not.** The `note` field is
documented as "what the status view shows instead of the title", and pl-26 uses
it as the reason a ticket was deferred; the closing line is the one a reader
acts on, so the reason belongs there even though the `note` row four lines above
already prints it. That duplication is the whole argument of this ticket applied
to one field. A `done` ticket's note is a title substitute rather than a reason,
so it is left out.

**What the brief had wrong, or left open.**

- **Nothing in it was wrong.** Every `file:line` in the refreshed Build resolved
  against `848af10` and both quoted blocks were byte-accurate. repo-6's Build
  step 5 handover was accurate on all three of its claims, checked at the file:
  `describeTicket` returns `{ ticket, blockers, missing }` (`:317-331`),
  `printTicket` gated `unblocked` on `holding.length === 0` over both lists
  (`:591-597` at `848af10`; the pair is `:611-613` now, with the closed branch
  at `:605-610` in front of it), and `run()` takes `--root` and returns the
  three fields separately (`scripts/test/status.test.ts:94-105`).
- **One `Done when` line cannot be met as written.** It asks for "a test per
  bullet in Build step 3, each failing against `origin/main`'s `printTicket`",
  but step 3's fourth bullet is the _preservation_ criterion — a `ready` ticket
  still prints `unblocked` — and a test for behaviour that is unchanged passes
  against `origin/main` by construction. Three of the four bullets have tests
  that fail against `848af10` (four tests, measured). The fourth is proven the
  only way it can be: by mutation. A fix keyed on `ticket.status === "dropped"`
  kills two of its rows, and one keyed on `!== "ready"` — treating `in-flight`
  as closed — kills the other two. Both mutations were run; both were red.
- **The weak end-to-end assertion was worse than the brief says.** `:449-454`
  asserted `/unblocked|blocked by/` against the **real** `pl-2`, so as well as
  being satisfied by both new outputs it was one frontmatter edit from asserting
  nothing at all — flipping pl-2 to `done` changes the line it never looks at.
  Rewritten onto a `repoWith` tree with `--root`, asserting the closing line
  exactly. Every new case asserts the _last line_ rather than `toContain`, for
  the same reason: each of them is about a word that must not be there.
- **A cross-ticket annotation was wanted and could not be paid for**, which is
  the one thing this branch leaves undone. `pl-26`'s gate records this defect as
  a finding — _"not fixed, and out of scope … Being surfaced separately; no
  ticket filed from here"_ — and the natural close of that loop is an
  `_Outcome, 2026-08-23:_` line under it, in the pattern repo-6 used on ADR 003.
  It is not written, because `release-please` attributes a commit to a package
  **by the paths it touches**, not by its scope: a `fix(repo)` commit carrying
  one `.md` file under `tools/planner/` would cut the planner a patch release
  whose only changelog line is about `scripts/status.mjs`. Splitting the branch
  into two commits does not help — this repo squash-merges, so the pull request
  title is the one commit that lands and it carries every path in the branch.
  Measured rather than assumed: the pending planner `0.4.0` lists
  `fix(core): … (pl-17)` (`2ea0631`, which touched `tools/planner/Dockerfile`),
  and the pending downloader `0.2.0` is minor-bumped by
  `feat(planner): run the fan-out as a job (pl-16)` (`a112cd4`, which edited
  eleven files under `tools/downloader/api/`). Filed as
  [repo-7](./repo-7-changelogs-are-attributed-by-path.md), including the half of
  it that is inferred rather than measured — no releasable-type commit on `main`
  has ever had _only_ documentation under a tool, so that exact case is
  unproven.
- **Nothing else states the two-branch rule.** `git grep -n unblocked`
  unfiltered, plus sweeps for `--show`, `blocked by`, `describeTicket` and
  `printTicket`. `CLAUDE.md:52` and `:200` and
  [docs/01-TICKETS.md](../01-TICKETS.md)`:240` describe `--show` as "its fields,
  its blockers, its path", which is unchanged; `01-TICKETS.md`'s `--ready`
  description uses the word and `--ready` is not changing;
  `01-TICKETS.md:88-97`'s dangling-id sentence stays true, verified by running
  the case rather than by reading it. `pl-26:142` cites
  `scripts/status.mjs:279` and a `.filter(...)` that repo-6 replaced with a
  loop — stale, left as written: it is a gate record of what a reviewer saw, and
  editing a review is a worse defect than a stale line inside one.

**Gates.** `npm run check` exit 0. `npx vitest run scripts` — 2 files, 75 tests
(66 before). Full `npm test` — 102 files, **1479 tests**, against a baseline I
measured in this worktree at `848af10` of 102 files / 1470 tests; the 9 new
tests are all in `scripts/test/status.test.ts`. `npm run format` run for the
`.md` files touched.

**Mutation-checked, control first.** `npx vitest run scripts` over the
unmutated tree exits **0**, stated because a control that fails on a clean tree
makes every mutation look dead. Seven mutations, each applied to a restored
copy, `touch`ed, run, and reverted; all seven red, and the control re-run at 0
afterwards: the closed branch removed (4 failed — this is `848af10`'s
behaviour), the closed line dropping its holding list (1), `dropped` handled but
`done` left in the old branches (2), `in-flight` treated as closed (2), the
`note` not carried (1), the closed branch falling through instead of returning
so `unblocked` prints under it (4), and the dangling ids dropped from `holding`
— repo-6's regression, still guarded (1). Separately, the new suite against
`origin/main`'s `scripts/status.mjs`: **4 tests fail**, one per closed-ticket
case.
