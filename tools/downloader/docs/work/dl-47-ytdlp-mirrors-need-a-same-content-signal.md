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

## Decision — answered 2026-09-08 by the owner, not open

**The answer is B: require a positive same-content signal.** Group only where the
source itself vouches for it — the `format_id` family the balancer fixture
exhibits as `default-209-0` / `default-209-1`.

**The reasoning the owner accepted** is this section's own: it is the difference
between "no evidence they differ" and "evidence they are the same", and A is a
denylist of one that stops the known merge without establishing that no unknown
merge remains.

**"B with A as a fallback" was offered as a separate option and was not chosen**,
so there was no authority to fall back to A. Had no reliable positive signal
survived contact with the fixtures, the answer was to stop and report it as an
open decision — not to implement A quietly, and not to widen into A's shape "just
in case". The signal did survive, and was measured rather than reasoned; see the
Log entry for 2026-09-08.

**Build step 1 is answered by this**, and the three options are left below as
they stood when the question was put:

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

1. ~~**Answer the decision above first.**~~ **Answered 2026-09-08: option B.**
   Everything else depends on it, and A and B produce different shapes for the
   shared code.
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

- **2026-09-08 — built, on option B.** Branch
  `dl-47-ytdlp-mirrors-need-a-same-content-signal`, off `origin/main` at
  `a5e31c7`. `npm run check` exits 0; `npm test -- --project downloader` is
  **1214 passing over 73 files**. Packages touched: `resolvers`, `engine` (test
  only), `web` (test only). **`contract` was not touched** — B needed no new
  field on `MediaVariant`, so the cross-package question the brief flagged never
  had to be asked.

  **The signal, and it was measured rather than read off the grammar.** yt-dlp
  appends `-0`, `-1`, … to a `format_id` when several formats reach `YoutubeDL`
  carrying the same one. A trailing index is therefore the _extractor_ saying it
  emitted these as one format and the _downloader_ saying it could not tell them
  apart — a claim about content made by the source, which is exactly what
  option B asks for. Run against yt-dlp 2025.09.26, generic extractor, on a
  local ffmpeg-generated origin over loopback:

  | master playlist declares                                     | `format_id`s emitted        |
  | ------------------------------------------------------------ | --------------------------- |
  | one rung at two hosts, identical attributes                  | `209-0`, `209-1`            |
  | two rungs at two hosts, same BANDWIDTH, different RESOLUTION | `209-0`, `209-1`            |
  | two rungs at two hosts, different BANDWIDTH                  | `209`, `353`                |
  | two `EXT-X-MEDIA` audio renditions, NAME English / French    | `aud-English`, `aud-French` |

  Row one is the balancer shape and row three is the control. **Row four is the
  one that decides whether B is honest**: real language tracks get distinct ids
  from their `NAME`, so the reproduction's `audio-en` / `audio-fr` is a faithful
  shape and not a straw man. **Row two is why the signal is never sufficient on
  its own** — two genuinely different renditions collide into the same family —
  so the implementation requires the mapped variants to match _as well_, and
  that conjunction is what makes row two safe. A family-only rule would have
  reintroduced the defect from the other side, and nothing in the brief predicted
  it. The fourth constraint, that a family's indices must be exactly `0..n-1`, is
  what keeps `hls-1080` / `hls-720` from sharing the stem `hls`; it fails closed,
  losing a failover path rather than inventing one.

  **Where the code lives (Build step 3): lifted, but only the half that is
  genuinely shared.** `groupMirrors` and `renditionKey` are in
  `resolvers/src/common.ts` again, and both producers call them — but the
  argument is now `MirrorCandidate[]`, pairing each variant with the source's own
  `sameContentAs` token. The _fold_ is one rule for both (first declaration is
  primary, alternates in declaration order, an address repeated inside a group is
  dropped) and two copies of that would drift; the _evidence_ is not, and the
  field is required with no default precisely so a third producer cannot inherit
  HLS's answer by omitting an argument. That is the shape dl-45's revert was
  waiting for: this is the second real consumer, and the two producers share
  everything except the one thing the gate found them wrongly sharing. HLS passes
  a constant, `MASTER_PLAYLIST_VOUCHES`, whose docblock records that the evidence
  is RFC 8216 6.2.4 and therefore a property of the format rather than of any
  entry.

  **What the brief had wrong, and it is Build step 2.** The step requires the
  grouping to run after `dropDuplicateFormats` and gives a reason: an exact
  duplicate reaching the grouping would become its own rendition's alternate, a
  mirror on the same host. **That reason does not hold, because the hazard is
  guarded twice.** `groupMirrors` independently refuses a URL already in its
  group, so the same-host alternate cannot happen in either order. Measured on
  2026-09-08 by swapping the two calls in the compiled mapper and running both:
  on the balancer fixture, on an exact duplicate inside one family, and on two
  families over the _same_ address set, the two orders produce **byte-identical
  output**, and no variant carries an alternate on its own host under either.

  **The ordering is still load-bearing, for a different reason, and that is
  worth more than the one the brief gave.** The shape that separates them is two
  play-options families over _overlapping but unequal_ address sets — `default-*`
  at hosts a and b, `m3u8-*` at hosts a and c. Group first and each family folds
  on its own, both electing host a as primary, and the dedup that follows can no
  longer merge them because their `alternateUrls` now differ: **two rows for one
  rendition, which is dl-40's defect rebuilt out of dl-47's own field.**
  Deduplicate first and there is one. So the step is right and its justification
  is not; the test written for it asserts the property that actually moves — no
  two variants may name the same primary address — rather than the same-host one,
  which passes under both orders and would have proved nothing.

  **Done when, line by line.**

  - _Two audio-only formats differing only in `format_note` stay two variants._
    `resolvers/test/ytdlp.test.ts` — "two audio tracks the mapper cannot tell
    apart stay two variants". The reproduction verbatim, plus an assertion that
    the two really are byte-identical once mapped, so it cannot pass because some
    other field separated them.
  - _The balancer fixture's real mirrors do group, and the guard is not
    vacuous._ Same file — "the balancer fixture's real mirrors do group, and not
    via format_note". Ten addresses become five renditions carrying 3/2/2/1/2
    hosts. **The `format_note` half of this line was written in option A's
    vocabulary and proves something narrower under B**: A keyed on the discarded
    `format_note`, so a discriminator present on every format would have disabled
    grouping while everything stayed green. B does not read that field at all, so
    the assertion now says only that the fixture is not being separated or joined
    by it. The vacuity guard B actually needs is structural and is the pair of
    tests itself — one asserts a merge, the other asserts a refusal, and no
    single mutation can satisfy both. That was checked, not argued: see the red
    runs below.
  - _The engine's failover reaches a yt-dlp mirror the same way it reaches an HLS
    one._ `engine/test/mirror-failover.test.ts` — "the engine fails over to a
    yt-dlp mirror exactly as it does to an HLS one (dl-47)". The variant is read
    from `balancer-duplicate-ladder.variants.json`, which `mapYtDlpInfo`
    generates and the resolvers suite re-verifies, with only its three CDN hosts
    repointed onto a dead port, the fixture origin and the 403 origin. A real
    ECONNREFUSED, a real MP4 that ffmpeg re-decodes, the mirror's own request log
    as the evidence, and the 403 origin asserted at zero requests so the loop is
    shown to stop. A hand-written `alternateUrls` would have proved only that the
    engine reads a field.
  - _`npm run check` and `npm test -- --project downloader` pass._ Both above.

  **Red-checked, because every claim here is about what the code refuses to do
  and a refusal is invisible when it breaks.** Four mutations, each run against
  `resolvers/test/ytdlp.test.ts` (55 tests):

  | mutation                                             | result                                                               |
  | ---------------------------------------------------- | -------------------------------------------------------------------- |
  | evidence always present (B collapses to dl-45's key) | 4 red, including the reproduction; the balancer tests stay green     |
  | evidence never present (grouping disabled)           | 5 red, including the balancer grouping and the derived-fixture guard |
  | drop the `0..n-1` density check                      | 2 red — the `hls-1080` case and the holed family                     |
  | drop the `renditionKey` conjunct from `groupMirrors` | the whole resolvers suite goes red, HLS included                     |

  The first two are the pair that pins B in both directions at once.

  **The collapse still has a producer — confirmed, not assumed (Build step 5).**
  Every derived fixture in the repo, measured through `toDisplayRows` on
  2026-09-08:

  | fixture                                 | declared | rows | `collapsed` |
  | --------------------------------------- | -------- | ---- | ----------- |
  | `hls-master-mirrors-jittered-bandwidth` | 4        | 2    | **2**       |
  | `hls-master-multibitrate`               | 5        | 5    | 0           |
  | `hls-master-per-language-ladder`        | 4        | 4    | 0           |
  | `hls-master-redundant-mirrors`          | 5        | 5    | 0           |
  | `hls-master-two-profiles`               | 3        | 3    | 0           |
  | `ytdlp/balancer-duplicate-ladder`       | 5        | 5    | 0           |

  So dl-40's collapse has exactly one fixture left, and it is the permanent one —
  rows differing in a real number the table does not render, which no producer
  may ever group. This is the state dl-45 measured during its fold-in and called
  a gap; it is not a gap now because `hls-master-mirrors-jittered-bandwidth`
  exists specifically for it. The stale comments that said the yt-dlp ladder was
  "on its way upstream" have been corrected in place rather than left to read as
  still true, and `probe-panel.test.tsx`'s dl-40 assertion moved onto the
  jittered manifest, which is now the only fixture that can produce the
  "N duplicate paths merged" string at all.

  **The derived fixture was regenerated from the mapper, never by hand**, by
  running `mapYtDlpInfo` over `balancer-duplicate-ladder.json` and rewriting only
  the `variants` array; the guard test in `ytdlp.test.ts` re-runs the producer and
  would fail if it had been edited. Ten variants became five, and
  `presentation-helpers.test.ts` and `probe-panel.test.tsx` moved with it exactly
  as Build step 4 predicted.

  **Two small things the brief has wrong, neither load-bearing.** The Why says
  the fixture is "ten formats over five rungs at two hosts": it is **twenty**
  formats in the file, ten after dl-40's dedup, and the 720p rung has **three**
  hosts, not two. The count of ten is the post-dedup number and the host count is
  simply wrong; `default-1257-0/1/2` is in the fixture.

  **What is not measured, named as unmeasured.** No live site was probed for this
  ticket — the yt-dlp measurements above are against a loopback origin serving
  playlists this branch wrote, which establishes the `format_id` grammar and
  nothing about how any real extractor behaves. The residual hole in B is stated
  in the code and repeated here: a source that gives two genuinely different
  tracks the _same_ `format_id` **and** nothing else `mapYtDlpInfo` keeps would
  still merge them. Nothing has been observed doing that; at that point the
  source offers no evidence of a difference anywhere, which is the honest bound
  on what any signal read out of yt-dlp's output can achieve.

  **Cost.** `engine/test/mirror-failover.test.ts` goes from 33.9 s over four
  tests to 45.2 s over five, all of the difference being ffmpeg's own
  `-reconnect_delay_max 10` against the dead primary — the same eleven seconds
  dl-45 measured and documented, not anything this ticket added. Nothing was
  deferred that could have been folded in: the only adjacent free work was the
  stale test comments dl-45 left pointing at a future that has now happened, and
  those are corrected here.
