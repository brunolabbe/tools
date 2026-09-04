---
id: dl-35
tool: downloader
title: The downloader serves no Content-Security-Policy, and now loads images
kind: work-package
status: done
milestone: null
depends_on: []
difficulty: standard
---

# dl-35 — a Content-Security-Policy for the downloader

**Packages:** `api` (`routes/web.ts`, or wherever the web bundle's headers are
set), `e2e`, and `web` (a small, disclosed widening — see the 2026-09-03 Log
entry, point 3).

## Why

There is no `Content-Security-Policy` anywhere in the tool. Measured, twice:

```
$ grep -rn "Content-Security-Policy" tools/downloader --include=*.ts --include=*.html
$ echo $?
1
```

That was already worth fixing. What makes it worth a ticket now is that **dl-29
gave the page its first `<img>`**. Until this branch the app rendered no
external subresource of any kind; `img-src` had nothing to constrain and the
absence of a policy cost nothing observable. It now loads
`/api/thumbnail/<token>` on the probe panel and on every job card.

The preview is served safely on its own terms — the bytes are fetched
server-side through the SSRF guard, the `Content-Type` is checked against a
four-member allowlist that excludes `image/svg+xml`, and `X-Content-Type-Options:
nosniff` is set (`api/src/routes/thumbnail.ts`). A CSP is the layer that says so
at the _page_ level rather than per response, and it is the layer that also
covers the next subresource somebody adds without thinking about any of this.

## Why dl-29 did not do it, which is this ticket's whole point

dl-29's own Traps section instructed against it, and the reasoning is the reason
to file rather than fold:

> Do not add a `Content-Security-Policy` as part of this. There is none in the
> repo today, and adding one while also adding the first image the app loads is
> two changes in one branch, the second of which can break the page silently.

The failure mode is specific and asymmetric. A CSP that is slightly too strict
does not throw, does not fail a test that is not looking for it, and does not
show up in `npm run check`. It shows up as an image that does not render — which
is **exactly** the symptom dl-29's `Preview` component is built to swallow on
purpose: `onError` hides the element rather than leaving a broken-image glyph.
So a wrong `img-src` and a working `img-src` produce an identical, silent,
green-suite page. The two changes would mask each other precisely because one of
them is a deliberate silent failure.

Doing it on its own branch means the preview is already known to work, so a
preview that stops working can only be the policy.

## Build

1. **Add the header to the web routes**, not to the API routes — the policy is
   about the document, and `/api/*` responses are JSON and bytes.
2. Start from `default-src 'self'`, and enumerate rather than widen. What the
   app actually needs, from a read of the bundle:
   - `img-src 'self'` — the preview is same-origin by construction. If it ever
     stops being, that is a change to dl-29's design and not a reason to relax
     this.
   - `connect-src 'self'` — `fetch` and the SSE stream.
   - `style-src` — check whether Vite inlines a style attribute or a `<style>`
     block in the built output before deciding whether `'unsafe-inline'` is
     unavoidable. **Measure it against `npm run build`'s output, not against the
     dev server**, which injects differently.
   - `script-src 'self'` — and confirm the built bundle has no inline script.
   - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`.
3. **Do not add `report-uri`/`report-to`.** There is nowhere to send it and it
   would be the second thing in this branch.

## Done when

1. The document response carries the policy, proven by an API test on the header.
2. **The preview still renders**, proven in `tools/downloader/e2e/` rather than
   by a unit test — this is the one claim a unit test structurally cannot make,
   because `Preview` hides a failed image and jsdom does not enforce CSP. An e2e
   assertion that the `<img>` is present _and_ has non-zero `naturalWidth` is
   what distinguishes "rendered" from "silently suppressed".
3. No console CSP violation on the happy path, asserted in the same e2e spec.
4. `npm run check` and `npm test -- --project downloader` pass.

## Review

**Gate: CONCERNS** — 2026-09-04 · `ed784aa` · `ticket-reviewer`, reproducing in
its own detached worktree

| Done when                                                             | Proof                                                                                                                                                                            |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · The document response carries the policy, proven by an API test   | **proven** — `api/test/csp.test.ts:96` (the exact directive set, both directions) · `:98` (each directive's value) for `index.html`; `:123` · `:125` for the SPA fallback        |
| 2 · The preview still renders, in `e2e/`, `<img>` with non-zero width | **unproven (gate)** — `e2e/sniffer/mse-page.spec.ts:136` (present) · `:147-148` (`naturalWidth === 64`) · `:152` (the origin was asked, by the API). See the note below          |
| 3 · No console CSP violation on the happy path, same e2e spec         | **unproven (gate)** — `e2e/sniffer/mse-page.spec.ts:214`; the same assertion also guards the other two journeys, `e2e/csp.spec.ts:179` and `e2e/download.spec.ts:104`            |
| 4 · `npm run check` and `npm test -- --project downloader` pass       | **verified** — both re-run by the reviewer at `ed784aa`: `check` exit 0; 60 files / 947 tests. (Reported as "proven"; `verified` is this repo's word for a row a command proves) |

**What `unproven (gate)` means on rows 2 and 3, because unqualified it will be
misread.** It means CI has not run against this commit — **not** that the lines
are untested. Both e2e suites were run green, locally and independently, twice:
by the builder before reporting, and by the reviewer afterwards in a separate
detached worktree at `ed784aa` (fast config 7/7, sniffer 1/1).
`.github/workflows/downloader.yml` runs both as `e2e (direct)` and
`e2e (sniffer)` on every pull request touching this tool, and these rows clear to
`proven` when it does. The branch was unpushed at gate time because the build
deliberately stopped short of the pull request.

- **decision (answered)** · The build widened past the ticket's `api` + `e2e` into
  `web`, to stop zod's `new Function("")` JIT probe reporting a violation on every
  page load (Log, point 3). Three options went to the user: keep the dependency
  edge as built; relocate `config({ jitless: true })` into a new
  `@downloader/contract` subpath export; or revert it and relax the
  empty-violation assertion. **Answered: keep it as built.** Two findings of this
  gate carried it — that the `package-lock.json` line adds an edge to an
  **already-resolved** `zod@4.4.3` rather than a new version, and that relocating
  into `contract` does **not** remove the ordering fragility, only moves which
  file's comment nobody reads, while adding an edit to a package three siblings
  depend on. Recorded here so the widening reads as a decision rather than creep.
- **low** · The import order in `web/src/main.tsx` is load-bearing and only the
  e2e suite catches a reorder. Reproduced: moving `import "./lib/zod-jitless.ts"`
  below `@downloader/contract` and rebuilding turns exactly one assertion red
  (`csp.spec.ts:179`, `blockedURI: "eval"`), 3 of 4 still passing. The gate then
  established from zod's own source why no cheaper guard is possible:
  `util.allowsEval` is a `cached()` getter that fires **once**, lazily, at the
  first `_object` schema construction (`schemas.js:965-990`, `util.js:145-160`)
  and memoises process-wide, and the `ctx.jitless` parse option gates only an
  already-compiled fastpass, never the probe. It also confirmed nothing else
  would notice: no unit test imports `main.tsx` or `zod-jitless.ts`,
  `.oxlintrc.json` carries no `import/order` rule, and oxfmt does not reorder
  imports. **No change** — a guard exists and it works; what this bullet records
  is its _tier_. `npm test` and `npm run check` both stay green through a
  reorder, so the thing that catches it is CI, not the fast loop.
- **low** · The ticket's `**Packages:**` line named only `api` and `e2e` while the
  Log disclosed the `web` widening in prose. **Fixed** in `a5077c0`, pointing at
  the disclosure rather than restating it.
- **no finding** · The policy is enforced rather than asserted. The gate
  reproduced both red runs at the counts the Log claims — hook removed: 3 of 4 in
  `e2e/csp.spec.ts`, 4 of 8 in `api/test/csp.test.ts` — and the cross-origin
  differential (`csp.spec.ts:101` · `:105-106` · `:112` blocked and never
  requested, `:120-121` the same image loading from a policy-free page).
- **no finding** · The hand-edited `package-lock.json` line verified without
  installing: `npm ls zod -w @downloader/web` exit 0, no `invalid`, `extraneous`
  or `missing`. The gate was explicit that it did **not** run `npm ci`, so a
  fresh install from this lockfile is reasoned about rather than measured.
- **no finding** · The new `web` → `zod` dependency owes no `Dockerfile` edit.
  Vite bundles zod into the static `dist/app` assets at build time, and the
  runtime stage copies `web/dist/app` + `web/package.json` and never
  `web/node_modules`, so nothing resolves zod at container runtime. The
  two-Dockerfile-edits rule is about the API's runtime resolution.
  `image-closure.test.ts` and `spawn-safety.test.ts` both pass.
- **no finding** · Test integrity. `api/test/csp.test.ts`, `e2e/csp.spec.ts` and
  `e2e/csp-violations.ts` are wholly new; `download.spec.ts` is purely additive
  (0 deletions); `mse-page.spec.ts`'s single deletion is an import statement
  reformatted to take two more named imports. No existing assertion was weakened
  or removed.
- **no finding** · `tools/downloader/contract` is untouched — no unilateral
  contract edit. Tool boundary intact (zod is third-party, not cross-tool). The
  new test files land inside already-registered tsconfig project globs, so they
  cost no reference line.
- **not chased**, and named as such by the gate rather than reasoned about: the
  container was never built, so the policy is known to be served by `main.ts`
  under `WEB_DIR` and not by the shipped image; and only Chromium was driven,
  which is the single project both Playwright configs define.
- NFR: security — the point of the change, and enforcement measured rather than
  asserted · performance — zod's interpreted parse path in the browser instead of
  its JIT one, on API payloads of a few hundred bytes · reliability ✓ ·
  maintainability — the `low` above, whose whole content is which tier its guard
  runs at.

Every `file:line` cited in this section was re-resolved against the branch tip
before it was committed; all hold. The gate read `ed784aa`, and `a5077c0` — the
only commit since — touches this file alone.

## Log

- **2026-09-01** — Filed from dl-29's branch, alongside dl-34, on the precedent
  of dl-32/dl-33 riding dl-23's. dl-29 declined to fold it in on its own Traps
  section's instruction; the user's call on that gate was to file, and the
  masking argument above is the reason the instruction was right rather than
  cautious. The `grep` was re-run on this branch before filing: still zero hits.

- **2026-09-03** — Built. The policy is
  `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
  set by an `onSend` hook in `api/src/routes/web.ts` gated on the response's
  content type being `text/html`. Gated that way rather than per-route because
  there are **two** doors to the same document — `@fastify/static`'s index and
  `serveIndexForUnknownPath` — and the other direction matters as much: `/api/*`
  answers JSON and bytes and gets nothing.

  Four things the brief did not know, in the order they cost time.

  **1. `Done when` #2 cannot be met in `e2e/` as the Build section implies, and
  is now met in `e2e/sniffer/`.** The preview only exists when a probe produced
  a `thumbnailPath`, and the only resolver that reads an `og:image` is the
  browser tier (`resolvers/src/browser/provoke.ts`) — which
  `playwright.config.ts` deliberately disables, on dl-16's reasoning. The direct
  tier never parses HTML at all. So the fast suite had, and could have, no
  preview to break. The proof went into `sniffer/mse-page.spec.ts`, and the
  fixture grew an `og:image` and a real 64×36 PNG generated by the same ffmpeg
  that makes the clip (`e2e/fixtures/hls-origin.ts`). That spec is now the only
  place in the repo where dl-29's whole pipeline runs end to end.

  **2. `toBeVisible()` does not catch a blocked preview — `naturalWidth` does.**
  The Why section predicted `Preview`'s `onError` would hide the element and
  make the failure silent. Measured, by serving `img-src 'none'` and running the
  sniffer spec: the element stayed in the DOM and stayed **visible**, and only
  `naturalWidth` moved, 64 → 0. The prediction that the failure would be silent
  was right; the mechanism was not, and a spec that asserted presence or
  visibility would have passed over a dead preview. Both assertions are in the
  spec, with that measurement written beside them.

  **3. A CSP violation the app raises on every page load, from zod.** zod v4
  decides whether to JIT-compile validators by probing `new Function("")` inside
  a `try`. Under `script-src 'self'` that is refused: zod catches it and falls
  back, so **nothing breaks**, but the browser files a `securitypolicyviolation`
  (`blockedURI: "eval"`) on every load — which `Done when` #3 forbids. Fixed at
  the source with zod's own `jitless` flag, in `web/src/lib/zod-jitless.ts`,
  imported first in `main.tsx`. **It has to be first**: zod reads the flag while
  a schema is _constructed_, and `@downloader/contract` builds its schemas at
  module scope, so a `config()` call in `main.tsx`'s body is too late — measured,
  the violation was still there. `zod` is now a declared dependency of
  `@downloader/web`, with one line added to `package-lock.json` by hand
  (`npm install --package-lock-only` also wanted to bump two stale workspace
  `version` fields, which are pre-existing drift and not this branch's business).
  This is the one place the work went outside the ticket's named packages, and
  it is reversible on its own: revert the module, the import and the two
  manifest lines, and relax `csp.spec.ts`'s empty-violation assertion.

  **4. `style-src` needs no `'unsafe-inline'`, and the CSSOM write is fine.**
  Measured against `npm run build`'s output: the built `index.html` has one
  external module script, one external stylesheet, no inline `<style>` and no
  `style=` attribute anywhere in `web/src`. React 19's `<style href precedence>`
  path is in the bundle but unreachable — nothing renders one. The single CSSOM
  write, `lib/theme.ts` setting `root.style.colorScheme`, is not governed by
  `style-src` (CSP hooks the `style` content attribute, not
  `CSSStyleDeclaration`); `csp.spec.ts` clicks the theme toggle and reads the
  value back rather than leaving that as an argument.

  Enforcement is proven by differential, not by asserting on the header string:
  the fixture's PNG is refused cross-origin — and the fixture server's own
  request log shows it was **never asked for**, so the refusal happened before
  the socket — while the same image in the same browser loads from the fixture's
  own policy-free page. An injected inline `<script>` does not run. Red runs:
  with the hook removed, four of eight assertions in `api/test/csp.test.ts` and
  three of four in `e2e/csp.spec.ts` fail; with the hook left ungated, the three
  "does not carry it" assertions fail.

  Deliberately not done, so nobody has to re-derive it: no `form-action`,
  `Referrer-Policy` or `X-Frame-Options` — the Build section enumerated a policy
  and adding to it is a second decision; no `report-uri`/`report-to`, per the
  brief; and **no CSP for the planner**, which would be a second tool in one
  branch and therefore two changelog lines under one title. When the planner
  does get one, it is the second consumer of `zod-jitless.ts` and that is the
  moment it moves to `packages/`.

  Not measured here: the container was never built, so the policy is only known
  to be served by `main.ts` under `WEB_DIR` and not by the shipped image; and
  only Chromium was driven, which is the only browser either Playwright config
  runs.
