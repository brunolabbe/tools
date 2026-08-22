---
id: pl-26
tool: planner
title: Lift the SSRF guard to packages/core when a second tool actually fetches
kind: work-package
milestone: P3
status: ready
depends_on: [pl-24]
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

## Log
