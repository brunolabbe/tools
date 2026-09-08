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
