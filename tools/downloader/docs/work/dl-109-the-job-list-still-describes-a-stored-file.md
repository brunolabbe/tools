---
id: dl-109
tool: downloader
title: The job list still describes a stored file the server no longer keeps
kind: work-package
status: done
milestone: null
depends_on: [dl-53]
difficulty: standard
---

# dl-109 — A job card for a streamed file

## Why

[dl-53](./dl-53-finished-files-and-the-tunnel.md) moved the downloader from
"the server makes a file, you collect it" to "the file streams to your browser
as it is produced, and no copy is kept". The UI kept the earlier shape:

- **Two presses.** The analysis panel's Download only created the job; a second
  Download on the job card opened the single-use link that starts the work.
- **A history nobody can act on.** Finished jobs stayed in a persisted list with
  "Remove from list" and "Clear N finished", although a finished job has no file
  to fetch again.
- **A card titled by its rendition.** The job record carries no page title, so a
  card read "1080p" until the filename arrived with the result.
- **Silence where it matters.** Between opening the link and the first byte the
  server re-analyses the page and starts ffmpeg — often the longest wait — and
  the browser shows nothing until headers arrive. Nothing on the page said so,
  or said that the page could now be closed.
- **A wrong cause.** The `disconnected` cancel copy blamed "a closed tab". A
  browser download does not stop when the tab that started it closes; only the
  file connection closing cancels the job (`api/src/routes/files.ts`, `onClose`).
  Closing the page drops nothing but the event stream (`routes/events.ts`).

**Decided by the owner, 2026-10-12,** in a brainstorm over the canvas of mocks
(claude.ai artifact, private to the owner), each from options with their costs:

1. **One press** — the work in pull request #433, which this ticket extends
   rather than following, so the two do not edit the same `status.ts` lines.
2. **Live-only list.** A saved job leaves; a failed or canceled one stays until
   dismissed. No "Clear finished", no "Remove from list" — the button on a
   finished-unsuccessfully card is "Dismiss".
3. **The saved row stays until the next analysis** — no timer.
4. **A reload keeps live and failed jobs, never saved ones.** `localStorage`
   stays; `saveJobs` and `loadJobs` drop `completed`.
5. **No step list; the bar and the messages under it are the progression.**
   The owner first chose to keep the four steps, then, on seeing the mocks,
   asked for the indeterminate bar with its description instead — the
   step-list answer had been a misreading of what they wanted. The status pill
   reads **Starting → Re-analysing → Downloading → Done**. Under the bar, a box
   of progress messages, one line each, each led by a small badge (an icon, or
   text such as "4×"); then the known stats only — an unknown one is left out
   rather than shown as "—".
6. **The line follows the status, not the re-probe's stages.** Narrating the
   real stages needs a `JobEvent` frame the contract does not have; the owner
   chose to file it as its own ticket and pull request after this one —
   [dl-110](./dl-110-the-re-probe-narrates-nothing-on-the-job-card.md).
7. **dl-108's connection count is one of the progress messages**, with "4×" as
   its badge; dl-108's Build step 5 is rewritten here to say so. dl-108 itself
   stays a separate ticket.
8. **Nothing moves when bytes start to flow.** The size figure heads the bar
   from the first frame — "0 B of ~430 MB" while preparing, with the bar
   indeterminate and no percent — instead of an "Expected size" stat that
   later jumps above the bar. The stats sit in three fixed columns: a time
   (Waiting while preparing, Remaining while downloading), then Speed, then
   Segments; an unknown value leaves its cell empty rather than letting the
   next one slide over, so every card in the list lines up.
9. **The Downloads card stays below the analysis panel**, directly under the
   Download button just pressed. Build step 3 first moved it above, so it would
   be on screen during the wait; the gate measured it off screen instead (the
   panel is scrolled to its bottom to press the button), and the owner chose to
   put it back over scrolling it into view.
10. **"You can close this page" only once bytes flow.** Before the first
    response header the browser holds a request, not a download, and Firefox
    cancels it with the tab (the gate's measurement). The `disconnected` copy
    names a page closed before the download began among its causes.

## Build

1. `useJobs.start(url, options, title)`: keep the page title beside the job, in
   its own `localStorage` key, pruned to the jobs that remain. The job record is
   a contract type and the title is the page's knowledge, not the server's.
2. `job-store`: `saveJobs`/`loadJobs` skip `completed`. `useJobs` gains
   `clearSaved()`, called when an analysis starts; `clearFinished` goes.
3. `App`: the Downloads card stays below the analysis panel, under the button
   just pressed (decision 9 — this step first said above, and was wrong).
4. `JobCard`: title from the page, rendition and host under it; Stop, not
   Cancel; no step list, and with it the high-water-mark machinery that only
   the list needed (`statusHighWaterMark`, `reachedStep`, `markWatched`,
   `watchedSteps`); `ProgressMessages` under the bar; a "Waiting" stat while
   preparing; the downloaded figure over the bar; a saved job is the one-line
   `result` row; "Dismiss" on a failed or canceled job; the #433 fallback link
   as a prompt ("Nothing in your browser's downloads?").
5. `JobList`: no "Clear N finished"; while a job is live, "You can close this
   page — downloads continue in your browser."
6. `error-presentation`: the `disconnected` copy stops naming a closed tab.

## Done when

1. One press of the analysis panel's Download opens the job's link (#433's tests
   still pass).
2. A completed job is not written to `localStorage` and is not read back from
   it; a failed or canceled job is. Proven in `job-store.test.ts`.
3. Starting an analysis removes completed jobs from the list and leaves failed,
   canceled and live ones. Proven in `app.test.tsx`.
4. The job card is titled with the page title the job was started from, and
   falls back to the rendition label, then the address; the title survives a
   reload. Proven in `job-card.test.tsx` and `app.test.tsx`. _(The filename
   fallback this line first named was unreachable: a job has a result only once
   completed, and a completed job is the saved row — gate 1, F2.)_
5. The status labels are Starting, Re-analysing, Downloading and Done; the card
   draws no step list; a live card offers Stop; a failed or canceled card
   offers Dismiss and nothing named "Remove from list"; the list has no "Clear
   finished". Proven in `job-card.test.tsx` and `status.test.ts`.
6. An unknown speed, time left or segment count is not rendered. Proven in
   `job-card.test.tsx`.
7. Every progress message leads with a badge hidden from assistive technology,
   and the messages are one `aria-live` region. Proven in `job-card.test.tsx`.
8. The size figure is above the bar in every active state, and each stat keeps
   its column whatever else is known. Proven in `job-card.test.tsx`.
9. The card one press creates is in the viewport after the press. Proven in
   `e2e/download.spec.ts` (`toBeInViewport`).
10. `npm run check`, the downloader unit suite and `e2e:downloader` pass.

## Review

### Gate 1 — on `0252c284`

**Gate: FAIL** — 2026-10-12 · `bd7f1074..0252c284` (base is the merge-base of `origin/main` f451cc07; the range is `git diff origin/main...HEAD`, 28 files, no `contract/` path) · Sonnet 5.5, depth medium

Acceptance is the ticket's `Done when`, read from the branch's copy of dl-109 (filed on this branch). #433's own acceptance is Done when 1. FAIL is for one row only: Done when 4 has a clause nothing asserts. Nothing is a `high`.

| Done when                                                                                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. One press of the panel's Download opens the job's link (#433's tests still pass)                                                                                                     | `web/test/app.test.tsx` › "the panel's Download opens the created job's link once its stream listens" (not called before `onOpen`, once after, a reconnect does not repeat it), › "a stream that cannot connect does not hold the download back", › "a job that could not be created opens nothing"; `web/test/open-link.test.ts` › "opens the link as a download and leaves nothing behind in the page". Mutation: calling `openLink` straight after `attach` in `useJobs.start` reddens exactly the first (1 failed / 282). The `e2e (direct)` and `e2e (sniffer)` checks passed on head 0252c284. **proven**                                                                                                                                            |
| 2. A completed job is not written to or read from `localStorage`; a failed or canceled one is                                                                                           | `web/test/job-store.test.ts` › "a completed job is not written, and failed, canceled and live ones are", › "a completed job saved before dl-109 is not read back". Mutations: dropping the write filter reddens the first only; dropping the read filter reddens the second only (1 failed / 282 each). The load side asserts `failed` is kept, not `canceled`; both go through the one `isKept` predicate. **proven**                                                                                                                                                                                                                                                                                                                                     |
| 3. Starting an analysis removes completed jobs, leaves failed, canceled and live ones                                                                                                   | `web/test/app.test.tsx` › "starting an analysis clears saved jobs and keeps live, failed and canceled ones" (a saved row is asserted present first, then gone; three headings still present). Mutation: commenting out the `clearSaved()` call in `analyse` reddens exactly it. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4. The card is titled with the page title, and falls back to the filename, then the rendition label                                                                                     | `web/test/job-card.test.tsx` › "a job is titled by the page it was started from, with the rendition and host under it" and › "a job with no page title is titled by the rendition the user chose" prove two of the three clauses. **The filename clause is unproven**: deleting `job.result?.filename ??` from the heading expression leaves the web project at 282 of 282 passing. See F2. **unproven**                                                                                                                                                                                                                                                                                                                                                   |
| 5. Labels are Starting, Re-analysing, Downloading, Done; no step list; a live card offers Stop; a failed or canceled card offers Dismiss and no "Remove from list"; no "Clear finished" | `web/test/status.test.ts` › "the statuses read as a streamed download does, not as a queue and a stored file" (`toEqual` on all six labels); `job-card.test.tsx` › "each active status names itself in its pill and its first progress message" (Stop present, Dismiss absent, for queued, probing, downloading), › "the card draws no step list; the bar and the messages are the progression" (the base's list was `ol[aria-label="Pipeline"]`, so the query can hit), › "a terminal job offers nothing to stop and no bar, only Dismiss" (Dismiss present, "Remove from list" absent, for failed and canceled), › "the list offers no clear button, whatever has finished (dl-109)" (three headings asserted beside the `/Clear/` negative). **proven** |
| 6. An unknown speed, time left or segment count is not rendered                                                                                                                         | `job-card.test.tsx` › "an unknown speed, time left or segment count is not rendered at all"; the companions that fail on empty output are › "a known total is rendered as a figure and a determinate bar" (all three rows present) and › "a half-known segment count shows what is done, not a count against null". **proven**                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7. Every progress message leads with a badge hidden from assistive technology; the messages are one `aria-live` region                                                                  | `job-card.test.tsx` › "every progress message leads with a badge that a screen reader skips" (each `.job__message`, for queued, probing, downloading: `.job__mark` has `aria-hidden="true"` and an `svg`) and › "the progress messages are one live region" (the messages' `ul` carries `aria-live="polite"`). Two gaps, F5. **proven**                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 8. `npm run check`, the downloader unit suite and `e2e:downloader` pass                                                                                                                 | `npm run check` exit 0 (run here). `npm test -- --project downloader` exit 0: 114 files passed, 1 skipped (115); 2454 tests passed, 2 skipped (2456); 619 s. `e2e (direct)` and `e2e (sniffer)` green on head 0252c284, and `test (ubuntu-latest)`, `test (windows-latest, informational)`, `check`, `docker`, `CodeQL`, `codeql`, `dependency-review` all `pass` there. **proven** (e2e from CI, not rerun here)                                                                                                                                                                                                                                                                                                                                          |

**Positive controls and what I ran.** A reversed layout reddens the one order test (so the harness can fail). The viewport probe in F1 gives opposite answers for the two layouts. The tab-close probe in F5 reports a socket closing within 5 ms when the whole browser is closed, and not when only the tab is. I drove the mock build in Chromium through default, `dlfail`: the status pill read Re-analysing then Downloading then Done, the saved row stayed after Done, `downloader:jobs:v1` held `[]` and `downloader:titles:v1` held `{}` after a save, a failed job's page title was in `downloader:titles:v1` beside it. I did not look at the dark theme and did not run a screen reader.

- **med** · **Done when 4 depends on F2 only** · **F1 — the card moved above the panel is off screen after the press, which is why it was moved.** Build step 3 moves the Downloads card above the analysis panel "so the card a press just created is on screen during the wait". Measured, mock build, Chromium: analyse `https://videos.example.com/watch/sample`, scroll the panel's Download into view, click, wait 800 ms, read `section[aria-labelledby="jobs-heading"]`'s `getBoundingClientRect()`. On the branch: 1280×720 gives `cardTop -622, cardBottom -235`; 390×844 gives `cardBottom -217`; neither is on screen (scroll anchoring keeps the panel's button where it was, and the new card lands above it). Control, the same two viewports with the `JobList` block moved back below `ProbePanel` (the base's order): 1280×720 `cardTop 418, cardBottom 805`; 390×844 `cardTop 478`; both on screen. The screenshot after the press shows the table's last rows, the panel's Download and the demo scenarios, and no sign that anything happened, which is the "silence" Why names. Nothing in `web/src` scrolls or focuses (no `scrollIntoView`, `scrollTo` or `.focus()`), and the test that covers the move, `app.test.tsx` › "the Downloads card sits above the analysis panel", asserts document order, not visibility, so it is green throughout. Reproduce: `gate-1/viewport.mts` (handed back beside this file; arguments are the tree, the served URL, width, height and an output directory). **Open decision**, options: (a, recommended) when `useJobs.start` adds a job, scroll its card into view with `scrollIntoView({ block: "nearest" })`, and add `expect(card).toBeInViewport()` to `e2e/download.spec.ts` after the press, which runs at Playwright's default 1280×720 and would have caught this; cost, one effect and one e2e line; (b) put the card back below the panel and drop Build step 3, which measured on screen; cost, the card is below a tall panel for a visitor who scrolls up; (c) keep it and rely on the browser's own download UI as the sign, which leaves Why's fourth bullet unaddressed on any viewport shorter than the panel.
- **med** · **Done when 4 depends on it** · **F2 — the filename fallback is untested and unreachable.** `JobCard` computes `title ?? job.result?.filename ?? job.variant?.label ?? job.sourceUrl`. Mutation, delete `job.result?.filename ??`: 282 of 282 pass. It cannot be exercised by a real job: `result` is written only by the orchestrator's completed transition, and a `completed` job carrying a `result` returns the one-line saved row before the heading is computed, so a card with a heading never has a `result`. A test could only use a fixture the server never produces. **Open decision**, options: (a, recommended) remove `job.result?.filename` from the expression and have the author reword Done when 4 to "falls back to the rendition label, then the address" (the brief is the author's, so this is not mine to edit); (b) keep the code and add a `job-card.test.tsx` case with a `downloading` job that carries a `result`, which asserts a state that cannot occur.
- **med** · no `Done when` line depends on it · **F3 — dl-110 is rated `standard` for a contract change.** Its Build step 1 adds a frame to `JobEvent` in `contract/src/job.ts` and `contract/src/api.ts`, and steps 2 and 3 change the API and the web; `docs/01-TICKETS.md` says "a one-line change to a contract is `hard`" and its own dl-102 example went `standard` to `hard` when the owner chose one. A `standard` builder gets the dispatch. Remedy, one word: `difficulty: hard`. Fully stated, so it can be made at landing with no re-gate.
- **low** · **F4 — the removals left text and CSS that are now false or dead.** (1) `styles.css`, the header comment above `.stage`: "the download's gated bar ... The download's five statuses are a pipeline ... drawn as gates"; the `.steps` rules went in this diff. (2) `components/AnalysingPanel.tsx`, the header comment: "The download's pipeline is the opposite and gets one; see `JobCard`"; `JobCard` draws none. (3) `lib/job-reducer.ts`, the doc on `refusalAfter`: "as the watched mark is", the mark this diff removed. (4) `web/test/app.test.tsx`, the file header: "(dl-20) the pipeline mark, which is folded in `useJobs` and read three components down in `JobCard`". (5) `components/ScenarioHints.tsx`, shown on the mock build: "press Cancel for `JOB_CANCELED`"; the card's button is now Stop. (6) `.button--quiet`, `.result__actions` and `.result__expiry` in `styles.css` have no user left; they were used by `JobCard`/`JobList` at the base. Grep for the removed identifiers (`statusHighWaterMark`, `reachedStep`, `markWatched`, `watchedSteps`, `clearFinished`, "Remove from list") finds no live reference: `src` and `e2e` are clean; the remaining hits are the replacement tests' own comments and done tickets (dl-18, dl-20, dl-43, dl-77), which are history. Graded `low` as comments that will mislead the next reader; (5) is the only one a user sees, and only on a mock build.
- **low** · **F5 — unverified premise: "You can close this page — downloads continue in your browser" is shown while `probing`.** The link's response sends no header until the first byte (`api/src/routes/files.ts`), so during Re-analysing, up to 10 to 20 s, the browser holds a request with no response, and the note is the one place the page tells the visitor they may leave. Measured with `gate-1/close-tab.mts`, a local server that delays the header 8 s and a tab closed 1.5 s after the click: Chromium and WebKit (Playwright builds) leave the request alive and the header is sent on a live socket; Firefox (Playwright build) closes the socket within 20 ms of the tab, so the job would be `canceled` with reason `disconnected`. Control: closing the whole browser closes the socket in about 5 ms in Chromium. **Caveat**: the Chromium and Firefox Playwright builds also cancel an already-started download when the page closes (measured with a long body), which real browsers do not, so I can say the three engines differ before the header and not what real Firefox or Safari do. After the header, `JobList`'s comment and the `events.ts` / `files.ts` reading in Why are right (verified in the routes). **Open decision**, options: (a, recommended) keep the note for `downloading` and, while `probing`, say "Keep this page open until your browser shows the download", then confirm the real-Firefox case by hand before widening it; (b) keep as is and record the Firefox case in the ticket; (c) drop the note while `probing`. The `disconnected` copy has the same hole: it lists a lost network, sleep and a canceled browser download, not a tab closed before the file began.
- **low** · **F6 — the hook's wiring of titles to storage has no test.** Build step 1 keeps the page title in its own `localStorage` key. `job-store.test.ts` tests `loadTitles` and `saveTitles` alone; commenting out the `saveTitles(...)` call in `useJobs` leaves 282 of 282 passing, so a reload would silently retitle every failed card by its rendition and nothing would say so. Done when 4 does not ask for it, so no line depends on it. Add one `app.test.tsx` case that starts a job, remounts, and reads the heading.
- **low** · **F7 — two thin spots under Done when 7.** The text-mark form `{ text: "4×" }` of `ProgressMessage.mark` has no test and no caller; dl-108 adds the only one, so there is no live call site. "One live region" is asserted on a one-message card (`downloading`); a `probing` card, which has two messages, is not asserted to keep both in the same `ul`.
- **low** · **F8 — `clearSaved` stops streams inside a `setJobs` updater.** `useJobs` calls `streams.current.get(id)?.stop()` and `.delete(id)` inside the updater function; `applyEvent` in the same file reads state outside its updater "to keep that updater pure". `main.tsx` mounts `StrictMode`, which runs updaters twice; the second pass finds nothing left to stop, so nothing breaks. No live call site that fails.
- **low** · **F9 — small drift in the two tickets this branch edits.** dl-108's step 5 is consistent with the code: `progressMessages()` is in `JobCard.tsx`, `ProgressMessages.tsx` renders it, and `{ text: "4×" }` matches `ProgressMessage.mark`. Two nits: `progressMessages(status)` takes only the status, so dl-108 will have to widen it to see `progress.originConnections`, which step 5 does not say; and its Build step 6 and Done when 4 still call the line "the hint". dl-110: the id is free (no `dl-110` on `origin/main`, no other open pull request files it), it parses (`npm run status -- --show dl-110` and `--json` exit 0), and its claims check out (`ResolveOptions.onStage`, the stage names, `probeStageText`, a re-probe that passes no `onStage`, `parseJobEvent` returning `null` for an unknown frame). Nits: the `registry.resolve` call is in `#probe`, which `#attempt` calls, not in `#attempt`; and "one progress message per status" is two while `probing`.
- **low** · **F10 — the pull request's title and body describe only the first commit.** Title `feat(downloader): start the download on the first Download press` carries no `dl-109` and the body has no mention of the job-card rewrite, the live-only list or the `localStorage` change; it also quotes "2463 passed", the old head's count (2454 passed, 2 skipped here). The title is the changelog line on a squash merge, so the lander will want one that names both.
- **dropped** · `JobCard` calling hooks above its early return for a saved row: the hooks run first, so the rule of hooks holds. · `terms.html` saying the browser keeps "your list of downloads": still true after the change (a narrower list, plus titles), so nothing to correct. · `loadTitles` accepting a `__proto__` key: assigning a string to `__proto__` is ignored, no pollution. · A failed job's `localStorage` record carries the variant's media URL, which can be signed: true at the base and reduced by this change (completed jobs are no longer kept), outside the range. · A `completed` job with no `result` rendering a full card: the orchestrator never writes one.
- **findings** · the hunt returned 15; 10 carried (F1 to F10), 5 dropped.
- Not run, unmeasured: real Firefox and Safari (F5); a screen reader against the live region; the dark theme; the Windows leg locally (it passed in CI on 0252c284, informational).
- NFR: security ✓ (titles are rendered as text and read back only as non-empty strings; the anchor `href` is the API's own link; nothing logs a URL) · performance n/a (a second `localStorage` write per progress frame, negligible) · reliability — F1, F5, F8 · maintainability — F4, F6, F7.
- Invariants walked: tool imports (web imports `@downloader/contract` only), contract untouched (no `contract/` path in the diff), no new error codes, faked progress (the bar stays indeterminate until `percent` is known, unknown stats are omitted, "Waiting" is a client clock), new test registered (`open-link.test.ts` ran inside the web project's 22 files), style (`npm run check` exit 0). Skipped as not touchable by a web-only diff: shell, process trees, `redact*`, SSRF, `Dockerfile` workspace lists, route enumeration.

**Dispositions, by the builder** (on the branch after `5e3c6536`):

- F1 — owner decision 9: the card goes back below the panel; `e2e/download.spec.ts`
  now asserts it is in the viewport after the press. **Fixed.**
- F2 — option (a): the filename branch is removed and Done when 4 reworded. **Fixed.**
- F3 — `difficulty: hard` on dl-110. **Fixed.**
- F4 — all six: the four comments rewritten, "press Stop" in `ScenarioHints`, the
  three dead rules deleted. **Fixed.**
- F5 — owner decision 10: the note shows only while `downloading`, and the
  `disconnected` copy names a page closed before the download began. Real
  Firefox and Safari remain unmeasured, and no longer matter to the note. **Fixed.**
- F6 — `app.test.tsx` › "a job's page title survives a reload, through the hook's
  own storage"; commenting out `saveTitles` reddens it (1 failed / 25). **Fixed.**
- F7 — `job-card.test.tsx` › "a progress message can lead with text instead of an
  icon, as dl-108's count will", two messages in one live region. **Fixed.**
- F8 — `clearSaved` stops streams before the updater, through `detach`. **Fixed.**
- F9 — dl-108's "hint" wording and its widened `progressMessages`; dl-110's
  `#probe` and its per-status sentence. **Fixed.**
- F10 — the pull request's title and body are rewritten for the whole branch. **Fixed.**

No second gate: every finding was fixed as the gate stated it, or by the owner's
choice between the gate's own options.

## Log

**2026-10-12**: filed from the owner's brainstorm (Why). Built on #433's branch.

**2026-10-12, later**: built on #433's branch in the order the owner steered it
over the mocks — the step list removed, the progress messages and their badges,
the figure above the bar from the first frame, three fixed stat columns. Gate 1
(above) failed one line on an unreachable fallback and moved two decisions back
to the owner: the card's place (above the panel landed it off screen) and the
close note while re-analysing (Firefox cancels before the first byte). The
brief's Build step 3 was wrong for the same reason the gate gave. dl-110 filed
for narrating the re-probe's stages.

**2026-10-25**: two of the decisions above were replaced by the owner. Decision 5's
badges are gone: the progress messages are plain lines styled like the analysing
panel's stage line, and the connection count has no "4×" mark (the pull request
that filed dl-133). Decision 3 (the saved row leaves on the next analysis) is
superseded by [dl-133](./dl-133-one-box-per-analysis.md) decision 5: a saved box
stays until dismissed, once dl-133 lands.
