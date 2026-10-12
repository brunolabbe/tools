---
id: dl-114
tool: downloader
title: Three pure rules are tested only by driving Chromium or ffmpeg, because none of them is exported
kind: chore
status: ready
milestone: null
depends_on: [dl-112, dl-113]
difficulty: standard
---

# dl-114 — Pure rules the browser tests reach through Chromium

## Why

This is part of the 2026-10-12 suite-speed audit. The background is in
[dl-111](./dl-111-browser-fixtures-that-never-read-a-fetched-body-stall-each-probe-3s.md).

Three pure decisions are tested row by row through a full probe or a real
download, because each one is module-private. Each row costs 3 to 12 s to prove
what a table test proves in microseconds. **The owner allowed source changes for
testability on 2026-10-12**, provided production behaviour is unchanged.

## Build

1. **`sameDocument`** (`resolvers/src/resolvers/browser.ts:746`).
   - Export it, or move it to a module of its own if exporting it from
     `browser.ts` would widen the package's public API. Check that the package's
     `index.ts` does not re-export it.
   - Table-test it: `?t=`, `?start=`, `?autoplay=`, a reordered query, another
     key, and a fragment.
   - Then delete these browser-resolver rows: 446 `[start]` and 446
     `[autoplay]`, 457 ("other key departs") and 468 (reordered query).
   - Keep 446 `[t]` and 336 as the browser-level proof of the wiring.
2. **The play-press attribute rule** (`resolvers/src/browser/provoke.ts`,
   `startsWord` at 848 and `isPlayPress` at 866).
   - `isPlayPress` takes a `Locator`. Extract the attribute decision as a pure
     function over the attribute values it reads, and have `isPlayPress` call
     it. Table-test the extracted function.
   - Then delete these rows:
     - 2252: the five controls that do not count, other than `autoplay`;
     - 2280: the five controls that count, other than `jw`, `watch` and `xo` —
       `watch` takes the label path and `xo` is in a frame, so neither reaches
       this rule;
     - 2323: camel-testid and camel-title (the camel-case branch at about
       `provoke.ts:853`).
   - The 2323 label row is already deleted by dl-113 if it acted on it. If not,
     it is a duplicate of 2093's 3000 ms row.
3. **`Meter`** (`engine/src/download/parallel-ranges.ts:225`). Every method
   takes `now` as an argument, so it is pure. It is not exported.
   - Export it, and unit-test the pause and release arithmetic that the F9 tests
     now prove in real time. Those tests are 5.2, 5.5 and 12.5 s:
     `sleep(4_000)` at about line 1314, an 8 s pause at about 1411, and
     `sleep(12_000)` at about 1415 of `engine/test/parallel-ranges.test.ts`.
   - Keep one integration test, scaled down: `measureMs` from 4000 to about
     1000, pause from 8 s to about 2 s, sleep from 12 s to about 3 s. Read
     dl-106 first: its Windows timer-tick findings govern how far it can shrink.
   - Read dl-120 too: the loopback limits the shrink as well. When a test's
     reader stops, the kernel's socket buffers take 5.2 to 9.2 MB (measured on
     Linux) before the feeder pauses the origin, and all of it is measured
     origin time. A window shorter than that fill closes before the pause it is
     meant to contain. Keep the origin's rate × `measureMs` well above about
     10 MB, or the test stops proving the pause. At 4 MB/s, `measureMs` 1000
     closes the window after 4 MB.

## Done when

1. Each extracted rule has a table test covering every row deleted for it, so
   each deleted row maps to one table entry. The mapping is in the Log.
2. Production behaviour is unchanged: the resolver and engine suites pass
   untouched apart from the deleted rows, and no caller changes.
3. Nothing is exported from a package's `index.ts` that was not before, unless
   the Log says why.
4. Before and after durations for browser-resolver and parallel-ranges are in
   the Log.

## Log

- 2026-10-12 — Filed from the suite-speed audit. The estimate is about 25 s
  from `sameDocument`, about 33 s from the play-press rule, and about 15 to 18 s
  from `Meter` (inferred).
