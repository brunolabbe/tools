---
id: lg-72
tool: ledger
title: Take the shared header and footer, and give the ledger a terms page
kind: work-package
status: ready
milestone: null
depends_on: [repo-131]
difficulty: standard
---

# lg-72 — The shared header and footer, and a terms page

## Why

The owner wants every tool's header and footer to look the same (2026-10-25).
[repo-131](../../../../docs/work/repo-131-one-header-and-one-footer-for-every-tool.md)
builds `AppHeader`, `AppFooter` and the theme control in `@webtools/ui` and
records the owner's answers. This ticket is the ledger's adoption. The ledger is
a separate pull request so that its changelog line names only the ledger.

Today `web/src/App.tsx` writes its `<header>` three times: Admin, no household,
and the household's own screen. Each has a different subtitle or none. The
footer is a `Health` component that fetches `/health` and prints the server
version. There is no theme control and no terms page.

## Build

1. Replace the three `<header>` copies with `AppHeader`: `name="Ledger"`,
   the subtitle as `tagline` ("Admin" on the Admin screen, "The household's
   shared account." on the household's own screen, and that same sentence on
   the no-household screen, which has none today), plus the ledger's glyph. The
   Home / Stats / Period tabs stay below the header, as they are.
2. Render `AppFooter` with `tool="ledger"`, `version={TOOL_VERSION}` (imported
   from `@webtools/ui`) and `termsHref="/terms.html"`. Add the `define` to
   `web/vite.config.ts` as repo-131 step 5 describes. Delete the `Health` component. Delete
   `web/src/api/health.ts` and its tests if nothing else imports them.
3. Glyph: an inline SVG drawn with `currentColor`, such as a coin or an open
   book. Ship the same drawing as `web/public/favicon.svg`, with a
   `<link rel="icon">` in `index.html`. The ledger has no `public/` yet.
4. `web/public/terms.html`, modelled on the downloader's (dl-54). The compose
   file calls this "the tool whose data is households' bank history", so the
   page says plainly:
   - what is stored: the books per household and the directory, on the
     `ledger_storage` volume;
   - who can read a household's books: members, checked against Cloudflare
     Access's signed token on every API route (`api/src/identity.ts`), and the
     admin, whatever the admin can see;
   - how long data is kept, and how a household leaves.

   Each claim comes from the code. If a claim cannot be grounded, for example
   because no deletion path exists, the page says so rather than promising one.
   Raise it in the pull request; do not build the missing path here.

5. The terms page honours the theme cookie the way the downloader's does
   (repo-131 step 7), and links back to the ledger.
6. `e2e/layout.spec.ts`: add the terms page at 360 px and at desktop width.

## Done when

- All three screens render `AppHeader` and `AppFooter` from `@webtools/ui`, and
  `App.tsx` contains no `<header>` element of its own, no `Health` component and
  no fetch of `/health`.
- The built bundle carries `tools/ledger/api/package.json`'s version.
- `/terms.html` is served, and the pull request quotes each of its claims with
  the code or config line that makes it true.
- `e2e/layout.spec.ts` covers the three header variants and the terms page at
  360 px and desktop width.
- `npm run check` and `npm test -- --project ledger` pass.

## Log

**2026-10-31 — Build 2 corrected before any source change.** The brief said
`version={__TOOL_VERSION__}`. repo-131's Log says a tool cannot read that global,
because `@webtools/ui` declares it in `packages/ui/src/globals.d.ts` and only its
own `version.ts` reads it. Checked on this branch with the `packages/ui`
reference already in `web/tsconfig.json`: a one-line `web/src/probe.ts`,
`export const probe: string = __TOOL_VERSION__;`, then
`npx tsc --build tools/ledger/web` printed
`tools/ledger/web/src/probe.ts(1,30): error TS2304: Cannot find name '__TOOL_VERSION__'.`
The probe file is deleted. The step now imports `TOOL_VERSION` from
`@webtools/ui`, which reads the global through `typeof` and is `unknown` under
vitest, where no `define` runs. pl-65, the planner's twin, has the same line and
is the planner's to correct; this branch does not touch it.
