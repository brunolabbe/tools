---
id: pl-17
tool: planner
title: A Dockerfile's workspace list is maintained by memory
kind: chore
status: done
milestone: null
depends_on: []
---

# pl-17 — Nothing checks that the image carries what the API imports

**Packages:** `packages/core` (the test), and both tools' `Dockerfile`s if it
finds anything

## Why

Each tool's `Dockerfile` lists its workspaces **by hand, twice** — the manifests
copied before `npm ci` in the build stage, and a `package.json` + `dist` pair per
workspace in the runtime stage. Both lists are prose. Nothing anywhere checks
either against what the API actually resolves at runtime, so adding a workspace
dependency to an `api` package silently costs two `Dockerfile` edits that no
compiler, linter or unit test will ask for.

**It has already happened.** [pl-16](./pl-16-the-plan-run.md) added
`@planner/itinerary` to `@planner/api` so the run orchestrator could compose a
plan. `npm run check` passed, 1,020 tests passed, and the container would not
boot:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@planner/itinerary'
  imported from /app/tools/planner/api/dist/runs/orchestrator.js
```

Three things make this worth a gate rather than a note:

**It is invisible until CI, and then it reads as something else.** The failure
surfaces in `.github/workflows/<tool>.yml`'s image job as thirty seconds of
`curl: (7) Failed to connect` and then "the service never became healthy", which
is what an infrastructure flake looks like. The actual error is one line at the
bottom of a log nobody opens first.

**The two lists fail differently, so fixing one is not fixing it.** Miss the
runtime pair and the image boots and throws on first use. Miss the build-stage
manifest and `npm ci` never created the workspace symlink, so there is nothing to
copy even if the runtime lines are right — the module was never installed at all.
A person who has just debugged the first will not necessarily find the second.

**The repo already owns the answer's shape.** `packages/core/test/spawn-safety.test.ts`
enforces a repo-wide rule — never invoke a shell — by reading source files as
text and failing in milliseconds. It was delivered under
[dl-6](../../../downloader/docs/work/dl-6-security-and-limits.md) even though it
lives in `packages/core` and covers every tool, which is the precedent this
ticket follows: the work is repo-wide, the ticket belongs to the tool that needed
it.

## Build

1. **The closure that must be in the image.** For each tool, start at
   `tools/<tool>/api/package.json` and walk `dependencies` through the workspace
   graph — `api` → `agent` → `contract` → `@webtools/core` — collecting every
   `@<tool>/*` and `@webtools/*` member. That is declarative, needs no build and
   no Docker, and is exactly the set Node has to resolve at runtime.
2. **Assert both lists against it, per tool and in both directions.** Every
   member of the closure has a build-stage manifest `COPY` and a runtime-stage
   `package.json` + `dist` pair; and every workspace named in either list is in
   the closure, so a workspace that stops being used stops being shipped.
3. **Close the hole under step 1.** A closure computed from `package.json` is
   only as good as those files, and pl-16 found `@planner/api` importing both
   `@planner/itinerary` and `@webtools/core` without declaring either — so the
   graph would have been wrong in exactly the case that matters. Assert
   separately that **every bare workspace specifier imported anywhere under
   `tools/*/*/src/**` is declared in that package's own `package.json`.** That is
   a hygiene rule worth having on its own, and it is what makes step 1 trustworthy
   rather than circular.
4. **Fix whatever it finds**, in both tools, in the same change.

Traps worth knowing in advance:

- **A subpath is not a package.** `@webtools/core/rate-limit` (pl-16) resolves
  through `@webtools/core`'s `exports` map and ships in that package's `dist`.
  Normalise a specifier to its package name before looking it up, or the scan
  reports a workspace that does not exist and blocks on it.
- **`web` is bundled, not resolved.** Vite inlines everything into
  `web/dist/app`, so the runtime never resolves a `@<tool>/*` specifier for it.
  The rule is about the API's resolution graph; `web`'s own two lines are a
  separate thing the Dockerfile does and are not this scan's business. Say so in
  the test rather than leaving a reader to wonder why `web` is exempt.
- **The two Dockerfiles are not the same file and must not become one.** The
  downloader's is built on Playwright's image and carries Chromium and ffmpeg;
  the planner's is a plain Node base and a twentieth of the size. Their workspace
  lists happen to have the same shape today, and the test must read each rather
  than assume one layout — the comment at the top of either file is explicit that
  sharing them is not wanted.
- **This does not replace the image gate.** A scan over text proves the list is
  complete; it cannot prove the image boots, that the native `better-sqlite3`
  binary matches its glibc, or that `/api/health` answers. Keep the workflow job.
  What this buys is that the _commonest_ way it fails is caught in seconds by
  `npm test` instead of in minutes by a container that will not start.
- **Do not make it clever.** `spawn-safety.test.ts` is the bar: read the files,
  match plainly, fail with a message naming the file and the missing line. A
  Dockerfile parser is a project; this is a scan.

## Done when

- Deleting either `itinerary` line from `tools/planner/Dockerfile` turns the
  suite red — the pl-16 regression, reproduced as a test rather than described.
- The same holds for a workspace removed from the downloader's Dockerfile, so the
  gate is not planner-only in principle and planner-only in practice.
- A workspace imported under `src` but undeclared in its `package.json` fails,
  with the package and the specifier named.
- The test needs no Docker, no build and no network, and runs in the `core`
  vitest project beside `spawn-safety.test.ts`.
- Both tools' Dockerfiles pass, or the change that makes them pass is in the same
  commit.
- `npm run check` and `npm test` pass.

## Review

**Gate: CONCERNS** — 2026-08-18 · `origin/main...origin/pl-17-image-closure` (PR #49) · code-review at medium

| Done when                                                                                                     | Proof                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deleting either `itinerary` line from the planner's `Dockerfile` turns the suite red                          | `packages/core/test/image-closure.test.ts:195` and `:209` ✓ — verified by mutation: removed the build-stage manifest line and, separately, the runtime `dist` line; each turned exactly the matching test red naming the missing `COPY`, then reverted (`git status --short` clean) |
| The same holds for a workspace removed from the downloader's `Dockerfile`                                     | `packages/core/test/image-closure.test.ts:209` ✓ — verified by mutation: removed `resolvers`' runtime `dist` line from `tools/downloader/Dockerfile`, red with the exact missing line, reverted                                                                                     |
| A workspace imported under `src` but undeclared in `package.json` fails, naming the package and the specifier | `packages/core/test/image-closure.test.ts:335` ✓ — verified by mutation: removed `@planner/itinerary` from `tools/planner/api/package.json`; failed with `tools/planner/api/src/runs/orchestrator.ts imports @planner/itinerary, undeclared in @planner/api`, reverted              |
| No Docker, no build, no network; runs in `core` beside `spawn-safety.test.ts`                                 | `packages/core/test/image-closure.test.ts` (whole file) ✓ — `npm test -- --project core` runs it in 375ms; no `exec`/`spawn`/`child_process` in the file                                                                                                                            |
| Both tools' Dockerfiles pass, or the fix ships in the same commit                                             | `packages/core/test/image-closure.test.ts:195,209,227,335` ✓ — unmodified worktree: `npm test -- --project core` is 10/10 green                                                                                                                                                     |
| `npm run check` and `npm test` pass                                                                           | verified directly ✓ — `npm run check` exit 0; `npm test` is 1098/1098 passing, matching the ticket Log's count                                                                                                                                                                      |

- **med** · Stage-boundary regexes (`RUN npm ci`, `AS runtime`) are stricter than any documented convention — `RUN apt-get update && npm ci`, a trailing comment after `AS runtime`, or lowercase `as runtime` all trip them — and because `readImages()`'s `expect()` calls run at module top level (`const IMAGES = await readImages()`, outside any `test()`), a mismatch doesn't fail one named test, it crashes the whole file's collection so every test vanishes from the report together. That undercuts the ticket's own promise to "fail with a message naming the file and the missing line", and is the same "reads as something else" failure mode the ticket's Why section complains about for the pl-16 regression itself. Latent — neither Dockerfile trips it today.
- **med** · `readWorkspaces`'s dir-discovery walk and `sourcesUnder`/`walk` duplicate `spawn-safety.test.ts`'s `sourceRoots`/`collectSources` almost line for line (same readdir walk, same `.catch(() => [])`, same skip list), and the workspace glob (`packages/*`, `tools/*/*`, declared once in root `package.json`) is now hand-re-derived in three places. The docblock cites `spawn-safety.test.ts` as its precedent but reimplements rather than reuses it — a shared helper beside both tests would have made the citation literal.
- **med** · Two silent-pass gaps, the class this ticket exists to close for the Dockerfiles: `sourcesUnder`'s `fs.readdir(...).catch(() => [])` swallows every error, not just ENOENT, so a workspace whose `src` is briefly unreadable passes the "declares what it imports" check vacuously, with the `crossed > WORKSPACES.size` canary not moving enough to notice; and `readWorkspaces` overwrites silently on a duplicate manifest `name` under concurrent `Promise.all`, so a shadowed workspace is never checked. Both need an unlikely precondition (a transient FS error; two workspaces sharing an npm name, which `npm install` would already reject), which is why this stays a med rather than blocking the gate outright.
- **low** · The workspace-scope regex (`webtools|downloader|planner`) is duplicated verbatim at L43 and L299; a fourth tool needs both updated, and missing the second makes that tool's cross-workspace imports invisible to the hygiene check with no failure signal.
- **low** · `closureFrom`'s `queue` is named and commented like a BFS queue but uses `.pop()` (a stack); order is never asserted so this is a readability nit, not a correctness bug.
- **low** · Exact-string `COPY` matching is brittle to `--chown=`/`--link` flags or a backslash-continued/combined line — neither Dockerfile uses these today, and the ticket explicitly chose a scan over a parser ("do not make it clever"), so this is the accepted tradeoff surfacing at its edges rather than an oversight.
- **low** · `text.search(/^\s*RUN npm ci\b/mu)` matches the first occurrence anywhere in the whole file, not scoped to the build stage; an earlier `npm ci` in a future pre-stage would truncate `preInstall` and misreport every workspace as missing. Fails loud, latent.
- **low** · The "two lists fail differently" rationale is now duplicated near-verbatim in five places (CLAUDE.md ×2, the test docblock, both Dockerfiles' comments, `03-STATUS.md`) with nothing checking them against each other — a smaller instance of the same hand-kept-and-unchecked pattern this ticket fixed for the workspace lists themselves.
- **dropped** · Finder 4c's claim that `images.filter((image) => image !== null)` fails to narrow to `ToolImage[]` — checked against the pinned compiler (`typescript@7.0.2`, which carries TS 5.5's inferred-type-predicate narrowing for `filter`) and against `npm run check`, which passes clean; the claim doesn't hold here.
- **dropped** · Finder 4d (three tests repeating `expect([]).toEqual([])` scaffolding) — this matches `spawn-safety.test.ts`'s own established pattern (`expect(offenders).toEqual([])` ×3); not a deviation.
- **dropped** · Finder 4e (`bundledOnly` string vs `closure` array recombined via `new Set([...])` per use site) — cosmetic, single relevant call site; not worth its own line.
- **dropped** · Finder 6c / part of 7b (`closureFrom` hard-throws for a tool whose API package isn't named `@<tool>/api`) — intentional, documented behavior: the ticket's Log names it "one sharp edge" and the `CLAUDE.md` "Adding a tool" step 7 addition states it explicitly. A recorded product decision, not a bug.
- **dropped** · Finder 7d (assert-vs-generate: a small generator would produce the same `COPY` lines correctly by construction) — the ticket explicitly rejects this design ("a Dockerfile parser is a project; this is a scan"), matching the `spawn-safety.test.ts` bar it names as precedent. Recorded product decision.
- **dropped** · Finder 2 (removed-behavior audit) and Finder 3 (efficiency) returned no findings; nothing to carry.
- NFR: security n/a (reads only repo-local files, no network, no shell) · performance n/a (~375ms for the whole `core` project) · reliability — the two silent-pass gaps and the module-load-time-crash finding above are exactly the "gate that silently checks nothing, or fails unreadably" risk this ticket was written to eliminate for the Dockerfiles; worth tightening even though none fire on the current repo · maintainability — extensive, accurate why-comments across the diff, but the "two lists fail differently" rationale is now hand-copied five times and the discovery/walk logic is hand-copied from `spawn-safety.test.ts` rather than shared.

## Log

### 2026-08-18 — the gate is in, and it found nothing to fix

`packages/core/test/image-closure.test.ts`, beside `spawn-safety.test.ts` and in
the `core` vitest project. Six tests, no Docker, no build, no network, ~30ms.

#### What it asserts

- **The closure**, walked from `tools/<tool>/api`'s own manifest through
  `dependencies` — `api` → `agent` → `contract` → `@webtools/core` — with only
  workspace-scoped members kept.
- **The build-stage manifest list**, scoped to the lines _before_ `RUN npm ci`.
  That boundary is the whole point rather than a convenience: the build stage
  copies `tools/<tool>` wholesale further down, so every manifest is present by
  the end regardless — but `npm ci` is what creates the workspace symlinks, and
  it only sees what was copied before it ran. A check over the whole stage would
  have passed on the exact file that broke pl-16.
- **The runtime-stage pair** — `package.json` and `dist` — per closure member.
- **The reverse direction**, per stage: a workspace named in either list that is
  not in the closure fails, so one that stops being used stops being shipped.
- **The hygiene rule under it**: every `@webtools/*` / `@<tool>/*` specifier
  quoted anywhere under a workspace's `src` is in that package's own
  `dependencies`.

#### What the brief got right, and the one thing it did not anticipate

Every trap it names was real and every one of them was hit. The subpath case is
live — `@webtools/core/rate-limit` appears in `api/src` and normalises to
`@webtools/core`. `web` is in both Dockerfiles' lists and in neither closure, so
without the exemption the reverse direction fails on both tools; it is exempted
by name, in the type, with the reason beside it.

What the brief did not anticipate: **`dependencies` and not
`devDependencies`, and the reason is specific rather than stylistic.** The
runtime stage is built after `npm prune --omit=dev`, so a workspace import
declared as a dev dependency resolves in the repo, in CI and in the build stage
and is missing from the image _alone_ — the same failure as pl-16's with one
fewer place to notice it. `@planner/agent` depends on `@planner/itinerary` this
way today and legitimately: two test files use it and no production file does,
which is exactly why the scan reads `src` and not `test`.

#### It found nothing, and that is the honest outcome

Build step 4 says "fix whatever it finds", and it found nothing: pl-16 had
already fixed the planner by hand, and the downloader was correct. **So the value
here is entirely prospective**, and the only way to say anything true about a
gate that passes on arrival is to break the thing on purpose. Five mutations,
each reverted:

| Mutation                                                         | Result                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| drop `itinerary`'s `dist` from the planner's runtime stage       | ✅ red, naming the exact missing line                                            |
| drop `itinerary`'s manifest from before `npm ci`                 | ✅ red, the pl-16 regression proper                                              |
| drop `resolvers` from the downloader's Dockerfile                | ✅ red, three lines across both stages                                           |
| add `tools/planner/e2e` to the build-stage list                  | ✅ red, reverse direction                                                        |
| delete `@planner/itinerary` from `@planner/api`'s `package.json` | ✅ red: `orchestrator.ts imports @planner/itinerary, undeclared in @planner/api` |

The last one fails **two** tests, not one — with the dependency undeclared the
closure shrinks, so the Dockerfile's correct `itinerary` lines start reading as
stale. Both messages are true and the undeclared one names the cause, so this is
left as it is rather than papered over with a skip; a reader who sees only the
"ships a workspace the API does not resolve" failure should look above it.

#### What it does not do, kept deliberately

It is a scan, not a Dockerfile parser: lines are whitespace-normalised, filtered
to `COPY`, and matched as strings. It does not resolve `ARG`s, understand
`--from` targets beyond the literal `build`, or know a stage graph — it finds
`RUN npm ci` and `FROM … AS runtime` by regex and asserts both exist, which is
the one structural assumption and it fails loudly rather than silently if a
Dockerfile stops holding it.

**The image gate stays.** `.github/workflows/<tool>.yml` still builds, starts and
curls each container. This catches the commonest failure in seconds; it cannot
prove the native `better-sqlite3` binary meets its glibc or that `/api/health`
answers. A pointer to the test is now in both Dockerfiles, beside the hand-kept
lists, so the next person to add a workspace finds it where they are already
looking.

#### The rule is in the root `CLAUDE.md`, which is where it was missing

The Dockerfile pointers help somebody already editing one. They do not help
somebody about to write their first, and _Adding a tool_ step 7 is exactly where
that happens. So the rule now sits in the repo-wide Rules beside **never invoke a
shell** — the precedent this ticket followed, and the only other repo-wide scan —
naming `image-closure.test.ts` the same way that one names `spawn-safety.test.ts`,
and step 7 says the scan will tell you what a copied `Dockerfile` brought along
that your tool does not use.

It is one page and not each tool's, deliberately: the rule is repo-wide, and a
document that describes two tools is where two tools start to fuse. The
downloader's docs say nothing about this and should not.

#### One sharp edge, found by writing that down

The scan finds a tool's service **by name**, at `@<tool>/api`. A third tool that
called it something else got
`@foo/api is depended on but is not a workspace` — confusing, and wrong in the
specific way that costs time: that name is the _root_ of the walk, not a
dependency anybody failed to declare. It now fails saying the convention exists
and where to teach it, checked by standing up a `tools/faketool/Dockerfile` with
no package behind it. The remaining throw was re-worded to mean only what it now
means.

#### Green

`npm run check` passes. `npm test` is 1,098 tests across 80 files.

### 2026-08-18 — the scan's own failure modes, found by its gate

The review above returned CONCERNS: every acceptance line proven by mutation,
and three `med` findings, none of them about the rule and all three about the
scan enforcing it. They are worth recording together, because they are the same
mistake in three costumes — **a checker that fails in a way nobody reads, or
that passes because it stopped looking.** That is the failure this ticket was
written about, turned back on the ticket's own work.

**`expect()` ran while the module loaded, so an unreadable Dockerfile took the
file down at collection.** `readImages` asserted its stage boundaries inline and
was called from a top-level `await`. A `Dockerfile` matching neither pattern
therefore did not fail the test that would have named it; it failed the _suite_,
all six tests vanishing from the report together, reading as a broken file
rather than as a Dockerfile the scan did not understand. The Why section above
complains that the pl-16 regression surfaced as `curl: (7)` and read like an
infrastructure flake. This was the same trick, one layer up. Reading now only
gathers, every unreadable thing lands in a `problems` list, and a test named
_the scan could read every workspace and every Dockerfile it found_ asserts it
is empty — first in the file, because everything after it checks less than it
claims when it is not.

**The stage patterns were stricter than any rule this repo states.**
`/^\s*RUN npm ci\b/` refused `RUN apt-get update && npm ci`, and
`/^FROM .* AS runtime$/` refused a lower-case `as` and a trailing comment — both
ordinary Dockerfile edits that violate nothing written down anywhere, and both of
which used to trip the crash above. Stage names are matched case-insensitively
now, with a trailing comment allowed and the name still required to end the line
so `AS runtime-arm64` stays a different stage. The `npm ci` search is scoped to
the build stage rather than the whole file, which also closes the case where an
install added to an earlier stage would have truncated the manifest section and
reported every workspace missing.

**Two ways to pass by having looked at less.** `fs.readdir(...).catch(() => [])`
swallowed every error, not only "no such directory" — so a workspace whose `src`
was briefly unreadable passed the declares-what-it-imports check vacuously, on
zero files. And `workspaces.set(manifest.name, …)` overwrote silently, so two
directories claiming one name left the loser unchecked against either Dockerfile
list, non-deterministically depending on which read finished first. Absent is now
an answer and unreadable is not; a duplicate name is a `problem` naming both
directories, and the manifests are sorted so which one is reported does not
depend on IO ordering. Neither needs a likely precondition to matter — they need
an unlikely one to fire, and a gate that reports clean because it could not look
is worth less than no gate.

The two smaller ones went the same way. The workspace scope list
(`webtools|downloader|planner`) was written out twice, and the second copy was
the one whose absence would have been silent — a fourth tool's cross-workspace
imports simply invisible. Both are gone: the scopes are read off the workspaces
that exist, so a new tool is in scope the day it has a manifest. And
`closureFrom`'s `queue` is `pending`, because it pops from the end and was never
a queue.

**`spawn-safety.test.ts` was cited as precedent and then reimplemented.** The two
scans walked the same tree with the same two-level readdir, the same
`node_modules`/`dist` skip and the same path normalisation, in two copies — the
layout of this repo encoded twice in the same directory, which is the shape of
thing that gets changed in one of them. Both now import
`packages/core/test/support/workspaces.ts`. It is scaffolding for two tests and
deliberately not a `src` module: `vitest` collects `*.test.ts`, so it is never
mistaken for a suite, and `tsconfig.tests.json`'s glob typechecks it with them.

The planner `Dockerfile`'s comment lost its retelling of how the two lists fail
differently, which by then existed in full in three places. It states the rule
and points at the test, which is what the downloader's already did.

#### What the gate did not ask for

Two `low`s are left alone, both because this ticket already decided them. Exact
string matching on `COPY` lines is brittle to `--chown=` and to a continued
line, and a generator would produce those lines correctly rather than catching
them afterwards — both are the "do not make it clever / a Dockerfile parser is a
project" call in the brief, and neither is a defect in it.

#### Green

`npm run check` passes. `npm test` is 1,099 tests across 80 files — one more than
before, the read-the-repo assertion.

Every acceptance line was re-verified by mutation after the rewrite, including
the two that are the reason this ticket exists, plus the two new failure modes
and two edits that must _not_ fail: deleting either `itinerary` line, deleting a
downloader `dist` line, and undeclaring `@planner/itinerary` each turn exactly
one or two named tests red with the missing line quoted; removing `npm ci` from
the build stage and giving two workspaces one name now fail _the scan could read_
test by name with all eleven tests still collected; and `RUN apt-get update &&
npm ci` and a lower-case `as runtime  # comment` both stay green.
