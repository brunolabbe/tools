---
id: dl-69
tool: downloader
title: SCROLL_SCRIPT, hasPlayerElement and dismissModal's video check stay light-DOM only
kind: fix
status: ready
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
