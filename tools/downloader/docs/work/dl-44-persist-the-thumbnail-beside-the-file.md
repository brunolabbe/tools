---
id: dl-44
tool: downloader
title: Persist the thumbnail beside the file, so the preview outlives ten minutes
kind: work-package
status: done
milestone: null
depends_on: [dl-41]
difficulty: hard
---

# dl-44 — the preview the result panel shows is gone for 97% of the panel's life

## Why

dl-41 put the preview image inside the green result panel of a completed
download, and shipped it knowing the image is usually not there. This is the
half that was deliberately left out — split off rather than folded in, because it
reaches into storage and the retention sweep and dl-41 does not.

|                                              | lifetime                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| The downloaded file, and so the result panel | **6 hours** (`fileRetentionHours: 6`, `downloader/api/src/config.ts`)   |
| The thumbnail bytes the panel would show     | **10 minutes** (`THUMBNAIL_TTL_MS`, `downloader/api/src/thumbnails.ts`) |

`ThumbnailStore` is an in-memory `Map` with that TTL, a 400-entry cap that
evicts oldest-first, and no persistence — a restart empties it. So the feature
dl-41 shipped is present for the first ten minutes of a six-hour window and
absent for the other five hours fifty, which is when anyone who came back for
their file is looking.

**It is absent silently.** `Preview` returns `null` on a failed load rather than
leaving a broken-image glyph (`downloader/web/src/components/Preview.tsx`),
which is deliberate and correct — "no preview" is the common case, not the
exceptional one — and it means the panel simply has no image in it. Nothing is
logged, nothing looks wrong, and the next person to notice will file it as a
bug against dl-41 rather than find this ticket.

Meanwhile both sides remember the path forever: the API's SQLite schema has a
`thumbnail_path` column (`downloader/api/src/db/schema.ts`), and the web client
persists whole `Job` objects to `localStorage` including `thumbnailPath`
(`downloader/web/src/lib/job-store.ts`). The client faithfully holds a URL whose
bytes were dropped hours ago.

### Why not the one-constant version

Raising `THUMBNAIL_TTL_MS` to six hours was considered on dl-41 and rejected
there. The 400-entry cap and process restarts still lose the bytes, so it turns
"always gone after ten minutes" into "usually gone, unpredictably" — arguably
harder to diagnose than the honest version — and it grows an in-memory store
holding image bytes for six hours. If this ticket is dropped, that constant is
still not the answer.

## Decision — answered 2026-09-07, not open

**The question was:** once the thumbnail bytes persist to disk beside the file,
what happens to the ~400-entry in-memory `ThumbnailStore` — kept for the
probe-only case, or retired in favour of writing to disk at probe time as well?

**The answer, from the owner, relayed through the orchestrator: neither — the
call is the builder's, to be made at build time and recorded.** It did not take
the orchestrator's recommendation, which was to keep the store (option A); it
declined to settle the fork at all, so A stands as a standing recommendation
rather than as an instruction, and this is a builder's call rather than a
blocking owner decision. Recorded 2026-09-07; **nothing below has been built.**

**Whoever builds dl-44 must record which way they went and why, in the Log.**
That is the condition attached to the answer. Delegating the call is only
cheaper than settling it if the reasoning survives the branch.

The options as they were put, with the costs that came from reading the code —
the store is filled at probe time and read by token at
`api/src/routes/thumbnail.ts:53` "context.thumbnails.get", so it is what shows
a preview before any file exists (the coordinate moved when the build recorded
in the Log added the route's second source above it):

- **A. Keep it for the probe-only case — recommended, not chosen.** Disk
  persistence for completed jobs; the in-memory store stays as the pre-download
  preview path. Two sources for one field, each with a clear owner, and the
  retention sweep of step 3 only has to know about the disk one.
- **B. Retire it, and write to disk at probe time too.** One path for
  everything, which is the reason to want it. Its cost is the objection below.
- **C. Let the builder decide and record it — chosen.**

**Carry the cost with the answer**, or the next builder rediscovers the
objection from scratch: **a probe-only thumbnail has no downloaded file to be
swept alongside.** Step 3's sweep is keyed on the file's own retention, so
retiring the store (B) owes a retention rule of its own for probe-only bytes — a
new orphan class this ticket does not budget for. A builder who takes B owes
that rule; a builder who takes A does not, and that is the whole of the
difference between them.

## Build

A sketch, not a brief — the route is the work. What is fixed is the goal: the
image lives exactly as long as the thing it depicts.

1. Write the thumbnail bytes to the storage directory beside the downloaded
   file, at the point the job's file is finalised, so the two are one unit.
2. Serve them from a path that survives a restart. There are then two sources
   for one field — the in-memory token for a probe that has not downloaded
   anything yet, and the persisted file for a completed job — and **the
   preferred route keeps `thumbnailPath` meaning exactly what it means today**,
   an opaque path on this API, with the route deciding where the bytes come
   from. It is a contract field (`contract/src/job.ts`, `contract/src/api.ts`);
   if an implementation needs its meaning to change, stop and ask rather than
   editing it.
3. Sweep them with the file. The retention GC deletes the file at
   `fileRetentionHours`; the image has to go on the same pass, or it is a leak
   with no owner.
4. Decide what happens to the ~400-entry in-memory store afterwards — kept for
   the probe-only case, or retired. **Answered by the decision above, and
   answered as yours:** the owner delegated this call to whoever builds it, with
   A (keep it) as the standing recommendation and the probe-only retention
   objection attached to B. Left as written rather than rewritten into a new
   brief; record the route taken, and why, in the Log.

## Done when

- A completed job whose thumbnail is older than `THUMBNAIL_TTL_MS` still shows
  its preview in the result panel, proven by a test that advances past the TTL
  rather than by inspection.
- The image is gone when the file is, on the same retention sweep, with a test
  that asserts the bytes are actually unlinked.
- A restart does not lose the preview of a job whose file survived it.
- `npm run check` and `npm test -- --project downloader` pass.

## The gate on this decision record

**Gate: PASS** — 2026-09-07 · `origin/main...HEAD`, tip `e3d065e` · own defect hunt (docs-only diff; no `code-review` dispatch)

<!-- citations: evidence api/src/routes/thumbnail.ts:27 -->

The citation below is left at the coordinate this gate actually resolved, at tip `e3d065e`, and is declared as that gate's own evidence rather than repointed: rewriting it would make the record claim to have checked a line that did not exist when it ran. The build recorded in the Log moved that line down the file, to the coordinate the `## Decision` section above now names.

This diff records Build step 4's already-answered decision onto a `ready` ticket — no implementation exists, so no `Done when` line applies, and per `docs/01-TICKETS.md` ("A gate on a pull request that only files a ticket does not go in `## Review`") this record sits under its own heading rather than `## Review`, so `repo-12`'s board check does not read a `ready` ticket with a review record as merged-without-status-flip.

- The added `## Decision` section is consistent with the unedited Build section: step 4's added sentence restates the Decision section's own text (A recommended and standing, C chosen, B's orphan-retention cost attached) without contradicting it.
- Citation `api/src/routes/thumbnail.ts:27 "context.thumbnails.get"` verifies — `node scripts/citations.mjs` → `1 verified, 0 moved, 0 unanchored, 0 unresolvable, 0 unchecked, 0 evidence`.
- `status: ready`, `depends_on: [dl-41]` untouched; `npm run status -- --json` exits 0, `"status": "ready"`, `"reviewed": false`, `"problems": []`.
- No `## Review` heading present.
- `npm run check` exits 0; `npx oxfmt --check` reports correct formatting.
- findings: own hunt (docs-only, no code-review dispatch — out of scope per gate brief) returned 0.
- NFR: security n/a · performance n/a · reliability n/a · maintainability ✓ — the added text names its own condition ("Recorded, not built") so a future reader cannot mistake this for implemented work.

## Log

- **2026-09-05 — filed** from dl-41, which is option C of its second decision
  and is quoted there as "out of scope here. File it, do not fold it in." The
  owner answered that decision as A, accept the ten minutes, so dl-41 ships the
  panel and this carries the part that makes it work. The reason it is a ticket
  rather than a fold-in is the reach, not the size: persisting the bytes touches
  storage layout, the file-serving route and the retention sweep, none of which
  dl-41 goes near, and step 2 puts a contract field in reach of the answer.
- **2026-09-07 — Build step 4 was answered, and answered as the builder's
  call.** The owner was asked whether the in-memory `ThumbnailStore` is kept for
  the probe-only case or retired, and chose to delegate rather than settle it;
  the orchestrator's recommendation was to keep it, and that recommendation was
  not taken as an instruction. The section above is now
  `## Decision — answered 2026-09-07, not open` and step 4 is marked as settled
  by it. The objection that travels with the answer is recorded there: retiring
  the store leaves probe-only thumbnails with no file to be swept alongside, so
  that route owes a retention rule this ticket does not budget for.

  **Recorded, not built.** Nothing in `src` was touched and `status` stays
  `ready`. This is a brief whose last open question is closed — closed by being
  handed to the builder with its cost attached, not by being answered one way.

- **2026-09-07 — built.** Branch `dl-44-persist-thumbnail`, off `origin/main` at
  `e9054c5`.

  **Build step 4, the delegated call: A — the in-memory store is kept.** The
  reason is the objection the Decision section attaches to B, met head on rather
  than reasoned around: `POST /api/probe` mints a token for a probe that has no
  job, and a probe that never becomes one has no `out/<jobId>/` to keep a copy
  beside. Taking B would have meant inventing an expiry for those bytes — a
  second retention rule, with its own sweep, for a class of file nothing else in
  this service owns. A costs one branch in one route and needs no such rule at
  all, because `out/<jobId>/` is already swept at `fileRetentionHours`. That
  asymmetry is the whole of the difference, exactly as the section said it was.
  The kept store is now covered as its own case, not just as a leftover:
  [`pipeline.test.ts`](../../api/test/pipeline.test.ts) "a probe that never
  became a job keeps only its ten minutes" asserts the ten minutes still expire
  **and** that nothing was written under `out/` for it.

  **The route decides, the field does not move.** Step 2's preferred route was
  taken literally: `thumbnailPath` still means `/api/thumbnail/<token>` and
  nothing else, the token is the _same_ one the in-memory store minted, and
  `/api/thumbnail/:token` tries memory first and the recorded file second. So a
  `localStorage` record written before this branch keeps working, and the
  contract was not touched — no edit to `contract/src/job.ts`, `api.ts` or
  `media.ts`.

  **What the brief could not have known, and it is the trap in step 1.** "Write
  the bytes at the point the job's file is finalised" reads as though the bytes
  are in hand there. They are not: the capture happens during `probing`, and a
  download can easily outlast `THUMBNAIL_TTL_MS`, so reading them back out of
  the store at completion would have dropped the preview of exactly the long
  downloads most worth keeping one for. `captureThumbnail` therefore returns the
  bytes as well as the path (`CapturedThumbnail`), and the orchestrator carries
  them across the download in a local. The cost is bounded and small: at most
  `MAX_THUMBNAIL_BYTES` (512 KB) per running job, and `maxConcurrentJobs`
  defaults to 2 and caps at 64.

  **Where the bytes go, and why that is the whole retention rule.**
  `out/<jobId>/preview.<ext>`, through the engine's own `Storage.outPath` so the
  path is sanitised and confined by the same code the media file uses. Both
  sweep paths already delete that directory — `Storage.removeJob`, which the
  API calls for a lapsed token, and `Storage.collectGarbage`, which removes an
  out dir by age — so step 3 needed no new deletion logic, only the row cleanup
  beside `markSwept`. The stem cannot collide with the media file: that name
  always ends in a container extension and none of `.jpg/.png/.webp/.gif` is
  one.

  **Verified by mutation, not by reading.** Each of the four new tests was made
  to fail on purpose: removing the persist call turns the TTL, sweep and restart
  tests red; removing the route's disk fallback turns the TTL and restart tests
  red; writing the bytes into `tmp/` instead of `out/` turns the sweep's unlink
  assertion red, which is what stops that test being a tautology; and dropping
  the row cleanup turns the sweep test red on its own. The first attempt at that
  last one silently mutated nothing — the `sed` pattern still carried the old
  indentation — and was rerun rather than reported.

  **Folded in, because this made it free:** the retention sweep had no test at
  all. It lived inside `startRetentionSweep` reachable only through a
  `setInterval`, and nothing in the suite drove it (`startGc: false` in every
  harness). One pass is now `runRetentionSweep(context)`, exported, and the
  timer calls it — which is what let this ticket assert its own Done-when about
  unlinked bytes, and leaves the sweep testable for whoever needs it next.

  **Not done, deliberately.** No rate limit was added to `/api/thumbnail`. Its
  cost profile did change — a miss can now reach SQLite and read up to 512 KB
  off disk, where before it was a `Map` lookup — so a caller holding one valid
  token can cause a repeated small read. It is mitigated but not closed: the
  token is rejected on _shape_ before the database is touched, so scanning still
  costs what a 404 costs. Whether to key a limiter on the token the way
  `files.ts` does is an open decision and was put to the orchestrator rather
  than settled here, because it is adjacent to dl-46, which is held and will add
  a rate-limit knob to `api/src/config.ts`. That file is **not** edited by this
  branch.

  Also not done: no e2e assertion. `e2e/sniffer/mse-page.spec.ts` covers the
  same `/api/thumbnail/` path for the probe panel, and the e2e suites were not
  run on this branch.
