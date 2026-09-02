---
id: dl-35
tool: downloader
title: The downloader serves no Content-Security-Policy, and now loads images
kind: work-package
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# dl-35 — a Content-Security-Policy for the downloader

**Packages:** `api` (`routes/web.ts`, or wherever the web bundle's headers are
set), `e2e`.

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

## Log

- **2026-09-01** — Filed from dl-29's branch, alongside dl-34, on the precedent
  of dl-32/dl-33 riding dl-23's. dl-29 declined to fold it in on its own Traps
  section's instruction; the user's call on that gate was to file, and the
  masking argument above is the reason the instruction was right rather than
  cautious. The `grep` was re-run on this branch before filing: still zero hits.
