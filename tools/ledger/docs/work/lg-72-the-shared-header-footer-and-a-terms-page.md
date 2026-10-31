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

**2026-10-31 — built (branch `lg-72-shared-header-footer-terms`, stacked on
`repo-131-shared-header-footer` at `17b45fd8`, draft PR #692).** `App.tsx` renders
`AppHeader` and `AppFooter` on all three screens and has no `<header>`, no
`Health` and no `/health` fetch; `web/src/api/health.ts` is deleted (nothing else
imported it, and it had no test of its own). The wiring is repo-131's Log, as
handed over: `main.tsx` imports `tokens.css`, `chrome.css`, `./styles.css` and
calls `bootTheme()` before `createRoot`; `web/theme.js` and the `input` /
`entryFileNames` pair in `vite.config.ts` write `/theme.js` unhashed;
`web/tsconfig.json` and `web/test/tsconfig.json` reference `packages/ui`;
`index.html`'s entry script is `blocking="render"`. The glyph is an open book,
`src/Glyph.tsx` and `public/favicon.svg`, drawn from the same path.

**What the brief had wrong, beyond Build 2's line (corrected above):**

- **`layout.spec.ts`'s radio check counted the theme switch.**
  `radiosBesideTheirLabels` asked for `getByRole("radio")` on the whole page, so
  Household and Salaries would have read six radios, not three, and the switch's
  icon-only labels fail its "label text beside the radio" test. It is scoped to
  `main` now. Nothing in the brief says so; the header adds radios to every
  screen, which is the kind of thing a spec that counts a role has to be
  told.
- **The `render-blocking-entry` plugin is local to the downloader's
  `vite.config.ts`**, not exported from `@webtools/ui`. It is copied here, with
  the same comment, and pinned by a test in `web/test/vite-config.test.ts`. The
  ledger is its second real consumer and pl-65 the third, so it is a candidate
  to lift; that edit is repo-131's code and was left to the orchestrator (an
  open decision in the report).
- **An error stub in a layout spec needs `retryable`.** The first stubs of
  `/api/me` omitted it, `errorPayloadSchema` refused the body, and the client
  threw `INTERNAL` instead of `FORBIDDEN`, so the shell stayed on the household
  screen. Both header cases failed on a 15 s timeout until `retryable: false`
  was added.

**The terms page's claims.** The pull request quotes each with the line that
makes it true. Four things on the page are not grounded in the code, and each
says so rather than promising: there is **no deletion path** (the page says
that, and that data is kept as long as the volume is, citing the append-only
rule and `classification-schema.test.ts`, which scans the API source for an
`UPDATE` or a `DELETE`); there is **no contact address** (the ledger has no
decided one, so the page names none and points to whoever added the reader's
email); **how long the log is kept** is a size, not a time
(`compose.ledger.prod.yaml` `max-size` / `max-file`), so none is promised; and
**whether the live host has an Anthropic key** is not in the repository, so the
page says what is sent "only if the operator set a key". The wording is a draft
for the owner to approve, as dl-54's was.

**The theme cookie sentence.** Told by the orchestrator, while this was being
built, that repo-131's gate 1 failed and its round rewords the downloader's
storage sentence: the choice is a parent-domain cookie, sent to every
`*.oludoi.com` host. The ledger's page never copied that sentence, but its own
said only "one cookie of ours ... a light or a dark look", which left out the
scope. It now says the cookie lasts a year, is set for the whole site and is sent
to the other tools on it, and that the ledger's server does not read it
(`grep -rni cookie tools/ledger/api/src` finds only `logger.ts`'s redaction
paths; `packages/ui/src/theme.ts` sets `Domain=` and `Max-Age=31536000`). If
repo-131's round words it differently, the two pages should say the same facts.

**Not folded in:** lifting the plugin (above); moving `.visually-hidden` uses
(the ledger has none); deleting `HealthResponse` from the contract (the API
still serves `/api/health`).

**Verification, at the head before this commit.** `npx vitest run tools/ledger/web`
305 of 305. `npm test -- --project ledger --project core` exit 0, 2,127 of 2,127
(106 files). `npm run check` exit 0. The ledger e2e suite
(`E2E_PORT=8172 npx playwright test -c tools/ledger/playwright.config.ts`) 29 of
29, including the three header cases, the terms page at both widths, and
`footer.spec.ts` (the built bundle shows `v0.4.1`, linked to `ledger-v0.4.1`; a
theme chosen in the header is the terms page's). `dist/app` holds `theme.js`,
`terms.html`, `terms.css` and `favicon.svg`, and `index.html` carries
`blocking="render"`. The screenshots in `e2e/.artifacts/layout/` were opened
(`Header (household)-360.png`, `Terms-360.png`): the header is on one line at
360 px and the terms page does not scroll sideways.
