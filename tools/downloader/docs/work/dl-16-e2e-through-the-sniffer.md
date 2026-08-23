---
id: dl-16
tool: downloader
title: Drive the browser sniffer end to end, through the UI
kind: chore
status: ready
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
  only place the gap was recorded, since `03-STATUS.md` is generated from the
  frontmatter and carries no hand-written gap list (repo-1). **The container's
  browser tier stays smoke-tested only**: this ticket does not reach it, and
  should not claim to. Say so in the Log rather than leaving it unsaid.

## Log

_Not started._
