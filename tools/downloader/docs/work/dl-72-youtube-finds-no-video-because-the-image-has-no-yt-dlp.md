---
id: dl-72
tool: downloader
title: YouTube finds no video, because the released image ships without yt-dlp and its pin is stale
kind: fix
status: done
milestone: null
depends_on: []
---

# dl-72 — YouTube finds no video, because the released image has no yt-dlp

## Why

The owner reported that `https://www.youtube.com/watch?v=-PGMCBCTSfE` says "no
video found" on downloader.oludoi.com. Three facts, each measured, explain it —
and together they make false a claim the repo repeats in four places: that
without yt-dlp "every request falls through to the browser sniffer and still
works" (the `Dockerfile` comment above `INSTALL_YTDLP`, the
`compose.downloader.yaml` comment beside it, `02-ROADMAP.md`'s "yt-dlp is never
a dependency", and `01-ARCHITECTURE.md`'s "remove every extractor tier and the
system still works"). For YouTube, the extractor tier is the only tier that
finds anything.

## Reproduction

Measured 2026-09-22 by the orchestrator, against `main` at `20eb8ba`.

1. **The released image has no yt-dlp.** `tools/downloader/Dockerfile:94` was
   `ARG INSTALL_YTDLP=false`, and its `curl` install runs only when that is
   `true`. Neither `docker/build-push-action` step in
   `.github/workflows/release.yml` (the `publish` matrix and the `rebuild`
   escape hatch) passes `build-args`, so the published image takes the default.
   The only explicit settings anywhere were `compose.downloader.yaml:37` and
   `.github/workflows/downloader.yml:148`, and both said `false`. So every
   YouTube URL reaches the sniffer.
2. **The sniffer cannot resolve YouTube.** The API run locally from `20eb8ba`
   with `PORT=18080 ENABLE_YTDLP_RESOLVER=false`, then
   `POST /api/probe {"url": "https://www.youtube.com/watch?v=-PGMCBCTSfE"}`,
   returned `422 NO_MEDIA_FOUND` in about 10 s. The attempts: `browser`
   `NO_MEDIA_FOUND` in 8900 ms, then `direct` `NO_MEDIA_FOUND` in 1017 ms.
3. **The pinned version is broken too.** yt-dlp `2025.09.26`, the pin and the
   binary installed in the devcontainer, fails on that URL with
   `ERROR: [youtube] -PGMCBCTSfE: The page needs to be reloaded.` The current
   release, `2026.08.19`, succeeds: `yt-dlp -J` returned 54 formats, 43 of them
   video, up to 1080p. With `YTDLP_PATH` pointing at `2026.08.19`, the same
   local API resolved the probe via `resolver: "yt-dlp"` in 3.4 s.

So shipping the binary is not enough on its own: a pin that nothing moves goes
stale in exactly the way `2025.09.26` did, and the symptom is the same silent
fallthrough to a tier that cannot help.

## The decision

Taken by the owner through `AskUserQuestion` on 2026-09-22: **enable yt-dlp in
the released image and add an update policy for its pin**, over "enable and bump
the pin only" and "just file a ticket".

**No deno, deferred rather than refused.** The owner asked what deno adds, so it
was measured on the same video. yt-dlp `2026.08.19` without deno: 54 formats, 43
video, 1080p maximum, and one deprecation warning ("No supported JavaScript
runtime … YouTube extraction without a JS runtime has been deprecated, and some
formats may be missing"). With deno 2.9.7: the same 54 / 43 / 1080p and no
warning. The deno binary is 96 MB. **A future bump that starts losing formats is
where deno gets added** — the warning is the notice that it will one day be
needed, and today it buys nothing measurable.

## Build

1. **Ship yt-dlp in the released image.** Both `release.yml` build steps must
   produce an image with the binary, and so must the pull-request container gate
   in `.github/workflows/downloader.yml` and `compose.downloader.yaml` — a gate
   that builds without the layer is the "first release is the first real build"
   trap `docs/03-RELEASING.md` warns about. Decide between flipping the
   `Dockerfile` default and passing `build-args`. Read
   [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md) first: it discusses the
   gate's `INSTALL_YTDLP=false`, and if it records a reason the gate must stay
   false, that is an open decision rather than something to override.
2. **Bump the pin to `2026.08.19` everywhere it is pinned** — at least
   `tools/downloader/Dockerfile`, `.devcontainer/Dockerfile` and
   `.devcontainer/devcontainer.json`. Add a source-scan unit test, in the style
   of `packages/core/test/image-closure.test.ts`, asserting that every pin
   agrees and that the image installs yt-dlp. Make it fail first.
3. **An update policy** that keeps the pin from going stale — for example a
   scheduled workflow that checks yt-dlp's latest GitHub release and opens a
   bump pull request. Known constraints: a pull request opened with the default
   `GITHUB_TOKEN` triggers no other workflow, so no check would run on it; its
   title must pass `scripts/commit-message.mjs` **and** be a releasing type that
   touches `tools/downloader/`, or release-please never ships the new image;
   and Dependabot cannot track a `Dockerfile` `ARG` that names a GitHub release.
   If the workable designs differ materially in cost or permissions, build the
   least-privileged one and report the rest as an open decision.
4. **Correct the documentation** that says the sniffer covers everything: the
   `Dockerfile` and compose comments, `02-ROADMAP.md`, `01-ARCHITECTURE.md`
   where relevant, and `docs/03-RELEASING.md`. Say plainly that YouTube needs
   yt-dlp.
5. **Measure the image-size delta** if the image can be built here; otherwise
   say it could not be.

No test may reach YouTube, or any live host.

## Done when

1. The downloader `Dockerfile` installs yt-dlp by default, and no workflow or
   compose file builds it with `INSTALL_YTDLP` set to anything else — asserted
   by a unit test that fails against `20eb8ba`.
2. Every `YTDLP_VERSION` pin in the repo reads `2026.08.19`, and a unit test
   fails when any two pins disagree.
3. The pull-request container gate proves the built image carries a runnable
   yt-dlp at the pinned version, not only that it boots.
4. A scheduled workflow opens a bump pull request when yt-dlp publishes a newer
   release, rewriting every pin, under a title that `scripts/commit-message.mjs`
   accepts and that is a releasing type — the title asserted by a unit test.
5. The documents listed in Build 4 no longer say yt-dlp is optional for
   coverage, and say that YouTube needs it.
6. `npm run check` and `npm test` pass.

## Review

**Gate: CONCERNS** — 2026-09-22 · diff `20eb8ba...0bae0a3`, rebased afterwards onto `origin/main` without conflict (main had moved by docs-only commits unrelated to this change) · defect hunt run directly, medium depth

| Done when                                                                                                                                                                                | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dockerfile installs yt-dlp by default; no workflow/compose builds with `INSTALL_YTDLP` off — asserted by a unit test that fails against `20eb8ba`                                     | `tools/downloader/Dockerfile:109 "ARG INSTALL_YTDLP=true"` and `tools/downloader/api/test/ytdlp-in-the-image.test.ts:89 "the Dockerfile's default installs it"` plus `:103 "expect(offenders).toEqual"` — proven; reverted Dockerfile, compose and downloader.yml to their 20eb8ba content and reran: 3 of 8 tests failed, then restored ✓                                                                                                                                                                                                                                                   |
| 2. Every `YTDLP_VERSION` pin reads `2026.08.19`; a unit test fails when any two disagree                                                                                                 | `tools/downloader/api/test/ytdlp-in-the-image.test.ts:121 "every pin names the same release"` — proven; changed devcontainer.json's pin to `2026.08.18` and reran: failed with the disagreement message, then restored ✓                                                                                                                                                                                                                                                                                                                                                                     |
| 3. The PR container gate proves the built image carries a runnable yt-dlp at the pinned version, not only that it boots                                                                  | `.github/workflows/downloader.yml:185 "Check the image ships yt-dlp at the pinned version"` — **unproven (gate)**: CI-only, and this sandbox has no reachable docker daemon. Read, not run: it compares an in-container `yt-dlp --version` against the Dockerfile pin and checks `/api/health`'s field at `tools/downloader/api/src/routes/health.ts:117 "available: ytdlp?.available"`; compose passes no `ENABLE_YTDLP_RESOLVER` override, so on inspection it exercises the real binary, but the branch is unpushed and the workflow has never run                                        |
| 4. Scheduled workflow opens a bump PR on a new release, rewriting every pin, under a title `commit-message.mjs` accepts and that is a releasing type — the title asserted by a unit test | `tools/downloader/api/test/ytdlp-in-the-image.test.ts:154 "its title passes the commit-message rule"` and `:166 "its type is one release-please does not hide"` — proven for the title/type clause; independently ran `node scripts/commit-message.mjs --text "fix(downloader): bump yt-dlp to 2099.01.01"` (exit 0) and confirmed the `fix` type is not hidden, its section named at `release-please-config.json:27 "Fixes"`. The broader "opens a PR on a real new release" behavior is **unproven (gate)**: `.github/workflows/ytdlp-bump.yml` has never executed, the branch is unpushed |
| 5. The docs listed in Build 4 no longer say yt-dlp is optional for coverage, and say YouTube needs it                                                                                    | Verified by reading all six touched docs (Dockerfile, compose, 02-ROADMAP.md, 01-ARCHITECTURE.md, docs/03-RELEASING.md, README.md); no live false claim remains — see finding below for a document the ticket's own count missed                                                                                                                                                                                                                                                                                                                                                             |
| 6. `npm run check` and `npm test` pass                                                                                                                                                   | Verified independently at HEAD `0bae0a3`: `npm run check` exit 0, `npm test -- --project downloader` 90 files / 1522 tests passed ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

- **med** · dl-39 named an explicit trigger for reopening its decision to leave the yt-dlp TLS-proxy-trust combination unproven by any gate: `tools/downloader/docs/work/dl-39-real-yt-dlp-tls-coverage-in-ci.md:182 "the yt-dlp tier ceasing to be optional"`. dl-72 makes that condition true for YouTube, and dl-72's own Build 1 said to read dl-39 first because "if it records a reason the gate must stay false, that is an open decision rather than something to override." The branch flips `INSTALL_YTDLP` to `true` everywhere including the gate, and the new check in `.github/workflows/downloader.yml`'s docker job only runs `yt-dlp --version`, not a proxied fetch — the TLS-trust gap dl-39 named is unchanged in kind. **Open decision, not a verdict**: (a) file a follow-up ticket noting dl-39's trigger fired; (b) record in dl-72's Log why the trigger is judged non-blocking. Recommend (a); not mine to pick. **Disposition:** the owner chose (a) on 2026-09-22 — filed as [dl-73](./dl-73-prove-the-shipped-yt-dlp-trusts-the-terminating-proxy.md).
- **low** · `tools/downloader/docs/00-ANALYSIS.md:148 "system must remain fully functional with"` still asserts, of yt-dlp's absence, the claim dl-72 disproves for YouTube. Outside the literal Done-when 5 scope (Build 4 names only the other six documents) but it is a fifth repetition the ticket's own "four places" count missed. **Disposition:** fixed in this branch — the paragraph now qualifies the claim and links here.
- **low** · The Log is a single filing line with no completion entry. Build 5 requires an image-size delta "if the image can be built here; otherwise say it could not be" — confirmed it cannot be built here: `docker info` fails to reach the daemon (`no such file or directory` on the socket). The Log needs a line saying so. **Disposition:** fixed — see the Log.
- **findings** · defect hunt run directly at medium depth over the full diff; 3 found, 3 carried, 0 dropped.
- NFR: security ✓ — no shell injection in `ytdlp-bump.yml`: the release tag is regex-validated at `.github/workflows/ytdlp-bump.yml:80 "shape='^[0-9]"` before any use in `sed`, branch names, commit messages or `gh pr create`; GitHub-context values reach `run:` only through `env:`, never inline; permissions are minimal at `.github/workflows/ytdlp-bump.yml:56 "pull-requests: write"`. performance n/a. reliability ✓ — an already-open bump PR at the same version short-circuits via `git ls-remote`, an older one is closed via the `gh pr list` loop when a newer one opens. maintainability ✓ — the two lows above are the only gaps.

## Log

- **2026-09-22** — Filed from the orchestrator's reproduction above, with the
  owner's decision already taken, and built on the same branch.

- **2026-09-22** — Completed by the orchestrator, because the builder stopped
  after its build commit without writing a report. This entry and `## Review`
  were written for it; the build itself is the builder's.
  - **Renumbered from dl-71 to dl-72.** Another session filed its Turnstile
    ticket as dl-71 in PR #283 at the same time, and that dl-71 reached `main`
    first. This branch had not been pushed, so this ticket moved. The id was
    checked against every remote branch and every local worktree before
    renumbering.
  - **Gates** (run by the orchestrator in the builder's worktree, then again
    by the reviewer from a clean tree): `npm run check` exit 0;
    `npm test -- --project downloader` 90 files / 1522 tests passed, exit 0.
  - **Image size not measured.** No Docker daemon is reachable in this sandbox
    (`docker info` cannot reach `/var/run/docker.sock`), so Build 5's delta is
    still unknown. The yt-dlp binary `2026.08.19` downloaded here is about
    35 MB, which gives a lower bound on what the layer adds. The container gate
    in CI is the first real build.
  - **Token.** `ytdlp-bump.yml` reuses `RELEASE_PLEASE_TOKEN`, so a bump PR runs
    CI, and falls back to `GITHUB_TOKEN` with a warning on the PR when the
    secret is absent. The repo already depends on that secret, so no new
    credential is needed.
  - **What the brief got wrong.** It named four places that claim yt-dlp is
    optional, and there were five: `00-ANALYSIS.md` was missed, then fixed here.
    It also did not anticipate dl-39's reopening trigger, which this ticket sets
    off twice: yt-dlp stops being optional, and every automated bump changes the
    version without re-running dl-39's manual TLS measurement. That follow-up is
    [dl-73](./dl-73-prove-the-shipped-yt-dlp-trusts-the-terminating-proxy.md).
