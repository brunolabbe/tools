---
id: dl-62
tool: downloader
title: A null that yt-dlp reports passes the probe and fails every job at its first read back
kind: fix
status: in-flight
milestone: null
depends_on: []
difficulty: standard
---

# dl-62 — a `null` from yt-dlp reaches a stored variant

**Packages:** `resolvers` (`common.ts`, `resolvers/ytdlp.ts`).

## Why

Reported by the owner on 2026-09-15: a page failed to download. The page is
deliberately not named anywhere, at the owner's request, and the fixture below
has its host, id, title and every URL rewritten.

The probe succeeded, offering 14 progressive renditions from 240p to 2160p. The
job failed two seconds after it was accepted:

```
INTERNAL — A stored job could not be read.
issues: [{ path: ["variant", "fps"], expected: "number", received: null }]
```

yt-dlp's site-specific extractor for that page reports `fps` as JSON `null` on
every format, together with `tbr`, `vbr`, `abr` and `filesize_approx`.
`YtDlpFormat` declared `fps?: number`, and `optional()` in `common.ts` dropped
only `undefined`, so `fps: null` went into the variant. Nothing on the probe path
validates a variant against `mediaVariantSchema`, but `rowToJob` in
`api/src/db/job-store.ts` does, through `jobSchema`. So the first read-back of
the job threw.

It is the same shape as dl-37's `null` codec, one field over. dl-37's rule was
to widen a field's type only after it is measured null. That keeps the type
honest, but it cannot protect the next field nobody has measured yet.

The same pages show a second, smaller fault. The extractor names no `acodec`,
so the mapper wrote `hasAudio: false`, and the picker said "no audio" about
files that do carry AAC (checked with ffprobe). dl-42 already settled that
audio nobody checked is `undefined`, not `false`.

## Build

The owner chose to guard every field the mapper copies rather than only `fps`,
and to fix the audio claim in the same change.

1. `optional()` drops `null` as well as `undefined`. Every field it builds is
   optional and never nullable in the contract, so this is safe for the HLS,
   DASH and direct callers too.
2. `YtDlpFormat.fps` becomes `number | null`, recorded in the measured list
   with the shape it was seen in.
3. Values the mapper reads outside `optional()` get a guard: the label's
   height, width and fps through `reportedNumber`, header values through
   `stringValues`, and a subtitle's `url` through a `typeof` check.
4. `hasAudio` has three states: `true` when a codec is known (its own or a
   paired one), `false` only when yt-dlp says `"none"`, and absent otherwise.

## Done when

1. Captured output with `fps: null` maps to variants that each pass
   `mediaVariantSchema`, and a probe that passes `probeResultSchema`.
2. A `null` fps is absent from the variant and does not change its label.
3. A format that names no audio codec has no `hasAudio`; `"none"` still maps to
   `false`.
4. A `null` in any field the mapper copies, including unmeasured ones, still
   maps to a valid probe.
5. `optional()` drops `null` and keeps `0`, `""` and `false`.
6. With the fix reverted, the tests for 1, 3, 4 and 5 fail.
7. A real job against the reported page completes with both video and audio.
8. `npm run check` and the downloader suite pass.

## Log

**Reproduction, 2026-09-15.** Ran the API from a worktree on `main@95c6403`
with local storage and every tier enabled.

- yt-dlp 2025.09.26 on its own extracted the page cleanly.
- Every rendition URL answered a range request with `206 video/mp4`, with or
  without the extractor's headers, so headers were never the problem.
- `POST /api/probe` returned 14 variants in about 2 s.
- `POST /api/jobs` went `probing` → `failed` with the error above.
- Coercing `fps` alone made the same job complete: a 30.6 MB MP4 holding H.264
  video and AAC audio. The audio survived `hasAudio: false` only because a
  progressive file is copied whole; the picker's label was still wrong.

The first attempt to prove the patch measured nothing. The API imports
`@downloader/resolvers` through its package exports, which point at `dist/`,
so an edit to `src/` changes nothing until `npm run build`. `api/package.json`
warns about this; it cost one restart.

`extractor-null-fps.json` was written directly from yt-dlp's output. It keeps
only the declared fields, rewrites the id, title, host and URLs, and was checked
for no trace of the original page before it was saved. The raw capture was
never written to disk.
