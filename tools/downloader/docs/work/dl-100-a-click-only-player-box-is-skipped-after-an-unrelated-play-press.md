---
id: dl-100
tool: downloader
title: An unrelated play-ish press, in any frame, keeps the browser tier from clicking a click-only player box
kind: fix
status: done
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

**Nothing is lost against the state before dl-81** (`092fc118`), which never had
the box click. This is a case dl-81 would have reached and, with this flag, does
not. (Corrected 2026-10-11: this said "against `main`", but `main` has had
`clickPlayerBox` since #390.)

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
  (`autoplay`, `display`) yields the stream, 3 of 3. The three residual rows
  (`carousel`, `watch`, the cross-site `Watch now`) are accepted as presses that
  count: they stay `NO_MEDIA_FOUND` and are pinned as such by tests (reworded by
  the owner, 2026-10-11; see the Log).
- dl-81's delay cases stay green: the press of a real play control whose
  `aria-label`, `title`, `data-testid`, `class` or `id` starts a word with "play"
  (camelCase included: `videoPlayButton`), or that matches `PLAY_TEXT` or is a
  player library's own class, still holds back the box click. An unlabelled
  control spelled as one lower-case word (`btnplay`, `videoplaybutton`) is not
  counted, and dl-81's defect returns for it; accepted (owner, 2026-10-11; see
  the Log).
- Each case has a test that fails if its branch is removed.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: FAIL** — 2026-10-11 · `55214e67..6dd64a7c` · Opus 5.5, depth full

| Done when                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows whose control is not a play control (`autoplay`, `display`, and the remedy chosen for `carousel`, `watch` and the cross-site button) yield the stream, 3 of 3 | `autoplay`, `display`: `resolvers/test/browser/browser-resolver.test.ts` › "ctl=%s (%s) is pressed but does not hold back the box click" ✓, 3 of 3 runs at head; red at base (positive control). `carousel`, `watch`, `xo`: **not met** on the line's literal reading — "ctl=%s is a press that counts, so the box is not clicked" asserts `NO_MEDIA_FOUND` and the box beacon absent for all three, the opposite of "yields the stream". See the high below; it carries an open decision                                   |
| dl-81's delay cases stay green: the press of a real play control still holds back the box click                                                                    | First clause ✓: "is skipped once a play control was pressed, whether the manifest is requested after %i ms or not" (0, 300, 1500, 3000), 3 of 3 runs. Second clause **not met**: an icon-only play button identified by `data-testid="videoPlayButton"` is pressed but no longer counted, and the box click then presses a related card and leaves the page (high below). The delay fixture's button has the text "Play", so it is counted by `PLAY_TEXT` and never reaches `isPlayPress`: the guard cannot see this change |
| Each case has a test that fails if its branch is removed                                                                                                           | Per reproduction row ✓, each by mutation at head: base `provoke.ts` fails `autoplay`, `display`; `PLAY_WORD_START = /play/i` fails `autoplay`, `display`; library-class line removed fails `ctl=jw`; `labelClicked` dropped from `provokeFrame`'s return fails `watch`, `xo`; flag set from the main frame only fails `xo` and "a Play press in a frame from another site still holds back the box click, whose centre is that frame". Not every classifier branch: see the `med` on the class/id/`data-testid` read        |
| `npm run check` and `npm test -- --project downloader` pass                                                                                                        | **verified** — `npm run check` exit 0 locally at head; PR #425 `check` and `test (ubuntu-latest)` pass on `6dd64a7c`. `test (windows-latest, informational)` fails on `6dd64a7c`, in `engine/test/parallel-ranges.test.ts` (dl-98, already on `main`), not in this diff                                                                                                                                                                                                                                                     |

- **high** · Done when 2 depends on it · **A real play control that `main` counted no longer counts, and dl-81's defect returns for it.** `isPlayPress` treats only a non-letter as a word boundary (`PLAY_WORD_START = /(?:^|[^a-z])play/i`, and `[^a-z]` under `i` excludes capitals too), so a camelCase attribute — `data-testid="videoPlayButton"`, `title="VideoPlay"` — on an icon-only button with no `aria-label`/text is pressed but not counted. Reproduction: `zz-gate-grid.html` = `player-poster-related-grid.html` with the button's markup chosen by `?ctl=`, `quietMs: 1200`, `emptyMinWaitMs: 9000`, `delay=1500`, one run each:

  | `ctl`                         | base `55214e67` `provoke.ts` | head                                                      |
  | ----------------------------- | ---------------------------- | --------------------------------------------------------- |
  | `label` (`aria-label="Play"`) | stream                       | stream                                                    |
  | `camel-testid`                | stream                       | `NO_MEDIA_FOUND`, `/beacon/card-clicked`, `/other-5.html` |
  | `camel-title`                 | stream                       | `NO_MEDIA_FOUND`, `/beacon/card-clicked`, `/other-5.html` |

  Conditions it needs: no `<video>` before the press, a play control with no word-start "play" in any of the five attributes and no `PLAY_TEXT` text, a manifest later than the pass boundary, and a larger player-ish box. Scripts: `gate-run.sh <tree> <out> "label&delay=1500,camel-testid&delay=1500,camel-title&delay=1500" /zz-gate-grid.html 1 9000` with `zz-gate.test.ts`, `zz-gate-grid.html` (the scratch directory). This and the next `med` come from one mechanism, the word-boundary read over all five attributes; it errs in both directions.

- **high** · Done when 1 depends on it · **open decision** · The line asks that `carousel`, `watch` and the cross-site button "yield the stream" under the remedy chosen; the build chose to accept them (as the Decision lets the builder do) and pins the opposite: three tests assert `NO_MEDIA_FOUND` with the box not clicked. A test asserting the opposite of a line is `high` under `gate.md`. The other reading — the parenthetical names whichever rows the remedy leaves "not a play control", so accepting them takes them out of the line — is what the build's Log assumes, but the Log never says the line conflicts with it. Options: **(1, recommended)** the owner rewords Done when 1 to say the three residual rows are accepted and pinned as presses that count. No code changes, and the Decision already gave this judgement to the builder, whose Log measured that the frame-scoped alternative breaks the embed case (I re-ran it: `mainonly` fails `xo` and the embed test, 2 of 31). **(2)** A fix round builds a narrowing so the three rows yield the stream. That is "only when media activity follows", which the Log calls a redesign that moves the box click into `waitForQuiet`. Not measured here.
- **med** · no `Done when` line depends on it (the table's own fixtures pass) · **The `autoplay` and `display` shapes come back as soon as the control has any `player*`/`playlist*`/`playback*` attribute.** `isPlayPress` reads all five attributes whatever the selector matched on, so an "Autoplay" toggle matched through `aria-label` is still counted through its `class`, `id` or `data-testid`. Reproduction: `zz-gate-box.html` (the ticket's box, one control by `?ctl=`), at head, one run: `autoplay-cls` (`aria-label="Autoplay" class="player-autoplay-toggle"`), `autoplay-id` (`id="player-autoplay"`), `autoplay-testid` (`data-testid="player-autoplay"`), `display-cls` (`data-testid="display-name" class="player-meta"`), `playlist-testid`, `plays-count`, `playback-rate` (`title="Playback rate"`) → each `NO_MEDIA_FOUND`, control beacon seen, box not clicked. `none` and `vjs-autoplay` (`class="vjs-autoplay-toggle …" title="Autoplay"`) → stream. At base the same rows are `NO_MEDIA_FOUND`, so this is the defect left open, not a regression. Option A says "label"; the build reads class/id/test id too. A box is only ever clicked when the page names it `player*` (`MARK_PLAYER_BOX_SCRIPT`), so `player-`/`player__` chrome is the likely neighbour, but that is reasoning. No real library markup was measured: no fixture in the repo has a `PLAY_SELECTORS` match that carries such an attribute. A remedy that answers this and the camelCase high together: classify per selector — the play-specific selectors (library classes, `play-button`, `play-btn`, `#play`) always count, and the substring selectors count only on a word start, camelCase included, in the attribute they matched.
- **med** · no `Done when` line depends on it by its letter (Done when 3 is per case) · **Reading `class`, `id` and `data-testid` for a word start has no test.** Mutant `labelword` (`values.slice(0, 2).some(…)`, so only `aria-label` and `title` are read for the word start; the library-class branch is untouched): `npx vitest run tools/downloader/resolvers/test/browser` → `Test Files 13 passed (13)`, `Tests 741 passed (741)`, exit 0. The `-t "dl-100|dl-81"` subset: 31 of 31 pass.
- **low** · `nfr:maintainability` · The `catch` branch of `isPlayPress` (an element gone before the read counts as nothing) has no test, and each read can wait up to 500 ms on a detached match before the press itself fails.
- **low** · The Log says the residual cost is "not a regression: `main` never had the box click". `main` has had `clickPlayerBox` since #390; `55214e67`'s `provoke.ts` has three references to it. The line was copied from the brief, which was written before dl-81 merged.
- **dropped** · `test (windows-latest, informational)` red on `6dd64a7c`: three failures in `engine/test/parallel-ranges.test.ts` (dl-98), a file this diff does not touch. Out of the reviewed range.
- **findings** · the hunt returned 7; 6 carried, 1 dropped.
- Invariants walked: no cross-tool import, no new error code (`NO_MEDIA_FOUND` unchanged), no shell, no logging added, no contract edit, `import type` for `Locator` unchanged, new specs sit in an already-registered package. Skipped as untouchable by this diff: redaction, SSRF, progress, Dockerfile closure, route enumeration.
- NFR: security n/a (no new URL or credential path) · performance: up to five 500 ms-bounded attribute reads per match, at most three matches per frame, low · reliability: the two highs · maintainability: the untested attribute read, above.

### Gate 2

**Gate: CONCERNS** — 2026-10-11 · `6dd64a7c..58af233d` (one commit, no merge) · Opus 5.5, re-gate of the round

| Done when                                                                                                                   | Proof                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `autoplay`, `display` yield the stream, 3 of 3; the three residual rows are pinned `NO_MEDIA_FOUND` (reworded by the owner) | `resolvers/test/browser/browser-resolver.test.ts` › "ctl=%s (%s) is pressed but does not hold back the box click" (`autoplay`, `display`) and › "ctl=%s is a press that counts, so the box is not clicked" (`carousel`, `watch`, `xo`) ✓ — `-t "dl-100\|dl-81"` 42 of 42, three runs |
| dl-81's delay cases stay green: the press of a real play control still holds back the box click                             | Delay cases ✓, three runs; camelCase controls ✓ › "ctl=%s (%s) is a press that counts, so a slow player is not clicked past". **unproven (open decision)** for a play control spelled as one lower-case word: see the first `med`                                                    |
| Each case has a test that fails if its branch is removed                                                                    | ✓ by mutation at head: label-only read fails `testid-word`, `class-btn`, `id-button`, `camel-testid` (4 of 42); no id-`play` branch fails `id-play`; no camelCase fails `camel-testid`, `camel-title`; no `auto` exception fails `autoplay-camel`                                    |
| `npm run check` and `npm test -- --project downloader` pass                                                                 | **verified** — `npm run check` exit 0 locally at head; PR #425 `check` and `test (ubuntu-latest)` pass on `58af233d`                                                                                                                                                                 |

Gate 1's findings:

- **high, camelCase play control not counted** — **fixed.** `gate-run.sh` with `zz-gate-grid.html`, `delay=1500`, floor 9000 at head: `label`, `camel-testid`, `camel-title` → stream, no card beacon (at `6dd64a7c` the last two pressed card 5).
- **high, Done when 1 against the residual rows** — **fixed** by the owner's rewording; the line and the three pinning tests now agree.
- **med, over-count through a `player*` attribute** — **fixed for `class` and `id`**: `autoplay-cls`, `autoplay-id`, `display-cls` → stream at head. What still counts is the same as `main` (the measurement is below).
- **med, the `class`/`id`/`data-testid` read untested** — **fixed**: the label-only mutant is killed (4 of 42). The Log's "6 of 19" is for the builder's own mutant, which also drops the library-class and id-`play` reads.
- **low, `isPlayPress`'s `catch` untested** — **not fixed**, with a reason in the Log; recorded.
- **low, "`main` never had the box click"** — **fixed** in both the brief and the Log.

New in the round's lines:

- **med** · Done when 2 depends on it · **open decision** · **A play control spelled as one lower-case word is no longer counted, and dl-81's defect returns for it.** `startsWord` needs a non-letter or a lower-to-upper `Play` before the token, so `data-testid="videoplaybutton"` or `"btnplay"` on an icon-only button with no label is pressed and not counted. `zz-gate-grid.html?ctl=tid:<value>&delay=1500`, floor 9000:

  | `data-testid`     | `main` (`55214e67`) | head                                            | whole word "play" (option 2 below) |
  | ----------------- | ------------------- | ----------------------------------------------- | ---------------------------------- |
  | `videoplaybutton` | stream              | `NO_MEDIA_FOUND`, card pressed, `/other-5.html` | same as head                       |
  | `btnplay`         | stream              | `NO_MEDIA_FOUND`, card pressed, `/other-5.html` | same as head                       |
  | `playbtn`         | stream              | stream                                          | `NO_MEDIA_FOUND`, card pressed     |

  Option A's rule ("starts a word with play") cannot count `btnplay`, and no test pins the opposite, so this is the open-decision case and not a `high`. It needs all of: no `<video>`, no `aria-label`, `title` or text with a word-start "play", a late manifest, and a larger player-ish box. Options: **(a, recommended)** reword the line's second clause to the word-start reading, which is what A says, and accept the miss; **(b)** invert the rule into a deny-list — count every match unless its "play" sits inside a known non-play word (`autoplay`, `display`, …). That keeps `main`'s count for every real control and frees the table's rows, at the cost of an open-ended word list, which the builder already declined for `carousel`.

- **low** · The `auto` exception only covers camelCase. `data-testid="auto-play-toggle"` and `aria-label="Auto Play"` still count, the same as `main` (measured: `NO_MEDIA_FOUND` at `main`, head and option 2). `startsWord` over a word list (`mutants.mjs`): `AutoPlay`, `autoPlay`, `videoAutoPlay`, `autoPlayToggle`, `DisplayName`, `Autoplay` → false; `displayPlay`, `RePlay`, `fairPlayLicense`, `gamePlayStats`, `screenPlay`, `powerPlay`, `Auto Play`, `auto-play` → true. Every one of these was counted at `main`.
- **low** · `isPlayPress` checks every `PLAY_LOOSE_SELECTORS` entry's attribute, not only those whose selector matched. A `<span data-testid="display-name" title="Player info">` matches only the test-id selector but is counted through `title`. The function's doc is accurate. The commit message's "in the attribute that selector matched on" overstates it. Read from the code, not run.
- **dropped** · `test (windows-latest, informational)` is red on `58af233d` in `engine/test/parallel-ranges.test.ts` (dl-98), as at `6dd64a7c`. That file is outside the diff.
- **findings** · the round's hunt returned 4; 3 carried, 1 dropped.

The builder's open decision (whether "Playlist", "Playback", "Plays" and "Player" count) — measurement only. `zz-gate-box.html?ctl=…`, one run each, "held" = `NO_MEDIA_FOUND` with the box not clicked:

| control                                                    | `main` | head (option 1, as built) | option 2, whole word "play" |
| ---------------------------------------------------------- | ------ | ------------------------- | --------------------------- |
| `aria-label="Autoplay" class="player-autoplay-toggle"`     | held   | stream                    | stream                      |
| `aria-label="Autoplay" id="player-autoplay"`               | held   | stream                    | stream                      |
| `data-testid="display-name" class="player-meta"`           | held   | stream                    | stream                      |
| `class="vjs-autoplay-toggle …" title="Autoplay"`           | held   | stream                    | stream                      |
| `data-testid="AutoPlay"` / `"autoPlayToggle"`              | held   | stream                    | stream                      |
| `aria-label="Autoplay" data-testid="player-autoplay"`      | held   | held                      | stream                      |
| `data-testid="playlist-panel"`                             | held   | held                      | stream                      |
| `data-testid="plays-count"`                                | held   | held                      | stream                      |
| `title="Playback rate"`                                    | held   | held                      | stream                      |
| `data-testid="auto-play-toggle"`, `aria-label="Auto Play"` | held   | held                      | held                        |

On the box rows neither option is a regression against `main`: option 1 frees 6 of the 12, option 2 frees 10. On the grid, option 2 adds one regression against `main` (`playbtn`, table above) to the two that both options share. The branch's own suite passes 42 of 42 under option 2 too, so no test pins either choice.

- NFR: security n/a · performance unchanged (the attribute reads are the five distinct names deduplicated from the entries, each bounded at 500 ms, as before) · reliability: the `med` above · maintainability ✓.

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
    - **The cost is bounded:** the page needs all of no `<video>`, no label of
      its own, and a play-ish control that does nothing, to lose the stream, and
      this change only ever lets the box be clicked in more cases than `main`
      does. (This line first said "`main` never had the box click", copied from
      the brief, which predates dl-81's merge; `main` has had `clickPlayerBox`
      since #390. Corrected in round 2.)
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
- 2026-10-11 — **Owner's answer on Done-when 1** (asked by the orchestrator via
  AskUserQuestion after gate 1 raised it). Question: "Done-when 1 says
  carousel/watch/'Watch now' 'yield the stream' under the remedy chosen. The
  builder accepted them, and its tests pin NO_MEDIA_FOUND, the literal opposite.
  How do we settle it?" Options: "Reword the line (Recommended)", "Build the
  narrowing" (media-activity), "Reword + file follow-up". **The owner chose
  "Reword the line"**; Done-when 1 is reworded above. No follow-up ticket for the
  media-activity narrowing was requested, so none is filed.
- 2026-10-11 — **Gate 1, round 2** (builder, Sonnet 5.5). Gate 1 failed on two
  highs; the second is the answer above. The first held: `PLAY_WORD_START =
/(?:^|[^a-z])play/i` treats a capital as part of a word, so `data-testid=
"videoPlayButton"` or `title="VideoPlay"` on an icon-only button was pressed but
  not counted, and with the manifest 1.5 s late a related card was pressed
  (`zz-gate-grid.html`, the gate's rows `camel-testid` and `camel-title`).
  Reproduced as the new `player-poster-icon-grid.html?ctl=…&delay=1500` tests: at
  `6dd64a7c` `camel-testid` and `camel-title` fail (`/beacon/card-clicked`) and
  `label` passes; 5 of 17 dl-100 cases failed there (those two and the three
  below). What changed in `provoke.ts`:
  - **Per selector, as the gate proposed, with one difference.** `PLAY_SELECTORS`
    is now built from `PLAY_LOOSE_SELECTORS` (each substring selector with the one
    attribute it reads and the token it looks for) plus the library classes plus
    `button#play`/`#play`. `isPlayPress` counts a library class, the id `play`, or a
    word start of an entry's own token in that entry's own attribute. A match
    through `aria-label` is no longer counted through a `player-*` class, id or
    test id (the over-count med): `autoplay-cls`, `autoplay-id` and `display-cls`
    fail at `6dd64a7c` and pass now. The gate's version said the play-specific
    selectors (`play-button`, `play-btn`) always count; they do not here, because
    `[class*='play-button']` also matches `autoplay-button` and `display-button`,
    so they are word-start checks on their own token.
  - **camelCase is a word start for "play"**: a capital `Play` after a lower-case
    letter, except right after `auto` (`autoPlayToggle` stays uncounted).
  - **Left as the owner's rule reads: "Playlist", "Playback", "Plays" and "Player"
    start with "play" and count.** So `data-testid="player-autoplay"`,
    `title="Playback rate"` and the like still hold back the box click, which at
    `main` they also do. Tightening that to the whole word "play" would lose a
    real control written `playbtn` or `playicon`, and a control lost is the
    dl-81 defect (a card pressed) where one counted too many is the cost already
    accepted. This is a judgement the owner's option A leaves; recorded, not
    asked.
  - **Mutants** (`-t dl-100`, 19 cases, all killed): `labelword` (only
    `aria-label` and `title` read) fails `jw`, `testid-word`, `class-btn`,
    `id-button`, `id-play`, `camel-testid` (6 of 19); no id-`play` branch fails
    `id-play`; no camelCase fails `camel-testid` and `camel-title`; no `auto`
    exception fails `autoplay-camel`; no library branch fails `jw`. The first
    round's `id-play`, `autoplay-camel` and the three attribute rows had no test.
  - **Not done.** The gate's low about `isPlayPress`'s `catch` (an element gone
    before the read): no test, and each read can wait up to 500 ms on a detached
    match before the press itself fails. A test would need a control that detaches
    between the count and the read, which a fixture cannot time; the cost is
    bounded by `max: 3` per frame and the press fails anyway. Its other low, "main
    never had the box click", is corrected above.
- 2026-10-11 — **Owner's answer on gate 2's open decision** (asked by the
  orchestrator via AskUserQuestion; the owner's, not an agent's). Question: a
  play control spelled as one lower-case word (`data-testid="btnplay"`,
  `"videoplaybutton"`) on an icon-only button is pressed and not counted, so
  dl-81's defect (a related card pressed after a late manifest) returns for it;
  what do we do? Options: "Reword, accept miss (Recommended)" (reword Done-when
  2's second clause to the word-start reading, which is what option A says) and
  "Deny-list rule" (count every match unless its "play" sits inside a known
  non-play word such as `autoplay` or `display`; an open-ended word list).
  **The owner chose "Reword, accept miss".** Done-when 2 is reworded above to say
  what `isPlayPress` and `startsWord` do at `58af233d`: a press counts when the
  element carries a player library's class or the id `play`, or an attribute a
  loose selector reads has a word starting with its token (camelCase `Play`
  included, except right after `auto`), or the text matches `PLAY_TEXT`; a
  control spelled as one lower-case word is not counted. No code, test or fixture
  changed.
- 2026-10-11 — **Owner's answer on the builder's open decision** (asked by the
  orchestrator via AskUserQuestion; the owner's). Question: do words starting
  with "play" (Playlist, Playback, Plays, Player) count as play presses?
  Options: "Keep counting (Recommended)" (as built; the builder's
  recommendation; the gate gave none) and "Whole word 'play'" (gate 2 measured
  it: frees 4 more of its 12 box rows, adds one regression against `main`,
  `playbtn`). **The owner chose "Keep counting".** The build stands as it is.
- 2026-10-12, after merge. The gate's last-round low on the commit message
  ("in the attribute that selector matched on") held for the doc comment above
  `PLAY_LOOSE_SELECTORS` in `resolvers/src/browser/provoke.ts` too, which said
  `isPlayPress` reads "that attribute alone". It reads every attribute a loose
  selector reads, whichever one matched. The comment now says so; the code is
  unchanged. The other recorded lows (the untested `catch`, the `auto` exception
  covering camelCase only) were judged not worth a change and stay recorded.
