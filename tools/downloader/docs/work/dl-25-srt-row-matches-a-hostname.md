---
id: dl-25
tool: downloader
title: A CDN hostname containing "srt" classifies the track as SubRip
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-25 — the `srt` row reads a hostname as a format claim

**Packages:** `resolvers` (`common.ts`).

## Why

`SUBTITLE_FORMATS`' second row is
[`common.ts:242`](../../resolvers/src/common.ts) —
`/(^|\W)srt(\W|$)|subrip/i`. It matches `srt` as a token _anywhere_ in the
hint, and [`dash.ts:338`](../../resolvers/src/manifest/dash.ts) builds that
hint as `` `${mimeType} ${codecs} ${fileUrl}` `` — a whole URL, host and path
included. A host or a path segment that happens to contain `srt` is therefore
read as a format claim:

```
"application/mp4  https://srt.cdn.net/sub.mp4"        -> srt   ✗  should be unknown
"application/mp4  https://cdn.net/srt/sub.mp4"        -> srt   ✗  should be unknown
"video/mp4  https://srt-edge.example.com/s/sub.mp4"   -> srt   ✗  should be unknown
"application/ttml+xml  https://srt.cdn.net/sub.ttml"  -> srt   ✗  should be ttml
```

`srt` is a plausible label for a CDN — SRT is also a widely used transport
protocol (Secure Reliable Transport), so `srt.cdn.example` and `/srt/` paths
exist in the wild for reasons that have nothing to do with SubRip.

**This one reaches the disk, and it is the reason the ticket is a `fix`.**
[`engine/src/index.ts:119`](../../engine/src/index.ts) declares
`SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])` and
[`index.ts:533`](../../engine/src/index.ts) skips any track outside it. `srt`
is _inside_ it. So where dl-24's wrong answers (`ttml`, `unknown`) caused a
track to be silently dropped, this one causes the opposite: a file that is not
a subtitle at all is downloaded, written as `sub-<i>-<lang>.srt`
([`index.ts:541`](../../engine/src/index.ts)) and handed to ffmpeg as a
subtitle stream. The blast radius is a wasted fetch and an ffmpeg failure or a
garbage track, not a crash — `#fetchSubtitles` catches per-track errors — but
it is a real wrong download.

The fourth row above is the sharper case: a genuine TTML track, correctly
described by its own mime type, is answered `srt` because the `srt` row is
scanned before the `ttml` row. Ordering is doing real work here, which is the
other half of why this is worth fixing rather than tolerating.

## Build

1. **Reproduce first.** The four hints above, through `subtitleFormat`. They
   behave identically on `origin/main` and on the dl-24 branch — this is
   entirely pre-existing and dl-24 neither caused nor worsened it.

2. **Decide what the row should mean, and say so in the Log.** The tension is
   that the row serves three callers with different amounts of context.
   `hls.ts:278` passes a bare extension (`srt`), `ytdlp.ts:256` passes
   `chosen.ext ?? chosen.url` — so possibly a whole URL — and `dash.ts:338`
   always passes a whole URL with a mime type in front. A boundary tight
   enough to reject a hostname must not reject the bare extension. Options
   worth weighing: anchoring the token to an extension position
   (`\.srt(\?|#|$)`) with a separate whole-hint alternative for the bare
   extension; or having `dash.ts` stop concatenating the URL into the hint at
   all and pass mime type and codec only, falling back to the URL's extension.
   The second is a larger change and touches a caller, but it removes the
   whole class rather than this instance — **`ttml`, `dfxp` and `stpp` are
   matched unanchored too, and have the same bug.** Confirmed while filing
   this: `"application/mp4  https://stpp.cdn.net/sub.mp4"` and
   `"application/mp4  https://cdn.net/ttml/sub.mp4"` both answer `ttml`. Those
   two are less damaging than the `srt` case only because `ttml` fails the
   `index.ts:533` gate and so is dropped rather than downloaded.

3. **Extend `common.test.ts`.** dl-24 added the table at
   `tools/downloader/resolvers/test/common.test.ts`; it has boundary probes but
   no hostname probes. Add the four hints above plus the `stpp`/`ttml`
   equivalents, and keep every existing row passing — that table is the
   regression net for this file now.

4. **Re-check the ordering comment** at `common.ts:223-239`. It currently
   documents this very defect as the reason the row order is still
   load-bearing. If the fix removes the overlap, that paragraph needs to change
   with it.

Trap: do not tighten the row by dropping `|subrip`, which is unanchored on
purpose and matches mime types like `application/x-subrip`.

## Done when

1. A DASH-shaped hint whose _host or path_ contains `srt` but whose mime type,
   codec and file extension do not, classifies as something other than `srt`,
   proven by a test.
2. `application/ttml+xml https://srt.cdn.net/sub.ttml` classifies as `ttml`,
   proven by a test.
3. A bare `srt` extension and `application/x-subrip` still classify as `srt`,
   proven by the existing table in `common.test.ts`.
4. The same hostname defect in the `ttml` row — confirmed present, see Build 2
   — is either fixed with it or filed separately. Answered in the Log, not left
   unstated.
5. `npm run check` and `npm test -- --project downloader` pass.

## Gate 1

_Recorded verbatim. Its `file:line` citations resolve against `5926400`, the
commit it reviewed, not against this branch's tip — the second pass that
answered it moved many of them (row 1's regex, the pinned block, and the
ordering paragraph all changed). 49 citations were re-resolved programmatically
against `5926400` and 48 land exactly on the line claimed; the one exception is
F2's `:96` for dl-28's Done-when 1, which is at `:94` in that commit. The
dispositions are in the Log below, not here._

### Gate 1 — `dl-25-srt-hostname` @ `5926400` — **CONCERNS**

Two `med` findings, both documentation-only, one line each. The code change is
correct and minimal. Nothing here lets a defect through in shipped code; both
meds would mislead the next reader — specifically the agent who picks up dl-28.
Tree restored and clean at `5926400`; `dist` rebuilt and verified unmutated;
final control exit 0.

#### 1. The boundary change, enumerated

**72 hand-constructed cases** run against the built function, each compared to an
independent reimplementation of the `origin/main` table. **11 changed answer.**
All 41 pre-existing `common.test.ts` rows included; none changed (suite 199/199).

| Case                       | old     | new                                        |
| -------------------------- | ------- | ------------------------------------------ |
| `.../sub.srt`              | srt     | srt                                        |
| `.../sub.srt?lang=en`      | srt     | srt                                        |
| `.../sub.srt#frag`         | srt     | srt                                        |
| `.../sub.srt/download`     | srt     | **unknown** <- the only genuine-track flip |
| `.../subs/en.srt`          | srt     | srt                                        |
| `srt` (bare, `hls.ts:278`) | srt     | srt (also `SRT`, `" srt"`, `"srt "`)       |
| `application/x-subrip`     | srt     | srt                                        |
| `text/srt`                 | srt     | srt                                        |
| `application/srt+xml`      | srt     | srt                                        |
| `text/SRT`                 | srt     | srt                                        |
| `srt.cdn.net`              | srt     | **unknown** (fixed)                        |
| `srt-edge.example.com`     | srt     | **unknown** (fixed)                        |
| `/srt/`                    | srt     | **unknown** (fixed)                        |
| `foo-srt.example`          | srt     | **unknown** (fixed)                        |
| `srtcdn.net`               | unknown | unknown (already correct)                  |

**Does the fix reject a real SubRip track? Yes — one narrow class, judged an
acceptable cost.** The lookahead `(?![\w./-])` excludes exactly `[A-Za-z0-9_]`,
`.`, `/`, `-`. All 32 possible following characters were enumerated: every other
punctuation and end-of-string still matches. The lost class is a bare URL where
`.srt` is followed by `/`, `.`, `-`, `_` or a word char:

```
https://cdn.net/s/sub.srt/download  -> unknown   (was srt)
https://cdn.net/s/sub.srt.gz        -> unknown
https://cdn.net/s/sub.srt-v2        -> unknown
```

Acceptable for a measured reason: **the loss only bites when the hint carries no
mime type and no codec.** All three recover the moment anything precedes the URL:

```
text/srt https://cdn.net/s/sub.srt/download             -> srt
application/x-subrip https://cdn.net/s/sub.srt/download -> srt
srt https://cdn.net/s/sub.srt/download                  -> srt
```

`dash.ts:338` always prefixes mime type and codecs, so DASH is immune.
`hls.ts:278` passes a bare extension, immune. Only `ytdlp.ts:256`
(`chosen.ext ?? chosen.url`) can produce a bare URL, and only when yt-dlp omits
`ext` — rare for subtitles. Against that, the fix removes a wrong _download_.

#### 2. Mutation, controlled

- **Positive control, reviewer's own command, unmutated tree:**
  `npx vitest run tools/downloader/resolvers` -> exit 0, 199 passed, 9 files.
  Re-confirmed after every restore and once more after a full `npm run build`.
- **Mutation A** (different from the builder's): weakened the lookahead to
  `(?![\w])` — kept a lookahead, dropped `./-`. -> exit 1, **4 failed**, exactly
  the four dl-25 rows (`common.test.ts:38-45`). The new tests kill it.
- **Mutation B: swapped rows 2 and 3.** -> **199/199 green.** The table does not
  catch this reorder. See F3.
- **Restore proven:** `git status --porcelain` empty after each restore, each
  restored file `touch`ed, `npm run build` re-run, `dist/common.js:225-230`
  re-read byte-for-byte. No mutated byte survived in source or `dist`.

#### 3. The pinned wrong-answer tests

**They flip, loudly.** Applying dl-28's option (b) (normalise URL-shaped tokens to
extension + query inside `subtitleFormat`) gives exit 1 with **exactly the four
pinned rows red** and nothing else:

```
x "application/mp4 https://vtt.cdn.net/sub.mp4" is vtt - dl-28, wrong: should be unknown
```

The `why` string is interpolated into the test name at `common.test.ts:79`, so the
instruction is in the failure output itself, not only in a source comment. That is
the strongest form of this pattern.

**Is the comment unmissable?** Yes. `common.test.ts:60-64`, directly above the
rows, says plainly they encode a defect and ends "Do not 'fix' these expectations
without fixing the code."

**But there is a plausible fix under which they do not flip — see F2.**

**A safer form (suggestion, no change required):** `test.fails()` (vitest 4.1.10
supports it) lets the file assert the _intended_ answer. The spec written in the
file is then the right one, and when dl-28 lands the wrapper itself goes red
demanding removal.

#### 4. Can row 1 take row 2's boundary? Measured: **yes**

Applying `(?![\w./-])` to row 1 (`common.ts:257`):

- `npx vitest run tools/downloader/resolvers` -> **1 failed / 198 passed**
- `npm test -- --project downloader` -> **1 failed / 731 passed, 50 files**

**The single failure is the pinned defect row itself** (`common.test.ts:67`,
`vtt.cdn.net`). Nothing genuine breaks. Contrast row 3, where the builder's claim
was reproduced independently: the same boundary on `/ttml|dfxp|stpp/i` turns
`stpp.ttml.im1t` (`common.test.ts:53`) red, with _or_ without the left anchor —
the collision is real and unavoidable at token level.

**25 further row-1 cases enumerated.** Under the boundary: **0 genuine claims
lost**, 3 defect cases fixed, 3 lost to the same narrow `sub.vtt/download` class
already accepted for srt, 1 hypothetical `wvtt.something` (not a real signalling
form). Notably `https://www.youtube.com/api/timedtext?lang=en&fmt=vtt` **still**
classifies `vtt`, so dl-28 Build 3's load-bearing query-string case is untouched
by widening.

**Recommendation: fix row 1 on this branch.** Cost measured at ~20 lines, blast
radius 1 test in 732. Deferring keeps a wrong download shipping, and dl-28 is a
caller-side change resting on an unmeasured premise (F5), so it may sit. The
precedent is on the ticket's own face: dl-24 deliberately left the `srt` row and
it came back as dl-25. The honest counter: Done-when 4 says "fixed with it **or
filed separately**", so deferring is fully compliant and the builder's reasoning
is sound. But the measurement says row 1 is not like row 3 — it is like row 2, and
it is in `SUBTITLE_FORMATS_FFMPEG_READS`.

#### 5. The `vtt` blast radius, verified independently

`subtitleFormat("application/mp4 https://vtt.cdn.net/sub.mp4")` -> **`vtt`** on
this branch (run against `dist/common.js`, not relayed). `engine/src/index.ts:119`
is `SUBTITLE_FORMATS_FFMPEG_READS = new Set(["vtt", "srt"])`;
`engine/src/index.ts:533` is
`if (!SUBTITLE_FORMATS_FFMPEG_READS.has(track.format))` — `vtt` passes, so the
track is **not** dropped, and `:541` writes it as `sub-<i>-<lang>.vtt`.

**Consequence:** a DASH text representation served from a host whose label is
`vtt` is fetched and handed to ffmpeg as a subtitle stream even when nothing about
it claims a subtitle format — the identical wrong-download this ticket was raised
to stop for `srt`, still live today.

#### 6. Ticket `dl-28`

- Frontmatter valid; `kind: fix`, `status: ready`, `id` agrees with filename.
- **`dl-28` genuinely free.** `origin/main` carries `dl-1`...`dl-27` (verified by
  `git ls-tree -r origin/main`, not by log subjects); `git grep dl-28 origin/main`
  empty. The only open PR at review time was #91, whose diff touches no `dl-` file.
- `depends_on: []` resolves; `--show dl-28` renders "unblocked".
- **Gate verified by making it fail first.** Baseline
  `node scripts/status.mjs --json > /dev/null` -> **0**. Injected
  `depends_on: [dl-999]` -> **exit 1**, `depends_on "dl-999", which is not a
ticket`. Restored -> **0**.

#### 7. Citations

**23 citations and links resolved programmatically, 0 missing paths.** Every
markdown link target exists; every `file:line` opens to the line claimed:
`dash.ts:338`, `ytdlp.ts:256`, `hls.ts:278`, `engine/src/index.ts:119`, `:533`,
`:541` (these two hand-checked — the resolver script matched them to the wrong
`index.ts` first), `common.ts:223`, `common.test.ts:53`, and both ticket links.
Two stale line ranges found, both in the pre-existing brief — see F6.

### Findings

##### F1 — med — the ordering comment names the _old_ boundary as if it were the fix

`tools/downloader/resolvers/src/common.ts:232`:
"both. Its `(\W|$)` now says the token has to _end_ a claim rather than"

The row is `(?![\w./-])` (`common.ts:258`). `` `(\W|$)` `` is precisely the
boundary this ticket **removed**, and precisely the one that let hostnames
through. The sentence attributes the fix to the bug.

_Failure:_ the agent picking up dl-28 reads this paragraph — the file's own
explanation of dl-25 — and applies `(\W|$)` to rows 1 and 3 believing that is
dl-25's treatment. Behaviour unchanged, the four pinned rows keep passing, suite
green, dl-28 reported done having fixed nothing. Compounding it,
`git grep '(\W|$)'` in row 2 finds nothing, so a reader checking comment against
code sees a mismatch and must guess which is right.

_Fix:_ one token — ``Its `(?![\w./-])` now says...``. No behaviour change.

##### F2 — med — dl-28's Build 4 option (a) states a measured falsehood

`dl-28-hint-carries-a-whole-url.md:70`: "fix `dash.ts` only, and the four pinned
cases go green because they are all DASH-shaped".

They do not. That exact fix was applied (`dash.ts:338` -> `urlExtension`, import
added): **199/199 green, all four pinned rows still passing and still asserting
the defect.** They are unit tests on `subtitleFormat`, which option (a) does not
touch; the hint strings are never built by `dash.ts` in that test.

This makes dl-28 self-contradictory: Done-when 1 (`:96`) requires "the pinned
wrong answers flipped", which option (a) cannot deliver. The builder reasoned this
out correctly for dl-25 (its Log argues option 2 "cannot be proven by the tests
the ticket asks for") and then wrote the opposite into dl-28.

_Failure:_ dl-28's agent picks option (a) as the cheaper branch on the strength of
this sentence, ships `dash.ts` only, sees green, and reports Done-when 1
satisfied — leaving `ytdlp.ts:256` and the classifier unfixed, the very gap
Build 3 warns about two bullets earlier.

##### F3 — low — the rows 2<->3 order is load-bearing, and nothing pins it

`common.ts:258-259`, `common.test.ts:13-75`. The rewritten comment names one order
constraint (row 1 before row 2, via `subrip`) and it holds. But **swapping rows 2
and 3 leaves the suite 199/199 green**, and that swap is not safe:

```
application/x-subrip https://cdn.net/s/sub.ttml   shipped: srt   swapped: ttml
text/srt https://cdn.net/ttml/sub.srt              shipped: srt   swapped: ttml
```

Pre-existing, not introduced here — but this branch is where the order constraints
were written down, and it documents one of two.

_Failure:_ dl-28 rewrites rows 1 and 3 and reorders while doing so. A genuine
`application/x-subrip` track whose signed URL contains `ttml`/`stpp`/`dfxp`
classifies `ttml`, fails the `engine/src/index.ts:533` gate, and is silently
dropped — the dl-24 data-loss mode — with the suite green.

##### F4 — low — the accepted regression is neither pinned nor written down

`common.ts:258`. `.../sub.srt/download`, `sub.srt.gz`, `sub.srt-v2` moved from
`srt` to `unknown`. The trade is correct, but nothing records that it _was_ a
trade — the comment at `:234-236` lists what still matches and omits what stopped.

_Failure:_ a user reports a missing subtitle from a `/files/sub.srt/download`
endpoint via `ytdlp.ts:256` with `ext` absent; the next agent finds `sub.srt`
handled in the table, no row covering the shape, and either re-widens the boundary
(re-opening dl-25) or spends an afternoon rediscovering the lookahead.

##### F5 — low — dl-28's unmeasured premise is caveated only in the Log

`dl-28...md:62` (Build 3), `:99` (Done-when 3), caveat at `:115`. Build 3 asserts
flatly that "yt-dlp subtitle URLs routinely carry the format in the query string";
Done-when 3 promotes it to an acceptance criterion. The Log does say plainly that
no yt-dlp run was made against a live site — good — but it is 50 lines below the
two places that act on it, and Build 3 is what gets pasted into an agent.

_Failure:_ dl-28's agent reads Build 3 as established and on its strength leaves
`ytdlp.ts` passing whole URLs, the decision that keeps the hostname hole open for
that caller. Note Done-when 3's test passes either way, since it asserts the
classifier's behaviour on a literal string — which is why the caveat needs to sit
where the _design_ decision is made.

##### F6 — low, no change needed — two stale line ranges, both in the brief

`dl-25...md` Why (`common.ts:242`) and Build 4 (`common.ts:223-239`). After this
branch's comment rewrite, line 242 is prose inside the comment; the row is at
`:258` and the quoted regex no longer exists. Build 4's range starts right
(`:223` is the `/**`) and ends short — the block now runs to `:255`. Both are
brief text, and a review never edits the brief; both are also accurate as
historical statements of the defect at filing time.

##### F7 — no change needed — `stpp.ttml.im1t` is real, but rests on a unit row

The blocking claim for row 3 is correct and was reproduced exactly. Recorded so
the next reader knows the in-repo evidence is `common.test.ts:53` and not a
manifest: no fixture under `tools/downloader/resolvers/test/fixtures/` carries it
(28 `codecs=` values checked across 8 DASH manifests; the dotted convention and
bare `wvtt` are both well attested there). A fixture manifest with
`codecs="stpp.ttml.im1t"` would be a cheap addition to dl-28.

##### F8 — no change needed — the fix closes the named shapes, not the class

The lookahead admits every non-`[\w./-]` character, so these still answer `srt`:
`.../live/srt` (terminal path segment), `.../srt?tok=1`, `?p=srt&q=1`,
`https://srt:8080/a.mp4`, `user:srt@cdn.net`, `#srt`. The query-position ones are
**deliberate** — the same mechanism keeping `?fmt=srt` alive for `ytdlp.ts:256` —
and the rest are dl-28's caller-side territory. The comment's phrase "a hostname
label or a path segment" slightly overstates for a segment in terminal position.

##### F9 — no change needed — correct, and worth saying

Both boundary traps the brief named were respected: `|subrip` untouched and still
unanchored (`application/x-subrip` -> `srt`, verified), and the left `(^|\W)`
untouched (`xsrt` -> `unknown`, verified). Row 3 was left alone on a measurement
rather than a judgement. Done-when 4 answered explicitly rather than silently. The
builder contradicted its own brief twice — on option 2 "removing the whole class",
and on filing rather than fixing — and both corrections are right on the evidence
reproduced here.

#### Acceptance

| #   | Done when                                                                         | Verdict  | Proof                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | DASH-shaped hint with `srt` in host/path classifies as something other than `srt` | proven   | `common.test.ts:38`, `:39`, `:40` — all red under mutation A                                                                                                                                      |
| 2   | `application/ttml+xml https://srt.cdn.net/sub.ttml` -> `ttml`                     | proven   | `common.test.ts:41-45`; re-run independently, red under mutation A                                                                                                                                |
| 3   | Bare `srt` and `application/x-subrip` still `srt`                                 | proven   | `common.test.ts:28`, `:30`; plus 28 further srt-claim shapes enumerated, 0 lost                                                                                                                   |
| 4   | The same defect in the `ttml` row fixed or filed, answered in the Log             | proven   | dl-25 Log; `dl-28-hint-carries-a-whole-url.md`; `status --json` exit 0, gate verified by induced failure                                                                                          |
| 5   | `npm run check` and `npm test -- --project downloader` pass                       | verified | builder's run accepted per brief; downloader project re-run (732 tests) during item 4, 731/732 with only the mutation red; `npx vitest run tools/downloader/resolvers` exit 0 four separate times |

#### What this gate did NOT do

- `npm run check` not re-run (settled in the brief).
- **The downloader e2e suite and the container image gate do not run in this
  loop.** Nothing on this branch touches what the container ships or what the
  browser loads, but neither was run and this is not coverage.
- **Nothing was run against a live CDN, a real DASH manifest, or yt-dlp.** Every
  result is the classifier and its table. The `fmt=vtt`-in-query premise
  underpinning dl-28 Build 3 remains unmeasured (F5), and no fixture in this repo
  contains `stpp.ttml.im1t` (F7).

## Log

- **2026-08-23** — Filed from gate 1 on
  [dl-24](./dl-24-classify-wvtt-as-webvtt.md). dl-24 fixed the `vtt` and `ttml`
  rows and deliberately left the `srt` row alone; the reviewer found this
  latent defect beside it and confirmed leaving the row alone was right, since
  it is pre-existing and out of that ticket's scope. Reproduced against both
  `origin/main`'s table and the dl-24 branch's — identical answers on both, so
  nothing about dl-24 is implicated. The `application/ttml+xml` case in the Why
  is one this builder found while reproducing, and is worse than the gate
  reported: it is a correctly-described subtitle being mislabelled, not just a
  non-subtitle being picked up.

- **2026-08-23** — Built. Row 2 is now
  `/(^|\W)srt(?![\w./-])|subrip/i`: the only change is the right boundary,
  `(\W|$)` → `(?![\w./-])`. `(\W|$)` let `srt` be followed by any non-word
  character, which is every hostname and path separator there is; the lookahead
  says the token may not continue into a `.`, `-` or `/`, so it has to _end_ a
  claim. `subrip` is untouched and still unanchored (the named trap), and the
  left `(^|\W)` is untouched (dl-24's trap).

  **Reproduced first, before any edit.** All four hints in the Why reproduce
  verbatim on this branch's `origin/main` base, and so do the two extra
  `stpp`/`ttml` cases:

  ```
  "application/mp4  https://srt.cdn.net/sub.mp4"       -> srt
  "application/mp4  https://cdn.net/srt/sub.mp4"       -> srt
  "video/mp4  https://srt-edge.example.com/s/sub.mp4"  -> srt
  "application/ttml+xml  https://srt.cdn.net/sub.ttml" -> srt
  "application/mp4  https://stpp.cdn.net/sub.mp4"      -> ttml
  "application/mp4  https://cdn.net/ttml/sub.mp4"      -> ttml
  ```

  **Build 2, the design decision: option 1 (anchor the token), not option 2
  (stop `dash.ts` concatenating the URL).** Two things decided it, and the
  second contradicts the brief.

  First, option 2 cannot be proven by the tests the ticket asks for. Build 3
  says extend the `common.test.ts` table with these four hints, and Done-when 1
  and 2 name hint strings and say "proven by a test". Under option 2 those
  strings are never built, so `subtitleFormat` keeps answering `srt` for all of
  them and the new rows would have to assert the defect. The acceptance and the
  regression net both live at the function, so the fix has to as well.

  Second — **the brief is wrong that option 2 "removes the whole class"**. It
  does not, for two independent reasons. `ytdlp.ts:256` passes
  `chosen.ext ?? chosen.url`, so a whole URL still reaches the matcher whenever
  yt-dlp omits `ext`; fixing only `dash.ts` leaves that caller with the same
  bug. And the obvious repair for ytdlp — reduce the URL to `urlExtension` —
  is a _regression_, because yt-dlp subtitle URLs commonly carry the format in
  the query string (a YouTube timedtext URL ends `&fmt=vtt`) and the path
  extension is nothing useful. Passing the URL is load-bearing there. Option 2
  is a partial fix wearing a total fix's description.

  **Done-when 4 — partly fixed, partly filed as
  [dl-28](./dl-28-hint-carries-a-whole-url.md); see the 2026-08-24 entry, which
  supersedes the answer below for row 1.**
  Row 3 provably cannot take row 2's new boundary, and this is the sharp reason
  rather than a scope judgement: `stpp.ttml.im1t` is a real DASH `codecs=`
  string whose dots separate a claim, `stpp.cdn.net` is a hostname whose dots do
  not, and both are `stpp` followed by `.`. Measured, not reasoned — applying
  `(?![\w./-])` to row 3 turns the existing `stpp.ttml.im1t` row of the table
  red. So row 3 needs the caller-side change, which is a different ticket's
  worth of work and touches `dash.ts`.

  **A finding the brief did not have: row 1 is exposed identically, and worse.**
  `subtitleFormat("application/mp4 https://vtt.cdn.net/sub.mp4")` answers `vtt`,
  and `vtt` is _inside_ `SUBTITLE_FORMATS_FFMPEG_READS`, so it has the same
  reaches-the-disk blast radius this ticket was raised for — unlike the `ttml`
  cases, which are dropped at that gate. It is left unfixed here because it is
  outside this ticket and one fix closes it together with row 3; it is folded
  into dl-28 with its own pinned test rather than left as prose.

  All four of dl-28's cases are pinned in the table as the **wrong** answers
  they currently give, under a comment saying so, so dl-28 has a failing target
  to flip rather than a paragraph to re-derive.

  **Build 4, the ordering comment: rewritten.** The overlap it documented is
  gone — `https://srt.cdn.net/sub.wvtt` no longer matches row 2 at all, so it is
  no longer an example of order deciding anything. Order is still load-bearing,
  for a narrower reason now stated instead: the alternatives that are unanchored
  on purpose, `subrip` in row 2 and the whole of row 3, so
  `https://cdn.net/subrip/sub.vtt` matches rows 1 and 2 both and answers `vtt`
  only because `vtt` is scanned first.

  **Mutation check, with its control.** Control first, on the unmutated tree:
  `npx vitest run tools/downloader/resolvers` → exit 0, 199 passed. Then the fix
  reverted to `(\W|$)` in place, same command → exit 1, `4 failed | 195 passed`,
  and the four are exactly the four dl-25 rows. Fix restored, green again. The
  harness can fail.

  Gates: `npm run check` and `npm test -- --project downloader`, both green.
  Not measured: nothing was run against a live DASH manifest or a real CDN —
  the whole of this is the classifier and its table.

- **2026-08-24** — Second pass, after gate 1 came back CONCERNS. The gate is
  recorded above in full; this is what changed and why.

  **Row 1 is now fixed too, and the earlier decision to defer it was wrong.**
  The first pass left row 1 (`vtt`) alone as "the same class as row 3", filed it
  into dl-28, and said so. That reasoning was not measured — it was inferred
  from row 3's collision — and the gate measured it. Applying `(?![\w./-])` to
  row 1 gives 1 failure in 732 on the downloader project, and the failure is
  this branch's own pinned `vtt.cdn.net` row; 25 further row-1 shapes lose 0
  genuine claims. I reproduced both before touching anything: the full project
  run is `1 failed | 731 passed`, single failure the pinned row, and
  `https://www.youtube.com/api/timedtext?lang=en&fmt=vtt` still answers `vtt`,
  so dl-28's load-bearing query-string case is untouched. Row 1 is not like row
  3 — it is like row 2, it is inside `SUBTITLE_FORMATS_FFMPEG_READS`, and
  leaving it was leaving a wrong _download_ shipping. Widened on the user's
  decision. Both rows now carry the identical lookahead, which is also the
  honest shape: one boundary, one explanation.

  **Row 3 stays deferred**, unchanged, and for the reason already measured —
  `stpp.ttml.im1t` needs the dots the boundary rejects, with or without the left
  anchor. dl-28 is now genuinely a one-row ticket and has been rewritten to say
  so, including that it is the _milder_ half now that the two disk-reaching rows
  are fixed.

  **F1 — fixed.** The ordering comment said "Its `(\W|$)` now says the token has
  to _end_ a claim". `(\W|$)` is the boundary this ticket _removed_: the sentence
  credited the bug with the fix, and would have handed dl-28's agent the broken
  boundary as the pattern to copy. The paragraph now names `(?![\w./-])` and
  says explicitly that it is the boundary to copy.

  **F2 — reproduced, and the reviewer is right.** dl-28's Build 4 option (a)
  claimed a `dash.ts`-only fix turns the pinned rows green. I applied exactly
  that change (`dash.ts:338` → `urlExtension`, import added) and got **199/199
  green with all pinned rows still passing and still asserting the defect**,
  because they are unit tests on `subtitleFormat`, which `dash.ts` never
  touches. Restored, tree verified clean.

  Worth naming the pattern rather than just the bug, because the argument was
  already in my hand. I rejected dl-25's own option 2 on precisely this ground —
  "cannot be proven by the tests the ticket asks for" — and then wrote the
  opposite into dl-28 an hour later. What differed is that I _tested_ the
  dl-25 claim and _narrated_ the dl-28 one: the reasoning was sound both times,
  but only one of them was run. A brief I write for someone else deserves the
  same gate as code I write for myself, and it did not get it. dl-28's Build 4
  now carries the measurement, and its Done-when 1 warns that option (a)
  requires rewriting the acceptance rather than claiming it.

  **F3 — recorded in dl-28, not pinned here**, per the user's decision. Swapping
  rows 2 and 3 leaves the suite green while misclassifying genuine
  `application/x-subrip` tracks whose URL contains `ttml`. The reorder it guards
  against is dl-28's change, not this one's, so the caution and the
  "pin it here" instruction live in dl-28 Build 6 and its Done-when 4. The
  ordering paragraph in `common.ts` now names both order constraints and says
  plainly that neither is pinned.

  **F4 — fixed.** The regression the boundary buys (`sub.srt/download`,
  `sub.srt.gz`, `sub.srt-v2` → `unknown`) was accepted silently. It is now three
  table rows and a paragraph in the comment, including the recovery — anything
  in front of the URL brings it back, so only `ytdlp.ts:256` with `ext` absent
  can reach it. Re-widening the boundary is now a decision someone takes against
  a red test, not an accident.

  **F5 — fixed in dl-28.** The unmeasured yt-dlp query-string premise was
  caveated only in that ticket's Log, 50 lines from the Build step that acts on
  it. Build 3 now carries "(**unmeasured — see Log**)" inline and says what to
  do if it does not hold.

  **F6 (stale line ranges in this brief), F7, F8, F9 — no change**, as the gate
  recorded them. F7's point that `stpp.ttml.im1t` rests on a unit row rather
  than a fixture is folded into dl-28 Build 1 as a cheap improvement to make
  there.

  **On the `test.fails()` suggestion — keeping the current form, deliberately.**
  The gate offered it as strictly-harder-to-misread and marked it no-change.
  Two reasons to stay: the `why` string is interpolated into the test name, so
  the "should be unknown" instruction is already in the failure output rather
  than only in a source comment, which the gate itself calls the strongest form
  of the pattern; and the pinned rows live inside a single `CASES` table whose
  uniformity is the reason the table works as a regression net — one row in a
  different shape costs the `for` loop its single form and the
  "covers every return value" assertion its input. If dl-28 finds itself
  carrying pinned rows for longer than one ticket, `test.fails()` is the right
  next move.

  **Gate re-run after all of the above** — commands and results in the report;
  nothing here was written before the command it describes exited.
