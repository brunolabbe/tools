---
id: dl-45
tool: downloader
title: A rendition's failover mirrors are discarded, not carried
kind: work-package
status: done
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

- **2026-09-07 — two notes about the gate record above, kept because a future
  reader would otherwise trust it further than it earned.**

  **`web/src/lib/variants.ts:172,232` is only half machine-checked.**
  `scripts/citations.mjs` parses `web/src/lib/variants.ts:172` and never reads
  the `,232` as
  a second reference at all — it does not appear in the seven references the
  script counts for this file. So a clean citations run over this ticket says
  nothing about line 232, even though that is where the snippet the bullet
  quotes actually lives; `web/src/lib/variants.ts:196` "collapsed: number" is
  the field's declaration, not the expression that computes it. The builder and the
  reviewer each resolved line 232 by hand, independently, and got the same line,
  so the bullet is accurate — but the evidence for it is two hand-reads, not the
  script. This entry re-states that coordinate in a shape the script _can_ read,
  `web/src/lib/variants.ts:256` "collapsed: rows.length - kept.size", so the
  claim the gate record could only hand-verify is machine-verified here. Left as one citation deliberately: splitting it would mean editing a
  committed gate record to improve the audit trail of the record rather than
  anything about this ticket.

  **Both numbers in this entry were 172 and 232 when it was written, and dl-45's
  build moved them to 196 and 256** — `variants.ts` grew a documented `mirrors`
  field and a note on `displayKey`. They are repointed here rather than left to
  rot, which is the whole argument the paragraph above makes: a coordinate is
  only machine-verifiable while it is machine-verified, and `node
scripts/citations.mjs` on this file reported both as MOVED, with the anchor
  text unchanged, before this edit. **The gate record above is deliberately not
  repointed.** It is pinned to tip `e3d065e` and names it, so its coordinates are
  correct against the tree it reviewed; rewriting them against a later tree would
  make the record claim to have checked something it never saw.

  **A reported observation here turned out to be an inference, and the mechanism
  is worth more than the correction.** The builder told the reviewer that oxfmt
  had reflowed the gate record's long lines. It had not — the committed bytes
  are identical to what was sent, measured afterwards as line lengths of 426,
  246 and 208 characters, none of them wrapped. What makes this worth a Log
  entry is that the same builder had caught the same failure in its own draft
  three steps earlier, in the dl-45 scope paragraph that contradicted Build
  step 2, and the catch did not generalise. The reason it did not: **the guard
  was pointed at the deliverable, not at the report about the deliverable.**
  Every claim about ticket content was checked against the file, because that
  was the assigned risk. The oxfmt claim was about what the builder's own tools
  had just done — `npm run format` had genuinely rewritten files earlier in the
  dispatch — so it presented as recollection rather than as an assertion, and
  recollection does not feel like something that needs a command. It is one.
  **A claim about your own process is a measurement with the same standing as a
  claim about the code, and it is the one that gets waved through**, because the
  effort of verifying tracks how risky a subject feels rather than whether the
  sentence is checkable.

- **2026-09-07 — built.** Branch `feat/dl-45-keep-the-failover-mirrors`, off
  `origin/main` at `4fad5f8`. `npm run check` exits 0;
  `npm test -- --project downloader` is 1178 passing over 73 files, and the full
  `npm test` is 2284 over 135, run because the contract moved.

  **The contract change, which Build step 1 asked to have agreed first.** The
  shape is the one the ticket named — `alternateUrls?: string[] | undefined`,
  the manifest's own order, primary excluded — with the `| undefined` spelled
  out because `exactOptionalPropertyTypes` is on and every type in `media.ts`
  needs it to satisfy its zod counterpart. Nothing beyond that shape was needed,
  so no wider contract question was opened. `mediaVariantSchema` grew the
  matching `z.array(z.string().min(1)).optional()`; the `satisfies
z.ZodType<MediaVariant>` would have compiled without it and the field would
  have been stripped at every boundary the contract guards, silently, including
  the job row read back out of SQLite — so there is a parse test rather than
  only the type.

  **What the brief had wrong, or rather had incomplete: `api` is in scope and
  the ticket names neither it nor the reason.** `alternateUrls` are fetched by
  the engine, and `urlsInProbeResult` — the inventory both the probe route and
  the orchestrator feed to the SSRF guard — enumerated `url` and `audioUrl` and
  would not have seen them. Left alone, dl-45 would have shipped a hole: a
  hostile page names a reachable primary, the guard passes it, and the engine
  follows the alternate to `169.254.169.254` on the first refusal. That is one
  loop in `api/src/ssrf.ts` and a test, and it is not optional work; it is the
  cost of the field existing. The repo rule it comes from is "SSRF-check every
  URL that a user influenced", and a failover mirror is exactly that.

  **The packages actually touched, against a ticket that budgeted none:**
  `contract`, `resolvers`, `engine`, `api`, `web`. The scope paragraph above
  named `web` as the widening; `api` was the second one and nothing predicted
  it.

  **The dl-40 objection, answered.** _"Why does a per-row mirror count not undo
  dl-40?"_ Three things, of which the first is the load-bearing one:

  1. **It does not add a row, and it cannot.** `displayKey` in
     `web/src/lib/variants.ts` is the picker's identity function and `mirrors`
     is deliberately absent from it — the one rendered value that is not in the
     key. A rendition served by three hosts and an otherwise identical one
     served by one collapse to a single row, which is asserted directly. Keying
     on the count would have rebuilt the dl-40 defect out of dl-45's own field,
     and that is the shape the objection was really about: dl-40's complaint was
     never "a number appeared", it was "two rows a person cannot choose
     between".
  2. **It is in the Delivery cell, beside `HLS`, not in Quality.** The row
     header — the thing the radio is labelled with — is untouched, asserted.
  3. **The copy says which kind of fact it is.** Visible text is `3 servers`;
     the tooltip and a `visually-hidden` span both carry _"Availability only:
     the same rendition is served from 3 hosts, so a download can fail over if
     one stops answering. Not a higher-quality rendition."_ The sentence is in
     the DOM rather than only in `title`, because `title` is not reliably
     announced and the screen-reader half of the obligation would then have been
     a claim with no test behind it.

  **The two counts coexist, and the table-level line now reads differently for a
  mirrored manifest.** The scope paragraph left this open. `collapsed` counts
  what the _picker_ merged and stays exactly as dl-40 built it; for
  `hls-master-redundant-mirrors` it is now **0**, because the resolver grouped
  the mirrors before the picker saw them, so `· N duplicate paths merged`
  disappears for that manifest and `5 renditions` stands alone. That is the
  honest number, not a regression: nothing was merged. The line is not dead —
  `ytdlp/balancer-duplicate-ladder` still produces ten variants and still merges
  five, because a load balancer handing the same ladder back under several
  hostnames arrives as separate `formats` from separate responses and no
  attribute grouping can see it. The dl-40 assertion moved onto that fixture,
  which is where the behaviour still lives.

  **How the engine tells a dead host from an expired URL, which the brief
  treated as given.** On the engine's own fetches the taxonomy already separates
  them (`UNREACHABLE` vs `VARIANT_GONE`), but the manifest path is ffmpeg, and
  `manifest.ts` files every non-zero exit as `DOWNLOAD_FAILED` whatever
  happened. So the signal is stderr, exactly as it is for
  `isTlsVerificationFailure`, and the patterns in
  `engine/src/download/failover.ts` are **measured against the bundled ffmpeg**
  at `-loglevel warning` on 2026-09-07 rather than assumed — the table is in
  that file's docblock. `Connection refused`, a DNS failure and a 5xx buy a
  mirror; 403, 404 and `End of file` do not.

  **Two coordinates in the Why above are now historical, and one of them is a
  trap.** `contract/src/media.ts:87` still resolves to `MediaVariant`'s `url`
  and is fine. `engine/src/index.ts:403` was `url: variant.url` — the line the
  sentence "the engine downloads from exactly that" was pointing at — and that
  line no longer exists; the engine loops over `downloadCandidates(variant)` and
  passes a `url` into `#downloadFrom`. Line 403 in the tree this Log entry is
  committed with happens to land on that method's `url: string` parameter, which
  reads plausibly and means the opposite. **The Why is deliberately left as
  written**: it is the dated statement of the defect, and repointing it at the
  code that fixed the defect would make the problem statement describe the
  solution. Neither coordinate is anchored, so `scripts/citations.mjs` cannot
  catch this and did not — it is recorded here instead.

  **A related label was wrong and is corrected here.** The engine e2e test named
  _"a missing Referer is a 403, which the engine reports as VARIANT_GONE"_ while
  asserting `DOWNLOAD_FAILED`. The assertion was right and the name was not, for
  the reason above. Folded in rather than filed: it is one stale sentence, in the
  exact path dl-45 had to read to classify anything, and the mislabelling is the
  ambiguity this ticket works around.

  **What the failover costs, measured.** ffmpeg's own
  `-reconnect_delay_max 10` runs first, so a mirror attempt begins roughly
  eleven seconds after the primary stops answering — `mirror-failover.test.ts`
  takes 11.3 s for that reason and not because of anything dl-45 added. Nothing
  was changed about the reconnect window; it is production behaviour and a
  failover is strictly better than the failure it replaces. A mirror attempt
  also **restarts** the download rather than resuming it, and clears the tmp dir
  first: the partial came from a host that stopped answering, and nothing proves
  the next host serves the same bytes at the same offsets.

  **Deliberately left out.** The yt-dlp tier still discards its mirrors — the
  balancer ladder above is ten variants the picker collapses to five, and the
  five alternates go on the floor exactly as the manifest's did before today.
  Build step 2 named `resolvers/src/manifest/hls.ts` and only that, so widening
  to a second producer with a different grouping rule was not this ticket's
  call; it is surfaced to the orchestrator as an open decision rather than
  settled in a commit. `TLS_VERIFICATION_FAILED` is likewise **excluded** from
  the failover, against the Why section's mention of a failed TLS handshake, and
  that exclusion is the second open decision: a rejected certificate is a signal
  dl-11, dl-19 and dl-27 all worked to surface, and succeeding quietly from
  another host would replace it with a download. Both are in the builder's
  report as options, neither is answered here.

  **The fixtures dl-40 built, and what happened to them.** All four `.m3u8`
  sources are byte-identical. `hls-master-redundant-mirrors.variants.json` was
  regenerated from the parser as its own guard test instructs — 10 variants to 5,
  carrying 3/2/2/1/2 addresses — and the other three were regenerated too, as a
  check rather than a change: they came back byte-identical, which is the
  measurement that says the grouping key touches genuine mirrors and nothing
  else. `hls-master-two-profiles` and `hls-master-per-language-ladder` now also
  assert `alternateUrls === undefined`, so the failure mode of a grouping key
  that dropped a field — silently swallowing a real choice into a failover path
  — is caught rather than reasoned about.

- **2026-09-07 — two decisions answered by the owner, both against the builder's
  recommendation, and both built.** They were surfaced as open decisions with
  options rather than settled in a commit; this entry is the record that they
  were raised, overridden, and implemented knowingly. Neither is a design
  preference that was quietly dropped.

  **1. `TLS_VERIFICATION_FAILED` now buys a mirror.** The builder recommended
  keeping it excluded and the owner chose to include it, knowing the objection.

  **The objection, which stands:** a rejected certificate is a security signal
  this repo went to some trouble to surface — dl-11 identified the ambiguity,
  dl-19 measured what two TLS backends actually write, dl-27 added the egress
  proxy's own wording — and failing over replaces a possible-MITM warning with a
  successful download from somewhere else. In the mixed case (host A MITM'd,
  host B healthy) the user is now told nothing. **No code here can give that
  warning back**: the engine has one error channel and a successful download does
  not use it. The `logger.warn` emitted on each failover names the code and is
  the only place that evidence survives.

  **The grounds it was overridden on:** this ticket's own Why names a failed TLS
  handshake as one of the two conditions that lose a download while another host
  is serving the same bytes. Excluding it made the implementation narrower than
  the brief.

  **What was checked rather than assumed, because an overridden objection that
  turns out to be load-bearing is worth stopping for.** Two things could have
  turned this from a decision into a defect, and neither does:

  - **A mirror's certificate is verified on its own terms.** `tlsVerify` and
    `tlsCaFile` are read from the engine config inside `#downloadFrom` and spread
    into `buildNetworkInputArgs` for every input on every attempt, so each
    candidate gets a fresh `runFfmpeg` with identical verification settings. The
    failover has no path to downgrade verification — it cannot pass a weaker
    setting, because it does not carry one. A second bad certificate raises the
    same code again.
  - **The last candidate's error propagates unchanged.** A wholly MITM'd path
    still surfaces `TLS_VERIFICATION_FAILED` rather than degrading into a
    generic failure, because the loop rethrows what the final attempt raised and
    never substitutes the first error. Proven at the engine level in
    `mirror-failover.test.ts` — "the last candidate's own failure is what reaches
    the caller" — with a dead primary and a 403 alternate, which also asserts the
    alternate was really tried.

  **Not measured, and named as such:** no origin with an actually-rejected
  certificate was driven end to end. Standing up an HTTPS fixture with a bad
  cert was out of proportion here, so the TLS inclusion is proven at the
  classifier level plus the two code-path reads above. A real bad-certificate
  failover has not been observed.

  **2. The yt-dlp tier groups mirrors too, which this ticket did not scope.**
  Build step 2 named `resolvers/src/manifest/hls.ts` and only that. The builder
  recommended a follow-up ticket, on the grounds that the grouping rule is
  genuinely different — separate `formats` from separate responses rather than
  attributes in one manifest — and that this branch had already outgrown its
  brief. **The owner chose to fold it in**, to close the defect in both producers
  in one pass while the context was loaded, accepting the wider branch.

  `groupMirrors` and `renditionKey` moved from `manifest/hls.ts` into
  `resolvers/src/common.ts` and both producers now call the one function. Two
  producers with two copies of "what makes these the same rendition" would drift,
  and the same manifest would then reach the picker one way through the parser
  and another through the tier.

  In `ytdlp.ts` the grouping runs **after** `dropDuplicateFormats`, and the order
  is load-bearing: an exact duplicate arriving at the grouping would become its
  own rendition's "alternate", which is a mirror on the same host — a retry
  against the machine that just failed, which is the thing this ticket exists to
  avoid.

  **The interaction that bit, and it is the one to read.** `collapsed` — dl-40's
  "N duplicate paths merged" — counts what the _picker_ merged. The first half of
  dl-45 took it to 0 for the HLS manifest fixture and the dl-40 assertion moved
  onto `ytdlp/balancer-duplicate-ladder`. Folding in the yt-dlp tier then took
  **that** to 0 as well. Measured across all five derived fixtures afterwards:
  every one reported `collapsed=0`. dl-40's collapse still had its code and no
  longer had a single fixture that exercised it — an assertion that would have
  stayed green while proving nothing.

  So `hls-master-mirrors-jittered-bandwidth.m3u8` was added, and it is the only
  fixture in the repo that now makes `collapsed` non-zero: two rungs at two hosts
  whose declared `BANDWIDTH` differs by a few hundred bps. `groupMirrors` is
  exact and correctly refuses to call them one rendition; `formatBitrate` renders
  both as `1.5 Mbps`. Four variants, two rows, `collapsed=2`.

  **That fixture is constructed, not observed, and its header says so at
  length.** Every other manifest fixture here records something a live probe
  found; this one is the reported ladder with the bandwidth digits varied, and it
  borrows none of that capture's authority. It is legitimate for the job it does
  — exercising a code path whose defect dl-40 already established — and would not
  be legitimate as evidence that the defect is real.

  **What this leaves the picker's collapse claiming is narrower and truer than
  before.** It is not a second mirror grouping. It is the layer that catches
  renditions the table _renders_ identically for reasons no producer could have
  grouped away, which is exactly what `displayKey`'s docblock always said it was
  for and what nothing had tested in isolation.

  **Scope, finally.** Packages touched by dl-45 overall: `contract`, `resolvers`,
  `engine`, `api`, `web`. Of those, `web` was named by the decision above, `api`
  was found during the build and is recorded in the previous entry, and the
  second `resolvers` producer is here by the owner's decision. A ticket with no
  `**Packages:**` line ended up touching five.

- **2026-09-07 — a gate finding, reproduced, half-corrected, and fixed rather
  than filed.** The reviewer found that `groupMirrors`, applied to the yt-dlp
  producer by the fold-in above, merges two genuinely different renditions when
  the mapper cannot tell them apart. Reproduced independently before it was
  accepted: two audio-only formats, `mp4a.40.2` at 128 kbps, distinguished only
  by `format_note: "English"` and `format_note: "French"`, came back as **one
  variant** with the French URL in `alternateUrls`.

  **The cause is that the key is read off a lossy projection.** `renditionKey`
  is built from the mapped `MediaVariant`, and `mapYtDlpInfo` discards
  `format_note` — the field yt-dlp uses for exactly this human-facing
  distinction when it has no `language`. Two different tracks therefore mapped
  to byte-identical variants, and a grouping that reads _absence of visible
  difference_ as _sameness_ merged them. The HLS producer is not exposed the
  same way: two `EXT-X-STREAM-INF` entries agreeing on every attribute are one
  rendition by RFC 8216 §6.2.4, and the parser maps every attribute it reads.

  **One half of the reported framing does not survive, and the correction
  matters.** The finding described this as losing "a real, previously-reachable
  choice". It was not previously reachable: measured, the picker's dl-40
  collapse already merged those two into one row before dl-45 existed —
  `toDisplayRows` on the ungrouped pair returns 1 row, `collapsed: 1`, keeping
  the English one. Losing that choice is **dl-40's recorded trade, not a dl-45
  regression.**

  What dl-45 genuinely added is worse than a display loss and is the reason this
  was fixed rather than documented: before, the French URL was _discarded_. Now
  it is a live failover target, so a host failure on the English track would
  **silently download French audio under the row the user chose for English**.
  Serving content the user did not select is a different class of defect from
  not offering it.

  **The decision the gate framed had a cost premise, and the premise was wrong.**
  It was put as "more correct but more work, and it touches the shared
  function's contract", with the alternative being to accept a documented risk.
  Measured instead of estimated: the guard is **two source files and about
  twenty lines**, needed **no test changes**, **no fixture regeneration**, and
  the suite stayed green at 1184. When one option is both more correct and
  nearly free, the trade the question was built on is not there, so it was not
  escalated as a decision — it was fixed, and this entry is the record for
  anyone who would have chosen differently.

  `groupMirrors` gained a `distinguish` callback: the producer's answer to what
  its own mapping threw away, defaulting to contributing nothing. HLS passes
  nothing, because its variants carry everything that separates one rendition
  from another. yt-dlp passes `format_note` keyed by `format_id`.

  **The guard is checked in both directions**, because the failure mode of
  getting it wrong is silent either way. A discriminator that was always present
  would have turned `groupMirrors` into a no-op for yt-dlp and every other
  assertion would have stayed green — so there is a test asserting the balancer
  fixture carries **no** `format_note` at all and still groups into 5 variants
  with alternates. Red-checked by stubbing the callback to `""`: the
  language-track test fails, the balancer tests do not.

  **What this does not claim.** It closes the reproduced case and the shape it
  represents. It does not prove that `format_note` is the _only_ thing
  `mapYtDlpInfo` drops that could distinguish content — `dynamic_range` and
  `audio_channels` are plausible candidates that would need contract fields
  rather than a discriminator, and neither has been observed causing a bad
  merge. Nothing here has been measured against a live site.

- **2026-09-07 — the yt-dlp fold-in is reverted by the owner, and dl-45 ships as
  the HLS-only change.** This undoes the second decision two entries above.
  **Both entries stay**: the trail is the point, and an entry rewritten to look
  like it always said this would hide that the fold-in is what found the defect.

  **What was put to the owner** was three options — narrow the guard in place
  (the gate's lean and the orchestrator's), revert the fold-in to its own
  ticket, or accept the defect as a documented risk — together with the fact the
  decision turns on: **this branch creates that defect; it does not exist on
  `main`.** The owner chose the split, over the recommendation of both the
  builder and the gate.

  The reasoning, as relayed: the fold-in was decided on "the context is loaded",
  and the context then produced a correctness defect whose fix is not obvious.
  yt-dlp needs a positive same-content signal that HLS gets free from manifest
  structure, and that is a ticket's worth of thinking rather than a guard bolted
  onto a branch already twice widened.

  **What was reverted**, all of it back to the pre-fold-in state and verified
  rather than assumed — `resolvers/src/resolvers/ytdlp.ts` is byte-identical to
  `origin/main` (`git diff origin/main -- <path>` is empty):

  - `groupMirrors` and `renditionKey` moved back out of
    `resolvers/src/common.ts` into `manifest/hls.ts`, and `common.ts` is
    untouched by dl-45 again. With HLS the only consumer, that is where they
    belong: this repo lifts shared code on the second _real_ consumer, and there
    is once again one. dl-47 is that second consumer when it lands.
  - The `distinguish` guard written against the gate's finding is gone with it,
    and is recorded on dl-47 as **option A**, with its measured cost, so the
    next builder starts from a measurement rather than an estimate.
  - `balancer-duplicate-ladder.variants.json` back to ten variants;
    `ytdlp.test.ts`, `probe-panel.test.tsx` and the balancer case in
    `presentation-helpers.test.ts` back to `collapsed: 5`.

  **What was kept, and why it stands on its own.**
  `hls-master-mirrors-jittered-bandwidth` stays. Its original justification —
  "the only fixture that still makes `collapsed` non-zero" — **died with the
  revert and its comment has been corrected rather than left to read as still
  true.** The reason it earns its place now is different and better: the two
  live collapse fixtures prove different things. The balancer's rows differ in
  their **URL alone**, which a producer _can_ group and dl-47 will, at which
  point that fixture stops exercising anything. The jittered manifest's rows
  differ in a **real number the table does not render**, which no producer may
  ever group because they genuinely are different declarations. Only the second
  is permanent. Asked to judge it on its own merits, that is the judgement, and
  it is a stronger claim than the one it replaces.

  **A correction to something in the previous entry.** That entry reported the
  guard as "suite green at 1184". The suite was green; **`npm run check` was
  not** — oxlint raised two `no-shadow` errors in the two tests the guard added
  (`info` and `probe` shadowing the describe-level bindings). It was caught on
  the run immediately after and the code is reverted regardless, so nothing
  shipped on it. It is recorded because the earlier entry read as a clean gate
  and was not: **a suite passing is not `npm run check` passing**, and reporting
  one while implying the other is the failure mode this repo keeps writing down.

  **The fold-in was not wasted, and dl-47 says so too.** It is what surfaced the
  language-merge defect before a shared grouping key reached `main`, and it is
  what surfaced the collapsed-count gap — dl-40's picker collapse having its code
  and not one fixture exercising it. Both were bought by doing the work.
