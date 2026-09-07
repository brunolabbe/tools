---
id: dl-40
tool: downloader
title: The picker lists renditions that differ only in fields it does not show
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-40 — twenty rows, five distinguishable, and the difference is off-screen

**Packages:** `web` (`components/VariantTable.tsx`, `components/ProbePanel.tsx`,
`lib/variants.ts`) **and** `resolvers` (`resolvers/ytdlp.ts`). The second one is a
deliberate widening, confirmed by the owner on 2026-09-06 once the cause was
probed: the doubling happens at two layers and a web-only fix would leave the API
emitting duplicate variants to every other consumer. No `contract` change — see
the warning below and dl-45.

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
nothing multiplies.

**But the manifest did not declare twenty; it declared ten.** That sentence stood
here until 2026-09-06 and was wrong — it was inferred from the picker's twenty
rows, and the video was probed rather than reasoned about only later. The x4 per
rung is two stacked doublings at two different layers, and only the first is in
the manifest:

- **x2 in the manifest — CDN mirrors.** Each rung is declared once per mirror
  host. Genuine failover paths.
- **x2 in the yt-dlp tier — a play-options balancer.** The site answers with a
  small map of delivery options whose two values are the same URL, character for
  character. yt-dlp walks both keys, fetches that one manifest twice, and emits a
  ladder per key with the key's name prefixed onto each `format_id`: 20 formats,
  20 distinct `format_id`, 10 distinct URLs, one `manifest_url`.

The parser finding above still holds exactly as written — it is a statement about
`EXT-X-STREAM-INF`, and the second doubling arrives at a layer this ticket did
not originally consider.

**The bug is that the picker cannot show what separates them.** Three candidate
causes, all real-world, none of them rendered:

1. **One ladder per audio language.** The parser already resolves the stream's
   `AUDIO` group and picks a rendition from it
   ([`manifest/hls.ts:436-439`](../../resolvers/src/manifest/hls.ts)), then puts its
   language on the variant. `MediaVariant.language` exists in the contract
   (`contract/src/media.ts:142` "language?: string | undefined;") — **and nothing in `web/src`
   ever reads it.** The only `.language` in the UI is for subtitle tracks. It is
   also the one field in that contract block carrying no doc comment, which is
   the tell: it was added and never wired to anything.
2. **Redundant CDN paths.** HLS lists failover streams as further
   `EXT-X-STREAM-INF` entries with identical attributes and a different URI. Only
   `url` differs, and `url` is never shown.
3. **Different codec profiles.** `shortCodec`
   (`web/src/lib/variants.ts:53` "function shortCodec") maps on the
   family prefix, so `avc1.4d401f` (Main) and `avc1.64001f` (High) both render as
   `H.264`.

Four-way duplication across every rung points at 1 or 2 — a whole ladder repeated
per language or per CDN. **Which one it is decides the fix, and they pull in
opposite directions**: cause 1 wants the distinction _surfaced_ as a column,
cause 2 wants the duplicates _collapsed_ to one row. Guessing wrong either hides
a real choice or keeps the noise.

**Answered on 2026-09-06 by probing the video, not by reasoning: cause 2, and the
field that differed is the hostname.** Cause 1 is dead outright — the manifest
declares no `EXT-X-MEDIA` at all, so no variant carries a language. The three
candidates are left standing above because two of them turned out to be the
shapes the fix must not break, which is a different job from being the cause; the
Log has the evidence and the fixtures have the guards.

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

## Review

### Gate: PASS — 2026-09-06 · `6061bc6` (read as the full `7bb3b62 → effeb02 → 6061bc6` sequence, not restarted) · Sonnet reviewer against an Opus build · own defect hunt, no `code-review` dispatch

**No high or med findings. Two low findings, both pre-existing, neither blocking.**

**What it ran, independently of the builder's numbers.**
`worktree-farm.sh` then `npm run build` at `6061bc6`, clean. `npm run check` exit 0,
"verified by reading the tsc --build output, not just the exit code".
`npx vitest run --project downloader` — **68 files / 1093 tests / 0 failures**,
matching the builder's number exactly. `node scripts/status.mjs --json` exit 0,
with the JSON parsed by hand to confirm `dl-45.depends_on = ["dl-40"]` resolves
and dl-40 is `done` — not dangling.

**Positive controls — it built its own mutants rather than running the builder's,
and reproduced all four red-run claims plus both rung-mutant claims.**

1. Tier dedup reverted to `unsorted` → 3 red in `ytdlp.test.ts` (39/42 pass), the
   exact tests asserting 10 URLs / 10 variants.
2. Codec pass replaced with a no-op → `two profiles of one rung stop rendering as
the same H.264` fails with `collapsed` reading 1 instead of 0. "Matches
   'Baseline eaten by High' exactly."
3. `showLanguage` forced false → the per-language test fails with `collapsed` 2
   instead of 0, and the DOM test drops from 4 radios to 2. "Matches 'loses half
   its rows' exactly."
4. Both rung mutants, **written independently and not textually identical to the
   builder's**: "assumes pairs" implemented as _collapse only if
   `group.length === 2`_ → **exactly 3 failures**, all attributable to the
   three-mirror rung not collapsing; "only collapses what it saw more than once"
   implemented as _drop any group of length 1_ → **exactly 7 failures**,
   including `pickDefaultVariantId` returning `null` for the ordinary-ladder
   fixture. Both counts match the Log entry. Its conclusion: "strong independent
   confirmation the varying-mirror-count fixture (3,2,2,1,2) really does exercise
   both extremes, not just one."

All temporary edits reverted, `git status --short` clean before each next check.

**Security sweep, from a needle list it built itself.** It read the peer's
artifacts directly (read-only, nothing written there, nothing quoted) and
extracted **28 needles of its own** — both hostnames, the video id, title,
uploader and uploader id, five path tokens, a segment name, the shared numeric
id, the signed-URL values, five content hashes and five hex path tokens. Swept
every tracked file at `6061bc6`, the full `main...6061bc6` diff, and every commit
subject and body: **0 hits**. It confirmed independently that the `expire=`
remaining in the tree is in `youtube-like.json`, untouched by this branch and
carrying an invented host. It also checked `balancer-duplicate-ladder.json`'s
field set against the real capture's — 8 top-level and 13 format keys against
dozens — and found that "consistent with your allowlist claim rather than a
stripped copy". Net: "I agree with your 0-hit result, from a differently-built
needle list."

**The doc-comment correction.** Both empirical claims re-run: the fixture
`LANGUAGE` counts (`en`×5, `fr`×2, `eng`×1, `fra`×1) by its own `grep -rn` and
hand count, and `Intl.getCanonicalLocales("eng")` → `['en']` on this container.
Both match. On the `showLanguage` raw-string caveat the builder flagged for
attack: "a documented, reasoned trade rather than a defect — no fixture or the
reported capture exercises it, normalizing on spec would mean picking a mapping
nobody asked for, and the failure mode is 'extra column' not 'lost rendition'…
it's a caveat correctly labeled as a caveat." Not carried as a finding.

**The dedup key, attacked as invited — no finding.** It enumerated all 17
`MediaVariant` fields and reasoned that a key of "whole variant except `id`"
includes `url`, so it is **strictly more conservative** than a URL-only key: it
"can never merge two things a URL-only dedup wouldn't already have merged", and
it refuses the video-only/audio-only-sharing-a-URL case (test verified). It then
hunted the one false-negative that key could have — two formats that are the same
stream but disagree on another mapped field, `label` being the candidate since it
falls back to `format_id` — and closed it by reading `buildLabel`: that fallback
fires only with no height, no codecs, no duration and no bitrate or filesize,
which does not happen for HLS renditions carrying `RESOLUTION`/`CODECS`, and does
not happen in the fixture (checked entry by entry). Verdict: "implementing the
owner's 'dedup exact duplicates' instruction at a stricter, safer granularity,
not narrowing it — a URL key and this key produce identical output on every
fixture in this branch, and they diverge only in the direction that protects
data".

**Finding 1 (low) — `media.ts:107` in the Why prose does not point at
`MediaVariant.language`.** Established as **already stale on `main`**
(`git show main:…/media.ts | grep language` → 121), so not broken by this branch;
but the branch's own +21-line edit to that file pushed the true location further
away, and fixing it was one line free while already there.

**Finding 2 (low) — `web/src/lib/variants.ts:26` does not point at
`shortCodec`.** Same situation: already wrong on `main` (line 40 there), pushed
further by this branch's `VariantRow` field additions. Neither finding was made a
condition of PASS; both flagged "so the record is accurate".

**Both accepted and fixed** at `media.ts:142` and `web/src/lib/variants.ts:53`, and both now
carry anchor text so `citations.mjs` checks them instead of printing them for a
human — `3 verified, 0 moved, 0 unresolvable`.

> **Builder's note on the two coordinates, added rather than silently corrected.**
> The findings are right and the fix is theirs. The _quoted resolutions_ did not
> reproduce here: at `6061bc6` — and at `effeb02` and at `main` — `media.ts:107`
> is `container?: string | undefined;`, not `hasAudio?: boolean | undefined;`,
> and `web/src/lib/variants.ts:26` is `videoCodec: string;`, not `quality: string;` (which is
> line 24). Nothing turns on it: both citations were stale either way, which is
> the finding. It is recorded because a coordinate in a gate record is read as
> evidence by whoever comes next.
>
> **Settled, not left as a discrepancy.** The reviewer re-derived it rather than
> take the correction on report, and named the cause: it had read a multi-line
> `sed -n '105,110p'` block and attributed line 105's content to 107 — the same
> off-by-two on `web/src/lib/variants.ts`, where line 24's content was attributed
> to 26. Its own re-check used `sed -n '107p'` and `sed -n '26p'` directly. Both
> accounts of this exchange agree; the anchored citations are what stop the class
> of mistake, since a coordinate carrying its own line's text can no longer be
> quoted as something it is not.

**Acceptance — every `Done when` line, none unproven.**

| Done when                                                    | Verdict      | Proof                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log names the differing field                                | **verified** | The "step 1 is answered" entry — the field is the hostname. Cross-checked against the fixture headers and the yt-dlp fixture design, both consistent.                                                                     |
| Indistinguishable rows, real master-playlist fixture         | **proven**   | `resolvers/test/hls.test.ts` (mirror fixture, ffmpeg-emitted) + `web/test/presentation-helpers.test.ts` "mirrors of a rendition collapse to one row, whatever the mirror count" + `ytdlp.test.ts` for the two-tier shape. |
| Single-language non-redundant video renders as it does today | **proven**   | "an ordinary ladder renders exactly as it did before any of this" over Apple's real five-rung ladder, plus the DOM-level equivalent in `variant-table.test.tsx`.                                                          |
| Chosen row's `url` was declared, and the comment is in code  | **proven**   | "the row that survives a collapse is one the manifest declared", asserted against the fixture's own declared order; comment block at the collapse site in `lib/variants.ts`.                                              |
| `npm run check` and `npm test -- --project downloader` pass  | **verified** | Both re-run by the reviewer at `6061bc6`: exit 0, and 68 files / 1093 tests / 0 failures.                                                                                                                                 |

**Siblings.** dl-43: recorded not implemented — `status: ready`, no `## Review`,
and no path under any package's `src/` in its diff. dl-45: `work-package`,
`ready`, `depends_on: [dl-40]`, `hard`, non-dangling.

**Nothing escalated.** The one place the two accounts first differed was the
"assumes pairs" mutant — the reviewer's first pass reported 5 failures across 3
files against the builder's 3, and narrowing to `presentation-helpers.test.ts`
alone made the counts agree exactly. Recorded as an artifact of test selection,
not a disagreement.

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
  table shows and says what was merged — for the reported video,
  `5 renditions · 5 duplicate paths merged`. Also routed `pickDefaultVariantId`
  through the same rows, so the
  default selection can never name a variant that was collapsed away, which
  would have left the radio group with nothing checked.

- **2026-09-06 — the follow-up id is reserved, not yet filed.** The collapse site
  in `web/src/lib/variants.ts` says the alternates are dropped and that a
  follow-up ticket covers keeping them ("collapse and keep": alternates on the
  variant, the engine failing over to the next). **That ticket is `dl-45`**, held
  by this branch and filed when step 1 closes — the ticket asks for it to be
  filed only if the cause makes it real, and the cause is still open. _(Filed on
  the same day, once the probe made it real: `dl-45-keep-the-failover-mirrors.md`.)_

- **2026-09-06 — held, not decided.** Build step 3 (twenty rows is twenty arrow
  presses) is untouched: whether the collapse already solves it depends on which
  shape the reported manifest turns out to be, so it waits on the same URL. The
  doc comment missing from `MediaVariant.language` — the tell this ticket was
  filed on — is likewise not added yet, because it is a `contract` edit and the
  branch it belongs to is the one still open. _(Both settled later the same day:
  step 3 below, and the doc comment written once the picker actually read the
  field — this branch is what wired it up, so documenting it is work this branch
  made free rather than a deferral. It says what the field means, that `en` and
  `eng` are both legal and are not normalised, and that the picker shows it only
  when two variants disagree.)_

- **2026-09-06 — step 1 is answered, by a live probe. The field that differed is
  the hostname.** Within a rung the entries agree on every attribute
  (`BANDWIDTH`, `CODECS`, `RESOLUTION`, `FRAME-RATE`), on the scheme, on all six
  path segments and on the query key and its value; **only the host differs.**
  Cause 2, CDN mirrors.

  The probe was run by a peer session against the live network — the owner had
  disabled the devcontainer firewall from the host, which is a condition of the
  machine and not a change to this repo, so it may be gone by the time anyone
  reads this. **What is written here I re-verified myself against the captured
  artifacts**, which is the only part that will still be true later:

  - the master carries **10** `EXT-X-STREAM-INF`, five rungs declared twice each,
    and **zero** `EXT-X-MEDIA`. No audio groups exist, so `language` is
    `undefined` on every variant and **cause 1 is dead outright** — a stronger
    result than the `+mux` argument in the entry above, and it agrees with it;
  - within a rung the two attribute lines are byte-identical, so cause 3 is dead
    _within_ a rung. Profiles do differ _between_ rungs (Baseline, Main and High
    down the ladder), which the resolution column already separates;
  - `yt-dlp -J` returns 20 formats, 20 distinct `format_id`, **10 distinct URLs**
    and one `manifest_url`; running this repo's own `mapYtDlpInfo` over that
    capture produced 20 variants in which **`id` is the only field that differs**
    inside a duplicated pair.

  **One of my own earlier inferences is void, and it should be read as void:**
  the "four `BANDWIDTH` values inside a 1 kbps window" argument assumed four
  manifest entries per rung. There are two, and the pair is byte-identical —
  nothing was rounding. The `+mux`/`language` elimination stands, by a stronger
  route than the one it was argued on.

  Nothing identifying the video, its site or its hosts is recorded here or in any
  fixture, deliberately. The captured artifacts are not committed: **the
  `yt-dlp -J` capture carries a signed URL**, whose credential and expiry sit
  in its query string, which this repo treats as being as sensitive as a cookie. Where that credential sits was relayed to me
  as "the master playlist carries it", and it does not — the master's stream URIs
  carry a single, ordinary query key. Both files are handled the same way, so
  nothing turned on it; it is corrected here because a premise like that survives
  by never being re-derived. A sweep over every tracked file, the whole branch
  diff and its commit messages, for both hosts, every path segment and every
  identifying field of the capture, returns nothing.

  **I did not re-probe, and so I cannot say whether the network is still open.**
  The artifacts answered every question and a second live fetch would only have
  made another copy of a credential. A later reader wanting to know whether
  egress was available when this landed should read this as "it was not needed",
  not as a yes that has since gone stale. I also did not check whether the
  balancer returns the same mirror hosts on repeated calls: nothing here depends
  on it, which is exactly why the fixture varies the mirror count.

- **2026-09-06 — both fixes land here, on the owner's confirmed decision.** A
  web-only collapse would have hidden the duplicates from the picker and left
  them in the probe result for every other consumer, so:

  - **`resolvers/src/resolvers/ytdlp.ts`** drops formats that map to the same
    variant twice, keeping the first the extractor listed. Keyed on the whole
    mapped variant except its `id` rather than on the URL alone — the two are the
    same thing for this video, measured, but they part company on a format list
    where a video-only and an audio-only entry share one manifest URL, and a
    URL-keyed dedup would merge that pair and give the engine a silent file. A
    test holds that case.
  - **the picker** collapses what is left, which is the mirrors.

  Both were run red first: without the tier dedup the fixture maps to 20 variants
  instead of 10; without the picker collapse a mirrored ladder renders every
  mirror. **Nothing was filed upstream** — the site really did offer the same
  stream under two names and yt-dlp really did report what it was given, so the
  deduplication is ours; the comment at the dedup site says so.

- **2026-09-06 — the fixtures were rebuilt, because they encoded the old
  premise.** The redundant-CDN fixture claimed a shape the manifest does not have
  (one ladder four times). It is now `hls-master-redundant-mirrors.m3u8`: ten
  streams over five rungs, **mirrored 3, 2, 2, 1, 2 times** — deliberately
  unequal, and deliberately not the two the real manifest had, so that no
  implementation can hardcode a count and stay green. A rung with a single mirror
  is in there for the same reason. Hostnames are invented.

  The yt-dlp layer has its own fixture, `ytdlp/balancer-duplicate-ladder.json`:
  the reported capture's ladder, codecs, frame rate, bitrates, `format_id`
  grammar and emission order, with every URL and identifying field regenerated.
  It is **assembled from an allowlist of keys rather than by stripping a copy**,
  so nothing identifying can survive by being forgotten. The other two manifests
  are no longer candidate causes but guards, and their headers now say so: a
  language ladder and a two-profile rung are what the collapse would eat if the
  language and codec checks were ever removed.

- **2026-09-06 — Build step 3 settled: not done, and the ticket's own condition
  is why.** It says to handle the arrow-key distance "if the collapse does not
  already solve it". It does: the reported video reached the picker as 20 rows
  and now reaches it as **5** — ten formats deduped to ten variants, then five
  rows. Five radios is not a list anyone needs paging for, and building paging
  now would be building it for a case nobody has reported. If a video with a
  genuinely long ladder turns up, that is a ticket with a reproduction rather
  than a guess.

- **2026-09-06 — which mutant each fixture rung actually defends, because the
  obvious answer was wrong.** The mirror counts are 3, 2, 2, 1, 2, and the
  question worth asking of any varied fixture is whether the variation is
  reached or merely present. Two mutants, run rather than reasoned:

  - _assumes mirrors come in pairs_ (keep the first and third of each group) —
    **3 tests red**, and what catches it is the **three**-mirror rung leaving a
    second `1280×720` row;
  - _only collapses a group it saw more than once_ — **7 tests red**, including
    `pickDefaultVariantId` returning `null`, and what catches it is the
    **one**-mirror rung.

  Two ends, two different mutants, neither interchangeable. Each now has an
  assertion naming the case it defends, so a later reader does not have to
  rediscover which rung is load-bearing for what.

- **2026-09-06 — a note on the leak sweep, since the reasoning matters more than
  the sentence.** Nothing identifying the video, its site or its hosts is in this
  branch: a sweep of 34 needles — both hosts, every path segment over six
  characters, the query string, and every identifying top-level field of the
  capture — over every tracked file, the whole branch diff and its commit
  messages returns 0. The sweep also carries a coarse tripwire for the names of
  the signed URL's query parameters, and **that tripwire fired on this Log**: an
  earlier draft of the entry above named those parameters while explaining where
  the credential sits. Nothing had leaked, and the sentence was rewritten anyway
  to describe them instead. A detector that reports true because of the prose
  documenting it is a detector the next person ignores.

- **2026-09-06 — one limit of the language column, stated rather than fixed.**
  `showLanguage` compares the strings the source wrote, and nothing normalises
  them: `Intl.getCanonicalLocales("eng")` returns `["en"]`, but this code does
  not do that mapping. So a manifest that spelled one language both ways would
  show a Language column separating `en` from `eng`. That is noise rather than
  loss — the rows are still distinct and nothing is discarded — and no such
  manifest has been observed, here or in the reported capture. Fixing it on
  speculation would mean picking a normalisation for a case nobody has seen; the
  caveat is recorded on the contract field instead.

- **2026-09-06 — where the answer came from, both halves.** Step 1 was answered
  by a **peer session's live probe** of the reported video, not by anything run
  in this worktree — the owner had opened the container's egress from the host,
  and the peer captured the master playlist and a `yt-dlp -J` dump. **Every claim
  in this ticket was then re-derived here from those artifacts rather than
  transcribed**: the stream and rendition counts, the per-rung attribute
  identity, the URL decomposition, and the format/URL multiplicity, all with
  scripts that print derived facts only so no host or URL reached a terminal.
  The strongest of them is one the peer did not run — this repo's own
  `mapYtDlpInfo` over the capture, which is what established that `id` is the
  only field differing inside a duplicated pair, and which is what the dedup key
  was chosen on. A reader deciding how much to trust the cause should know both
  halves: the evidence came from outside this worktree, and none of it is taken
  on report.

- **2026-09-06 — two citations in the Why prose were stale, and are corrected
  here.** `media.ts:107` and `web/src/lib/variants.ts:26` pointed at
  `MediaVariant.language` and `shortCodec`. **Both were already wrong on `main`
  before this branch existed** — on `main` the field was at `media.ts:121` and
  `shortCodec` at `web/src/lib/variants.ts:40` — so this is not something the branch broke.
  It is something the branch made worse: the diff edits both of those files and
  pushed the true locations further away (to `media.ts:142` and
  `web/src/lib/variants.ts:53`), and leaving a pointer into a file this branch moved is a
  cost to the next reader. Both are repointed and now carry anchor text, so
  `node scripts/citations.mjs` checks them rather than printing them for a human
  to judge — which is what stops the same silent drift next time.
