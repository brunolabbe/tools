---
id: pl-65
tool: planner
title: Take the shared header and footer, and give the planner a terms page
kind: work-package
status: ready
milestone: null
depends_on: [repo-131]
difficulty: standard
---

# pl-65 — The shared header and footer, and a terms page

## Why

The owner wants every tool's header and footer to look the same (2026-10-25).
[repo-131](../../../../docs/work/repo-131-one-header-and-one-footer-for-every-tool.md)
builds `AppHeader`, `AppFooter` and the theme control in `@webtools/ui` and
records the owner's answers. This ticket is the planner's adoption. The planner
is a separate pull request so that its changelog line names only the planner.

Today the planner has no `<header>`: `<h1>Planner</h1>` and `.lede` sit inside
`<main className="shell">` (`web/src/App.tsx`). Its footer is a `Health`
component that fetches `/health` and prints the server version, the assistant
provider and the model. It has no theme control and no terms page.

## Build

1. `App.tsx`: render `AppHeader` with `name="Planner"`, the lede's sentence as
   `tagline`, and the planner's glyph. Move the `<h1>` out of `<main>` so the
   page has one `<header>`, one `<main>` and one `<footer>`.
2. Render `AppFooter` with `tool="planner"`, `version={TOOL_VERSION}` (imported from `@webtools/ui`) and
   `termsHref="/terms.html"`. Add the `define` to `web/vite.config.ts` as
   repo-131 step 5 describes. Delete the `Health` component. Delete
   `web/src/api/health.ts` and its tests if nothing else imports them. The
   provider and model stay in `/health` for operations; the owner chose to drop
   them from the UI.
3. Glyph: an inline SVG drawn with `currentColor`, such as a map pin or a route
   line. Ship the same drawing as `web/public/favicon.svg`, with a
   `<link rel="icon">` in `index.html`. The planner has no `public/` yet.
4. `web/public/terms.html`, modelled on the downloader's (dl-54): what the
   planner is for; what it stores, where and for how long (the SQLite file on
   the `planner_storage` volume, which the compose file calls "the only copy of
   anything a user typed"); who can reach it (Cloudflare Access); and where a
   trip's text goes.

   **Trap: the provider is configuration, and a static page cannot read it.**
   `compose.planner.prod.yaml` sets `MODEL_PROVIDER: "scripted"` today, so no
   text leaves the server. Write what is true of that setting. Then add a comment
   beside `MODEL_PROVIDER` in the compose file saying that a real provider means
   updating `terms.html` to name it. Otherwise the page quietly becomes false
   the day someone turns a real model on.

5. The terms page honours the theme cookie the way the downloader's does
   (repo-131 step 7), and links back to the planner.
6. `e2e/layout.spec.ts`: add the terms page at 360 px and at desktop width.

## Done when

- The planner renders `AppHeader` and `AppFooter` from `@webtools/ui`, and
  `App.tsx` contains no `Health` component and no fetch of `/health`.
- The built bundle carries `tools/planner/api/package.json`'s version.
- `/terms.html` is served, and the pull request quotes each of its claims with
  the code or config line that makes it true.
- The compose file's `MODEL_PROVIDER` comment points at `terms.html`.
- `e2e/layout.spec.ts` covers the main screen with the new header, and the
  terms page, at 360 px and desktop width.
- `npm run check` and `npm test -- --project planner` pass.

## Log

### 2026-10-31 — Build step 2 corrected to `TOOL_VERSION` from `@webtools/ui` (builder, maintenance dispatch)

Claim: Build step 2 says `version={__TOOL_VERSION__}`, which does not typecheck in a
tool's web source. The global is declared only inside `@webtools/ui`, and no tool's
config defines it for `tsc`, so the step now reads `version={TOOL_VERSION}`, imported
from `@webtools/ui`. Only that one line of the Build changed. `status` and every other
field are as they were, and the planner's `define` in `web/vite.config.ts` stays: the
bundle needs it, because `TOOL_VERSION` is computed from `__TOOL_VERSION__` at build time.

Owner's choice, 2026-10-31: correct it in this docs(planner) pull request rather than leave
it to repo-131's Log, since a planner path cannot ride repo-131's `feat(downloader)` pull request
without releasing the planner.

Premise, read off repo-131's branch `repo-131-shared-header-footer` at `17b45fd8`
(draft PR #692). The command was `git grep -n TOOL_VERSION 17b45fd8 -- packages tools vitest.config.ts`.
Its output, in part:

    packages/ui/src/globals.d.ts:11:declare const __TOOL_VERSION__: string | undefined;
    packages/ui/src/index.ts:14:export { TOOL_VERSION } from "./version.ts";
    tools/downloader/web/src/App.tsx:3:import { AppFooter, AppHeader, TOOL_VERSION } from "@webtools/ui";

`TOOL_VERSION` is not on `main` (`d7cd223f`): `git grep TOOL_VERSION d7cd223f -- packages`
finds nothing, so this entry cites it as prose and not as a `file:line`.

Reproduction, on this branch. A probe file held `export const probeVersion: string = __TOOL_VERSION__;`
in `tools/planner/web/src`. The command was `npx tsc -p tools/planner/web/tsconfig.json`. Its output:

    tools/planner/web/src/pl65-probe.ts(1,37): error TS2304: Cannot find name '__TOOL_VERSION__'.
    tsc exit: 2

The probe was deleted before any commit. `vitest.config.ts` at `d7cd223f` carries no `define`
(`git grep -n define d7cd223f -- vitest.config.ts` lists only the `defineConfig` import).
