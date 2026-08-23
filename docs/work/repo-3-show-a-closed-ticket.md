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

## Gates

### Gate 1 — 2026-08-23 · **CONCERNS**

Reviewed at `b54f2e8`. The fix itself was found correct and could not be broken:
the reviewer enumerated the status taxonomy rather than sampling it — `STATUSES`
at `scripts/status.mjs:45` is closed at four and `validate` throws by file on
anything else — and confirmed the `!OPEN.has(...)` branch is therefore total,
across nine invocations covering all four statuses plus both `note` variants and
a real blocked case. All seven modes hold for the closed case on an independent
tree. The baseline numbers, the four-tests-fail-against-`origin/main` claim and
five of six mutations were reproduced. The verdict is CONCERNS on one surviving
mutation and two wrong facts in ticket prose.

**Citations re-resolved against the tree this section is committed with** — one
commit past `b54f2e8`, which is what the reviewer read — and checked
programmatically: every span below was re-read and asserted to still contain the
string it is cited for. The gate's own citations into `scripts/test/status.test.ts`
moved when finding 1 was fixed and are the corrected values here, not the
reviewer's. Two are deliberately left as the reviewer wrote them —
`docs/work/repo-3-…:289-290` and `:299-300` in findings 2 and 3 — because they
are the stale-before values and pointing at what was wrong is their whole
purpose. The reviewer's file is posted unedited on the pull request, so the
delta is visible rather than folded in.

| #   | Severity                  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | med                       | **A mutation survives on the repo-6 seam.** `holding` mixes real blockers and dangling ids, but the closed line was pinned only with a real blocker. Mutating the closed branch alone to read `blockers` instead of `holding` leaves `npx vitest run scripts` at **exit 0, 75 passed**, while `--show` on a `done` ticket whose only dependency is `repo-404` drops the id from stdout — silently falsifying `docs/01-TICKETS.md:88-92`, the promise repo-6 wrote its handover to protect. | **Fixed.** Reproduced first, exactly: mutation applied, suite green at 75/75, and `--show` on a `done` ticket depending on `repo-404` printed `done — nothing to pick up` with the id gone. A row added at `scripts/test/status.test.ts:553-570` — a `done` ticket with `depends_on: [pl-99]`, asserting the closing line is `  done — nothing to pick up; depends_on still lists pl-99 (not a ticket)` and that the stderr warning still names it. The same mutation now fails 1 test. The Log's "measured on a throwaway tree" is the tell the reviewer read it as: measured is not pinned. |
| 2   | med-low                   | **`repo-7` states a measurement that is wrong by four, in the section headed "measured, not predicted".** `a112cd4` edited **seven** files under `tools/downloader/api/`, not eleven, and seven is also its total under `tools/downloader/`.                                                                                                                                                                                                                                               | **Fixed in both places** — `docs/work/repo-7-…:48-51` and this file's Log. Re-derived here: `git diff-tree --no-commit-id --name-only -r a112cd4 -- tools/downloader/api \| wc -l` → **7**, the same seven listed by the reviewer. My count came from a `git show --stat \| head -20` that also carried `packages/core` and planner paths; I read a screenful and reported it as a count. The mechanism the number supports is unaffected and was independently confirmed.                                                                                                                    |
| 3   | med-low                   | **The Log cites a word in a file that does not contain it, under a bullet headed "Nothing in it was wrong".** `docs/01-TICKETS.md` has no occurrence of `unblocked`; the word is at `CLAUDE.md:199`.                                                                                                                                                                                                                                                                                       | **Fixed, and the bullet above it rewritten.** `grep -n unblocked docs/01-TICKETS.md` exits 1 here too. The claim came from the ticket's own Build step 4 and I repeated it rather than running the grep that step asked for — a three-link laundering chain, and the bullet now says so instead of saying nothing was wrong. The conclusion is unchanged and was independently re-swept: nothing outside repo-3, repo-6 and pl-26's gate record states the two-branch rule.                                                                                                                   |
| 4   | observation, not a defect | **`repo-7`'s Why asserts its inferred half flatly**, though Build step 2 flags exactly that as unproven and Done-when gates the documentation on it. The reviewer explicitly declined to call it overclaiming and suggested softening as an improvement.                                                                                                                                                                                                                                   | **Changed anyway, two sentences.** The generalisation now names itself as the inference and points at step 2, and the pl-26 consequence is phrased "on the mechanism above … which is why step 2 asks for it to be run rather than assumed". Cheap, and it removes the one reading under which a next agent skips step 2.                                                                                                                                                                                                                                                                     |
| 5   | pre-existing, low         | `scripts/test/status.test.ts:450-457` runs `--tool downloader --ready` against the real tickets and asserts `stdout.length > 0`. It goes red the day every downloader ticket closes — the same species as the assertion this branch rewrote. Flagged as pre-existing; not asked for.                                                                                                                                                                                                       | **No change, and out of this branch's scope.** It predates repo-3 and fixing it would widen a diff the gate is otherwise closed over. It has no ticket: `repo-7` was the only id allocated to this builder and it is spent on the changelog-attribution defect. Recorded here so the next reader finds a named gap rather than re-deriving it, and reported upward for an id.                                                                                                                                                                                                                 |

**Acceptance**

| #   | `Done when` line                                                                                                | Verdict      | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `--show pl-1` names the ticket as closed and `unblocked` does not appear                                        | **proven**   | `scripts/test/status.test.ts:494-503`, with the note variant at `:505-514`. **verified** as a command on the real tickets by both builder and reviewer: `dropped — nothing to pick up`, and pl-26's carries its note.                                                                                                                                                                                                                  |
| 2   | the same of a `done` ticket — `pl-25` and `repo-2`                                                              | **proven**   | `scripts/test/status.test.ts:516-529`. **verified** on `pl-25`, `repo-2`, `dl-1`, `repo-3` and `repo-6` by the reviewer, all `done — nothing to pick up`.                                                                                                                                                                                                                                                                              |
| 3   | `--show dl-16` still prints `unblocked`, and a ticket blocked by an open dependency still prints `blocked by …` | **proven**   | `scripts/test/status.test.ts:571-586`, four parameterized rows over `ready` and `in-flight` × unblocked and blocked. **verified** on `dl-16`, `pl-2` and `pl-29`.                                                                                                                                                                                                                                                                      |
| 4   | a test per bullet in Build step 3, each failing against `origin/main`'s `printTicket`                           | **proven**   | Three of the four fail against `848af10`: `:494`, `:516`, `:532` (and `:505`) — **4 failed / 71 passed**, reproduced by the reviewer. Bullet 4 is a preservation criterion and cannot fail against `origin/main` by construction; the reviewer looked for a stronger proof and found none. It is proven by mutation instead — `status === "dropped"` kills its two `done` rows, `!== "ready"` kills both `in-flight` rows, no overlap. |
| 5   | `npm run check` and `npm test` green                                                                            | **verified** | Both re-run by the reviewer in its own worktree at `b54f2e8` (`check` exit 0, 102 files / 1479 tests, format clean) and again here after this round — see the Log.                                                                                                                                                                                                                                                                     |

**What the gate did not cover**, recorded because it is the half a green report
hides: it did not re-review repo-6, only the seam where this change meets it; it
did not re-derive the original defect, accepting the reproduction as given; e2e,
container-build and Windows gates are unrun and this change touches none of
them; and `repo-7`'s central inference — that a releasable-type commit whose
only path under `tools/<name>/` is a `.md` file releases that tool — is still
**unproven**, by that ticket's own admission. `release-please --dry-run` was not
run; it is repo-7's Build step 2.

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

- **One thing in it was wrong, and it is an inventory rather than a citation.**
  Build step 4 says the word `unblocked` "appears in `docs/01-TICKETS.md`'s
  `--ready` description". It does not appear in that file at all —
  `grep -n unblocked docs/01-TICKETS.md` exits 1 — and the occurrence it means
  is `CLAUDE.md:199`. I repeated the claim from the brief instead of running the
  grep the same step told me to run, and then filed it under a bullet headed
  "nothing was wrong". The step's _substance_ was right: `--ready` is not
  changing and its occurrences of the word are all about it. Everything else in
  the brief held — every `file:line` in the refreshed Build resolved
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
  seven files under `tools/downloader/api/`). Filed as
  [repo-7](./repo-7-changelogs-are-attributed-by-path.md), including the half of
  it that is inferred rather than measured — no releasable-type commit on `main`
  has ever had _only_ documentation under a tool, so that exact case is
  unproven.
- **Nothing else states the two-branch rule.** `git grep -n unblocked`
  unfiltered, plus sweeps for `--show`, `blocked by`, `describeTicket` and
  `printTicket`. `CLAUDE.md:52` and `:200` and
  [docs/01-TICKETS.md](../01-TICKETS.md)`:240` describe `--show` as "its fields,
  its blockers, its path", which is unchanged; the word itself is at
  `CLAUDE.md:199`, in the `--ready` description, and `--ready` is not changing
  (`docs/01-TICKETS.md` does not contain the word — see the corrected bullet
  above);
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

### 2026-08-23 — gate 1, CONCERNS, addressed

One finding was about the code's tests and two were about facts I wrote down
without checking.

**The surviving mutation is the finding worth the gate.** I mutated `holding`
wholesale and watched it die, and concluded the seam was pinned. It was not: the
death came from repo-6's own end-to-end test, which drives an **open** ticket. My
closed line was pinned only with a real blocker, so mutating the closed branch
_alone_ to read `blockers` instead of `holding` left the suite green at 75/75
while `--show` on a closed ticket with a dangling id stopped naming it.
Reproduced before fixing: mutation applied, `npx vitest run scripts` exit 0, and
`--show repo-99` on a scratch tree printing `done — nothing to pick up` with
`repo-404` gone. The general lesson is narrower than "test the seam": **a
mutation that dies tells you a test exists, not that yours does** — and mine was
one list-shaped expression covering two behaviours, where only the composite was
mutated. One row added at `scripts/test/status.test.ts:553-570`; the mutation now
takes it with it.

**Both wrong facts were wrong in the same way — a screenful read as a
measurement.** "Eleven files" came from a `git show --stat | head -20` whose
first twenty lines spanned `packages/core`, the downloader and the planner; the
answer to the question I was actually asking is
`git diff-tree --no-commit-id --name-only -r a112cd4 -- tools/downloader/api | wc -l`,
which is 7. And `docs/01-TICKETS.md` does not contain the word `unblocked` at
all — that came from the brief's Build step 4, which I repeated instead of
running the grep the same step told me to run, and then filed under a bullet
saying nothing in the brief was wrong. Both corrected, in both places each
appears. The bullet now records that the brief _was_ wrong on that point, which
is the part a next reader needs.

**repo-7's Why softened** to match its own Build step 2, which the gate raised
as an observation rather than a defect. Two sentences: the generalisation names
itself as the inference, and the pl-26 consequence is conditioned on the
mechanism rather than asserted.

**One finding is recorded and not fixed.** `scripts/test/status.test.ts:450-457`
asserts `stdout.length > 0` against the real downloader tickets and goes red the
day the last one closes. It predates this branch and has no ticket, because
`repo-7` was the only id allocated here.

Gates re-run after this round: `npm run check` exit 0; `npx vitest run scripts`
2 files / **76 tests**; `npm test` 102 files / **1480 tests**;
`node scripts/status.mjs --json > /dev/null` exit 0; `npm run format` for the
`.md` files touched. Mutation control re-run at exit 0 before and after, and the
previously surviving mutation now fails 1 test. The only source file changed in
this round is `scripts/test/status.test.ts`; `scripts/status.mjs` is
byte-identical to `b54f2e8`.
