---
id: pl-38
tool: planner
title: Behind a proxy the planner's rate limiter buckets every client together
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# pl-38 — One bucket for the whole hostname

## Why

`POST /api/plans` is rate limited — `rateLimitRunsPerMinute`, default 5,
enforced by an `onRequest` hook. The limiter is per-client by construction:
`clientKey(request.ip)` in `tools/planner/api/src/rate-limit.ts` is
`@webtools/core`'s, including its `/64` rule for IPv6.

**`request.ip` is not the client behind a reverse proxy, and nothing here makes
it one.** `tools/planner/api/src/server.ts:243` "const server = Fastify({" never passes
`trustProxy`. The downloader's equivalent,
`tools/downloader/api/src/server.ts:506` "trustProxy: config.trustProxy", does, and `ApiConfig` here has no such field to pass.

So on the deployed shape — the planner behind `cloudflared`, which is the only
shape `compose.planner.prod.yaml` describes — every request arrives from one
compose-network address. `clientKey` maps them all to the same key, and the
whole hostname shares a single five-runs-per-minute allowance.

The failure is not that the limit is too tight. It is that the limit means
something other than what its name and its default say: 5 is a sensible number
per person and an unusably small one for everybody at once, and nothing in the
logs distinguishes "this visitor is being noisy" from "somebody else already
spent the minute". The downloader hit exactly this and
[02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md) has carried the warning
since — "safe, but one busy user throttles everyone". Here there is no setting
that resolves it.

It is currently masked, and that is the trap: an Access allowlist with one email
on it means one client, and one client cannot notice a shared bucket. The moment
that policy widens — or `MODEL_PROVIDER` stops being `scripted` and each run
costs real money — it stops being masked.

## Build

1. **`trustProxy` in `ApiConfig`**, mirroring the downloader's. Read the shape
   from [`tools/downloader/api/src/config.ts`](../../../downloader/api/src/config.ts)
   rather than inventing a second one: it takes a CIDR or a list, **not a
   boolean**, and the reason is in `compose.prod.yaml`'s own comment — `true`
   lets any client name its own bucket with an `X-Forwarded-For` header, which
   makes every limit decorative. That is a strictly worse state than the shared
   bucket this ticket is fixing, so a boolean is not an acceptable shortcut.
2. **Pass it to Fastify**: `tools/planner/api/src/server.ts:243` "Fastify({".
3. **A `TRUST_PROXY` line in `compose.planner.prod.yaml`**, naming the `edge`
   subnet — `172.30.42.0/24`, which `compose.prod.yaml` pins for exactly this
   reason. Delete the comment there that currently explains why there is no such
   line, and the corresponding paragraph in `02-DEPLOYMENT.md`'s
   `## Adding the second tool`.
4. **A test that fails first.** The bug is invisible to any test that does not
   put two clients behind one proxy hop: assert that two requests carrying
   different `X-Forwarded-For` values, from a trusted proxy address, get
   _separate_ buckets — and that the same two from an untrusted address do not.
   The second half is the one that catches a `trustProxy: true` regression.

## Done when

- Two clients behind the proxy get independent allowances, proved by a test that
  fails against `main`.
- A client whose `X-Forwarded-For` arrives from outside the trusted CIDR cannot
  choose its own bucket.
- `02-DEPLOYMENT.md` no longer tells an operator that this cannot be fixed.

## Traps

**`trustProxy: true` is the obvious fix and it is worse than the bug.** See step

1. The downloader's config comment is the argument in full.

**The subnet is one setting written three times, not two.** `TRUST_PROXY` names
the CIDR that `compose.prod.yaml`'s `edge` network pins, and it is named again
in `compose.planner.prod.yaml` once this ticket lands — a mismatch in any of
the three silently reverts that tool's limit to sharing one bucket, which is
this ticket's own bug, reintroduced somewhere nothing is looking. (Written as
"twice" until the gate caught it; see the Review section.)

## Review

**Gate: PASS** — 2026-09-08 · `a5e31c7...bdfc10b` · built by Sonnet, gated by
Opus, in its own worktree. Two rounds on the same branch — CONCERNS at
`a457ce0`, PASS at `bdfc10b` after three repairs — recorded as one section
rather than two, the way `pl-2`'s Review folds a found-and-fixed low into a
single PASS. **Disclosure, as the owner requires:** this section is
transcribed by the builder from the reviewer's own reports, across both
rounds. Nothing in the reviewer's findings or dispositions was altered. What
was changed in transcription: citations that named `a457ce0` evidence text no
longer in the tree (the med's original comment, which was the defect) are
repointed to the repaired line at `bdfc10b`, per the reviewer's own
instruction, and the finding is described as raised-then-repaired rather than
carrying two conflicting citations. Nothing was dropped from either report.

| Done when                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two clients behind the proxy get independent allowances, proved by a test that fails against `main`. | **proven** — `tools/planner/api/test/runs.test.ts:452` "expect(thirdA.statusCode).toBe(429)" (client A exhausts its own bucket) and `tools/planner/api/test/runs.test.ts:458` "expect(firstB.statusCode).toBe(202)" (client B unaffected). Fails against `main`: reviewer reproduced independently by stashing `config.ts`/`server.ts` back to `a5e31c7` — failed exactly at the second assertion, `expected 429 to be 202`. |
| A client whose `X-Forwarded-For` arrives from outside the trusted CIDR cannot choose its own bucket. | **proven** — `tools/planner/api/test/runs.test.ts:497` "all three counted against the one real address" sits directly above the deciding assertion. Not vacuous: reviewer reproduced by setting that test's harness to `trustProxy: true` — the "obvious fix" the Traps section warns against — which failed it, `expected 429 to be 202`.                                                                                   |
| `02-DEPLOYMENT.md` no longer tells an operator that this cannot be fixed.                            | **verified** — `docs/02-DEPLOYMENT.md:601` "Rate limiting is per-client the same way the downloader" replaces the old "no `TRUST_PROXY` to make it so" paragraph. Reviewer checked the arithmetic ("Three differences" now matches three bullets) and confirmed, from the merged compose config, that both `TRUST_PROXY` lines and the `edge` subnet are the identical string.                                               |

Findings — 10 returned in the first round's defect hunt, 8 carried into this
record, 2 dropped before write-up (reviewer's own count, not re-derived here):

- **med** · `compose.prod.yaml:90` "change it here" — raised at `a457ce0`,
  repaired at `bdfc10b`. The file's own comment said "one setting written
  twice" (the `edge` subnet plus the downloader's `TRUST_PROXY`), and this
  ticket's `compose.planner.prod.yaml` addition made it three without
  updating the count. An operator resolving a subnet collision on a live host
  by following that comment literally would fix two of three and silently
  reintroduce this exact ticket's bug on the planner side — this ticket's own
  Traps section, reproducing itself. Repaired: both compose files now say
  three and cross-reference each other
  (`compose.planner.prod.yaml:79` "named a third time"); the repair folds in
  the malformed-vs-valid distinction from the declined low below, landed
  where an operator resolving a collision will actually be standing.
  Reviewer re-verified independently against `bdfc10b`.
- **low, repaired** · this ticket's own citation had drifted: line 498 moved
  to `tools/downloader/api/src/server.ts:506` "trustProxy: config.trustProxy"
  (pre-existing staleness on `main`, not introduced by this branch — flagged
  by the reviewer regardless because the file was open). Repointed; `node
scripts/citations.mjs` on this record now reports 0 moved.
- **low** · `tools/planner/docs/01-ARCHITECTURE.md:228` "CIDR the above" —
  repaired. The Configuration table omitted `TRUST_PROXY` among 13 of the
  tool's 22 env vars, not a rule violation on its own (several others were
  already absent, `CORS_ORIGINS` included) but a judgement call the reviewer
  flagged as the first place they would look. Added, beside
  `RATE_LIMIT_RUNS_PER_MINUTE`.
- **low, declined** · `02-DEPLOYMENT.md:221` "Rate limits silently" —
  undersells the malformed-value case: reviewer measured that a malformed
  `TRUST_PROXY` actually refuses the boot (`TypeError: invalid IP address:
<x>`) rather than failing silently, only a valid-but-wrong value is silent.
  Pre-existing, out of this ticket's diff; reviewer offered it as optional
  ("decline freely") and the builder accepted the decline.
- **low, escalated then repaired** ·
  `pl-2-container-image.md:223` "rate-limiting" — `pl-2`'s Traps section
  still stated "No rate limiting and no `TRUST_PROXY`. `ApiConfig` has
  neither" as fact, both
  halves false since pl-16 and this ticket respectively. Raised as
  not-actionable-from-this-branch because `pl-2` was checked out live in
  another worktree; the orchestrator confirmed that session had released it,
  and the correction landed in this branch, cited above.
- **fold-in call, escalated, resolved by the orchestrator** · the lifted
  `trustProxy()` parser is byte-for-byte identical to the downloader's (`diff`
  exit 0, reviewer's measurement) — the repo's own stated second-real-consumer
  trigger for moving code to `packages/`. Put to the owner as leave-and-file
  versus lift-now-in-a-separate-PR, both builder and reviewer recommending
  leave-and-file; the owner took the recommendation. Filed as
  [repo-40](../../../docs/work/repo-40-trust-proxy-is-a-second-consumer-with-nowhere-to-land.md)
  — not `repo-39`, already spoken for on a pushed-but-unmerged sibling branch
  invisible to `next-id.mjs`.
- **informational, explicitly unverified, no action requested** · trusting the
  whole `/24` trusts every container on the `edge` network, including a
  request reaching the planner through its published loopback port — the
  reviewer's reasoning, not measured (no docker daemon in either worktree).
  Identical to the downloader's already-shipped posture; recorded so it is not
  discovered later as a surprise.
- **informational, explicitly unverified, from a third session, not settled
  anywhere on this branch** · that session reported, unconfirmed, that its
  user's actual Cloudflare tunnel may route to `host.docker.internal:8080`
  rather than to `downloader:8080` on the `edge` network, in which case the
  downloader's own `TRUST_PROXY` would never match the real hop and its
  limiter would already be single-bucket in production — the same failure
  this ticket fixes for the planner. Diagnostics were still running when
  reported; raised to the owner separately, not treated as true here.
- **dropped** · the `rate limited` log line now carries a visitor IP rather
  than the tunnel's address — not a redaction violation (`redactHeaders` /
  `redactUrl` are about credentials in headers and URLs; an IP is neither),
  and matches the downloader's already-shipped behaviour.
- **dropped** · `TRUST_PROXY=2` (a hop count) is not supported. Fastify only
  honours a hop count when the config value's _type_ is `number`, and an env
  var always arrives as a string, so it refuses the boot loudly
  (`invalid IP address: 2`) rather than silently misbehaving. Matches the
  downloader, and nothing documents hop counts as available here.

NFR — security: the med above is the only attack-relevant finding, and its
repair narrows nothing that was not already narrow: one `Fastify(` call in the
tool, one reader of `request.ip` (`rate-limit.ts`), confirmed by the reviewer
with `grep`. reliability: n/a beyond the build itself — every change after the
first gate round is comments, markdown and one table row. performance: n/a.

## Log

**2026-09-08 — filed from the pl-2 gate.** The reviewer caught
`compose.planner.prod.yaml` and `02-DEPLOYMENT.md` both claiming the planner had
no rate limiter at all. It has one; what it has not got is a way to know who the
client is. Both documents were corrected in that branch to say so and to point
here. Not started.

**2026-09-08 — built.** Mirrored the downloader's `trustProxy` exactly (Build
step 1): a `boolean | string` in `ApiConfig`, defaulting `false`, parsed by a
`trustProxy()` function copied from `tools/downloader/api/src/config.ts` rather
than shared through `packages/` — the ticket asked for the same shape, not an
extraction, and a tool never imports another tool's code. Passed straight to
`Fastify({ trustProxy: config.trustProxy })` in `server.ts`, same as the
downloader.

`compose.planner.prod.yaml` now sets `TRUST_PROXY: "172.30.42.0/24"` — the same
`edge` subnet the downloader's line names, since both tools share the one
tunnel and the one compose network — and the comment block explaining why there
was no such line is gone. `docs/02-DEPLOYMENT.md`'s `## Adding the second tool`
no longer counts the missing trust field as one of the differences from the
downloader's Access application; that paragraph became a short note that rate
limiting works the same way now, with the historical context (no field existed
before pl-38) kept for whoever reads this next.

Added two tests to `tools/planner/api/test/runs.test.ts`, in a new `"behind a
proxy (pl-38)"` describe block, both driven through `server.inject()` with
`remoteAddress` and `X-Forwarded-For` rather than a real socket:

- `"two clients get independent allowances"` — two clients behind the same
  trusted proxy hop, distinguished only by `X-Forwarded-For`, each get their own
  two-run bucket. Confirmed failing against unmodified `config.ts`/`server.ts`
  (client B's requests come back 429, sharing client A's bucket at the proxy's
  own address) — restored the fix and confirmed green.
- `"a client outside the trusted CIDR cannot choose its own bucket"` — a request
  from outside the trusted CIDR gets a fresh claimed `X-Forwarded-For` on every
  call and is still refused on the third, because the header is ignored when the
  hop is untrusted. This one already passed against unmodified code (with no
  `trustProxy` at all, Fastify always uses the raw socket address, which is what
  this test is checking for). To confirm it actually catches the ticket's named
  trap rather than passing by accident, temporarily set its harness to
  `trustProxy: true` — the "obvious fix" the Traps section warns against — and
  reran: it failed (third request came back 202, the attacker successfully
  minted a fresh bucket via the header). Reverted before committing. Both
  temporary edits and reversions were run, not merely reasoned about.

Also added one test to `tools/planner/api/test/config.test.ts`, alongside the
rest of that file's one-var-per-test pattern: `TRUST_PROXY` unset stays `false`,
`"true"`/`"false"` parse as booleans, and a CIDR (`172.30.42.0/24`) passes
through as a string rather than being coerced — the case that matters, since a
boolean-only parser would be the `trustProxy: true` trap by construction.

Gates run: `npm run check` (lint, `oxfmt --check`, `tsc --build`) — clean, only
pre-existing `no-await-in-loop` warnings elsewhere in the tree.
`npx vitest run tools/planner/api/test/config.test.ts tools/planner/api/test/runs.test.ts`
— 35/35, ~1.3–1.9 s. `npm test -- --project planner` — 848/848 across 53 files,
~5 s. No shared config under `packages/` or `vitest.config.ts` moved, so the
repo-wide `npm test` was not run.

**Fold-in considered and not taken:** the `trustProxy()` parser is now
byte-for-byte duplicated between the downloader's and the planner's
`config.ts` — a second real consumer, which is normally this repo's signal to
lift something into `packages/`. Left alone here because the ticket's Build
step 1 explicitly said to mirror the shape rather than invent a second one, and
`loadApiConfig` in each tool is otherwise not a shared surface — extracting one
six-line function while leaving the two config-loading functions that call it
entirely separate did not look like it paid for the seam it would need
(what return type, what env-var name convention, whether a future third tool's
default should differ). Worth a look if a third tool needs the same field.

**2026-09-08 — gate: CONCERNS, one med addressed, one low declined, two low
fixed.** `a8349ad3e884bee1e` reviewed `a5e31c7...a457ce0`, reproduced both
control experiments independently (fix stashed → the new tests fail exactly as
this Log claims; `trustProxy: true` in the untrusted-CIDR test → it fails
exactly as designed to), and verified the CIDR mechanics against the installed
Fastify/`proxy-addr` directly rather than by reading. Full findings: 1 med, 4
low, 2 dropped, 1 informational-only.

Reproduced and fixed:

- **med, `compose.prod.yaml:90`** — its own comment said "one setting written
  twice" (the subnet plus the downloader's `TRUST_PROXY`); this branch made it
  a third, in `compose.planner.prod.yaml`, without updating the count. An
  operator resolving a subnet collision by following that comment literally
  would fix the first two and miss the third, silently reintroducing this
  ticket's own bug on the planner side. Fixed: both compose files' comments
  now say three, and `compose.planner.prod.yaml`'s `TRUST_PROXY` line points
  back at `compose.prod.yaml`'s, closing the one-directional cross-reference
  the gate also named.
- **low, ticket citation** — `tools/downloader/api/src/server.ts:498` had moved
  to `:506` (pre-existing staleness on `main`, not introduced by this branch).
  Repointed; `node scripts/citations.mjs tools/planner/docs/work/pl-38-...md`
  now reports `3 verified, 0 moved`, exit 0.
- **low, `01-ARCHITECTURE.md` Configuration table** — added a `TRUST_PROXY` row
  beside `RATE_LIMIT_RUNS_PER_MINUTE`.

Declined: **low, `docs/02-DEPLOYMENT.md:221`** ("Rate limits silently stop
working if `TRUST_PROXY` is wrong" undersells the malformed-value case, which
actually refuses the boot). Pre-existing, out of this ticket's diff, and the
gate offered it as optional ("decline freely"). A malformed `TRUST_PROXY`
failing loudly is true and is not this ticket's own claim to fix.

Not mine to act on: **low, `pl-2`'s Traps section** still states "no rate
limiting and no `TRUST_PROXY`" as fact, and both halves are now false. `pl-2`
is a live, in-flight ticket held by another session
(`/workspaces/tools/.claude/worktrees/pl-2-planner-compose-service`) — editing
its brief from here risks colliding with that session's own work. The gate
already escalated this to the orchestrator as an open decision rather than
telling me to change it; agreed with that handling.

Agreed with the gate's judgment on the fold-in call (leave the duplicated
`trustProxy()` parser alone on this branch; the orchestrator decides whether to
lift it later) and on the two dropped findings (the log line now carrying a
visitor IP is not a redaction violation; `TRUST_PROXY=2` refusing the boot is
correct, matches the downloader, and nothing documents hop counts as
available). No action taken on either.

Re-gated after the three fixes: `npm run check` — exit 0, same pre-existing
`no-await-in-loop` warnings, none on a changed line. `npm test -- --project
planner` — 848/848, unchanged from before these fixes (none of the three
touched test-covered code). `npm run format` — no drift.

**2026-09-08 — gate PASS at `bdfc10b`, and the orchestrator's answers to the
two open decisions.** Reviewer re-verified all three repairs independently
against `bdfc10b` (re-ran the grep, `citations.mjs`, `npm run check` and
`npm test` themselves rather than trusting this Log) and returned **PASS**.

- **Fold-in (open decision B):** the owner was asked with `AskUserQuestion` —
  leave the duplicated `trustProxy()` and file a follow-up, versus lift it now
  in a separate PR — and took the recommendation both the builder and the
  reviewer gave: leave and file. Filed as
  [repo-40](../../../docs/work/repo-40-trust-proxy-is-a-second-consumer-with-nowhere-to-land.md),
  not `repo-39` — that id was already spoken for on a pushed-but-unmerged
  sibling branch (`repo-37-anchor-planner-review-corpus`), invisible to
  `next-id.mjs` because it reads merged tickets plus open PR diffs and that
  branch has no PR yet.
- **pl-2's stale Traps bullet (open decision C):** the session that had been
  holding `pl-2` confirmed it was not blocking on this and released it, so the
  correction was made from this branch — see `pl-2-container-image.md`'s own
  Log entry, dated today, for what changed and why. `pl-2`'s `status` was left
  `in-flight`, untouched; that is a separate, already-recorded question about
  its third `Done when` line.

**One thing recorded as unverified, not acted on.** A peer session reported,
unconfirmed, that its user's actual Cloudflare tunnel may route to
`http://host.docker.internal:8080` rather than to `downloader:8080` on the
`edge` network — in which case the downloader's own `TRUST_PROXY:
172.30.42.0/24` would never match the real hop and its limiter would already be
single-bucket in production, same failure this ticket fixes for the planner.
Diagnostics were still running when it was reported and I have not verified it
myself. Not settled here, not treated as true anywhere in this branch, and
raised to the owner separately by the session that found it — noted so it is
not lost.
