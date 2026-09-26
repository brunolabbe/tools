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

**`SCROLL_SCRIPT`, measured: the missing scroll was cosmetic, not
load-bearing, for the case the Why section raised.** Built a scratch fixture
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
`doScrollIntoView` unconditionally before every click — a step the `force`
option does not skip (`force` only skips the `visible`/`stable`/`enabled`
checks, listed separately in the same function) — so `clickChosenVideo`'s own
click already scrolls its target into view with no help from `SCROLL_SCRIPT`
at all. The gap is real only for a page that lazily _mounts_ its player on
scroll (an `IntersectionObserver`-gated component, say) rather than merely
positioning an already-mounted one off-screen — not measured, since it needs
a different fixture shape than the Why section's off-screen case. No
regression test added for the case measured here: there is no behavioural
difference for it to protect, and dl-61's existing shadow-root-click tests
already cover the general "shadow-root player gets clicked" path. The fix
itself (Build step 2's literal text) is applied regardless, since the ticket
asked for the shadow-piercing selector on its own merits, independent of
this measurement.

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

**What the ticket had wrong.** Nothing factual — the Why section's
reproduction and the "unmeasured" labels both held. What it did not say: that
giving `ALL_MEDIA_FN` a second parameter requires moving its definition ahead
of `MARK_CLOSE_SCRIPT` in the file (a `const` used inside another `const`'s
template-literal interpolation has to be declared first), which is the
mechanical reason the citation-repair surface was as large as it was.
