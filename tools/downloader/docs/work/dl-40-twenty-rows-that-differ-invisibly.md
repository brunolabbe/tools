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

- **2026-09-06 — step 1 could not be run, and is still open.** Build step 1 says
  "probe the reported video". There is no video to probe: **the URL was never
  recorded anywhere.** The filing session (`3996cd46`, 2026-09-05 16:42:58Z) has
  the owner's screenshot pasted as an image and the sentence "20 renditions for
  this video, but many seems identical" — and no URL, because it was typed into
  the running web UI, not into the session. Searched every transcript in this
  project for a non-infrastructure `http(s)` URL in September: four hits, all
  unrelated (`https://evil/track.gif`, two cloud pricing pages, an
  `example.com` image). No probe artifact survives on disk either — no
  `storage/`, no job record, no `.m3u8` outside test fixtures. And the container
  cannot reach one: `curl` to `devstreaming-cdn.apple.com` and
  `test-streams.mux.dev` both hang until timeout (DNS resolves, TCP is dropped),
  and `.devcontainer/allowed-domains.txt` lists no media host at all.

  **The owner is supplying the URL, so this entry deliberately does not name a
  cause.** What follows narrows it and is explicitly _not_ the determination the
  first `Done when` line asks for — do not close step 1 with it:

  - Cause 3 is out. Four different codec profiles per rung across five rungs, at
    identical bitrates, is not a real ladder.
  - Cause 1 is out **in its ordinary form**. Not one of the twenty rows in the
    screenshot carries the `+mux` tag, and that tag renders exactly when
    `variant.audioUrl` is set (`web/src/lib/variants.ts` `needsMux` →
    `VariantTable.tsx`), which is exactly when the audio group's rendition has a
    `URI`. A per-language ladder done the usual way — one audio playlist per
    language — would have shown `+mux` on every row. It survives only in the
    unusual form where four audio groups each hold a `URI`-less rendition, i.e.
    the video bytes are duplicated per language.
  - Weaker, same direction: `formatBitrate`
    (`web/src/lib/format.ts:111` "Math.round(bitrateBps / 1000)") rounds
    to whole kbps below 1 Mbps, so "678 kbps" on four rows means four `BANDWIDTH`
    values inside a 1 kbps window, and that holds in all five rungs.

  That chain reaches maybe 85%, which is why it is written here as a narrowing
  and not as an answer. **The next agent's job is one probe, not this reasoning
  again**: fetch the reported master playlist and compare `language`, `url` and
  `videoCodec` across one rung, then write the field's name here.

- **2026-09-06 — the three branches are not alternatives, and that is a
  correction to the Build section.** The brief reads as "find the cause, take the
  matching branch". Measured otherwise: the language check and the codec check
  are _preconditions of the collapse_, not sibling options. A collapse keyed only
  on what the table renders destroys real renditions —

  - with the codec pass removed, `hls-master-two-profiles.m3u8` loses a
    rendition (`collapsed` is 1): an H.264 Baseline and an H.264 High rung both
    render as `H.264` at the same bitrate, and one is discarded;
  - with the language flag forced off, `hls-master-per-language-ladder.m3u8`
    loses two of its four rows.

  Both were run red before the guards went in, not argued. So the picker now
  disambiguates on whatever the variants actually disagree about — language into
  a column when two disagree, the declared codec string when two collide, and a
  collapse only for what is left. Which cause the reported video turns out to be
  no longer changes the code; it still has to be written down, because the
  ticket's own reasoning about _why_ twenty rows appeared belongs in this file.

- **2026-09-06 — fixtures, and why they are not hand-written.** Three real master
  playlists under `resolvers/test/fixtures/manifests/`, each carrying the ffmpeg
  command that emitted it in a comment at the top: `hls-master-redundant-cdns`
  (the reported shape — one five-rung ladder declared across four hostnames, 20
  streams), `hls-master-per-language-ladder`, and `hls-master-two-profiles`. The
  regression fixture is the existing `hls-master-multibitrate.m3u8`, Apple's real
  five-rung ladder, whose two 1080p rungs differ only in bitrate and must both
  survive. One honest limit on all three: hlsenc computes `BANDWIDTH` as
  `round(1.1 * (video target + audio target))` rather than measuring the
  segments — verified against all seven rungs — so those numbers are a
  packager's arithmetic, not a measurement. Nothing here depends on them being
  physically accurate; what they buy is rungs that differ from one another the
  way a real ladder's do, so a collapse test cannot pass by collapsing
  everything.

  The web suite cannot run the HLS parser (importing `@downloader/resolvers`
  into a jsdom test pulls playwright in behind it), so each manifest has a
  generated `.variants.json` beside it and `hls.test.ts` fails if one ever stops
  matching `parseHls`.

- **2026-09-06 — folded in: the count above the table.** `ProbePanel` printed
  `probe.variants.length`, so the collapse would have left "20 renditions" over
  five rows — the same defect told from the other end. It now counts the rows the
  table shows and says what was merged: `5 renditions · 15 duplicate paths
merged`. Also routed `pickDefaultVariantId` through the same rows, so the
  default selection can never name a variant that was collapsed away, which
  would have left the radio group with nothing checked.

- **2026-09-06 — the follow-up id is reserved, not yet filed.** The collapse site
  in `web/src/lib/variants.ts` says the alternates are dropped and that a
  follow-up ticket covers keeping them ("collapse and keep": alternates on the
  variant, the engine failing over to the next). **That ticket is `dl-45`**, held
  by this branch and filed when step 1 closes — the ticket asks for it to be
  filed only if the cause makes it real, and the cause is still open.

- **2026-09-06 — held, not decided.** Build step 3 (twenty rows is twenty arrow
  presses) is untouched: whether the collapse already solves it depends on which
  shape the reported manifest turns out to be, so it waits on the same URL. The
  doc comment missing from `MediaVariant.language` — the tell this ticket was
  filed on — is likewise not added yet, because it is a `contract` edit and the
  branch it belongs to is the one still open.
