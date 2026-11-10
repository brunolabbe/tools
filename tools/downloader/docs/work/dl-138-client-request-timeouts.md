---
id: dl-138
tool: downloader
title: A probe or job request that never settles holds its slot
kind: fix
status: needs-decision
milestone: null
depends_on: [dl-133]
difficulty: hard
---

# dl-138 — A probe or job request that never settles holds its slot

## Why

dl-133 (PR #781, branch `downloader/dl-133-one-box-per-analysis`, `ready` and not merged) gives each analysis its own box and counts the page's probes and jobs against the server's per-client caps: 2 probes and 2 jobs at once. For a closed analysis, the owner chose to count its probe POST until the POST settles, because the server holds its own probe slot until its handler ends. The job count works the same way. Both rules assume that the request settles. On main, `request()` in `tools/downloader/web/src/api/http.ts` passes `fetch` no timeout and no abort signal, and `ApiClient.probe` and `ApiClient.createJob` both go through it, so a request that stalls keeps its count for the life of the page.

Gate 2 of dl-133 found two cases of this. Both are `low`, and neither has a live call site: the server bounds its probe handler (`probeTimeoutMs`, 45 s, `tools/downloader/api/src/config.ts`), and the visitor can reload.

- **N2, probe.** Two running analyses were closed while their `ApiClient.probe` POSTs were out, and the POSTs never settle. The probe count stays at 2 for the life of the page, and every later analysis waits. `ApiClient.probe` also spans the human-check wait before the POST (`withHumanCheck`), which holds no server slot, so the count over-holds there; that is the safe direction.
- **N3, createJob.** A `createJob` that never settles leaves its box `starting`. While it is starting, Download, Analyse again and Dismiss are all disabled, and the box keeps its job slot. dl-133's gate 1 F2 fix disabled Analyse again while the job is created, which removed the one way out the box had before, so the box now has no exit.

Both have one cause: the page has no client-side request timeout. The two remedies are not the same work, so the choice is held open in the Decision below.

**Reproduction.** Gate 2's probe (`gate-dl133-g2-probe.test.tsx`, cases `(o2)` and `(n3)`, run by its `run-g2-probe.sh`) is not committed. Each case drives the real `App` with a mocked `ApiClient` under fake timers, advances 30 minutes, and reads the page. The probe replaces `ApiClient` with a fake, so it never reaches `request()` and never exercises a timeout; a fix needs an `ApiClient`-level test as well (Done when 1 and 2). The filer re-ran the probe at dl-133's head `1042c0c6`, which is not the head gate 2 read (`4c621dc8`: the branch has since moved by its gate 2 fixes and records). Its lines:

- `(o2)` 30 min with two orphans out and two boxes waiting: `probe calls 2; headings Waiting | Waiting`
- `(o2)` three new analyses on a settled page: `started 2 of 3` (the count returns to zero once the orphans settle)
- `(n3)` 30 min after Download with createJob unsettled, buttons in the box: `Starting…:true | Analyse again:true | Dismiss:true; createJob calls 1`

Gate 2's figures at `4c621dc8` read the same.

## Build

Written against the answers in `## Decision — open`. The steps that do not depend on them come first.

1. Branch from main after PR #781 (dl-133) has merged. Until then the code this touches exists only on dl-133's branch.
2. Red first, whatever the answer: a test under `tools/downloader/web/test/` that calls `ApiClient.probe` and `ApiClient.createJob` on the client from `createHttpClient` (`web/src/api/http.ts`), with `fetch` stubbed to a promise that never settles, under fake timers. Both calls are still pending after 30 minutes on main.
3. Apply the answers: where the bound lives (in `request()`, or on the two calls), the mechanism (a timeout that rejects, or an abort signal), the bound's value, and the late-job handling and Dismiss state for `createJob`.
4. Make the probe's fake server release a slot at the same bound as the request. A fake that never releases cannot show the fix, and `(o2)` then reads the same as this head.
5. Keep dl-133's orphan tests green (`app.test.tsx`: the F1 cases and the gate 2 N1 cases). A settled request still counts exactly as dl-133 counts it.
6. Replace the probe's `(n3)` assertion, which checks only `buttons.length > 0`, with the enabled-exit assertion in Done when 4.

## Decision — open

Question 1 is settled. Questions 2 and 3 are open.

**Question 1 — answered 2026-11-10 by the owner.** Record N2 and N3 only, or file a ticket. Options: record only (recommended by the orchestrator); file a ticket. Chosen: file a ticket. This ticket is that filing.

**Question 2 — open.** The remedy for N2, `ApiClient.probe`.

- **(a) A timeout on the POST, with a bound above the server's 45 s probe budget.** The timer starts at the fetch, not at the human-check wait before it. The timeout rejects, which the orphan accounting already treats as settled, so dl-133's count rule does not change. A bound below the server's budget would give the count back while the server still holds its slot, which is the F1 mismatch again. Recommended: it is the smaller change, and it stays inside the count rule the owner chose. Costs: a count can be held, after the visitor has left, for up to the bound; and the bound's value is the owner's to name. Also to name: whether the timeout goes in `request()`, so `getJob` and `cancelJob` are bounded too, or on the two calls only.
- **(b) An abort signal on `ApiClient.probe`, aborted on Dismiss.** This is the option dl-133's F1 passed over. It frees the count and the server's slot at once, stops the server's work, and needs no bound. Costs: it reopens F1, which the owner decided against this option, and it touches `api/types.ts`, `http.ts`, `mock.ts` and `useBoxes`.

**Question 3 — open.** The remedy for N3, `createJob`.

- **(a) A timeout on `createJob`, as in question 2 (a).** The box shows an error and its Download is enabled again. Costs: if the server created the job after the page gave up, the job runs with no box and no id the page can cancel, and it counts against the server's job cap. Taken alone, this leaves that leak.
- **(b) Dismiss enabled while the job is being created, and a late `createJob` answer for a dismissed box cancelled with `cancelJob`.** The box has an exit at once, and a job the server does create is cancelled rather than left running. Recommended. Costs: it reverses the rule dl-133 keeps, that Dismiss is disabled while a job is created (the rule gate 1's F2 pointed to as its model, which the owner folded into dl-133 at gate 1); and a `createJob` that never answers still cannot be cancelled, the same gap as (a).

Either option, or both, can be taken; the answer names which.

## Done when

1. `ApiClient.probe` settles, or its signal aborts, at the bound the answer to Question 2 names. A committed test under `tools/downloader/web/test/` drives it with a `fetch` that never settles, under fake timers. On main the call is still pending past that bound; on the fix it settles there. The test is red on main and green on the fix, and both runs are in the Log.
2. `ApiClient.createJob` has the same test at the bound the answer to Question 3 names. A `createJob` answer that arrives after its box was dismissed is handled as the answer says (cancelled with `cancelJob` under 3 (b); under 3 (a) alone, the test names the job it leaves).
3. Probe `(o2)`, re-run on the fixed head 30 fake minutes after two running analyses are closed, reads `probe calls 4; headings Analysing | Analysing`: the two waiting boxes start once the two orphans release. On dl-133's head `1042c0c6` it reads `probe calls 2; headings Waiting | Waiting`. Three new analyses on a settled page still start 2 of 3.
4. Probe `(n3)`, re-run on the fixed head 30 fake minutes after Download with `createJob` unsettled, shows at least one of Download, Analyse again and Dismiss enabled. On dl-133's head `1042c0c6` it reads `Starting…:true | Analyse again:true | Dismiss:true`. A committed test shows the job slot the stalled call held released (the jobs in flight fall by one) at the bound, or on Dismiss.
5. dl-133's orphan tests in `tools/downloader/web/test/app.test.tsx` (the F1 cases and the gate 2 N1 cases) pass unchanged on the fix.
6. `npm run check` exits 0, and `npx vitest run tools/downloader/web` passes with the new tests in its count.

## Log

- 2026-11-10 — Filed from dl-133's gate 2, findings N2 and N3, on the owner's choice to file rather than record. The filer re-ran gate 2's probe, cases `(o2)` and `(n3)`, at dl-133's head `1042c0c6` (PR #781), not at the `4c621dc8` gate 2 read. All 17 cases of the probe passed, and the lines in Why are the run's. Gate 2's own figures agree.
- Not verified: the server's behaviour on a stalled probe connection beyond its 45 s budget; the claim that the server releases its slot when its handler ends is dl-133's reading of `api/src/routes/probe.ts`, not re-read here.
- Status is `needs-decision`: N2 and N3 each have remedies that differ in what they reopen (dl-133's F1 and F2), so a builder cannot start without the owner's answer.
