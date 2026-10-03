---
id: dl-73
tool: downloader
title: Prove in CI that the shipped yt-dlp trusts the terminating proxy, now that YouTube depends on it
kind: work-package
status: ready
milestone: null
depends_on: [dl-72]
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
