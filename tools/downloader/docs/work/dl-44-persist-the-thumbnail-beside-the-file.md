---
id: dl-44
tool: downloader
title: Persist the thumbnail beside the file, so the preview outlives ten minutes
kind: work-package
status: ready
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
`api/src/routes/thumbnail.ts:27` "context.thumbnails.get", so it is what shows
a preview before any file exists:

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
