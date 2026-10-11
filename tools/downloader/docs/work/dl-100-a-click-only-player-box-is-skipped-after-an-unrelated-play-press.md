---
id: dl-100
tool: downloader
title: An unrelated play-ish press, in any frame, keeps the browser tier from clicking a click-only player box
kind: fix
status: ready
milestone: null
depends_on: [dl-81]
difficulty: standard
---

# dl-100 — An unrelated play-ish press keeps the browser tier from clicking a click-only player box

## Why

Found by dl-81's third gate on 2026-10-07 (`1a224b86`, narrow depth). dl-81's
round 3 made the centre click on the largest player-ish box (`provokeInput`,
`clickPlayerBox`) skip once pass 0 had pressed a play control, so a slow player
that asks for its manifest 300 to 3000 ms after the press is not clicked past.
The owner chose that (option A of round 3) on the premise that the cost is "a
play button that does nothing".

What is measured is wider. `provokeFrame` returns true for any successful
`clickVisible` press over `PLAY_SELECTORS`, and those are substring matches.
`provokePlayback` ORs the result across **every** frame, a cross-site ad frame
included, while the box click acts only in the main frame. So the flag is set by:

- a word that merely contains "play": `button[aria-label*='play' i]` matches
  "Autoplay" and "Play slideshow", and `[data-testid*='play' i]` matches
  `display-name`, which is not a control at all;
- a bare "Watch" link, through `PLAY_TEXT`;
- a "Watch now" button in a cross-site 300x250 ad frame.

On a page whose only way to start is a click on a player box (no `<video>`, no
label, no link), any one of those turns the stream into `NO_MEDIA_FOUND`.

**Nothing is lost against `main`**, which never had the box click. This is a
case dl-81 would have reached and, with this flag, does not.

## Reproduction

Measured by gate 3 with the real `BrowserResolver`, `quietMs: 1200`,
`emptyMinWaitMs: 1200`, a 25 s budget, and two loopback origins: the page on
`127.0.0.1` and `{{SECONDARY}}` on `localhost`, a different site, so Chromium
puts the frame in its own process. `/beacon/*` answers 204 and
`/media/related/master.m3u8` is the repo's `test/fixtures/media/related` HLS
master. Each row is 3 of 3 runs. "prev" is dl-81's state at `092fc118`, before
the flag existed; "head" is `1a224b86`.

`/box-with-control.html?ctl=<control>`:

| `ctl`      | control added to `player-box-click-only.html`'s box                 | base             | prev       | head             |
| ---------- | ------------------------------------------------------------------- | ---------------- | ---------- | ---------------- |
| `none`     | nothing                                                             | `NO_MEDIA_FOUND` | the stream | the stream       |
| `autoplay` | `<button aria-label="Autoplay">`                                    | —                | the stream | `NO_MEDIA_FOUND` |
| `carousel` | a hero carousel's `<button aria-label="Play slideshow">`            | —                | the stream | `NO_MEDIA_FOUND` |
| `display`  | `<span data-testid="display-name">`, not a control                  | —                | the stream | `NO_MEDIA_FOUND` |
| `watch`    | a "Watch" link to a `#fragment`                                     | —                | the stream | `NO_MEDIA_FOUND` |
| (xo)       | `/box-xo-cta.html`: a cross-site ad frame with a "Watch now" button | `NO_MEDIA_FOUND` | the stream | `NO_MEDIA_FOUND` |

In every `head` failure the control's own beacon (`/beacon/control-<ctl>`, or
`/beacon/cta-pressed`) was requested and `/beacon/box-clicked` was not: the
press happened, the box was never clicked.

The fixtures, as the gate wrote them. Put them in
`resolvers/test/fixtures/pages/`; the first two are served with
`{{SECONDARY}}` replaced by the secondary origin, as the existing cross-origin
fixtures are.

`box-with-control.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Click-only player box beside an unrelated play-ish control</title>
  </head>
  <body style="margin: 0">
    <!-- player-box-click-only.html's box, plus one control chosen by ?ctl=:
         autoplay  - a toggle labelled "Autoplay" (matches button[aria-label*='play' i])
         carousel  - a hero carousel's "Play slideshow" button
         display   - a plain span with data-testid="display-name" (matches [data-testid*='play' i])
         watch     - a "Watch" link to a #fragment (matches PLAY_TEXT through role link)
         none      - nothing
         Each control records its click and does nothing to the player. -->
    <div id="slot"></div>
    <div class="player-box" style="width: 640px; height: 360px; background: #222"></div>
    <p id="status">idle</p>
    <script>
      var ctl = new URLSearchParams(location.search).get("ctl") || "none";
      var slot = document.getElementById("slot");
      var el = null;
      if (ctl === "autoplay") {
        el = document.createElement("button");
        el.setAttribute("aria-label", "Autoplay");
        el.textContent = "Autoplay";
      }
      if (ctl === "carousel") {
        el = document.createElement("button");
        el.setAttribute("aria-label", "Play slideshow");
        el.textContent = "||";
      }
      if (ctl === "display") {
        el = document.createElement("span");
        el.setAttribute("data-testid", "display-name");
        el.textContent = "Jane Doe";
      }
      if (ctl === "watch") {
        el = document.createElement("a");
        el.href = "#later";
        el.textContent = "Watch";
      }
      if (el) {
        el.addEventListener("click", function () {
          fetch("/beacon/control-" + ctl).catch(function () {});
        });
        slot.appendChild(el);
      }
      var started = false;
      document.querySelector(".player-box").addEventListener("click", function () {
        if (started) return;
        started = true;
        fetch("/beacon/box-clicked").catch(function () {});
        fetch("/media/related/master.m3u8")
          .then(function (r) {
            return r.text();
          })
          .catch(function () {});
      });
    </script>
  </body>
</html>
```

`box-xo-cta.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Click-only player box beside a cross-site ad with a Watch now button</title>
  </head>
  <body style="margin: 0">
    <div style="display: flex; gap: 8px">
      <div class="player-box" style="width: 640px; height: 360px; background: #222"></div>
      <iframe
        src="{{SECONDARY}}/cta-inner.html"
        width="300"
        height="250"
        style="border: 0"
      ></iframe>
    </div>
    <script>
      var started = false;
      document.querySelector(".player-box").addEventListener("click", function () {
        if (started) return;
        started = true;
        fetch("/beacon/box-clicked").catch(function () {});
        fetch("/media/related/master.m3u8")
          .then(function (r) {
            return r.text();
          })
          .catch(function () {});
      });
    </script>
  </body>
</html>
```

`cta-inner.html`, served from the secondary origin:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Ad</title>
  </head>
  <body style="margin: 0; background: #fc0">
    <p>Brand new series</p>
    <button onclick="fetch('/beacon/cta-pressed')">Watch now</button>
  </body>
</html>
```

## Decision

**Decided 2026-10-11 by the owner: option A**, chosen from the two options below
(a third, "hold it", was also offered). The owner did not settle the three
residual rows A leaves (`Play slideshow`, the bare `Watch` link, the cross-site
`Watch now` button); this section reserves them to the builder, who records the
reasoning in the Log. Before that, on 2026-10-07, the owner was asked whether to
narrow the flag in dl-81 and chose to file it instead. The options as put:

- **A, chosen.** Count a press only when its label starts a word with
  "play", or matches `PLAY_TEXT`. That drops `autoplay` and `display`, and
  `box-with-control.html` pins it. The cross-frame OR stays, because an embedded
  player's own Play press still has to hold back the main frame's box click.
  The row that A does not settle is the cross-site ad's "Watch now" button, which
  matches `PLAY_TEXT` by design: it, the bare "Watch" link and "Play slideshow"
  (a word starting with "play") would still set the flag (derived from
  `PLAY_SELECTORS` and `PLAY_TEXT`; not measured). Whoever builds this
  decides whether those three are acceptable, or whether the flag should count a
  press only in the frame that holds the chosen player, or only when the press
  was followed by media activity. That is the judgement this ticket exists to
  take.
- **Leave it.** Accept the cost; correct dl-81's Log, which states it as "a play
  button that does nothing".

## Build

Add the three fixtures above and one test per row of the table, in
`resolvers/test/browser/browser-resolver.test.ts`, appended at the end. They
must fail at `1a224b86` first (`NO_MEDIA_FOUND`), and `ctl=none` must stay green.
Also keep dl-81's own guard green:
`player-poster-related-grid.html?delay=<ms>` at 300, 1500 and 3000 ms must still
not press a related-video card.

## Done when

- Each row of the reproduction table whose control is not a play control
  (`autoplay`, `display`, and the remedy chosen for `carousel`, `watch` and the
  cross-site button) yields the stream, 3 of 3.
- dl-81's delay cases stay green: the press of a real play control still holds
  back the box click.
- Each case has a test that fails if its branch is removed.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- 2026-10-07 — **Filed** by the fixer landing dl-81 (Sonnet 5.5), from gate 3's
  open decision 1 and the owner's answer, option B. The figures are the gate's,
  copied from its report; none was re-run here. `difficulty` is rated because
  `docs/01-TICKETS.md` requires it until `done`: `standard`, for the work once
  the decision is answered.
- 2026-10-11 — **Decision recorded** (builder, Sonnet 5.5, from the dispatch). The
  owner chose option A on 2026-10-11, out of "A: count a press only when its
  label starts a word with 'play' or matches `PLAY_TEXT`", "Leave it: accept the
  cost and correct dl-81's Log" and "Hold it". `status` moves `needs-decision` to
  `ready`. The three residual rows are left to the builder.
- 2026-10-11 — **Built** (builder, Sonnet 5.5). `provokeFrame` still presses every
  `PLAY_SELECTORS` match, but `clickVisible` now counts a press only when
  `isPlayPress` accepts it: the element carries a player library's own class
  (`PLAY_LIBRARY_CLASSES`: `vjs-big-play-button`, `ytp-large-play-button`,
  `jw-icon-display`, `plyr__control--overlaid`), or one of `aria-label`, `title`,
  `data-testid`, `class`, `id` has a word starting with "play"
  (`/(?:^|[^a-z])play/i`). `PLAY_TEXT` presses count as before. The cross-frame
  OR is unchanged.
  - **Reproduction, before and after**, the real `BrowserResolver`
    (`quietMs: 1200`, `emptyMinWaitMs: 1200`, 25 s budget), against
    `55214e67`'s `provoke.ts` and then the fix, one run each, outcome and
    whether the control's beacon and `/beacon/box-clicked` were requested:

    | ctl        | `55214e67`                        | fix                               |
    | ---------- | --------------------------------- | --------------------------------- |
    | `none`     | stream, box clicked               | stream, box clicked               |
    | `autoplay` | `NO_MEDIA_FOUND`, box not clicked | stream, control + box clicked     |
    | `display`  | `NO_MEDIA_FOUND`, box not clicked | stream, control + box clicked     |
    | `carousel` | `NO_MEDIA_FOUND`, box not clicked | `NO_MEDIA_FOUND`, box not clicked |
    | `watch`    | `NO_MEDIA_FOUND`, box not clicked | `NO_MEDIA_FOUND`, box not clicked |
    | `xo`       | `NO_MEDIA_FOUND`, box not clicked | `NO_MEDIA_FOUND`, box not clicked |

    The test names, failing at `55214e67` (2 of 8, `-t dl-100`): the `autoplay`
    and `display` cases. Passing on the fix 3 of 3 runs: 8 of 8 each time.

  - **The three residual rows: accepted, and pinned.** `carousel` ("Play
    slideshow"), `watch` (the bare "Watch" link) and `xo` (a cross-site ad's
    "Watch now") still hold back the box click, and `box-with-control.html?ctl=jw`
    (a bare `jw-icon-display` with no label) is the same shape on the
    library-class branch. Their tests assert `NO_MEDIA_FOUND` with the control's
    beacon seen and the box's not, so narrowing any of them later flips a test on
    purpose. Why accept rather than narrow:
    - **Label.** "Play slideshow" and a "Watch" link are indistinguishable from a
      player's own control by their label, which is all the rule reads; a
      narrower list would be a list of English phrases.
    - **Only in the frame holding the chosen player: measured, and it breaks the
      case the cross-frame OR exists for.** `box-xo-embed.html` is a
      `player-embed` wrapper around a cross-site frame whose own "Play" button
      asks for its manifest 1.5 s after the press; a centre click on the wrapper
      lands on that frame's surface. With the flag set only from the main frame
      (a one-line mutation of `provokePlayback`), `xo` becomes the stream and the
      embed test fails (2 of 8 failed, the `xo` case and the embed case; the
      embed's surface was clicked). A frame holding the ad's "Watch now" and a
      frame holding an embedded player's "Play" differ in nothing the resolver
      reads: neither has a `<video>` before the press.
    - **Only when media activity follows: not built.** The press is made before
      the pass boundary and the box click made right after it, so "followed by
      media" would mean deferring the click by up to the slowest manifest delay
      dl-81 measured (3000 ms) and moving it out of `provokePlayback`'s pass
      boundary, into `waitForQuiet`, where dl-105 may also work. A pressed play
      control on a page whose manifest is slow is exactly the case a deferred
      click would meet with a second click on a starting player (argued, not
      measured). That is a
      redesign, not a narrowing, and no measured page needs it.
    - **The cost is bounded and not a regression:** `main` never had the box
      click, and the page needs all of no `<video>`, no label of its own, and a
      play-ish control that does nothing, to lose it.
  - **Guards still green.** The dl-81 delay cases
    (`player-poster-related-grid.html?delay=0|300|1500|3000`) pass, and
    `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
    ends `Tests  170 passed (170)`.
  - **Mutations that fail a test** (`-t dl-100`, 8 cases; the library-class one run as `-t ctl=jw`):
    removing the library-class branch fails `ctl=jw`; making the word-start test
    return false fails `ctl=carousel`; the main-frame-only mutation above fails
    `xo` and the embed test; the unfixed `provoke.ts` fails `autoplay` and
    `display`.
  - **Brief details.** The ticket's fixtures were used as written; two were
    added (`box-xo-embed.html` with `embed-inner.html`, and a `jw` row in
    `box-with-control.html`) for the two branches no row reached. Its Done-when
    "3 of 3" holds as 3 runs of the 8 cases. dl-81's Log was **not** corrected:
    that sentence ("a play button that does nothing") was the "Leave it" option's
    fold-in, and option A narrows the cost to just that. A string
    `locator.evaluate` is not invoked with the element (`"(el) => ..."` returns
    `undefined`), so the label is read with `getAttribute`; a first draft that
    evaluated a string counted nothing and made `autoplay` pass by accident, which
    the `carousel` row exposed.
