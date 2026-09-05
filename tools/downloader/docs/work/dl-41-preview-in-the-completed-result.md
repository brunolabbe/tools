---
id: dl-41
tool: downloader
title: Show the preview image in a completed download's result panel
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-41 — a preview in the green panel, which outlives the preview by a factor of 36

**Packages:** `web` (`components/JobCard.tsx`, `components/Preview.tsx`,
`styles.css`). `api` only if the retention decision below goes that way — see the
scope boundary.

## Why

Asked for: show the preview thumbnail inside the green section of each completed
download. That section is `CompletedResult`
([`JobCard.tsx:177`](../../web/src/components/JobCard.tsx)), rendering
`<div className="result">` ([`:197`](../../web/src/components/JobCard.tsx)) — the
green comes from `border: 1px solid var(--ok)` and a 10%-tinted background at
[`styles.css:621`](../../web/src/styles.css). It carries the filename, the size,
the container, the duration, the download button and the expiry countdown, and no
image.

The change is small. Two things around it are not, and both are why this is a
ticket rather than a one-line fold-in.

### The preview is already on the card, so this adds a second copy

[`JobCard.tsx:69`](../../web/src/components/JobCard.tsx) already renders
`<Preview path={job.thumbnailPath} size="card" />` in `job__head`, for every
status including `completed`. Putting one in the result panel means the same
image twice in one card, a few hundred pixels apart. **That is a design call, not
an implementation detail** — see the decision below.

### The thumbnail dies long before the panel does

This is the part that decides whether the feature works at all.

|                                             | lifetime                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| The downloaded file, and so the green panel | **6 hours** (`fileRetentionHours: 6`, [`downloader/api/src/config.ts:192`](../../api/src/config.ts)) |
| The thumbnail bytes the panel would show    | **10 minutes** (`THUMBNAIL_TTL_MS`, [`thumbnails.ts:91`](../../api/src/thumbnails.ts))               |

`ThumbnailStore` is an in-memory `Map` ([`thumbnails.ts:124`](../../api/src/thumbnails.ts))
with a 10-minute TTL, a 400-entry cap that evicts oldest-first
([`:145-150`](../../api/src/thumbnails.ts)), and no persistence — a restart empties
it.

Meanwhile **both** sides remember the path forever: the API's SQLite schema has a
`thumbnail_path` column ([`downloader/api/src/db/schema.ts:71`](../../api/src/db/schema.ts)), and the
web client persists whole `Job` objects, `thumbnailPath` included, to
`localStorage` ([`lib/job-store.ts`](../../web/src/lib/job-store.ts)). So the
client faithfully holds a URL whose bytes were dropped hours ago.

**The green panel is precisely the long-lived, come-back-later part of the UI** —
it exists so you can fetch the file later — and it is the one place a 10-minute
image is least useful. The feature as asked would work for the first ten minutes
of a six-hour window.

It will not _look_ broken: `Preview` returns `null` on a failed load rather than
leaving a broken-image glyph ([`Preview.tsx:39`](../../web/src/components/Preview.tsx)),
which is deliberate and correct. It will simply be absent almost always, which is
a worse failure to diagnose than a visible one.

## The open decision

**Two questions, and the second one governs.**

**1. One image or two?**

- **A. Move it (recommended).** The preview leaves `job__head` for the result
  panel once a job is `completed`, so a finished card shows it once, next to the
  thing it now labels. Active jobs keep it in the head exactly as today.
- **B. Two copies.** Simplest diff, and the head image keeps the card
  identifiable while it scrolls. Reads as a duplication bug to anyone who did not
  ask for it.

**2. How long should the image live?** The recommendation is to pick **one of the
first two and file the third**, so the UI work is not blocked behind storage
work.

- **A. Accept the 10 minutes (recommended for this ticket).** Ship the panel;
  `Preview` already vanishes cleanly. Honest, tiny, and gives an image for the
  common case of watching a download finish. Document the window in the Log so
  the next person does not report it as a bug.
- **B. Raise `THUMBNAIL_TTL_MS` to match `fileRetentionHours`.** One constant.
  But the 400-entry cap and process restarts still lose it, so it converts
  "always gone after 10 minutes" into "usually gone, unpredictably" — arguably
  worse to diagnose — and it grows a memory store holding image bytes for six
  hours.
- **C. Persist the thumbnail beside the file**, so it lives exactly as long as
  what it depicts. The only option that actually makes the panel work, and the
  largest: it reaches into storage and the retention sweep. **Out of scope here.
  File it, do not fold it in.**

## Build

1. Take decision 1, and put `Preview` in `CompletedResult`.
2. **Mind the layout.** `.result` is `display: flex` with
   `justify-content: space-between` ([`styles.css:621`](../../web/src/styles.css)),
   holding `result__meta` and `result__actions`. A bare third child lands between
   them and pushes the filename into the middle of the row. This exact trap is
   already documented twice in this codebase — the grouping comments at
   [`ProbePanel.tsx:57-61`](../../web/src/components/ProbePanel.tsx) and
   [`JobCard.tsx:65-67`](../../web/src/components/JobCard.tsx) — so group the
   image with `result__meta` rather than adding a sibling.
3. `Preview` takes `size: "panel" | "card"` ([`Preview.tsx:12`](../../web/src/components/Preview.tsx)).
   Reuse `card` if it fits; add a third size only if it genuinely does not, and
   keep the fixed aspect ratio — the frame is reserved before the bytes arrive
   specifically so the panel does not reflow when the image lands or never does.
4. Whatever decision 2 yields, record the resulting window in the Log.

## Done when

- A completed job with a live `thumbnailPath` shows the preview inside the green
  result panel.
- A completed job with **no** `thumbnailPath` renders the panel exactly as it does
  today — no gap, no reserved empty box, no layout shift. This is the case that
  matters: plenty of pages have no `og:image`, and it is the default for every
  job created before dl-29.
- A component test covers the filename still sitting at the left edge of the
  panel with the image present, so the `space-between` trap cannot regress
  silently.
- If decision 1 was "move", an active job still shows the preview in the head.
- `npm run check` and `npm test -- --project downloader` pass.

## Log

- **2026-09-05 — filed.** Asked for as adding the preview to the green section of
  each download. The request is a small change; what earns it a ticket is that
  the thumbnail's bytes live 10 minutes and the panel lives 6 hours, so the
  obvious implementation produces a feature that is absent almost whenever anyone
  looks — and absent _silently_, because `Preview` degrades to nothing by design.
  The duplicate-image question was found in the same pass: the card head already
  renders this exact image for every status.

- **2026-09-05 — built.** Both decisions were put to the owner and both came back
  as this page's own recommendation, so nothing below overrides the brief.

  **Decision 1 — A, move it.** The preview leaves `job__head` for the result
  panel once a job is `completed`; every other status keeps it in the head
  exactly as before. `JobCard` decides once, in `previewInResult`, using the same
  expression the `CompletedResult` render is guarded by — so the image is in one
  place or the other, never in both and never in neither. **One case the brief
  does not mention:** a completed job whose file has expired renders `ErrorPanel`
  instead of the panel, and so now shows no preview at all. That is unobservable
  in production — an expired file is at least six hours old and the thumbnail
  bytes live ten minutes — and it is noted at the branch rather than worked
  around.

  **Decision 2 — A, accept the ten minutes. The window, recorded as step 4 asks:
  the preview is present for the first 10 minutes of the result panel's 6-hour
  life and absent for the remaining 5 h 50 m, about 97% of it — and absent
  silently, because `Preview` renders `null` on a failed load by design.** That
  is this ticket's chosen behaviour and not a defect to report against it.
  Option C, persisting the bytes beside the file, is filed as
  [dl-44](./dl-44-persist-the-thumbnail-beside-the-file.md) and was not folded
  in: it reaches into storage layout, the file-serving route and the retention
  sweep, none of which this change goes near.

  **The layout trap was real and the brief was right about it.** `.result` is
  `display: flex` with `justify-content: space-between` over two children, so the
  preview is grouped into a new `result__headline` wrapper alongside
  `result__meta` rather than added as a third child. Verified by mutation rather
  than by reading: restoring the trap — the preview as a bare child of `.result`,
  with the head's copy left in place — turns
  [`job-card.test.tsx:781`](../../web/test/job-card.test.tsx) "a completed job
  shows its preview" and
  [`job-card.test.tsx:795`](../../web/test/job-card.test.tsx) "the filename keeps
  the left" red; a `.preview` frame reserved for a job with _no_ thumbnail turns
  [`job-card.test.tsx:811`](../../web/test/job-card.test.tsx) "a completed job
  with no preview" red as well. jsdom computes no layout, so all three assert the
  structure the trap is about rather than measured geometry, and the tests say so.

  `size="card"` was reused unchanged — no third size, and the fixed 16:9 frame is
  untouched. The CSS is one selector added to the existing
  `.card__headline, .job__headline` rule, whose comment already stated the
  invariant this needed.

  **What the brief had wrong: one citation — and the first version of this entry
  said it had none, which was the worse error.** The retention constant was cited
  one screen off: the line the brief named holds `host: "127.0.0.1"`, and
  `fileRetentionHours: 6` is at
  [`downloader/api/src/config.ts:192`](../../api/src/config.ts). That one was
  never right. Six further citations were right at filing and were moved by this
  branch's own commit — the shared CSS rule gained a line and `JobCard` gained
  six, so the head `Preview`, `CompletedResult`, the `.result` element, the
  grouping comment and both `.result` style references all slid down. All seven
  are repointed in the sections above; the superseded numbers are deliberately
  not written here in `file:line` form, because `citations.mjs` would resolve
  them against today's tree and a note about stale coordinates would become six
  more of them.

  **How the first version got it wrong is the part worth keeping.** It rested on
  `node scripts/citations.mjs`, which reported `0 moved, 0 unresolvable` — read
  as "every citation checks out". It is not: all of them were **unanchored**, so
  the script had compared coordinates and not claims, and it says exactly that in
  the two lines under its own count. A stale citation pointing at plausible
  unrelated code resolves clean, which is the failure its docblock opens with.
  The gate reviewer surfaced it by reading the constant itself and quoting the
  right line without remarking on the difference. Cheap lesson: read the state
  column, not the total.

  The citation that _is_ right while looking wrong is
  [`Preview.tsx:39`](../../web/src/components/Preview.tsx) — it reads as an
  absent-path guard, but `failed` is the last term of that same condition, so it
  is the failed-load return as well.

  Not done, deliberately: no e2e assertion that the panel's image renders under
  the CSP. `e2e/sniffer/mse-page.spec.ts` already proves exactly that for the
  probe panel's copy of the same component on the same `/api/thumbnail/` path,
  and the e2e suites were not run on this branch.
