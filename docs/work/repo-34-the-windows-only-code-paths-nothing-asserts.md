---
id: repo-34
tool: repo
title: Three Windows-only code paths that no assertion covers, and one of them is a security control
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-34 — The Windows-only paths nothing asserts

## Why

Filed out of [repo-31](./repo-31-the-windows-leg-is-almost-all-red.md)'s `Done
when` 4, which asked for the coverage gap its measurement 4 surfaced to be fixed
or filed rather than left as a paragraph. **The gap that ticket named does not
exist**; three narrower ones do, and they are what this ticket carries. The
correction is recorded in repo-31's Log and repeated here in short, because a
reader who arrives via this page should not have to take the premise on trust.

repo-31's measurement 4 said `killProcessTree`'s Windows branch "is exercised by
no test, on any platform, including `windows-latest` itself", having read
`tools/downloader/engine/test/ffmpeg-runner.test.ts` and found no kill, abort or
cancel case there. That file indeed has none. The test is in a different file:
`tools/downloader/engine/test/hls-e2e.test.ts`'s "cancelling kills the process
tree and leaves no artifacts", which `.github/workflows/ci.yml` has named in its
own comment as the reason the matrix exists all along.

Measured rather than argued, on this branch: `killProcessTree` was temporarily
instrumented to append its `pid` and `process.platform` to a file, and
`npx vitest run tools/downloader/engine/test/hls-e2e.test.ts -t "cancelling
kills the process tree"` was run. One line came back — `killProcessTree 26858
linux` — from a test that passed. The instrumentation was reverted; nothing of
it is in this branch. So the call really is reached from a real abort of a real
ffmpeg, and on `windows-latest` the same call takes `IS_WINDOWS` into
`killTreeWindows`, spawns the real `taskkill.exe`, and the two `fs.stat`
rejections that follow are the `EBUSY`-avoidance proof `kill.ts`'s docblock
argues the file's existence from.

What is left is smaller and real.

### 1. `taskkillPath` — a search-order control with no assertion

`tools/downloader/engine/src/ffmpeg/kill.ts` resolves `taskkill.exe`'s absolute
path from `SystemRoot`, falling back to `windir` and then to `C:\Windows`. Its
docblock says why in security terms: resolving it rather than trusting `PATH`
"removes a search-order hijack: PATH is inherited from whatever launched the
service." **No test asserts what it returns**, on any platform, and it takes its
`env` as a parameter specifically so one could — `grep -rn taskkillPath` over
`tools` and `packages` finds it in `kill.ts` only.

It is not wholly unexercised: the cancellation test above runs it for real on
`windows-latest`. But that test can only fail on the _consequence_ — the
`fs.stat` assertions — and `killTreeWindows` resolves quietly on a spawn error
after a `logger.warn`, so a wrong path degrades to "the tree was not killed"
rather than to a named failure. A control whose test is three layers away and
whose failure mode is a warning is the definition of a gap worth one direct
assertion.

This one is free of decisions: the function is pure, the `env` is injectable,
and the three branches are three `expect`s.

### 2. `findExecutable`'s `PATHEXT` branch — untested, and not testable today

`tools/downloader/resolvers/src/resolvers/ytdlp.ts` reads `process.platform` and
`process.env` directly rather than accepting them, so its Windows extension
search cannot be driven from a Linux test at all. Unlike `taskkillPath` this is
not free: making it testable is a small refactor of a function that runs on
every resolve, which is why it is in this ticket rather than folded into
repo-31's branch.

### 3. `assertPathInside` is OS-bound by an import, not by necessity

`tools/downloader/engine/src/storage.ts` imports `node:path`, which _is_
`path.win32` in a Windows process and `path.posix` everywhere else.
`tools/downloader/engine/test/storage.test.ts` already branches its fixture on
`process.platform`, so the assertion is correct either way it runs — but it only
_proves_ the Windows behaviour when the process is a Windows one. Node ships
`path.win32` for exactly this, and the function could accept an injectable path
module the way `taskkillPath` already accepts an injectable `env`.

**Why this matters more than it did last week:** repo-31's answer made the
`windows-latest` leg informational. Every path above whose only proof is "it runs
on the Windows runner" is now proven by a job that cannot fail the build. That is
not an argument against the answer — the leg was failing for a reason unrelated
to any of this — but it does move these three from "belt and braces" to "the
assertion".

## Build

1. **Unit-test `taskkillPath`** in `tools/downloader/engine/test/ffmpeg-args.test.ts`,
   beside `buildTaskkillArgs`, which is already there and already
   platform-independent. Three cases: `SystemRoot` wins; `windir` is used when
   `SystemRoot` is absent; `C:\Windows` when neither is set. Assert the exact
   expected string per case rather than a property — the point is the literal
   path. Note that `path.join` is POSIX-flavoured on a Linux test host, so the
   expectation has to be built the same way the function builds it, or the test
   asserts the separator instead of the logic. Say in the test which of those it
   is asserting.
2. **Make `findExecutable` testable** — take `platform` and `env` as parameters
   with defaults, the way `taskkillPath` does, then test the `PATHEXT` branch
   from any host. Keep the default call sites unchanged.
3. **Make `assertPathInside` testable** — accept an injectable path module
   defaulting to `node:path`, and add a case that drives it with `path.win32`
   from a Linux host: a drive-letter root with a `..\` escape, and a
   `C:\root-other\x` sibling-prefix case, mirroring the POSIX cases already
   there.
4. **Do not widen to `killProcessTree` itself.** It is covered, and the
   measurement above is the evidence. Anyone tempted should re-run the
   instrumentation first.

## Done when

1. `taskkillPath`'s three branches are asserted directly, and the test is shown
   red first — change the fallback constant, watch it fail, change it back, and
   say in the ticket's Log what the red actually said.
2. `findExecutable`'s `PATHEXT` branch is asserted from a Linux host, or this
   ticket records why the refactor was not worth it and drops that step
   explicitly rather than silently.
3. `assertPathInside` is asserted against `path.win32` from a Linux host, and
   the existing `process.platform` branch in `storage.test.ts` is either kept
   with a note saying what it still buys or removed as redundant — decided, not
   left ambiguous.
4. `npm test -- --project downloader` passes, and `npm run check` passes.
5. The claim in `.github/workflows/ci.yml`'s matrix comment — that the
   cancellation test is "the only execution of `taskkillPath()` anywhere" — is
   re-read and either still true or corrected in the same change.

## Log

- **2026-09-07** — Filed from repo-31's build, on the owner's answer to repo-31
  (option D). Id taken as `repo-34` on instruction: `node scripts/next-id.mjs
repo` reported `next free: repo-33`, and `repo-33` was held at that moment by
  a builder whose branch was not yet pushed, so the script could not see it.
  (That ticket was renumbered to `repo-36` on 2026-09-08, after a peer
  session's own `repo-33` merged first in #192; the measurement above is left as
  it was taken.)
  `repo-34` was checked free by grep over both ticket roots on this branch.

  Filed rather than folded into repo-31's branch for two reasons, both concrete.
  repo-31's change touches `.github/` and `docs/` only; steps 1–3 above touch
  `tools/downloader`, and a branch that lands both carries one squashed title
  that has to be written for one of them. And steps 2 and 3 are refactors of
  shipped functions, which is a different review than a workflow comment.

  **Step 1 was very nearly folded in anyway** — it is a pure function, an
  injectable `env` and three assertions, with no decision in it. It was left
  here because folding it would have put a `tools/downloader` path into a
  `repo`-scoped branch, which is the split CLAUDE.md names as the tell that
  there should have been two commits. Recorded so the deferral is visible rather
  than inferred.
