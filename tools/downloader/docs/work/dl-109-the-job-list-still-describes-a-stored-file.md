---
id: dl-109
tool: downloader
title: The job list still describes a stored file the server no longer keeps
kind: work-package
status: in-flight
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

## Build

1. `useJobs.start(url, options, title)`: keep the page title beside the job, in
   its own `localStorage` key, pruned to the jobs that remain. The job record is
   a contract type and the title is the page's knowledge, not the server's.
2. `job-store`: `saveJobs`/`loadJobs` skip `completed`. `useJobs` gains
   `clearSaved()`, called when an analysis starts; `clearFinished` goes.
3. `App`: the Downloads card moves above the analysis panel, so the card a press
   just created is on screen during the wait.
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
   falls back to the filename, then the rendition label. Proven in
   `job-card.test.tsx`.
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
9. `npm run check`, the downloader unit suite and `e2e:downloader` pass.

## Log

**2026-10-12**: filed from the owner's brainstorm (Why). Built on #433's branch.
