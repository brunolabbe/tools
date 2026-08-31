---
id: dl-16
tool: downloader
title: Drive the browser sniffer end to end, through the UI
kind: chore
status: done
milestone: null
depends_on: [dl-12]
---

# dl-16 — The one path nothing tests in one piece

**Area:** `tools/downloader/e2e/` — a new spec, a player page for the fixture
origin, and a second Playwright project.

## Why

The browser sniffer is the reason this product can claim "any website".
[02-ROADMAP.md](../02-ROADMAP.md) is explicit about it: dl-2 was the critical
path, the extractor tier is a speed optimisation layered on top, and the system
is supposed to be fully functional with `ENABLE_YTDLP_RESOLVER=false`.

And the end-to-end suite turns it off. `playwright.config.ts` sets
`ENABLE_BROWSER_RESOLVER: "false"` and runs the direct tier alone — for a good
reason at the time, written into the config: the sniffer has its own tests
against its own fixtures, and dragging Chromium into a UI test makes it slow.

The consequence is that the product's headline capability is proven in pieces
and never in one:

- `resolvers/test/browser/` drives a real Chromium against `mse.html` — with
  **fake parsers**, by design, so the assertions did not wait on dl-1.
- `engine/test/hls-e2e.test.ts` downloads a real stream — from a
  `ProbeResult` handed to it directly.
- `e2e/download.spec.ts` runs the whole stack — with the sniffer disabled.

Nothing anywhere takes a page whose `<video>` carries a `blob:` URL, finds the
stream at the network layer, hands it to the engine, and shows a file to a user.
That is the sentence the tool's `CLAUDE.md` opens with.

There is a second thing only this test can prove. Since
[dl-12](./dl-12-tiers-behind-the-egress-proxy.md), the browser tier fetches
through the loopback egress proxy, and Playwright passes
`--proxy-bypass-list=<-loopback>` so even `127.0.0.1` goes _through_ it. A
fixture origin on loopback therefore reaches the page only because
`SSRF_ALLOW_HOSTS` opened the guard. That interaction — sniffer, proxy, guard,
loopback fixture — currently exists only in unit tests that stub one of the four.

## Build

1. **Give the fixture origin a player page.** `e2e/fixtures/hls-origin.ts`
   already generates a real HLS stream with ffmpeg and serves it; add an
   `/watch` page to the same server that plays it through **MSE**, so the
   `<video>` element's `src` is a `blob:` URL and the manifest is reachable only
   by watching the network. A page with a plain `<video src="…m3u8">` would be
   found by the direct tier and would prove nothing.
   `resolvers/test/fixtures/pages/mse.html` is the worked example; copy its
   shape rather than its file, since this one has to point at a generated
   stream on an ephemeral port.
2. **A second Playwright project, not a second config.** The sniffer suite needs
   a different server environment — `ENABLE_BROWSER_RESOLVER: "true"` — and
   `webServer` is per-config, so this is either a second config file or a second
   `webServer` entry. Keep `npm run e2e:downloader` meaning "the fast one" and
   add `npm run e2e:downloader:sniffer`; CI runs both, a developer running the
   suite between edits runs the first. Say in the Log which shape you chose,
   because Playwright offers three and two of them are traps.
3. **The spec, and it is one spec.** Paste the `/watch` URL, get variants back
   that came out of a real manifest via a real parser, pick one, download, and
   assert on the file the way `download.spec.ts` does — `ftyp` at bytes 4–8 and
   more than one `.ts` segment fetched from the origin. Then assert the thing
   that makes it a sniffer test: the origin saw the request for the **page**,
   and the master playlist URL never appeared in the page's HTML.
4. **Keep yt-dlp off.** `ENABLE_YTDLP_RESOLVER: "false"`, and say so in a
   comment. M2's acceptance criterion is that the capability survives without
   the extractor tier; a test that lets yt-dlp answer first is testing the
   optimisation.
5. **Wire it into CI.** `.github/workflows/downloader.yml` already installs
   Chromium and the distribution's ffmpeg for the e2e job. Add this as its own
   step or its own job so a failure names which suite failed, and keep the
   artefact upload — a sniffer failure is exactly the case where the trace is
   the whole diagnosis.

**Traps.**

- **The API needs Chromium at run time**, not just Playwright. `e2e:install`
  fetches it and `BrowserPool` uses the same install, but the API is started by
  `webServer` from the repo root, so check the browser resolves from there
  before assuming a probe failure is a sniffer bug.
- **`SSRF_ALLOW_HOSTS: "127.0.0.1"` is load-bearing twice** — once for the
  direct fetches and once for everything the page itself requests through the
  proxy. If the page loads but no stream is ever captured, suspect the guard
  before the capture rules.
- **A sniffer probe takes 10–20 s and waits for network quiet.** The config's
  180 s test timeout covers it; the UI's own analysing panel is what the user
  sees for that whole time, so this test is also the only proof that panel is
  not a 20-second blank screen.
- **Memory.** The API launches a browser while Playwright is already running
  one, on the same runner. `workers: 1` and `fullyParallel: false` are already
  set; keep them, and keep this suite to the one spec.
- **A dedicated Chromium per probe would be a regression.** dl-12 step 2 keyed
  the shared browser on its proxy so that the always-set proxy does not force a
  fresh launch every time. If this suite is slower than it should be, check
  `stats.launched` on `/api/health` before optimising anything else.

## Done when

- A user journey that starts at an MSE page and ends at a playable file passes
  in a real browser, with `ENABLE_YTDLP_RESOLVER=false` and the direct tier
  unable to help.
- The spec fails if the sniffer is disabled — run it once with the sniffer off
  and confirm it goes red rather than falling through to a tier that happens to
  cope. **Not as an environment variable.** The brief originally said
  `ENABLE_BROWSER_RESOLVER=false <the suite>`, which passes green having changed
  nothing: Playwright spreads a config's `webServer.env` over `process.env`, so
  the `tiers` literal in `playwright.sniffer.config.ts` wins. Edit that value.
  Gate 1 found this; see the Log.
- The existing `npm run e2e:downloader` is unchanged in scope and in runtime.
- CI runs both suites on a downloader change and names them separately.
- "The E2E suite drives only the direct resolver" stops being true, and this
  ticket's frontmatter goes to `done` in the commit that earns it — that is the
  only place the gap is recorded, and `npm run status` is the only view over it
  (repo-1, repo-2). **The container's
  browser tier stays smoke-tested only**: this ticket does not reach it, and
  should not claim to. Say so in the Log rather than leaving it unsaid.

## Gates

### Gate 1 — 2026-08-31, PASS (reviewed at `461e9dd`)

Sonnet reviewer against an Opus build. Two `low` findings, no CONCERNS, nothing
above `low`. Applied on top; the fixes are in the commit that carries this
record.

**Independently reproduced, and this is the load-bearing one.** The reviewer
built its own throwaway two-project, two-`webServer` config on Playwright 1.62.1,
ran it with `--project fast` and `DEBUG=pw:webserver`, and saw both servers start
and both ports come up before any test ran. The two-config shape rests entirely
on that fact and it is now measured twice, by two agents, independently. The
reviewer also confirmed `npm run e2e:downloader` is **identical** at base and at
tip — 3 passed, 6.2 s, same test names — rather than merely close.

**Finding 1: the ticket's own falsification instruction produced a false green.**
"Run it once with `ENABLE_BROWSER_RESOLVER=false`" reads as obviously runnable
and does nothing. Reproduced here both ways before fixing: the environment
variable in front of `npm run e2e:downloader:sniffer` gives **1 passed in 6.9 s**;
editing the `tiers` value in `playwright.sniffer.config.ts` gives the red.

_The mechanism, which is worth more than the corrected sentence._ Playwright's
web-server plugin builds the child environment as
`{ ...DEFAULT_ENVIRONMENT_VARIABLES, ...process.env, ...options.env }` — read
out of the bundled `playwright/lib/runner/index.js`, not inferred. The config's
`env` is spread **last**, so it wins over the shell. The instruction reads as
runnable because **the same command line does work for a variable no config
names**: every measurement on this ticket was taken with
`FFMPEG_PATH=/usr/bin/ffmpeg` in front of it, and that one reaches the API
because neither config sets it. One variable lands and the next is silently
discarded, and nothing at the call site distinguishes them. That is the shape to
recognise: **an environment variable is overridable only if no config on the path
names it**, and the list of names is in a file you are not looking at.

_Anything else in the repo with the same shape._ Audited, and yes:

- `serverEnv()` in `playwright.config.ts` pins `SSRF_ALLOW_HOSTS`,
  `RATE_LIMIT_PROBE_PER_MINUTE`, `RATE_LIMIT_JOBS_PER_MINUTE`, `LOG_LEVEL` and
  the whole tier list for **both** downloader suites. All equally immune, all
  pre-existing.
- `tools/planner/playwright.config.ts` pins `MODEL_PROVIDER: "scripted"`, whose
  own comment says it is named "so this suite says out loud that it talks to no
  model". Someone reaching for `MODEL_PROVIDER=anthropic npm run e2e:planner` to
  smoke-test a real provider gets a scripted run and a green. **Same shape,
  another tool, not fixed here** — it is the planner's file, pl-36 is live in
  that tool this batch, and it deserves its own ticket rather than a drive-by.
- The `ENABLE_BROWSER_RESOLVER=false … npm run dev -w @downloader/api` recipe in
  the tool's `CLAUDE.md` is **not** an instance: it invokes the API directly with
  no Playwright in between, so those variables do reach it. Left alone.

_Fixed rather than only documented._ `serverEnv` and the sniffer config's `tiers`
literal both carry the override direction now, the ticket's "Done when" bullet
says to edit the value, and the Log below says the same. The tiers stay literals:
a tier list an ambient variable could flip is a suite that can silently be
testing something else, which is this finding pointing the other way.

**Finding 2 (`low`): the blanket `.catch(function () {})` in the fixture
player.** Taken, not documented. The reviewer's reasoning holds — this page runs
inside the **API's** Chromium, so nothing it writes to its own DOM is ever on a
screen the test can see, and a swallowed failure surfaces only as a 120-second
timeout with no cause. Three changes: the `catch` now beacons to
`PLAYER_ERROR_PATH` on the fixture origin, which the test process can already
see; a non-`ok` response is turned into a rejection by the new `get` helper,
because a 404 does not reject a `fetch` and a typo'd fixture path is far likelier
than a socket error; and `mse-page.spec.ts` asserts `playerErrors()` is empty and
attaches them to the Playwright report from `afterEach`. **Made to fail first:**
pointing one fixture path at a missing file produced
`/player-error?reason=Error%3A%20HTTP%20404%20for%20%2Fseg999-does-not-exist.ts`
in both the assertion diff and an attachment — and the download still succeeded,
which is exactly the half-working fixture that used to pass silently.

The other two branches the reviewer flagged are documented, not changed. The
`try`/`catch` around `addSourceBuffer` is reachable and load-bearing (MPEG-TS is
not an MSE format); the `"none"` fallback in `announceSource` is dead on the
direct call and kept for the `sourceopen` listener, which nothing in the file
orders against the assignment.

**Recorded, not fixed: the falsification red is racy.** The reviewer got it at
two different lines inside the analysing-panel block on two runs. Both are inside
the block whose own comment already says it is where the suite goes red first
without naming a line, so the comment is honest as written — but the next person
should expect the line to move.

**Two legs are not verifiable from this machine, and neither is claimed.**

- **The job has never run on a GitHub runner.** Everything here ran against a
  `webServer` on this host with the distribution's ffmpeg. "Green in CI" is a
  claim only the first run can make, and the matrix rename lands with it.
- **The ruleset read is inherited and now 8 days stale.** The safety of renaming
  the check from `e2e` to `e2e (…)` rests on the note in `ci.yml` recording that
  `main` carried no `required_status_checks` rule and no classic protection when
  it was read on 2026-08-23. `gh api` is denied in this environment; the reviewer
  correctly did not attempt it and neither did I. **Clearing this needs someone
  with `gh api` access to re-run the rulesets and branch-protection reads close
  to merge time**, since a ruleset can change between that read and the squash
  that lands the rename. Until then it is a disclosed inherited risk, not a
  checked one.

**Fold-in requested and declined on measurement: the planner's Playwright config
does not have the gap.** My own build report claimed
`tools/planner/playwright.config.ts` shared the typecheck hole I closed for the
downloader, and that claim was wrong — `tools/planner/e2e/tsconfig.json` has
carried `"../playwright.config.ts"` in its `include` since pl-13, with a comment
explaining why. Proved rather than read: planting a deliberate type error in that
file makes `npm run typecheck` fail on it today, at base. There is nothing to
fold in, no planner path is touched, and the commit stays `test(downloader)`
rather than `test(repo)` — a `test(repo)` subject would validate but would be
describing work that does not exist. The correction is mine to own; the reviewer
relayed my error faithfully.

### Gate 2 — 2026-08-31, PASS, zero findings (reviewed at `eb0abec`)

Not one `low`. Every item from gate 1 reproduced independently, and none of it
broke under a harder push than my own repro. What it did that gate 1 and I did
not:

- **Re-ran the superseded instruction.** `ENABLE_BROWSER_RESOLVER=false` in front
  of the sniffer suite **still passes**, which is what makes the corrected
  wording provable rather than asserted: the false green is still demonstrably a
  false green, so the sentence that replaced it is describing something real.
- **Enumerated every statically-bound port in the repository** rather than
  sampling one — 8099 downloader fast, 8097 sniffer, 8098 planner, 5173/5183
  vite, 8080/8090 containers, and every other `.listen()` in the repo binding
  `0` and so collision-proof by construction. **8097 collides with nothing.**
  That is the check my own fix deserved and did not get: I moved off 8098 having
  noticed one conflict, not having looked for the rest.
- **Traced the beacon's own `catch`** to confirm it is not the blanket-catch
  pattern reapplied. It is not: `requests.push(url)` runs unconditionally at the
  top of the fixture server's request handler, so the URL is recorded the moment
  the request lands regardless of what the handler does next, and the beacon
  route answers `204` rather than falling through to 404 — so a beacon cannot
  look like a second failure in the log it exists to explain.

**Folded in on the user's instruction: the planner's `MODEL_PROVIDER`.** The
same-shape instance this ticket's gate-1 audit found is now documented where
someone would hit it, at the `webServer.env` block in
`tools/planner/playwright.config.ts`. **A comment only — nothing the config pins
was changed**, for the reason the tiers stay literal here: a provider an ambient
variable could flip is a suite that can silently be testing something else.
Reproduced before writing it rather than relayed: `MODEL_PROVIDER=anthropic
npm run e2e:planner` gives **4 passed in 12.0 s**, indistinguishable from a plain
run. Checked against the two branches live in this batch before writing —
`gh pr view` on pl-36 lists `agent/`, `api/`, `web/` and its own ticket, and on
repo-5 lists the two `vite.config.ts` files, `packages/core` and its ticket.
Neither touches this file.

**The dispatching agent corrected itself on the planner tsconfig**, having
relayed my earlier false premise as an instruction without checking it. The
premise was mine; it was caught by planting a type error at base rather than by
re-reading, which is the only reason it was caught at all.

**The disclosed inherited risk stands unchanged.** Renaming the check from `e2e`
to `e2e (…)` still rests on the ruleset read recorded in `ci.yml` on 2026-08-23,
now stale, and still unrefreshable from here because `gh api` is denied. Clearing
it needs someone with that access to re-run the rulesets and branch-protection
reads close to merge time. Gate 2 did not clear it and did not claim to. The
other unverifiable leg is unchanged too: **the job has never run on a GitHub
runner**, and PR #122's own run is the first.

### Gate 3 — 2026-08-31, PASS (reviewed at `e8925ce`)

Defect hunt run by the reviewer at `medium`, over `origin/main...e8925ce`.

Reviewed tip `e8925ce` confirmed via `git log --oneline -1` after
`git fetch origin && git checkout --detach e8925ce` — a merge commit bringing
`origin/main` into the branch. The branch's own work is `461e9dd` then `eb0abec`
then `2878890`. The range excludes the unrelated repo-5 content that reached
`origin/main` independently and is only being caught up here: `git diff --stat
eb0abec e8925ce` shows `docs/work/repo-5-*.md`,
`packages/core/test/host-resolution.test.ts` and two `vite.config.ts` files, none
of which appear in `origin/main...e8925ce`.

**What this gate re-derives vs. inherits.** The ticket already carries two PASS
gates. Their reasoning was not re-run from scratch, but neither was taken on
faith — the load-bearing claims were independently reproduced from a clean
worktree rather than read back out of the Log:

- `npm run e2e:downloader`: 3 passed (8.4s); `download.spec.ts` untouched by this diff.
- `npm run e2e:downloader:sniffer`: 1 passed (11.8s).
- The false green reproduced: `ENABLE_BROWSER_RESOLVER=false npm run
e2e:downloader:sniffer` still passes.
- The genuine red reproduced: editing `ENABLE_BROWSER_RESOLVER` to `"false"` at
  `playwright.sniffer.config.ts:71` fails at `mse-page.spec.ts:89` with
  `expected 5, Received 0`. File restored, `git status --porcelain` clean.
- The new configs are typechecked, not merely present: a planted type error in
  `playwright.sniffer.config.ts` makes `npm run typecheck` fail at
  `tools/downloader/e2e/tsconfig.json`. Reverted.
- `npm run check` green. `npm test`: 1765 passed (115 files) — the +2 over the
  Log's 1763 is repo-5's tests merged in from `origin/main`, not this branch's work.
- Every hardcoded e2e port grepped: 8097 sniffer, 8098 planner, 8099 direct. No
  collision, independently confirming gate 2's audit.
- `oxlint` on the four touched TS files: clean.

**New evidence beyond both prior gates: the CI leg has now actually run on this
exact sha.** Both earlier gates disclosed "the job has never run on a GitHub
runner" as an open risk. That is no longer true. Run `33445623826`, at headSha
`e8925ce`, shows `e2e (direct)` SUCCESS (`3 passed (8.1s)`), `e2e (sniffer)`
SUCCESS (`1 passed (12.7s)`, naming `mse-page.spec.ts:63`) and `docker` SUCCESS.
This upgrades several rows below from `unproven (gate)` to `verified` — not
because the local gates changed, but because the run log for the reviewed sha was
read rather than the gate being reported as run without checking.

| Done when                                                                                                                                                        | Proof                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MSE-page journey passes in a real browser, `ENABLE_YTDLP_RESOLVER=false`, direct tier unable to help                                                             | verified — `e2e/sniffer/mse-page.spec.ts:63`, tiers at `playwright.sniffer.config.ts:71-76`; reran locally (1 passed) and confirmed on Actions run 33445623826, job `e2e (sniffer)`, at this exact sha, SUCCESS                                        |
| Spec fails if the sniffer is disabled — via the config value, not an env var                                                                                     | verified — reproduced both ways: env var gives a false green (1 passed); editing the `tiers` literal gives a genuine red at `mse-page.spec.ts:89`, `expected 5, Received 0`                                                                            |
| `npm run e2e:downloader` unchanged in scope and runtime                                                                                                          | verified — `download.spec.ts` untouched by the diff; reran, 3 passed (8.4s here vs 6.1s in the Log — different host, same count, same test names)                                                                                                      |
| CI runs both suites on a downloader change, named separately                                                                                                     | verified — `downloader.yml` matrix (`e2e (direct)`, `e2e (sniffer)`), and the actual PR #122 run at `e8925ce` shows both checks by those exact names, both SUCCESS; path filters checked against every touched file via the `paths:` list, all covered |
| "The e2e suite drives only the direct resolver" stops being true; frontmatter to `done`; container tier stays smoke-tested-only and that gap is said, not hidden | proven — `tools/downloader/CLAUDE.md` and dl-2's Log rewritten accordingly; `npm run status -- --show dl-16` reports `status: done`                                                                                                                    |

**Unverifiable, disclosed, not attempted.** Whether any branch-protection ruleset
on `main` requires the check name `e2e`, which this branch renames to
`e2e (direct)` / `e2e (sniffer)`. `gh api` is denied in this environment and was
not attempted, nor was another spelling sought. The safety claim rests on the
ruleset read recorded in `ci.yml` (2026-08-23: no `required_status_checks` rule,
no classic protection). That comment says what the ticket says it says, but it is
now 8 days old and cannot be refreshed from here. Same status as both prior
gates; not resolved by this one either.

**Defect hunt.** Walked the new spec, the fixture player, both Playwright configs,
the CI matrix and the two doc edits line by line. Traced the fixture player's
event ordering (`sourceopen` listener registered before `video.src` assignment —
no race), the `fetching` guard against double-invocation from both `sourceopen`
and `play`, the beacon's unconditional `requests.push` ahead of any handler
branching (so a beacon cannot shadow a failure in its own log), and the
distinct-segment-name assertion against the fixture's re-probe behaviour. Checked
the repo invariants plausibly reachable from this diff: no shell (the fixture
spawns ffmpeg via an argument array, pre-existing and untouched), no new
`AppError` or error-code surface, no new workspace dependency and so no
Dockerfile-closure question, no contract touched, style clean. Nothing reachable
was skipped.

- **findings** · 0 returned, 0 carried, 0 dropped. No high, med or low from this
  pass — everything either reproduced clean or matched what gates 1 and 2 already
  fixed (both of gate 1's lows are in the reviewed diff: the beacon-based
  `PLAYER_ERROR_PATH` replacing the blanket catch, and `afterEach` asserting
  `playerErrors()` is empty).
- NFR: security — n/a to new code (local-fixture-only server, no credentials, no
  third-party egress) · performance — CI cost additive but bounded (~13s wall on a
  second runner), a trade the ticket names · reliability ✓ — `fail-fast: false`
  keeps one leg's failure from masking the other's; the sniffer suite ran four
  times this session with no flake · maintainability ✓ — the `shared`/`serverEnv`/
  `apiServer` exports keep the two configs from drifting, confirmed non-cosmetic by
  the planted type error above.

Every acceptance line proven or verified, nothing above low, zero new findings.
One leg remains genuinely unverifiable from this environment and is carried
forward unchanged: it needs `gh api` access close to merge time.

## Log

**2026-08-30 — Built. Two config files, not two projects, and the brief's step 2
had it the other way round.**

The step is headed "A second Playwright project, not a second config" and then
allows either in its own body. It is the second config, and the reason is
measurable rather than aesthetic: **Playwright starts every `webServer` entry in
a config whatever `--project` selects.** Measured on the pinned 1.62.1 with a
throwaway two-project, two-server config — running `--project fast` printed both
`SERVER-ONE-STARTED` and `SERVER-TWO-STARTED`. So "one config, two projects, two
servers" would make `npm run e2e:downloader` boot the sniffer's API, build the UI
a second time and hold a second port for a suite it is not running, which fails
this ticket's own "unchanged in runtime" criterion. The third shape — one server
with the sniffer on for both suites — is worse: the sniffer is priority 50 and
the direct tier 90, so every probe in the fast suite would go through a browser.
Two of the three really are traps, as the brief says; it just named the wrong one
as the survivor.

What that costs: the fast config now exports `shared`, `serverEnv()` and
`apiServer`, and `playwright.sniffer.config.ts` imports them, so the two cannot
drift on a timeout or a reporter. The base config gains one
`testIgnore: "**/sniffer/**"`; the sniffer suite lives in `e2e/sniffer/` and the
sniffer config's `testDir` is that directory.

**Measurements, all on this machine with `FFMPEG_PATH=/usr/bin/ffmpeg`:**

- `npm run e2e:downloader:sniffer` — 1 passed, 7.5 s of test, 17.0 s wall.
- `npm run e2e:downloader` — 3 passed, 12.6 s wall, one `webServer`, and the
  server logs the "browser sniffer is disabled" warning it always did. Unchanged
  in scope and in runtime.
- `npm test` — 1763 passed, 42 s. `npm test -- --project downloader` — 824
  passed, 39 s. `npm run check` — green.

**The falsification run was done twice, because the first one went red for a
weak reason.** With the sniffer disabled — by editing `tiers` in
`playwright.sniffer.config.ts`, not by an environment variable; see the gate
record — the suite fails at the
_analysing panel_ — "expected 5 list items, got 0" — because the direct tier
refuses an HTML page in under a second and the panel is gone before the count
resolves. Red, but not a red that names anything. Re-run with that block
temporarily removed, it fails where it should: no `[blob]` heading after 120 s,
and the captured page snapshot shows the alert `No video found` /
"No downloadable video stream was found on that page." So there is **no
fallthrough to a tier that happens to cope** — that is the claim, and it is
measured rather than argued. The analysing block stays, with a comment above it
saying exactly this, because Playwright prints the surrounding source in a
failure and a signposted confusing failure is worth more than a missing
assertion.

**The fixture page is deliberately stricter than `mse.html`.** That file spells
`/media/mse/master.m3u8` in a script tag; a scraper could still solve it, and a
suite passing against it would be passing for the wrong reason. `/watch` carries
the paths base64-encoded and decodes them at run time, so the assertion at the
end of the spec is the strong one: the markup contains no `.m3u8` at all. The
player fetches master → media playlist → one segment strictly in sequence, which
is not stylistic — `rank.ts` scores `master.m3u8` and `index.m3u8` identically
except for `seq`, so fetching them concurrently would leave the tiebreak to a
race and the variant count flapping between 2 and 1.

**Two things about the assertions that would otherwise look like padding.** The
segment check counts **distinct** names from a mark taken at the Download click,
not a total: the API re-probes before downloading (the standing rule), the
re-probe replays the page, and the page fetches one segment each time — so a
plain count would be satisfied without ffmpeg pulling anything. And the
analysing-panel block is the only test anywhere that watches the 10–20 s wait the
user actually sees; the elapsed counter reaching a second is what separates a
live panel from a static one.

**Folded in, since this branch made them free:**

- Both Playwright configs are now typechecked. They were in no `tsconfig` at all
  — the root solution references `tools/downloader/e2e`, whose `include` is
  rooted at `e2e/` — so `defineConfig` was checked by nobody, which is the same
  hole dl-13 closed for the specs themselves. Two named entries in
  `e2e/tsconfig.json`, verified by planting a type error in the new config and
  watching `npm run typecheck` fail on it. `tools/planner/playwright.config.ts`
  has the identical gap and is **not** fixed here: it is another tool's file and
  another tool's `tsconfig`, and this branch has no reason to touch it. Worth a
  `repo-` ticket if anyone wants symmetry.
- `tools/downloader/CLAUDE.md` said "The suite runs the direct resolver only",
  which this ticket makes false. Rewritten, with the config-versus-project
  reasoning where the next person will hit it.

**CI: one job, a two-leg matrix, separate runners.** `e2e (direct)` and
`e2e (sniffer)`, `fail-fast: false`, one artefact upload per leg under its own
name. Separate runners rather than a second step in one job, because the memory
trap in this brief is real — the sniffer leg has Playwright's Chromium and the
API's Chromium alive together — and the price is one extra `npm ci`, build and
browser install. Renaming the check from `e2e` to `e2e (…)` is safe against the
ruleset reading recorded in `ci.yml` (2026-08-23: no `required_status_checks` on
`main`, no classic protection); `gh api` is denied here, so that is an inherited
reading and not one this session re-took.

**The path filters were checked, not assumed.** Every non-`.md` file this branch
touches is selected by `downloader.yml`'s `paths:` — `tools/downloader/**` covers
the configs, the spec, the fixture and the tsconfig, and `package.json` and the
workflow are named outright. Run through `minimatch` rather than eyeballed. One
caveat, recorded because it is the kind of thing that gets claimed and should not
be: the harness does **not** validate the trailing `!**.md`, because minimatch
treats `**` as a single path segment there and GitHub's matcher does not. That
leg is unchanged by this ticket and its behaviour is inherited, not re-measured.

**Not done, and not claimed.**

- **The container's browser tier stays smoke-tested only.** Chromium launches and
  renders inside the image; no probe of a real MSE page has ever run from inside
  a container, and this ticket does not reach it. Everything above ran against a
  `webServer` on the host. dl-2's Log carries the same gap and now points here
  for the half that closed.
- `stats.launched` on `/api/health` was never read. The brief suggests it as the
  first thing to check if the suite is slow; at 7.5 s for two probes it is not
  slow, so the dedicated-browser regression is ruled out by runtime rather than
  by the counter. If this suite ever creeps, that counter is still the place to
  look and is still unmeasured here.
- The suite has never run on a GitHub runner. It has run on this machine with the
  distribution's ffmpeg, which is what CI uses, but "green in CI" is a claim only
  the first run can make.

**2026-08-31 — gate 1 applied.** The falsification instruction in this ticket was
wrong in a way that produced a false green, the fixture player's blanket `catch`
is gone, and the sniffer suite's default port moved from 8098 to 8097 because
`tools/planner/playwright.config.ts` already defaults to 8098 — a collision I
introduced and neither the build nor the gate would have caught until someone ran
the planner and the sniffer suites at once. All three are in the gate record
above.

**2026-08-31 (later) — gate 2 applied.** Zero findings. The only change it
carries is the one the user asked for rather than filed: the planner's
`MODEL_PROVIDER` pin is now documented as un-overridable, a comment and nothing
else. Gate 2 also enumerated every statically-bound port in the repo and
confirmed 8097 collides with nothing, which is the check the port fix above
deserved and had not had.
