---
id: dl-48
tool: downloader
title: The browser tier closes a modal over the player, and confirms an age gate only when the operator opts in
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-48 — A modal over the player, and an age gate under it

**Packages:** `resolvers` (the provocation step and the failure classifier),
`contract` (one error code), `api` (one setting), and the analysis and
architecture docs that list failure modes and settings.

**The site and the page are deliberately not named anywhere in this ticket**,
on the owner's instruction. Nothing here needs them: the failure is a page
shape, and the fixture below reproduces that shape locally.

## Why

**A public video page on a large video site answers `NO_MEDIA_FOUND` with
yt-dlp off, although its stream is plain, unencrypted HLS.** The roadmap's
coverage phase counts only failures reproduced with
`ENABLE_YTDLP_RESOLVER=false`, and this one was. Reproduced on 2026-09-13
against the dev API, from `origin/main` `8849c14`:

- **`POST /api/probe` answered 422 `NO_MEDIA_FOUND` in 9 s.** `details.attempts`
  was `browser: NO_MEDIA_FOUND`, then `direct: NO_MEDIA_FOUND`.
- **The stream is not the obstacle.** The page's own player configuration
  carries no DRM token and marks the video unlicensed. Its HLS master playlist
  lists 10 variants up to 720p, and a variant playlist has 65 segments and no
  `EXT-X-KEY` line.
- **The player never mounts.** In a bare Playwright Chromium, outside the
  downloader, no frame held a `<video>` after 20–30 s, and no playlist was
  requested. That held with Chromium's default user agent and with a normal
  one, and with this environment's DNS and with public DNS answers mapped in.

**Two layers stand between the page and its player**, found by screenshot and
then by controlled runs:

1. **A promotional modal** covers the page and intercepts clicks.
2. **Under it, an 18+ self-confirmation** replaces the player until a button
   saying the viewer is over 18 is pressed. The player's configuration marks
   the video adult with an age rating of 18.

| Run                                       | Playlist requested | First segment | `<video>`                   |
| ----------------------------------------- | ------------------ | ------------- | --------------------------- |
| Close the modal only                      | never              | never         | none                        |
| **Close the modal, then confirm the age** | **10.3 s**         | **11.1 s**    | **playing, `blob:` source** |
| Confirm the age with the modal still open | never              | never         | none (the click timed out)  |

Each timing counts from navigation and includes an 8 s wait before the first
click. The playlist came from the site's own stream host, and the page URL did
not change.

**The browser tier does neither step today.** `provokeFrame` dismisses a
consent banner, scrolls, clicks play controls, clicks the video surface and
calls `play()`. Nothing closes a modal, and nothing recognises an age
confirmation. `CONSENT_TEXT` and `PLAY_TEXT` match neither label. The analysis
§7 row "Player never starts" names consent-banner dismissal as the one thing
to try first.

### Decided by the owner, 2026-09-13

Each was chosen from options:

- **Confirming an age is an operator opt-in, off by default.** Pressing "I am
  over 18" is an attestation made on the user's behalf, so a fresh install
  never makes it. When the setting is off and the gate is recognised, the probe
  fails with its own code, which says why, instead of the generic
  `NO_MEDIA_FOUND`.
- **The fix is a generic step in the browser tier, not a site resolver.** The
  browser resolver's header already argues that coverage is a property of that
  file and that everything site-specific above it is a latency optimisation. A
  priority-10 resolver would also put the site's name and API in the code.
- **Nothing identifying goes into the repo**: no site, URL, host, or the page's
  own button text.

### Adopted rather than asked, and why

- **Closing a modal is not an attestation**, so it is not behind the setting. It
  is the same class of act as dismissing a consent banner, which the tier
  already does unconditionally.
- **A modal is closed through its close control, never its call to action.** In
  the reproduction, an early run clicked the modal's large primary button and a
  stream did appear. That proved nothing: a promo's button starts or navigates
  to other content, and a stream from it is the wrong stream. Only the
  controlled runs above settled which interaction mattered.
- **A new code, `AGE_CONFIRMATION_REQUIRED`**, because no existing code's copy
  is true of it. `AUTH_REQUIRED` says "This video requires a signed-in account",
  and nothing here is about an account. Re-wording that copy at the raise site
  is the root `CLAUDE.md`'s tell that the code is wrong.

## Build

1. **Close a modal first, in `resolvers/src/browser/provoke.ts`.** Add a
   `dismissModal(frame, timeoutMs)` and call it at the top of `provokeFrame`,
   before `dismissConsent`, because a modal intercepts every later click.
   - Match close controls only: `[role='dialog']` or `[aria-modal='true']`
     descendants whose `aria-label` or `title` matches a close pattern, plus a
     `CLOSE_TEXT` pattern in the languages `CONSENT_TEXT` already covers, with
     Russian included. Russian is the one language the reproduction proved
     necessary.
   - Fall back to `Escape` once per pass when a dialog is visible and no close
     control matched.
   - At most one modal per pass, the same restraint `dismissConsent` argues:
     a second close click can open something else.
   - **Never click a dialog's primary action.** A test pins it (step 6).
2. **Recognise an age gate, in the same file.**
   - `AGE_GATE_TEXT`: short button or link labels in which the viewer states
     they are over an age (18 or 21), across the same languages. It is
     anchored the way `CONSENT_TEXT` is, so a sentence in the page body does
     not match a label.
   - `AGE_MARKERS`: page-level wording that the content is for adults, a list
     shaped like `classify.ts`'s `GEO_MARKERS`. A label counts as a gate only
     when a marker is present too. An "I am 18" link in a footer, on a page
     with nothing age-restricted about it, is not a gate.
   - `RawPageSignals` gains `ageGate: boolean` from `SIGNALS_SCRIPT`, which
     `readSignals` already evaluates.
3. **Confirm it only when told to.** `provokePlayback`'s options gain
   `confirmAge: boolean`. After `dismissModal` and `dismissConsent`, a frame
   with a recognised gate has its gate control clicked when `confirmAge` is
   true, and left alone when it is false. Playback provocation then continues
   as today, since the player mounts after the click.
4. **Classify the refusal, in `resolvers/src/browser/classify.ts`.** When the
   probe found no media and `signals.ageGate` is true, `classifyFailure`
   returns `AGE_CONFIRMATION_REQUIRED` with `details: { url, marker }`. It is
   checked after `BOT_CHALLENGE` and `AUTH_REQUIRED` and before `GEO_BLOCKED`:
   a challenge or a login wall in front of the gate is the more fundamental
   answer. A probe that found media never reaches the classifier, so a gate
   that was confirmed can never produce this code.
5. **The code and the setting.**
   - `contract/src/errors.ts`: `AGE_CONFIRMATION_REQUIRED` in the Analysis
     group, beside `AUTH_REQUIRED`, with a doc comment saying what it is and
     that the operator's setting clears it. Copy along the lines of "This video
     asks the viewer to confirm their age, and this server is not set to
     confirm it." Not retryable: retrying changes nothing until an operator
     does.
   - `api/src/http-errors.ts`: 422, as `AUTH_REQUIRED` and `BOT_CHALLENGE` are.
   - `api/src/config.ts`: `enableAgeConfirmation`, read with the existing
     `bool` helper from `ENABLE_AGE_CONFIRMATION`, **default `false`**. The API
     has no config test file today, since `loadApiConfig` is only exercised
     inside other suites, so add `api/test/config.test.ts` with a case for the
     default and one for `true`.
   - `api/src/resolvers.ts`: pass it to `new BrowserResolver({ … })` as
     `confirmAge`. `BrowserResolverOptions` gains the field, and the resolver
     threads it into `provokePlayback`. Add `ageConfirmation` to the
     `"resolver chain composed"` log line, for the reason that line already
     gives: "why did this site stop working" is answered by what was enabled.
6. **Tests**, with the browser tier's real-Chromium tests under
   `resolvers/test/browser/` and a static fixture page beside
   `resolvers/test/fixtures/pages/mse.html`:
   - **The fixture** is one page with an MSE player that is not mounted until
     an age button is pressed, an age marker in its text, and a modal over both
     that intercepts clicks. The modal has a close control and a primary action
     that navigates to a second fixture path.
   - With `confirmAge: true`, the probe finds the stream.
   - With `confirmAge: false`, the probe fails `AGE_CONFIRMATION_REQUIRED`, and
     the gate control was never clicked. The page records the click, and the
     test asserts it did not happen.
   - In both runs the modal's primary-action path is never requested, and its
     close control was clicked.
   - A page with an over-18 link and no age marker has the link left alone and
     fails `NO_MEDIA_FOUND`.
   - `resolvers/test/browser/capture-rules.test.ts`, where `classifyFailure`
     is already tested: the new branch, and that it follows `AUTH_REQUIRED` in
     precedence.
7. **Docs.**
   - `docs/00-ANALYSIS.md` §7 gains an "Age confirmation" row: an over-18
     interstitial where the player should be; `AGE_CONFIRMATION_REQUIRED`;
     `ENABLE_AGE_CONFIRMATION` confirms it. The "Player never starts" row's
     response names modal dismissal beside consent dismissal.
   - `docs/01-ARCHITECTURE.md`'s settings table gains the
     `ENABLE_AGE_CONFIRMATION` row, with default `false` and a line on why it
     defaults off.

## Traps

- **The modal must go first.** With the modal open, a click on the age control
  timed out in the reproduction. A gate step ordered before modal dismissal
  passes the fixture only if the fixture's modal fails to intercept clicks, so
  make sure it does.
- **A stream after clicking a modal's call to action is not a pass.** See
  _Adopted_. The fixture's primary action leads somewhere recordable for
  exactly this reason.
- **Default off is the decision, so test it rather than trust it.** A test
  builds the config from an empty environment and asserts
  `enableAgeConfirmation === false`, and the resolver test above proves that
  `false` means no click.
- **This environment's DNS sinkholes advertising and analytics hosts.** The
  reproduction's API log carried 31 `BLOCKED_TARGET` warnings for hosts
  resolving to `0.0.0.0`, which the SSRF guard is right to refuse. They were
  ruled out as the cause: the failure held with public DNS answers mapped in.
  Do not loosen the guard on their account.
- **The deadline.** In the reproduction the playlist came about 2 s after the
  age click. Modal dismissal, consent, the gate and playback all spend the same
  probe deadline inside `provokePlayback`'s two passes, so keep the added
  steps' own timeouts short, as `dismissConsent`'s 2000 ms is.
- **Label patterns are content.** They will need additions per language. Each
  addition is one line and needs no new branch.

## Done when

- `dismissModal` runs before consent and play, closes only through close
  controls or `Escape`, and never clicks a dialog's primary action (fixture
  test).
- An age gate is recognised only with both a label and a marker, is clicked
  only when `confirmAge` is true, and otherwise fails the probe
  `AGE_CONFIRMATION_REQUIRED` (fixture tests, both ways, plus the no-marker
  negative).
- `AGE_CONFIRMATION_REQUIRED` exists with copy, is not retryable, and answers 422.
- `ENABLE_AGE_CONFIRMATION` defaults to `false`, reaches `BrowserResolver`, and
  appears in the resolver-chain log line.
- The analysis §7 table and the architecture settings table carry the new rows.
- `npm run check` and `npm test -- --project downloader` pass. If the builder
  can reach the original page, a probe of it with `ENABLE_YTDLP_RESOLVER=false`
  and `ENABLE_AGE_CONFIRMATION=true` returning variants is worth a line in the
  Log. Ask the owner for the page: it is not in this repo.

## Log

**2026-09-13 — filed** from a reproduction against the dev API with yt-dlp off,
at `origin/main` `8849c14`, on the owner's two answers above. Facts checked
against the code at that commit:

- `provokeFrame` calls, in order: `dismissConsent`, the scroll script,
  `PLAY_SELECTORS`, `PLAY_TEXT`, a click on the `<video>`, and `PLAY_SCRIPT`.
  No step targets a dialog.
- `CONSENT_TEXT`'s only Russian entry is the word for "accept". `PLAY_TEXT` has
  none.
- `classifyFailure` checks `BOT_MARKERS`, then `AUTH_REQUIRED` (401, a login
  route, a password field where the player should be, or `AUTH_MARKERS`), then
  `GEO_MARKERS`.
- `AUTH_REQUIRED`'s copy is "This video requires a signed-in account." Both it
  and `BOT_CHALLENGE` map to 422.
- `ENABLE_BROWSER_RESOLVER` and `ENABLE_YTDLP_RESOLVER` are read with `bool(…)`
  in `api/src/config.ts`, and `api/src/resolvers.ts` builds `BrowserResolver`
  with `maxConcurrentBrowsers` and the egress trust anchor only.
- `BrowserResolverOptions` has no field for page interaction.
- Analysis §7's "Player never starts" row reads "`NO_MEDIA_FOUND`; try
  consent-banner dismissal first".

**2026-09-13 — built** on the filing branch, in PR #227, at the owner's request.
Measured against the live page as well as the fixtures, which is how the first
three corrections below were found.

What the brief had wrong:

- **The modal has no dialog semantics.** Build step 1 matched only
  `[role='dialog']` and `[aria-modal='true']` descendants. The reproduced
  page's promo is a plain `position: fixed` layer with neither, and the page
  carries two more fixed layers with close controls of their own, a
  notification toast and a banner. So "the first close control" would spend the
  pass on the wrong layer. `dismissModal` instead takes the layer covering the
  viewport's centre, climbing to the nearest dialog or fixed ancestor, and falls
  back to a visible semantic dialog. It presses Escape only for a semantic
  dialog, and it leaves any layer holding a `<video>` alone, since sites open
  their player in a lightbox. The fixture's modal has no role, so a dialog-only
  step fails it.
- **Both layers mount late.** A live trace saw nothing at 0.9 s or 2.3 s after
  `DOMContentLoaded`, both layers at 3.4 s, and a playlist 0.2 s after closing
  and pressing. `provokePlayback`'s two passes are over by then, and the first
  live probe with `confirmAge` still answered `NO_MEDIA_FOUND`. The quiet
  wait now revisits the modal and gate steps once a second, at most four times,
  while nothing has been captured. It never repeats the play clicks or the
  consent text: a second play click can pause a player, and `CONSENT_TEXT`
  matches words like "continue". The `?late=3500` fixture test fails with
  `MAX_OVERLAY_REVISITS` set to 0 and passes at 4.
- **The close control's name carries a noun** ("close popup"), so `CLOSE_TEXT`
  allows up to two words after the verb.
- **"18+" cannot be a marker.** The page prints it as a badge on every listed
  thumbnail. The marker that matched live is the Russian stem for "minors".
- **The web package enumerates codes too.** `web/src/lib/error-presentation.ts`
  is a `Record<ErrorCode, …>`, and `web/test/mock-api.test.ts` requires a
  mock scenario per code, now `agegate`.
- **A gate still showing after an allowed press fails `NO_MEDIA_FOUND`**, not
  `AGE_CONFIRMATION_REQUIRED`, whose copy says the server is not set to confirm.
  The resolver clears `ageGate` when `confirmAge` is on.

Placed differently from the brief, and why:

- `AGE_MARKERS` is in `classify.ts` beside `GEO_MARKERS`, which `provoke.ts`
  imports, rather than in `provoke.ts`. The classifier needs it for
  `details.marker`, and `classify.ts` has no Playwright dependency.
- The boot log's `ageConfirmation` is read back from
  `BrowserResolver.confirmsAge`, not from the config, so
  `api/test/config.test.ts` proves the setting reached the tier.
- The fixture server records requested paths and answers `/beacon/*` with 204.
  That is how the tests assert what was and was not pressed after the browser
  context is gone.

Live, calling the built `BrowserResolver` directly rather than through the API:

- `confirmAge: false`: `AGE_CONFIRMATION_REQUIRED` in 10.3 s.
- `confirmAge: true`: 5 HLS variants from 144p to 720p, in 24.6 s.

Checks, all exit 0: `npm run check`; `npm test -- --project downloader`,
1259 tests in 75 files; `citations-gate.mjs --against origin/main` with 0
failing. Five Review citations in dl-19, dl-34 and repo-33 were repointed after
`api/src/config.ts` and `capture-rules.test.ts` moved; the gate located each
anchor at its new line.

**2026-09-13 — gate** by the ticket-reviewer agent on Sonnet, at `3984373`:
**CONCERNS**, with one med finding and four low. Each was checked by hand before
repair, and every one was repaired in the next commit.

- **med, reproduced here too.** `dismissModal` treated any `position: fixed`
  layer over the centre as a modal, then searched its whole subtree for a close
  control. Two things went wrong:
  - **The fixed app root was treated as a modal.** A page whose whole app lives
    in a fixed root had its "Close menu" pressed: `dismissModal` returned 1 and
    the click handler fired.
  - **The close pattern was too loose.** `CLOSE_TEXT` matched "Close account"
    and "Close ticket", because any two words could follow the verb.

  Repaired in two ways:
  - **A fixed layer counts only when it covers something.** Page content must
    lie under the centre point, neither inside the layer nor one of its
    ancestors. The live page's promo passes this; an app root does not.
  - **Only an overlay word may follow the verb**, such as "popup", "dialog" or
    "banner".

  The class-name fallback ("close" in a button's class) was not in the brief,
  had no test, and is removed. The `age-gate.html` player area now spans the
  viewport centre, as the reproduced page's did. The new `fixed-shell.html`
  test pins the app-root case. After the repair, the same reproduction returns
  0 and nothing is clicked.

- **low:** `AGE_CONFIRMATION_REQUIRED → 422` had no runtime assertion. It is now
  in `api/test/routes.test.ts`'s error-mapping test.
- **low:** precedence against `BOT_CHALLENGE` was untested. There is now a
  classifier test.
- **low:** a press that leaves the gate standing had no integration test.
  `age-gate.html?inert` now pins that it fails `NO_MEDIA_FOUND`.
- **low:** the class-name heuristic had no coverage. It is removed; see above.
- **The reviewer checked and found no defect** in:
  - the revisit bound, which it reproduced with `MAX_OVERLAY_REVISITS = 0`;
  - Cyrillic matching without the `u` flag;
  - regex sources surviving JSON interpolation into the page;
  - the premise at `8849c14`.

After the repair:

- **Checks:** `npm run check` passes, and so does
  `npm test -- --project downloader` (1265 tests in 75 files).
- **Citations:** the gate is at 0 failing, after one more dl-34 citation was
  repointed.
- **Live, via the built resolver:** with `confirmAge: false` the page fails
  `AGE_CONFIRMATION_REQUIRED` in 7.0 s. With `confirmAge: true` it returns 5
  HLS variants from 144p to 720p, in 26.9 s.
