---
id: repo-131
tool: repo
title: One header and one footer in `@webtools/ui`, lifted from the downloader's
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: hard
---

# repo-131 — One header and one footer for every tool

## Why

The owner asked on 2026-10-25 for the header and footer to look the same in
every tool: theme buttons in the header, the tool's version and a terms link in
the footer. At `origin/main@01e80b71` the three tools each do it differently:

| Tool       | Header                                                         | Theme                                        | Footer                                           |
| ---------- | -------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| downloader | `<header className="topbar">`: name, tagline, `ThemeToggle`    | system / light / dark radios, `localStorage` | link to `/terms.html`                            |
| planner    | none: `<h1>` and `.lede` sit inside `<main className="shell">` | none, OS only                                | `/health` fetch: server version, provider, model |
| ledger     | `<header>`: name and subtitle, three copies in `App.tsx`       | none, OS only                                | `/health` fetch: server version                  |

Three consumers is more than the second-consumer rule in
`.claude/rules/ui-package.md` asks for. The downloader already has the theme
control and its tests, so the components move **from** it, as that rule says.
This ticket builds the shared pieces and switches the downloader over.
[pl-65](../../tools/planner/docs/work/pl-65-the-shared-header-footer-and-a-terms-page.md)
and [lg-72](../../tools/ledger/docs/work/lg-72-the-shared-header-footer-and-a-terms-page.md)
adopt them, one pull request per tool, so that each changelog line names a
single tool.

## Decision — answered 2026-10-25 by the owner

Asked as options in the session that filed this ticket.

- **Header: name, tagline, theme control.** Chosen over name and theme only, and
  over adding a switcher between tools.
- **Logo: one glyph per tool, also used as the favicon.** Chosen over one shared
  mark and over no logo. Each tool owns an inline SVG drawn with `currentColor`,
  so it follows the theme. The same drawing ships as `public/favicon.svg`;
  today no tool has a favicon.
- **Theme control: segmented, three choices**, the downloader's control with
  icons added. Chosen over one button that cycles and over a dropdown.
- **Theme follows you across tools**, through a cookie on the parent domain.
  Chosen over one choice per tool. The tools are separate subdomains
  (`downloader.oludoi.com`, `planner.oludoi.com`), so `localStorage` cannot
  carry the choice between them.
- **Footer: version, Terms, Source.** The version links to that tool's GitHub
  release. The repo is public (`brunolabbe/tools`, checked 2026-10-25), and
  release tags read `<tool>-v<version>`, e.g. `planner-v0.10.0`.
- **The version is built into the bundle, and the footer health fetch goes
  away.** Chosen over adding a "degraded" marker and over keeping the runtime
  fetch. Why, as the owner asked: each tool's Fastify process serves both the page
  and the API, and there is no service worker. If the page loaded, the server
  was up a moment earlier. The footer's "Checking the server…" and failure
  states could only show in a deploy drain, a degraded `ok: false`, or an
  expired Access session, and in that last case every feature already reports
  its own typed error. Planner's provider and model stay in `/health` for
  operations and leave the UI.

## Build

1. **Theme, from `tools/downloader/web/src/lib/theme.ts`.** Move it to
   `packages/ui` with its tests, then change the storage:
   - one cookie, `webtools-theme=light|dark`. `system` deletes the cookie;
   - `Domain=` is the hostname minus its first label when the hostname has at
     least three labels and is not an IP address, so
     `downloader.oludoi.com` → `oludoi.com`. Otherwise leave `Domain=` out, so
     the cookie stays host-only. Cookies ignore the port, so the dev servers on
     `localhost` share it anyway. Add `Path=/`, a one-year `Max-Age`,
     `SameSite=Lax`, and `Secure` on `https:`;
   - migration: when there is no cookie and `downloader:theme:v1` is in
     `localStorage`, copy its value to the cookie and remove the key;
   - keep `applyTheme`'s behaviour exactly: `system` removes `data-theme`, so
     `prefers-color-scheme` stays in charge.

   **Trap: no inline script.** The downloader's CSP is `script-src 'self'`
   (`tools/downloader/api/src/routes/web.ts`, dl-35). Read the cookie and call
   `applyTheme` at the top of `main.tsx`, before `createRoot`. Do not add a
   `<script>` to `index.html`.

2. **`ThemeToggle`**, from `tools/downloader/web/src/components/ThemeToggle.tsx`,
   with its tests. Add an icon to each choice (system, light, dark). The visible
   text can go only if the accessible name stays, and the control has to stay
   reachable by keyboard. It must fit beside the tool's name and glyph at
   360 px. **Each segment is at least 44px tall**, the tap-target floor
   repo-130's base layer sets for every button and field (owner, 2026-10-25).
   The downloader's segments are about 28px by its stylesheet's numbers (`0.8rem`
   text at 1.55 line height, `0.25rem` padding), not measured. The layout spec
   asserts the height at 360 px. A choice hides its radio with the shared
   `.sr-only`, not the downloader's `.visually-hidden`, which repo-130 retires.

3. **`AppHeader`**: `{ name, tagline, glyph }`, where `glyph` is a `ReactNode`
   the tool supplies. It renders `<header>` with the glyph, the `<h1>`, the
   tagline and the `ThemeToggle`, and owns the theme state, so a tool does not
   carry it in `App`. No other props: the rule says a prop arrives with the use
   that needs it.

4. **`AppFooter`**: `{ tool, version, termsHref }`. It renders
   `v<version>` · Terms · Source:
   - version → `https://github.com/brunolabbe/tools/releases/tag/<tool>-v<version>`;
     when the version is `unknown`, link to
     `…/blob/main/tools/<tool>/CHANGELOG.md` instead;
   - Source → `…/tree/main/tools/<tool>`;
   - Terms → `termsHref`.

   Keep the repository URL in one constant in `packages/ui`.

5. **Version at build time.** Each tool's `web/vite.config.ts` reads
   `../api/package.json` and passes `define: { __TOOL_VERSION__: … }`.
   release-please bumps that file (`extra-files` in
   `release-please-config.json`), and the Docker build stage copies the whole
   tool directory before `npm run build`, so the image's bundle carries the
   released version. Declare the global once, in `packages/ui`'s types. Vite
   configs deliberately share nothing through a package (repo-5; see the
   `HOST` docblock), so each config carries its own two lines.

   _Narrowed by the owner, 2026-10-31 (Log):_ this ticket adds the `define` to
   `tools/downloader/web/vite.config.ts` only. "Each tool's" above is
   superseded and kept for the record; the ledger's and the planner's configs
   are lg-72's and pl-65's.

6. **Styles.** Move `.topbar`, `.themetoggle` and `.footer` out of the
   downloader's `styles.css` into a stylesheet exported from `packages/ui`,
   built on the shared token names only. A tool's own stylesheet loads after it
   and can still override it.

7. **The downloader adopts it.** `App.tsx` uses `AppHeader` and `AppFooter`. Add
   a glyph (a downward arrow, or whatever reads best at 16 px) and
   `web/public/favicon.svg` with a `<link rel="icon">`. `img-src 'self'`
   allows a same-origin SVG; a `data:` URL would be refused. `terms.html` is
   static, so it has to honour the theme from the cookie, or a reader who chose
   dark opens a light page. Load a small same-origin module for that, not an
   inline script.

8. **Package plumbing.** These are the first `.tsx` files in `@webtools/ui`:
   - React goes in `peerDependencies`;
   - decide whether the package exports TypeScript source, which Vite compiles,
     or a built `dist`, and record the measured reason in the Log. The `HOST`
     docblock in `vite.config.ts` names one way a built dependency fails:
     a missing `dist` stops Vite with an error that blames a `package.json`;
   - make the `core` vitest project run the component tests, which may need
     jsdom (`.claude/rules/testing.md`);
   - `packages/core/test/image-closure.test.ts` must still pass.

**Ordering.** repo-130 (open, `needs-decision`) also edits
`packages/ui/src/tokens.css` and `packages/ui/test/tokens.test.ts`. Neither
ticket blocks the other. Whichever lands second rebases.

## Done when

- `@webtools/ui` exports `AppHeader`, `AppFooter`, `ThemeToggle` and the theme
  functions. The downloader imports them, and
  `tools/downloader/web/src/lib/theme.ts` and
  `tools/downloader/web/src/components/ThemeToggle.tsx` no longer exist.
- Unit tests prove the cookie's `Domain` for `downloader.oludoi.com`,
  `localhost` and `127.0.0.1`; that `system` deletes the cookie; and the
  one-time migration from `downloader:theme:v1`.
- Unit tests prove the footer's release link, the `unknown` fallback to
  `CHANGELOG.md`, and the Source link.
- The downloader's built bundle contains the version from
  `tools/downloader/api/package.json`. A test or build assertion shows it.
- `e2e/csp.spec.ts` still passes, and a case in it, or a new one, shows that a
  stored `dark` applies before first paint with no CSP violation. _Superseded
  by the owner, 2026-10-31 (Log), and kept for the record; the line that binds
  is:_
- `e2e/csp.spec.ts` still passes, and a case in it, or a new one, shows that on
  Chromium, the engine the e2e suite runs, a stored `dark` applies before first
  paint with no CSP violation. Other engines are not measured.
- The downloader's `e2e/layout.spec.ts` passes at 360 px with the new header,
  and covers `terms.html`.
- Each theme segment is at least 44px tall at 360 px, and the layout spec says
  so.
- `npm run check` and `npm test -- --project downloader --project core` pass.

## Review

**Gate: FAIL** — 2026-10-31 · `d7cd223f..17b45fd8` (merge-base equals the base; the branch has not merged `main`) · Sonnet 5.5, depth full

CI read on PR #692 at head `17b45fd8`: `check`, `test (ubuntu-latest)`, `docker` (downloader, ledger, planner), `e2e` (ledger, planner), `e2e (sniffer)`, `codeql` (security.yml) and `dependency-review` pass. **`e2e (direct)` (downloader) fails and the default-setup `CodeQL` check fails** (F1, F2). `test (windows-latest, informational)` was still pending; it is read, not graded.

| Done when                                                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `@webtools/ui` exports the header, footer, toggle and theme functions; the downloader imports them; the two old files are gone         | **verified** — `packages/ui/src/index.ts` exports them; `ls` of `web/src/lib/theme.ts` and `web/src/components/ThemeToggle.tsx` answers "No such file"; `App.tsx` and `main.tsx` import from `@webtools/ui`. Component tests: `packages/ui/test/app-header.test.tsx`, `theme-toggle.test.tsx`                                                                                                                                                                                                                                                                                                         |
| 2. Unit tests prove the cookie's `Domain` for `downloader.oludoi.com`, `localhost`, `127.0.0.1`; `system` deletes; the one-time migration | `packages/ui/test/theme.test.ts` › "a tool's subdomain writes to the parent, so every sibling tool reads it", "localhost stays host-only, and plain http gets no Secure", "an IP address stays host-only: a browser refuses a Domain on one", "choosing system deletes the cookie the earlier choice wrote", "a stored choice and no cookie: the choice moves to the cookie and the key goes", "a cookie already set wins over the older stored choice, and the key still goes" ✓. My own 20-host probe (below) agrees. `core` project 120 of 120 locally; `test (ubuntu-latest)` green at `17b45fd8` |
| 3. Unit tests prove the release link, the `unknown` fallback, the Source link                                                             | `packages/ui/test/app-footer.test.tsx` › "the version links to that tool's release, tagged <tool>-v<version>", "an unknown version links to the tool's changelog instead", "Source links to the tool's directory, and Terms to the page it is given" ✓                                                                                                                                                                                                                                                                                                                                                |
| 4. The built bundle contains the version from `api/package.json`                                                                          | `tools/downloader/e2e/footer.spec.ts` › "the footer shows the API's version and links to its release" ✓ (green in the CI job at `17b45fd8`); `web/test/vite-config.test.ts` › "writes the API's version into the bundle, the number release-please bumps (repo-131)" ✓. I also grepped my build: one `0.10.0` in `assets/index-*.js`; tag `downloader-v0.10.0` exists on origin                                                                                                                                                                                                                       |
| 5. `csp.spec.ts` passes, and a case shows a stored `dark` applies before first paint with no CSP violation                                | `e2e/csp.spec.ts` › "a stored dark theme applies before the first paint, with no violation" — **proven on Chromium**: 5 of 5 at head (10 of 10 across both new cases), **5 of 5 red with the plugin made a no-op** (positive control, F3, F4). Cases 1–8 of the file are ✓ in the CI job. Other engines **unmeasured** (F3)                                                                                                                                                                                                                                                                           |
| 6. The downloader's `layout.spec.ts` passes at 360 px with the new header, and covers `terms.html`                                        | **not met in CI** — `layout.spec.ts` › "the theme switch's segments are 44 px tall at 360 px, beside the name" is red in the `e2e (direct)` job at `17b45fd8` (F1). The `terms.html` clause is proven: "the terms page fits a phone and a desktop" ✓ in the same job                                                                                                                                                                                                                                                                                                                                  |
| 7. Each theme segment is at least 44 px tall at 360 px, and the layout spec says so                                                       | **unproven (gate)** — the 44 px loop runs before the line that fails and passed in CI, but the spec that carries it is red (F1); it is green here only because this machine's font is narrow                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8. `npm run check` and `npm test -- --project downloader --project core` pass                                                             | `check` and `test (ubuntu-latest)` green at `17b45fd8` ✓. Locally: `core` 120 of 120, `packages/core/test/image-closure.test.ts` 8 of 8, `tools/downloader/web` plus `api/test/terms-page.test.ts` 329 of 329 (23 files). Windows leg pending, informational                                                                                                                                                                                                                                                                                                                                          |

- **high** · Done when 6 and 7 depend on it · **F1. The downloader's own e2e is red at the head, and the Log's "19 of 19" is a measurement of this machine's font.** `layout.spec.ts` › "the theme switch's segments are 44 px tall at 360 px, beside the name" fails in the `e2e (direct)` job: `Expected: >= 61.1875  Received: 34.59375`, which is the name's middle above the switch's top, so the switch wrapped onto a second row. The header needs `glyph 28 + 12 + name + 12 + switch 138` inside a 336 px bar, so the name may be at most 146 px wide. Here the name is 120 to 135 px in the five font stacks I tried, so the case passes 3 of 3; with the name widened to 158.7 px the same page gives `h1mid=34.6 toggleTop=61.2`, CI's numbers to the first decimal. The CI font itself I did not measure (DejaVu is not installed here). Build 2 says the switch "must fit beside the tool's name and glyph at 360 px", so the assertion is right and the CSS is the part that is font-dependent. **Open decision, two remedies.** (A, recommended) keep one row: `.app-header__bar { flex-wrap: nowrap }` and `.app-header__name { flex: 1 1 0 }` in `packages/ui/src/chrome.css`, so a wide name wraps inside its own box. Tried on the wide name and on a hostile one (letter-spacing 0.15em at 2.4rem, 253.8 px): `oneLine=true` for both, no page overflow. (B) allow the wrap and drop the "beside the name" assertion, which gives up what Build 2 asks for. Shape-level: lg-72 and pl-65 adopt this header with their own names, so (A) belongs in the shared sheet, not in the downloader.
- **med** · no `Done when` line depends on it · **F2. The default-setup `CodeQL` check is red at the head** with one new High alert, "Bad HTML filtering regexp": the new `/<script\b([^>]*)>([\s\S]*?)<\/script>/giu` in `api/test/terms-page.test.ts` › "the page needs nothing the policy refuses: no inline script, no <style>, no style attribute" "does not match script end tags like </script >". Nothing in the Log records an owner excusal. It is also a real blind spot: an extra `<script>…</script >` is never counted, so the test still passes. Direction, not a tested remedy: count opening tags with `/<script\b/giu` and assert exactly one, with `src="/theme.js"` and no body, rather than pairing a close tag. Read through `WebFetch` on the check's `detailsUrl`; the file and the regexp were checked against the source.
- **med** · Done when 5's wording depends on it · **F3 (open decision). "Applies before first paint" is proven on Chromium only.** The repo's e2e runs one project, `chromium`, and only `chromium-1248` is installed here. The build's mechanism is `blocking="render"`, and its own Log says Firefox and Safari ignore it, so a reader there may still see one light frame. I could not confirm that: MDN's compatibility table did not come through `WebFetch`, so other engines are **unmeasured**. The comments in `vite.config.ts` and `csp.spec.ts` say the attribute "holds the first paint" without saying it is an engine's choice. Options: (1) accept Chromium, reword the line to say so and qualify the two comments (recommended; the brief itself prescribed a module script); (2) a synchronous classic external script, which every engine blocks on, at the cost of a second build entry and a non-module bundle. The plugin itself is confirmed necessary: with it a no-op the case is red 5 of 5 (`Expected: < 36  Received: 78.1`).
- **low** · F4. The terms page's "before first paint" assertion cannot detect a missing `blocking="render"`. With the attribute removed from `public/terms.html`, "the static terms page takes the same stored theme from its module, with no violation" passes 5 of 5, because the page and module are small. With `/theme.js` held back 300 ms by `page.route`, the same assertion passes 5 of 5 with the attribute and **fails 5 of 5 without it** (theme at 330 to 344 ms against a first paint at 40 to 72 ms). Tested direction: add the delay to that case. The title does not claim first paint and Done when 5 is about the app page, hence `low`.
- **low** · F5, no live call site. `cookieDomain` strips one label without a public-suffix list: `foo.co.uk` gives `Domain=co.uk` and `foo.github.io` gives `Domain=github.io`, which a browser refuses, so on such a host the choice never persists. It fails closed, and the deployment is `oludoi.com`. The ticket's rule, as written, gives this.
- **low** · F6. `public/terms.html` still says the visitor's "light or dark choice" is kept "in its own storage on your device. The service does not read them." The choice is now a cookie on the parent domain, sent with every request to every `*.oludoi.com` host, this service included. The falsehood runs toward saying less than happens, about a value that is `light` or `dark`; I did not check whether the `Cookie` header reaches the server's log (`logger.ts`). The sentence is the owner's privacy statement, so the owner rewords it.
- **low** · F7. `tools/ledger/docs/work/lg-72-*.md` and `tools/planner/docs/work/pl-65-*.md` still say `version={__TOOL_VERSION__}`. The build's claim that a tool must use `TOOL_VERSION` is **confirmed** (a bare `__TOOL_VERSION__` in `tools/downloader/web/src` gives `error TS2304: Cannot find name '__TOOL_VERSION__'`, and `vitest.config.ts` has no `define`), but the correction sits only in this ticket's Log, which the owner's option 1 allowed. A builder of either ticket who follows its own step 2 meets the error. Two one-word edits, at the landing or in each tool's pull request.
- **dropped** · CSP against the built output: `dist/app/index.html` carries one external module script and `terms.html` one, `/theme.js`; neither has an inline script, a `<style>` or a `style=` attribute (my first grep also matched `content=`, which is not an event handler). The favicon's `<style>` is inside an image the document's `style-src` does not govern. No finding.
- **dropped** · `oludoi.com.evil.test` gives `Domain=com.evil.test`, `a.b.oludoi.com` gives `b.oludoi.com`, an upper-case host and `1.2.3` give odd values. The first is the page's own parent and cannot reach `oludoi.com`; the second is the ticket's rule; the last two cannot occur, since `location.hostname` is lower-cased and normalised. `evil-oludoi.com`, `oludoi.com`, `localhost`, `127.0.0.1`, `[::1]`, `192.168.1.5` and the empty host all stay host-only.
- **dropped** · the migration "old key present with a new choice set" removes the key and keeps the cookie; the brief is silent on that case and the build's choice is the safe one. `system` deletes with the same `Domain` it wrote in all 20 hosts probed.
- **dropped** · `@webtools/ui` consumers: the three web packages list it under `dependencies`, `packages/ui/src` imports no workspace, and the downloader `Dockerfile` already copies `packages/ui/package.json` before `npm ci` and `packages` before `npm run build`. The diff touches no `Dockerfile` and nothing under `tools/ledger` or `tools/planner`. No finding.
- **findings** · the hunt returned 11; 7 carried (F1 to F7), 4 dropped.
- NFR: security ✓ (cookie `SameSite=Lax`, `Secure` on https, value validated to `light` or `dark`, no inline script) · performance — the whole 116 KB gzipped entry now gates the first paint, and the terms page waits on two serial module fetches with no preload; neither is worse than the blank frame it replaces · reliability — F1 (a layout that depends on the font), F3 · maintainability — the `render-blocking-entry` plugin replaces a literal string of Vite's output, so a change to Vite's attribute order turns it into a silent no-op; only the Chromium e2e notices (it did, in my control).

### Gate 2

**Gate: PASS** — 2026-10-31 · `17b45fd8..3eb342af` (eight commits, `git log --first-parent --no-merges`; the branch has not merged `main`, base `d7cd223f`) · Sonnet 5.5, depth narrow (the named attacks and the acceptance table)

CI read on PR #692 at head `3eb342af`, whose last commit is 21:45:45Z: every check passes — `check` (two), `changes`, `test (ubuntu-latest)`, `test (windows-latest, informational)`, `docker` (three), `e2e` (ledger, planner), `e2e (direct)`, `e2e (sniffer)`, `codeql` (security.yml), `dependency-review`, and the default-setup `CodeQL` check (completed 21:50:04Z, after that commit, so it reads this head). Gate 1's two red checks, `e2e (direct)` and `CodeQL`, are green. **Nothing here is a `high` or a `med`.**

| Done when                                                                                                                            | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. `@webtools/ui` exports the header, footer, toggle, theme functions; the downloader imports them; the two old files are gone       | **verified**, unchanged by the round. The round adds one export, `./vite`, to `packages/ui/package.json`; `git diff --stat 17b45fd8 3eb342af` touches no file gate 1 listed for this line                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2. Cookie `Domain`, `system` deletes, one-time migration                                                                             | **proven**, unchanged: `packages/ui/test/theme.test.ts`. `npm test -- --project core` at head: 14 files, **124 of 124** (gate 1 read 120; the four more are `vite-plugin.test.ts`)                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3. Release link, `unknown` fallback, Source link                                                                                     | **proven**, unchanged: `packages/ui/test/app-footer.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4. The built bundle contains the API's version                                                                                       | **proven**: `tools/downloader/e2e/footer.spec.ts` › "the footer shows the API's version and links to its release" ✓ locally at head and in `e2e (direct)` at `3eb342af`; `tools/downloader/web/test/vite-config.test.ts` 5 of 5 at head, which loads the config that now imports `@webtools/ui/vite`                                                                                                                                                                                                                                                                                       |
| 5. (as reworded 2026-10-31) On Chromium a stored `dark` applies before first paint with no CSP violation; other engines not measured | **proven on Chromium**: `e2e/csp.spec.ts` › "a stored dark theme applies before the first paint, with no violation" and › "the static terms page takes the same stored theme from its module, with no violation" ✓ at head. The terms case now discriminates: with `/theme.js` held 300 ms, `blocking="render"` removed from `public/terms.html` gives **5 of 5 red** (`Expected: < 44`, `Received: 349.5`), with it **5 of 5 green**. The app-page positive control (plugin made inert) was **not re-run** this round; the built `index.html` carries the attribute and the case is green |
| 6. `layout.spec.ts` passes at 360 px with the new header and covers `terms.html`                                                     | **proven**: › "the theme switch's segments are 44 px tall at 360 px, beside the name" and › "the terms page fits a phone and a desktop" ✓ locally (layout, csp, footer: 15 of 15) and in `e2e (direct)` at `3eb342af`. The first case is **red against the gated CSS** (`git checkout 17b45fd8 -- packages/ui/src/chrome.css`: `Expected: >= 61.1875  Received: 34.59375`, CI's own numbers) and green at head                                                                                                                                                                             |
| 7. Each theme segment is at least 44 px tall at 360 px, and the spec says so                                                         | **proven**: the same case's segment loop; my probe reads `minSeg=44x44` in every case below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8. `npm run check` and `npm test -- --project downloader --project core` pass                                                        | `check` and `test (ubuntu-latest)` pass at `3eb342af`; `core` 124 of 124 and `vite-config.test.ts` 5 of 5 locally. Windows leg passes (informational)                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Gate 1's findings**

- **F1 (high) — fixed.** `packages/ui/src/chrome.css` now has `flex-wrap: nowrap` on `.app-header__bar` and `flex: 1 1 0` on `.app-header__name`. My probe, `header-round2.mts` (gate 1's `header-remedy.mts` re-pointed at the head), at 360 px: the normal name, the CI-width name (`letter-spacing: 0.15em`), the hostile 253.8 px name (0.15em at 2.4rem), a 12-word name, one unbroken 57-character word, the last two again at hostile size, and 320 px all give `oneLine=true`, the name box 146.0 px wide wrapping inside itself, `pageOverflowX=0`, `textOverflowPx=0` and segments 44 by 44. **Positive control:** the old rules injected on the same page give `h1w=158.7 oneLine=false`, gate 1's number. `header-fonts.mts` on the five font stacks gives `oneLine=true` in all five.
- **F2 (med) — fixed.** `CodeQL` passes at `3eb342af`. `api/test/terms-page.test.ts` now counts opening tags. Planted before `</body>`: `<script>x</script >`, `<SCRIPT>x</SCRIPT>` and `<script src="/x.js"></script` + newline + `>` each give 1 failed, 8 passed (`expected [ …(2) ] to have a length of 1 but got 2`); unplanted, 9 of 9.
- **F3 (med) — fixed, as the owner chose (1).** Done when 5 is reworded (the superseded line is kept and marked); the comments in `web/vite.config.ts`, `e2e/csp.spec.ts` and the `renderBlockingEntry` docblock say the hold is an engine's choice and only Chromium is measured. Read, not run.
- **F4 (low) — fixed.** The delayed-`theme.js` case is in `csp.spec.ts` and goes red 5 of 5 without the attribute (above).
- **F5 (low) — recorded, not fixed, as the owner said.** The Log records it.
- **F6 (low) — fixed; the new sentence is true.** Checked clause by clause against the code in the full report: `webtools-theme`; `oludoi.com`; a year (`MAX_AGE_SEC` = 31,536,000); only `light` or `dark`; "System" is the toggle's label and deletes it; the service reads no cookie; the page reads it in the browser; the service does not log it. The API has one logger (`createLogger` in `server.ts`, injectable) and Fastify's is `logger: false`. The new test is not vacuous: it asserts request lines exist, and planting `theme: request.headers.cookie` in `request-log.ts` turns it red (`expected [ …(5) ] to deeply equal []`). Two precision gaps in the safe direction are N3.
- **F7 (low) — not in this round, by the owner's decision.** pl-65 is #695 (open, `docs(planner)`); the round touches no `tools/ledger` or `tools/planner` path.

**New findings, in the lines the round touched**

- **low** · no `Done when` line depends on it · **N1. `renderBlockingEntry` (`packages/ui/src/vite.ts`) matches text, not the document, so it marks more than the entry and its guard is looser than its docblock.** Real `vite build`s, `plugin-population.mts`: a remote `<script type="module" src="https://cdn.example.test/x.js">` comes out `blocking="render"`, so a third-party fetch would hold the first paint; a module script inside an HTML comment counts as marked, so a page with no real entry passes the guard; and `transformIndexHtml` skips its error whenever `blocking="render"` appears anywhere (a `<link … blocking="render">`, a comment). Direct calls to `addRenderBlocking` also mark `<script type="module" data-src="/x.js">inline()</script>` and turn `<script-x type="module" src="/x.js">` into `<script blocking="render"-x …>`; no real build hands it those, since Vite turns an inline module script into an external one (both rows marked 1 of 1). No live call site: each tool's `index.html` has one module script and the downloader's `script-src` names no other module origin. Direction, not a tested remedy: restrict to a `src` that is same-origin, and require the marked tag itself, not any `blocking="render"`, for the guard to pass.
- **low** · N2. `packages/ui/package.json` declares neither `vite` nor a peer for it, though `src/vite.ts` imports a type from it and `test/vite-plugin.test.ts` imports `build` at runtime. It resolves by hoisting from the web packages, which every consumer of `@webtools/ui/vite` already has. No live call site.
- **low** · N3. Two phrases in the new terms sentence say more than happens, both in the safe direction, nothing relies on either: "sends it with every request to any `oludoi.com` address" (`SameSite=Lax` withholds it from another site's subrequests), and "so that every tool there shows the same theme" (true once pl-65 and lg-72 merge; today only the downloader reads the cookie). Facts for the owner's wording review, not style.
- **dropped** · the unexplained `refused-download.spec.ts` failure: **not reproduced**, 3 of 3 pass at head (41, 47, 42 s) and `e2e (direct)` passes in CI at `3eb342af`. Nothing failed, so no base comparison was made, and the cause of the builder's three local failures stays **unmeasured**; it is not shown to be the branch.
- **dropped** · the logging test does not reach every line of every route: the API has one logger and reads only `origin`, `accept` and `x-request-id` from a visitor's request, so the claim holds of the service; the unplanted `headers: request.headers` variant stays green because the logger redacts a header bag, which is consistent with the sentence.
- **dropped** · the Log's round-1 F3 bullet still says the plugin is "a silent no-op" on a change in Vite; the later bullet in the same round supersedes it. Chronology, not a defect.
- **findings** · the hunt returned 6; 3 carried (N1 to N3), 3 dropped.
- NFR: security ✓ (CSP unchanged; no inline script; the cookie claim verified) · performance — the plugin adds one render-blocking hold on the entry only, as before; N1 names the case where it would add another · reliability ✓ (header holds in 8 cases at 360 and 320 px and in 5 font stacks; plugin build-only, dev server served 200 with no attribute and no error on a page with no script) · maintainability — N1, N2.

### Gate 3

**Gate: CONCERNS** — 2026-10-31 · `3eb342af..222b5048` (three commits, `git log --first-parent --no-merges`; the branch has not merged `main`, base `d7cd223f`) · Sonnet 5.5, depth narrow (the named attacks and the acceptance table, no hunt of my own beyond them), asked for by the owner. **Nothing here is a `high`.** One `med`, and no `Done when` line names it: N4, the default-setup `CodeQL` check is red on this head and nobody has excused it.

CI read on PR #692 at head `222b5048` (22:54Z): `check` (two), `changes`, `test (ubuntu-latest)`, `docker` (three), `e2e` (two), `e2e (direct)`, `e2e (sniffer)`, `codeql` (security.yml) and `dependency-review` pass. **`CodeQL` (the default-setup check) fails** with one new alert, read with `WebFetch` on its `detailsUrl`: rule "Polynomial regular expression used on uncontrolled data", file `packages/ui/src/vite.ts`, message "may run slow on strings starting with '<!--' and with many repetitions of '<!--'". `test (windows-latest, informational)` was still pending at the read: informational, not graded, **unproven (gate)** for the sha.

| Done when                                                                     | Proof                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, 2, 3, 6, 7                                                                 | not reached by the round (`git diff --stat 3eb342af 222b5048` touches no file they rest on, apart from `terms.html`, two phrases, below); verdicts stand as gate 2 gave them                                                                                                                                                                                                  |
| 4. The built bundle contains the API's version                                | **proven**, unchanged: `tools/downloader/e2e/footer.spec.ts` › "the footer shows the API's version and links to its release" passes in `e2e (direct)` at `222b5048`                                                                                                                                                                                                           |
| 5. On Chromium a stored `dark` applies before first paint, no CSP violation   | **proven on Chromium** through CI: `e2e/csp.spec.ts` in `e2e (direct)` at `222b5048`. Read locally on the new plugin: after `npm run build`, `tools/downloader/web/dist/index.html` holds one script tag, `<script blocking="render" type="module" crossorigin src="/assets/index-….js">`. The round's plugin change reaches this line, and the built page is unchanged by it |
| 8. `npm run check` and `npm test -- --project downloader --project core` pass | `check` (two) and `test (ubuntu-latest)` pass at `222b5048`; `npm test -- --project core` locally: 14 files, **136 of 136** (gate 2 read 124; the 12 more are the round's new `vite-plugin.test.ts` cases); `packages/ui/test/vite-plugin.test.ts` and `packages/core/test/image-closure.test.ts` together 24 of 24. Windows leg **unproven (gate)**, pending                 |

**Gate 2's findings**

- **N1 (low) — fixed in part.** Fixed and measured in real `vite build`s and by direct calls, with `parse5` and WHATWG `URL` as the second method: a `src` of `//cdn`, `/\cdn`, `\\cdn`, `https://`, `HTTPS://`, `data:`, `javascript:` and `blob:` is left unmarked; `/x.js`, `./x.js`, `x.js` and ` /x.js` are marked (direct); `type` as `module`, `MODULE`, `'module'`, `module` and unquoted is an entry, `text/javascript` is not; a `>` in a quoted value, a `<!--` in the entry's own value, and a tag split across lines are read correctly; `data-src`, `data-type` and `<script-x` are not matched; a terminated comment is skipped; and the guard fails on a page whose only blocking module script is remote, is in a terminated comment, is a `<link>` or is a classic script. The positive control, the same harness on the plugin at `3eb342af`, marks the `//`, `https://` and `data:` rows. **Two clauses of N1's mechanism (text read, not the document) remain**, both with no live call site: each tool's `index.html` has one same-origin module script and the downloader's `script-src` names no other module origin.
  - **(a) Character references in `src` are not decoded.** `src="&#47;&#47;cdn.test/x.js"`, `&#x2f;/cdn.test/x.js`, `&sol;&sol;cdn.test/x.js` and `https&colon;//cdn.test/x.js` each reach the output of a real `vite build` as a remote module script marked `blocking="render"` (Vite leaves the tag where it is; `parse5` then `new URL(src, "https://app.test/")` gives another origin). A leading C0 control (U+0001 before `//cdn.test/x.js`) is marked on a direct call, where a browser strips it and loads from `cdn.test`; the real build I ran hands the plugin no such tag. Direction, not a tested remedy: classify a `src` that contains `&` as not same-origin, or decode references first, and strip leading and trailing C0 controls and spaces as the URL parser does, not `trim()`.
  - **(b) An unterminated comment and the raw-text elements are not recognised.** Text after an unclosed `<!--`, inside `<title>`, inside `<textarea>` and inside an inline classic script's string is read as markup: the tag in it is marked (the string literal is rewritten) and the guard passes with no live entry. Each of the four builds `BUILD-OK` with `liveMarked=0` when it is the page's only module script text. The `addRenderBlocking` docblock says "an element's content is not parsed", which is the gap; the guard's docblock says "the tag itself".
- **N2 (low) — fixed.** `git diff 3eb342af 222b5048 -- package-lock.json`: 4 insertions and 2 deletions, all inside the `packages/ui` entry (`vite` added under `devDependencies` and `peerDependencies` at `^8.3.4`); the changed lines matching `resolved` or `version` number 0. `^8.3.4` is the range `tools/downloader/web`, `tools/ledger/web` and `tools/planner/web` declare. `node scripts/check-lockfile-sync.mjs` exits 0 (`up to date`). `packages/core/test/image-closure.test.ts` passes.
- **N3 (low) — fixed.** Whitespace-normalised word diff of `tools/downloader/web/public/terms.html` between the two shas: the only words removed are "every tool there shows the same theme." (now "tools there can share it."), "every request" (now "requests"), "any" and "address," (now "addresses,"). Read as the owner chose: "with requests to `oludoi.com` addresses" and "so that the tools there can share it". Nothing else in the file differs apart from oxfmt's reflow of the same paragraph.

**New findings, in the lines the round touched**

- **med** · no `Done when` line depends on it · **N4. The `CodeQL` check is red on this head, and the alert is true.** `COMMENT_OR_SCRIPT` in `packages/ui/src/vite.ts` is quadratic when an opener repeats with nothing to close it, because `[\s\S]*?-->` rescans to the end of the string from every `<!--`, and the tag branch does the same from every `<script `. `addRenderBlocking` on `"<!--".repeat(n)`: 16,000 / 64,000 characters take 22.9 / 363 ms. `"<script ".repeat(n)`: 8,000 / 32,000 / 128,000 characters take 15 / 224 / 3,489 ms; `'<script a="b" '.repeat(n)` at 224,000 characters takes 9.2 s. Each fourfold step in length costs about sixteen times. A well-formed 176 KB page takes 5 ms, and the input is the tool's own built HTML, so there is **no live call site**. It is still a red check on the head with no excusal in the Log: the branch has had this check go red on a regexp twice before (the Log's F2, and its later alert on the plugin's test). **Open decision**, the owner's: (1) fix it in the code, recommended: scan for `-->` and `>` with `indexOf` and stop looking once a search finds none, so a missing close costs one pass; not tested here, a direction only; or (2) excuse it under adr/005 with the register comment above the regexp and the dismissal in `security.yml`, saying the input is the author's own, which dismisses a true alert with its measurement attached.
- **dropped** · an empty comment `<!-->` or `<!--->`, or a `<!--` inside another element's attribute value, makes the scanner skip a real script that a browser runs: the script stays unmarked and, as the page's only entry, fails the build through the guard (both run: `FAILS build`). Safe direction, and a real build always carries Vite's own marked entry.
- **dropped** · ` /x.js` (leading space): a real build fails inside `vite:build-html`, not in the plugin; a direct call marks it, which is right (a browser strips the space).
- **dropped** · a `<script>` in a `<template>` is marked on a direct call and the guard passes on it; it is inert, and a real build consumes it into Vite's own entry (`liveMarked=1`, the entry's).
- **dropped** · a `src` that begins with a no-break space (U+00A0): the plugin reads it as remote (`trim()` strips it) where a browser reads it as relative. Safe direction.
- **findings** · the hunt returned 7; 3 carried (N4, and N1's clauses (a) and (b), reported under N1 as `fixed in part` because they share its mechanism), 4 dropped.
- NFR: security — N1 (a), the one way a remote tag gets the hold, needs an entity-encoded `src` someone wrote on purpose · performance — N4, quadratic on pathological input only (5 ms on a well-formed 176 KB page) · reliability ✓ (the guard fails the build for a remote-only, terminated-comment-only, link-only and classic-only page; N1 (b) is where it passes without an entry) · maintainability — a hand-written start-tag reader has now needed two rounds of gates and drawn a third CodeQL alert; N1 (a) and (b) are what it does not read.

## Log

**2026-10-25 — amended before any build.** From repo-130's session (#665): the
owner set the 44px tap-target floor for the theme control too. Build 2 and the
acceptance line above say so, and the control hides its radios with the shared
`.sr-only`.

**2026-10-31 — the owner's answer at intake, before any build.** The
orchestrator asked the owner: "repo-131 leaves lg-72's two inputs unnamed: the
stylesheet export path, and a theme module a static terms.html can load. Its
step 5 also reads as 'every tool's vite.config'. How should it be settled?" The
options were:

1. **Builder names both, downloader only.** repo-131 touches only the
   downloader's vite config, as in its step 7 and Done when. The builder records
   the export path and the terms-page theme module in its Log, and lg-72 builds
   on what lands. No Done when line changes.
2. Add both as repo-131 Done when lines.
3. Every tool's vite.config in repo-131.

The owner chose **option 1** (the orchestrator's recommendation). So Build 5's
`define` goes into `tools/downloader/web/vite.config.ts` only (the step is
marked above), and the build's Log entry names, for lg-72, the exact
`@webtools/ui` export a tool's `main.tsx` imports the header and footer
stylesheet from, and the file a static `web/public/terms.html` loads to take the
shared theme.

**2026-10-31 — built (branch `repo-131-shared-header-footer`, base
`d7cd223f`).** `@webtools/ui` now exports `AppHeader`, `AppFooter`,
`ThemeToggle`, `TOOL_VERSION` and the theme functions from `.`, the theme
functions alone from `./theme`, and the stylesheet from `./chrome.css`. The
downloader imports them; its `lib/theme.ts` and `components/ThemeToggle.tsx`
are deleted.

**For lg-72 and pl-65, the two inputs the owner's answer asked for:**

1. **The stylesheet is `@webtools/ui/chrome.css`.** `main.tsx` imports
   `@webtools/ui/tokens.css`, then `@webtools/ui/chrome.css`, then
   `./styles.css`. The classes are `.app-header*`, `.theme-toggle*` and
   `.app-footer`, renamed from the downloader's `.topbar`, `.themetoggle` and
   `.footer` so they collide with nothing in the other two stylesheets.
2. **A static `web/public/terms.html` loads `/theme.js`**, as
   `<script type="module" src="/theme.js" blocking="render"></script>` in its
   `<head>`. `/theme.js` is a built asset with a fixed name. The tool adds
   `web/theme.js` (two lines: `import { bootTheme } from "@webtools/ui/theme";`
   and `bootTheme();`). Its `vite.config.ts` adds `build.rolldownOptions.input`
   `{ index: <root>/index.html, theme: <root>/theme.js }` and an
   `output.entryFileNames` that names the `theme` chunk `theme.js` and leaves
   the rest `assets/[name]-[hash].js`. `vite build` writes `dist/app/theme.js`
   (82 bytes, importing a hashed `assets/theme-*.js`), and the dev server serves
   `web/theme.js` at the same `/theme.js` (measured: 200, `text/javascript`).
   The page's own stylesheet needs `:root[data-theme="light"]` and
   `:root[data-theme="dark"]` blocks after its `prefers-color-scheme` one, as
   `tools/downloader/web/public/terms.css` now has.

**What lg-72 and pl-65 still have wrong, for whoever builds them:**

- Their step 2 says `version={__TOOL_VERSION__}`. Use
  `version={TOOL_VERSION}` from `@webtools/ui`. The global is declared in
  `packages/ui/src/globals.d.ts` and read only by `packages/ui/src/version.ts`,
  through `typeof`. A tool's own program never sees the declaration, so a bare
  `__TOOL_VERSION__` there fails `tsc`. Under vitest, where no `define` runs,
  it would also throw a `ReferenceError` in every test that renders `App`.
  `TOOL_VERSION` is `unknown` there, and the footer then links to the
  changelog.
- Each tool's `web/tsconfig.json` and `web/test/tsconfig.json` needs a
  reference to `packages/ui` (see `.claude/rules/ui-package.md`). Without it,
  `tsc` has no declarations for the `.tsx` source.
- `main.tsx` calls `bootTheme()` from `@webtools/ui/theme` before
  `createRoot`, and `vite.config.ts` carries the `render-blocking-entry` plugin
  described below, or the stored theme lands after the first paint. Neither
  tool ever stored a theme, so neither needs `migrateStoredTheme`.

**Build 8: TypeScript source, not a built `dist`.** `exports` names `src/*.ts`.
The tool's Vite and vitest compile it, and `tsc` reads `packages/ui/dist/*.d.ts`
through the project reference. The `dist` holds declarations only
(`emitDeclarationOnly`). Measured with
`build/measure-export.sh`: with `packages/ui/dist` deleted, the source export
gave `vite build exit 0` and `app.test.tsx` 29 of 29. With `exports` pointed at
an unbuilt `./dist/index.js`, `vite build` exited 1 with
`Rolldown failed to resolve import "@webtools/ui/theme"`. That is the failure
the `HOST` docblock describes, so the source export keeps Vite off a build
step. (In that dist state vitest still passed `app.test.tsx`; I did not find
out why.) React is a peer dependency. The test-only packages are
`devDependencies` at the versions the tree already locks. The lockfile was
regenerated `--package-lock-only --offline` in a staged copy, the way
`scripts/check-lockfile-sync.mjs` does it, and only `packages/ui`'s entry
changed.

**Plumbing.** `packages/ui/tsconfig.json` is a web-surface project. Its tests
have their own `packages/ui/test/tsconfig.json`, carved out of
`tsconfig.tests.json`. That makes nine test projects, and
`.claude/rules/testing.md` and `tsconfig.tests.json`'s comment now say so. The
`core` vitest project collects `*.test.{ts,tsx}`, and each component suite takes
jsdom from a docblock. `.oxlintrc.json`'s react/jsx-a11y override now covers
`packages/ui/**`. `packages/core/test/image-closure.test.ts` passes: the API
resolves no `@webtools/ui`.

**What the brief had wrong:**

- **Build 1's "call `applyTheme` at the top of `main.tsx`, before
  `createRoot`" does not by itself apply a stored theme before the first
  paint.** A module script is deferred. The new `csp.spec.ts` case measured
  Chromium's `first-paint` at 28 ms and `data-theme` at 68 ms, and failed. The
  fix is `blocking="render"` on the entry script. Vite rewrites the built
  entry's tag and drops the attribute from `index.html`, so a small
  `transformIndexHtml` plugin in `vite.config.ts` (`render-blocking-entry`)
  puts it back. With it, the case passed 5 of 5 (`--repeat-each=5`). The terms
  page carries the same attribute, but there it is defensive only: with the
  attribute removed, its case still passed 5 of 5, because the page and its
  module are small. Firefox and Safari ignore `blocking`, so a reader there may
  still see one light frame. No inline script was added.
- The migration from `downloader:theme:v1` lives in `@webtools/ui` as
  `migrateStoredTheme(storage, key)`, with the key passed in by the downloader's
  `main.tsx`. The package knows no tool's name.
- A favicon cannot take `currentColor` from a page. `public/favicon.svg` is the
  glyph's path, stroked in the downloader's two accent colours by its own
  `prefers-color-scheme`.
- With an `unknown` version the footer's first link reads "Changelog" rather
  than "vunknown".
- The theme radios' accessible names are now "System", "Light" and "Dark"
  (capitalised, in hidden text beside the icon, with a matching `title`). The
  existing `csp.spec.ts` theme case clicks `getByTitle("Dark")`.

**Not folded in:** moving the downloader's other `.visually-hidden` uses to
`.sr-only`. repo-130, which is `needs-decision`, retires that class, and the
move belongs with its decision. The theme control no longer uses the class.

**Verification, at this branch's head before the Log commit:**
`npx vitest run --project core` 120 of 120 (13 files).
`npx vitest run tools/downloader/api/test/terms-page.test.ts tools/downloader/web packages/ui`
381 of 381. `npm test -- --project downloader --project core` exit 0: 2,724
passed and 2 skipped of 2,726 (139 files passed, 1 skipped), 97.85 s.
`npm run check` exit 0. The fast e2e suite
(`playwright.config.ts`, `E2E_PORT=8157`) passed 19 of 19, including the new
`csp.spec.ts` before-first-paint and terms-page cases, `footer.spec.ts` (the
built bundle shows `v0.10.0`, linked to `downloader-v0.10.0`), and the
`layout.spec.ts` 44 px case. The screenshots in `e2e/.artifacts/layout/` were
opened and show the header on one line at 360 px.

**2026-10-31 — the owner's answers to gate 1 (at `17b45fd8`), relayed by the
orchestrator before round 1.** Each was chosen from the options shown.

- **F1, the header wraps in CI.** (A) keep one row, with `flex-wrap: nowrap`
  on `.app-header__bar` and `flex: 1 1 0` on `.app-header__name` in
  `packages/ui/src/chrome.css`; or (B) allow the wrap and drop the "beside
  the name" assertion. The owner chose **(A)**, in the shared sheet, because
  lg-72 and pl-65 inherit it.
- **F3, first paint proven on Chromium only.** (1) accept Chromium, reword
  Done when 5 and say in the comments in `vite.config.ts` and `csp.spec.ts`
  that the hold is an engine's choice; or (2) a synchronous classic script.
  The owner chose **(1)**. Done when 5 is reworded above; the old line is kept
  and marked.
- **F6, the terms page's sentence about where the theme is kept.** Reword it
  in this round, or record it and have the owner reword it later. The owner
  chose **reword it in this round**, after checking whether the service logs
  the `Cookie` header. The owner reviews the wording on the pull request.
- **F7, lg-72's and pl-65's `__TOOL_VERSION__`.** The owner chose a separate
  `docs(planner)` pull request; this branch does not touch either ticket.
- **F5** (`cookieDomain` has no public-suffix list) stays recorded as the
  gate wrote it, not fixed.

**2026-10-31 — round 1, gate 1's findings.** Each was reproduced before the fix.

- **F1, the header wrapped in CI.** `layout.spec.ts`'s 44 px case now checks
  the name twice: once as rendered, and once widened by a CSSOM
  `letter-spacing: 0.2em` until it is at least 158.7 px on one line. A
  `<style>` would be refused by `style-src 'self'`; a CSSOM write is not.
  Against the old `chrome.css` (at `6dec1bdd`) it failed 3 of 3 with
  `Expected: >= 61.1875  Received: 34.59375`, CI's own numbers. (A first try
  at `0.15em` gave 158.67 px, just under the precondition.) With the owner's
  (A) in `packages/ui/src/chrome.css` (`flex-wrap: nowrap` on the bar,
  `flex: 1 1 0` on the name) it passed 3 of 3. The case also asserts that
  the page does not overflow with the wide name.
- **F2, CodeQL "Bad HTML filtering regexp".** `terms-page.test.ts` now
  counts opening `<script` tags and checks that the one tag is followed
  directly by `</script>`. No regexp pairs a close tag any more. With
  `<script>x</script >` planted before `</body>` the case went red (1
  failed, 7 passed); restored, it passed 8 of 8.
- **F3.** Done when 5 is reworded to say Chromium (the old line is kept and
  marked). The comments on the `render-blocking-entry` plugin in
  `vite.config.ts` and above `stampThemeArrival` in `csp.spec.ts` now say
  that holding the paint is the engine's choice, and that only Chromium is
  measured. The plugin comment also says it matches a literal of Vite's
  output, so a change there makes it a silent no-op.
- **F4.** The terms-page case now holds `/theme.js` back 300 ms with
  `page.route`. With `blocking="render"` removed from `terms.html` it
  failed 5 of 5 (`Expected: < 44..56  Received: 331..341`); with the
  attribute it passes.
- **F6.** I checked whether the downloader reads or logs the cookie. Fastify's
  logger is off (`logger: false`, `server.ts`). The one request line
  (`request-log.ts`) carries method, URL, status, duration and the shortened
  address, and no header. The only visitor request headers the app reads are
  `origin`, `accept` and `x-request-id`. The egress proxy reads headers too,
  but it is ffmpeg's own loopback listener, not the visitor's. pino's redact paths cover
  `headers.cookie` and `*.cookie` anyway, and `redactHeaders` in
  `@webtools/core` lists `cookie` and `set-cookie`. The sentence is now
  rewritten to those facts. A new test,
  `terms-page.test.ts` › "the theme cookie it says the service never logs
  reaches no log line (repo-131)", sends `Cookie: webtools-theme=dark` to
  `/`, `/terms.html`, health, a miss and a refused probe, and finds no log
  line naming it. It went red (1 failed) when `request-log.ts` was made to
  log the header, and green once restored.

**For lg-72:** the round changed `packages/ui/src/chrome.css`, which lg-72
inherits. The export paths and the `/theme.js` mechanism are unchanged.

**2026-10-31 — round 1, the owner's addition: the plugin moves to
`@webtools/ui`.** lg-72's builder copied the downloader's
`render-blocking-entry` plugin into the ledger's config, and pl-65 would have
made a third copy. The options were (a) lift it into `@webtools/ui` as an
exported Vite plugin in this round, with both tools importing it, or (b) keep
one copy per tool. The owner chose **(a)**, because the ledger is the second
real consumer.

- **Import path:** `import { renderBlockingEntry } from "@webtools/ui/vite";`,
  then `plugins: [react(), renderBlockingEntry()]`. The module is
  `packages/ui/src/vite.ts` and imports only a type from `vite`. The
  downloader's local copy is gone.
- **Gate 1's maintainability note is answered in code, not only in a test.**
  The plugin now matches any external module script (`type="module"` with a
  `src`, in any attribute order, without `blocking`) instead of a literal of
  Vite's output, and it is `apply: "build"`. When it finds nothing to mark,
  it calls `this.error` and fails the build. So a change in how Vite writes
  the tag stops `vite build` instead of quietly dropping the hold.
- **Pinned once, in `packages/ui/test/vite-plugin.test.ts`.** The test runs a
  real `vite build` of a one-entry fixture, plus attribute-order,
  leave-alone and fail-loudly cases. With the matcher made to miss Vite's tag
  (`src=` changed to `srcx=`), the real build failed with
  `render-blocking-entry: no external module script in the built HTML`, and
  2 of the 4 tests went red. Restored, all 4 passed.
- **A tool's config loads it with no build step.** With `packages/ui/dist`
  deleted, `vite build` in `tools/downloader/web` exited 0 and wrote
  `<script blocking="render" type="module" crossorigin src="/assets/index-….js">`.
  `npm run check` exited 0 with the import in place: `../vite.config.ts` is in
  `web/test/tsconfig.json`'s program and resolves through `dist/vite.d.ts`.
- **One e2e failure was not this change.** After the lift, the fast suite ran
  18 of 19. `refused-download.spec.ts` failed 3 times in a row at line 83:
  the refused job's second link never showed "Saved by your browser" within
  120 s. In the same window, the downloader config from `fca27ebc`, with the
  local plugin, passed it once. The two configs' `dist/app` trees differ only
  in the order of attributes on the entry tag (`diff -r`). Then HEAD passed 2
  of 2 at 39 s each. The cause, environmental or a flake, is not measured.
- **CodeQL at `46b89313`** flagged one new alert, "Bad HTML filtering
  regexp" ("does not match upper case <SCRIPT> tags"), on
  `packages/ui/test/vite-plugin.test.ts` line 65. That regexp and the plugin's
  two matchers now carry the `i` flag, and the attribute-order case now
  includes an upper-case `<SCRIPT>`.

- 2026-10-31 — Fixed at landing by owner choice: gate 2, N3 — the downloader's
  terms sentence, with the gate's two corrections ("with requests to
  `oludoi.com` addresses" and "so that the tools there can share it"). In
  `tools/downloader/web/public/terms.html` only.
  `git diff 3eb342af -- tools/downloader/web/public/terms.html | grep -c '^-.*so that every'`
  → `1`, and the same with `'^-.*sends it with every request to any'` → `1`.

- 2026-10-31 — Fixed at landing by owner choice: gate 2, N2 — "`packages/ui/package.json`
  declares neither `vite` nor a peer for it". `vite` is now a `peerDependency`
  and a `devDependency` of `@webtools/ui` at `^8.3.4`, the range the three web
  packages lock. `git diff 3eb342af HEAD -- package-lock.json | grep -c '^[-+] '`
  → `6` lines (the `packages/ui` entry only, no version moved), and
  `node scripts/check-lockfile-sync.mjs` exits 0.

- 2026-10-31 — Gate 2, N1 (`renderBlockingEntry` matches text, not the
  document) is not fixed here: it goes, with gate 3's two remaining clauses
  (an entity-encoded remote `src` is still marked; text in an unterminated
  comment, `<title>` or `<textarea>` passes the guard) and its N4 (the scan's
  pattern is quadratic, and CodeQL is red on it), to **repo-133**. The owner
  chose to revert the attempted fix (`222b5048`) and file the plugin as its
  own ticket, over rebuilding it on parse5 with a gate 4, over gate 3's
  `indexOf` scan with a gate 4, and over excusing N4 under adr/005.
  `packages/ui/src/vite.ts` and its test are byte-identical to `3eb342af`.

- 2026-10-31 — The owner reversed Build step 3's links after landing: the footer
  links to nothing on GitHub. It is now `v<version> · Terms`, left-aligned, with
  the version as plain text; an `unknown` version is left out rather than
  replaced by a changelog link. `packages/ui/src/repository.ts` and its four
  exports are gone, and `AppFooter` no longer takes `tool`, which only built
  those URLs.
