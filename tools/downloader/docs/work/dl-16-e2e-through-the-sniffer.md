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
- The spec fails if the sniffer is disabled — run it once with
  `ENABLE_BROWSER_RESOLVER=false` and confirm it goes red rather than falling
  through to a tier that happens to cope.
- The existing `npm run e2e:downloader` is unchanged in scope and in runtime.
- CI runs both suites on a downloader change and names them separately.
- "The E2E suite drives only the direct resolver" stops being true, and this
  ticket's frontmatter goes to `done` in the commit that earns it — that is the
  only place the gap is recorded, and `npm run status` is the only view over it
  (repo-1, repo-2). **The container's
  browser tier stays smoke-tested only**: this ticket does not reach it, and
  should not claim to. Say so in the Log rather than leaving it unsaid.

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
weak reason.** With `ENABLE_BROWSER_RESOLVER=false` the suite fails at the
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
