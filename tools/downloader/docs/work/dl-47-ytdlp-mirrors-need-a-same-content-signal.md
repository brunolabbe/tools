---
id: dl-47
tool: downloader
title: The yt-dlp tier's failover mirrors need a same-content signal
kind: work-package
status: ready
milestone: null
depends_on: [dl-45]
difficulty: hard
---

# dl-47 — grouping yt-dlp's mirrors without merging two different tracks

**Packages:** `resolvers` (`src/resolvers/ytdlp.ts`, and whatever holds the
grouping), possibly `contract` if the answer turns out to need a field.

## Why

dl-45 taught the HLS parser to keep a rendition's failover mirrors instead of
discarding them, and taught the engine to use them. It deliberately stopped at
one producer. **The yt-dlp tier still throws its mirrors away**, so the defect
dl-45 describes is only half fixed: a load balancer that hands the same ladder
back under several hostnames still reaches the picker as one row per rung with
the alternates dropped on the floor.

The fixture for that shape already exists and is the reported video's own:
`resolvers/test/fixtures/ytdlp/balancer-duplicate-ladder.json`, ten formats over
five rungs at two hosts, asserted at `collapsed: 5` in
`web/test/presentation-helpers.test.ts`.

## The reproduction, which is the deliverable

**This was built during dl-45 and reverted.** The obvious implementation —
reusing dl-45's `groupMirrors` on the yt-dlp tier — was written, passed the
whole suite, and was then found by the gate to merge two genuinely different
renditions. That is why this is a ticket rather than a follow-up chore: the
easy version looks right and is not.

Feed `mapYtDlpInfo` two audio-only formats that differ only in a field the
mapper discards:

```ts
formats: [
  {
    format_id: "audio-en",
    url: "https://cdn.example/audio-en.m4a",
    protocol: "https",
    vcodec: "none",
    acodec: "mp4a.40.2",
    abr: 128,
    format_note: "English",
  },
  {
    format_id: "audio-fr",
    url: "https://cdn.example/audio-fr.m4a",
    protocol: "https",
    vcodec: "none",
    acodec: "mp4a.40.2",
    abr: 128,
    format_note: "French",
  },
];
```

With `groupMirrors` applied to this tier, that returns **one** variant, with
`audio-fr.m4a` in `alternateUrls`. Measured, not predicted.

**Why it happens.** The grouping key is read off the mapped `MediaVariant`, and
`mapYtDlpInfo` is lossy: `format_note` — where yt-dlp puts `English`, `French`,
`commentary`, `description` for tracks it has no `language` for — has nowhere to
go on `MediaVariant` and is dropped except as a last-resort label fallback,
which does not fire when codec and bitrate already fill the label. Two different
tracks therefore map to byte-identical variants, and a grouping that reads
_absence of visible difference_ as _sameness_ merges them.

**Why HLS is not exposed the same way.** Two `EXT-X-STREAM-INF` entries agreeing
on every attribute **are** one rendition, by RFC 8216 §6.2.4 — the format
guarantees it, and `parseHls` maps every attribute it reads. yt-dlp's format list
carries no such guarantee. The safety dl-45 relies on is a property of the
manifest format, not of the key. This is the asymmetry the ticket has to close.

**How bad it is, stated precisely.** The lost _choice_ is not new: measured, the
picker's dl-40 collapse already merged those two into one row before dl-45
existed (`toDisplayRows` on the ungrouped pair returns 1 row, `collapsed: 1`).
What grouping would add is worse — the discarded URL becomes a live failover
target, so a host failure on the English track would **silently download French
audio under the row the user chose for English**. Serving content the user did
not select is a different class of defect from not offering it, and it is the
one this ticket must not ship.

## Decision — open, not settled

**What signal licenses the claim that two yt-dlp formats are the same
rendition?** Both options were named by the dl-45 gate; neither was chosen, and
the owner reverted rather than pick one under time pressure.

- **A. Key on what the mapper discarded.** Give the grouping a per-producer
  discriminator and have yt-dlp contribute `format_note`. **Measured during
  dl-45: two source files, about twenty lines, no test changes, no fixture
  regeneration, suite green at 1184.** Cheap and it closes the reproduction.
  Its weakness is that it is a denylist of one — `dynamic_range` (SDR vs HDR)
  and `audio_channels` (stereo vs 5.1) are plausible other fields that map to
  identical variants, and neither has been checked. It stops the known merge
  without establishing that no unknown merge remains.
- **B. Require a positive same-content signal instead of the absence of a
  difference.** Only group where the source itself vouches for it — for
  instance the `format_id` family, which the balancer fixture exhibits as
  `default-209-0` / `default-209-1` (one play-options key, one host index).
  Correct in the direction the defect points, and it is the difference between
  "no evidence they differ" and "evidence they are the same". Its weakness is
  that it encodes yt-dlp's `format_id` grammar, which is an extractor-by-
  extractor convention and not a contract.
- **C. Do not group this tier at all.** The status quo, and the honest baseline:
  yt-dlp mirrors stay discarded, the picker keeps collapsing them, and the
  failover benefit is HLS-only. Costs nothing and fixes nothing.

**Recommendation, from the dl-45 builder and gate both: B, with A as the
fallback if no reliable positive signal survives contact.** Neither of us may
settle it — it decides what the tier is allowed to assert about content
identity, and the wrong answer is silent.

## Build

1. **Answer the decision above first.** Everything else depends on it, and A and
   B produce different shapes for the shared code.
2. Group the tier's mirrors on that signal, in `mapYtDlpInfo`, **after**
   `dropDuplicateFormats` — an exact duplicate reaching the grouping would
   become its own rendition's "alternate", which is a mirror on the same host
   and exactly the retry the engine's failover exists to avoid.
3. Where the grouping lives is part of the answer. dl-45 briefly lifted it to
   `resolvers/src/common.ts` for two consumers and moved it back to
   `manifest/hls.ts` on the revert, since this repo lifts shared code on the
   second _real_ consumer. This ticket is that second consumer — lift it again
   if and only if the two producers genuinely share a rule.
4. Regenerate `ytdlp/balancer-duplicate-ladder.variants.json` from the mapper,
   never by hand, and expect the web suite's counts to move with it. See the
   dl-45 Log for what that costs: `collapsed` for that fixture goes to 0, and
   `web/test/presentation-helpers.test.ts` and `web/test/probe-panel.test.tsx`
   both assert it today.
5. **Check the collapse still has a producer afterwards.** dl-45 measured that
   with both tiers grouping, every derived fixture in the repo reported
   `collapsed=0` — dl-40's collapse kept its code and lost its proof.
   `hls-master-mirrors-jittered-bandwidth` was added for that reason and is the
   case no producer may ever group, so it should still count 2; confirm rather
   than assume.

## Done when

- A test proves two audio-only formats differing only in `format_note` stay
  **two** variants, neither carrying the other as an alternate — the
  reproduction above, verbatim.
- A test proves the balancer fixture's real mirrors **do** group, and that the
  guard is not vacuous: assert the fixture carries no `format_note` at all, so a
  discriminator that was always present cannot pass by disabling the grouping.
- The engine's failover reaches a yt-dlp mirror in the same way it reaches an
  HLS one — driven by a fixture origin, not a mocked retry counter.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-07 — filed from dl-45, whose builder reserved this id** (`dl-47`;
  `node scripts/next-id.mjs dl` reported `dl-46` already claimed by PR#188).
  The yt-dlp half was **built inside dl-45 by an owner decision and reverted by
  a later one**, on the strength of the gate finding recorded above. Both
  decisions are in dl-45's Log with their reasoning, and the reversal was taken
  against the recommendation of both the builder and the gate, who each leaned
  toward guarding it in place.

  **The fold-in was not wasted work and this ticket should not be read as a
  false start.** It is what surfaced this defect _before_ a shared grouping key
  reached `main`, and it is what surfaced a second, unrelated gap: with both
  producers grouping, dl-40's picker collapse had no fixture exercising it at
  all. That gap was real regardless of the revert and is closed on dl-45 by
  `hls-master-mirrors-jittered-bandwidth`.

  Nothing here has been measured against a live site. The reproduction is
  synthetic — a realistic yt-dlp shape, not a captured one — and no site has
  been observed serving two same-bitrate language tracks with neither tagged.
  Establishing that would strengthen the ticket and nobody has done it.
