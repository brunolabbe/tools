---
id: pl-26
tool: planner
title: Lift the SSRF guard to packages/core when a second tool actually fetches
kind: work-package
milestone: P3
status: dropped
depends_on: [pl-24]
note: Deferred until the existence slice is filed — not refused
---

# pl-26 — One guard, lifted when the planner earns it

**Packages:** `packages/core`, `tools/downloader/api`, `tools/planner/api`.

## Read this before picking it up

**The travel-time slice does not earn this ticket, and
[pl-28](./pl-28-valhalla-adapter.md) is not its trigger.** The repo's rule is
that shared code moves to `packages/` on the second real _consumer_, not the
first guess, and [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) states the trigger
precisely: _the day the planner fetches a URL a search result gave it_. A
routing endpoint an operator configured is not that URL. It is infrastructure
this deployment chose, on a hostname this deployment wrote down, and running it
through a guard whose entire job is refusing addresses a stranger picked would
be the guard doing nothing while looking like it is doing something.

So the trigger is §5's item 3 — existence, which means search results, which
means URLs from outside — and that slice has no ticket yet, on purpose. This
file exists because the lift is the interesting part of that work and it is
worth having written down before the ticket that needs it is scoped; it is not
work to pull forward. If you are here because pl-28 is next, you are in the
wrong file.

**The frontmatter says `dropped`, and here that means deferred, not refused.**
The [ticket format](../../../../docs/01-TICKETS.md) has four statuses and none of
them means "written down early, waiting on a slice nobody has scoped"; `dropped`
is the only one that keeps this file and its argument while keeping it out of
`npm run status -- --ready`. The way back is exact: when the existence slice is
filed, set this ticket to `status: ready` with that ticket's id in `depends_on`.

## Why

The downloader's `api/src/ssrf.ts` (295 lines) and `api/src/guarded-fetch.ts`
(118) are the working implementation, with 231 lines of tests behind them and
five more suites leaning on them. They handle the things a second copy would get
wrong: IPv4-mapped and IPv4-compatible forms, DNS rebinding through a
multi-record answer, re-checking after every redirect, and an escape hatch for
an egress-proxy deployment that resolves nothing itself.

`00-ANALYSIS.md §5` says a specialist reading a search result is parsing hostile
text, and the repo-wide rule says **SSRF-check every URL a user influenced,
including after each redirect and including URLs that came back out of your own
code.** A model reply that hands us a link is exactly the case.

## Build

1. **Move, do not copy.** The repo rule names copy-paste specifically. Both
   files go to `packages/core`, and the downloader imports them from there.

2. **The codes are already core, and that is the good news.** The guard raises
   `BLOCKED_TARGET`, `INVALID_URL` and `UNREACHABLE`, all three from
   `CORE_ERROR_CODES`. The one entanglement is `ALLOWED_SCHEMES`, imported from
   `@downloader/contract` — decide whether the scheme allow-list is core's (the
   same everywhere: `http` and `https`) or an argument. Recommendation: an
   argument with a core default, because a tool that one day fetches something
   over a third scheme should not have to edit core to say so.

3. **The downloader's behaviour must not change.** Its `ssrf.test.ts` moves with
   the code; the five suites that import the guard indirectly stay where they
   are and stay green. If a single downloader test needs its expectation edited,
   the move went wrong.

4. **Record the decision the "Read this" section makes, in the code.** An
   operator-configured endpoint does not go through the guard; a URL from a
   user, a search result or a model reply always does. Without that sentence
   beside the guard, the next person wires the routing endpoint through it,
   discovers a private address is refused, and reaches for
   `allowPrivateAddresses` — which disables the check wholesale, for everything,
   including the URLs it exists for. `allowHosts` keeps its current doc comment;
   the answer is not to widen the escape hatch but to not use the guard where it
   does not apply.

5. **Both Dockerfiles list their workspaces by hand, twice.** Nothing moves
   between packages in this repo without that list changing, and
   [pl-17](./pl-17-dockerfile-workspace-scan.md)'s scan in
   `packages/core/test/image-closure.test.ts` is what will tell you which line
   is missing. Run `npm test -- --project packages` and believe it.

## Done when

- No SSRF or guarded-fetch source remains under `tools/downloader/api/src`, and
  nothing under `tools/planner` contains a second implementation.
- Every downloader suite that touched the guard passes unedited, save for the
  import path.
- A planner-side test proves a URL from a model reply is guarded before it is
  fetched, and that a redirect to a private address is refused mid-chain.
- The comment from step 4 exists, and a test asserts the routing endpoint path
  does not consult the guard — because a comment is not a check.
- `npm run check`, `npm test`, and the image-closure scan all pass.

## Review

### Gate 1 — 2026-08-23

**PASS.**

This gate is over the state correction, not over the lift. **The ticket's own
`Done when` lines are untouched and unproven** — no part of the lift was
implemented — so the table below is one row per thing the correction claimed,
each re-run by the reviewer rather than taken from the branch.

| Claim                                                                  | Verdict                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| pl-26 leaves `npm run status -- --ready`, and nothing else does        | verified — 1 line removed, 0 added                                 |
| No other view moved                                                    | verified — full `--json` differs by exactly 1 line                 |
| Every reference to pl-26 in the repo still reads true                  | verified — 9 citations found, 9 enumerated, 9 correct, 0 broken    |
| The links in and to the ticket resolve                                 | verified — 4 markdown links, 4 resolved, 0 anchors                 |
| `depends_on` on the unwritten existence slice is genuinely unavailable | verified — `readTickets` throws, and worse than the branch claimed |
| The repo is otherwise unchanged                                        | verified — `npm run check` exit 0, 1,366 tests pass                |

The reviewer's own correction to the branch's reasoning, worth keeping: a
`depends_on` naming a ticket that does not exist does not merely fail for that
ticket — `readTickets` throws before any view renders, so **every** invocation
exits 1 repo-wide (`--ready`, the default, `--json`, `--show`). The mechanism
argument in the Log is therefore stronger than it was written, not weaker.

Findings, all four, with what happened to each:

- **`note` absent from a dropped ticket's frontmatter** (low) — **fixed here.**
  `--show` is the one view where a dropped ticket is still visible, and it showed
  a bare `dropped`. An agent asking what became of the SSRF lift reads that,
  applies the documented meaning of `dropped` — considered and rejected — and
  reports the lift as abandoned without opening the file. That is this change's
  own reader, one step further out. The `note` field says deferred, not refused.
- **`--show` on a dropped ticket prints `unblocked`** (low) — **not fixed, and
  out of scope.** `describeTicket` reads `depends_on` only and never the
  ticket's own status, so it answers "is anything blocking it" for a ticket that
  is not pickable at all. **Pre-existing**: `--show pl-1` does the same thing on
  `origin/main`, untouched by this branch. Being surfaced separately; no ticket
  filed from here.
- **`tools/planner/agent/src/grounding.ts:48` promises pl-26 forward**
  (informational) — **no change.** The id leads to the file and the file answers
  the question, which is what a forward reference is for. The `note` above also
  serves that reader.
- **No `## Review` section on the ticket** (process) — **fixed by this section.**

## Log

**2026-08-23 — the frontmatter said `ready` and the first section said do not
pick this up. The frontmatter now says `dropped`.**

The prose was losing that argument every time it was had, because
`npm run status -- --ready` reads the frontmatter and nothing else: pl-26 was
listed as unblocked work beside dl-16 and pl-28, and whoever picked it up found
the "Read this before picking it up" section only after opening the file. A
ticket's frontmatter is the only place its state is recorded, so a body that
contradicts it is not a second opinion — it is a note nobody reaches in time.

`depends_on` would have been the honest mechanism, and it is unavailable: the
blocker is real and named — §5's third item, existence — but that slice
deliberately has no ticket, and `scripts/status.mjs` refuses a `depends_on`
naming a ticket that does not exist. Of the four statuses the format defines,
`dropped` is the only one that keeps this file and its argument while taking it
out of the ready list, and it is the one whose documented purpose is a file kept
so the next person to have the idea finds the reasoning. It is doing duty for
"deferred", which the vocabulary does not have — pl-1 is the other `dropped`
ticket and it was genuinely refused, so the two now read alike in
`npm run status` and only the prose separates them. That is the cost, it is
recorded here, and the section above says the way back in one line.

Nothing else changed, and no part of the lift was implemented.
