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
  stored `dark` applies before first paint with no CSP violation.
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
