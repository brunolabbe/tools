---
id: dl-68
tool: downloader
title: PLAY_SCRIPT and the metadata audio fallback stop at shadow roots
kind: fix
status: ready
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
