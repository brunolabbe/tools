---
id: dl-69
tool: downloader
title: SCROLL_SCRIPT, hasPlayerElement and dismissModal's video check stay light-DOM only
kind: fix
status: done
milestone: null
depends_on: [dl-68]
difficulty: standard
---

# dl-69 — `SCROLL_SCRIPT`, `hasPlayerElement` and `dismissModal`'s video check stay light-DOM only

## Why

dl-61 and dl-68 made the surface click's chooser, `PLAY_SCRIPT`, and
`METADATA_SCRIPT`'s audio fallback shadow-piercing, through `ALL_MEDIA_FN` in
`resolvers/src/browser/provoke.ts`. Three more places in that file still query
the light DOM only:

- `SCROLL_SCRIPT` (~:350) —
  `document.querySelector('video, iframe, [class*="player"], [id*="player"]')`,
  used to scroll a player into view before the provocation clicks run.
- `SIGNALS_SCRIPT`'s `hasPlayerElement` (~:421) —
  `document.querySelector('video, audio, iframe[src], [class*="player"],
[id*="player"]')`, fed into `classify.ts:161`'s `loginForm` test:
  `hasPasswordInput && !hasPlayerElement`.
- `dismissModal`'s close-layer guard, `container.querySelector('video')`
  (~:129, inside `MARK_CLOSE_SCRIPT`) — a layer holding a `<video>` is left
  alone, so the close pass does not dismiss a page's own lightbox player.

Found by `ticket-reviewer` (agent `a6826dcd8029e0028`) while gating dl-68, by
reading — not measured there. The owner decided to file one ticket for all
three (2026-09-19, options: file one ticket, fold into dl-68, or leave; chose
filing, matching both the reviewer's and the orchestrator's recommendation)
rather than widen dl-68's branch or fix any of them there.

### Reproduction, 2026-09-19 (`hasPlayerElement`, measured)

Measured on `dl-68-shadow-root-play-metadata` at `ffbd273`, before this ticket
existed. Fixture — a page with a password field in the light DOM and its only
`<video>` inside an open shadow root, nothing else that would count as a
player:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Password page, shadow-root player</title>
  </head>
  <body>
    <h1>Sign in</h1>
    <form>
      <input type="password" name="password" />
    </form>
    <div id="host"></div>
    <script>
      (function () {
        var root = document.getElementById("host").attachShadow({ mode: "open" });
        root.innerHTML = '<video id="sv" width="640" height="360" muted playsinline></video>';
      })();
    </script>
  </body>
</html>
```

Scratch test, appended to `provoke.test.ts` and reverted after the run (the
fixture file above was reverted with it — neither is committed):

```ts
describe("dl-69 SCRATCH reproduction (not part of the suite, reverted after run)", () => {
  test("hasPlayerElement misses a shadow-root video on a password page", async () => {
    const { readSignals } = await import("../../src/browser/provoke.ts");
    const { classifyFailure } = await import("../../src/browser/classify.ts");
    await pool.withBrowser({ signal: new AbortController().signal }, async (browser) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(server.url("/password-shadow-player.html"), {
          waitUntil: "domcontentloaded",
        });
        const signals = await readSignals(page);
        console.log("GATE_MEASUREMENT_SIGNALS:", JSON.stringify(signals));
        const verdict = classifyFailure({
          ...signals,
          finalUrl: server.url("/password-shadow-player.html"),
          status: 200,
          quietReached: true,
        });
        console.log(
          "GATE_MEASUREMENT_VERDICT:",
          verdict.code,
          verdict.message,
          JSON.stringify(verdict.details),
        );
        const counterfactual = classifyFailure({
          ...signals,
          hasPlayerElement: true,
          finalUrl: server.url("/password-shadow-player.html"),
          status: 200,
          quietReached: true,
        });
        console.log(
          "GATE_MEASUREMENT_COUNTERFACTUAL:",
          counterfactual.code,
          JSON.stringify(counterfactual.details),
        );
      } finally {
        await context.close();
      }
    });
  });
});
```

Command:
`npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t "dl-69" --reporter=verbose`.
Output (port elided, an ephemeral fixture-server port):

```
GATE_MEASUREMENT_SIGNALS: {"title":"Password page, shadow-root player","bodyText":"Sign in",...,"hasPasswordInput":true,"hasPlayerElement":false,"ageGate":false}
GATE_MEASUREMENT_VERDICT: AUTH_REQUIRED This video requires a signed-in account. {"url":"http://127.0.0.1:PORT/password-shadow-player.html","status":200,"reason":"login-form"}
GATE_MEASUREMENT_COUNTERFACTUAL: NO_MEDIA_FOUND {"url":"http://127.0.0.1:PORT/password-shadow-player.html","status":200}
```

`hasPlayerElement` reads `false` for a page whose only player lives in an open
shadow root — confirmed shadow-blind. With that value, `classifyFailure`
returns `AUTH_REQUIRED` (`reason: "login-form"`), which stops the resolver
chain outright (`classify.ts`'s own doc: "everything else stops the chain, so
each verdict needs to be one we would defend"). Forcing `hasPlayerElement:
true` on the identical signals — the shadow-piercing counterfactual — changes
the verdict to `NO_MEDIA_FOUND`, which falls through to the next resolver tier
instead. **This is a real misclassification**: a page carrying an unrelated
password field (site-nav login, a comments section, a newsletter gate)
alongside a real player hidden in a shadow root is currently treated as a
login wall and stopped, rather than being handed to the next tier.

### `SCROLL_SCRIPT` and `dismissModal`'s video check — unmeasured

Found by reading only; neither was reproduced, per the owner's instruction to
label each honestly rather than claim a measurement that was not taken:

- `SCROLL_SCRIPT` scrolls the first light-DOM match into view before the
  provocation clicks run. A shadow-root player is simply never scrolled into
  view. `clickChosenVideo`'s click uses `force: true`, which skips most of
  Playwright's actionability checks; whether that already makes the missed
  scroll harmless, or whether an off-screen shadow-root player still fails to
  receive the click, is not measured here.
- `dismissModal`'s `container.querySelector('video')` (inside
  `MARK_CLOSE_SCRIPT`) skips closing a layer that holds a `<video>`, so a
  page's own lightbox player is not dismissed by mistake (its own docstring:
  "sites open their player in a lightbox, and closing that closes the thing
  this tier exists to watch"). If that video lives in a shadow root inside the
  layer, the check misses it, and the layer's close control could be pressed —
  dismissing the lightbox that holds the real (shadow-root) player. Not
  reproduced.

## Build

1. In `resolvers/src/browser/provoke.ts`, give `SIGNALS_SCRIPT`'s
   `hasPlayerElement` a shadow-piercing check:
   `(${ALL_MEDIA_FN})('video, audio, iframe[src], [class*="player"],
[id*="player"]').length > 0` in place of the `document.querySelector(...)`
   call. This is the one with a measured, reproduced effect (above) — build
   it first, and confirm on the reproduction fixture that the verdict changes
   from `AUTH_REQUIRED` to something that does not stop the chain (dl-68's
   own tip already returns `NO_MEDIA_FOUND` for the counterfactual; that is
   the target, not necessarily the only acceptable one — say in the Log if it
   differs).
2. Give `SCROLL_SCRIPT` the same treatment:
   `(${ALL_MEDIA_FN})('video, iframe, [class*="player"], [id*="player"]')[0]`
   in place of `document.querySelector(...)`. Measure its actual effect (the
   Why section's open question) before or after the change, and record the
   answer in the Log — this ticket does not yet know whether the missing
   scroll is cosmetic or load-bearing.
3. `dismissModal`'s check runs inside `MARK_CLOSE_SCRIPT`, scoped to a
   `container` element rather than `document` — `ALL_MEDIA_FN`'s walk is
   hardcoded to start at `document`, so it cannot be called as-is here. Give
   it a second, optional parameter naming the root to start from (defaulting
   to `document` at every existing call site, so `CHOOSE_VIDEO_FN`,
   `PLAY_SCRIPT` and dl-69's own new calls above are unaffected), and call it
   with `container` here: `(${ALL_MEDIA_FN})('video',
container).length > 0` in place of `container.querySelector('video')`.
   Measure its actual effect the same way as step 2.
4. **Tests**, at the end of `browser-resolver.test.ts` and/or
   `provoke.test.ts`, whichever isolates each case the way dl-68's Build step
   4 explains. For `hasPlayerElement`, commit the fixture and test above
   (rather than leaving it scratch) driving `readSignals` + `classifyFailure`
   directly — the same direct-call isolation `provoke.test.ts`'s duration
   tests already use, for the same reason: a full probe never reaches
   `classifyFailure` when media is actually found. For `SCROLL_SCRIPT` and
   `dismissModal`, decide whether a fixture is buildable and worth adding only
   after measuring the actual effect step 2 and step 3 ask for, and say
   either way in the Log.

## Done when

- The reproduction above returns something other than `AUTH_REQUIRED` (a
  verdict that does not stop the resolver chain) for the password/shadow-player
  fixture, with the fixture and test committed.
- `SCROLL_SCRIPT` and `dismissModal`'s video check are shadow-piercing, and
  the Log states what each was measured to do, before the fix and after —
  not just that they were changed.
- `npm run check` and `npm test -- --project downloader` pass.

## Review

### Gate 1 — ticket-reviewer-opus (Opus 5.5), a different model from the builder

**Gate: CONCERNS** — 2026-09-26 · `a1a417b...7c02084`, reviewed at tip 7c02084 (origin/main still at a1a417b after the fetch) · code-review at medium, run by the reviewer

Coordinates re-resolved against da144f9 at gate 2. Where da144f9 removed the cited text, the citation is prose naming 7c02084; provoke.ts lines 386 and 468 now hold the corrected comments the fifth low was about; the dismissModal proof cites lines 144-146 because da144f9 added a second, identical `expect(clicked).toBe(0)`.

| Done when                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reproduction returns a verdict other than `AUTH_REQUIRED` that does not stop the chain, fixture and test committed     | proven — `tools/downloader/resolvers/test/browser/provoke.test.ts:120 "expect(signals.hasPlayerElement).toBe(true)"` and the assertion at provoke.test.ts line 112 at 7c02084 (`expect(verdict.code).not.toBe`, since tightened), red on a1a417b's provoke.ts (expected false to be true). The does-not-stop-the-chain clause is verified, not asserted: the reviewer read `NO_MEDIA_FOUND` on this fixture at the tip and `AUTH_REQUIRED` on the base; first low          |
| `SCROLL_SCRIPT` and `dismissModal`'s video check are shadow-piercing, and the Log states each measurement before and after | dismissModal proven — `tools/downloader/resolvers/test/browser/provoke.test.ts:144-146 "dismissing the lightbox that holds the real player"`, red on the base (expected 1 to be +0), except for a layer that is itself the video's shadow host: first med. SCROLL_SCRIPT verified only, by the reviewer: a hidden shadow-root video 6000px down ends at scrollY 800 on the base and 5660 at the tip; nothing asserts it: second med. The Log states both, before and after |
| `npm run check` and `npm test -- --project downloader` pass                                                                | verified at 7c02084 — check exit 0; downloader 92 files passed and 1 skipped, 1550 passed and 2 skipped of 1552, exit 0; `npx vitest run tools/downloader/resolvers` 18 files, 453 of 453. The test diff adds two tests and two imports and changes no existing assertion                                                                                                                                                                                                  |

- **med** · **The close-layer guard misses a layer that is itself the shadow host of its video.** `ALL_MEDIA_FN` walks the root's own subtree and the shadow roots of hosts inside it, never the root's own `shadowRoot`: provoke.ts line 125 at 7c02084 (`walk(root || document);`, since replaced). Premises: `elementsFromPoint` retargets to the host, and the climb stops at the first dialog or fixed element, so a custom-element lightbox carrying `role=dialog` or fixed position, with its video in its own open shadow root and a slotted close button, becomes `container`. Reproduction, reviewer's scratch spec: `<div role=dialog aria-modal=true style=position:fixed...><button aria-label=Close>x</button></div>`, then an open shadow root on that div holding a `<slot>` and a 640x360 `<video>`; `dismissModal(page.mainFrame(), { timeoutMs: 1500, scriptable: true })` returns 1 at both a1a417b and 7c02084. Walking `start.shadowRoot` after `walk(start)` turns it to 0, and a shadow video outside the dialog still returns 1. `tools/downloader/resolvers/src/browser/provoke.ts:162 "player component that keeps its"` reads as covering this shape. **Open decision**: (a, recommended) fix here, one line plus a test on this shape, work this branch made free; (b) file a dl- ticket carrying this reproduction.
- **med** · **The SCROLL_SCRIPT change has no test, and the Log's reason for none does not hold.** The Log's 2026-09-26 entry, SCROLL_SCRIPT paragraph, finds no behavioural difference to protect and leaves the lazy-mount case unmeasured. Measured by the reviewer: a shadow-root `div.player-shell`, 640x360 and 6000px down, mounted by an `IntersectionObserver` that fetches `/media/related/master.m3u8` on intersection. `provokePlayback`, 15 s deadline: on the base not mounted, master not requested, scrollY 800; at the tip mounted, master requested, scrollY 5656. That fixture is buildable and red on the base for `tools/downloader/resolvers/src/browser/provoke.ts:405 "ALL_MEDIA_FN})('video, iframe"`, and provoke.ts line 372 at 7c02084 (`(not measured here), never for the click itself.`, since rewritten) goes stale with it.
- **low** · the hasPlayerElement test asserts only `not.toBe("AUTH_REQUIRED")`. `tools/downloader/resolvers/src/browser/classify.ts:5 "lets the registry fall"` says only `NO_MEDIA_FOUND` falls through, so any other chain-stopping verdict passes it; `toBe("NO_MEDIA_FOUND")` is the line's own claim.
- **low** · closed shadow roots: a closed-root video inside the dialog still gets its dialog closed, 1 at both tips (reviewer). Unreachable from page script, so not fixable here, but the only statement is `tools/downloader/resolvers/src/browser/provoke.ts:76 "Closed roots are"`, written about the chooser; neither the guard's docstring nor the Log says the guard and hasPlayerElement inherit it.
- **low** · two plain comments escape their backticks with a backslash, which renders literally outside a template literal: `tools/downloader/resolvers/src/browser/provoke.ts:386 "clicking it regardless of"` and `tools/downloader/resolvers/src/browser/provoke.ts:468 "is (dl-61, dl-68): a page with an unrelated password field"`.
- **low** · the `ALL_MEDIA_FN` docstring's caller list at provoke.ts line 107 at 7c02084 (`call site that existed before it`, since rewritten) omits `CHOOSE_VIDEO_INDEX_SCRIPT` and `UNMARK_VIDEO_SCRIPT`, and counts SCROLL_SCRIPT and SIGNALS_SCRIPT, whose calls are new here, among sites that existed before.
- **low** · the merged-record repair rewords more than coordinates. dl-55's record line 288 at 7c02084 (`by, in order, the round-3`, since restored) drops the 386 step and the clause saying dl-68 did not change the cited clause; dl-55's record line 317 at 7c02084 (`398→422 by dl-69`, since restored) credits the whole 373→386→398→422 chain to dl-69. Every verdict and anchor is unchanged, dl-68's edits are coordinates plus appended provenance, and `node scripts/citations-gate.mjs --against origin/main` exits 0: 106 enforced, 0 failing.
- **low** · the Log says `force` skips only the visible, stable and enabled checks; in playwright-core 1.62.1's `_performPointerAction` it also skips the hit-target check. The load-bearing half holds: `doScrollIntoView` runs outside the block that `force` skips, and a forced click on a shadow video 6000px down, with no scroll first, moved scrollY from 0 to 5654 and fired its handler (reviewer).
- **dropped** · hasPlayerElement now also counts a shadow-root element whose class or id contains player, so a real login wall carrying such a component falls through rather than stopping. The light DOM already behaves so; consistent, not a defect.
- **measured, not a finding** · scope: a shadow video outside a plain dialog does not stop its dismissal (1 at the tip). Nesting: a video two open roots deep inside the dialog stops it (0 at the tip, 1 on the base). Interpolation: `ALL_MEDIA_FN` is a string rather than a `toString`, falls back to `document` in its body rather than through a default parameter, and closes only over its own locals; seven of the eight interpolation sites show their effect in the suite or the reviewer's spec, and the eighth, UNMARK_VIDEO_SCRIPT, runs under a catch nothing observes and interpolates the identical string (not measured); and dl-68's callers pass one argument into an otherwise unchanged walk. Cost: 100k light elements with 200 hosts, readSignals 45 ms at the tip against 18 ms on the base; 1000 nested open roots walked in 13 ms. Recursion deeper than that was not measured; a throw there is caught and yields `hasPasswordInput: false`.
- **findings** · code-review at medium, run by the reviewer, returned 9; 8 carried, 1 dropped.
- NFR: security n/a, no URL, header or subprocess touched · performance ✓, above · reliability, the two meds · maintainability, the comment lows.

## Log

**2026-09-19 — filed** from the ticket-reviewer's gate on dl-68 (agent
`a6826dcd8029e0028`), which found all three by reading while gating a
different fix, and routed them to the orchestrator as a possible filing
rather than deciding among file/fold/leave itself. The owner chose filing one
ticket for all three (2026-09-19, options: file one ticket, fold into dl-68,
or leave; chose file, matching both the reviewer's and the orchestrator's
recommendation) rather than widen dl-68's branch. The `hasPlayerElement` case
was measured before filing, per the owner's instruction that a defect
ticket's reproduction is its deliverable; `SCROLL_SCRIPT` and `dismissModal`'s
check were not measured, and are labelled unmeasured above rather than
claimed. Not built against.

**2026-09-26 — built** on `dl-69-provoke-shadow-dom`, off `origin/main` at
`a1a417b`.

**Reproduced before any fix.** Ran
`npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t "dl-69"`
against the unmodified branch with the ticket's own scratch test appended —
`AUTH_REQUIRED` (`reason: "login-form"`) for the counterfactual-free run,
matching the ticket's own measurement exactly. The premise holds.

**What changed**, all in `resolvers/src/browser/provoke.ts`. `ALL_MEDIA_FN`
(dl-61/dl-68's shadow-piercing walk) gained an optional second parameter,
`root`, defaulting to `document` at every call site that already existed
(`CHOOSE_VIDEO_FN`, `CHOOSE_VIDEO_INDEX_SCRIPT`, `UNMARK_VIDEO_SCRIPT`,
`PLAY_SCRIPT`, `METADATA_SCRIPT`'s audio fallback), per Build step 3. Since a
template-literal interpolation of `${ALL_MEDIA_FN}` needs the JS `const` in
scope at the point it is read, and `MARK_CLOSE_SCRIPT` is defined earlier in
the file than `ALL_MEDIA_FN` was, `ALL_MEDIA_FN`'s definition (with its whole
doc comment) was moved up, to directly after `SEMANTIC_DIALOG` and before
`MARK_CLOSE_SCRIPT` — the only way to reference it there without a TDZ error.
This is what moved most of the file's later line numbers and is the
"expected work" the dispatch named.

Three call sites now use it:

- `SIGNALS_SCRIPT`'s `hasPlayerElement`:
  `(ALL_MEDIA_FN)('video, audio, iframe[src], [class*="player"],
[id*="player"]').length > 0` in place of `document.querySelector(...)`
  (Build step 1).
- `SCROLL_SCRIPT`: `(ALL_MEDIA_FN)('video, iframe, [class*="player"],
[id*="player"]')[0]` in place of `document.querySelector(...)` (Build step
  2).
- `MARK_CLOSE_SCRIPT`'s close-layer guard: `(ALL_MEDIA_FN)('video',
container).length > 0` in place of `container.querySelector('video')`
  (Build step 3), the one call site that passes a non-default `root`.

**`hasPlayerElement`, verified.** After the fix, the same reproduction
(`npx vitest run tools/downloader/resolvers/test/browser/provoke.test.ts -t
"hasPlayerElement"`) reports `hasPlayerElement: true` and `classifyFailure`
returns `NO_MEDIA_FOUND`, not `AUTH_REQUIRED` — falls through to the next
resolver tier, as the ticket's Build step 1 asked. Committed as
`tools/downloader/resolvers/test/fixtures/pages/password-shadow-player.html`
(the ticket's own reproduction fixture, unchanged) and a permanent test in
`provoke.test.ts` driving `readSignals` + `classifyFailure` directly, per
Build step 4.

**`SCROLL_SCRIPT`, measured in two directions — cosmetic for the click
itself, load-bearing for a lazily-mounted player.** Built a scratch fixture
(reverted, not committed): a click-only shadow-root player, identical in
shape to `shadow-player.html`, pushed 6000px below the initial viewport.
Ran the resolver end to end against it twice, swapping only
`SCROLL_SCRIPT`'s selector line between the light-DOM `document.querySelector`
(pre-fix) and the shadow-piercing `ALL_MEDIA_FN` (post-fix) between runs,
each via a scratch test asserting `result.variants[0]?.url` — **both runs
returned the stream** (`http://127.0.0.1:<port>/media/related/master.m3u8`,
with `/media/related/master.m3u8` and `v720.m3u8` both requested). Reading
Playwright's own `_performPointerAction` in
`node_modules/playwright-core/lib/coreBundle.js` explains why: it calls
`doScrollIntoView` unconditionally before every click — a step `force` does
not skip (`force` skips the `visible`/`stable`/`enabled` checks _and_ the
hit-target check, all listed separately from the scroll in the same
function) — so `clickChosenVideo`'s own click already scrolls its target
into view with no help from `SCROLL_SCRIPT` at all.

**Corrected in gate round 1 (med 2): the lazy-mount case is real, and was
measured, not left unmeasured.** The gate built a shadow-root shell 6000px
down, named with a `player`-ish class, that requests its manifest only once
an `IntersectionObserver` reports it visible — the shape a real lazy-mount
library uses. Reproduced independently (`npx vitest run
tools/downloader/resolvers/test/browser/zz-gate-dl69.test.ts -t "M7c"`,
scratch copy of the gate's own spec): with the pre-dl-69 `provoke.ts`
(`git show a1a417b:...provoke.ts`) swapped in, `{"scrollY":800,"mounted":false}`,
master not requested; with the current tip, `{"scrollY":5656,"mounted":true}`,
master requested — matching the gate's own numbers. The shadow-piercing
`SCROLL_SCRIPT` already fixed this (it matches the shell on its class name,
`<video>` never having mounted yet, and scrolls to it), so the fix needed no
further code change, only a committed regression test:
`tools/downloader/resolvers/test/fixtures/pages/shadow-player-lazy-mount.html`
and `provoke.test.ts`'s "SCROLL_SCRIPT reaches a shadow root, for a player
that mounts lazily on scroll" — confirmed red against the pre-fix selector
line, green against the fix. The stale comment above `SCROLL_SCRIPT` (it said
this case was "not measured here") is corrected to describe both directions.

**`dismissModal`, measured: load-bearing, a real defect, now fixed.** Built
`tools/downloader/resolvers/test/fixtures/pages/modal-shadow-player.html`: a
semantic dialog (`role="dialog"`, `aria-modal="true"`) holding a close button
and a shadow-root `<video>`. Calling `dismissModal(frame, { timeoutMs: 1500,
scriptable: true })` directly against it, with the guard temporarily reverted
to `container.querySelector('video')`, returned `1` — the close button was
pressed, dismissing the layer holding the real player, exactly the Why
section's concern. With the fix
(`(ALL_MEDIA_FN)('video', container).length > 0`) it returns `0`: the guard
fires, the layer is left alone. Committed as a permanent test in
`provoke.test.ts`.

**2026-09-26 — gate round 1 (ticket-reviewer-opus, Opus 5.5) fixes.** CONCERNS,
2 med + 6 low + 1 dropped. Owner decision on the first med's open decision:
fix on this branch (2026-09-26, options were fix here or file a `dl-` ticket
carrying the reproduction; the owner was told the branch does not introduce
the reproduced case — the base returns 1 too — only that the docstring reads
as covering it).

- **med 1 (`dismissModal` still misses one shape)** — reproduced first,
  independently: copied the gate's own scratch spec
  (`zz-gate-dl69.test.ts`) into the tree and ran it at `7c02084` —
  `dismissModal returned 1` for "M2 container is itself the shadow host of
  its video" (a custom-element lightbox where the `role="dialog"` element is
  itself the shadow host of its `<video>`, a `<slot>` projecting the light-DOM
  close button), matching the gate's own number. `ALL_MEDIA_FN` walks a
  node's descendants and their shadow roots, but never the starting node's
  _own_ `.shadowRoot` — so a `container` that is itself a shadow host was
  never checked. Fixed by walking `start.shadowRoot` once, separately from
  `walk`, after `walk(start)`. Re-ran the same scratch case after the fix:
  `dismissModal returned 0`. The M1 scope property (a shadow video _outside_
  the dialog must not block dismissal) still returns `1`, reproduced both
  before and after. Both shapes committed as permanent tests in
  `provoke.test.ts`, with new fixtures `modal-is-shadow-host.html` and
  `modal-shadow-video-outside.html`; M1 confirmed green throughout, M2
  confirmed red before the fix.
- **med 2 (`SCROLL_SCRIPT` lazy-mount case)** — corrected above, in the
  `SCROLL_SCRIPT` paragraph, and as a committed test.
- **low (hasPlayerElement assertion too loose)** — `expect(verdict.code).not.toBe("AUTH_REQUIRED")`
  tightened to `.toBe("NO_MEDIA_FOUND")`, the one verdict `classify.ts`
  documents as falling through the chain. Still green.
- **low (closed-root limitation undocumented)** — added to both
  `hasPlayerElement`'s comment and `MARK_CLOSE_SCRIPT`'s docstring: a closed
  shadow root is invisible to page script, so a closed-root player is not
  reachable by either check, matching `ALL_MEDIA_FN`'s own existing statement
  about the chooser. Not fixable — there is nothing to query — so documented
  rather than changed, per the gate's own finding.
- **low (two backslash-escaped backticks)** — two comments escaped their
  backticks with a backslash (not inside template literals, so the escape
  renders literally): `provoke.ts:386` "clicking it regardless of" and
  `provoke.ts:468` "is (dl-61, dl-68): a page with an unrelated password
  field". Corrected to `` `force` `` etc.
- **low (`ALL_MEDIA_FN` docstring's caller list wrong)** — corrected: the
  pre-existing callers are `CHOOSE_VIDEO_FN`, `CHOOSE_VIDEO_INDEX_SCRIPT`,
  `UNMARK_VIDEO_SCRIPT`, `PLAY_SCRIPT` and `METADATA_SCRIPT`'s audio fallback
  (all passing no `root`); `SCROLL_SCRIPT` and `SIGNALS_SCRIPT`'s
  `hasPlayerElement` are dl-69's own new callers, not pre-existing ones.
- **low (dl-55's merged-record repair reworded more than coordinates)** —
  restored the original wording at dl-55's Review record lines (record text,
  not code) describing the `328→373→386→398` chain and dl-68's
  non-changing append, appending only the new `→422` hop and its
  attribution to dl-69's reorder, rather than crediting the whole chain to
  dl-69 or dropping the `386` step.
- **low (Log's description of what `force` skips was incomplete)** —
  corrected above, in the `SCROLL_SCRIPT` paragraph: `force` also skips the
  hit-target check, not only visible/stable/enabled.
- **dropped (hasPlayerElement now also counts a shadow-root class/id
  match)** — not a defect, consistent with the light-DOM behaviour already
  in place; no change.

Re-verified after all of the above: `npx vitest run
tools/downloader/resolvers/test/browser/provoke.test.ts` — 7 of 7 pass (four
from round 1 plus the M2, M1-scope and lazy-mount tests this round adds).
`npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
— 50 of 50 pass, unchanged. `npm run check` — exit 0. `npx vitest run
tools/downloader/resolvers` — command and count in the round-2 Verification
paragraph below. `node scripts/citations-gate.mjs --against origin/main` —
also below, run as the last action before commit.

**Fold-in considered, declined.** dl-68's own dropped finding (this ticket's
origin) named exactly these three call sites and nothing else; no other
small already-specified piece of work was made free by this change, so
nothing else was folded in.

**Citations repaired**, per the dispatch's own note that moving these three
scripts would displace dl-68's and dl-55's merged `## Review` citations into
this same file. `node scripts/citations-gate.mjs --against origin/main`
failed at 2 records after the `ALL_MEDIA_FN` move (6 moved in dl-55, 4 moved
in dl-68, one of which — `provoke.ts:153` — did not resolve anywhere until
the docstring's own line wrap was adjusted so "Playwright's own locator match
order for a single-type" sits on one source line again, matching the
existing anchor text verbatim). All ten were repointed to their new line
numbers (dl-55: `provoke.test.ts:51→52`, `provoke.ts:398→422` twice,
`provoke.ts:640→670`, `provoke.ts:226→238`; dl-68: `provoke.test.ts:76→77`,
`provoke.ts:369→393`, `provoke.ts:398→422`, `provoke.ts:153→71`), anchor text
unchanged, no verdict changed. Re-run as the last action before this commit:
`node scripts/citations-gate.mjs --against origin/main` — `106 enforced, 0
failing; 7 grandfathered`, exit 0.

**Verification.** `npx vitest run
tools/downloader/resolvers/test/browser/provoke.test.ts` — 4 of 4 tests pass
(the two pre-existing plus the two new ones).
`npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
— 50 of 50 tests pass (no regression from the shadow-piercing `dismissModal`
guard against any existing modal fixture). `npm run check` — exit 0.
`npm test -- --project downloader` — 92 files passed, 1 skipped (93); 1550
tests passed, 2 skipped (1552), exit 0 (run once, before the final docstring
line-wrap fix, which touches only a comment; re-run at the narrower specs
above after it, both green).

**Round-2 verification (gate round 1 fixes), commands run and read
directly.** `npm run check` — exit 0. `npx vitest run
tools/downloader/resolvers/test/browser/provoke.test.ts` — 7 of 7 pass (3
tests this round adds: M2, the M1-scope assertion, and the SCROLL_SCRIPT
lazy-mount test).
`npx vitest run tools/downloader/resolvers/test/browser/browser-resolver.test.ts`
— 50 of 50 pass, unchanged. `npx vitest run tools/downloader/resolvers` — 18
files, 456 of 456 (453 from the gate's own round-1 count plus the 3 this
round adds). `node scripts/citations-gate.mjs --against origin/main`, run as
the last action before `git add` — `106 enforced, 0 failing; 7 grandfathered`,
exit 0. This round's own edits moved 9 more citations across dl-55's and
dl-68's merged Review records (the same nine coordinates round 1 had already
moved once, moved a second time by this round's docstring edits); repointed
the same way, anchor text unchanged, no verdict changed.

**What the ticket had wrong.** Nothing factual — the Why section's
reproduction and the "unmeasured" labels both held. What it did not say: that
giving `ALL_MEDIA_FN` a second parameter requires moving its definition ahead
of `MARK_CLOSE_SCRIPT` in the file (a `const` used inside another `const`'s
template-literal interpolation has to be declared first), which is the
mechanical reason the citation-repair surface was as large as it was.
