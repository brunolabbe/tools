---
id: dl-29
tool: downloader
title: Show a preview image when choosing a rendition, and in the downloads list
kind: work-package
status: ready
milestone: null
depends_on: []
---

# dl-29 — a preview image in the probe panel and on the job card

**Packages:** `contract` (`job.ts`, `api.ts`), `api` (a new route, `ssrf.ts`,
`jobs/orchestrator.ts`), `web` (`ProbePanel.tsx`, `JobCard.tsx`, the mock API).

## Why

Choosing between `1080p60 · H.264 + AAC · ~420 MB` and four rows just like it is
a decision made entirely on a text label. There is nothing on the screen that
says _which video this is_ — a user who pasted the wrong URL, or who has three
downloads running, finds out when the file lands. The same is true of the
downloads list, where a job is identified by `job.variant?.label ?? filename ??
sourceUrl` ([`JobCard.tsx`](../../web/src/components/JobCard.tsx)) — a rendition
label, a filename, or a bare URL.

**The data already exists and is already thrown away.** `ProbeResult.thumbnailUrl`
is in the contract at [`api.ts:138`](../../contract/src/api.ts), and both
resolvers populate it: the browser tier from `og:image` / `twitter:image` at
[`browser.ts:249`](../../resolvers/src/resolvers/browser.ts), the yt-dlp tier
from `info.thumbnail` at [`ytdlp.ts:394`](../../resolvers/src/resolvers/ytdlp.ts).
It survives the API intact and then dies at the UI boundary:

```
$ grep -rn "thumbnailUrl" tools/downloader/web/src
$ echo $?
1
```

So this is not "fetch a new thing". It is "stop discarding a thing we already
have", plus the delivery path that makes showing it safe.

**Three answers were settled with the user before filing** and are not open:

1. The bytes are **proxied through the API**, not loaded with a bare `<img src>`.
2. It is **one preview per video**, not one frame per rendition.
3. The downloads list remembers it via a **contract change to `Job`**.

The reasoning for (1) is the part worth carrying forward, because it is the one
that looks like unnecessary work until it is written down. `og:image` is a
`<meta>` tag on a page we were handed by the user and do not trust — it is
resolver output, which [`probe.ts:101`](../../api/src/routes/probe.ts) already
calls "attacker-influenced" when it sweeps every other URL in the probe. Putting
it in an `<img src>` makes the **user's own browser** issue a `GET` at an
attacker-chosen URL, including at addresses only that browser can reach:

```html
<meta property="og:image" content="http://192.168.1.1/admin?action=reboot" />
```

That is a CSRF gadget aimed at the user's LAN, handed out by us, and no
server-side guard sees it — the whole of `ssrf.ts`, `dispatcher.ts` and
`egress-proxy.ts` is upstream of a request the browser makes on its own. It also
leaks the user's IP and `Referer` to the source, and a thumbnail behind the same
`Referer`/`Cookie` gate as the manifest simply renders broken. Proxying costs a
route and buys all four.

(2) is a data fact rather than a preference: `og:image` and `info.thumbnail` are
per-video. There is exactly one image no matter how many renditions a probe
returns. A genuine per-rendition preview would mean grabbing a frame from each
variant with ffmpeg — a different and much larger feature, and explicitly out of
scope here.

## Build

### The shape, and the one thing that makes it not an open proxy

**The client never hands the server a URL to fetch.** That is the whole design
constraint; everything below follows from it. A route that takes
`?url=<anything>` is an open proxy with an SSRF guard bolted on, and it would let
any caller use this service to fetch arbitrary public URLs from our address. The
repo already has the answer to this in
[`files.ts`](../../api/src/routes/files.ts): _"`token` is opaque and unguessable
— it is the capability, not the job id"_ ([`api.ts:285`](../../contract/src/api.ts)).
Do the same here.

**Fetch eagerly, at probe time, and serve the stored bytes.** The alternative —
fetch lazily when the browser asks — is the one to reject, and there is a
concrete reason beyond taste: replaying the source's credentials needs
`probe.requestContext.headers`, and **`Job` does not carry a `requestContext`**
([`job.ts:111`](../../contract/src/job.ts)). At probe time those headers are in
hand; at "some browser asked for a job's thumbnail an hour later" they are not.
Fetching where the credentials already are is the only version that works for
both surfaces with one code path.

1. **Vet the thumbnail with everything else.**
   [`urlsInProbeResult`](../../api/src/ssrf.ts) at `ssrf.ts:282` sweeps variant
   URLs, `audioUrl` and subtitle URLs — and **not** `thumbnailUrl`. That is
   currently safe only because nothing fetches it; the moment step 2 exists it is
   a hole. Add it to that function, so one place stays authoritative for "URLs a
   probe caused us to fetch". Note the function takes a structural type, not
   `ProbeResult` — widen it and both call sites
   ([`probe.ts:101`](../../api/src/routes/probe.ts),
   [`orchestrator.ts:210`](../../api/src/jobs/orchestrator.ts)) get it for free.

   **Trap:** the sweep is `assertAllAllowed`, which _throws_. A thumbnail on a
   blocked address must not fail the whole probe — the video is still
   downloadable. Drop the thumbnail and continue; do not let a decorative image
   turn a working probe into an error. This is the one place the thumbnail must
   be treated differently from the URLs already in that list, and it is why
   adding it naively to the existing array is wrong.

2. **Fetch it once, after the sweep, in `probe.ts`.** Use the injected
   `guardedFetch` (`guarded-fetch.ts` re-checks every redirect hop — a thumbnail
   URL answering `302` into link-local is exactly the case it exists for),
   replaying `probe.requestContext.headers`. Bound it hard, because it is
   decorative and must never be able to hurt the probe:
   - a short timeout of its own, well under `config.probeTimeoutMs`;
   - a byte cap, enforced while reading rather than by trusting
     `Content-Length` (a lying header is free);
   - a `Content-Type` allowlist — `image/jpeg`, `image/png`, `image/webp`,
     `image/gif`. Anything else is discarded. **Do not** serve back a
     `Content-Type` the origin chose without checking it against this list, and
     serve `X-Content-Type-Options: nosniff`.
   - **every failure is non-fatal.** Timeout, 404, oversized, wrong type,
     blocked address — the probe returns exactly as it does today, with no
     preview. Nothing here throws an `AppError` into the probe path, and **no
     new error code is needed**; do not add one to
     [`DOWNLOADER_ERROR_CODES`](../../contract/src/errors.ts).

3. **Store the bytes and mint a token.** A bounded, TTL'd, in-memory store,
   modelled on [`ProbeCache`](../../api/src/jobs/probe-cache.ts) — which is the
   right precedent to copy (a `Map`, a `maxEntries` bound with the comment
   _"Bounds memory: a probe result with many variants is not small"_, a TTL).
   Images are tens of kilobytes; the bound is about refusing to grow without
   limit, not about size. Do not put these on disk in `STORAGE_DIR`: that
   directory has a retention sweep and a token table built for multi-gigabyte
   media, and a preview image outliving the process is worth nothing.

   Add `ROUTES.thumbnail: (token: string) => ` `` `/api/thumbnail/${token}` `` to
   [`ROUTES`](../../contract/src/api.ts) at `api.ts:278`.

4. **Put the token in the probe response, not the origin URL.** The client needs
   something to put in `<img src>`, and it must be our path. Keep
   `ProbeResult.thumbnailUrl` as the origin URL it is today — resolvers set it and
   it is honest — and let the API replace it with the proxied path on the way
   out, next to where [`withoutEgressProxy`](../../api/src/egress-proxy.ts)
   already rewrites the probe before it is sent. That keeps one field and no
   contract addition on `ProbeResult`.

   **Decide and record which**, because the alternative is defensible: add a
   separate `thumbnailPath` and leave `thumbnailUrl` untouched, at the cost of a
   second field the UI must choose between. The single-field version is
   recommended — an origin URL the client is not allowed to fetch has no business
   being sent to the client at all, and shipping both invites someone to use the
   wrong one. Whichever is chosen, say so in the Log and make sure the origin URL
   does **not** reach the browser.

5. **Snapshot it onto the job.** `Job` gains `thumbnailUrl: string | null`, in
   [`job.ts:111`](../../contract/src/job.ts) and in `jobSchema` in
   [`api.ts`](../../contract/src/api.ts). This is the approved contract change,
   and it has an exact precedent one line up — `variant` at
   [`job.ts:117`](../../contract/src/job.ts), _"Snapshot of the chosen variant,
   kept so the UI can label the job after the probe ages out."_ Same sentence,
   same reason. Write the comment so the next reader knows the field holds **our
   proxied path, not the origin URL**, since the name alone will not say it.

   Set it where the variant is set:
   [`orchestrator.ts:230`](../../api/src/jobs/orchestrator.ts),
   `store.patch(jobId, { variant, variantId: variant.id }, …)`. The orchestrator
   re-probes unconditionally (`orchestrator.ts:210`), so a fresh
   `probe.thumbnailUrl` is in scope right there and the token it patches in is
   one this run just minted — it does not depend on the probe cache still
   holding anything.

   **Trap:** check whether the job store's persistence layer needs a schema
   version bump. [`job-store.ts:20`](../../web/src/lib/job-store.ts) is
   `"downloader:jobs:v1"` and is documented as _"Versioned so a contract change
   can invalidate old entries instead of crashing on them"_. Adding an **optional
   or nullable** field is backward-compatible — an old persisted job parses fine
   and simply has no preview — so the bump is probably **not** needed, and
   bumping it would throw away every user's in-flight job list for a decorative
   image. Confirm it against `jobSchema` rather than assuming, and if you make
   the field non-optional you have chosen the bump; prefer not to.

### The UI

6. **Probe panel.** One image in the `card__head` region of
   [`ProbePanel.tsx`](../../web/src/components/ProbePanel.tsx), beside the title
   and the pills, above the `VariantTable`. Reserve its space with a fixed aspect
   ratio so the panel does not reflow when the image arrives or never arrives.
   `alt=""` — it is decorative and the title is right next to it; an `alt` of the
   video title would make a screen reader read the same string twice. Hide it on
   `onError` rather than leaving a broken-image glyph.

7. **Job card.** Same image on the left of `job__head` in
   [`JobCard.tsx`](../../web/src/components/JobCard.tsx), at a smaller size,
   beside `job__titles`. It comes from `job.thumbnailUrl`. Existing jobs and jobs
   whose probe had no thumbnail render exactly as they do now — this must be
   additive, and the layout must not depend on the image being there.

8. **The mock API.** [`scenarios.ts`](../../web/src/api/scenarios.ts) is what the
   component tests and the dev server run against, and no scenario has a
   thumbnail today. Add one to the base probe, and **keep at least one scenario
   without one**, since "no preview" is the path that must not break and is the
   common case for a resolver that found nothing. `web/test/probe-panel.test.tsx`
   and `web/test/job-card.test.tsx` already exist and are where these assert.

### Traps worth knowing in advance

- **Do not add a `Content-Security-Policy` as part of this.** There is none in
  the repo today (`grep -rn "Content-Security-Policy" tools/downloader` is
  empty), and adding one while also adding the first image the app loads is two
  changes in one branch, the second of which can break the page silently. If it
  is worth doing — and it is — file it.
- **The rate limiter.** `context.rateLimits` is
  `{ probe: RateLimiter; jobs: RateLimiter }`
  ([`context.ts`](../../api/src/context.ts)). The thumbnail route serves bytes
  from memory by an unguessable token and costs nothing to answer, so it likely
  needs no bucket of its own — but say so deliberately in the Log rather than
  leaving it unconsidered, and note that dl-23 is open against the _download_
  route for related reasons.
- **`withoutEgressProxy`.** The probe is rewritten before it goes out because the
  loopback proxy port _"is no client's business"_. Whatever you do in step 4 must
  compose with that, not bypass it.

## Done when

1. A probe whose `thumbnailUrl` is set renders a preview image in the probe panel
   above the rendition table, proven by a render test in
   `web/test/probe-panel.test.tsx` against a mock scenario that has one.
2. A probe with **no** `thumbnailUrl` renders the panel unchanged and with no
   broken image, proven by a second test against a scenario that has none.
3. A job whose `thumbnailUrl` is set renders the preview on its card, and one
   without renders as it does today — both proven in `web/test/job-card.test.tsx`.
4. `thumbnailUrl` survives a `job-store` round trip, proven in
   `web/test/job-store.test.ts`; and a persisted job written **without** the field
   still loads (the backward-compatibility case from Build 5), proven by a test
   that parses a v1-shaped record lacking it.
5. The origin thumbnail URL is **not** present in the probe response sent to the
   client — the client receives only the proxied path. Proven by an API test
   asserting on the response body, not by reading the code.
6. `urlsInProbeResult` includes the thumbnail URL, proven by a unit test in
   `api/test/ssrf.test.ts` (which already covers this function at `:152`).
7. A thumbnail on a blocked address does not fail the probe: the probe returns
   its variants normally, with no preview. Proven by an API test with a guard
   stubbed to refuse that host — this is the trap in Build 1 and the one most
   likely to be got wrong.
8. An oversized response and a non-image `Content-Type` are both discarded, and
   the probe still succeeds. Proven by tests against a fixture server, not live
   network.
9. `GET /api/thumbnail/<unknown-token>` answers a clean 404-shaped error rather
   than a 500, and there is no route shape anywhere that accepts a caller-supplied
   URL to fetch.
10. `npm run check` and `npm test -- --project downloader` pass.

## Review

I checked out `d74a9fc1765f180752cf6186500008ad16f5199e` via `git fetch origin && git checkout --detach d74a9fc1765f180752cf6186500008ad16f5199e`. `git log --oneline -1` reports `d74a9fc docs(downloader): file dl-29, a preview image for a rendition and a job (dl-29)` — matches the sha given. `git diff --stat origin/main...HEAD` reports one file, `tools/downloader/docs/work/dl-29-preview-image-for-a-rendition.md`, 297 insertions — matches what I was told to expect. `origin/main` resolves to `1d420b79fdbe85ea9a0ff70c142171d903195249`, matching the ticket's own "measured at filing time" base.

This diff adds only the ticket brief — no implementation, no test. Its own ten `Done when` lines describe a future implementation PR, not this one, so applying them literally to this diff (mark all `unproven`, gate `FAIL`) would gate every filing-only commit to automatic failure regardless of quality — and `docs/01-TICKETS.md` treats filing as a legitimate, separately-gated PR shape in its own right ("Filing costs an intake slot, a dispatch, a gate, a pull request and a merge"). I gated this diff on what it actually is: a dispatchable brief. **This is my own interpretive call, not the skill's letter — if you'd rather I mark all ten lines `unproven` and gate `FAIL` mechanically, that's the alternative reading and I can redo it that way.**

### This diff's own acceptance (what I gated)

| Check                                                                                                     | Result                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every `file:line` / quoted-comment citation resolves against `origin/main` @ `1d420b7`                    | **proven** — all 13 checked resolve exactly (list below)                                                                                                                                                                                                                                                                          |
| Contract change (`Job.thumbnailUrl`, `jobSchema`, `ROUTES.thumbnail`) is shown as a decision, not assumed | **proven** — Log records it settled pre-filing and names the `CLAUDE.md` rule it satisfies                                                                                                                                                                                                                                        |
| Ticket id/frontmatter valid, `dl-29` is the correct next id                                               | **verified** — `npm run status -- --show dl-29` and `-- --json` both exit 0; `ls tools/downloader/docs/work` and a grep of every ticket's Log show `dl-28` as the prior high-water mark and no earlier reservation of `dl-29`                                                                                                     |
| Markdown formatting (`oxfmt --check`, part of `npm run check`)                                            | **verified** — passes                                                                                                                                                                                                                                                                                                             |
| PR title is a valid conventional commit                                                                   | **verified** — `node scripts/commit-message.mjs --text "docs(downloader): file dl-29, a preview image for a rendition and a job (dl-29)"` exits 0                                                                                                                                                                                 |
| `npm run check` on this branch                                                                            | **verified** — exit 0                                                                                                                                                                                                                                                                                                             |
| Build steps internally consistent, no contradiction of repo invariants                                    | **CONCERNS** — two internal tensions (findings 2, 3)                                                                                                                                                                                                                                                                              |
| Nothing proposed breaks a root/tool `CLAUDE.md` rule if built as written                                  | **CONCERNS** — one verified defect in the brief's own backward-compatibility reasoning (finding 1); everything else proposed (proxy-not-`<img src>`, capability-token reuse, `guardedFetch`'s redirect re-checking, no shell involved, no unnecessary new error code, SSRF-sweep-everything) is consistent with both `CLAUDE.md`s |

Citations checked against `origin/main` and all resolved exactly: `api.ts:138` (`thumbnailUrl: z.string().optional()`), `browser.ts:249` (`og:image`), `ytdlp.ts:394` (`info.thumbnail`), `probe.ts:101` (the "attacker-influenced" comment, verbatim), `job.ts:111` (`export interface Job {`), `job.ts:117` (the `variant` comment, verbatim), `ssrf.ts:282` (`urlsInProbeResult`'s signature), `orchestrator.ts:210`/`:230`, `api.ts:278`/`:285` (`ROUTES`, verbatim "opaque and unguessable" comment), `job-store.ts:20` (`JOBS_STORAGE_KEY`, verbatim comment), `ssrf.test.ts:152`. I also independently verified the `JobCard.tsx`/`ProbePanel.tsx` class-name citations (`job__head`, `job__titles`, `card__head`), the `context.rateLimits` shape, `dl-23`'s open status, and that `grep -rn "Content-Security-Policy" tools/downloader` is genuinely empty on `origin/main`. Every one of these checks out. This is an unusually well-researched brief.

### Findings

- **med** · Build step 5's trap says "Adding an optional or nullable field is backward-compatible — an old persisted job parses fine," and recommends mirroring `variant: MediaVariant | null` / `variant: mediaVariantSchema.nullable()` for `thumbnailUrl`, "same sentence, same reason." I verified against the repo's pinned zod (`4.4.3`): `z.object({ b: z.string().nullable() }).safeParse({})` **fails** (`"expected string, received undefined"`); only `.nullable().optional()` accepts a genuinely absent key. Since `thumbnailUrl` is a brand-new field, _every currently-persisted_ `downloader:jobs:v1` record lacks the key today — if a builder copies the `variant` precedent literally (as recommended), `jobSchema.safeParse` fails on every existing job, and `loadJobs` silently drops any job that fails to parse, wiping every user's job list on first load after deploy. Done-when #4 explicitly requires a test that "parses a v1-shaped record lacking it," which will catch this if written — so this is a defect in the brief's stated reasoning, not a shipped bug, but the specific claim used to justify skipping the schema-version bump is the one part of the trap that's wrong.
- **med** · Build step 1 says to widen `urlsInProbeResult` to _include_ `thumbnailUrl` in its returned array ("so one place stays authoritative," so both call sites "get it for free") — then immediately says doing exactly that ("adding it naively to the existing array") is wrong, because both call sites feed the array straight into one `assertAllAllowed(...)` call that throws on any member, and a blocked thumbnail must not fail the whole probe. Done-when #6 (test `urlsInProbeResult`'s return value directly) and Done-when #7 (blocked thumbnail must not fail the probe) together pin the required _behavior_, but the brief never says which mechanism reconciles "one authoritative list" with "one member handled non-fatally" — two materially different implementations both satisfy the prose (e.g., split the function's return shape, or keep the sweep as-is and add a second, separately try/caught check just for the thumbnail). Correctly flagged as the highest-risk trap; not resolved.
- **med** · Done-when #9 requires a "clean 404-shaped error" for an unknown thumbnail token but names no `AppError` code, and Build step 2's "no new error code is needed; do not add one to `DOWNLOADER_ERROR_CODES`" reads (in context) as scoped to the eager-fetch failures but could easily be read as covering the whole feature. I checked the taxonomy: the only existing token-miss precedent, `files.ts`'s `GET /api/files/:token`, reuses `JOB_NOT_FOUND`; core's `NOT_FOUND` is explicitly documented as "about the transport... never about a document" (route miss, not resource miss), and the thumbnail route _does_ match. A thumbnail token names neither a job nor a route — it's a resource in the new in-memory store this ticket introduces — so reusing `JOB_NOT_FOUND` for it repeats the exact anti-pattern the root `CLAUDE.md` documents already having happened once (reach for the nearest domain code, reword the copy at the call site). The ticket doesn't decide this.
- **low** · Build step 4 says to swap `thumbnailUrl` for the proxied path "on the way out, next to where `withoutEgressProxy` already rewrites the probe." `withoutEgressProxy` runs at `probe.ts:94`, before the SSRF sweep (`:101`) step 1 requires and before step 2's fetch (which must run "after the sweep"). Read literally by line number this is impossible (the token doesn't exist yet); read as "same technique, near the response" it resolves. Worth a one-line clarification.
- **low** · The Build section never addresses the probe-cache read path (`probe.ts:50-55`, `if (refresh !== true) { const cached = ...; if (cached !== null) return early }`), which returns before the sweep and before step 2's fetch would run. Whether a cache hit carries a valid proxied `thumbnailUrl` depends on doing the fetch/mint/swap before `context.probeCache.set(...)` — plausible, but then the new thumbnail store's TTL needs to be ≥ the probe cache's 60 s ceiling (`PROBE_CACHE_TTL_CEILING_MS`) for a repeat view inside that window not to reference an evicted token. Not addressed either way. Low stakes since the UI must already hide broken images (step 6), so the failure mode is a silently missing preview, not an error.
- **low** · Done-when #5, #7, #8 name no test file, unlike #1–4, #6, #10. The natural home for the route-level ones is `api/test/routes.test.ts` (the existing `describe("POST /api/probe", ...)` block with `StubResolver`/`probeResult()` fixtures), but the ticket doesn't say so — a small reduction in precision relative to the rest of the brief.
- **low** · Done-when #9's second clause ("there is no route shape anywhere that accepts a caller-supplied URL to fetch") isn't provable by a single unit test the way the other nine lines are — it's a repo-wide property checked by reading the diff, the way this review's own invariant walk does. Framing it as "proven by..." alongside nine genuinely test-provable lines risks a future reviewer marking it `unproven` for the wrong reason.

- **dropped** — none.
- **findings** · own defect hunt (full read of the ticket, independent verification of all 13 cited `file:line`/quote anchors against `origin/main`, a walk of the repo invariants list, and re-running `npm run check`, `npm run status -- --json`, `npx oxfmt --check`, and the PR-title check) returned 7; 7 carried, 0 dropped.

### NFRs

- security — not applicable to this diff (docs-only); the _design_ described is security-conscious (proxy not `<img src>`, capability token, redirect-rechecked `guardedFetch`, byte cap read while streaming rather than trusting `Content-Length`, `Content-Type` allowlist + `nosniff`) but has the two security-adjacent gaps above (findings 2, 3).
- performance — not applicable (docs-only).
- reliability — not applicable to this diff directly; finding 1 is a reliability/data-loss risk for the _future_ implementation if built on the brief's literal wording without writing Done-when #4's test first.
- maintainability — strong: every citation checked resolves exactly, several down to a verbatim quoted comment. The gaps above are the main maintainability risk (a builder could resolve the two open tensions differently than intended).

### Gate: CONCERNS — 2026-08-30 · `origin/main...HEAD` (`d74a9fc1765f180752cf6186500008ad16f5199e`) · own defect hunt, no `code-review` dispatch (subagent has no `Skill` tool)

Three `med` findings, no `high`. Under the strict reading of the rubric (all ten `Done when` lines literally `unproven` because nothing is implemented), the verdict would mechanically be `FAIL`; I did not apply that reading for the reasons given above, and flag it explicitly as the alternative someone reviewing this gate might prefer.

## Log

- **2026-08-30** — Filed from a user request: a preview picture when choosing a
  quality, and the same picture in the downloads section.

  Three decisions were put to the user before filing, with the costs measured
  rather than guessed, and all three came back the way the brief now records
  them: proxy the bytes through the API (over a direct `<img src>`, or inlining
  a `data:` URI at probe time); one preview per video (over an ffmpeg frame grab
  per rendition); and a `Job` contract change (over a parallel `localStorage`
  map keyed by `sourceUrl`). The contract change is therefore **approved**, which
  matters because `CLAUDE.md` forbids editing a contract unilaterally — a builder
  picking this up does not need to re-ask.

  What was measured at filing time, on `origin/main` at `1d420b7`:

  - `grep -rn "thumbnailUrl" tools/downloader/web/src` → no matches. The field
    reaches the client and the UI never reads it.
  - `urlsInProbeResult` ([`ssrf.ts:282`](../../api/src/ssrf.ts)) sweeps
    `variant.url`, `variant.audioUrl` and subtitle URLs only. The thumbnail is
    unvetted today, which is safe only for as long as nothing fetches it.
  - `Job` ([`job.ts:111`](../../contract/src/job.ts)) has no thumbnail field and
    no `requestContext`. The second half is what rules out fetching the image
    lazily per job — the credentials needed to fetch it are not on the record.
  - The job list persists through `jobSchema`
    ([`job-store.ts`](../../web/src/lib/job-store.ts)), so an off-contract field
    would be stripped on reload. That is what makes the client-side-map
    alternative worse than it first looks, and it is why option (a) was
    recommended.
  - No `Content-Security-Policy` exists anywhere in the tool. Called out as a
    trap rather than folded in, since this branch adds the first image the app
    loads and the two changes would mask each other.

  **Not measured, and not inferred.** No live probe was run, so the claim that
  some thumbnails require the same `Referer`/`Cookie` as the manifest is an
  argument from how the rest of this codebase treats `requestContext`
  (`media.ts`: _"CDNs routinely reject a manifest URL that is missing the
  `Referer` the player sent"_), not an observation of a thumbnail 403. It is a
  reason the proxy is the safer shape, not a reproduction. The LAN-CSRF gadget in
  the Why is likewise reasoned from `og:image` being page-controlled — it was not
  demonstrated against a running browser. Neither premise is load-bearing for the
  decision, which the user has taken either way.
