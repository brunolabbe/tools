---
id: repo-3
tool: repo
title: Say that a closed ticket is closed, instead of reporting it unblocked
kind: fix
status: ready
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

_Not started._
