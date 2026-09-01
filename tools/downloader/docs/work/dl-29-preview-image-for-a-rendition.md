---
id: dl-29
tool: downloader
title: Show a preview image when choosing a rendition, and in the downloads list
kind: work-package
status: done
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

   **Trap, and the decision it forces.** The sweep is `assertAllAllowed`, which
   _throws_ on any member. A thumbnail on a blocked address must not fail the
   whole probe — the video is still downloadable — so the thumbnail cannot
   simply join the array those two call sites hand in. Gate 1 caught this brief
   asking for both at once ("one authoritative list" and "one member handled
   non-fatally") while naming no mechanism that delivers them together. Two do.
   **Pick one and record it in the Log:**

   - **Recommended — one function, two lists.** `urlsInProbeResult` returns
     `{ mustPass: string[]; bestEffort: string[] }`, the thumbnail being the
     only member of the second. Both call sites keep passing `mustPass` to
     `assertAllAllowed` exactly as they do today, so their throwing behaviour is
     untouched; `probe.ts` additionally vets `bestEffort` inside its own
     `try`/`catch` and drops the thumbnail on refusal. One file still answers
     "what does a probe cause us to fetch", which is the property worth keeping.
   - **A second, separately caught check.** Leave `urlsInProbeResult` exactly as
     it is and vet the thumbnail on its own line in `probe.ts`. Cheaper, and it
     splits the answer to that question across two places. **If you take this,
     rewrite Done-when 6** — it demands the thumbnail be in that function's
     return value, and this option provably cannot deliver that.

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
     preview. Nothing here throws an `AppError` into the probe path. **This
     sentence is about the fetch failures only** — it is not a rule for the
     whole feature, and the route in step 3 does add a code. Gate 1 found the
     earlier wording ambiguous enough to be read either way.

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

   **An unknown or expired token raises a new downloader code — decided, not
   open.** Add `THUMBNAIL_NOT_FOUND` to `DOWNLOADER_ERROR_CODES`
   ([`errors.ts:27`](../../contract/src/errors.ts)), a message to
   `DEFAULT_ERROR_MESSAGES` (`errors.ts:66`), and `THUMBNAIL_NOT_FOUND: 404` to
   `STATUS_BY_CODE` in [`http-errors.ts`](../../api/src/http-errors.ts). Neither
   of the last two is a step you can forget — both are exhaustive
   `Record<ErrorCode, …>` tables, so omitting either fails `npm run check`.

   The two codes already in reach are both wrong, and gate 1 established why.
   Core's `NOT_FOUND` says of itself that it is _"About the transport, never
   about a document: a missing job is `JOB_NOT_FOUND` and a missing
   anything-else belongs to the tool's own taxonomy"_ — which is this case, and
   an instruction to do exactly what this paragraph says. `JOB_NOT_FOUND` is
   what [`files.ts:74`](../../api/src/routes/files.ts) reaches for on a bad file
   token, and it has to overwrite the copy at both raise sites to make it read
   (`"That download link is not valid."`). The root `CLAUDE.md` names that
   precise move as the tell: _"If the copy has to be replaced where the error is
   raised, the code is the wrong one."_ So `files.ts` is a precedent for the
   anti-pattern, not for the code — do not follow it here.

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

   **Trap: `.nullable()` alone is not enough, and copying `variant`'s schema is
   how you get it wrong.** [`job-store.ts:20`](../../web/src/lib/job-store.ts) is
   `"downloader:jobs:v1"`, documented as _"Versioned so a contract change can
   invalidate old entries instead of crashing on them"_ — so the question is
   whether this needs a bump. It does not, but only if the field is spelled
   correctly. Measured on the repo's pinned zod (4.4.3):

   ```
   z.object({ b: z.string().nullable() }).safeParse({})            -> false
   z.object({ b: z.string().nullable().optional() }).safeParse({}) -> true
   ```

   `variant` gets away with a bare `.nullable()` because every persisted job
   already carries the key. `thumbnailUrl` is **new**, so every record written
   under `downloader:jobs:v1` today lacks it — and `loadJobs` keeps only what
   parses ([`job-store.ts:50-54`](../../web/src/lib/job-store.ts):
   `if (parsedJob.success) jobs.push(...)`, with no `else`). A bare `.nullable()`
   would therefore fail every existing record and **silently empty every user's
   job list on their first load after deploy** — no error, no bump, just an empty
   downloads section.

   So write it `.nullable().optional()` in `jobSchema` and
   `thumbnailUrl?: string | null | undefined` on the interface (the repo builds
   with `exactOptionalPropertyTypes`; see the note at
   [`job.ts:137`](../../contract/src/job.ts)). Then no version bump is needed,
   which is the outcome to want — bumping discards the list for a decorative
   image. Prove it with Done-when 4's second half rather than by reading this
   paragraph.

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
  `{ probe: RateLimiter; jobs: RateLimiter; files: RateLimiter }` since dl-23
  ([`context.ts`](../../api/src/context.ts)); the first two are keyed per IP and
  `files` is keyed on the file token. The thumbnail route serves bytes from
  memory by an unguessable token and costs nothing to answer, so it likely needs
  no bucket of its own — but say so deliberately in the Log rather than leaving
  it unconsidered. If you conclude otherwise, dl-23 left the seam ready:
  `createRateLimitHook` takes an optional `key`, and `fileBucketKey` in
  `routes/files.ts` is the worked example of keying on a capability rather than
  an address.
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
6. `urlsInProbeResult` accounts for the thumbnail URL — in `bestEffort` under
   Build 1's recommended option — proven by a unit test in
   `api/test/ssrf.test.ts` (which already covers this function at `:152`). If
   Build 1's second option was taken, this line must be rewritten first; it
   cannot be satisfied as written.
7. A thumbnail on a blocked address does not fail the probe: the probe returns
   its variants normally, with no preview. Proven by an API test with a guard
   stubbed to refuse that host — this is the trap in Build 1 and the one most
   likely to be got wrong.
8. An oversized response and a non-image `Content-Type` are both discarded, and
   the probe still succeeds. Proven by tests against a fixture server, not live
   network.
9. `GET /api/thumbnail/<unknown-token>` answers `THUMBNAIL_NOT_FOUND` as a 404,
   not a 500 and not `JOB_NOT_FOUND`, proven by a route test.
10. No route shape anywhere accepts a caller-supplied URL to fetch. This one is
    **not** a unit test — it is a property of the diff, checked by reading it,
    and a reviewer should treat it as such rather than marking it unproven for
    want of a test file. Gate 1 raised the mismatch.
11. `npm run check` and `npm test -- --project downloader` pass.

## The gate on this filing

**This is a gate on the pull request that _filed_ this ticket, and it sat under `## Review` until 2026-08-30.** Its text, findings, verdict and inner headings are unedited; only this section's own title changed, and this paragraph was added. `docs/01-TICKETS.md` gives `## Review` one job — recording whether _the work_ was checked, and by whom — and the gate below checked a brief, at a point where no implementation existed to check. Moved by the `repo-12` branch, whose new board check reads a `## Review` on a `ready` ticket as work that merged without its status being flipped, and was reporting this ticket as exactly that. **This ticket's authoring session had ended by then, so the edit went unopposed rather than approved.**

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

- **2026-08-30** — Gate 1's three `med` findings addressed in the brief. No code
  exists yet; these are all changes to what the brief tells a builder to do.

  **F1 — the one that mattered.** Build 5 pointed at `variant`'s
  `mediaVariantSchema.nullable()` as the precedent and said "same sentence, same
  reason". Verified against the repo's pinned zod before changing anything:

  ```
  zod 4.4.3
  z.object({ b: z.string().nullable() }).safeParse({})            -> false
  z.object({ b: z.string().nullable().optional() }).safeParse({}) -> true
  z.object({ b: z.string().nullable() }).safeParse({b: null})     -> true
  ```

  `variant` survives on `.nullable()` only because every persisted job already
  has that key; a **new** field does not. Confirmed the consequence rather than
  assuming it: `loadJobs` keeps only records that parse
  (`job-store.ts:50-54`, `if (parsedJob.success) jobs.push(...)`, no `else`), so
  the brief as filed would have emptied every user's downloads list on their
  first load after deploy — silently, since nothing throws. The trap now states
  `.nullable().optional()` and says why `variant` is not the precedent it looks
  like. **My error, not the reviewer's find of someone else's.**

  **F2.** Build 1 asked for "one authoritative list" and "one member handled
  non-fatally" and named no mechanism reaching both. It now offers the two that
  do — `urlsInProbeResult` returning `{ mustPass, bestEffort }` (recommended), or
  a separate caught check — and says which Done-when line the second option
  forces a rewrite of. Left as a builder decision on purpose, per the repo's rule
  about surfacing rather than resolving; what was wrong was leaving it _unnamed_.

  **F3 — decided by the user, not folded in quietly.** An unknown or expired
  thumbnail token raises a **new** `THUMBNAIL_NOT_FOUND` (404). Both codes in
  reach were measured and rejected: core's `NOT_FOUND` documents itself as
  transport-only and says "a missing anything-else belongs to the tool's own
  taxonomy"; `JOB_NOT_FOUND` is what `files.ts:74` uses for a bad file token, and
  it overwrites the copy at **both** raise sites to make it read — which the root
  `CLAUDE.md` names as the tell that the code is wrong. So `files.ts` is a
  precedent for the anti-pattern, not for the code. Build 2's "no new error code
  is needed" is now explicitly scoped to the fetch failures, which is the
  ambiguity gate 1 caught.

  **Two of the four `low` findings were folded in** because this pass made them
  free: Done-when 9 was split, so the un-unit-testable "no route accepts a
  caller-supplied URL" clause is now its own line (10) and labelled as a
  read-the-diff property rather than a missing test; and Done-when 6 now says
  which of Build 1's options it is written against. **The other two are
  deliberately not done** — Build 4's `withoutEgressProxy` line-ordering
  imprecision, and the probe-cache read path and its TTL relationship to
  `PROBE_CACHE_TTL_CEILING_MS`. Both are real and both are design detail a
  builder will meet with the code in front of them, which is a better place to
  settle them than a brief.

  One thing corrected while writing this: the first draft of the F3 paragraph
  named a `DOWNLOADER_ERROR_MESSAGES` constant, which does not exist. It is
  `DEFAULT_ERROR_MESSAGES` at `errors.ts:66`, and like `STATUS_BY_CODE` it is an
  exhaustive `Record<ErrorCode, …>` — so both fail `npm run check` if a new code
  is added without them, which is worth a builder knowing.

- **2026-09-01** — Built, on `origin/main` at `6f29eb0`. The two decisions gate 1
  left open are settled below, with the reasoning, so neither comes back a third
  time.

  **Decision 1 — `urlsInProbeResult` returns `{ mustPass, bestEffort }`**, the
  brief's recommended option. What settled it was not taste but a count the brief
  did not make: **two** call sites need the best-effort URL, not one. Build 2 puts
  the fetch in `probe.ts`, and Build 5 puts a second one in the orchestrator,
  which re-probes unconditionally and mints the job's own token. The alternative —
  "vet the thumbnail on its own line in `probe.ts`" — would therefore have been
  that line written twice, in two files, with the answer to "what does a probe
  cause us to fetch" split three ways instead of two. One inventory, two lists,
  and `captureThumbnail` reads `bestEffort` off it rather than off
  `probe.thumbnailUrl` directly, so `ssrf.ts` stays the single place that knows.

  Done-when 6 therefore stands as written and did not need rewriting.

  **Decision 2 — a new `thumbnailPath`, not a re-use of `thumbnailUrl`.** This is
  the one that went against the brief's recommendation, and the prompt's framing
  is what decided it: adding a field is normal contract work; changing what an
  existing one means is not something to do unilaterally. Folding the proxied path
  into `thumbnailUrl` would have left one name denoting an origin URL inside the
  server and one of our own paths outside it, with nothing in the type saying
  which side of the boundary a value came from — and `probeResultSchema` types it
  `z.string()`, so nothing would ever catch a confusion.

  The brief's objection to two fields ("a second field the UI must choose
  between") does not survive the shape actually built: the API **strips**
  `thumbnailUrl` on the way out, exactly as `withoutEgressProxy` strips
  `requestContext.proxyUrl`, so exactly one of the two is ever populated on the
  wire and the UI has nothing to choose between. `grep -rn thumbnailUrl
tools/downloader/web` returns nothing.

  For the same reason the `Job` field is spelled `thumbnailPath` rather than the
  brief's `thumbnailUrl`. The brief itself supplied the argument: it asked for a
  comment saying the field holds "our proxied path, not the origin URL, since the
  name alone will not say it". A name that has to be corrected by its own comment
  is the wrong name.

  **What the brief had wrong, or did not know.**

  - **The origin URL had a second door, and Done-when 5 only guards the first.**
    `events.probed(jobId, probe)` in the orchestrator ships a whole `ProbeResult`
    to the client over SSE. Rewriting only `POST /api/probe`'s body — which is all
    Done-when 5 asks for — would have left the origin URL reaching the browser by
    the other route. `withThumbnailPath` is applied at both, and the orchestrator's
    call sits next to the `withoutEgressProxy` note explaining the identical
    problem for the proxy port.
  - **`Job.thumbnailPath` needed a database migration, which Build 5 does not
    mention.** `Job` is persisted in SQLite as well as in `localStorage`; the brief
    reasons carefully about the second and not at all about the first. Migration 3
    adds a nullable `thumbnail_path` column. `#write` needs `?? null` as well as
    the `undefined` check — better-sqlite3 refuses to bind an `undefined`, and a
    row written before this branch reads back with the property absent.
  - **A third exhaustive `Record<ErrorCode, …>`.** The brief names
    `DEFAULT_ERROR_MESSAGES` and `STATUS_BY_CODE`. There is also
    `ERROR_PRESENTATION` in `web/src/lib/error-presentation.ts`, and a runtime
    exhaustiveness test — "every ErrorCode is demonstrable" in
    `web/test/mock-api.test.ts` — which `npm run check` cannot catch because it is
    an assertion rather than a type. `THUMBNAIL_NOT_FOUND` joins `NOT_FOUND` in
    that test's not-reachable-in-the-mock list, with the reason written down.
  - **The component tests do not run against `scenarios.ts`.** Done-when 1–3 say
    they do. `web/test/fixtures.ts` says the opposite in its own docblock —
    "Nothing here comes from `src/api/mock.ts`… a component test fed only mock data
    proves the mock renders" — and dl-15 is why. So the panel and card assertions
    use `fixtures.ts` builders, and the scenario table's own claim (a base probe
    with a preview, a `nopreview` scenario without) is asserted in
    `mock-api.test.ts`, which is the file that owns the mock.
  - **`guardedFetch` was not reachable from a route.** Build 2 says "use the
    injected `guardedFetch`", but it was a local in `createApp` handed to the
    engine and the resolvers, and nothing put it on `AppContext`. It is on the
    context now, with a note that anything fetching on a client's behalf must use
    it rather than `globalThis.fetch`.

  **Two `low` findings gate 1 left to "a builder with the code in front of them"
  are now settled in code rather than in prose.** The probe-cache read path
  returns before the fetch would run, so the token is minted _before_
  `probeCache.set` and the rewritten probe is what gets cached — a cache hit hands
  back the first answer's token rather than paying for a second fetch. That makes
  `THUMBNAIL_TTL_MS > PROBE_CACHE_TTL_CEILING_MS` load-bearing rather than
  arbitrary, and `thumbnails.test.ts` reads the ceiling out of `config.ts` rather
  than restating it, so the two cannot drift. Build 4's `withoutEgressProxy`
  line-ordering imprecision resolved as gate 1 predicted: same technique, near the
  response, after the fetch.

  **The rate limiter, considered deliberately as the Traps section asks.** No
  bucket. The other three limited routes each protect something expensive — a
  ~15 s browser probe, a worker slot, gigabytes off a disk. This answers from a
  `Map`, from at most 512 KB already resident, to a caller who had to hold an
  unguessable 256-bit token; a caller without one gets a 404 cheaper than the
  not-found handler's. The reasoning and the way back in (dl-23's optional `key`,
  `fileBucketKey` as the worked example) are written into `routes/thumbnail.ts`
  rather than left here, so whoever reconsiders it reads it where the decision
  lives.

  **CSP was not added**, as the Traps section instructs. This branch adds the
  first image the app loads and the two changes would mask each other. Worth
  filing.

  **What was measured, including where a test lied.**

  - The `.nullable()` trap is real and worse than the brief says. Mutating
    `jobSchema` to a bare `.nullable()` and re-running `job-store.test.ts` fails
    **five** tests, not one: `loadJobs` returns `[]` for every record, because
    every fixture in that file predates the field. Restored, 10 pass.
  - `captureThumbnail`'s own `assertAllowed` was mutated away: the blocked-address
    test goes red. It uses a plain spy `fetch` rather than `createGuardedFetch`
    precisely so that it can — with a guarded fetch, hop 0 would refuse anyway and
    the test would have passed with the check deleted.
  - **The redirect test's first draft passed for the wrong reason and was
    rewritten.** It pointed at `169.254.169.254`, and it stayed green with a plain
    unguarded `fetch` substituted — because link-local is simply unreachable from
    this container, so the fetch failed on its own and the assertion measured the
    sandbox. It now redirects to a _reachable_ loopback fixture that serves a
    perfectly good image, under a guard that exempts the literal `127.0.0.1` and
    not the name `localhost`. Swapping `createGuardedFetch` for `globalThis.fetch`
    now turns it red, which is the property the test is for.
  - The oversize test was likewise rewritten. A body sent with a _short_
    `Content-Length` does not reach `readBounded` at all — undici truncates at the
    declared length — so the original assertion proved nothing about the cap. The
    cap is now exercised by a chunked response with no `Content-Length`, which is
    the case a header-based cap cannot bound, and the truncation case is asserted
    separately so the two cannot be confused.

  **Not measured, and not inferred.** No live probe and no browser: the LAN-CSRF
  gadget in the Why is still reasoned, not demonstrated, and no real `og:image`
  was fetched from a real site. The e2e suite was not run (it needs Playwright
  browsers) and no container was built, so nothing here says the preview renders
  in a real browser — only that the component emits the `<img>` and the route
  serves the bytes. `tools/downloader/api/test/tls-interception.test.ts` failed
  once in three full `npm test` runs with an ASN.1 "illegal padding" error from
  `new X509Certificate(...)`; it passed in isolation, passed on the next full run,
  and 520 leaf generations under two probing scripts did not reproduce it. My
  hypothesis — `newSerial()` prefixing `00` onto sixteen random bytes whose first
  is itself `0x00` — was tested directly against forge and **disproved**. So it is
  an unexplained pre-existing flake in a file this branch does not touch, recorded
  rather than diagnosed.
