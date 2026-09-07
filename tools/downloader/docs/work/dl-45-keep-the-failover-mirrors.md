---
id: dl-45
tool: downloader
title: A rendition's failover mirrors are discarded, not carried
kind: work-package
status: ready
milestone: null
depends_on: [dl-40]
difficulty: hard
---

# dl-45 — the second server a player would have tried

## Why

dl-40 collapsed the picker's duplicate rows, and the honest cost of that is
recorded at the collapse site in
[`web/src/lib/variants.ts`](../../web/src/lib/variants.ts): **what it throws away
are failover paths.**

An HLS master may declare the same rendition more than once, at more than one
host. That is not noise. It is the mechanism by which a player survives one CDN
going down mid-stream — it retries the next entry with the same attributes (RFC
8216 §6.2.4). The reported video in dl-40 did exactly this: each of its five
rungs was declared twice, identical on every attribute, differing only in the
hostname.

**The engine has never used them, and nobody has missed them.** dl-40 took that
trade deliberately and with the owner's confirmation, because there is nowhere to
put an alternate: `MediaVariant` carries a single `url`
([`contract/src/media.ts:87`](../../contract/src/media.ts)) and the engine
downloads from exactly that
([`engine/src/index.ts:403`](../../engine/src/index.ts)). Keeping them is a
contract change and an engine change, which is why it was split out rather than
bolted onto a picker fix.

**What is lost today, concretely.** When the chosen host 502s or its TLS handshake
fails, the download fails — even though the manifest named another host serving
the same bytes, and we parsed it, and then dropped it on the floor before the
engine ever saw it. Every retry we do make goes back to the same host.

## Build

1. **Contract first, and not unilaterally.** `MediaVariant` needs somewhere to
   carry alternates — the obvious shape is `alternateUrls?: string[]`, ordered as
   the manifest declared them. Get the shape agreed before writing it; it is a
   seam every package reads.
2. Populate it where the collapse happens. Two producers matter, and they are not
   the same place:
   - the picker's collapse in `web/src/lib/variants.ts` is a _presentation_
     collapse and must not be where alternates are computed — by then the API has
     already sent one variant per mirror;
   - the resolver is where the mirrors are known. Grouping the parsed variants by
     the tuple that makes them the same rendition belongs in
     `resolvers/src/manifest/hls.ts`, beside `buildMasterVariant`.
3. Teach the engine to fail over. This reaches into `REPROBE_WORTHY` retry
   handling: a host that refuses is a different condition from a signed URL that
   expired, and only the first is worth trying an alternate for. **A re-probe
   must not be replaced by a mirror attempt** — an expired URL is expired at
   every mirror.
4. Decide what the picker says, if anything. A rendition with three mirrors is
   not a better rendition; it is a more available one. It may deserve nothing at
   all in the table.

## Done when

- A test proves a master declaring one rung at two hosts yields **one** variant
  carrying the second host as an alternate, rather than two variants.
- A test proves the engine, on a connection-level failure from the first host,
  retries the alternate and succeeds — driven by a fixture origin that fails the
  first host, not by a mocked retry counter.
- A test proves an expired signed URL does **not** trigger a mirror attempt: it
  re-probes, as it does today.
- The picker still shows one row per rendition, and dl-40's fixtures still pass
  unchanged.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-06 — filed from dl-40**, whose builder reserved this id. dl-40
  established by probing the reported video that its manifest declares each rung
  once per CDN mirror; the picker now collapses those to one row and the
  alternates are discarded. That was the cheaper of the two honest options and
  was taken with the owner's confirmation, on the reasoning that the engine has
  never used an alternate. This ticket is the other option, kept separate so the
  picker fix was not blocked behind an engine change. Nothing about the reported
  video, its site or its hosts is recorded here, deliberately.
