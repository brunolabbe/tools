---
id: dl-138
tool: downloader
title: A probe or job request that never settles holds its slot
kind: fix
status: needs-decision
milestone: null
depends_on: [dl-133]
difficulty: standard
---

# dl-138 — A probe or job request that never settles holds its slot

## Why

dl-133 (PR #781, branch `downloader/dl-133-one-box-per-analysis`, `ready` on main and not merged) gives each analysis its own box. The page counts its probes against the server's per-client probe cap (2 at once, `maxProbesPerClient`, `api/src/config.ts`), and its jobs against the job cap (2 in flight, `maxJobsPerClient`). For a closed analysis, the owner chose to count its probe POST until the POST settles, because the server holds its probe slot until its handler ends: `clientReleaseProbe` is released in the handler's outermost `finally` (`api/src/routes/probe.ts`). The job count is the page's own. The server takes no job slot at `POST /api/jobs`, which writes a `queued` row and hands back a link; the slot is taken when the link is opened (`api/src/routes/jobs.ts`, `routes/files.ts`, `jobs/links.ts`). Both counts assume that a request settles. On main, `request()` in `tools/downloader/web/src/api/http.ts` passes `fetch` no timeout and no abort signal, and `ApiClient.probe` and `ApiClient.createJob` both go through it, so a request that stalls keeps its count for the life of the page.

Gate 2 of dl-133 found two cases, both `low`, and neither has a live call site:

- **N2, probe.** Two running analyses were closed while their probe POSTs were out, and those POSTs never settle. The count stays at 2 for the life of the page, and every later analysis waits. `ApiClient.probe` also spans the human-check wait before the POST (`withHumanCheck`, awaited before `request()` is called), which holds no server slot, so the count over-holds there. That is the safe direction.
- **N3, createJob.** A `createJob` that never settles leaves its box `starting`. Download, Analyse again and Dismiss are all disabled, and the box keeps its job count. dl-133's gate 1 F2 fix disabled Analyse again while the job is being created, which removed the box's only way out.

Both have one cause: no client-side request timeout. Their remedies differ, so the choice is held open in the Decision below.

**Reproduction.** Gate 2's probe (`gate-dl133-g2-probe.test.tsx`, cases `(o2)` and `(n3)`) is in a session scratch directory and is not committed. It is reference only, and no line graded here depends on it. Each case drives the real `App` with a mocked `ApiClient` under fake timers, advances 30 minutes, and reads the page. The filer re-ran it at dl-133's head `1042c0c6`, which is not the `4c621dc8` that gate 2 read: the branch has moved on since. Its lines, which gate 1 re-ran and got again:

- `(o2)` 30 min with two orphans out and two boxes waiting: `probe calls 2; headings Waiting | Waiting`
- `(o2)` three new analyses on a settled page: `started 2 of 3`, once the orphans have settled
- `(n3)` 30 min after Download with createJob unsettled, buttons in the box: `Starting…:true | Analyse again:true | Dismiss:true; createJob calls 1`

The probe replaces `ApiClient` with a fake, so it never reaches `request()` and cannot show a timeout. Its `(o2)` case also asserts the wedge (`expect(calls(fake)).toBe(2)`) before its later steps, so it cannot read a fix at all. A fix is graded by the committed App-level cases and `ApiClient`-level tests named in Done when.

## Build

Written against the answers in `## Decision — open`. The steps that do not depend on the answers come first.

1. Take this ticket after PR #781 (dl-133) has merged to main, since the code it concerns is on dl-133's branch until then. The builder who takes it commits the App-level cases under `tools/downloader/web/test/` (steps 4 and 5). They cannot be committed against main before that merge.
2. Red first, whatever the answer. Add a test under `tools/downloader/web/test/` that calls `ApiClient.probe` and `ApiClient.createJob` on the client from `createHttpClient` (`web/src/api/http.ts`), with `fetch` stubbed to a promise that never settles, under fake timers. Both calls are still pending after 30 minutes on main.
3. Apply the answers: where the bound lives (in `request()`, or on the two calls), the bound's value, which must clear the floor named under Question 2 (a), and the bound for `createJob` under Question 3 (a).
4. Add the App-level cases under `web/test/`, with a modelled server whose slot is released when its POST settles or times out at the bound. Do not port the scratch probe's `(o2)` as it stands. Read the state at the bound plus one second after the closes, not after a single 30-minute jump: a 30-minute jump lets the started boxes reach their own bound and fail, so the reading then describes the failure and not the fix.
5. Add the App-level case for `(n3)`. Replace the probe's `buttons.length > 0` assertion, which a box with no exit passes, with the enabled-exit assertion in Done when 4.
6. Keep dl-133's orphan tests green (`app.test.tsx`: the F1 cases and the gate 2 N1 cases). A settled request still counts exactly as dl-133 counts it.

## Decision — open

Question 1 is settled. Questions 2 and 3 are open. The recommendations are the filer's; the choices are the owner's.

**Question 1 — answered 2026-11-10 by the owner.** Record N2 and N3 only, or file a ticket. Options: record only (recommended by the orchestrator); file a ticket. Chosen: file a ticket. This ticket is that filing.

**Question 2 — open.** The remedy for N2, `ApiClient.probe`.

- **(a) A timeout on the POST, with a bound the owner names.** The timer starts at the fetch, after `withHumanCheck`, so the human-check wait is not counted. The bound must clear the server's hold on its probe slot, or the count gives the slot back while the server still holds it: F1's mismatch again. That hold is `probeTimeoutMs` (45 s by default, `PROBE_TIMEOUT_CEILING_MS` 50 s, `api/src/config.ts`), plus `FRAME_GRAB_TIMEOUT_MS` (6 s, `api/src/thumbnails.ts`), plus the output vet after `assertAllAllowed`, for which I found no bound. By arithmetic from the code, not measured, the slot is held about 51 s at the default and about 56 s at the ceiling, before the output vet. `probeTimeoutMs` is the resolution chain's budget, not the whole hold, and the page cannot read the deployment's value: `clientConfigResponseSchema` carries only `humanCheck` (`contract/src/api.ts`). The owner names the bound and its margin over those figures. A settled POST is what dl-133's count rule expects, so the rule does not change. Recommended: the smaller change, inside the count rule the owner chose. Costs: after a closed analysis, a count can be held up to the bound; and the floor cannot be checked from the page, only by the owner's judgement. Also to name: whether the timeout goes in `request()`, so `getJob` and `cancelJob` are bounded too, or on the two calls only.
- **(b) An abort signal on `ApiClient.probe`, aborted when the analysis is closed.** This is the option dl-133's F1 passed over. It needs no bound to name, and the orphans N2 describes all come from closing or re-analysing an analysis whose POST is out, so an abort on close covers them. It frees the client's count at once. The server's slot frees only when its handler unwinds after the socket closes (`routes/probe.ts` aborts its controller on `request.raw` close, and `assertAllAllowed` takes no signal), so a short window remains in which a third analysis could be refused `RATE_LIMITED`, the F1 symptom. Costs: it reopens F1, which the owner decided against this option, and it touches `api/types.ts`, `web/src/api/http.ts`, `mock.ts` and `useBoxes`.

**Question 3 — open.** The remedy for N3, `createJob`.

- **(a) A timeout on `createJob`, with a bound the owner names.** A timed-out `createJob` leaves one `queued` row that nothing opens. The page's `useJobs.start` throws before `attach`, so `openLink` is never called and no box is re-created. The row takes no job slot, because the slot is taken at the link's `GET` (`routes/files.ts`). The sweep cancels an unopened row as `link-expired` after the 15-minute link TTL (`LINK_TTL_MS`, `jobs/links.ts`; `runSweep` in `server.ts` runs every `gcIntervalMs`, 60 s by default). The row spends one token of the per-minute `POST /api/jobs` limiter. The box shows the request's error (`request()` maps a failed fetch to `UNREACHABLE`), and its buttons are enabled again. The bound must clear the POST's own waits: the human-check siteverify is bounded at 5 s (`SITEVERIFY_TIMEOUT_MS`, `api/src/human-check.ts`), and the SSRF guard's `dns.lookup` (`api/src/ssrf.ts`) has no bound in the code read. Recommended. Costs: a visitor who retries after the failure leaves a second queued row, and the owner's bound carries the margin over the POST's waits.
- **(b) Dismiss enabled while the job is being created, and a late answer for a dismissed box guarded before `attach`.** The box has an exit at once. Costs: it reverses the rule that dl-133 keeps, that Dismiss is disabled while a job is created (`ProbePanel.tsx`: "the box is about to become that job"). The guard must sit before `attach` in `useJobs.start` (`web/src/hooks/useJobs.ts`) and `useBoxes.startDownload`, so that `openLink` and `openJobEvents` are not called and no box appears. Without it, a dismissed box is re-created and its download starts (gate 1's plant of Dismiss without the guard: `boxes 2 -> 3; openLink calls 1; openJobEvents calls 1`). Its costs also include that a `createJob` which never answers can be left neither cancelled nor guarded, the same as under (a).

Either option, or both, can be taken; the answer names which.

## Done when

1. `ApiClient.probe` settles at the bound the answer to Question 2 (a) names. Under Question 2 (b), its signal aborts when the analysis is closed. A committed test under `tools/downloader/web/test/` calls `ApiClient.probe` from `createHttpClient` with a `fetch` that never settles, under fake timers. It is red on main and green on the fix, and both runs are in the Log.
2. `ApiClient.createJob` settles at the bound the answer to Question 3 (a) names, with the same test shape. Under Question 3 (b), a committed App-level case presses Dismiss on a box whose `createJob` is out, then lets the answer arrive late: `openLink` is not called, `openJobEvents` is not called, and no box appears.
3. A committed App-level case under `tools/downloader/web/test/`, built as Build 4 says, with a modelled server whose slot releases when its POST settles or times out at the bound. Two running analyses are closed while their POSTs are out, and two more are waiting. At the bound plus one second after the closes, the case reads `probe calls 4`, and both waiting boxes read `Analysing`. The same case then answers every POST and asserts that three new analyses on the page start 2 of 3. On dl-133's head `1042c0c6` the case is red, because its first assertion reads `probe calls 2` and both boxes `Waiting`.
4. A committed App-level case under `tools/downloader/web/test/`, built as Build 5 says: after Download with `createJob` unsettled, at 30 fake minutes, at least one of Download, Analyse again and Dismiss is enabled. On dl-133's head `1042c0c6` the scratch probe's `(n3)` line reads `Starting…:true | Analyse again:true | Dismiss:true`, and the case is red there.
5. dl-133's orphan tests in `tools/downloader/web/test/app.test.tsx` (the F1 cases and the gate 2 N1 cases) pass unchanged on the fix.
6. `npm run check` exits 0, and `npx vitest run tools/downloader/web` passes with the new tests in its count.

## Log

- 2026-11-10 — Filed from dl-133's gate 2, findings N2 and N3, on the owner's choice to file rather than record. The filer re-ran gate 2's probe, cases `(o2)` and `(n3)`, at dl-133's head `1042c0c6` (PR #781), not at the `4c621dc8` gate 2 read. All 17 cases passed, and the lines in Why are that run's.
- 2026-11-10 — Round 1, after gate 1 graded `00bc22b5` FAIL. Gate 1's full report is in this ticket's dl-138 session scratch, as `gate-1/gate-1@00bc22b5.full.md`. The server files cited below were read on main (`a100f429`), and dl-133's `useJobs.ts` and `ProbePanel.tsx` on `1042c0c6`. Each finding and its change:
  - **F1 (high), Q3's costs.** Corrected. `POST /api/jobs` writes a `queued` row and takes no slot (`routes/jobs.ts`); the slot is taken at the link's `GET` (`routes/files.ts`); an unopened link is cancelled `link-expired` by the sweep after `LINK_TTL_MS` (`jobs/links.ts`, `server.ts`). Q3 (a)'s cost is now a queued row nobody opens, swept in about 15 minutes. Q3 (b)'s costs now include the guard before `attach` and the planted race. The Why's "the job count works the same way" is corrected: the job count is the page's own. Done when 2 asserts the guard under (b).
  - **F2 (high), Q2 (a)'s floor.** Corrected. The bound must clear the server's whole hold on its probe slot: `probeTimeoutMs`, plus `FRAME_GRAB_TIMEOUT_MS` (`thumbnails.ts`), plus the output vet, which I found no bound for. That is about 51 s at the default and 56 s at `PROBE_TIMEOUT_CEILING_MS` (`config.ts`), by arithmetic and not measured. The page cannot read the deployment's `probeTimeoutMs`. The Why's "bounds its probe handler (`probeTimeoutMs`, 45 s)" is removed.
  - **F3 (med), Done when 3 and 4 against a scratch probe.** Done when 3 and 4 are worded against committed App-level cases, which the builder who takes the ticket after dl-133 merges commits under `web/test/` (Build 1, 4, 5). The scratch probe is reference only. Build 4 replaces the probe's `(o2)` shape, which asserts the wedge before its later steps. Build 5 replaces the `(n3)` assertion `buttons.length > 0`.
  - **F4 (med), the 30-minute jump.** Done when 3 reads the state at the bound plus one second after the closes, not after a 30-minute jump. Gate 1 measured, with a 60 s bound, that one jump, a `advanceTimersByTimeAsync` jump and thirty one-minute steps read differently, and that at 61 s after the closes the reading is `Analysing | Analysing` again.
  - **F5 (low), the abort window.** Q2 (b) no longer says the server's slot frees at once. The count frees at once; the server's slot frees when its handler unwinds after the socket closes (`routes/probe.ts`; `assertAllAllowed` takes no signal), so a short window remains.
  - **Q3 recommendation changed, from (b) to (a).** (b) was recommended on the leak. The leak does not exist: a timed-out `createJob` leaves a row nothing opens, and `useJobs.start` throws before `attach`, so `openLink` is never reached. (b) now needs a guard and reverses the Dismiss-disabled rule, which (a) does not.
  - **Q2 recommendation kept as (a).** It still holds: it keeps the count rule the owner chose. The floor is now stated, and the owner's bound carries its margin. (b) was weighed again. It needs no bound to name, but it reopens F1 and leaves the F5 window. The choice is the owner's.
  - **Difficulty re-rated from `hard` to `standard`**, for the recommended options (Q2 (a), Q3 (a)): a timeout inside `request()` or on two calls, with committed fake-timer tests and App-level cases. The judgement left is the bound's value, which the owner names.
- Not verified: the server was not run. The output vet's bound and the DNS lookup's bound were not found in the code read. The Windows leg was not read.
- Status stays `needs-decision`, with Questions 2 and 3 open.
