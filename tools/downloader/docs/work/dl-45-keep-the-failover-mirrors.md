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

## Decision — answered 2026-09-07, not open

**The question was:** what does the picker say about mirrors, if anything? A
rendition with three mirrors is not a better rendition; it is a more available
one, and it may deserve nothing at all in the table.

**The answer, from the owner, relayed through the orchestrator: show the mirror
count.** **This overrode the recommendation**, which was to show nothing —
recorded because a decision that went against its recommendation is the one most
likely to be re-argued from scratch by whoever inherits it, and because the
grounds for the option that lost are still true. Recorded 2026-09-07; **nothing
below has been built.**

The options as they were put:

- **A. Nothing — mirrors stay invisible. Recommended, and overridden.** The
  engine fails over silently and the picker table is unchanged, which keeps the
  change to `contract` + `resolvers` + `engine`. The grounds were this ticket's
  own framing — a mirrored rendition is not a better one — and dl-40, which
  collapsed those rows precisely to stop the table implying a difference that is
  not there.
- **B. Show the mirror count — chosen.** A small affordance on the row.
- **C. Let the builder decide and record it. Not chosen:** this one is settled,
  and it is settled as B.

**The scope now includes `web`, and this ticket had not budgeted for it.** dl-45
carries no `**Packages:**` line at all, so there is no list to correct and this
paragraph is the record of the widening. Named so it is visible; deliberately
not rewritten into a brief, which is the next builder's job with the
implementation in front of it. Two coordinates, and a number already on screen
that this one is not:

- the row is built in
  [`web/src/lib/variants.ts`](../../web/src/lib/variants.ts) and rendered in
  [`web/src/components/VariantTable.tsx`](../../web/src/components/VariantTable.tsx),
  so `VariantRow` grows a count and the table grows somewhere to put it;
- **the count comes from step 1's contract field, not from the picker's
  collapse.** Step 2 is explicit that alternates are computed in the resolver,
  so by the time the picker sees a mirrored rendition it is already one variant
  carrying its alternates — the picker counts what it was told, it does not
  discover it. Reading the number off the collapse would put the computation in
  the one place step 2 forbids;
- the picker's own `collapsed` total is a **different** number and stays one: it
  counts rows the picker itself merged, and it is already on screen as
  `N duplicate paths merged` in
  [`web/src/components/ProbePanel.tsx`](../../web/src/components/ProbePanel.tsx).
  After step 2 the mirrors it used to count arrive pre-grouped, so that total
  drops for a mirrored manifest whether or not a per-row count is added. Whether
  the two coexist, and what the table-level line then says, is part of the work.

**Carry the cost with the answer**, from the option that was recommended
against: **dl-40 collapsed duplicate rows on purpose, so the table would stop
implying a difference between renditions identical on every attribute but the
hostname.** A per-row mirror count reintroduces a per-row distinction, so
whoever builds this owes an answer to _"why does this not undo dl-40?"_ — most
likely by making it unmistakable that the count is about **availability, not
quality**, in the copy and in whatever the row gives a screen reader. The
objection travels with the answer; it was not dismissed by it.

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
   all in the table. **Settled by the decision above: show the mirror count** —
   which overrode the recommendation of showing nothing, and which brings `web`
   into scope and the dl-40 objection with it. Left as written rather than
   rewritten into a new brief; that is the builder's job with the code in front
   of it.

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

## The gate on this decision record

**Gate: PASS** — 2026-09-07 · `origin/main...HEAD`, tip `e3d065e` · own defect hunt (docs-only diff; no `code-review` dispatch)

Same reasoning as dl-44 for the heading: `status: ready` is untouched and nothing is built, so this is not `## Review`.

- The added `## Decision` and Build-step-4 text do not contradict Build step 2: the decision text states the mirror count "comes from step 1's contract field, not from the picker's collapse ... Reading the number off the collapse would put the computation in the one place step 2 forbids," matching step 2's own text. Swept both files for other new-prose-vs-Build contradictions; found none.
- `**Packages:**` line: confirmed absent from both dl-44 and dl-45 (`grep -rl '^\*\*Packages:\*\*' tools/downloader/docs/work/` — 21 files match repo-wide, neither ticket among them).
- Confirmed `web/src/components/ProbePanel.tsx:82` renders the `· N duplicate paths merged` line, asserted by `web/test/probe-panel.test.tsx:126`.
- Confirmed `web/src/lib/variants.ts:172,232` (`collapsed: rows.length - kept.size`) is a picker-level merge count, mechanically distinct from a future per-row mirror count sourced from the contract field per step 2.
- Citations: `node scripts/citations.mjs` → 2 unanchored (`contract/src/media.ts:87`, `engine/src/index.ts:403`), 0 moved, 0 unresolvable. Both pre-existing (outside this diff) and both resolve on manual read to the content the ticket describes.
- `status: ready`, `depends_on: [dl-40]` untouched; `npm run status -- --json` exits 0, `"reviewed": false`, `"problems": []`.
- No `## Review` heading present.
- `npm run check` exits 0; `npx oxfmt --check` reports correct formatting.
- findings: own hunt returned 0.
- NFR: security n/a · performance n/a · reliability n/a · maintainability ✓.

## Log

- **2026-09-06 — filed from dl-40**, whose builder reserved this id. dl-40
  established by probing the reported video that its manifest declares each rung
  once per CDN mirror; the picker now collapses those to one row and the
  alternates are discarded. That was the cheaper of the two honest options and
  was taken with the owner's confirmation, on the reasoning that the engine has
  never used an alternate. This ticket is the other option, kept separate so the
  picker fix was not blocked behind an engine change. Nothing about the reported
  video, its site or its hosts is recorded here, deliberately.
- **2026-09-07 — Build step 4 was answered by the owner: show the mirror
  count.** The orchestrator recommended showing nothing, on this ticket's own
  framing and on dl-40's collapse; **the answer overrode that recommendation**,
  and the section above is now `## Decision — answered 2026-09-07, not open`
  with step 4 marked as settled by it. Two things travel with the answer and are
  recorded there: the scope now reaches `web`, which this ticket had not
  budgeted for and has no `**Packages:**` line to correct, and the dl-40
  objection — a per-row count reintroduces the per-row distinction dl-40
  removed, so whoever builds it owes an answer to why this does not undo dl-40.

  **Recorded, not built.** Nothing in `src` was touched and `status` stays
  `ready`. Treat this as a brief whose last open question is closed, not as work
  in progress.
