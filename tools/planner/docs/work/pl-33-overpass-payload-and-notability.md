---
id: pl-33
tool: planner
title: Capture a real Overpass payload, and wire up notability
kind: fix
milestone: P3
status: ready
depends_on: [pl-29]
---

# pl-33 — The two halves of pl-29 that could not be built here

## Why

[pl-29](./pl-29-detours-along-a-leg.md) built the discovery seam, the Overpass
adapter's query and parser, the geometric filter, the two-pass grounding state,
and the `coverage` taxonomy member — everything that does not depend on a
network this environment could reach. Two things do, and neither could be
built there, for the same reason pl-30 exists beside pl-28: this environment
has no route to `overpass-api.de`, `en.wikipedia.org` or a Wikivoyage dump, and
no runnable Overpass-compatible engine was found on npm within pl-29's
time-boxed search.

**The first is a captured payload.** `nearby`'s tests in
`api/test/grounding-valhalla.test.ts` run against a hand-composed body,
disclosed as such in that file's own header — the same shape `pl-28`'s
`locate` was in before `pl-30`. `overpassQuery` (exported from `valhalla.ts`)
already builds the exact request; what is missing is a real reply to parse.

**The second is `Find.notability`.** The type exists and is tested at the
rendering layer (`agent/test/prompt.test.ts`), but no adapter populates it:
Wikipedia's geosearch API and Wikivoyage's dumps are both unreachable from
here, so `ValhallaGroundingProvider.nearby` always returns `notability: []`.
§5's amendment names both as free, unkeyed signals worth attaching — this
ticket is what actually attaches them.

## Build

1. **Capture `nearby`'s payload.** pl-29's Log carries the exact copy-pasteable
   capture block — the query text (`overpassQuery`, unchanged, so the capture
   uses the real request) and the curl invocation. Run it against a reachable
   Overpass instance (the public one, respecting its usage policy — one
   request, an identifying purpose in a comment — or a self-hosted instance
   over a small regional extract) and check the reply in under
   `api/src/grounding/fixture-data.ts`'s sibling in this file's own package,
   `api/test/fixtures/overpass-nearby.json`. Rewrite
   `grounding-valhalla.test.ts`'s `nearby` tests to parse it, keeping the
   synthetic hostile-name and prototype-key tests exactly as they are — those
   are deliberately hand-composed and pl-29's header says why.
2. **Wikipedia geosearch.** `GET https://{lang}.wikipedia.org/w/api.php` with
   `list=geosearch`, a coordinate and a radius, unkeyed and free. Which
   language to ask is not obvious from a `Find` alone — decide it here, and
   record the decision rather than guessing silently. One call per find is
   the naive shape; consider whether a single call over the whole corridor's
   bounding box (geosearch also accepts a bounding box) is cheaper against
   `MAX_GROUNDING_CALLS`, the same argument pl-29's detour-cost matrix already
   makes for one call over many.
3. **Wikivoyage.** Its own API mirrors Wikipedia's; whether it is worth a
   second call per find or can share the first is this ticket's to decide,
   with the reasoning written down.
4. **Both attach as `Source[]` on `Find.notability`**, per the type's existing
   contract — url, title, fetchedAt, nothing fused into a score.

## Done when

- `nearby`'s core parsing tests run against a payload captured from a real
  Overpass instance, with the same disclosure pl-28's `travel` tests give
  theirs.
- A find near a place with a Wikipedia article carries a `notability` entry
  for it, proven against a captured reply.
- `npm run check` and `npm test -- --project planner` pass.

## Log

**2026-08-30 — this Build cannot be started from this environment.** Measured
from a devcontainer session on the `repo-11` branch, which was already editing
planner ticket logs. Nothing here is a finding about the ticket: the Build is
sound and unchanged. It is a finding about where the Build can be run, written
down so the next agent does not spend the same five commands rediscovering it.

Every one of the four Build steps needs one of three hosts. All three are
unreachable, and two control probes show the failure is not general:

| probe                                 | result                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| `https://overpass-api.de/api/status`  | `000`, curl exit 28, `time_connect=0.000000`, 8 s ceiling hit |
| `https://en.wikipedia.org/w/api.php`  | `000`, curl exit 28                                           |
| `https://en.wikivoyage.org/w/api.php` | `000`, curl exit 28                                           |
| `https://api.github.com`              | **`200`**, `time_connect=0.027844`                            |
| `https://registry.npmjs.org`          | **`200`**                                                     |

**The shape is an allowlist — not an outage, and not something misconfigured
locally.** That conclusion is the part worth carrying forward; the individual
failures are a moment in time and will need re-running.

- **DNS resolves.** `overpass-api.de` → `65.109.112.52` / `162.55.144.139`;
  `en.wikipedia.org` and `en.wikivoyage.org` → `208.80.154.224`. Nothing is
  failing to look up.
- **Egress works.** Two hosts answer in tens of milliseconds.
- **No proxy is configured.** No `*_proxy` variables in the environment, and
  `npm config get proxy` and `https-proxy` are both `null`. There is nothing
  local to fix.
- **The blocked hosts are dropped, not refused.** `time_connect` is `0.000000`
  on every one: the TCP connection never completes and the call hangs to the
  timeout. A refusal would return at once with curl exit 7.
- **`https://example.com` fails identically** — `000`, exit 28,
  `time_connect=0.000000`. This is the probe that settles the shape. If only the
  three hosts this ticket needs were dark, that would point at something aimed
  at them, or at three simultaneous outages. A neutral host failing the same way
  means the default is deny and a small set of hosts is permitted.

Both alternatives the Build itself offers are closed, so this is not a matter of
finding another route to the same data:

- Step 1's "a self-hosted instance over a small regional extract" —
  `https://download.geofabrik.de/` → `000`, exit 28. There is no extract to
  import.
- Step 3's Wikivoyage dumps — `https://dumps.wikimedia.org/` → `000`, exit 28.

One door is open and is deliberately _not_ claimed as a way through:
`registry.npmjs.org` answers, so an npm package shipping a recorded Overpass
reply could be fetched. [pl-28](./pl-28-valhalla-adapter.md) searched that avenue
for a Nominatim payload and rejected what it found on provenance grounds —
laundering someone else's hand-written payload through their tarball fails the
fixture standard rather than meeting it — and this ticket's "Done when" points
back at pl-28's disclosure for its own capture, so the same objection applies.
Named as unexplored, not as an option.

**`status` stays `ready`, on purpose.** `ready` means dependencies unblocked, and
an environment limit is not a dependency. Putting one session's network into
frontmatter that every tool reads would make a local fact look like a property of
the ticket, and `npm run status` would then be wrong for whoever _can_ reach
these hosts. The board is right; it simply cannot tell you where to stand, and
this is the place that can.

What this does **not** establish, and nobody should infer it from the above:
whether the allowlist is per-session, per-image or per-organisation, and whether
it can be widened by asking. No one was asked. If you are reading this somewhere
with a route to `overpass-api.de`, disregard all of it and run the capture block
in [pl-29](./pl-29-detours-along-a-leg.md)'s Log, which is still copy-pasteable.
