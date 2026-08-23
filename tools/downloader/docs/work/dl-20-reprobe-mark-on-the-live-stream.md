---
id: dl-20
tool: downloader
title: Carry the re-probe mark to a client that never reconnects
kind: fix
status: done
milestone: null
depends_on: [dl-18]
---

# dl-20 — The high-water mark never reaches a live listener

## Why

[dl-18](./dl-18-pipeline-high-water-mark.md) stopped `JobCard`'s pipeline list
walking backwards over dl-9's `downloading → probing` back-edge, by deriving a
high-water mark from `job.attempts`. It works, it is tested, and **it does not
reach the user it was written for.**

`attempts` only ever changes on the server. Every route by which the client
learns something about a job is one of these, and none of them carries it:

- **`JobEvent`** (`contract/src/job.ts:167-176`) has seven members — `status`,
  `progress`, `probed`, `completed`, `failed`, `canceled`, `heartbeat`. No
  member has an `attempts` field.
- **`applyJobEvent`** (`web/src/lib/job-reducer.ts:76-131`) never writes
  `attempts` in any of its seven arms, because it has nothing to write.

So a client following the event stream holds `attempts: 1` straight through the
back-edge. It only learns the true value from a whole-`Job` refetch:
`job-stream.ts` reconciles after every reconnect, and `useJobs` re-fetches every
unfinished job on page load. Which means dl-18's fix is live **after a reload or
a dropped connection, and inert for someone watching a healthy stream** — the
person in dl-18's own Why, staring at a 20-minute download.

The gate on dl-18 confirmed this by rendering rather than by reading: driven
through the back-edge with only the frames the server actually emits, the live
render is byte-identical to the first-probe render. "Downloading" goes pending.

**And the refetch path is narrower than dl-18's Log claims.** `reconcileJob`
(`web/src/lib/job-reducer.ts:149`) keeps the _local_ copy when it is strictly
newer than the remote one — which is exactly what happens when an event lands
while the reconcile fetch is in flight. That is the common case on a reconnect,
since reconnecting is when frames arrive in a burst. So a reconnect whose
refetch loses that race discards the remote `attempts: 2` and the card stays
wrong until the next refetch happens to win. "Correct after a dropped
connection" is true only of the reconnects that do not race.

## Build

`tools/downloader/web/src/lib/job-reducer.ts`, and the tests beside it.

**A backwards `status` frame is itself the evidence.** The reducer is the one
place in the client that observes the _move_ rather than the resulting state:
`withStatus` is handed both the job's current status and the next one. A frame
that moves the job to a lower position in `STATUS_ORDER` can only be the
back-edge, because that edge is the only one in `JOB_TRANSITIONS` — so the
reducer can record the mark itself, with no new field on the wire.

1. **Decide where the mark lives, and say why in a comment.** `Job` is a
   contract type and must not grow a field locally. The two candidates are
   bumping `attempts` — honest in effect, dishonest in name, since the client
   would be reporting a server counter it did not observe — and a separate
   client-side record keyed by job id, which is truthful but has to be threaded
   from `useJobs` down to `JobCard` beside `streamState`, which already makes
   that trip. Prefer the second unless it turns out worse than it looks; either
   way the reasoning is the deliverable.
2. **Infer it in the reducer, not in the component.** `statusHighWaterMark` in
   `lib/status.ts` stays the single rule; what changes is that it is given a
   better-informed input. Keep it a pure function of its arguments.
3. **The reconcile race is part of this ticket, not a footnote.** Whatever the
   mark is, `reconcileJob` must not lose it when it keeps the local copy — and
   must not lose it when it takes the remote one either, since a remote job
   fetched fresh knows `attempts` but nothing about what this client watched.
   The mark is monotonic; merging two of them is a max, not a choice.
4. **Prove it against frames, not against hand-built jobs.** The test that
   matters drives `applyJobEvent` with the exact sequence the orchestrator emits
   over the back-edge — `status: probing` then `progress` with
   `initialProgress("probing")` — starting from a `downloading` job, and asserts
   the rendered card still marks "Downloading" done. dl-18's tests all mount a
   job built by hand, which is why none of them caught this.

**The alternative that was deliberately not taken:** adding `attempts` (or a
`reachedStatus`) to the `status` frame. That is a `contract` change, it would
make every client correct with no inference at all, and it is the cleaner answer
on the merits. It is not proposed here because dl-18 was scoped web-only and a
contract change needs the owner decision that dl-9 records needing. **If that
decision is available, take it instead of this** — and say so on this ticket
rather than building both.

**Traps.**

- `STATUS_ORDER` does not contain `failed` or `canceled`, and `statusIndex`
  returns the last index for anything it does not find. A terminal frame is not
  a backwards move; do not let it read as one.
- The reducer's whole docblock is about being total and monotonic so a late or
  duplicated frame cannot move a job backwards. A mark that any replayed frame
  can _lower_ reintroduces exactly what that docblock guards against.
- Do not touch `contract/src/job.ts` without the owner decision named above.

## Done when

- A `Job` driven through the back-edge by `applyJobEvent` alone — no refetch,
  no reload — renders "Downloading" as a completed step, and a test asserts it
  from the frame sequence rather than from a hand-built job.
- A job in its first `probing` state, reduced from the same code path, still
  renders "Downloading" as pending.
- A reconcile that keeps the local copy, and one that takes the remote copy,
  both retain the mark; both asserted.
- `npm run check` and `npm test -- --project downloader` are green.

## Gates

Both rounds, one subsection each, transcribed from the reviewer's reports without
editing the findings or the verdicts. **Gate 1 was a FAIL and is recorded as
one** — what was done about it belongs in the dispositions below it, not in the
verdict line. The `file:line` citations in both records were re-resolved against
this branch's rebased tip before this section was committed; the commit they
resolve against is named at the end of gate 2.

### Citations, re-resolved

Every `file:line` in both records below, checked programmatically against the
tree committed by the commit that adds this section — whose parent is
`84dfad2` — and then read back to confirm the line still holds what the citation
says about it. **The records themselves are
transcribed unedited** — a reviewer's report is not mine to renumber — so where a
line moved, the current one is here instead. Seventeen of the thirty-two still
land exactly; fifteen moved because the gate-1 and gate-2 fixes rewrote the very
comments the gates were quoting, which is the ordinary case and the reason this
table exists rather than a promise that the numbers are fine.

| As cited                          | Now                      | What is there                                            |
| --------------------------------- | ------------------------ | -------------------------------------------------------- |
| `orchestrator.ts:188`             | unchanged                | `this.#transition(jobId, "probing", { attempts, … })`    |
| `orchestrator.ts:187`             | unchanged                | `const reset = initialProgress("probing");`              |
| `orchestrator.ts:194`             | **`:193`**               | `events.progress(jobId, reset);`                         |
| `db/job-store.ts:69-84`           | unchanged                | `export function initialProgress(…)`                     |
| `api/src/routes/events.ts:88`     | unchanged                | the channel's opening `status` frame                     |
| `contract/src/job.ts:167-176`     | unchanged                | the `JobEvent` union, all seven members                  |
| `api/src/db/job-store.ts:186`     | unchanged                | `status: "queued" satisfies JobStatus,`                  |
| `api/src/routes/jobs.ts:57`       | unchanged                | `options,` — still the wrong line, as gate 1 says        |
| `App.tsx:155`                     | unchanged                | `<JobList`                                               |
| `JobCard.tsx:47`                  | unchanged                | the `active` predicate the pipeline `<ol>` hangs off     |
| `useJobs.ts:52`                   | unchanged                | `jobsRef.current = jobs;`                                |
| `useJobs.ts:71`                   | unchanged                | `watch(remote.id, remote);`                              |
| `useJobs.ts:98`                   | unchanged                | the live fold — gate 1's finding #1                      |
| `useJobs.ts:137-138`              | **`:138-139`**           | `mergeJob(job);` then `if (!isTerminal(job)) attach(…)`  |
| `useJobs.ts:159-167` (gate 1)     | **`:156-164`**           | `start()`; gate 2 already cites the corrected range      |
| `job-stream.ts:82`                | unchanged                | `if (isReconnect) void reconcile();`                     |
| `app.test.tsx:82`                 | unchanged                | `getJob: vi.fn(unused("JOB_NOT_FOUND"))`                 |
| `app.test.tsx:321`                | unchanged                | `const BACK_EDGE: JobEvent[] = [`                        |
| `app.test.tsx:374`                | **`:392`**               | the restored `job("downloading", …)`                     |
| `app.test.tsx:407-408`            | **replaced; `:417-425`** | the comment gate 1 found false, now saying so            |
| `app.test.tsx:417-424`            | **`:417-425`**           | same block, one line longer after formatting             |
| `app.test.tsx:485`                | unchanged                | the load-bearing third `pipeline()` assertion            |
| `job-card.test.tsx:80-88`         | **`:79-96`**             | `watch()`'s docblock, rewritten twice since              |
| `job-card.test.tsx:88-89`         | **`:88-90`**             | the narrowed sentence that replaced gate 2's finding #2  |
| `job-card.test.tsx:90` (the seed) | **deleted**              | the pre-loop seed is gone; that was the gate-1 #3 fix    |
| `job-card.test.tsx:93-95`         | unchanged                | "Mirroring the hook is the limit…"                       |
| `job-card.test.tsx:102`           | **`:104`**               | `watchedStep = markWatched(watchedStep, current, next);` |
| `job-card.test.tsx:399`           | **`:404`**               | the section header                                       |
| `job-card.test.tsx:410-411`       | **`:412`**               | the corrected "the first goes red" sentence              |
| `job-card.test.tsx:435`           | **`:443`**               | `watch(job("downloading"), BACK_EDGE)`                   |
| `job-card.test.tsx:460`           | **`:468`**               | `watch(job("queued"), […])` — the control                |
| this file, `:239`                 | **`:600`**               | the mutation table's preamble                            |

Paths are as the reviewers wrote them; every `web` path is under
`tools/downloader/web/`, every `api` path under `tools/downloader/api/`.

### Gate 1 — FAIL

**Verdict: FAIL**

The shipped **code appears correct** — no input was found that produces a wrong render. The failure is in the **proof**: dl-20's defining mechanism is covered by no test at all, and the branch asserts the opposite in three places. This is the same failure shape dl-20 was created to correct in dl-18, one level up. Fixable with one test plus three corrected claims; no redesign needed.

#### Item 1 (the frames): clean — the frames are faithful

Every frame the tests feed the client traced to a real producer:

| Test frame                                                       | Producer                                                                                                            | Verdict                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `status: probing`                                                | `api/src/jobs/orchestrator.ts:188` `#transition(jobId,"probing",…)` → `#transition` calls `events.status(jobId,to)` | real                                                       |
| `progress` w/ `stage:"probing", percent:null, downloadedBytes:0` | `orchestrator.ts:187,194` `const reset = initialProgress("probing"); … events.progress(jobId, reset)`               | real, field-for-field identical to `db/job-store.ts:69-84` |
| reconnect's opening `status: probing`                            | `api/src/routes/events.ts:88` writes `{type:"status", jobId:id, status: job.status, at}` on subscribe               | real                                                       |

Order matches (`#transition` emits `status` before `events.progress`). **No test frame carries `attempts`**, and none carries a field `JobEvent` (`contract/src/job.ts:167-176`) cannot produce. Nothing the server emits over the back-edge is missing from `BACK_EDGE` (`app.test.tsx:321`).

**But the frames, though faithful, are inert.** See finding #1.

#### Findings

**#1 (high) — `useJobs.ts:98`: the live fold is killed by nothing. The one path dl-20 exists for is untested.**

`applyEvent`'s fold — `if (before) watch(jobId, before, applyJobEvent(before, event));` — is the _entire_ live-stream mechanism of this ticket. Replaced with a no-op:

- `npx vitest run tools/downloader/web --project downloader` → **16 files / 190 tests, all pass**
- `npm test -- --project downloader` → **48 files / 675 tests, all pass**

Nothing in the repo notices. The builder's 15-row mutation table never runs this mutation; it runs only the narrower "drop the _before_ argument".

**Why the test that claims to cover it does not.** `useJobs.ts:137-138` — `restore()` calls `mergeJob(job)` **before** `attach(jobId)`, and `mergeJob` (`useJobs.ts:71`) folds the mark. In `app.test.tsx:374`, the restored job is `job("downloading")`, so `reachedStep` returns `statusIndex("downloading") = 2` and **the mark is already 2 before a single frame arrives**. The frames contribute nothing.

Isolated by mutating each fold separately:

| Mutation                                     | Red                           |
| -------------------------------------------- | ----------------------------- |
| `applyEvent` folds nothing (`useJobs.ts:98`) | **0**                         |
| `mergeJob` folds nothing (`useJobs.ts:71`)   | 1 — only the _reconnect_ test |
| both                                         | 2                             |

Test 1 passes under _either_ path. It cannot distinguish them, and the path it names is the one it does not exercise.

**Concrete failure scenario.** The commonest journey — user pastes a URL in this tab and watches it live — goes through `start()` (`useJobs.ts:159-167`), which calls `attach` and **never calls `mergeJob`**. For that user the mark comes _solely_ from `useJobs.ts:98`. Today it works. The moment that line is touched — refactored, or the `watch` call dropped in a future edit — the user watching a 20-minute download sees "Downloading" revert to pending and the pipeline retreat: **dl-18's original bug, restored, with the full suite green.** Precisely the regression dl-20 was filed to make impossible.

The missing test is small: drive the same frames over a job the client holds **without** a preceding `mergeJob` — i.e. via `start()`/`createJob` rather than via `localStorage` restore — and assert the pipeline. That flow is real and currently has no coverage.

**#2 (high, same root) — `app.test.tsx:407-408`: the branch states the falsehood explicitly.**

```
  // And nothing went back to the server for it. One call, made on restore before
  // the edge was taken — so `attempts` was `1` every time the client saw it, and
  // the mark can only have come from the frames.
  expect(fake.client.getJob).toHaveBeenCalledTimes(1);
```

The `attempts: 1` half is true and irrelevant: `reachedStep` reads `attempts` only for `probing`. For the restored `downloading` job it returns step 2 regardless of `attempts`. **That one `getJob` call is exactly where the mark comes from.** The assertion presented as ruling out the refetch _is_ the refetch.

The same claim is repeated in the test's name ("with no refetch behind it") and in the Log's "This is the live path: the frames alone, no refetch." A reader who trusts any of the three believes the live path is proven. It is not. This is the "value arriving from a different source than the test claims" shape — on the repo's known defect list, and the very shape the builder rewrote the _other_ test for.

**#3 (medium) — `job-card.test.tsx:90,93`: the component test has the same shape.**

`watch()` seeds the mark with `markWatched(0, current)` at line 90 _before the loop_, so for `watch(job("downloading"), BACK_EDGE)` the mark is 2 up front. Neutralising the per-frame fold at line 93:

```
watchedStep = markWatched(watchedStep, current, next);  →  watchedStep = watchedStep;
```

→ **16 files / 190 tests, all pass.** The frames contribute nothing here either.

This sits directly under a section header (`job-card.test.tsx:399`) claiming "These two build nothing — they start from a job the client already holds and fold in the exact frames the orchestrator emits, so the render is a function of the wire." The render is a function of the hand-built start job. The helper's own docblock (`:80-88`) defers the wiring claim to `app.test.tsx` — which, per #1, does not deliver it. **The deferral chain terminates in nothing.**

**#4 (low) — the Log's mutation table omits the mutation that matters, and its counts are off by one.**

Fifteen mutations tabled; the one that would have exposed #1 (fold nothing in `applyEvent`) is absent, while its strictly weaker sibling (drop the _before_ argument) is analysed at length. The Log states the web run is "189 tests, 16 files"; measured **190 tests, 16 files** on both the control and every mutated run.

**#5 (info) — imprecise citation.**

The survivor argument cites `api/src/routes/jobs.ts:57` for "`createJob` returns a `queued` job". Line 57 is `options,` inside the `store.create({…})` call. The claim is **true**, but its proof is `api/src/db/job-store.ts:186` (`status: "queued" satisfies JobStatus`).

#### What the branch got right (verified, not assumed)

- **Contract untouched.** `git diff origin/main...HEAD -- tools/downloader/contract/` is **empty**, and it did not need touching: the reducer-side design is the honest second-best, not a workaround. `markWatched`'s running max is genuinely better than the Build section's "detect a backwards move" premise — no `failed`/`canceled` special case at the comparison site, nothing to re-derive if a second back-edge appears.
- **The reconcile race is closed.** `mergeJob` folds before `reconcileJob` chooses (`useJobs.ts:71`). Dropping that line reddens exactly one test — `a reconnect that slept through the download stage keeps the refetch's word for it` — confirming the builder's claim. The rewritten reconnect test genuinely tests its own line.
- **The per-card lookup rewrite is sound.** Removing `watchedStep={watchedSteps[job.id]}` reddens `each card is handed its own pipeline mark, looked up by job id` (plus 2 others). Its fixture value (mark `2` on a `probing`/`attempts:1` job) is no longer the component's no-op.
- **Required-prop safety is real.** Deleting the `JobList → JobCard` hop: `npm run check` goes red, and the _typecheck_ arm catches it independently — `TS2741: Property 'watchedStep' is missing … but required in type 'JobCardProps'`. Not merely the unused-var lint. `git grep` unfiltered confirms the only render sites are `App.tsx:155` and `JobList.tsx`; no third consumer silently reads `undefined`.
- **Terminal boundaries are clean.** `reachedStep` returns `null` for `failed`/`canceled`, so `watched` can never promote them; `statusHighWaterMark` falls back to `statusIndex(status)` = last index, but the pipeline `<ol>` renders only when `active` (`JobCard.tsx:47`), which excludes all three terminal statuses. A job failing after a re-probe, canceled mid-download, or failing on the first probe renders no list at all. `muxing` after a re-probe correctly shows steps 0–2 done, 3 active.
- **The "provably equivalent mutant" is genuine.** `if (step === null || step > mark) mark = step ?? mark;` survives (190/190), equivalent by truth table: `null` → `mark = mark`; `step > mark` → `mark = step`; `step <= mark` → no assignment.
- **Both survivor claims are true.** `restore` reconciles before attaching (`useJobs.ts:137-138`); `createJob` returns `queued` (`job-store.ts:186`). The survivor is genuinely benign. _Note:_ these are the same two facts that make #1 invisible. **The builder had the evidence in hand and drew the narrower conclusion.**
- **`jobsRef` reasoning holds.** `jobsRef.current = jobs` during render (`useJobs.ts:52`). Batched frames can make `before` stale, but since it only feeds a monotonic max over states the client genuinely held, staleness can only under-contribute, never lower the mark.

#### Mutation sweep reproduced

Control: `npx vitest run tools/downloader/web --project downloader` → **exit code 0**, 16 files / 190 tests. (Not `--reporter=basic`; that trap does not apply.)

| Mutation                                                      | Builder  | Reviewer                   |
| ------------------------------------------------------------- | -------- | -------------------------- |
| `statusHighWaterMark` ignores `watched`                       | 6        | **6** ✓                    |
| `statusHighWaterMark` returns `watched` not max               | 7        | **7** ✓                    |
| `reachedStep` places `failed`/`canceled`                      | 2        | **2** ✓                    |
| `JobCard` ignores the mark                                    | 4        | **4** ✓                    |
| `JobList` never hands the mark                                | 3        | **3** ✓                    |
| `markWatched` last-wins                                       | 4        | **4** ✓                    |
| `useJobs` stops folding reconciled remote                     | 1        | **1** ✓                    |
| "equivalent mutant"                                           | survives | **survives, equivalent** ✓ |
| **`applyEvent` folds nothing** — _not in the builder's table_ | —        | **0 red** ⚠                |

Seven kills reproduced with identical counts. Every source restored via `cp` + `touch` + `npm run build`; `git status --porcelain` empty before the gates.

#### Gates reproduced

| Command                            | Exit  | Result                                                                                                              |
| ---------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                    | 0     | clean; farm resolves inside the reviewer's worktree ✓                                                               |
| `npm run check`                    | **0** | lint warnings only (pre-existing `no-await-in-loop`)                                                                |
| `npm test -- --project downloader` | **0** | **48 files / 675 tests** — matches claim                                                                            |
| `npm test`                         | **0** | **101 files / 1431 tests** — matches claim; baseline `origin/main` confirmed at `4e3c48e`, so **+15**, none removed |

#### Assertion sweep — enumerated, not sampled

**46 added assertions**, all walked (`app.test.tsx` 10, `job-card.test.tsx` 9 + 3 modified `JobList` mounts, `status.test.ts` 10, `job-reducer.test.ts` 14).

- **Fixture value = component's no-op:** 4 candidates, all acceptable. `status.test.ts` uses `watched = 0` twice, but each is a deliberate control paired in-test with a non-degenerate line; `markWatched(downloading, probing)` is a no-op _by design_ — the no-lowering property is the assertion. The one real instance was already rewritten. **None survived as a defect.**
- **Value arriving from a different source:** **2 found — findings #1/#2 and #3.** Both proven by mutation, not by reading.
- **Negative assertion with no companion:** 1 markup-absence assertion — `app.test.tsx` `queryByRole("heading", {name:"Losing server copy"}).toBeNull()`. It **has** a companion on the next line (`getByRole("heading", {name:"1080p · H.264 + AAC"})`, which throws if the block is gone). **None survived.**

#### What this gate did NOT do

- **Did not fix anything.** Tree verified clean; nothing written to any file in the repo.
- **e2e and container gates: unrun** — `.github/workflows/downloader.yml` only. This is a `web` change altering the bundle, so the browser is unproven.
- Did not re-derive that dl-18's fix fails to reach a live listener (accepted per scope).
- Did not test the `App → JobList` prop hop; tested the riskier `JobList → JobCard` hop (`number | undefined`).
- Did not exhaustively mutate `status.ts`/`job-reducer.ts` beyond the rows above.

#### Claims the gate could not verify

- "189 tests, 16 files" — measured 190/16 consistently (finding #4).
- Six of the builder's fifteen mutation rows — not run; the seven that were run all matched exactly.

#### Disposition — all five findings

- **#1 (high), `useJobs.ts`'s live fold killed by nothing — FIXED.** Reproduced
  first: with that fold replaced by a no-op the tree as committed at the time ran
  16 files / 190 tests green and 48 files / 675 tests green. `app.test.tsx` gains
  `a job started in this tab, never refetched, gets its mark from the frames
alone`, which drives `start()` — the journey that never calls `mergeJob` — and
  is the only test in the repo that dies when the fold is removed (1 failed /
  190 passed).
- **#2 (high), the branch asserting the opposite — FIXED.** The restore test is
  renamed (`…with no refetch behind it` is gone) and its comment now states
  plainly that the single `getJob` call it cited as ruling the refetch out _is_
  the refetch.
- **#3 (medium), the same shape in the component test — FIXED at the root, not
  the wording.** `watch()`'s pre-loop seed is gone; the helper starts at `0` and
  raises only inside the loop, which is also what `useJobs` does. The per-frame
  fold is now load-bearing (1 failed / 190 passed when neutralised). Gate 2
  verified both call sites produce the identical value before and after, so
  nothing weakened.
- **#4 (low), the omitted mutation row and the counts — FIXED.** The
  `applyEvent`-folds-nothing row is in the table at 1 red; the control is 191
  tests / 16 files, not the 189 first claimed.
- **#5 (info), imprecise citation — FIXED.** `api/src/db/job-store.ts:186`
  replaces the `routes/jobs.ts:57` citation, with a note saying why the old one
  proved nothing.

### Gate 2 — CONCERNS

**Verdict: CONCERNS**

The delta's substance is correct and was verified end to end: the new test kills the line gate 1 found uncovered, the seed removal makes the component-test fold genuinely load-bearing, no source changed, and every table row reproduced matched exactly. **One corrected claim is still false** — in the very sentence rewritten to fix gate 1's finding #2. A one-line comment fix, blocking but trivial.

#### Findings, most severe first

**1. `tools/downloader/web/test/job-card.test.tsx:410-411` — the rewritten section header contains a new false claim**

> `// else**, which is the half that was missing. Drop the fold in `watch()` above`
> `// and both go red.`

**Only one goes red.** Dropping exactly that fold (line 102 → `markWatched(watchedStep)`) gives **1 failed / 190 passed** — the failure is `a job driven over the back-edge by frames alone still marks Downloading done`. The other test, `a first probe reduced from the same code path leaves Downloading pending`, stays green **and must**: it asserts `Downloading` _pending_, which is what a zero mark produces. It is the control. A control that reddens when the mark is dropped would be broken.

This is the failure mode the brief names: gate 1 found the header false, the builder rewrote it, and the rewrite is false in a new place — now reading as reviewed. Suggested fix: `Drop the fold in watch() above and the first goes red; the control below it must not, which is what makes the pair discriminate.`

**2. `tools/downloader/web/test/job-card.test.tsx:88-89` — secondary overstatement in the same rewritten docblock**

> `The tests below would have passed against a reducer that folded nothing.`

False under its literal reading. Restoring the seed (`markWatched(0, current)`) **and** neutralising `markWatched` in `job-reducer.ts` — the reducer folding nothing — gives **1 failed / 27 passed** in `job-card.test.tsx`, the back-edge test red. The seed's own call goes through the same reducer, so a reducer that folds nothing kills it too. The sentence is true only under the narrower reading "a _per-frame_ fold that folded nothing", which the preceding clause already says. Drop the sentence or narrow it explicitly.

**3. `tools/downloader/docs/work/dl-20-…md:239` — table preamble says "each applied to the source", but row 16 mutates a test file**

`job-card.test.tsx's watch() folds nothing per frame` is a mutation of a test, not of the source. Cosmetic; one qualifying clause fixes it.

**4. Ticket Verification numbers will go stale on rebase (informational, not a defect)**

`origin/main` is now `848af10`, two commits ahead of the branch's base `4e3c48e` (`8dc9cd4` repo-6, `848af10` dl-24). Both add tests to existing files, so after a rebase the **file** counts (48 / 101) hold but the **test** counts rise above 676 / 1432, and the "baseline of 101 / 1,416 at `4e3c48e`" stops being the merge-base. The branch needs a rebase before merge. **No count difference measured is attributable to main** — every number on the branch matched the builder's claim exactly.

#### Mutation control and every mutation reproduced

**Control:** `npx vitest run tools/downloader/web` → **exit 0**, 16 files / 191 tests passed. Re-run clean after all mutations reverted; `git status --porcelain` empty.

| Mutation                                                  | Builder claims         | Reviewer measured                                                                               |
| --------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `useJobs.ts:98` fold → no-op (**gate 1's row**)           | exit 1, 1 red / 190    | **exit 1, 1 failed / 190 passed** ✓ — the single failure is the new test, at `app.test.tsx:485` |
| `useJobs.ts:98` drops only the `before` arg               | survives, exit 0 / 191 | **exit 0, 191 passed** ✓ — survivor unchanged, did not become load-bearing                      |
| `job-card.test.tsx:102` fold → `markWatched(watchedStep)` | 1 red / 190            | **exit 1, 1 failed / 190 passed** ✓                                                             |
| `statusHighWaterMark` ignores `watched` (was 6)           | 7                      | **7 failed / 184** ✓                                                                            |
| `markWatched` folds nothing (was 6)                       | 7                      | **7 failed / 184** ✓                                                                            |
| `markWatched` last-wins not monotonic (was 4)             | 5                      | **5 failed / 186** ✓                                                                            |
| `useJobs` mark starts at last step (was 2)                | 3                      | **3 failed / 188** ✓                                                                            |
| `JobCard` ignores the mark (was 4)                        | 5                      | **5 failed / 186** ✓                                                                            |
| `JobList` never hands the mark (was 3)                    | 4                      | **4 failed / 187** ✓                                                                            |
| `markWatched` null-guard rewrite (equivalent mutant)      | survives               | **exit 0, 191 passed** ✓                                                                        |

All six rows whose counts shifted by +1 reproduce exactly. **The arithmetic is right this time — no overstatement.** Row count is genuinely 17. The Log's gate-1 item 2 claim was also confirmed directly: with the old seed restored and the per-frame fold neutralised, the full web suite is **191 green**, which is precisely why the seed had to go.

#### Every `watch()` call site in `job-card.test.tsx`, and what the seed removal changed

Two call sites, plus the definition. Both produce the **identical `watchedStep` value** before and after the seed removal — zero assertion drift; only the producer changed.

- **`:435` — `watch(job("downloading"), BACK_EDGE)`.** Old: seed `markWatched(0, downloading)` = 2, loop cannot raise it. New: seed 0, first frame folds `(downloading, probing)` → max(0, 2, 1) = 2. **Same value, strictly stronger.** Previously the seed carried the whole mark and the loop was decoration; now dropping the loop fold reddens it.
- **`:460` — `watch(job("queued"), [status probing])`.** Old: seed = 0, loop → 1. New: 0, loop → 1. **Same value, no change in strength.** It is the control: its assertion holds at mark 0 _and_ mark 1 because `reachedStep(probing, attempts 1)` = 1 either way — inert with respect to the fold _by design_.

**Nothing became weaker and nothing started passing for a new wrong reason.** The pair now discriminates a mutant it did not before: `markWatched(watchedStep, next)` (dropping `current`) leaves the control green and reddens the back-edge test; under the seeded version that mutant stayed green in both. No other test in the file uses the helper.

#### Does the new test pass for the right reason?

Yes, verified against the real code path, not by reading the fake.

- **`getJob` is never called, structurally.** `start()` (`useJobs.ts:156-164`) calls `createJob`, `upsertJob`, `attach` — no `mergeJob`. `attach` → `createJobStream.start()` → `connect()` with `connections === 0`, so `isReconnect` is **false**, and `job-stream.ts:82` (`if (isReconnect) void reconcile();`) is the guard that skips the refetch. The test calls `listeners[0].onOpen()`, which runs that **real** handler. `localStorage.clear()` in `beforeEach` means the restore effect iterates an empty list.
- **The assertion is not vacuous.** `getJob` is a wired `vi.fn` (`app.test.tsx:82`) that _rejects_ with `JOB_NOT_FOUND`. Had it been called, `failLocally` would flip the job to `failed` and the pipeline assertions would change too. Double-guarded.
- **Fixture no-ops:** of the three `pipeline()` assertions, **only the third is load-bearing** with respect to the fold — mutation A failed at `app.test.tsx:485`. Assertions 1 and 2 are journey checkpoints and the "can only have come from the fold" comment sits on the third. `RUN_TO_DOWNLOADING`'s `downloading` status frame **is** essential; its `progress` frame is decorative but realistic — no claim rests on it.

#### The three corrected claims

- **`app.test.tsx:417-424` — TRUE, verified by mutation.** Under mutation A this test **stayed green** — empirical proof that its single `getJob` call, not the frames, was carrying the mark. The comment now says exactly that.
- **`job-card.test.tsx:93-95` — TRUE.** "the only test in the repo that dies when `useJobs`'s `applyEvent` fold is removed": mutation A produced exactly one failure, and it is that test.
- **Ticket Build section, the `applyEvent` bullet — TRUE.**
- **`job-card.test.tsx:410-411` and `:88-89` — FALSE**, findings 1 and 2.

#### Counts

|                        | Claimed          | Measured                                                    |
| ---------------------- | ---------------- | ----------------------------------------------------------- |
| `npm run check`        | exit 0           | **exit 0** (warnings only, pre-existing `no-await-in-loop`) |
| web project            | 16 files / 191   | **16 / 191**                                                |
| `--project downloader` | 48 files / 676   | **48 / 676**                                                |
| full `npm test`        | 101 files / 1432 | **101 / 1432**                                              |

Diff scope confirmed: `git diff --stat 50c0ba8..HEAD` = **three files, no source**. Gate 1's "code was correct" verdict still holds.

#### What this gate did NOT do

**Deliberately not revisited — everything gate 1 settled:** frame-to-producer traceability; `contract/` untouched and the reducer-side design being the honest second-best; the `mergeJob` reconcile race; terminal boundaries; the `TS2741` required-prop typecheck arm; the truth-table proof of the equivalent mutant (only confirmed it still _survives_); the seven originally-reproduced rows whose counts did not change; the 46-assertion sweep; dl-18's defect derivation.

**Also not done:** did not check out `50c0ba8` to re-verify the pre-delta "190 green under the no-op" claim — gate 1 established it. Did not measure the 1,416 baseline at `4e3c48e` independently. No e2e, no container build.

#### Claimed but not verifiable here

- **"and by nothing else in the repo"** — true of every unit suite (mutation A over the web project gave exactly one failure, and `useJobs` has no consumer outside `App.tsx`), but `tools/downloader/e2e/download.spec.ts` **does not run in this loop** and could in principle also observe the fold. **e2e and the container gate are unrun and must run before merge** — unchanged from gate 1, not a delta finding.
- The `applyEvent`-drops-`before` survivor's benignness rests on an enumeration gate 1 accepted; only confirmed it still survives at 191. The new test does not distinguish it, because `RUN_TO_DOWNLOADING`'s `downloading` frame already raises the mark to 2 as the _after_-state before the back-edge arrives.

#### Disposition — all four findings

- **#1 (blocking), "Drop the fold in `watch()` above and both go red" — FIXED.**
  Reproduced before rewriting: 1 failed / 190 passed, and the failure is the
  back-edge test. The control asserts "Downloading pending", which is what a zero
  mark renders, so it stays green and must. The paragraph now names that
  asymmetry as the thing that makes the pair discriminate, and says outright that
  an earlier draft claimed otherwise.
- **#2, "The tests below would have passed against a reducer that folded
  nothing" — FIXED.** Reproduced: restoring the seed and neutralising
  `markWatched` gives 1 failed / 27 passed, because the seed's own call went
  through the same reducer. Narrowed to the per-frame fold, which is what was
  actually unheld.
- **#3, the table preamble — FIXED.** It now says sixteen rows mutate the source
  and row 16 mutates a test, and why that is the right thing for it to probe.
- **#4 (informational), stale counts on rebase — FIXED.** Rebased onto
  `848af10`; every figure in `### Verification` re-measured against it, including
  the baseline, which was taken by checking that commit out rather than inferred.
  Gate 2's prediction that the file counts would hold at 48 / 101 did not
  survive measurement — `8dc9cd4` adds a suite — and the Verification section
  says so.

**Both gates flag the same unrun proof, and it is still unrun:**
`tools/downloader/e2e/download.spec.ts` and the container build live in
`.github/workflows/downloader.yml` and run nowhere else. This is a `web` change
that alters the bundle, so CI is the first thing that will exercise it.

## Log

### 2026-08-23 — built

The mark is a **client-side record keyed by job id** — Build step 1's second
candidate — folded in `job-reducer.ts` and threaded `useJobs → App → JobList →
JobCard` beside `streamState`. `contract/src/job.ts` is untouched; the owner
decision the Build section names as the better answer was not available, so the
alternative it describes was not taken.

Three pieces:

- **`reachedStep(job)` in `lib/status.ts`** — the furthest pipeline step a `Job`
  proves _on its own_, or `null` for `failed` and `canceled`, which
  `STATUS_ORDER` has no step for. It carries dl-18's `attempts > 1 && probing`
  rule unchanged; the `null` is what keeps `statusIndex`'s fold of the two
  terminal statuses onto the last step from becoming a trail of four done steps.
- **`markWatched(watched, ...jobs)` in `lib/job-reducer.ts`** — a running
  `Math.max` over `reachedStep` of every state the client holds. Monotonic by
  construction, which is what the module's docblock demands.
- **`statusHighWaterMark(job, watched = 0)`** — unchanged in shape, now
  `Math.max` of the two witnesses. Neither alone is enough: a page load has only
  `attempts`, a live stream has only what it watched.

`useJobs` folds in two places, and **both are load-bearing** — each has a
mutation that only the other's test catches:

- `applyEvent` folds the job as it stood and the job the event produced. This is
  the live path, and the journey that reaches it with nothing else behind it is
  `start()` — paste a URL, watch it run in this tab — because `start` upserts the
  created job and attaches the stream without ever calling `mergeJob`. **Gate 1
  found this line covered by no test at all**; it is now covered by exactly one,
  `app.test.tsx`'s `a job started in this tab, never refetched, gets its mark
from the frames alone`, and by nothing else in the repo.
- `mergeJob` folds the _reconciled remote_, before `reconcileJob` chooses. This
  is the race, below.

### On scope: five source files, not one

The Build section names `job-reducer.ts` and the tests beside it, and this branch
touches six source files. That is the ticket's own design, not drift:

| File          | Why the ticket cannot be done without it                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `status.ts`   | Build step 2: "`statusHighWaterMark` stays the single rule; what changes is that it is given a better-informed input" — a parameter |
| `useJobs.ts`  | Build step 1: the record "has to be threaded from `useJobs` down to `JobCard`" — this is where it is folded and held                |
| `JobList.tsx` | one of the two hops `streamState` already makes; the mark makes the same trip                                                       |
| `App.tsx`     | the other hop                                                                                                                       |
| `JobCard.tsx` | the reader — one call site, `statusHighWaterMark(job, watchedStep ?? 0)`                                                            |

The threading is the cost Build step 1 priced in when it preferred the truthful
record over bumping `attempts`, and it is not free: it is three new drop-points
for the very defect this ticket exists to fix. **That is why `app.test.tsx` is in
the diff.** Both new props are `T | undefined` and **required**, so a component
that forgets to pass one fails `npm run check` rather than rendering wrong.

No cleanups, no refactors, nothing unrelated. `contract/` is untouched.

### What the brief had wrong

- **Step 1's second candidate does not, on its own, make `reconcileJob` safe —
  and the brief's own step 3 half-notices.** Step 3 says "the mark is monotonic;
  merging two of them is a max, not a choice", which is written for a mark that
  lives _on_ the job. With a separate record `reconcileJob` cannot lose the mark,
  because the mark is not one of the two things it chooses between — so that
  acceptance line reads as vacuous. It is not. The max moved: `useJobs` folds the
  remote job into the mark **before** handing it to `reconcileJob`, so the
  copy that loses still contributes its `attempts`. That is the whole fix for the
  race, and dropping that one line reddens a test.
- **The reducer does not need to detect a _backwards_ move, and the design is
  better for not doing it.** The Build section's premise is that "a frame that
  moves the job to a lower position in `STATUS_ORDER` can only be the back-edge",
  so the reducer should recognise the edge. A running maximum over every state
  the client holds gets the same answer with no special case, no `failed`/
  `canceled` trap to dodge at the comparison site, and nothing to re-derive if a
  second back-edge is ever added. What the reducer contributes is not "I saw a
  backwards move" but "I saw this job at `downloading` once".
- **A consequence of that, recorded because it is a real weakness:** with the max
  formulation, `applyEvent`'s fold of the job _before_ the event is redundant in
  the shipped wiring, and no test kills it. Enumerated under the mutation table.
- **dl-18's Log does overclaim the refetch path, and the Why is right about
  why** — but the narrower truth is narrower still than "reconnects that race".
  The refetch path is _also_ fine whenever the client watched the download stage
  itself, because the mark then already holds it. The case where the refetch is
  the only witness is a client that was **disconnected through the entire
  download stage** — attached during the first probe, dropped, and reconnected
  after the back-edge, so the only frame it ever sees is the channel's opening
  `status: probing`. That is the scenario `app.test.tsx` drives, and it is the
  one where losing the race actually cost the user a correct card.
- **`fixtures.ts`'s `job()` builds the state the _server_ holds.** Every test
  dl-18 wrote mounts one, which is exactly why none of them caught this. The two
  new card tests build nothing: they fold the real frames onto a job the client
  already has, and assert `attempts` is still `1` at the point of render, so the
  premise cannot rot.

### The reconcile race: closed, not deferred

Build step 3 asked for a deliberate decision. It is **closed**, in `useJobs`'s
`mergeJob`, and asserted at the render level rather than only in a unit — the
reconnect that slept through the download stage, whose refetch knows
`attempts: 2` and _loses_ the merge, still renders "Downloading" done. No
follow-up ticket was filed and `dl-26` was not used.

### Deliberately not done

- **No cleanup of `watchedSteps` when a job is removed.** `streamStates` in the
  same hook has the identical shape and is not pruned either; both are one small
  number per job id this tab has seen. A pruner here would be code with nothing
  observable to assert against, which is how a mutation survivor gets born.
- **No `attempts` on the wire.** That is the contract change the Build section
  names as the better answer, and it needs the owner decision dl-9 records
  needing. If it is ever taken, `reachedStep`'s `attempts` clause becomes the
  only witness needed and `markWatched` can go.

### Verification

**Measured after rebasing onto `848af10`**, which is the merge-base this branch
lands from. The earlier figures in this Log's history were taken against
`4e3c48e` and no longer describe anything; they are not carried across.

| Command                                                    | Baseline `848af10` | Branch tip      |
| ---------------------------------------------------------- | ------------------ | --------------- |
| `npm run check`                                            | —                  | **exit 0**      |
| `npm test -- --project downloader`                         | 49 files / 694     | 49 files / 710  |
| `npm test`                                                 | 102 files / 1,470  | 102 / **1,486** |
| `npx vitest run tools/downloader/web --project downloader` | —                  | 16 files / 191  |

Both baselines measured by checking `848af10` out in this worktree and running
the same commands, not inferred. **+16 tests, no file added and none removed** —
the sixteen are the ones this branch writes, and every existing suite is
untouched. Gate 2 predicted the file counts would hold at 48 / 101; they did not,
because `8dc9cd4` adds a suite of its own. What holds is the thing that matters —
_this branch_ adds no file, so the counts move by exactly the tests it wrote.

**Neither gate proves the browser.** `e2e/download.spec.ts` and the container
build live in `.github/workflows/downloader.yml` and run nowhere else. This
branch is `web` only and changes what the bundle contains, so the e2e suite is
the proof I do not have.

### Mutation checks

Seventeen, each applied and reverted after, with the file `touch`ed on restore.
Sixteen mutate the source; **row 16 mutates a test** — `job-card.test.tsx`'s own
`watch()` helper — because what it probes is whether that helper's fold is
load-bearing, which is a fact about the test and not about the product. Command
throughout:
`npx vitest run tools/downloader/web --project downloader` — **16 files, 191
tests**. **Control run over the unmutated tree first: exit 0, nothing failed.**

| Mutation                                                     | Red      |
| ------------------------------------------------------------ | -------- |
| `statusHighWaterMark` ignores `watched`                      | 7        |
| `statusHighWaterMark` returns `watched` instead of maxing    | 7        |
| `reachedStep` places `failed`/`canceled` instead of refusing | 2        |
| `reachedStep` drops the `attempts > 1` witness               | 5        |
| `reachedStep` treats a first probe as a re-probe (`>= 1`)    | 7        |
| `reachedStep` infers about every status, not only `probing`  | 1        |
| `markWatched` folds nothing                                  | 7        |
| `markWatched` is last-wins instead of monotonic              | 5        |
| `markWatched` places every job, pipeline step or not         | 3        |
| **`useJobs`: `applyEvent` folds nothing**                    | **1**    |
| `useJobs`: `applyEvent` drops only the `before` argument     | survives |
| `useJobs`: `mergeJob` stops folding the reconciled remote    | 1        |
| `useJobs`: a job's mark starts at the last step instead of 0 | 3        |
| `JobCard` ignores the mark it is handed                      | 5        |
| `JobList` never hands a card its mark                        | 4        |
| `job-card.test.tsx`'s `watch()` folds nothing per frame      | 1        |
| `markWatched` null-guard rewrite                             | survives |

**The bolded row is the one gate 1 caught me not running**, and it is the one
that matters: it is dl-20's entire live-stream mechanism. My first table ran only
its strictly weaker sibling — the row below it — and I reasoned from that
sibling's survival instead of testing the real thing. Confirmed before fixing:
with `applyEvent`'s `watch` call replaced by a no-op, the tree as I first
committed it ran **16 files / 190 tests green** and `--project downloader` ran
**48 files / 675 tests green**. Nothing in the repo noticed.

Two mutations survive, and they are different in kind:

- **`applyEvent` drops only the `before` argument** — genuine, benign, and
  unchanged from the first round. Every route by which a job reaches
  `downloading` in this client already folds that state some other way: an event
  that lands on `downloading` folds it as the after-state; `restore` reconciles
  before it attaches (`useJobs.ts`), so a job restored from `localStorage` is
  folded by `mergeJob` before any frame can arrive; and `createJob` returns a
  `queued` job (`api/src/db/job-store.ts:186` — an earlier draft cited
  `api/src/routes/jobs.ts:57`, which is the `options,` line of the `store.create`
  call and proves nothing). The argument is kept anyway: it makes `applyEvent`
  self-sufficient instead of correct-because-`restore`-happens-to-reconcile-
  first, and that ordering invariant lives in a different function and is
  enforced by nothing. It is unkillable code and this is the reason, not an
  oversight.
- **`markWatched`'s null guard rewritten** as
  `if (step === null || step > mark) mark = step ?? mark;` — a **provably
  equivalent mutant**: the assignment is a no-op on the `null` branch. Gate 1
  confirmed the truth table independently. The behaviour it was meant to probe is
  covered by the two `markWatched` rows above it, which both go red.

### Gate 1 — what it caught, in my own words

The verdict was FAIL on the proof, not the code, and it was right. Three claims
on this branch stated the opposite of what was true, all one root:

1. **`app.test.tsx`'s first live test did not prove what its name said.**
   "with no refetch behind it", and a comment asserting that a single `getJob`
   call meant the mark "can only have come from the frames". `restore` calls
   `mergeJob` **before** `attach`, and `reachedStep` reads `attempts` only for
   `probing` — so a restored `downloading` job returns step 2 whatever its
   counter says. The one call I cited as ruling the refetch out **was** the
   refetch. Renamed, comment rewritten to say so, and the missing journey added
   as its own test.
2. **`job-card.test.tsx`'s `watch()` helper seeded the mark before the loop.**
   `markWatched(0, current)` reaches step 2 on its own for a `downloading` start
   job, so the frames were decoration; neutralising the per-frame fold left all
   191 green. The seed is gone — the helper now starts at `0` and raises only
   inside the loop, which is also what `useJobs` actually does — and the section
   header no longer claims "the render is a function of the wire".
3. **The Log said `applyEvent`'s fold was "the live path: the frames alone, no
   refetch".** True of the mechanism, false of the coverage.

**This is dl-18's failure shape one level up**, and I had already caught two
instances of it on this branch — which is the uncomfortable part: my own survivor
argument rests on the same two facts (`restore` reconciles before attaching;
`createJob` returns `queued`) that make the gap invisible, and I drew the
narrower conclusion from them. The habit that would have caught it is the one
this ticket is about: **mutate the line, do not reason about it.**
