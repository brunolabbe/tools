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

**Why nobody has hit it yet.** [`index.ts:440`](../../engine/src/index.ts) sets
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
