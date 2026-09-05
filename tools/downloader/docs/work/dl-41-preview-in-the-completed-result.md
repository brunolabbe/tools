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
([`JobCard.tsx:171`](../../web/src/components/JobCard.tsx)), rendering
`<div className="result">` ([`:185`](../../web/src/components/JobCard.tsx)) — the
green comes from `border: 1px solid var(--ok)` and a 10%-tinted background at
[`styles.css:620`](../../web/src/styles.css). It carries the filename, the size,
the container, the duration, the download button and the expiry countdown, and no
image.

The change is small. Two things around it are not, and both are why this is a
ticket rather than a one-line fold-in.

### The preview is already on the card, so this adds a second copy

[`JobCard.tsx:63`](../../web/src/components/JobCard.tsx) already renders
`<Preview path={job.thumbnailPath} size="card" />` in `job__head`, for every
status including `completed`. Putting one in the result panel means the same
image twice in one card, a few hundred pixels apart. **That is a design call, not
an implementation detail** — see the decision below.

### The thumbnail dies long before the panel does

This is the part that decides whether the feature works at all.

|                                             | lifetime                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| The downloaded file, and so the green panel | **6 hours** (`fileRetentionHours: 6`, [`config.ts:182`](../../api/src/config.ts))      |
| The thumbnail bytes the panel would show    | **10 minutes** (`THUMBNAIL_TTL_MS`, [`thumbnails.ts:91`](../../api/src/thumbnails.ts)) |

`ThumbnailStore` is an in-memory `Map` ([`thumbnails.ts:124`](../../api/src/thumbnails.ts))
with a 10-minute TTL, a 400-entry cap that evicts oldest-first
([`:145-150`](../../api/src/thumbnails.ts)), and no persistence — a restart empties
it.

Meanwhile **both** sides remember the path forever: the API's SQLite schema has a
`thumbnail_path` column ([`db/schema.ts:71`](../../api/src/db/schema.ts)), and the
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
   `justify-content: space-between` ([`styles.css:620`](../../web/src/styles.css)),
   holding `result__meta` and `result__actions`. A bare third child lands between
   them and pushes the filename into the middle of the row. This exact trap is
   already documented twice in this codebase — the grouping comments at
   [`ProbePanel.tsx:57-61`](../../web/src/components/ProbePanel.tsx) and
   [`JobCard.tsx:59-61`](../../web/src/components/JobCard.tsx) — so group the
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
