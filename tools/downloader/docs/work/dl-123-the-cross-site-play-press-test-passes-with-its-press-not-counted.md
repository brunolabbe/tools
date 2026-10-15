---
id: dl-123
tool: downloader
title: The cross-site Play press test still passes when that press is not counted
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-123 — The cross-site Play press test still passes when that press is not counted

## Why

[dl-100](./dl-100-a-click-only-player-box-is-skipped-after-an-unrelated-play-press.md)
made the box click wait on a press that _counts_ as starting a player
(`isPlayPress`), and kept the cross-frame rule: a Play press in a frame from
another site still holds back the box click, because the wrapper's centre is
that frame. One test in `browser-resolver.test.ts` claims to pin that rule
across a frame:

> `a Play press in a frame from another site still holds back the box click, whose centre is that frame`

It does not pin it. Its outcome does not depend on `isPlayPress` counting the
press, because a second, independent path in `provokeFrame` also reports the
same press as pressed. The finding came from dl-114's gate 1 (Opus 5.5, on
`81daba51`), which planted a read-path mutation on `isPlayPress` and saw this
test pass anyway; it filed the test as "out of the reviewed range" and a
candidate ticket, since dl-114 did not touch it. This ticket is that candidate,
reproduced on `main`.

**What the test claims.** A press on the embed's Play button, in a cross-site
frame, makes `pressed` true, so `provokeInput` does not click the wrapper
`div.player-embed` at its centre, which would land on the embed's surface
(`/beacon/embed-surface-clicked`).

**What its outcome depends on.** `embed-inner.html` is `<button id="play">Play</button>`.
`provokeFrame` (`provoke.ts`, the end of the function) returns

```ts
return playClicks > 0 || labelClicked || videoClicked;
```

and the same button is pressed twice: by `clickVisible` over `PLAY_SELECTORS`
(`button#play`, `#play`), counted only if `isPlayPress` accepts it, and then by
`clickByText(frame, PLAY_TEXT, …)`, because its accessible name is `Play` and
`PLAY_TEXT` matches `Play`. `labelClicked` is true whatever `isPlayPress` says,
so `pressed` is true and the box click is skipped. Either path alone holds the
test green; only removing both fails it.

The gate's explanation, that the manifest is captured at 1.5 s "before any box
click", is not the mechanism, and the reproduction below refutes it: with both
paths off the box **is** clicked (the beacon is requested), which means
`hasPlayable()` was still false when `provokeInput` ran. The 1.5 s is the embed's
own delay between the press and the manifest request, and it is why the test
passes `emptyMinWaitMs = 9000`, not why the box click is skipped. The test's
comment ("The embed asks for its manifest 1.5 s after its Play press, so the
shipped floor") is about the floor and is accurate.

What does pin `isPlayPress`'s `id === "play"` rule is `ctl=id-play` in the
`test.each` above this test, which fails under the same plant (below). What
nothing pins is that the _cross-site_ Play press counts without the label path
to cover for it, which is the case dl-100's Log says the cross-frame OR exists
for.

## Reproduction

On `origin/main` at `2cb4e734`, worktree `dl-123`, built (`npm run build`),
`tools/downloader/resolvers/src/browser/provoke.ts` edited in place and restored
with `git checkout` after each step.

```
$ npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "a Play press in a frame from another site"
 Test Files  1 passed (1)
      Tests  1 passed | 136 skipped (137)
```

Plant A, the smallest change that makes that frame's press not count: delete the
`id` rule in `isPlayPress` (the embed's button has no class, no `aria-label`, no
`title` and no `data-testid`, so the id is the only thing that counts it).

```
-    if (read.get("id") === "play") return true;
```

```
$ npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "a Play press in a frame from another site"
 Test Files  1 passed (1)
      Tests  1 passed | 136 skipped (137)          <- still passes, exit 0
```

The plant is live: the row that pins the same rule on a same-site page fails
under it.

```
$ npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "ctl=id-play is a press that counts"
 FAIL  |downloader| … > ctl=id-play is a press that counts, so the box is not clicked
AssertionError: expected undefined to be an instance of AppError
 Tests  1 failed | 136 skipped (137)               <- exit 1
```

Plant A + B: A, and also drop `labelClicked` from `provokeFrame`'s return
(`return playClicks > 0 || videoClicked;`). The test now fails, with the box
click landing on the embed:

```
 FAIL  |downloader| … > a Play press in a frame from another site still holds back the box click, whose centre is that frame
AssertionError: expected [ '/box-xo-embed.html', …(7) ] to not include '/beacon/embed-surface-clicked'
 Tests  1 failed | 136 skipped (137)               <- exit 1
```

Plant B alone (the label path off, `isPlayPress` intact) also passes, so each
path is sufficient on its own:

```
 Test Files  1 passed (1)
      Tests  1 passed | 136 skipped (137)
```

After `git checkout tools/downloader/resolvers/src/browser/provoke.ts`, the same
command passes clean (`1 passed | 136 skipped (137)`), and `git status` is empty.

The manifest's 1.5 s and the box click, as they stand in the tree:

`tools/downloader/resolvers/test/browser/browser-resolver.test.ts`, the test body:

```ts
// The embed asks for its manifest 1.5 s after its Play press, so the
// shipped floor; a centre click on the wrapper would land on the embed.
const result = await probe("/box-xo-embed.html", resolverWith(undefined, 9000));
```

`tools/downloader/resolvers/test/fixtures/pages/embed-inner.html`:

```html
<button id="play">Play</button> … // The Play button asks for the manifest 1.5 s after the press, as
a player // that loads a script first does. button.addEventListener("click", function () {
setTimeout(function () { fetch("/media/related/master.m3u8")
```

`provokePlayback` runs `provokeInput` straight after pass 0's frame loop, so the
box click is decided before the 1.5 s has elapsed; that the click lands under
plant A + B is the measurement of it.

## Build

Make the test fail when the cross-site press does not count, and pass when it
does. More than one change does that; the reproduction supports the first and
does not rule out the others.

1. **Make the fixture's button unreachable by the label path** (recommended).
   Change `embed-inner.html`'s button so the accessible name `PLAY_TEXT`
   matches is gone while `button#play` still matches the selector: an icon-only
   button whose content is a glyph or an `aria-hidden` icon, with no
   `aria-label`, `title` or text that reads as "Play". Then `isPlayPress` is the
   only thing holding the box click back, and plant A fails the test. A real
   embed's play control is often icon-only, so this is also the more faithful
   fixture. `embed-inner.html` is referenced only by `box-xo-embed.html` and this
   test, so nothing else moves. The `test/fixtures/` directory is exempt from
   `oxfmt`.
2. **Keep the fixture and add a second embed** whose button the label path does
   not match, so the existing one keeps covering the label path in a cross-site
   frame and the new one covers `isPlayPress`. Costs one more browser test.
3. **Retitle the test to what it depends on** and leave the rule unpinned. This
   makes the claim true and the gap a recorded one, and does not satisfy Done
   when 1.

Whichever is chosen, run plant A and plant A + B yourself before and after, and
record both outputs in the Log; a fixture change that leaves plant A passing has
not done the work. Change no source under `resolvers/src`.

## Done when

1. Under plant A (the `id === "play"` line deleted from `isPlayPress`), the
   command `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "a Play press in a frame from another site"`
   exits non-zero, with the assertion on `/beacon/embed-surface-clicked`, and
   exits zero on unmodified `main`.
2. The label path is still exercised in a cross-site frame by some test: either
   the same test with plant B alone failing it, or another test that does. Plant B
   alone is run and its outcome recorded.
3. The test's title says what its outcome depends on.
4. `provoke.ts` and every other file under `resolvers/src` are byte-identical to
   `main`; only the test, its fixtures, and this ticket change.

## Log

**2026-10-13 — filed (maintenance, builder Sonnet 5.5).** Source: dl-114's gate 1
(Opus 5.5, on `81daba51`), which found this test passing under its read-path
mutation (`isPlayPress` returning null for `title`, `data-testid` and `id`) and
filed it as out of range. The owner chose to file it as its own pull request,
apart from dl-114's #476. Reproduced on `origin/main` at `2cb4e734` before
filing; commands and outputs are above.

What the finding had wrong, for the next reader: it put the pass down to the
manifest being captured at 1.5 s, before any box click. That is not what holds
the test green. Under plant A + B the box is clicked and the embed's surface
beacon is requested, so nothing playable had been captured when the click was
decided. The cause is the second path, `clickByText`, which presses the same
button by its accessible name and reports `labelClicked`.

Not measured: whether any other test depends on `embed-inner.html`'s button
being matched by the label path (a grep over `tools/downloader` finds the fixture
named only by `box-xo-embed.html`, the test, and dl-100's ticket).

**2026-10-15 — built (builder Sonnet 5.5), branch `dl-123-play-press` off `origin/main` at `8e49523c`.**
Took Build 1 and added Build 2's second embed, because Done when 2 asks for
plant B alone to fail some test and an icon-only fixture alone would leave no
test pressing the label path in a cross-site frame.

- `embed-inner.html`: the button is now `<button id="play">&#9654;</button>`, a
  glyph with no word, `aria-label` or `title`, so `PLAY_TEXT` cannot match it.
  The existing test's title now says what it depends on.
- New `embed-inner-label.html` (the old text button, `id="go"`, no attribute
  `isPlayPress` counts) and `box-xo-embed-label.html`, and a test after the
  existing one pinning that the label path alone holds the box click back.
- `resolvers/src` is untouched; the plants below were applied to `provoke.ts`
  in place and restored from commit `e051772c`, and `git diff HEAD --stat --
tools/downloader/resolvers/src` was empty after each.

The brief had one thing wrong in the fixture: a glyph wrapped in a `<span>` is
not enough. The embed's own `document` click listener reports any click whose
target is not the button, and a click on a child `span` has the span as its
target, so the press itself requested `/beacon/embed-surface-clicked` and the
test failed on unmodified `main` (`expected [ '/box-xo-embed.html', …(6) ] to not
include '/beacon/embed-surface-clicked'`). The glyph is a bare text node.

Command for every row: `npx vitest run
tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "a Play press
in a frame from another site"`, which now selects two tests (121 in the file).

| State                                            | icon test (isPlayPress only) | label test (label path only) | exit |
| ------------------------------------------------ | ---------------------------- | ---------------------------- | ---- |
| unmodified                                       | pass                         | pass                         | 0    |
| plant A (`id === "play"` line deleted)           | **fail**, beacon asserted    | pass                         | 1    |
| plant B (`labelClicked` dropped from the return) | pass                         | **fail**, beacon asserted    | 1    |
| plant A + B                                      | fail                         | fail                         | 1    |

Each failing row prints `AssertionError: expected [ '/box-xo-embed.html', …(5) ]
to not include '/beacon/embed-surface-clicked'` (`/box-xo-embed-label.html` for
the label test), `Tests 1 failed | 1 passed | 119 skipped (121)`, and A + B
`Tests 2 failed | 119 skipped (121)`.

Not folded in: nothing else was free. dl-115 edits `quietMs: 1200` sites in the
same test file; this branch touches only the one title and appends one test.

- 2026-10-15 — Fixed at landing by owner choice: gate 1, the low `nfr:maintainability` — "the icon test's new comment says 'Its button has no text', but `embed-inner.html`'s button holds a text node, the glyph `&#9654;`. What keeps the label path off is that the glyph is no word `PLAY_TEXT` matches". The comment in `browser-resolver.test.ts` now reads "Its button holds only a glyph, no word PLAY_TEXT matches, so the label path cannot cover for isPlayPress." `npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts -t "a Play press in a frame from another site"` → `Test Files  1 passed (1)`, `Tests  2 passed | 119 skipped (121)`, exit 0.
