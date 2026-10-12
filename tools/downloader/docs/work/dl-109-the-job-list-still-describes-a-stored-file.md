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
5. **Keep the detail, restyle it.** The four steps stay (the owner considered
   replacing them with the bar alone and chose to keep them). Steps read
   **Starting → Re-analysing → Downloading → Done**. Under the bar, one
   description line; then the known stats only — an unknown one is left out
   rather than shown as "—".
6. **dl-108's hint goes on the new card**, under the stats; dl-108's Build step
   5 is rewritten here to say so. dl-108 itself stays a separate ticket.

## Build

1. `useJobs.start(url, options, title)`: keep the page title beside the job, in
   its own `localStorage` key, pruned to the jobs that remain. The job record is
   a contract type and the title is the page's knowledge, not the server's.
2. `job-store`: `saveJobs`/`loadJobs` skip `completed`. `useJobs` gains
   `clearSaved()`, called when an analysis starts; `clearFinished` goes.
3. `App`: the Downloads card moves above the analysis panel, so the card a press
   just created is on screen during the wait.
4. `JobCard`: title from the page, rendition and host under it; Stop, not
   Cancel; a "Waiting" stat while preparing; the downloaded figure over the bar;
   a saved job is the one-line `result` row; "Dismiss" on a failed or canceled
   job; the #433 fallback link as a prompt ("Nothing in your browser's
   downloads?").
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
5. The step labels are Starting, Re-analysing, Downloading and Done; a live card
   offers Stop; a failed or canceled card offers Dismiss and nothing named
   "Remove from list"; the list has no "Clear finished". Proven in
   `job-card.test.tsx`.
6. An unknown speed, time left or segment count is not rendered. Proven in
   `job-card.test.tsx`.
7. `npm run check`, the downloader unit suite and `e2e:downloader` pass.

## Log

**2026-10-12**: filed from the owner's brainstorm (Why). Built on #433's branch.
