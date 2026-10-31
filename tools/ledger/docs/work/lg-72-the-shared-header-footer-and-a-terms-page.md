---
id: lg-72
tool: ledger
title: Take the shared header and footer, and give the ledger a terms page
kind: work-package
status: done
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

## Review

**Gate: FAIL** — 2026-10-31 · `3eb342af..8c1375cb` (stacked on repo-131's branch; merge-base is the base) · Opus 5.5, depth full

| Done when                                                                                                                              | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All three screens render `AppHeader` and `AppFooter` from `@webtools/ui`; `App.tsx` has no `<header>`, no `Health`, no `/health` fetch | `web/test/app.test.tsx` › "the household's own screen has the shared header and footer, and asks nothing of /health", › "the no-household screen has the header with the household's tagline, and the footer", › "the admin's screen has the header tagged Admin, and the footer" (banner holds the h1, the tagline and the shared "Colour theme" group; contentinfo holds Terms) ✓; `web/test/shell-source.test.ts` › "App.tsx writes no <header> element of its own", › "App.tsx has no Health component and fetches no /health" (each negative paired with a positive `<AppHeader`/`<AppFooter` match) ✓. `web/src/api/health.ts` is gone and nothing in `web/src` or `web/test` names it; the API still registers `ROUTES.health` |
| The built bundle carries `tools/ledger/api/package.json`'s version                                                                     | `e2e/footer.spec.ts` › "the footer shows the API's version and links to its release" (link `v<version>` to `.../releases/tag/ledger-v<version>`), green in PR #694's `e2e` check at `8c1375cb` ✓; `web/test/vite-config.test.ts` › "writes the API's version into the bundle, the number release-please bumps (lg-72)" ✓. By hand: the built `index-*.js` holds `` var bl=`0.4.1` `` (api is 0.4.1); the `unknown` fallback is asserted by app.test's "Changelog" link under vitest                                                                                                                                                                                                                                                   |
| `/terms.html` is served, and the pull request quotes each of its claims with the code or config line that makes it true                | **not met** — served (`e2e/layout.spec.ts` › "the terms page fits a phone and a desktop"; `e2e/footer.spec.ts` › "the footer's Terms link opens the terms page, which links back") ✓, but the log paragraph's "It holds no statement row, no amount" is false at this head: see F1                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `e2e/layout.spec.ts` covers the three header variants and the terms page at 360 px and desktop width                                   | `e2e/layout.spec.ts` › "the household's header fits a phone and a desktop", › "the header fits a phone and a desktop for an address in no household", › "the header fits a phone and a desktop on the admin's own screen", › "the terms page fits a phone and a desktop", green in PR #694's `e2e` check at `8c1375cb` and locally (37 of 37 with the gate's probe) ✓                                                                                                                                                                                                                                                                                                                                                                 |
| `npm run check` and `npm test -- --project ledger` pass                                                                                | **verified** — `npm run check` exit 0; `npm test -- --project ledger` 2,010 of 2,010 (94 files); CI `check` and `test (ubuntu-latest)` green at `8c1375cb`. No test deleted or reworded; the only removal is `app.test.tsx`'s `fetchHealth` mock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

- **high** · F1 · the `Done when` 3 line depends on it · the terms page says the log "holds no statement row, no amount", and the claim table grounds it in `server.ts`'s `registerErrorHandling` (method, url, code, status). That `url` is `request.url`, query string included, and two routes the UI calls carry money and statement text in the query: `GET /api/receipts/:id/matches?amountCents=…&date=…` (`web/src/api/receipts.ts`) and `GET /api/rows?q=…` (History's search, `web/src/api/rows.ts`). Any refusal of either — 400, 401 on an expired token, 403 after a removal, 429 — writes the amount or the search text to the log. False in the unsafe direction: a reader is told the log is free of the very values the error handler's own comment strips from `details` because "a log outlives the request". Reproduction in the full report (`"url":"/api/receipts/…/matches?amountCents=4599&date=2026-10-01"`, `"url":"/api/rows?q=PHARMACIE%20JEAN%20COUTU&limit=9999"`). **Open decision**: (A) reword the page — a refused request's path can carry a History search or a receipt's amount and date — in scope by Build 4's rule; or (B) **recommended**: log the path without its query (`request.url.split("?")[0]` in `registerErrorHandling`), so that the page's sentence becomes true. The gate ran B: the probe logged `/api/receipts/…/matches` and `/api/rows`, and `logging`, `http-errors`, `theme-cookie-log` and the probe passed, 64 of 64. B touches `api/src/server.ts`, which is outside what the brief scoped, so the choice is the owner's.
- **low** · `nfr:maintainability` · `api/test/theme-cookie-log.test.ts`'s docblock says "every door a browser can use", but the rate-limited line (`rate-limit.ts`, `logger.warn("rate limited")`) is never reached: with `cookie: request.headers.cookie` planted there the file stays 3 of 3 green. No log call there takes a header today, so this has no live call site. The same plant in `registerErrorHandling` turns 2 of 3 red.
- **low** · the log paragraph lists "starting and stopping, requests that were refused, and errors". The paragraph omits three lines that successful requests write: "a workbook was described" (kind, token counts), "a described CSV was stored" (row counts) and "a described workbook was imported". These lines carry counts only, so the error runs in the unsafe direction about a detail nothing relies on.
- **low** · what a description sends: the page says "a sample of its rows". The `layout-view.ts` docblock also names each sheet's name and size and a computed cell's formula text. The page also lists what the books hold without the recurring (fixed) items. Both omissions understate, and each concerns a detail.
- **low** · "the address it asked for", on a page where "address" otherwise means an email address. Read with F1's remedy, this would say "path".
- **dropped** · "Without a key the ledger sends nothing outside the server" against the Access key-set fetch. That fetch is a GET that carries no data, and the page names Cloudflare as carrying the connection. Not a defect.
- **dropped** · "An address the directory does not hold is refused" against an admin who belongs to no household. The next bullet covers the admin. Not a defect.
- **dropped** · "Every record carries the person it was filed by". Child tables carry the filer through their parent: `statement_rows` through `statement_imports.imported_by`, `receipt_items` through `receipt_filings.filed_by`. `people` is enrolled by the server. True in substance.
- **dropped** · "nothing deletes it" against `filePhotoStore.discard`. That `rm` removes only a photo whose receipt row failed to insert. Not a stored record.
- **findings** · the hunt returned 9; 5 carried (1 high, 4 low), 4 dropped.
- NFR: security — F1 · performance n/a · reliability ✓ (layout at 360/1280 for all three headers beside 80-character spaced, 64- and 80-character unbroken household names: no overflow, switch on the name's line) · maintainability — lows above.

### Gate 2

**Gate: PASS** — 2026-10-31 · `8c1375cb..0ddf73d6` (round 2, three commits; stacked on repo-131's branch, merge-base `3eb342af`) · Opus 5.5, depth medium, scoped to the round

| Done when                                                                                                               | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| All three screens render `AppHeader` and `AppFooter`; `App.tsx` has no `<header>`, no `Health`, no `/health` fetch      | The round did not touch `web/`; the tests gate 1 named are unchanged and green in PR #694's `test (ubuntu-latest)` at `0ddf73d6` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The built bundle carries `api/package.json`'s version                                                                   | The round did not touch it; `e2e/footer.spec.ts` › "the footer shows the API's version and links to its release" green in PR #694's `e2e` at `0ddf73d6` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/terms.html` is served, and the pull request quotes each of its claims with the code or config line that makes it true | **verified** (was **not met**) — served: `e2e/layout.spec.ts` › "the terms page fits a phone and a desktop" and `e2e/footer.spec.ts` › "the footer's Terms link opens the terms page, which links back", green in `e2e` at `0ddf73d6`. Each sentence the round changed was checked against the code: the log paragraph against every `logger.*` call in `api/src` and `routes/workbook.ts`'s three lines, the path sentence against `pathOf`, the description against `layout-view.ts` (`layoutView`, `shown`, `layoutRequest`), and the recurring items against `recurring_items` (with its `entered_by` column). The PR table's rows for the log, the description and the cookie match the page. One row's label lags, a low below. `api/test/log-url.test.ts` › "a refused History search logs the path and not the search text" and › "a refused receipt match logs the path and not the amount or the date" pin the log claim ✓ |
| `e2e/layout.spec.ts` covers the three header variants and the terms page at 360 px and desktop                          | The round did not touch it; green in `e2e` at `0ddf73d6` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm run check` and `npm test -- --project ledger` pass                                                                 | **verified** — CI `check` and `test (ubuntu-latest)` pass at `0ddf73d6` (not re-run locally). Locally, `log-url`, `theme-cookie-log`, `logging` and `http-errors` pass, 66 of 66. The round adds tests and deletes or rewords none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

- **F1 (high) · fixed.** `registerErrorHandling` logs `url: pathOf(request.url)`, and `pathOf` cuts at the first `?`. Gate 1's probe, re-pointed to this directory, now logs `"url":"/api/receipts/…/matches"` and `"url":"/api/rows"`. The gate's population probe sent 400, 403 with no token, 403 with an expired token, 403 for a stranger, 403 for a member removed mid-run, 404 (no such route, and `RECEIPT_NOT_FOUND`) and 429. Each went to `/api/rows?q=SYNTHETIC%20SHOP`, to `/api/receipts/:id/matches?amountCents=4599&date=2026-10-01`, and to a path with `%3F` before a real `?`, and three of them also went over a raw socket. That collected 54 log lines from every logger: start-up, access, rate limit, the error handler and shutdown. 0 of them hold a query value. The one line that holds `SYNTHETIC` puts it before any `?` (dropped below). `%3F` survives as path (`"url":"/api/receipts/abc%3Fdef/matches"`). The not-found handler writes no log line, and its query-carrying `details.path` reaches only the response body. Positive control: with `pathOf` reverted, the same probe found 26 of 54 lines leaking, and `log-url.test.ts` went 2 of 2 red.
- **low (rate-limit line never reached by the cookie test) · fixed.** With the cookie planted in `rate-limit.ts`'s `logger.warn`, the new case › "the theme cookie reaches no log line when the person is rate limited" goes red (1 failed of 4). `8c1375cb`'s copy of the file stays 3 of 3 green under the same plant.
- **low (log paragraph omits the workbook lines) · fixed.** The page names them. Their fields are `kind`/token counts/`ok`, `rowsAdded`/`rowsInInbox`, and none.
- **low (description and books list understate) · fixed.** The page now names each sheet's name and size, the formula beside a computed cell, and the recurring items.
- **low ("the address it asked for") · fixed.** The page now says "the path it asked for without anything after a question mark".
- **low** · new · the PR body's books row still lists "pasted rows, rules, salaries, periods, receipts, the mortgage word", without the recurring items the page now names. Its grounding, `tools/ledger/CLAUDE.md`'s paragraphs after "A stored row is never edited", does cover them. The row understates in the safe direction, about a detail nothing relies on.
- **dropped** · a raw request line `GET /api/rows#SYNTHETIC?q=x` logs `"url":"/api/rows#SYNTHETIC"`. No browser sends a fragment, the UI builds none, and the page's "the path it asked for without anything after a question mark" describes that line exactly. Not a defect.
- **dropped** · the log paragraph's "with counts of rows and of the model's tokens", next to "a described workbook was imported", which carries no fields. It carries no values either, so the sentence is true in substance.
- **dropped** · "each cell with the formula that computed it beside it" against `shown`'s formula-only-when-computed rule. A cell with no formula has nothing beside it to send. True.
- **findings** · the hunt returned 4; 1 carried (low), 3 dropped. Gate 1's five findings: 5 fixed.
- NFR: security ✓ (F1 above) · performance n/a · reliability ✓ · maintainability ✓
- Nothing here is a `high`.

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

**2026-10-31 — the owner's answers to the build's two open decisions.** Relayed
by the orchestrator; the owner chose, from the options the build's report gave:

1. **The `render-blocking-entry` plugin.** Options: (a) lift it into
   `@webtools/ui` in repo-131's round; (b) one copy per tool. The owner chose
   **(a)**, the build's recommendation. The ledger's local copy, and its test in
   `web/test/vite-config.test.ts`, are replaced by the lifted plugin in this
   round.
2. **A contact address on the terms page.** Options: (a) none, with "ask whoever
   added your email"; (b) reuse `abuse@oludoi.com`; (c) a new ledger alias. The
   owner chose **(a)**, the build's recommendation. The page's "Who is
   responsible" section stays as it is.

**2026-10-31 — round 1: repo-131's new head merged, plugin lifted, cookie
sentence aligned.** Merged `3eb342af` (repo-131's round: `chrome.css` keeps the
header on one row, `@webtools/ui/vite` exports `renderBlockingEntry`, the
downloader's cookie sentence reworded) with `git merge`, no rebase.

- **The plugin.** `web/vite.config.ts` imports `renderBlockingEntry` from
  `@webtools/ui/vite`; the local copy and its test are gone. The lifted plugin is
  pinned once, in `packages/ui/test/vite-plugin.test.ts`; the ledger keeps one
  assertion that its config uses it (`web/test/vite-config.test.ts`). The built
  `web/dist/app/index.html` carries
  `<script blocking="render" type="module" crossorigin src="/assets/index-….js">`,
  and the plugin fails the build when there is no entry tag to mark.
- **The cookie sentence**, now the same facts as the downloader's: its name
  `webtools-theme`, kept a year, set for `oludoi.com`, holds only `light` or
  `dark`, sent with every request to any `oludoi.com` address, not read and not
  logged by the service, and "System" deletes it. Before:

  > Your browser keeps one cookie of ours, `webtools-theme`, which says only
  > whether you chose a light or a dark look, for a year. It is set for the whole
  > site, not only this address, so your browser sends it to every other tool on
  > the same site too, and a choice made in one is the choice in all. The
  > ledger's server does not read it. Cloudflare sets its own cookies when it
  > signs you in.

  After:

  > If you choose light or dark, your browser keeps that choice for a year in a
  > cookie named `webtools-theme`, set for `oludoi.com` so that every tool there
  > shows the same theme. It holds only the word `light` or `dark`, and your
  > browser sends it with every request to any `oludoi.com` address, this service
  > included. The service does not read it and does not write it to its log; the
  > page reads it in your browser. Choosing "System" deletes it. Cloudflare sets
  > its own cookies when it signs you in.

- **"Does not write it to its log" checked, not assumed.** The ledger's API
  logs no request header: Fastify's own logger is off (`server.ts:186`,
  `logger: false`), `grep -rn headers tools/ledger/api/src` finds none passed to
  a log call, and `request rejected` logs method, url, code, status and detail
  keys only. `logger.ts`'s redaction covers `headers.cookie` and
  `*.headers.cookie` (nested paths, not a bare `cookie` key), so redaction is the
  backstop, not the reason. Pinned in `api/test/theme-cookie-log.test.ts`: a
  `webtools-theme=dark` cookie sent to the page, `terms.html`, health, `/api/me`,
  a miss, a rejected POST, and a request with no token reaches no log line, with
  "something was logged" asserted first. It fails when
  `cookie: request.headers.cookie` is added to the `request rejected` fields
  (2 of 3 red), and passes again with the line removed.
- **Port.** `E2E_PORT=8172` was taken by another session's downloader e2e run
  (`http://127.0.0.1:8172/api/health is already used`); the re-run used 8186.
- **CodeQL on the draft's first round head `c208231e`.** The `CodeQL` check run
  failed in 2 s with "1 new alert including 1 high severity security
  vulnerability": rule "Bad HTML filtering regexp", at
  `tools/ledger/web/test/terms-page.test.ts:14`, "This regular expression does
  not match script end tags like `</script >`". It was this branch's own test, the
  build's `<script>…</script>` pairing regex, the shape repo-131's gate 1 (F2)
  had already refused in the downloader's terms test. The test now counts opening
  tags and checks the next characters close the one it found, as the downloader's
  does. The same run's `check`, `test (ubuntu-latest)`, `test (windows-latest,
  informational)`, `e2e`, `docker`, `codeql` and `dependency-review` jobs passed.

**2026-10-31 — round 2: gate 1 failed on one high finding; the owner's answer,
and the fix.** Gate 1 (`ticket-reviewer-opus`, at `8c1375cb`) found that the
terms page's "It holds no statement row, no amount" was false: the ledger API's
error handler logged `url: request.url` with its query string, so a refused
`GET /api/rows?q=…` (History's search) or `GET
/api/receipts/:id/matches?amountCents=…&date=…` wrote a statement's text, an
amount or a date to the log.

- **The owner's answer, 2026-10-31**, from the options the gate gave: (A) reword
  the page to admit it and file the leak; (B) log the path without its query, in
  this branch; (B) as its own pull request first. The owner chose **(B) in this
  branch**, the gate's and the build's recommendation. The ledger's `CLAUDE.md`
  already says "a log carries their names and no values".
- **The leak was already on `main`.** `registerErrorHandling` in
  `api/src/server.ts` has logged `request.url` since the handler was written; it
  is not something this branch introduced. This branch fixes it, because the
  terms page is the first document that says otherwise.
- **Red, then green.** `api/test/log-url.test.ts` (two tests, synthetic text
  only) sends a refused `GET /api/rows?q=SYNTHETIC%20SHOP&limit=999999` (400) and
  a refused `GET /api/receipts/not-an-id/matches?amountCents=4599&date=2026-10-01`
  (400), asserts a `request rejected` line exists first, that it carries the path
  alone, and that no line holds `SYNTHETIC`, `4599` or `2026-10-01`. Before the
  fix, `npx vitest run tools/ledger/api/test/log-url.test.ts`: 2 of 2 failed, with
  `"url":"/api/rows?q=SYNTHETIC%20SHOP&limit=999999"` and
  `"url":"/api/receipts/not-an-id/matches?amountCents=4599&date=2026-10-01"` in
  the received line. After: 2 of 2 passed.
- **The one log call changed**: `server.ts` `registerErrorHandling`'s `fields`,
  `url: request.url` now `url: pathOf(request.url)`, where `pathOf` drops
  everything from the first `?`. `grep -rn "request.url\|raw.url\|originalUrl"
  tools/ledger/api/src` finds two other uses, neither a log call: the not-found
  handler's response `details.path` (the caller's own body; the handler logs
  only the details' names), and `routes/web.ts`'s prefix test. Every other
  `logger.*` call in `api/src` was read; none takes a URL, a header or a request.
- **The rate-limit log line was not reached by the cookie test** (gate 1, low).
  `theme-cookie-log.test.ts` gained a fourth test: with
  `rateLimitReadsPerMinute: 1` a second `GET /api/rows` is refused 429, a
  `rate limited` line is asserted, and no line holds the cookie. With
  `cookie: request.headers.cookie` planted in `rate-limit.ts`'s `logger.warn`
  that test is red (`expected [ Array(1) ] to deeply equal []`, 1 failed of 4);
  with the plant removed, 4 of 4.
- **The terms page**, four lows and the owner's cookie wording, in
  `web/public/terms.html`: the log paragraph now names the workbook lines ("when
  a spreadsheet is described or imported it also writes a line saying so, with
  counts of rows and of the model's tokens and nothing of the spreadsheet") and
  says "the path it asked for without anything after a question mark"; the
  description names each sheet's name and size and the formula beside a computed
  cell (`layout-view.ts`'s docblock); the books list the recurring items. The
  cookie sentence, settled by the owner for both tools: "sends it with requests
  to `oludoi.com` addresses" and "so that the tools there can share it". The
  round 1 entry above quotes the earlier wording as it stood then.
- **Not done**: repo-131's branch was not merged in this round, as told.
- **Verification, at the head before this commit.** `npm run check` exit 0.
  `npm test -- --project ledger --project core` exit 0, 2,137 of 2,137 (109
  files). `E2E_PORT=8193 npx playwright test -c tools/ledger/playwright.config.ts
  e2e/layout.spec.ts e2e/footer.spec.ts` 29 of 29.
