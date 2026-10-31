---
id: repo-131
tool: repo
title: One header and one footer in `@webtools/ui`, lifted from the downloader's
kind: work-package
status: ready
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
