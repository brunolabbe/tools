---
id: dl-133
tool: downloader
title: One box per analysis, from the paste to the saved file, with several running at once
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: hard
---

# dl-133 — One box per analysis

## Why

The page holds **one** analysis at a time. `App.tsx` keeps a single `Phase`
(`idle` → `analysing` → `probed`), and a new analysis replaces the one on
screen: `probeToken` exists to make a late answer from an abandoned probe lose.
The download it leads to is a second, separate card in `JobList`, below. So a
visitor who has three pages to fetch waits for each analysis to finish, presses
Download, and only then pastes the next address — and the analysis and the
download of one video read as two unrelated things on the page.

**Asked for by the owner, 2026-10-25:** the analyse step and the download step
live in the same box; each analysis is its own instance, so several analyses and
downloads can run at the same time; and the video preview stays in the box
through the download.

The smaller requests from the same message — a clear button in the address
field, `keep source` as the default container, the two tips removed, the job's
lines restyled like the analysing panel's stage line, and the duration and
rendition count moved under the title — ship in the pull request
that filed this ticket. Start from them; do not redo them.

## Decision — answered 2026-10-25 by the owner

Each was put as options with their costs, the recommended one first.

1. **A third analysis while two are running waits in the browser.** Answered
   over _raise the server caps_ and _show the refusal_. The server lets one
   client hold **2 probes at once** (`maxProbesPerClient`, enforced by
   `probeClientGate` in `api/src/routes/probe.ts`) and start **10 a minute**
   (`rateLimitProbePerMinute`). The box reads as waiting for a free slot and
   starts itself when one frees. No server change: the caps are dl-51's
   fairness on a host with two browser slots.
2. **A third Download while two jobs are in flight waits in the browser too.**
   Answered over _refuse as today_. A job's re-probe is **not** counted against
   the probe cap; jobs have their own, **2 in flight per client**
   (`maxJobsPerClient`, measured in `api/src/config.ts` on 2026-10-25) and **5
   started a minute** (`rateLimitJobsPerMinute`). Today the third is refused,
   and `e2e/refused-download.spec.ts` proves that refusal; this ticket moves the
   wait in front of it.
3. **The address field keeps its address after Analyse.** Answered over
   _empty itself_. The clear button from that pull request is how it is emptied.
4. **A new box appears directly under the address field; older ones move
   down.** Answered over _newest at the bottom_, which would land a new box
   off screen once a few exist — predicted, not measured; the same kind of
   defect dl-109's gate did measure, for a card placed above the panel.
5. **A saved box stays until it is dismissed.** Answered over _on the next
   Analyse_ (dl-109's decision 3) and _after a delay_. **This supersedes dl-109
   decision 3**: a saved row no longer leaves when the next analysis starts, so
   `clearSaved` and its call in `analyse` go, and the saved row gains a Dismiss
   button.
6. **An analysed box that was never downloaded does not survive a reload.**
   Answered over _keep it_. As today, a reload restores live and failed jobs
   (dl-109 decision 4) and nothing else; the job re-probes before it downloads
   anyway, and the signed links in a probe result expire within minutes.

## Build

1. **Model a box, not a phase.** Replace `App`'s single `Phase` with a list of
   boxes, each owning its own state through `idle-waiting → analysing → probed →
   (job)`. A box's analysis keeps its own probe id and its own stage channel
   (`api.openProbeEvents`), opened before its POST exactly as `analyse` does it
   now (dl-43), and closed when the box's answer lands or the box is closed.
   `probeToken` becomes per box: an abandoned box's late answer must not reach
   another box.
2. **Once Download is pressed, the box becomes the job.** The job card's body
   (meter, bar, messages, stats, actions) renders in the same box. The box's
   preview and title stay where they were; the renditions table and the Output
   fieldset go. The job record still carries no title of its own —
   `useJobs.start(url, options, title)` and `loadTitles` keep it — so this is
   layout, not contract.
3. **A client-side queue in front of both caps** (decisions 1 and 2). Count the
   probes and jobs this page holds in flight and start a waiting box only when
   it is under 2; the counts come from the boxes themselves, not from a guess at
   the server's state. The server stays the authority: if it refuses anyway
   (another tab on the same address, CGNAT), the refusal shows in the box with
   its retry, as today. A waiting box says so in the line under its bar, worded
   like the other stage lines in `lib/probe-stages.ts`, and can be closed while
   it waits.
4. **Boxes restored on a reload are the jobs `useJobs` restores**, each a box
   in the job state with no analysis above it (decision 6). They go below any
   box made in this page's life, newest first.
5. **The saved row is dismissable** (decision 5); the dl-109 comment in
   `JobList.tsx` about "a saved job leaves when the next analysis starts" goes
   with `clearSaved`.
6. **`ScenarioHints`** (the mock-only picker) starts a box per pick, like the
   form.
7. **`e2e/layout.spec.ts`** gets a case with two boxes running side by side, at
   360 px and desktop, per the repo's responsive rule. `download.spec.ts`'s
   `toBeInViewport` on the new card holds, with the box now created under the
   field rather than below the panel.

**Traps.** `refused-download.spec.ts` depends on the third job being refused;
it has to be rewritten around the wait. The `JobList` heading "Downloads" and its
list name are what several e2e specs locate a card by. The reveal-on-start
`scrollIntoView` added in the pull request that filed this ticket is per job id;
with the box under the field it may no longer be needed, so measure before
keeping or deleting it.

## Done when

1. Two addresses analysed one after the other, without waiting, show two boxes
   analysing at once, each with its own stage line — a test drives two probes
   whose stages arrive interleaved and asserts each box shows only its own.
2. A third analysis, and separately a third Download, show a waiting box with
   no request sent, and start when one of the first two ends — tests assert the
   request count before and after.
3. Pressing Download turns the same box into the job: its preview and title
   remain, the table and the options go, and no second card appears in a
   separate list — a test asserts one box per job, holding both the title and
   the progress bar.
4. The address field keeps its value after Analyse; a new box appears above the
   older ones.
5. A saved box stays until its Dismiss is pressed, including across a new
   analysis.
6. A reload restores running and failed jobs as boxes and no analysed-only box.
7. `npm run check`, the downloader suite and `npm run e2e:downloader` pass,
   with the two-box layout case among them.

## Review

**Gate: CONCERNS** — 2026-11-10 · `a100f429..dfdc5258` · Sonnet 5.5, depth full

| Done when                                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Two addresses analysed without waiting show two boxes analysing, each with its own stage line                                                                        | `web/test/app.test.tsx` › "two analyses run at once, each box showing only its own stage line (Done when 1)" — asserts two `probe` calls, two distinct probe ids, and interleaved frames (second, first, second) each landing only in its own box's `.stage` ✓                                                                                                                                                                                                                                                          |
| 2. A third analysis, and separately a third Download, show a waiting box with no request sent and start when one of the first two ends; request counts before and after | `web/test/app.test.tsx` › "a third analysis waits in its box with no request sent, and starts when one ends (Done when 2)" (probe calls 2 → 3, channels 2) and › "a third Download waits in its box with no request sent, and starts when a job ends (Done when 2)" (createJob calls 2 → 3) ✓ — both assert the "ends" paths the line names (an answer, a `canceled` frame); the failure and dismissal exits are asserted by nothing committed, and my probe ran them green (see F1 for the server side of a dismissal) |
| 3. Download turns the same box into the job: preview and title remain, table and options go, no second card; one box per job holding the title and the progress bar     | `web/test/app.test.tsx` › "Download turns the same box into the job: title and preview stay, table and options go (Done when 3)" — `after` is the same element as `before`, one list, one `progressbar`, heading is the page title, preview `src` is the analysis's, no table, no "Output" group, no "Downloads" heading ✓                                                                                                                                                                                              |
| 4. The field keeps its value after Analyse; a new box appears above the older ones                                                                                      | `web/test/app.test.tsx` › "the field keeps its address after Analyse, and a new box lands above the older ones (Done when 4)" — field value read after each Analyse; newer box is `box(0)`; list follows the form in document order ✓                                                                                                                                                                                                                                                                                   |
| 5. A saved box stays until its Dismiss, including across a new analysis                                                                                                 | `web/test/app.test.tsx` › "a saved box stays across a new analysis until its own Dismiss (Done when 5)"; `web/test/job-card.test.tsx` › "a saved row stays until its own Dismiss, which reports its job" ✓                                                                                                                                                                                                                                                                                                              |
| 6. A reload restores running and failed jobs as boxes and no analysed-only box                                                                                          | `web/test/app.test.tsx` › "a reload restores running and failed jobs as boxes, and no analysed-only box (Done when 6)" and › "restored boxes go below every box made in this page's life" ✓; the restored boxes' slot count is not a clause of the line and is asserted by nothing committed — my probe "a reload with two running jobs makes a third Download wait" ran green                                                                                                                                          |
| 7. `npm run check`, the downloader suite and `npm run e2e:downloader` pass, with the two-box layout case among them                                                     | **proven by CI** at `dfdc5258`: `check` (ci.yml), `test (ubuntu-latest)` (ci.yml), `e2e (direct)` (downloader.yml, runs `npm run e2e:downloader`), `e2e (sniffer)` and `docker` (downloader.yml) all SUCCESS on that head, none pending. Locally: `npm run check` exit 0; `npx vitest run tools/downloader/web` 23 files, 338 tests passed. The case "two boxes analysing side by side fit a phone and a desktop (dl-133)" is in `e2e/layout.spec.ts`; I ran my own probe specs, not the whole e2e suite                |

- **med** · no `Done when` line depends on it · **F1** · A dismissed analysis frees its client slot at once but still holds the server's per-client probe slot, so the queued third starts into a refusal. `ApiClient.probe` takes no abort signal (`probe()` is called with one argument, `{url, probeId}`), the web never cancels the POST, and the API's `probeClientGate` slot is taken at the top of the probe handler and released only when the handler ends (`routes/probe.ts`), which aborts its work only when the socket closes. With the server's rule modelled in the fake (a slot held until the POST settles, a third refused), dismissing the oldest running box starts the third box and it ends in `RATE_LIMITED` — "You already have as many analyses running as this server allows per client." The model is mine and the real server was not run. Two directions, an open decision: (1) count an abandoned probe in `probesInFlight` until its POST settles (client only; recommended, smallest); (2) give `ApiClient.probe` a signal and abort it on dismiss (`api/types.ts`, `http.ts`, `mock.ts`; also stops the server's work). Not verified: either direction.
- **low** · **F2** · "Analyse again" stays enabled while the box's job is being created (`busy`), where "Dismiss" is disabled for that reason. Pressed in that window, the box re-analyses and the job that `createJob` then returns shows as a second, preview-less box below it; and for the window's length nothing counts the slot (the box is no longer `starting`, the job is not yet listed). Probe: `"Analyse again" present while Starting: true; disabled=false`, then `boxes=2 headings=Analysing | Only`. The window is one `createJob` round trip and the job is not lost.
- **low** · **F3** · `e2e/layout.spec.ts` has no case for a waiting box, a probed box with its Download waiting, or a job box with a long title; its new case is two analysing boxes over long addresses. Read at 360 px and 1280 px by my own probe (a waiting analysis beside two analysing ones; a waiting Download beside a running job and a refused queued job, all titled by a 200-character title with spaces): `scrollWidth` 360/360 and 1280/1280, screenshots opened. No defect found; the gap is coverage.
- **low** · **F4** · Pre-existing and outside the diff's reach, recorded for a ticket: a heading with no break points breaks the page. A 200-character unbroken title gives `scrollWidth` 1706 at 360 px and 1858 at 1280 px. `.card__title` carries no `overflow-wrap`; the base's `.job__title` carried none either (the base stylesheet set it only on `.url-echo`, `.job__subtitle`, `.result__filename`), and a restored job with no stored title falls back to the full address as its heading. The base was not run: unmeasured.
- **low** · `nfr:reliability` / never fake progress · **F5** · A waiting box draws an indeterminate bar with no value (asserted: `chrome.test.tsx` › "a box waiting for a probe slot says so, claims no stage, and can be closed"), but `ProgressBar` names every indeterminate bar "…: in progress, total unknown", so a box with nothing sent is announced as in progress. False in the safe direction; nothing relies on it.
- **candidates for the owner** · the build's nine unnamed behaviours graded against Decisions 1–6 and Build 1–7 in the full report: none contradicts a line. Put to the owner: an analysed box's Dismiss, a failed analysis's address line, an invalid address making no box, "Stop waiting" on a waiting Download closing the box (the only one that discards finished work), "Analyse and retry" no longer writing the field, and a refused queued job counting against the job slots. No action: the saved row, `UrlForm`'s `busy` prop, the missing `idle` state.
- **dropped** · a box started twice by two runs of the queue's layout effect: none of my 16 probe scenarios sent a request twice for one box (probe calls 2 → 3, never 4), and each start sets its state in the same layout effect before the next commit. Not a defect.
- **dropped** · a refused queued job wedging every later Download: measured, the third starts the moment the visitor stops one of the two refused jobs, and the unopened link's job is cancelled by the server's sweep at link expiry (`runSweep`, 15 minutes; read, not run). A cost to put to the owner, not a defect.
- **dropped** · a stale restored job holding a slot for good: the restore reconciles each non-terminal job with the server and fails it locally on an error, so it reaches a terminal state.
- **findings** · the hunt returned 8; 5 carried (F1–F5), 3 dropped.
- Positive control: four planted missing releases (a dismissed analysis kept, a failed analysis kept, listed jobs not counted, queued jobs not counted) each turned my probe red (4 of 4) and the builder's suite red too (3, 3, 2 and 1 of its 40 tests in `app.test.tsx` and `boxes.test.ts`), so the committed suite catches a missing release; the tree was restored and is clean.
- NFR: security n/a (the address is validated by `sourceUrlSchema` before a box is made and rendered as text; SSRF stays the server's) · performance ✓ (a waiting box opens no channel; unmounting closed every channel, 2 of 2) · reliability — F1, F2, F5 · maintainability ✓ (`useBoxes.ts`'s one `react/set-state-in-effect` disable carries a real reason: each start is a request and a job slot frees on a stream frame no handler of the hook sees). Invariants skipped: contract, `AppError`, shell, redaction, SSRF, Dockerfile closure (the diff is `web`, `e2e` and a ticket); no `console`, no `any`.

### Gate 2

**Gate: PASS** — 2026-11-10 · `dfdc5258..4c621dc8` (the round: `d77b5d0e`, `4c621dc8`; base `a100f429`, unmoved) · Sonnet 5.5, depth narrow (the five named attacks; findings in the round's lines carried)

| Gate 1 finding                                                                              | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **F1** (med) a dismissed analysis freed the page's probe slot while the server kept its own | **fixed.** Gate 1's own probe, re-run, `(a-server)`: `server holds 2 of 2; top box is "Waiting"; alert=false`, where gate 1 read the third box ending in `RATE_LIMITED`; after the abandoned POST settles the third starts, no alert. Proof in the suite: `app.test.tsx` › "a closed analysis holds its slot until its POST settles, as the server holds its own (F1)" and `boxes.test.ts` › "an abandoned POST still out takes a probe slot, with no box to show for it (gate 1 F1)"; both red against `dfdc5258`'s source. The server's rule is still a model: unverified against the real API |
| **F2** (low) "Analyse again" enabled while the job is being created                         | **fixed.** `probe-panel.test.tsx` › "Analyse again waits while the job is being created, as Dismiss does (gate 1 F2)", red against `dfdc5258`'s source. Its cost is N3                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **F3** (low) no layout case for a waiting box, a waiting Download, a long title             | **fixed.** Two cases in `e2e/layout.spec.ts`; `e2e (direct)` SUCCESS at `4c621dc8`. My own run reached the second case's measurement at 360 and 1280 px with no width assertion failing, and I opened its 360 px screenshot                                                                                                                                                                                                                                                                                                                                                                      |
| **F4** (low) unbroken long title                                                            | not graded (filed as dl-137)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **F5** (low) a waiting bar announced "in progress"                                          | **fixed.** `chrome.test.tsx` › "a waiting box's bar says nothing has started, not that work is in progress (gate 1 F5)" and `app.test.tsx` › "a waiting box's bar does not announce work in progress (F5)"; red against `dfdc5258`'s source                                                                                                                                                                                                                                                                                                                                                      |

The owner's answers are as built: the abandoned probe is counted (not aborted); "Stop waiting" on a waiting Download returns the box to its options; `jobsInFlight` is untouched, so a refused queued job still counts (A). Gate 1's acceptance table stands; its row 7 is **proven by CI** at `4c621dc8`: `check`, `test (ubuntu-latest)`, `e2e (direct)`, `e2e (sniffer)`, `docker` SUCCESS, none pending. Locally `npx vitest run tools/downloader/web` → 23 files, 344 tests passed.

- **low** · no `Done when` line depends on it · `nfr:maintainability` · **N1** · The committed tests do not catch two of the ways the orphan count can stop returning to zero. Planting each one in `useBoxes.ts`: release only when the POST resolves (a rejection leaves the count up) leaves `app.test.tsx` + `boxes.test.ts` at 44 of 44 green, my probe red (2 of 15); a settled POST left in the `posts` map (so dismissing an answered box counts a POST that is not out, and nothing ever releases it) leaves the same 44 of 44 green, my probe red (2 of 15). The code is right today on every path I enumerated. The only committed assertion that a slot comes back follows a resolve of a closed running box's POST (the existing test of a rejection after an abandon asserts no alert, not the slot).
- **low** · no `Done when` line depends on it · `nfr:reliability` · **N2** · An orphaned POST that never settles holds its slot in the count for the page's life; the visitor cannot release it. Two such orphans (probe `(o2)`): after 30 minutes of fake time probe calls stay 2 and every later analysis stays "Waiting". Settling them returns the count to zero. No live call site: the count is the owner's chosen direction, `api.probe` (`http.ts`) has no client timeout, but the server bounds the handler (`probeTimeoutMs` 45 s, ceiling 50 s) and a stalled connection errors in the browser. `api.probe` also spans the human-check wait before the POST, which holds no server slot, so the count can over-hold there; that is the safe direction. Direction, untested: a timeout or signal on `ApiClient.probe`, which is the option the owner passed over.
- **low** · no `Done when` line depends on it · `nfr:reliability` · **N3** · F2's fix leaves a box whose `createJob` never settles with no exit. While the box is `starting`, Download, "Analyse again" and Dismiss are all disabled (probe `(n3)`, 30 fake minutes after Download: `Starting…:true | Analyse again:true | Dismiss:true; createJob calls 1`), and the box keeps its job slot; before the round "Analyse again" was the way out, at the cost F2 described. No live call site: `createJob` is a short request. The old test's title "analysing again is always available, because the links expire" named that reason.
- **low** · no `Done when` line depends on it · `nfr:maintainability` · **N4** · The DOM node pressed as "Stop waiting" is reused as the panel's "Download" button, because the waiting and the options branches of `ProbePanel` return the same `section` with an actions row in the same place. Probe: `stop node still in document: true; same node as Download: true`; through the App, a second activation of that node (held Enter, two quick presses) puts the box back to waiting and the table disappears again. Recoverable by pressing Stop waiting once more; a pointer's second click lands elsewhere because the layout moved. Direction, untested: distinct `key`s on the two action rows.
- **dropped** · gate 1's probe, re-run, fails `(a)` and `(c3)` on the new head: both assert the behaviour the owner's answers replaced (the third starts at once after a dismissal; "Stop waiting" closes the box). Stale expectations in my own script, not defects; 14 of 16 pass.
- **dropped** · `reanalyse`'s orphan branch is unreachable from the page ("Analyse again" exists only on a probed or failed box, whose POST has settled); correct by the hook-level probe `(o7)` and kept as defence. Not a defect.
- **dropped** · `ProgressBar` has no case in `progress-bar.test.tsx` for `waiting`: the file exists and the two committed tests above carry the branch through both callers.
- **findings** · the hunt returned 7; 4 carried (N1–N4), 3 dropped.

**Attacks.**

1. Orphan accounting. Every end enumerated against the real `App` with the server modelled (a slot held until its POST settles): resolve (`app.test.tsx`'s F1 test and probe `(a-server)`), reject `(o1)`, never settles `(o2)`, settles after unmount with `console.error` spied: 0 calls `(o3)`, closing a box that only waits `(o4)`, dismissing an answered box `(o5)`, Analyse again then dismissed while re-analysing `(o6)`, and, through `useBoxes` alone, one box re-analysed twice with POST 1 and POST 2 still out `(o7)`. The count reaches zero on every settling path (three new analyses on a settled page start 2 of 3). My probe: 17 of 17 pass. Plants (committed suite 44 tests; my probe 15 at that time): no decrement 1 red / 5 red; no increment 1 / 5; release on resolve only 0 / 2 (N1); release on reject only 1 / 4; `posts` not cleared 0 / 2 (N1); `reanalyse` without `abandon` 0 / 1. Gate 1's four release plants against the committed suite at the new head: red 4, 3, 4 and 3 of 44.
2. "Stop waiting" returns the box to its options. Probe `(s1)`–`(s7)` through the real `App`: the same box keeps its table, Download and Dismiss; the variant, container, "Audio only" kept (subtitles are disabled in the fixture, so not exercised) and the next `createJob` carries them; no `createJob` fires when a slot frees afterwards (`createJob calls 2`); pressing Download again with a slot free starts it (3), with the slots full it waits again and starts when one frees; a box back in choosing counts no slot (a later box's Download takes the freed one); Dismiss from there removes the box and a freed slot starts nothing. Red against `dfdc5258`'s source: the committed test.
3. `ProgressBar`'s `waiting` prop. Callers (grep over `packages/` and the downloader web): `AnalysingPanel` passes `waiting={waiting}`, `ProbePanel`'s waiting branch passes `waiting`, `JobCard` passes none; no other in `packages/` or the downloader web. Names read in the real `App`: waiting analysis "Waiting to analyse: not started yet", waiting Download "Waiting to download: not started yet"; every other bar unchanged: "Analysing page: in progress, total unknown", "Starting: …", "Downloading: …". `progress-bar.test.tsx`'s cases are unchanged and green.
4. The long-title case's coupling. `playwright.config.ts`: `workers: 1`, `fullyParallel: false`, so the two specs cannot run concurrently, and file order is alphabetical (`layout` before `refused-download`); either order is safe on the passing path, since each ends with the server's one job slot free. **Failure mode run, once** (`E2E_PORT=8234`, `npm run e2e:downloader` over a copy of `layout.spec.ts` with the case made to throw after its measurement — job 1 streaming, job 2 refused, job 3 waiting — then the real `refused-download.spec.ts`): the case failed on the plant alone, no width assertion; the `finally` closed the proxy, the server logged `ECONNREFUSED` on job 1's next segment and failed it within milliseconds; `refused-download.spec.ts` then passed (39.1 s). So a midway failure does not leave the slot held for the next spec, at that placement. Not run: other placements; the margin between job 1's 7.5 s of delayed segments and the "Stop waiting" click (the run's `Date.now()` read -559 ms across the case: unreadable on this WSL clock). The case passed in CI at the head.
5. The rewritten test. The old test pressed "Analyse again" with `busy: true` and asserted `onReanalyse`; the only thing it covered that the new pair does not is that pressed-while-busy call, which is the behaviour F2 removes, now asserted the other way by "Analyse again waits while the job is being created, as Dismiss does (gate 1 F2)". "analysing again is available, because the links expire" still asserts `onReanalyse` fires when the panel is not busy. Nothing else was dropped.

- NFR: security n/a (web only; no URL or credential logged) · performance ✓ (a waiting box opens no channel; no new timer or listener) · reliability — N2, N3 · maintainability — N1, N4. Invariants checked: no `console`, no `any`, no contract or API file touched; the rest skipped.
- CI at `4c621dc8`: `gh pr view 781` — all 11 checks COMPLETED SUCCESS, none pending, PR still a draft.
- Not verified: the real API's slot behaviour (modelled); gate 1's `controls.sh` was not run (its `(a)` target asserts the behaviour the round replaced, so it is red unplanted and cannot discriminate; `controls-builder.sh` makes the same four plants against the committed suite and ran) and neither was its layout probe (the layout cases are the committed ones); the full `npm run e2e:downloader` was read from CI, not run locally.
- **No `high`.**

## Log

**2026-10-25**: filed from the owner's request and their answers above, in the
pull request that shipped the smaller requests from the same message.

**2026-11-10**: built on branch `downloader/dl-133-one-box-per-analysis` from
`a100f429`.

- **Shape.** `web/src/lib/boxes.ts` holds the box type, `PROBE_SLOTS` and
  `JOB_SLOTS` (both 2, the API's `maxProbesPerClient` and `maxJobsPerClient`
  defaults), `displayBoxes` and the two first-come-first-served pickers.
  `web/src/hooks/useBoxes.ts` owns the boxes, a token and a stage channel per
  box, and the queue: a layout effect that starts waiting boxes whenever the
  boxes or the jobs change, so a box made with a slot free never paints
  "Waiting". `BoxList` replaces `JobList`; `BoxHead` is the one head the
  analysis (`ProbeHead`) and the job (`JobCard`) both draw, so Download leaves
  the preview and the title where they were. The list is named "Analyses"; the
  e2e specs find a box there.
- **Counted as a job in flight**: every job not yet terminal, restored ones
  included, plus every box whose `createJob` is in flight. A queued job whose
  link was refused still counts until it ends or is dismissed: conservative
  against the server, whose job gate is taken at the link, not at creation.
- **The reveal (trap 3), measured.** A scratch Playwright spec (deleted, never
  committed) put two analysed boxes on the page, scrolled the top box's
  Download to the window's bottom edge, pressed it, and read the new bar's
  position with and without `scrollIntoView` stubbed out. With the fixture's
  two renditions the bar stayed on screen either way (360 px: 492 px without,
  418 px with; 1280 px: 460 px both). With fourteen renditions (the probe answer
  padded by `page.route`): without the reveal the bar landed 34 px (360 px) and
  57 px (1280 px) from the top of the window, the head and title above it and
  out of view; with it, 166 px and 130 px. **Kept**, on the job's root, per job
  id; a longer table would push the bar off screen without it.
- **What the brief had wrong or left open.**
  - Build 1's `idle-waiting` state has no `idle`: a box exists only once
    Analyse is pressed. An address the contract refuses makes no box; its
    `INVALID_URL` panel sits under the form, since nothing was analysed.
  - An analysed box needed a way out that the brief did not name: with a new
    analysis no longer replacing it, it would stay until a reload. It gained a
    Dismiss beside Analyse again, disabled while its job is being created. A
    failed analysis shows its address above the error, which alone does not
    say which of several pages it is about.
  - "A waiting box can be closed" is read for both waits: Stop waiting removes
    the box, for a waiting Download too (rather than returning it to its
    options).
  - A failed job's "Analyse and retry" re-analyses in the same box and dismisses
    the failed job; it no longer writes the address into the field, since the
    box shows it and decision 3 keeps the field the visitor's. A restored
    job's retry makes a new box at the top, as every box made in this page's
    life goes above restored ones (Build 4).
  - The saved row keeps dl-109's one-line result with its own small preview
    and gains Dismiss; the head and the large preview are the active job's.
  - `UrlForm`'s `busy` prop went: the form is never busy now.
  - The `react/set-state-in-effect` lint rule fires on the queue's effect; it
    carries a disable line with the reason (each start is a request to the
    server, and a job slot frees on a stream frame no handler of the hook sees).

Commands, from the worktree root:

- `npx vitest run tools/downloader/web` → `Test Files 23 passed (23)`,
  `Tests 338 passed (338)`.
- `npx vitest run tools/downloader/web/test/app.test.tsx` with `PROBE_SLOTS`
  and `JOB_SLOTS` mutated to 3 → `Tests 3 failed | 33 passed (36)`: the two
  Done-when-2 cases and "a waiting analysis can be closed, and then is never
  sent". Restored from the commit.
- `E2E_PORT=8133 npm run e2e:downloader` → `20 passed (59.6s)`, the new
  `layout.spec.ts` case "two boxes analysing side by side fit a phone and a
  desktop (dl-133)" among them. Its screenshots at 360 px and 1280 px were
  opened: two boxes, each with its long address wrapped, its bar and its line.
- `npm run check` → exit 0.

**2026-11-10, answered by the owner** (relayed by the orchestrator), on gate
1's open decisions at `dfdc5258`. Each took the gate's recommendation.

1. **F1: a dismissed analysis frees the page's probe slot at once, while the
   server holds its own until the POST settles.** Options: count an abandoned
   probe until its POST settles (client only); give `ApiClient.probe` an abort
   signal and abort on dismiss; record it, no round. **Chosen: count abandoned
   probes until their POST settles.**
2. **"Stop waiting" on a waiting Download.** Options: (A) close the box, as
   built; (B) return the box to its options, with Download and Dismiss
   available. **Chosen: (B), return to options.** This supersedes the build's
   reading above that "a waiting box can be closed" covers both waits.
3. **A refused queued job counts against the job slots.** Options: (A) as
   built; (A) with a waiting line naming what it waits on; (B) exclude refused
   jobs. **Chosen: (A), as built.** No change.
4. **The build's added behaviours are confirmed:** an analysed box's Dismiss, a
   failed analysis showing its address, an invalid address making no box, and
   "Analyse and retry" no longer refilling the field. Gate 1's F2, F3 and F5
   are folded into this round; F4 (pre-existing) is filed separately and not
   fixed here.

**2026-11-10, round 1** (gate 1's findings at `dfdc5258`, with the answers
above).

- **F1.** I read the gate's model against `api/src/routes/probe.ts` before
  fixing: `probeClientGate.tryAcquire` is taken before the probe runs and
  `clientReleaseProbe()` runs in the handler's `finally`, and the web never
  aborts its POST, so the model holds. `useBoxes` now keeps each box's POST
  token while it is out; closing or re-analysing a box with its POST out moves
  that token to an orphan set and counts it, and `analysesToStart(boxes,
  abandoned)` subtracts the count until the POST settles.
- **Decision 2.** `ProbePanel` takes `waiting` and `onStopWaiting`: a waiting
  Download keeps the panel mounted with the table and the options set aside,
  so Stop waiting (`useBoxes.stopWaitingDownload`) brings them back as chosen.
  A slot that frees afterwards starts nothing.
- **F2.** "Analyse again" is disabled while the job is being created, as
  Dismiss is.
- **F5.** `ProgressBar` takes `waiting`, and a waiting box's bar is announced
  as "…: not started yet" rather than "in progress, total unknown".
- **F3.** `layout.spec.ts` gains two cases: a box waiting for a probe slot
  beside two analysing; and a waiting Download beside a running job and a
  refused one, every box under a 540-character title with spaces. The second
  stops both jobs at its end, so the server's one job slot is free for the
  specs after it. At 360 px the long title wraps in the narrow column beside
  the preview: it fits, and reads tall.

Red, then green, from the worktree root:

- `npx vitest run tools/downloader/web/test/app.test.tsx tools/downloader/web/test/probe-panel.test.tsx tools/downloader/web/test/chrome.test.tsx`,
  the new tests against `d77b5d0e`'s source → `Tests 5 failed | 75 passed
  (80)`: F1 "expected … to be called 2 times, but got 3 times"; decision 2
  "expected [ Array(2) ] to have a length of 3 but got 2" (the box was
  closed); F5 twice, "Waiting to download: in progress, total unknown" and
  "Waiting to analyse: in progress, total unknown"; F2 "expected false to be
  true" (Analyse again enabled while busy).
- After the fix, `npx vitest run tools/downloader/web` → `Test Files 23 passed
  (23)`, `Tests 343 passed (343)`; with `boxes.test.ts`'s added case, 344.
- `E2E_PORT=8133 npm run e2e:downloader` → `22 passed (1.0m)`. The
  screenshots of both new cases were opened at 360 px and 1280 px.
- `npm run check` → exit 0.

**2026-11-10, answered by the owner** (relayed by the orchestrator), on gate
2's findings at `4c621dc8`.

1. **N1 and N4: what lands with dl-133.** Options: fix N1 and N4 at the
   landing; N1 only; record all four. **Chosen: fix N1 and N4 at the landing,
   with no re-gate.**
2. **N2 and N3.** Options: record only; file a ticket. **Chosen: file a
   ticket.** N2 and N3 are filed separately, with no id yet; they are not
   built here.

- 2026-11-10 — Fixed at landing by owner choice: gate 2, N1 — "The committed tests do not catch two of the ways the orphan count can stop returning to zero." Two tests at the end of `app.test.tsx`, the gate's (o1) and (o5) shapes: "a closed analysis's POST that fails gives its slot back as well (gate 2, N1)" is red under `mutate-g2.mjs` `decrement-on-resolve-only` (`1 failed | 2 passed | 39 skipped (42)`), and "dismissing an answered box leaves no slot held, so two analyses start at once (gate 2, N1)" is red under `posts-not-cleared` (`1 failed | 2 passed | 39 skipped (42)`); each is green restored (`3 passed | 39 skipped (42)`, `npx vitest run tools/downloader/web/test/app.test.tsx -t "gate 2"`).
- 2026-11-10 — Fixed at landing by owner choice: gate 2, N4 — "The DOM node pressed as Stop waiting is reused as the panel's Download button". The two action rows in `ProbePanel.tsx` carry distinct `key`s. The test "the node pressed as Stop waiting is not Download when pressed again (gate 2, N4)" presses the old Stop waiting node twice: against `93516ab1`'s `ProbePanel.tsx` it is red (`1 failed | 2 passed | 39 skipped (42)`, the table gone after the second press), and green with the keys (`3 passed | 39 skipped (42)`).
