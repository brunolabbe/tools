---
id: dl-42
tool: downloader
title: The direct tier claims audio it never checked, and the picker cannot name what it found
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: hard
---

# dl-42 — a progressive file asserts an audio track, and ffmpeg is told to map it

**Packages:** `resolvers` (`resolvers/direct.ts`), `contract` (`media.ts` — see the
open decision), `web` (`components/VariantTable.tsx`), `engine` (`mux.ts`, if the
fix lands there instead).

## Why

Reported from a session on 2026-09-05: a pasted `.mp4` URL produced a picker row
with every column blank except size and delivery.

| QUALITY | VIDEO | AUDIO | BITRATE | SIZE   | DELIVERY    |
| ------- | ----- | ----- | ------- | ------ | ----------- |
| —       | —     | —     | —       | 2.0 MB | PROGRESSIVE |

Most of that is correct and should stay. The direct tier reaches a plain file
with one HEAD ([`direct.ts:242`](../../resolvers/src/resolvers/direct.ts)), and a
HEAD carries `Content-Length` and `Content-Type` and nothing else — so width,
height, fps, codecs and bitrate are genuinely unknown, and `UNKNOWN` in
[`web/src/lib/format.ts:7`](../../web/src/lib/format.ts) reporting `—` is the
same rule as "never fake progress", applied correctly.

**One cell in that row is not honest, and it is not cosmetic.**
[`direct.ts:260`](../../resolvers/src/resolvers/direct.ts) hardcodes
`hasAudio: true` on a variant built from a response that says nothing about
audio. That value is not confined to display. The engine reads it:

- [`engine/src/index.ts:481`](../../engine/src/index.ts) —
  `if (variant.hasAudio) take.push("audio")`.
- [`engine/src/mux.ts:307`](../../engine/src/mux.ts) —
  `optional: kind === "subtitle"`, so an audio map is emitted **without** the
  trailing `?` that makes ffmpeg tolerate a missing stream
  ([`formatMapArg`, mux.ts:141`](../../engine/src/mux.ts)).

Against a progressive file with no audio track, ffmpeg is handed `-map 0:a` for
a stream that does not exist and exits with `Stream map '0:a' matches no
streams`. The job fails, and the taxonomy has no code that means "we guessed".

**Why nobody has hit it yet.** [`engine/src/index.ts:440`](../../engine/src/index.ts) sets
`alreadyInTargetContainer` when the source extension already matches the target,
and [`:463`](../../engine/src/index.ts) skips the mux stage entirely when that
holds with no separate audio and no subtitles. The common case — an `.mp4` into
the default `mp4` container — is a byte-for-byte passthrough that never reaches
`take`. The guess only bites when a mux is actually required.

### Reproduction

1. Serve a progressive video file **with no audio track** (`ffmpeg -f lavfi -i
testsrc=d=3 -an silent.mp4` is enough) from the e2e fixture origin.
2. Paste its URL. The direct tier answers; the row renders as above.
3. Choose a container that is _not_ the source extension — `mkv` or `webm` —
   so `alreadyInTargetContainer` is false and `needsMux` is true.
4. The job fails in the mux stage on `-map 0:a`.

Step 3 is the whole reproduction. Skip it and the bug is invisible.

## The open decision

**`hasAudio` is required in the contract**
([`contract/src/media.ts`](../../contract/src/media.ts)), so the direct resolver
has nowhere to put "unknown" and `true` is the lie it currently tells. Three ways
out, and this is not a builder's call to make quietly — CLAUDE.md forbids editing
a contract unilaterally.

- **A. Make `hasAudio` optional in the contract**, `undefined` meaning unverified,
  and have the engine map audio optionally when it is. Honest at the source, and
  the UI can then say "unknown" instead of `—`. Costs a contract change every
  sibling package sees, and every existing `variant.hasAudio` read becomes a
  three-way check.
- **B. Leave the contract alone; make the audio map optional in the engine**
  when the variant came from a tier that cannot know — or unconditionally, since
  `-map 0:a?` is harmless when the stream _is_ there. One line in
  [`mux.ts:307`](../../engine/src/mux.ts), no contract churn. But the variant
  still carries a false claim, and the next consumer of `hasAudio` inherits it.
- **C. Sniff it.** The direct tier already issues a ranged GET in some paths
  ([`direct.ts:136`](../../resolvers/src/resolvers/direct.ts)); a container probe
  of the first bytes could answer for real. Most faithful, most expensive, and it
  puts parsing in a tier whose whole point is that it does none.

**B is the cheapest correct fix and A is the honest one; they are not exclusive.**
Recommendation: do B first so no download can fail on a guess, and take A only if
a second consumer of `hasAudio` needs to tell "no audio" from "we did not look".

## Build

1. Write the failing test first — a silent progressive fixture muxed into a
   non-matching container. It must fail on `main` before anything is changed;
   a fixture whose extension matches the requested container proves nothing,
   because `needsMux` short-circuits.
2. Apply the chosen option above. If B: `optional` at
   [`mux.ts:307`](../../engine/src/mux.ts) stops being `kind === "subtitle"`.
3. **Separately, and independent of that decision:** the picker throws away the
   only informative string it holds. `buildLabel` produces `Direct MP4 · 2.0 MB`,
   [`toVariantRow`](../../web/src/lib/variants.ts) copies it to `row.label`, and
   [`VariantTable.tsx`](../../web/src/components/VariantTable.tsx) never renders
   it — it renders `row.resolution`, which is `—`. `JobCard` _does_ use
   `variant.label` ([`JobCard.tsx:50`](../../web/src/components/JobCard.tsx)), so
   the row with the least to say is the only place the label is withheld, and the
   radio the user is asked to choose has no visible name. Fall back to
   `row.label` when the resolution is unknown.

## Done when

- A test drives a silent progressive variant through the engine into a container
  that forces a mux, and the download completes rather than failing on
  `-map 0:a`. It fails on `main`.
- A test asserts the direct resolver does not report a verified-sounding
  `hasAudio` for a response that never mentioned audio — phrased against
  whichever option was taken.
- A component test asserts a rendition with no width or height still renders a
  name in the Quality column rather than `—`.
- `npm run check` and `npm test` pass.

## Log

- **2026-09-05 — filed.** Found while answering a question about why the picker
  showed a blank row for a direct `.mp4`; the blank row itself is correct
  behaviour and is not what this ticket is about. The `hasAudio` claim was
  initially read as a cosmetic dishonesty and written up as such; tracing it into
  [`engine/src/index.ts:481`](../../engine/src/index.ts) and
  [`mux.ts:307`](../../engine/src/mux.ts) is what turned it into a `fix` with a
  reproduction. The reporter's own download succeeded, which is why the
  `needsMux` short-circuit is documented above rather than left to be
  rediscovered — it is the reason this has survived since the direct tier landed.
- **2026-09-05 — built, option A.** The owner chose **A** over the brief's own
  recommendation of B, so `hasAudio` is now `hasAudio?: boolean | undefined` in
  the contract with `undefined` meaning "we did not look", distinct from `false`
  meaning "we looked and there is none". What the brief had right, wrong, and
  missing:

  **Right.** All four proposed sites are exactly where it said they were. The
  reproduction is real and the `needsMux` short-circuit is the reason it hid.

  **Wrong in one detail, and it matters for grepping.** The failing argument is
  `-map 0:a:0`, not `-map 0:a`: `mux()` always sets `streamIndex: 0`. ffmpeg
  exits **234** with `Stream map '0:a:0' matches no streams. To ignore this, add
a trailing '?' to the map.` — captured from the pre-fix run of the test below.

  **Missing, and this is the substance of the ticket.** The brief lists four
  sites; there are eight reads of `variant.hasAudio` across four packages, and
  five of them needed a decision rather than a rename:

  - `contract/src/api.ts` — the zod schema, unmentioned by the brief and the one
    that would have failed loudest: `hasAudio: z.boolean()` rejects a variant
    that omits the field, so a resolver honest about its ignorance could not have
    crossed the wire at all. Now `.optional()`.
  - `engine/src/index.ts` (the hls/dash arm, not the `take` line) — passes
    `hasAudio` into the manifest download. Now `!== false`.
  - `engine/src/estimate.ts` — adds an assumed audio bitrate for a separate
    rendition. Now `!== false`: over-estimating a size limit is the safe side.
  - `api/src/jobs/variant-selection.ts`, twice — `audioScore` is now three-way
    (verified 2, unverified 1, silent 0) and the `audioOnly` filter keeps
    anything not known-silent. Under truthiness, an unverified variant would have
    been ranked below a confirmed-silent one and dropped from an audio-only
    request, which is the "coerce to false" failure this option exists to stop.
  - `web/src/lib/variants.ts` — `VariantRow.hasAudio: boolean` is now
    `audio: "present" | "absent" | "unverified"`, so the picker cannot collapse
    the states by accident and the Audio column distinguishes `none` (checked)
    from `—` (not checked).

  **Narrower than the brief implies.** `download/manifest.ts` and
  `download/segments.ts` already emit their audio maps with `optional: true`, so
  `mux()` was the only path that could ever have failed. The engine now maps
  audio optionally _only_ when the claim is unverified, via a new
  `MuxInputFile.unverified` — mapping it optionally unconditionally is the
  brief's option B, and doing both would erase the distinction A was chosen for.

  **Folded in.** `resolvers/src/browser/variants.ts` `progressiveVariants` makes
  the identical unchecked claim from a network hit and produces `progressive`
  variants that reach the identical mux. Fixing one and not the other would have
  left the same download failing by the other route.

  **The picker item, unchanged in substance.** `VariantTable.tsx` did render
  `row.resolution` and never `row.label`, while `JobCard.tsx` uses
  `variant.label`. `VariantRow` gains a `quality` field — the resolution when
  there is one, the label when there is not, and the `—` marker when there is
  neither, because an empty label is not an improvement on a marker.

  **Where the tests live, and why.** The end-to-end proof drives the real direct
  resolver into the real engine, so it needs both packages and lives in
  `api/test/silent-progressive-mux.test.ts`; `engine` importing `resolvers` would
  invert the tool's layering. Note that `@downloader/engine` resolves to `dist`,
  so that file measures the **build**: a mutation checked without
  `npm run build` first passes while proving nothing.

  **The line numbers in _Why_ are pre-fix and are left as filed.** They describe
  `4a4cc4f`, which is the state the reproduction was taken against, and
  rewriting them would delete the record of where the defect was. On the fix
  they read: the `take` line is `engine/src/index.ts:488`, the map optionality
  is `engine/src/mux.ts:286` (inside the new `buildInputMaps`), the schema is
  `contract/src/api.ts:113`, and `direct.ts:260` is now a comment saying why
  nothing is written there. `scripts/citations.mjs` reports all thirteen as
  unanchored rather than moved, because none of them carries anchor text.
