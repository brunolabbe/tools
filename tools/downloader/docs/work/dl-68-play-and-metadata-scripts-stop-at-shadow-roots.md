---
id: dl-68
tool: downloader
title: PLAY_SCRIPT and the metadata audio fallback stop at shadow roots
kind: fix
status: done
milestone: null
depends_on: [dl-61]
difficulty: standard
---

# dl-68 — `PLAY_SCRIPT` and the metadata audio fallback stop at shadow roots

## Why

dl-61 made the surface click's chooser shadow-piercing, through a new
`ALL_VIDEOS_FN` walk in `resolvers/src/browser/provoke.ts`. Two other
in-page scripts in that same file still collect media with a plain
`document` query, which does not descend into an open shadow root:

- `PLAY_SCRIPT` — `document.querySelectorAll('video, audio')`, the blanket
  `.play()` attempt run in every scriptable frame after the clicks.
- `METADATA_SCRIPT`'s audio fallback — `document.querySelector('audio')`,
  reached when the video chooser returns nothing. Its _video_ half already
  goes through `CHOOSE_VIDEO_FN`, so dl-61 fixed that half and only this one.

So a player that starts on `.play()` rather than on a `click`, and lives in
an open shadow root, is still not provoked. **Never a wrong video**: the probe
falls through to `NO_MEDIA_FOUND`, the code the registry already uses to try
the next tier.

### Reproduction, 2026-09-17

Measured by `ticket-reviewer` (agent `a17a6bc218906c464`), dl-61's gate,
2026-09-17, at `7d801d6` — before dl-61's gate record existed. `8526a1c`, the
current tip, is documentation only and touches neither script, so the
measurement holds there unchanged. Recorded in dl-61's `## Review` section; the
reviewer's own words, minus a closing sentence about where it was routing the
measurement:

> **measured, not a finding** — the Log's own open question ("fold in or
> file"): built a scratch fixture, a shadow-root `<video>` whose media loads
> only via `.play()`, with no click listener at all. Probed it on this branch
> (temporary test appended to `browser-resolver.test.ts`, then reverted): the
> resolver throws `AppError NO_MEDIA_FOUND` — it does **not** find the media.
> Command:
> `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "shadow-root media that only loads on play"`.
> `PLAY_SCRIPT` and `METADATA_SCRIPT`'s `document.querySelector('audio')`
> fallback both stop at shadow roots, unchanged by this ticket, exactly as the
> Log says.

**The mechanism, in the reviewer's words**, is stronger than the symptom:
`PLAY_SCRIPT`'s `document.querySelectorAll('video, audio')` "can't even find
this element to call `.play()` on it, so the `play` listener never fires and
`start()` never runs". And the failure is a throw, not a thin result — the
`AppError` comes out of `resolver.resolve()` itself, from `classify.ts`'s
`NO_MEDIA_FOUND`, the same path a page with genuinely no media takes.

The fixture and the temporary test were scratch, reverted rather than
committed. The reviewer supplied both so this ticket carries a reproduction
someone can re-run rather than a command name. Fixture, served as
`/dl61-gate-play-only.html` — note there is no `click` listener, and nothing
in the page ever calls `.play()`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-root player, play() only</title>
  </head>
  <body>
    <h1>Shadow-root player, play() only</h1>
    <div id="host"></div>
    <p id="status">idle</p>
    <script>
      (function () {
        var opts = {};
        opts.mode = "open";
        var host = document.getElementById("host");
        var sr = host.attachShadow(opts);
        sr.innerHTML = '<video id="sv" width="640" height="360" muted playsinline></video>';
        var started = false;
        function start() {
          if (started) return;
          started = true;
          document.getElementById("status").textContent = "loading";
          fetch("/media/related/master.m3u8")
            .then(function (r) {
              return r.text();
            })
            .then(function () {
              return fetch("/media/related/v720.m3u8");
            })
            .then(function () {
              document.getElementById("status").textContent = "playing";
            })
            .catch(function () {});
        }
        var sv = sr.getElementById("sv");
        sv.addEventListener("play", start);
      })();
    </script>
  </body>
</html>
```

Temporary test, appended to `browser-resolver.test.ts` and reverted after the
run:

```ts
describe("dl-61 GATE MEASUREMENT scratch (not part of the suite, reverted after run)", () => {
  test(
    "shadow-root media that only loads on play(), never on click",
    { timeout: TEST_TIMEOUT_MS },
    async () => {
      const hls = recordingHlsParser();
      const resolver = new BrowserResolver({ pool, hlsParser: hls.parser, quietMs: 1200 });
      server.requests.length = 0;
      const result = await probe("/dl61-gate-play-only.html", resolver);
      console.log("GATE_MEASUREMENT_RESULT_URL:", result.variants[0]?.url);
      console.log("GATE_MEASUREMENT_REQUESTS:", JSON.stringify(server.requests));
    },
  );
});
```

It never reached either `console.log`: `probe(...)` threw first. (A committed
version of this test belongs in the suite proper and would not log; the block
above is quoted as run.)

## Build

1. In `resolvers/src/browser/provoke.ts`, give `PLAY_SCRIPT` and
   `METADATA_SCRIPT`'s audio fallback a shadow-piercing candidate list.
   **`ALL_VIDEOS_FN` already exists for exactly this walk** (dl-61) — it takes
   one root's own matches first and only then descends into that root's shadow
   roots, which is Playwright's own locator order. Generalise it to a tag list
   (`video, audio`) rather than writing a second walk; two walks that can drift
   apart is what dl-55's `CHOOSE_VIDEO_INDEX_FN` split exists to prevent.
2. **Order does not matter for either caller, and that is worth keeping true.**
   `PLAY_SCRIPT` calls `.play()` on every element it finds, and the metadata
   fallback wants any `<audio>`. Neither hands an index to a locator, which is
   the constraint dl-61's Build step 2 was about. If a future caller does, it
   inherits `ALL_VIDEOS_FN`'s order, which is already aligned.
3. A closed shadow root stays out of scope, as in dl-61: nothing in the DOM can
   see inside one.
4. **Tests**, at the _end_ of `resolvers/test/browser/browser-resolver.test.ts`
   (merged gate records cite lines in the middle of that file; dl-61's Log
   explains). Two fixtures beside dl-61's `shadow-player.html`:
   - a shadow-root `<video>` with **no** click listener whose media loads only
     on `.play()` — the reproduction above;
   - a shadow-root `<audio>`, for the duration fallback. `provoke.test.ts`
     calls `readMetadata` directly and is the cheaper home for that one:
     a full probe's `durationSec` comes from the parsed manifest and always
     wins over the fallback, which is why dl-55 added that file.
     Revert each change on its own and record in the Log which test goes red.

## Done when

- The reproduction above returns the stream instead of `NO_MEDIA_FOUND`.
- The duration fallback reads a shadow-root `<audio>`'s duration.
- Reverting each half reddens the test built for it (file:line in the Log).
- `npm run check` and `npm test -- --project downloader` pass.

## Log

**2026-09-17 — filed** from dl-61's gate, which measured this while checking
whether dl-61's own fix was complete. The owner chose filing over folding it
into dl-61's branch (answered 2026-09-17, options: file a `dl-` ticket, or
fold in), matching what both the builder and the gate recommended. Not built
against.

**2026-09-19 — built** on `dl-68-shadow-root-play-metadata`, off `origin/main`
at `fb15bc9`.

**Reproduced before any fix.** Ran the reviewer's own gate command against the
unmodified branch: `npx vitest run
tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "dl-68"`
after adding the play-only test below — `NO_MEDIA_FOUND`, matching the gate's
measurement exactly. The premise holds.

**What changed**, all in `resolvers/src/browser/provoke.ts`. `ALL_VIDEOS_FN`
(dl-61's shadow-piercing walk) is renamed `ALL_MEDIA_FN` and generalised to
take a `selector` parameter instead of a body hardcoded to `'video'`, per
Build step 1 — one walk, not two that could drift apart. Every existing call
site now passes `'video'` explicitly (`CHOOSE_VIDEO_FN`,
`CHOOSE_VIDEO_INDEX_SCRIPT`, `UNMARK_VIDEO_SCRIPT`), and two new call sites use
it:

- `PLAY_SCRIPT` now builds its candidate list from `ALL_MEDIA_FN('video,
audio')` instead of `document.querySelectorAll('video, audio')`.
- `METADATA_SCRIPT`'s duration fallback now reads
  `(ALL_MEDIA_FN)('audio')[0] || null` instead of
  `document.querySelector('audio')`.

Order was not a concern for either caller (Build step 2): `PLAY_SCRIPT` calls
`.play()` on everything the walk returns, and the metadata fallback takes only
the first `<audio>`, so neither needs to agree with a locator's `nth(index)`.

**Tests**, appended to the end of the two files the ticket named, so no _test_
citation moved. **That claim originally read "so no merged gate record's
citations moved", which was wrong**: the gate caught it. Appending tests at
the end of a test file does not move its own line numbers, but the docstring
lines this ticket added to `provoke.ts` did move four `provoke.ts` citations
in dl-55's merged Review record — see "Citations repaired" below.

- `tools/downloader/resolvers/test/browser/browser-resolver.test.ts:816`
  ("starts a shadow-root player with no click listener at all"), fixture
  `shadow-player-play-only.html` — the same shape as dl-61's
  `shadow-player.html` but with a `play` listener instead of a `click`
  listener, so only `PLAY_SCRIPT`'s walk can start it.
- `tools/downloader/resolvers/test/browser/provoke.test.ts:56` ("reads a
  shadow-root `<audio>`'s duration when there is no video at all"), fixture
  `shadow-audio-duration.html` — no `<video>` at all, so `CHOOSE_VIDEO_FN`
  returns null and the audio fallback is what is under test, the same
  isolation `provoke.test.ts`'s existing duration test uses and the reason
  Build step 4 named this file as the cheaper home for it.

**Reverted each half on its own, rebuilt, reran, restored** (`cp` from a saved
copy, `git status --porcelain` clean afterwards):

| change reverted                                                                    | test                           | result                                                                                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAY_SCRIPT`'s candidate list back to `document.querySelectorAll('video, audio')` | `browser-resolver.test.ts:816` | red — `AppError NO_MEDIA_FOUND`, thrown from `classify.ts`'s `NO_MEDIA_FOUND` path, exactly as the ticket's reproduction and dl-61's gate described |
| `METADATA_SCRIPT`'s audio fallback back to `document.querySelector('audio')`       | `provoke.test.ts:56`           | red — `durationSec` came back `null` instead of `217`                                                                                               |

Both went green again once restored.

**Citations repaired in dl-55's Review record** (gate finding, med), the same
kind of drift dl-61's Log already repaired once. The docstring lines added to
`provoke.ts` (the rename to `ALL_MEDIA_FN` and its two comment additions,
including the one below repairing the reviewer's second finding) moved four
citations there: `provoke.ts:373→386→398` (twice — the leading text of the
line the citation quotes, `var media = chooseVideo()`, is unchanged; dl-68
appended an `ALL_MEDIA_FN('audio')` fallback after it on the same line),
`provoke.ts:615→628→640` and `provoke.ts:208→214→226` (both unchanged
declarations, only their line moved). All four repointed to their current
line with the same anchor text, following dl-61's precedent: no verdict or
anchor text changed, only the line number and, where a "content unchanged"
annotation was no longer accurate, a one-clause correction to what stayed
unchanged. `node scripts/citations-gate.mjs --against origin/main`: 89
enforced, 0 failing (was 1 failing before the repair).

**Docstring correction** (gate finding, low): `ALL_MEDIA_FN`'s header claimed
Playwright's own locator match order unconditionally; that only holds for a
single-type selector. The reviewer measured, on Playwright 1.62.1, that a
comma selector diverges: the walk returns all of one root's matches for every
tag before descending into that root's shadow roots, where the locator
interleaves tags as it descends into each root. Neither `PLAY_SCRIPT` (calls
`.play()` on the whole list) nor the metadata fallback (takes index `0`) hands
an index to a locator, so this is not a live defect — recorded in the
docstring in case a future caller does.

**The ticket's fold-in question, answered.** dl-61's Log raised a second gap in
the same area — a light-DOM video slotted into a shadow root that wraps the
slot in a link — as pre-existing and out of scope for that ticket. This ticket
does not touch that path (`CHOOSE_VIDEO_INDEX_FN`'s link check, not
`ALL_MEDIA_FN`), so nothing here makes it free to fix; not folded in.

**Gates**, re-run after the repair round above. `npx vitest run
tools/downloader/resolvers/test/browser/browser-resolver.test.ts
tools/downloader/resolvers/test/browser/provoke.test.ts`: 2 files, 52 passed.
`npm run check`: exit 0. `npm test -- --project downloader`: 86 files, 1459
tests, exit 0 (file/test counts have grown since dl-61's 85/1433 from other
merged tickets, not from this branch alone). `node scripts/citations-gate.mjs
--against origin/main`: 89 enforced, 0 failing, 0 raised. `npm run build` run
before every test invocation, since these are plain in-page script strings
with no separate compiled fixture. `npm run format` after the markdown edits.
