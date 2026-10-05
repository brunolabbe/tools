---
id: dl-73
tool: downloader
title: Prove in CI that the shipped yt-dlp trusts the terminating proxy, now that YouTube depends on it
kind: work-package
status: done
milestone: null
depends_on: [dl-72]
awaiting: Done when 2 — the first real ytdlp-bump.yml pull request shows the docker check running the trust step before it is merged
---

# dl-73 — the shipped yt-dlp, a real TLS fetch, and a gate that runs it

**Packages:** `.github/workflows/downloader.yml` (the container gate) and
possibly `e2e/`. The resolver code (`resolvers/src/resolvers/ytdlp.ts`) should
need no change.

**Related:** [dl-39](./dl-39-real-yt-dlp-tls-coverage-in-ci.md) closed this
same gap on cost, and named what would reopen it.
[dl-72](./dl-72-youtube-finds-no-video-because-the-image-has-no-yt-dlp.md)
triggered it.

## Why

When the API's egress proxy terminates TLS, the yt-dlp child trusts the
operator CA only through `SSL_CERT_FILE` **together with**
`--compat-options no-certifi`. That was measured once, by hand, against
2025.09.26 (see dl-39's `## Why`). dl-39 left it without a gate for two reasons:
the yt-dlp tier was optional, and a failure degrades rather than crashes. An
unrecognised compat option becomes `NO_MEDIA_FOUND`, and the chain falls
through to the sniffer.

dl-72 removed both reasons. yt-dlp now ships in every released image, pinned at
2026.08.19. The sniffer cannot resolve YouTube, so on YouTube "degrades" means
the user sees "no video found" again, with nothing in CI to catch it.
`ytdlp-bump.yml` will also change the version on a schedule. That is dl-39's
second trigger ("a `YTDLP_VERSION` bump landing without anyone re-running the
manual measurement"), and it now fires automatically.

## Build

1. In the container gate, run the shipped yt-dlp through the terminating proxy
   against a local TLS origin whose certificate is issued by the operator CA,
   using the flags the resolver passes. The gate must fail if the pair stops
   verifying. No third-party site: the fixture origin the e2e suite already
   runs is the natural target.
2. Make the check fail first. Drop `--compat-options no-certifi`, or pass only
   `SSL_CERT_FILE`, and show the gate going red.
3. Settle dl-39's two open questions, and record the answers:
   - **The version floor for `--compat-options no-certifi`.** At least confirm
     2026.08.19.
   - **Whether the CI runner can reach the yt-dlp releases host.** dl-72's
     container gate now downloads the binary, so its first green run answers
     this. Record the run.

## Done when

1. The downloader container gate performs a proxied TLS fetch with the shipped
   yt-dlp and fails when the trust flags are removed. Show the failing run as
   well as the passing one.
2. A `ytdlp-bump.yml` pull request runs that gate, and shows it red, before
   the owner merges it by hand. Nothing enforces the order: `main` has no
   required checks. The first real bump pull request is what confirms it.
   (Reworded 2026-10-03 by the owner's decision; see the Log for the original.)
3. dl-39's two unanswered questions are answered in this ticket's Log.

## Review

### Gate 1

**Gate: FAIL** — 2026-10-03 · `ebb808b8a0f30543a056f93a3c8e30b2137e8e7f...2ce406b65e077370e553c828cb15567376814bbd` (three-dot; `origin/main` was still `ebb808b` when the review ended) · code-review at medium, run by hand with no finder subagents · re-issued at gate 2, so coordinates resolve against tip `3003534` and content that predates the branch is pinned to `ebb808b`; three citations whose text the round rewrote or deleted are prose naming `2ce406b`, the sha this gate reviewed (the script's pass line, the script's header, and one architecture sentence)

| Done when                                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The downloader container gate performs a proxied TLS fetch with the shipped yt-dlp and fails when the trust flags are removed. Show the failing run as well as the passing one. | **verified**, and the gate itself ran. The step is .github/workflows/downloader.yml:208 "Check the shipped yt-dlp trusts the terminating proxy". Red: run `37135744589`, head `fba77d0` (`no-certifi` commented out of the resolver), `docker` job `111239804190`. Its step conclusions are all success except that step, which fails with `CERTIFICATE_VERIFY_FAILED ... self-signed certificate in certificate chain`, `HTTP 502`, `origin saw: []`. Green: runs `37135579976` (`715a00e`), `37135914749` (`0c6f0aa`, the flag restored) and `37136708654` (tip `2ce406b`), each with that step a success. Re-run locally against the real `2026.08.19` binary: as built exit 0; the flag at tools/downloader/resolvers/src/resolvers/ytdlp.ts@ebb808b:250-253 "trustBundle !== undefined" dropped, exit 1; the `SSL_CERT_FILE` overlay at tools/downloader/resolvers/src/resolvers/ytdlp.ts@ebb808b:268 "SSL_CERT_FILE: trustBundle" dropped, exit 1; `--proxy` dropped, exit 1. Clause 1 holds as written. See F1 for what the script claims beyond it. |
| 2. A `ytdlp-bump.yml` pull request runs that gate before it can merge.                                                                                                             | **unproven (gate)**. Wiring is proven: tools/downloader/api/test/ytdlp-in-the-image.test.ts:217 "expect(trigger).toContain" goes red when the `pull_request` glob is narrowed, and .github/workflows/downloader.yml@ebb808b:31 "pull_request:" has no `branches` filter. The bump rewrites tools/downloader/Dockerfile@ebb808b:110 "ARG YTDLP_VERSION=2026.08.19", which `tools/downloader/**` matches and `!**.md` does not exclude. Not shown: a real bump pull request, because `ytdlp-bump.yml` has run once, on 2026-09-28 as run `36445083045`, with "Rewrite every pin" and "Open the pull request" both skipped. Not enforced: `gh ruleset view 20870721` lists `deletion`, `non_fast_forward` and `pull_request` and no `required_status_checks`, as .github/workflows/ci.yml@ebb808b:49 "rule at all" records for 2026-08-23. See F2.                                                                                                                                                                                                             |
| 3. dl-39's two unanswered questions are answered in this ticket's Log.                                                                                                             | **verified**. Floor, tools/downloader/docs/work/dl-39-real-yt-dlp-tls-coverage-in-ci.md@ebb808b:97 "The yt-dlp version floor": I re-fetched `raw.githubusercontent.com/yt-dlp/yt-dlp/<tag>/` and found `no-certifi` 0 times in `options.py` at `2022.03.08.1`, once in `2022.04.08` (the compat-option list), and twice in `2026.08.19` (the list and the `2021` alias). The first entry of `Changelog.md` at `2022.04.08` reads "Use certificates from certifi if installed". `yt_dlp/utils.py` has no `import certifi` at `2022.03.08.1` and does at `2022.04.08`. `2022.03.08.2` is a 404, so no tag sits between. Releases host, tools/downloader/docs/work/dl-39-real-yt-dlp-tls-coverage-in-ci.md@ebb808b:104 "Whether the CI runner": run `35676851222`, job `106585057794`, head `eb8886d`, PR #285, shows the `curl -fsSL` of `releases/download/2026.08.19/yt-dlp_linux` followed by `#19 DONE 4.0s`, then `pinned 2026.08.19, shipped 2026.08.19`. A `CACHED` layer would not print that.                                                        |

- **high** · **F1** · The gate script cannot tell a yt-dlp that verified the proxy's leaf from one that verified nothing, and its pass line says it can. The script's pass line at `2ce406b` (`verified the proxy's leaf and found`, rewritten since) printed that on any success, and its header at `2ce406b` argued that, because the resolver never passes `--no-check-certificates`, a success therefore means the pair worked. No test holds that premise: `grep -rn no-check-certificate tools packages` outside `node_modules` and `dist` finds only that comment. Reproduction, premises as premises: `/usr/local/bin/yt-dlp` is `2026.08.19`, the pin; the worktree is at `2ce406b` with the farm run and `npm run build` done; each mutation is a one-line `sed` on the compiled `tools/downloader/resolvers/dist/resolvers/ytdlp.js`, restored from a saved copy and checked with `cmp` exit 0; each run is `node tools/downloader/e2e/container/ytdlp-proxy-trust.mjs`.
  - as built: exit 0, `PASS`.
  - the `no-certifi` push dropped: exit 1; `SSL_CERT_FILE` overlay dropped: exit 1; `--proxy` dropped: exit 1. So the route through the proxy is real, and the pair is what makes it pass.
  - the `no-certifi` push replaced by `args.push("--no-check-certificates")`, proxy and `SSL_CERT_FILE` still passed: **exit 0**, `PASS: /usr/local/bin/yt-dlp verified the proxy's leaf and found 1 variant(s).`, origin saw the same eight requests.
  - that replacement with `--proxy` also dropped, so nothing crosses the proxy: **exit 0**, the same `PASS` line.
  - Failure scenario: a resolver edit adds `--no-check-certificates` to get past some site's TLS error, or a yt-dlp release fails open. The gate stays green and its output states that verification happened, which on this path is the one claim the gate exists to make. Clause 1 of Done when still holds as written, since removing the flags does turn it red; F1 is the stronger claim the script makes. High by the dispatch's own rule for this gate; read against `gate.md`'s table alone it is a med, a defect behind a condition that can occur.
  - **Open decision, two remedies, recommendation first.** (1) Both of: a resolver unit test that the arguments for a proxied probe with a trust bundle never carry `--no-check-certificate` or `--no-check-certificates`, paired with a positive assertion that they carry `--compat-options` and `no-certifi` so the absence cannot pass on an empty list; and a control in the script that, after the main probe, runs the real binary directly at the origin with `--compat-options no-certifi` and `SSL_CERT_FILE` naming a root that did not issue the origin's certificate, through `execFile` with an argument array, and requires a non-zero exit with `CERTIFICATE_VERIFY_FAILED`, so a fail-open yt-dlp turns the gate red. I did not run that control. Its cost is a spawn in a script that `packages/core/test/spawn-safety.test.ts` scans, and about two seconds. (2) Reword only: drop "verified the proxy's leaf" from the pass line and the header's "therefore the pair working" for a statement conditional on verification being on. It costs nothing and leaves the gate green under a fail-open resolver or yt-dlp.
- **med** · **F2** · Done when 2 is half provable here, and the branch's prose states the unproven half as fact. "Runs": a bump pull request opened with the default token triggers no workflow, so it needs the secret at .github/workflows/ytdlp-bump.yml@ebb808b:66 "token: ${{ secrets". Secrets are unreadable here (`gh secret list` answered HTTP 403). The circumstantial evidence is that release-please's pull requests #337, #294 and #284 are authored by `brunolabbe` rather than `github-actions[bot]`, and #337's `gh pr checks` lists a `docker` check, so the same fallback expression resolves to a token that does trigger workflows. That is not a bump pull request's own run. "Before it can merge": nothing blocks it, because `main` has no required check, and .github/workflows/ci.yml@ebb808b:362 "no check is" and the comment above it say why that is costly here: a required check that never reports blocks the merge forever, and the downloader workflow is path-filtered. What would prove "runs": the first real bump pull request showing a `docker` check from the `downloader` workflow on its head, read with `gh pr checks <n>`; the schedule is Mondays 07:23 UTC, after a yt-dlp release. Folded in, two findings and one mechanism: the architecture sentence at `2ce406b` that began `so a yt-dlp release that stops honouring` said such a release "fails its bump pull request rather than YouTube in production", which states as fact a trigger no bump pull request has exercised and a merge nothing blocks.
  - **Open decision, two options, recommendation first.** (1) Keep the gate non-required. Reword Done when 2 to "runs on the pull request, and is red before the owner merges by hand", soften the architecture sentence to "turns its bump pull request red", and confirm on the first real bump. It is free, and the Log already describes it that way. (2) Make `docker` a required check. That needs the downloader workflow to report on every pull request, by dropping its `paths` or adding an always-running rollup job, which changes the CI shape for every tool's pull requests, and the ruleset edit is the owner's.
- **low** · **F3** · The two new wiring tests go red for what the builder mutated and stay green for two neighbours that each leave the gate unable to turn a pull request red. With `continue-on-error: true` added under the trust step's `timeout-minutes: 5`, `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts` gives `10 passed (10)`. With `- "!tools/downloader/Dockerfile"` appended after the `pull_request` block's `!**.md`, it also gives `10 passed (10)`. Cause: tools/downloader/api/test/ytdlp-in-the-image.test.ts:208 "node ${SCRIPT}" and tools/downloader/api/test/ytdlp-in-the-image.test.ts:222 "expect(underTheTool.length)" match text and never evaluate the step's flags or the glob. The mutations that do go red, each `1 failed, 9 passed`: the step's script name changed, and the `pull_request` glob narrowed to `tools/downloader/api/**`. Below the floor, so no round is asked for.
- **dropped** · hand-hunt candidate: the gate script is `.mjs`, so `npm run check` does not typecheck it, and it hard-codes `createApp` config keys. Not carried, because each rename I traced fails loudly in the `docker` job and never silently: the script requires the answering resolver to be `yt-dlp`, and the proxy refuses an origin it cannot verify.
- **findings** · code-review at medium, by hand, returned 5: 3 carried as bullets (F1 high, F2 med, F3 low), 1 merged into F2 (the architecture sentence, one mechanism), 1 dropped.
- Not a finding: `ci` is the right type. The script runs from a bind mount and the runtime stage of the image's `Dockerfile` copies only each package's `package.json` and `dist`, so nothing here ships, and release-please-config.json@ebb808b:62 "CI" marks `ci` hidden. `node scripts/commit-message.mjs --text` on the title exits 0.
- Not verified: a `ytdlp-bump.yml` pull request's own run of the gate; the `RELEASE_PLEASE_TOKEN` secret itself; the image's copy of the binary, since I ran the script against the devcontainer's `/usr/local/bin/yt-dlp` at the same `2026.08.19` and never built the image (CI's `pinned 2026.08.19, shipped 2026.08.19` covers the image); the F1 control, which I describe and did not run.
- Repo gates, at `2ce406b`: `npm run check` exit 0; `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts` 10 passed of 10; `npx vitest run packages/core/test/spawn-safety.test.ts` 18 passed of 18, and the script contains no `spawn`, `exec` or `child_process`; `node scripts/citations-gate.mjs --against origin/main` exit 0 with `148 enforced, 0 failing`; `node scripts/preflight.mjs --base origin/main` with the PR title exit 0.
- NFR: security — F1 (a TLS gate that can print "verified" with verification off; the script itself is loopback-only, carries no credential and removes its temp directory in `finally`) · performance ✓ (the step ran in about two seconds in the tip run, under `timeout-minutes: 5`) · reliability — F2 and F3, and no flake in four `docker` runs · maintainability — F3, and the architecture fold-in is in F2.

### Gate 2

**Gate: CONCERNS** — 2026-10-03 · re-gate of `2ce406b65e077370e553c828cb15567376814bbd..30035342af647fd9a86fe6bf0f999b4f3a39ba1e` (two commits, `beb0289` and `3003534`; `origin/main` still `ebb808b` after a fetch) · code-review at medium, by hand, no subagents, limited to this round's lines · coordinates resolve against tip `3003534` · the one thing between this and PASS is a clause of Done when 2 that only a real bump pull request can prove, which the branch cannot supply; no finding is at med or above and no round is asked for

| Gate 1 finding                                                    | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** high, the gate passed a yt-dlp that verifies nothing       | **Fixed.** Both halves hold under plants (the table below). The control is the script's second probe: it rewrites the bundle the app gave yt-dlp at tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:229 "for (const bundle of bundles)" and requires a refusal at tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:235 "if (second.status === 200)". The unit half is tools/downloader/resolvers/test/ytdlp.test.ts:1145 "the resolver never switches certificate verification off". |
| **F2** med, the architecture sentence claimed more than was shown | **Fixed.** tools/downloader/docs/01-ARCHITECTURE.md:365 "Nothing blocks that merge" now says a bad release should turn the bump pull request's check red before the owner merges by hand, that nothing blocks that merge, and that the first real bump confirms the trigger. That matches what gate 1 found. The bump pull request body gains "or stops verifying at all" at .github/workflows/ytdlp-bump.yml:150 "or stops verifying at all", which is true of the gate now.                 |
| **F3** low, wiring tests green under two neighbours               | **Fixed for both named mutations.** tools/downloader/api/test/ytdlp-in-the-image.test.ts:236 "expect(docker).not.toMatch" goes red on `continue-on-error: true` and tools/downloader/api/test/ytdlp-in-the-image.test.ts:247 "expect(negations)" goes red on the Dockerfile negation, each `1 failed, 11 passed (12)` alone and `2 failed, 10 passed (12)` together. Two residual holes are F5.                                                                                               |

| Done when                                                                                                                                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. The downloader container gate performs a proxied TLS fetch with the shipped yt-dlp and fails when the trust flags are removed. Show the failing run as well as the passing one.                                                 | **verified**, as at gate 1, plus the new control. The tip run is `37140577046`, `docker` job `111254000103`, success, and I read its log: probe 1 `HTTP 200`, `control: replacing 2 trust bundle(s)`, probe 2 `HTTP 502; origin saw []` carrying yt-dlp's own `CERTIFICATE_VERIFY_FAILED ... self-signed certificate in certificate chain`, then `PASS`. The CI red run is still the one from gate 1, `37135744589`, which ran the earlier script. The new script's red for the trust flags removed is measured locally only: `no-certifi` dropped and the `SSL_CERT_FILE` overlay dropped each exit 1, `probe 1 was refused`.                                                                                                                       |
| 2, reworded by the owner's decision A. A `ytdlp-bump.yml` pull request runs that gate, and shows it red, before the owner merges it by hand. Nothing enforces the order, and the first real bump pull request is what confirms it. | **unproven (gate)**, for one clause: a real bump pull request's own run. Proven: tools/downloader/api/test/ytdlp-in-the-image.test.ts:217 "expect(trigger).toContain" and the negation test above hold the trigger; pull request #343 itself touches `tools/downloader/**`, ran the `docker` job on each push, and showed it red at `fba77d0` (run `37135744589`) and green after. Circumstantial: release-please's pull requests are authored by `brunolabbe` and show a `docker` check. Not shown: a bump pull request (`ytdlp-bump.yml` still has one run, which skipped its rewrite and open steps). The line now names that as its own remaining proof, and the clause about a required check is gone from it, so lacking one is not a failure. |
| 3. dl-39's two unanswered questions are answered in this ticket's Log.                                                                                                                                                             | **verified** at gate 1; this round touched nothing that bears on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Plants, each one run as `node tools/downloader/e2e/container/ytdlp-proxy-trust.mjs` against the real `/usr/local/bin/yt-dlp` `2026.08.19`, the compiled `tools/downloader/resolvers/dist/resolvers/ytdlp.js` mutated and restored from a saved copy (`cmp` exit 0), the script itself mutated and restored by checkout. Every run that should be red was red, and for the reason shown:

| Plant                                                                                                                                          | Exit | What the script printed                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------- |
| none, as built                                                                                                                                 | 0    | `PASS`, probe 1 `HTTP 200`, probe 2 `HTTP 502; origin saw []`                                                 |
| `no-certifi` replaced by `--no-check-certificates`, proxy kept                                                                                 | 1    | probe 2 `HTTP 200`, `control: yt-dlp accepted a leaf no root it was given vouches for`                        |
| the same, and `--proxy` dropped                                                                                                                | 1    | the same line                                                                                                 |
| the pair kept and `--no-check-certificates` added                                                                                              | 1    | the same line                                                                                                 |
| a fail-open yt-dlp with the resolver untouched: a `yt-dlp.conf` holding `--no-check-certificates` in the working directory, which yt-dlp reads | 1    | the same line                                                                                                 |
| `no-certifi` dropped                                                                                                                           | 1    | `probe 1 was refused ... TLS_VERIFICATION_FAILED`                                                             |
| the `SSL_CERT_FILE` overlay dropped                                                                                                            | 1    | the same                                                                                                      |
| the control's bundle directory prefix wrong, so none is found                                                                                  | 1    | `control: replacing 0 trust bundle(s)`, `no trust bundle found under the app's TMPDIR, so nothing was tested` |
| the `TMPDIR` redirect at tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:165 "= appTmp;" removed                                          | 1    | the same two lines                                                                                            |
| `refresh: true` at tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:144 "refresh: true" removed, so probe 2 can be answered from the cache | 1    | probe 2 `HTTP 200; origin saw []`, the "accepted a leaf" line                                                 |
| the rewrite loop removed, so the bundle is unchanged                                                                                           | 1    | probe 2 `HTTP 200`, the "accepted a leaf" line                                                                |

So the control cannot pass on a bundle that was not found, on a `TMPDIR` that did not take, on a cache hit, or on a rewrite that did not land; each is red. It is also sensitive to the rewrite itself, which is what shows probe 2's refusal comes from yt-dlp's own verification, as its stderr says, and not from the proxy or the API. The unit half, run in `src`: `--no-check-certificates` added inside the trust branch gives `1 failed | 68 passed (69)`, `--no-check-cert` added to the base arguments gives `4 failed | 65 passed (69)`, unmutated `69 passed (69)`. The absence assertion at tools/downloader/resolvers/test/ytdlp.test.ts:1170 "expect(probe.title).not.toMatch" cannot pass on empty output, because the stand-in at tools/downloader/resolvers/test/fixtures/ytdlp/fake-ytdlp.mjs@ebb808b:163 "argv.slice(3)" always writes the arguments and `SSL_CERT_FILE=` into the title, and the resolver has one spawn site at tools/downloader/resolvers/src/resolvers/ytdlp.ts@ebb808b:264 "await runProcess(", so the arguments the test reads are the ones the binary gets.

- **low** · **F4** · The control's message for a probe 2 that answers `200` blames yt-dlp in every case: tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:235 "if (second.status === 200)" prints "yt-dlp accepted a leaf" for a cache hit (`origin saw []`) and for a rewrite that missed the file yt-dlp reads, as the two plants above show. The run is still red, so nothing passes that should not; only the diagnosis misleads. Below the floor, no round.
- **low** · **F5** · The F3 tests still miss two ways to leave the step unable to fail. With `|| true` appended to the trust command, and with `if: false` under the `docker:` job, `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts` gives `12 passed (12)` each. The new test is titled "nothing lets the trust step fail without failing the job", which promises more than its `continue-on-error` and step-level `if:` checks. Below the floor, no round.
- **low** · **F6** · The bump pull request body now reads "fails if this release stops honouring dl-39's trust pair, or stops verifying at all (`SSL_CERT_FILE` and `--compat-options no-certifi`)", and the parenthetical now reads as if it defines "stops verifying". It still names the pair and nothing false. Below the floor.
- **dropped** · a single-quoted `'!tools/downloader/Dockerfile'` negation passes the new test (`12 passed (12)`), but `npx oxfmt --check` on `downloader.yml` exits 1 for it, so `npm run check` catches it. Not a hole.
- **dropped** · the unit test asserts the positive `--compat-options no-certifi` in one of its four cases only. Not carried: the title cannot be empty, as above, so the absence assertions in the other three are not vacuous.
- **dropped** · the control finds the bundle through `TMPDIR`, which `os.tmpdir()` reads on POSIX only, so on Windows it would find none. Not carried: it then fails loudly ("nothing was tested"), and the gate runs in a Linux container.
- **findings** · code-review at medium, by hand, limited to this round's lines, returned 6: 3 carried as bullets (F4, F5, F6, all low), 3 dropped, 0 merged.
- Repo gates, at `3003534`: `npm run check` exit 0; `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts` 12 passed of 12; `npx vitest run tools/downloader/resolvers/test/ytdlp.test.ts` 69 passed of 69; `npx vitest run packages/core/test/spawn-safety.test.ts` 18 passed of 18, and the script still contains no `spawn`, `execFile` or `child_process`; `node scripts/citations-gate.mjs --against origin/main` exit 0 with `148 enforced, 0 failing`; `gh pr checks 343` shows all 11 checks passing at `3003534`.
- Not verified: a `ytdlp-bump.yml` pull request's own run; the `RELEASE_PLEASE_TOKEN` secret; the control going red in CI, since CI at `3003534` ran green only and every plant above is local; the image's copy of the binary, as at gate 1.
- NFR: security ✓ (a fail-open yt-dlp or resolver now turns the gate red; the script stays loopback-only) · performance ✓ (the second probe adds about 1.3 seconds in the tip run, under `timeout-minutes: 5`) · reliability ✓ (no flake in the two `docker` runs of this round) · maintainability — F4 and F5, both low.

## Log

- **2026-09-22** — Filed from dl-72's gate. The reviewer found that dl-72 sets
  off dl-39's reopening trigger. The owner chose, through `AskUserQuestion`, to
  file this ticket and open dl-72 without waiting for it, rather than fold the
  work into dl-72 or record it as an accepted risk.

- **2026-10-03** — Built on `dl-73-ytdlp-proxy-trust-in-ci`, PR #343. The PR
  was opened as a draft early, by the owner's choice, so that the gate could be
  shown red and green in CI.

  **What the gate is.** `.github/workflows/downloader.yml:208 "Check the shipped yt-dlp trusts the terminating proxy"`
  is a new step in the `docker` job. It runs
  `tools/downloader/e2e/container/ytdlp-proxy-trust.mjs` with `docker run`,
  inside the image the job has just built.

  The script builds the real app from the image's own `dist` with `createApp`.
  Only the yt-dlp tier is on, and `ffmpegTlsIntercept` is set to `true`
  explicitly at
  `tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:192 "ffmpegTlsIntercept: true"`.
  An operator root goes in as `egressCaFile`. The script then probes a
  loopback HTTPS origin, whose certificate that root issued, through an
  injected `POST /api/probe`. It passes only if `yt-dlp` answers with at least
  one variant.

  So the flags come from `server.ts` → `buildRegistry` → `YtDlpResolver`, and
  the script never passes them itself. yt-dlp is never given the operator root.
  The only certificate it can verify on this path is therefore the proxy's
  leaf, through `SSL_CERT_FILE`, and only because `no-certifi` sends it there.

  The operator root is minted by a second `createTlsInterception`, because Node
  writes no certificate itself. That root is separate from the proxy's own.

  Two unit tests were appended to the end of `ytdlp-in-the-image.test.ts`:
  - `tools/downloader/api/test/ytdlp-in-the-image.test.ts:204 "the docker job runs the trust check"`
  - `tools/downloader/api/test/ytdlp-in-the-image.test.ts:212 "a bump pull request triggers that job"`

  Both were made to fail first. With the step's command replaced by
  `node --version` and the `pull_request` glob narrowed to
  `tools/downloader/api/**`, `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts`
  gave `2 failed | 8 passed (10)`. Restored, it gave `10 passed (10)`.

  **Done-when 1, the runs.** All three are on PR #343, event `pull_request`,
  read with `gh run view <id> --json jobs`.

  | State                                                       | Head      | Run           | `docker` job   | Result                                                                                                               |
  | ----------------------------------------------------------- | --------- | ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
  | gate added                                                  | `715a00e` | `37135579976` | `111239324653` | success; step printed `HTTP 200` and `PASS: /usr/local/bin/yt-dlp verified the proxy's leaf and found 1 variant(s).` |
  | `args.push("--compat-options", "no-certifi")` commented out | `fba77d0` | `37135744589` | `111239804190` | **failure**, in the step "Check the shipped yt-dlp trusts the terminating proxy" and no other                        |
  | restored, resolver byte-identical to the base again         | `0c6f0aa` | `37135914749` | `111240292075` | success, `PASS` again                                                                                                |

  The red run's reason, from `gh run view 37135744589 --log-failed`:

  - yt-dlp's own stderr: `[generic] master: Unable to download webpage: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain`.
  - The API's answer: `TLS_VERIFICATION_FAILED`, HTTP 502, `reason: certificate_verify_failed`.
  - `origin saw: []`.

  That is dl-39's "`SSL_CERT_FILE` alone fails", on the shipped binary. The
  e2e legs passed in that run. The unit-test legs were cancelled by the next
  push, so the red run says nothing about them.

  The same three states were measured before any push, from the repo root
  after `npm run build`. They ran against `/usr/local/bin/yt-dlp`, the
  `2026.08.19` PyInstaller ELF that this devcontainer carries:
  - as built: exit 0;
  - `no-certifi` dropped: exit 1, with the error above;
  - `SSL_CERT_FILE` dropped and `no-certifi` kept: exit 1, with the same error.

  Before each run, the state was confirmed by grepping
  `resolvers/dist/resolvers/ytdlp.js`.

  **Done-when 2, what could and could not be shown without a bump pull request.**
  No bump PR has ever been opened. `ytdlp-bump.yml` has run once, on schedule,
  as run `36445083045` on 2026-09-28. That run printed
  `The pin 2026.08.19 is current (latest release 2026.08.19).`

  _Shown:_
  - The bump rewrites `tools/downloader/Dockerfile`, which `git grep` lists
    beside the two `.devcontainer/` pins. That file falls under the
    `"tools/downloader/**"` glob of `downloader.yml`'s `pull_request` trigger.
  - That trigger has no `branches` filter, and its trailing `!**.md` does not
    exclude the Dockerfile.
  - So a bump PR runs the `docker` job, and with it this step. The second
    appended test holds this.
  - The bump PR body at `.github/workflows/ytdlp-bump.yml:150 "What the checks prove"`
    now says that the gate runs the pair. It no longer says "measured by hand
    only". "Nothing in CI runs yt-dlp against a real site" moved to the "do
    not" list, line for line.

  _Not shown:_
  - "Before it can merge" holds only as "runs, and is red, before the owner
    merges by hand". Nothing enforces it: per the ruleset read recorded in
    `ci.yml`, `main` has no `required_status_checks`.
  - Whether `RELEASE_PLEASE_TOKEN` is set, so that a bump PR triggers
    workflows at all. Secrets are not readable from here, and the bump PR body
    already tells the owner when it is not set.
  - A bump PR's own run of the gate, end to end.

  **Done-when 3: dl-39's two open questions, answered.**

  - **The version floor for `--compat-options no-certifi` is `2022.04.08`.**
    It is the release in which yt-dlp started preferring `certifi`
    (`Changelog.md`, `### 2022.04.08`: "Use certificates from `certifi` if
    installed"). Below it the option is unrecognised, but it is also not
    needed.

    Fetched with `curl` from `raw.githubusercontent.com/yt-dlp/yt-dlp/<tag>/`:
    - `yt_dlp/options.py` at `2022.03.08.1` has 0 occurrences of `no-certifi`;
    - at `2022.04.08`, line 346 lists it among the compat options;
    - `README.md` at `2022.04.08`, line 147, reads "If you want to use system
      certificates (e.g. self-signed), use `--compat-options no-certifi`";
    - at `2026.08.19`, `options.py` line 568 still lists it, and line 575 makes
      it part of the `2021` alias.

    **Confirmed working at `2026.08.19`** by the three CI runs and the local
    runs above. The floor is now moot for the image, because the gate re-runs
    against whatever pin a bump proposes.

  - **The CI runner can reach the yt-dlp releases host.** dl-72's PR #285 ran
    run `35676851222`, `docker` job `106585057794`, at `eb8886d`, on
    2026-09-22. Its log shows
    `#19 [runtime  4/19] RUN if [ "true" = "true" ]; then curl -fsSL -o /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_linux"`
    followed by `#19 DONE 4.0s`. That is a real download, not `CACHED`: `main`
    had never built that layer, and a PR run reads only `main`'s cache. The
    same log has `pinned 2026.08.19, shipped 2026.08.19`.

    On this ticket's runs the layer is `CACHED`, from `main`'s cache.

  **What the brief had wrong.**
  - It named "the fixture origin the e2e suite already runs" as the natural
    target, and it is not one. `e2e/fixtures/hls-origin.ts` serves plain HTTP
    (`http://127.0.0.1:<port>`). It generates its clip with ffmpeg, and it is
    TypeScript that runs under tsx on the e2e runners. The image carries
    neither tsx nor that file, and the `docker` job has no `npm ci`.

    So the origin is a small HTTPS server inside the script. It serves a
    master playlist, a media playlist and one segment, which is enough for
    yt-dlp's generic extractor and for the API's size probe. It is still local,
    and no third-party site is involved.

  - The brief expected `resolvers/src/resolvers/ytdlp.ts` to need no change,
    and it did not. The branch's net diff leaves it untouched.

  **Fold-in.** The stale "measured by hand only" sentence in the bump PR body
  was folded in. `01-ARCHITECTURE.md`'s yt-dlp bullet now says that the gate
  runs the pair. Nothing else was free to fold in: the open downloader tickets
  are dl-49, dl-52 and dl-54, and none is touched by this work.

  **dl-39 is not edited.** A pointer appended to its Log made preflight fail
  `review` (`dl-39-… is marked done but has no ## Review section`): dl-39 was
  closed by decision, without a gate, and preflight wants a `## Review` on
  every `done` ticket a branch touches. Its 2026-09-22 entry already links here, so the
  answers are one hop from it.

- **2026-10-03, after gate 1** — Gate 1 returned FAIL at `2ce406b`, with three
  findings. All three are fixed on the branch, and each was reproduced before it
  was fixed.

  **F1 (high): the gate passed a yt-dlp that verifies nothing.** The entry
  above argues that "the only certificate it can verify on this path is
  therefore the proxy's leaf". That holds only if yt-dlp verifies at all, and
  nothing checked that.

  Reproduced: the compiled `resolvers/dist/resolvers/ytdlp.js` was mutated to
  pass `--no-check-certificates` in place of `no-certifi`. The script then
  exited 0 and printed `PASS: ... verified the proxy's leaf`.

  **The remedy is both of the gate's options**, because they fail in different
  places:

  - **A control in the script, which is the behavioural half.**
    - The first probe is unchanged.
    - Then the trust bundle the app handed yt-dlp is overwritten with an
      unrelated root, at
      `tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:229 "for (const bundle of bundles)"`.
    - A second probe, with `refresh: true`, must come back
      `TLS_VERIFICATION_FAILED`, and the origin must see no requests. A `200` is
      a failure, at
      `tools/downloader/e2e/container/ytdlp-proxy-trust.mjs:235 "if (second.status === 200)"`.
    - This catches a release that fails open, which no argv test can see. It
      also catches a resolver that drops the proxy.
    - The bundle is found by pointing `TMPDIR` at the script's own directory
      before `createApp`, because `createApp` does not expose the bundle.
      Finding none is a failure, not a skip.
    - I did not build the gate's suggested variant, which spawns the binary
      directly with an unrelated `SSL_CERT_FILE`. It would test argv written in
      the script rather than the resolver's.
  - **A resolver unit test, which is the fast half.**
    `tools/downloader/resolvers/test/ytdlp.test.ts:1145 "the resolver never switches certificate verification off"`
    covers all four combinations of proxy and bundle. It asserts that no
    argument matches `--no-?check-?cert`; the stem catches optparse prefixes
    and yt-dlp's `--nocheckcertificate` spelling. With a proxy and a bundle, it
    also asserts `--compat-options no-certifi`. It runs on every push, where the
    script runs only in the `docker` job.

  Measured locally against `/usr/local/bin/yt-dlp` `2026.08.19`, mutating the
  compiled resolver with a scratch script and restoring it from a copy, one
  `node tools/downloader/e2e/container/ytdlp-proxy-trust.mjs` per state:

  | Compiled resolver                                      | Probe 1 | Probe 2 (control) | Exit |
  | ------------------------------------------------------ | ------- | ----------------- | ---- |
  | as built                                               | 200     | 502               | 0    |
  | `no-certifi` replaced by `--no-check-certificates`     | 200     | **200**           | 1    |
  | same, and `args.push("--proxy", proxyUrl)` removed too | 200     | **200**           | 1    |
  | `no-certifi` removed                                   | 502     | 502               | 1    |

  Both `--no-check-certificates` rows failed with
  `FAIL: control: yt-dlp accepted a leaf no root it was given vouches for`.

  The unit test was made to fail first, against `src`:
  - With `args.push("--no-check-certificates")` added inside the trust branch,
    `npx vitest run tools/downloader/resolvers/test/ytdlp.test.ts` gave
    `1 failed | 68 passed (69)` (`'a proxy and a bundle'`).
  - With `"--no-check-cert"` added to the base arguments, it gave
    `4 failed | 65 passed (69)`.
  - Restored, it gave `69 passed (69)`.

  **F2 (med): the architecture sentence claimed more than was shown.**
  `01-ARCHITECTURE.md` now says that a bad release "should" turn the bump PR's
  container check red before the owner merges it by hand. It also says that
  nothing blocks the merge, and that the first real bump confirms the trigger.

  **The owner's decision on Done-when 2**, taken through `AskUserQuestion`
  before this gate returned. The question was how "before it can merge" is met.
  The options were:
  - A: the gate runs and shows red before the owner merges by hand
    (recommended);
  - B: make `docker` a required check;
  - C: A, plus a ticket for required checks.

  **The owner chose A.** Done-when 2 is reworded to that meaning. Its original
  wording was "A `ytdlp-bump.yml` pull request runs that gate before it can
  merge." The first real bump PR is marked as what confirms it.

  **F3 (low), folded in because it was free.** The gate measured the two wiring
  tests staying green under two mutations, and two tests were appended for
  them:
  - `continue-on-error: true` on the step:
    `tools/downloader/api/test/ytdlp-in-the-image.test.ts:225 "nothing lets the trust step fail"`
    fails on any `continue-on-error` in the `docker` job, and on an `if:` on
    the step.
  - `!tools/downloader/Dockerfile` appended to the `pull_request` paths:
    `tools/downloader/api/test/ytdlp-in-the-image.test.ts:239 "no negated path takes the downloader Dockerfile"`
    holds the trigger's negations to exactly `["!**.md"]`.

  With both of the gate's mutations applied to `downloader.yml`,
  `npx vitest run tools/downloader/api/test/ytdlp-in-the-image.test.ts` gave
  `2 failed | 10 passed (12)`. Restored, it gave `12 passed (12)`.

  **Two other edits in this round.** The bump PR body sentence gains "or stops
  verifying at all", edited in place. The `docker` step's comment gains two
  lines about the control, so the step moved from line 206 to line 208. The
  entry above was repointed to match.

  **In CI, at `beb0289`.** PR #343 run `37140019969`, `docker` job
  `111252322360`, finished `success`. Its trust step printed probe 1 `HTTP 200`,
  `control: replacing 2 trust bundle(s) with an unrelated root`, probe 2
  `HTTP 502; origin saw []`, then `PASS`. `test (ubuntu-latest)` passed in run
  `37140019955`.

- **2026-10-03, landing** — Gate 2 returned CONCERNS at `3003534` and left the
  last clause of Done-when 2, "confirmed by the first real bump pull request",
  `unproven (gate)`: no `ytdlp-bump.yml` pull request can exist until yt-dlp
  releases. The question for the owner was what status the ticket lands with.
  Put through `AskUserQuestion`, the options were: done, with the first real
  bump pull request named as the remaining confirmation (recommended); or
  in-flight until that pull request shows the `docker` check running the trust
  step. The owner chose **done**, the recommendation.

- **2026-10-05, `awaiting` added** — from the review of repo-88's answer (PR
  #357). The landing entry above names the first real bump pull request as the
  remaining confirmation, and nothing in the frontmatter did. `gh pr list
--state all --search "yt-dlp in:title"` showed no bump pull request today, so
  the clause is still owed. Whoever reads that pull request's checks deletes
  the line.
