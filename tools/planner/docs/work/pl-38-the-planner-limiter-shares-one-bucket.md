---
id: pl-38
tool: planner
title: Behind a proxy the planner's rate limiter buckets every client together
kind: fix
status: ready
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
`tools/downloader/api/src/server.ts:498` "trustProxy: config.trustProxy", does, and `ApiConfig` here has no such field to pass.

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

**The subnet is one setting written twice.** `TRUST_PROXY` names the CIDR that
`compose.prod.yaml`'s `edge` network pins, and a mismatch silently reverts every
limit to sharing one bucket — which is this ticket's own bug, reintroduced
somewhere nothing is looking.

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
