---
id: dl-40
tool: downloader
title: The picker lists renditions that differ only in fields it does not show
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-40 — twenty rows, five distinguishable, and the difference is off-screen

**Packages:** `web` (`components/VariantTable.tsx`, `lib/variants.ts`) at minimum;
`resolvers` (`manifest/hls.ts`) and `contract` only if the cause turns out to be
redundancy — see the branch below.

## Why

Reported from a session on 2026-09-05: a 4:14 video, `20 renditions`, rendered as
five resolution groups of **four rows each**, every row identical on every column
the table shows.

| QUALITY                                                   | VIDEO | AUDIO | BITRATE  | SIZE       | DELIVERY |
| --------------------------------------------------------- | ----- | ----- | -------- | ---------- | -------- |
| 1280×720 30 fps                                           | H.264 | AAC   | 1.3 Mbps | 39 MB est. | HLS      |
| 1280×720 30 fps                                           | H.264 | AAC   | 1.3 Mbps | 39 MB est. | HLS      |
| …×4, then the same for 848×480, 640×360, 424×240, 256×144 |       |       |          |            |          |

**The parser is faithful and is not the bug.** `buildMasterVariant` emits exactly
one variant per `EXT-X-STREAM-INF`, keyed `hls-${stream.index}`
([`manifest/hls.ts:456`](../../resolvers/src/manifest/hls.ts)), and `streams.push` assigns
`index: streams.length` ([`manifest/hls.ts:367`](../../resolvers/src/manifest/hls.ts)) —
nothing multiplies. The master playlist really did declare twenty streams.

**The bug is that the picker cannot show what separates them.** Three candidate
causes, all real-world, none of them rendered:

1. **One ladder per audio language.** The parser already resolves the stream's
   `AUDIO` group and picks a rendition from it
   ([`manifest/hls.ts:436-439`](../../resolvers/src/manifest/hls.ts)), then puts its
   language on the variant. `MediaVariant.language` exists in the contract
   ([`media.ts:107`](../../contract/src/media.ts)) — **and nothing in `web/src`
   ever reads it.** The only `.language` in the UI is for subtitle tracks. It is
   also the one field in that contract block carrying no doc comment, which is
   the tell: it was added and never wired to anything.
2. **Redundant CDN paths.** HLS lists failover streams as further
   `EXT-X-STREAM-INF` entries with identical attributes and a different URI. Only
   `url` differs, and `url` is never shown.
3. **Different codec profiles.** `shortCodec`
   ([`web/src/lib/variants.ts:26`](../../web/src/lib/variants.ts)) maps on the
   family prefix, so `avc1.4d401f` (Main) and `avc1.64001f` (High) both render as
   `H.264`.

Four-way duplication across every rung points at 1 or 2 — a whole ladder repeated
per language or per CDN. **Which one it is decides the fix, and they pull in
opposite directions**: cause 1 wants the distinction _surfaced_ as a column,
cause 2 wants the duplicates _collapsed_ to one row. Guessing wrong either hides
a real choice or keeps the noise.

## Build

1. **Determine the cause before changing anything.** Probe the reported video and
   compare `language`, `url` and `videoCodec` across the four variants of one
   resolution group. Record the answer in the Log with the differing field named
   — the next reader must not have to redo this.
2. Then take the matching branch:
   - **Cause 1 — languages differ.** Render `language` in the table. It is
     already on the variant, so this is a `web` change only. Show the column
     **only when at least two variants disagree on it**, or every single-language
     video grows a column of identical cells.
   - **Cause 2 — only the URL differs.** Collapse to one row per distinct
     (resolution, bitrate, codec, language) tuple. **Read the warning below
     first — this is not purely cosmetic.**
   - **Cause 3 — codec profiles differ.** Make `shortCodec` fall back to the full
     codec string when collapsing would make two otherwise-identical rows
     indistinguishable. Do not simply stop shortening: `H.264` is the right
     answer in the overwhelming majority of cases and is why that map exists.
3. Whatever the cause, a rendition list this long is hard to cross with the arrow
   keys, which is how the radio group is meant to be driven
   ([`VariantTable.tsx:12`](../../web/src/components/VariantTable.tsx)). Twenty
   rows is twenty presses. Worth handling in this ticket if the collapse does not
   already solve it.

### The warning on collapsing

**Redundant HLS streams are not noise; they are failover paths.** The whole point
of the duplication is that a player can retry a different server when one fails.
Collapsing the rows discards those alternates, and there is nowhere to put them:
`MediaVariant` carries a single `url` ([`media.ts:87`](../../contract/src/media.ts))
and the engine downloads from exactly that ([`engine/src/index.ts:403`](../../engine/src/index.ts)).

So collapsing trades a real capability for a tidier list. That is very probably
the right trade — the engine has never used the alternates and nobody has missed
them — but it must be a decision, not a side effect. Two honest ways to take it:

- **Collapse and drop, recorded.** One row, alternates discarded, with a comment
  at the collapse site saying what was thrown away and why. Cheapest, and honest
  as long as it is written down.
- **Collapse and keep.** Add alternates to the variant and let the engine's retry
  path try the next one. Larger: a contract change, and it reaches into
  `REPROBE_WORTHY` retry handling. **Do not do this inside this ticket** — file
  it, so the picker fix is not blocked behind an engine change.

## Done when

- The Log names which field actually differed on the reported video.
- A rendition list where the variants differ only in a field the table shows
  nothing of no longer renders indistinguishable rows — proven against a fixture
  built from a real master playlist of the reported shape, not a synthetic one
  with four identical entries.
- A single-language, non-redundant video renders exactly as it does today: no new
  column, no collapsed rows. This is the regression that matters, and a fixture
  with only one variant will not catch it — use one with a normal ladder.
- If rows are collapsed, a test proves the _chosen_ row's `url` is one the
  manifest actually declared, and the comment explaining what happened to the
  others is in the code.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05 — filed.** Found from a screenshot of a 20-rendition video where
  four rows per rung were identical on every visible axis. Confirmed the HLS
  parser emits one variant per declared stream and is not duplicating anything,
  so the manifest genuinely declares twenty. The cause was deliberately left
  undetermined rather than guessed: it decides whether the fix surfaces a column
  or removes rows, and those are opposite changes. `MediaVariant.language` being
  populated by the parser and read by nothing in the UI was found in the same
  pass and is a strong candidate on its own.
