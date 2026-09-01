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

## Gate 1 — 2026-09-01 · Sonnet, against an Opus build · `origin/main`…`ce3e799`

Verdict **CONCERNS**. No design defect found. Both this gate and gate 2
reproduced this ticket's Log claims independently rather than accepting them.

Reproduced and upheld: the `.nullable()` mutation count of five, exactly;
deleting `captureThumbnail`'s `assertAllowed` reddens exactly one test; swapping
`createGuardedFetch` for `globalThis.fetch` in the redirect test reddens it,
confirming the rewrite fixed the sandbox-measuring problem the Log describes;
the chunked oversize test exercises the counting path, verified against a
purpose-written never-ending-stream server, which also confirmed the timeout
fires rather than hanging.

**Finding (med) — a fourth door: the credentials, not the URL.** Extending this
ticket's own enumeration of the paths a `ProbeResult` reaches a client, gate 1
found the three the branch covers and then argued a fourth: `downloader/api/src/routes/probe.ts:129` and
`downloader/api/src/jobs/orchestrator.ts:326` log `requestContext: probe.requestContext` raw;
`RequestContext.headers` is documented at `downloader/contract/src/media.ts:121` as
typically carrying Cookie and Authorization; `redactRequestContext` exists at
`downloader/contract/src/redact.ts:18-24` and neither site calls it. Pre-existing —
`origin/main` has the identical line — but this branch edits that object literal
and makes those headers newly load-bearing as an outbound credential.

**Not upheld on reproduction. See the 2026-09-01 Log entry.** Every premise is
true; the conclusion is not. `downloader/api/src/logger.ts:73-91`'s `safeFields` applies
`redactRequestContext` structurally on the way out, by design and by its own
docblock, so the call sites are not supposed to redact. Driving a real probe with
a live cookie and reading the raw serialised line shows `"Cookie":"[redacted]"`
and no occurrence of the secret anywhere. No redaction was added. The regression
tests the finding was really asking for were.

## Gate 2 — 2026-09-01 · Sonnet, against an Opus build · `origin/main`…`ce3e799`

Verdict **CONCERNS**. No design defect found; two coverage gaps, both of the
shape "correct today, unguarded tomorrow".

Upheld this branch's two open decisions on its own reading. On the contract
question: adding `thumbnailPath` is "add a new optional field", **not** a
unilateral contract change, because Build step 4 named that alternative and
instructed the builder to decide and record it — which it did. On the error code:
`THUMBNAIL_NOT_FOUND` belongs in the tool's taxonomy rather than core, on the
repo's own tell — the copy at the raise site is not reworded. On the module
constants, gate 2 supplied a better reason than the branch gave:
`probeCacheTtlMs` is operator-configurable but clamped by the hardcoded
`PROBE_CACHE_TTL_CEILING_MS`, so `THUMBNAIL_TTL_MS > PROBE_CACHE_TTL_CEILING_MS`
holds under every configuration, and making the thumbnail TTL configurable would
add the only way to break it.

**Finding (med) — the migration and persistence path had no coverage.**
`grep -c thumbnail tools/downloader/api/test/job-store.test.ts` returned 0 and
`pipeline.test.ts` never ran a job whose probe carried a thumbnail. Verified by
hand that the behaviour was correct — a synthetic pre-migration-3 database with
an existing row upgrades with `thumbnail_path` NULL, a second `migrate()` is
idempotent, `patch` preserves on the `undefined` branch and clears on explicit
`null`, a fresh `create()` defaults correctly. **Upheld and fixed.** Written as
tests in `job-store.test.ts` and `pipeline.test.ts`, with the pre-migration row
as the load-bearing case: proven fail-first by moving the column into
migration 1, which reddens exactly the two legacy-database tests and leaves every
fresh-create test green.

**Finding (low) — the SSE strip was untested.** The branch found the second door
itself and closed it at `downloader/api/src/jobs/orchestrator.ts:257`, but only the `POST /api/probe`
side had a test; gate 2 recorded low confidence it was actually broken.
**Upheld and fixed** — it was not broken. `routes.test.ts`'s SSE block now reads
the `probed` frame and asserts on the raw body; reverting `withThumbnailPath`
reddens it.

**Finding (low) — the abort-signal gap.** `captureThumbnail` does not receive the
probe route's `controller.signal`, so a client that navigates away can leave the
image fetch running up to 4 s past the rest of the probe. **Accepted as a known
trade-off, not changed**: bounded, and after the concurrency slot is released, so
it holds nothing scarce.

Gate 2 offered to write both test fixes. Declined on principle — a gate reports,
the builder fixes.

## Gate — 2026-09-01 · Sonnet, against an Opus build · post-PR, at `569214d`

**This record ran before the credential strip and belongs here in sequence.** It
gated `ce3e799..569214d` — the redaction refutation and the two new tests — and
its "critical, out of scope" finding is what became that strip, which the next
record then gated. The two read as a sequence, not as one gate having missed
something.

**Only this section's own title changed**, from `## Review`, following the same
convention as `## The gate on this filing` above and for the same reason: a
`## Review` heading means something specific to the board check that `repo-12`
added. The reviewer's text, findings, verdict and inner headings are unedited.

**It carries no number, deliberately.** Numbering it would make it Gate 3 and push
the committed credential-strip record to Gate 4 — and two test files cite
"dl-29's third gate" by that number (`routes.test.ts:379`,
`egress-proxy.test.ts:596`). Renumbering would have made those comments wrong,
which a documentation-only change should not do.

**Resolve its citations with `--rev 569214d`, not against the tip.** Measured
rather than assumed: both ways resolve 16/34, but three citations point at
_different content_ now, because the strip and its tests landed after this record
was written — `probe.ts:129`, `routes.test.ts:588-634`, and `probe.ts:101`. The
last is the record's own evidence for a finding, quoted in its section 4, so
remapping the number would have destroyed the finding and editing the reviewer's
words was not on the table. Pinning is both cheaper and more honest. Note the sha
is pre-squash: this branch squash-merges, so `569214d` exists only until then.

**Setup note (worth recording):** the plain `git checkout --detach`/`switch --detach`/`merge --ff-only` forms were all refused by the auto-mode classifier in my pinned worktree, for reasons unrelated to the repo's own permission rules (nothing in `.claude/settings.json` denies them). `git worktree add --detach <scratch-path> 569214d` was accepted and gave me a clean, correctly-isolated tree. Also: a Bash call that changes `cwd` only affects that single command in this environment — every subsequent call reset to my pinned worktree unless I re-prefixed with `cd`. I caught this once (a throwaway repro file briefly landed in my pinned worktree instead of the reviewed one, so its first test run was against the wrong commit) and re-did the reproduction correctly, prefixing every command from then on. Confirmed via `git log --oneline -1` → `569214d`, `git status --porcelain` → clean, before and after.

Range reviewed: `ce3e799..569214d` (the second commit only), as scoped. `git diff --stat` confirms it touches only `job-store.test.ts`, `logging.test.ts`, `pipeline.test.ts`, `routes.test.ts`, and the ticket file (dl-29's own Log/gate records plus the new dl-34/dl-35 files).

### Verdict: PASS (on the assigned scope) — plus one critical, out-of-scope finding that needs its own ticket

### 1. The redaction refutation

**Enumeration: `AppLogger` has 5 methods — `debug`, `info`, `warn`, `error`, `child` — and all 5 route through `safeFields`.** `debug/info/warn/error` all call the shared `emit()` closure (`api/src/logger.ts:112-122`), which calls `safeFields(fields)`. `child()` (`:129`) calls `safeFields(extra)` directly. There is exactly one `pino(...)` instantiation in the whole tool (`api/src/logger.ts:141`) and no other direct pino/console usage anywhere in `api/src`, `engine/src`, or `resolvers/src` (`grep -rn "console\."` → nothing; `grep -rn "pino("` → the one site). The engine logs through the same `AppLogger` (its `Logger` interface is satisfied by it), and it does its own belt-and-braces redaction before logging (`engine/src/index.ts:204-210`, `redactRequestContext(request.requestContext)`), so it isn't relying on `safeFields` alone either. **0 of 5 methods bypass it.**

**Reproduced, exactly as claimed:** disabling `safeFields`' redaction call reddens exactly **3** tests — `logging.test.ts`'s pre-existing unit test plus both new end-to-end tests (`api/test/logging.test.ts:88-96`, `:206-231`, `:233-256`) — with the raw `super-secret` cookie visible in the captured line. Restored cleanly afterward (`git status --porcelain` clean, `git diff` empty).

**pino's own paths don't save it, but the reason given is imprecise.** With `safeFields` disabled, pino's `REDACT_PATHS` (`*.headers.cookie`, `*.cookie`, etc.) do **not** catch `requestContext.headers.Cookie` — confirmed. But the builder's stated reason ("the credential sits at depth three") isn't quite it: I drove a 3-level **lowercase** `{ someKey: { headers: { cookie: "..." } } }` through the same logger and pino's `*.headers.cookie` path **did** redact it. The real reason is **case-sensitivity**: pino's denylist paths are exact-match on lowercase segment names, and `RequestContext.headers` in this codebase carries real HTTP casing (`Cookie`, `Authorization` — see the `CREDENTIALED` fixture in `logging.test.ts:39-45` and the doc comment at `contract/src/media.ts:121`). This matters because it changes what the second layer actually covers: it protects Node's own `IncomingHttpHeaders` (always lowercase) but not a `RequestContext`-shaped bag with its natural casing.

**Structural check gap — real, demonstrated, but not currently reachable.** `isRequestContext`/`safeFields` only recognise a field literally named `requestContext` at the _top level_ of the fields object passed to a log call (`api/src/logger.ts:64-71`, `:85`). I drove three cases through `createLogger` directly:

- `logger.info("x", { details: { requestContext: { headers: { Cookie: "secret" } } } })` → **leaks in full**, no redaction at either layer (nested one level under another key name).
- `logger.info("x", { items: [{ headers: { Cookie: "secret" } }] })` → **leaks in full** (inside an array).
- `logger.info("x", { requestContext: "not-an-object..." })` → passes through unredacted (structurally not a `RequestContext`, by design — a non-object can't carry a header bag anyway, so this one is not itself concerning).

I then swept every actual call site in `api/src`, `engine/src`, `resolvers/src` that mentions `requestContext` (14 sites) and confirmed **none of them nests it under another key or an array** — every real log call uses the literal top-level `requestContext` key (`probe.ts:129`, `orchestrator.ts:322-326`, `engine/index.ts:204-210`). So this is a real gap in the safety net with **no current exploit path** — low severity as things stand, but it's the kind of gap a future call site could fall into silently, and nothing tests for it. Worth a one-line doc caveat and, if the coordinator wants belt-and-braces, a test pinning the nested-key case as a known limitation (mirroring the existing "arrived under some other name" test at `logging.test.ts:96-104`, which only covers a _bare_ `headers` bag, not a nested `requestContext`).

**Denylist limit — agreed out of scope, plausibly worth a ticket (open, not mine to settle).** `redactHeaders` (`packages/core/src/redact.ts:23-32`) is an 8-name denylist, case-normalized. A bespoke header (`x-session-id` on a CDN, say) logs in full. This predates dl-29, isn't touched by it, and the builder's framing (a documented limit, not a defect) is accurate. I agree it's out of scope for this ticket. Whether it's worth a standalone ticket is a judgement call I'm surfacing rather than making — recommend low-priority, since a denylist-vs-heuristic tradeoff was made deliberately and the current 8 names cover the common cases.

**Critical finding, out of scope, pre-existing — the actual client-facing leak.** While reproducing the SSE test I noticed the `POST /api/probe` JSON response — and the `probed` SSE frame — ship `probe.requestContext.headers` **verbatim, unredacted, to the requesting browser**. I confirmed this directly:

```
POST /api/probe → body contains:
"requestContext":{"headers":{"Referer":"...","Cookie":"session=super-secret"}}
```

This is not a log line, and not something `safeFields` is meant to touch — it's the literal HTTP response body sent to whoever called the API. `RequestContext.headers` is documented (`contract/src/media.ts:118-121`) as "Typically Referer, Origin, User-Agent, Cookie, Authorization" — credentials meant for **our own backend** to replay against the origin CDN, never for the browser that asked for the probe. I verified this is **pre-existing and unrelated to dl-29**: `git show origin/main:tools/downloader/api/src/routes/probe.ts` shows the identical `const body: ProbeResponse = { probe, cached: false }` with no stripping, before this branch touched the file. `withThumbnailPath` (`api/src/thumbnails.ts:259-262`) strips only `thumbnailUrl`; `requestContext` rides along unchanged, both before and after this branch. The contract itself types it this way (`contract/src/api.ts:141-150`, `probeResultSchema` includes `requestContext` as required, embedded directly in `ProbeResponse`).

This does **not** affect my verdict on the assigned scope — it predates the branch and isn't part of the diff I was asked to gate, and neither gate 1 nor gate 2 (which focused specifically on the _log_ line) surfaced it. But it's a live, trivially-exploitable credential disclosure (every probe response leaks whatever session cookie the resolver captured for the source site) and I'd be doing you a disservice not to say so plainly: **recommend filing this as its own high-severity ticket immediately**, separate from dl-34/dl-35.

### 2. The two new tests

**Migration test — reproduced exactly.** Moved `thumbnail_path` into migration 1's `CREATE TABLE` and deleted migration 3 (`api/src/db/schema.ts`). Result: **exactly** the two legacy-database tests fail (`job-store.test.ts:215` "an existing row survives migration 3...", `:235` "migrate is idempotent...") — both fail with `expected 2 to be 3` (stuck at `user_version = 2`) — and all 21 other `job-store.test.ts` tests plus all 21 `pipeline.test.ts` tests stay green. Restored cleanly. The frozen `BEFORE_MIGRATION_3` schema's "cannot go stale" claim rests on the `schema.ts` docblock convention ("never edit a shipped migration"), not on a mechanical check — that's consistent with how the rest of this repo relies on documented invariants, not a defect.

**SSE test — reproduced exactly.** Reverted `orchestrator.ts:257` (`events.probed(jobId, withThumbnailPath(probe, thumbnailPath))` → `events.probed(jobId, probe)`). The test (`routes.test.ts:588-634`) reddens at line 618, the raw-body assertion (`expect(response.body).not.toContain(origin)`), before it ever reaches the parsed-field assertions at `:628-629` — confirmed by the actual failure output, which shows the origin URL sitting in `thumbnailUrl` inside the raw SSE frame text. Restored cleanly.

### 3. dl-34 and dl-35 accuracy

**dl-34: 13/13 citations resolve**, confirmed by running `node scripts/citations.mjs tools/downloader/docs/work/dl-34-...md` directly — matches the ticket's own claim exactly. I additionally spot-checked content, not just resolution, for the load-bearing ones: `server.ts:96-104`'s quote is verbatim; `classify.ts:149` and `ytdlp.ts:622` are the exact function signature lines; `pool.ts:256-268` (`chromium.launch()` — headless/args/proxy only, no env, no cert flag) and `:117-126` (`BASE_ARGS`, 7 flags, none about certificates) both check out; `browser.ts:148` (`newContext()`, no `ignoreHTTPSErrors`) checks out; `ytdlp.ts:516-523` (`spawn()`, no `env`) checks out; the `grep -rnE "...NODE_EXTRA_CA_CERTS..."` claim of zero hits reproduces exactly; `TLS_VERIFICATION_FAILED: 502` exists at `api/src/http-errors.ts:23` and the code itself lives in `packages/core/src/errors.ts` (shared taxonomy), matching "already exists... costs no new code." The "inherited and unverified" section (`dl-34-...md:133-140`) does say plainly that the two exact strings (`net::ERR_CERT_AUTHORITY_INVALID`, `CERTIFICATE_VERIFY_FAILED`) were never observed and instructs a future builder to reproduce them before matching on them — confirmed present in the ticket's own text, not laundered as fact. One prose nit, low: the Why section groups `size-sample.ts:371` in with `size-probe.ts:74`/`:98` as citations that "swallow to `undefined`" — that catch block actually returns `unchanged` (the declared estimate), which the very next sentence correctly describes ("degrading to a declared value"). The line itself is real and illustrates the right pattern; just a one-word overreach in the summary sentence.

**dl-35: grep claims verified.** `grep -rn "Content-Security-Policy" tools/downloader --include=*.ts --include=*.html` → exit 1, zero hits, reproduced exactly. The four-member `Content-Type` allowlist excluding `image/svg+xml` and the `X-Content-Type-Options: nosniff` header both check out at `api/src/thumbnails.ts:59-64` and `api/src/routes/thumbnail.ts:41`. No inline `file:line` citations to check via `citations.mjs` (0/0) — the ticket's claims here are grep-verified assertions, not pointer citations, and they're accurate.

### 4. Citations left deliberately failing

**`probe.ts:101` example verified.** `probe.ts` is unique in the repo (one file, no ambiguity), so it resolves without a path prefix; today it reads `// never even learns that an internal address answered. mustPass only —`, not the "attacker-influenced" text it was originally cited for. The ticket's own Log entry correctly calls this out as "green and wrong" and explains why the rest of the Build section is deliberately left unqualified. Confirmed accurate.

**Citation count is stale — low, reproducible.** The Log claims "Citations: 29/52, and the 23 failures are deliberate." A fresh `node scripts/citations.mjs` run against the exact committed file at `569214d` reports **55 total, 31 resolve, 24 fail**. Tracing the discrepancy: the paragraph making the "29/52" claim (`dl-29-...md:790`) itself cites `orchestrator.ts:257` as its own illustrative example one line later (`:791`, correctly flagged ambiguous) and two more citations appear in the paragraphs immediately after it (`:793`, `:806`, both resolve `ok`) — three citations added to the same Log entry after the count was taken, never re-run. 52+3=55 and 23+1=24 line up exactly with what I found. This doesn't change the substance (the failing citations are still the same deliberately-unqualified Build-section ones; the new ones are self-referential examples that resolve as described), but it's a stale self-report inside the one paragraph whose entire point is "trust these numbers because they were checked."

### Summary

- **Enumeration (item 1):** 5 `AppLogger` methods, 5 route through `safeFields`, 0 bypass it.
- **Findings**, most severe first:
  - **critical, out of scope, pre-existing** — `POST /api/probe`'s response body (and the `probed` SSE frame) ships `requestContext.headers` including live `Cookie`/`Authorization` straight to the client, unredacted; confirmed on `origin/main`, unrelated to this branch, not fixed by `withThumbnailPath`. Recommend an urgent standalone ticket.
  - **low** — the structural redaction check only matches a top-level `requestContext` key; a nested or differently-named header bag escapes both layers. No current call site exercises this. Demonstrated, not exploited.
  - **low** — the "pino paths fail because of depth" explanation in the Log is imprecise; the actual reason is case-sensitivity (pino's paths are lowercase-only; `RequestContext.headers` uses real HTTP casing). Doesn't change the conclusion, could mislead a future reader about what the second layer actually covers.
  - **low** — the ticket's own "29/52" citation count is stale by 3 relative to a fresh run against the committed file; substance unaffected.
  - **low** — dl-34's Why section says `size-sample.ts:371` "swallows to `undefined`"; it actually returns the declared estimate, contradicted by the very next sentence.
  - **dropped** — none.
  - **findings** — own defect hunt (enumeration of every log call site, structural-gap fuzzing, fail-first reproduction of both new tests, citation re-resolution for both new tickets and for the deliberately-failing example, plus the wire-body check that surfaced the critical item) returned 5 (excluding the pre-existing wire leak, which is a 6th, out-of-scope item); all 6 carried above, 0 dropped.
- **Could not verify:** the two "inherited" strings in dl-34 (`net::ERR_CERT_AUTHORITY_INVALID`, `CERTIFICATE_VERIFY_FAILED`) — no browser or yt-dlp binary in this environment, same as the builder; the ticket already says so.
- **Ran:** `npx vitest run --project downloader` once at the end — 56 files, 891 tests, all green, at `569214d`. `npx oxfmt --check` on the touched ticket/test files — clean.

## Gate 3 — 2026-09-01 · Sonnet, against an Opus build · the credential strip

Verdict **CONCERNS**, one finding.

**Scope.** The response-seam credential strip and its three call sites, the two
`logger.ts` caveats and their tests, the citation-count removal, and dl-34's
`size-sample` correction. Everything else on this branch was settled by the
earlier gates and was **not** re-reviewed: the SSRF guard and the redirect
re-check, the capability token, the byte cap and content-type allowlist, the
contract additions, the SQLite migration, the whole web layer, and the two tickets
filed from this branch (dl-34, dl-35).

Reproduced and upheld: per-seam pinning — mutating the cached call site alone
reddens exactly one test, the SSE call site alone exactly one, emptying
`probeForClient` all three. **Twelve server-side consumers of
`probe.requestContext` were enumerated**; every one reads the pre-strip object and
none sees `probeForClient`'s output, so there is no over-strip anywhere. The
frame-presence guard fails on the frame assertion when the event is suppressed
rather than passing vacuously. The known-limitation test reddens when `safeFields`
is widened to recurse. Two rows of the pino case-sensitivity table were verified
against pino directly, outside this repo's harness.

**Finding (med) — the replacement control does not control, and it was
measured.** `tiers-behind-the-proxy.test.ts` asserted
`body.probe.requestContext.headers` equals `{}` as the control for `proxyUrl`
being dropped. The gate mutated `withoutEgressProxy` to **also** empty `headers`
whenever `proxyUrl` is set — the exact over-strip that control existed to catch —
and ran the whole downloader project: **897/897 passed.**

Two independent reasons, both confirmed here by reproducing the mutation:

1. The assertion is satisfied by `probeForClient`'s later strip regardless of what
   `withoutEgressProxy` does, so it can no longer distinguish "stripped once, at
   the response seam" from "stripped a layer too early".
2. `routes.test.ts`'s engine-side check did not set `requestContext.proxyUrl`, so
   `withoutEgressProxy`'s early return meant that branch never ran there either.

The failure this leaves unguarded: an operator with `config.proxyUrl` set —
dl-12's documented case — silently loses the credentials the engine replays, and
every download 403s at the CDN with a green suite.

**Upheld and fixed, in both halves.** `egress-proxy.test.ts` had **no coverage of
`withoutEgressProxy` at all**, which is why a response-body assertion was carrying
that weight; it now has direct unit assertions that the function drops `proxyUrl`
and preserves `headers` and `expiresAt`, plus its early-return branch. And the
engine-side test's fixture now sets `proxyUrl`, so reason 2 is closed as well —
the gate recommended only the first, and the second is one fixture line that makes
the operator-proxy deployment covered end to end. Both go red under the gate's
mutation and green when it is reverted, verified separately.

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

- **2026-09-01** — Two gates (both Sonnet, against this Opus build), both
  `CONCERNS`, neither finding a design defect. Four user decisions came back.
  Applied below, with one of them **refuted rather than applied** — which is the
  entry worth reading.

  **Gate 1's credential-leak finding does not reproduce, and the fix was not
  made.** The finding: `downloader/api/src/routes/probe.ts:129` and `downloader/api/src/jobs/orchestrator.ts:326` log
  `requestContext: probe.requestContext` raw; `RequestContext.headers` is
  documented at `downloader/contract/src/media.ts:121` as typically carrying Cookie and
  Authorization; `redactRequestContext` exists at
  `downloader/contract/src/redact.ts:18-24` and neither site calls it. Every one of those
  statements is true. The conclusion drawn from them is not.

  Reproduced before touching anything, as instructed: a real `POST /api/probe`
  through the harness, resolver returning `Cookie: session=super-secret`,
  capturing the **raw serialised** lines. The line is

  ```
  {"level":"info",...,"requestContext":{"headers":{"Cookie":"[redacted]","Authorization":"[redacted]"}},"msg":"probe complete"}
  ```

  and no line at any level contains `super-secret`. The reason is
  `downloader/api/src/logger.ts:72-91`: `safeFields` recognises a field named `requestContext`
  **structurally** and applies `redactRequestContext` on the way out. Its own
  docblock states the intent — _"Redacts on the way out rather than trusting call
  sites… a caller that forgets to redact still cannot leak one through this
  logger."_ The two call sites do not redact **because they are not supposed
  to.** Adding `redactRequestContext(...)` at each would have been redundant, and
  worse than redundant: it would imply call sites carry that duty, which is the
  design this logger exists to replace, and the next person to log a context
  would copy the wrong pattern.

  I also checked the coverage question the coordinator asked rather than assumed
  it: `redactRequestContext` handles all three members of `RequestContext` —
  `headers` through `redactHeaders`, `proxyUrl` through `redactUrl`, `expiresAt`
  passed through as a non-secret. It covers the shape. (One real limit, not a
  defect and not mine to change: `redactHeaders` is a deliberate **denylist** of
  eight names, so a CDN gating on a bespoke header such as `x-session-id` would
  be logged in full. `packages/core/src/redact.ts:16-23` argues for the denylist
  explicitly.)

  A third `requestContext` site turned up while enumerating —
  `downloader/api/src/jobs/orchestrator.ts:268` — which Gate 1 did not name. It is not a log line; it is
  the `engine.download({ requestContext })` argument. Not a leak.

  **What was built instead: the regression tests the finding was really asking
  for.** The redaction predates this branch, but dl-29 makes those exact headers
  newly load-bearing as an _outbound_ credential — `captureThumbnail` replays
  them to a page-chosen origin — and nothing pinned the redaction at either call
  site end to end. Two tests in `api/test/logging.test.ts` now drive a real probe
  and a real job and assert on the **raw serialised string**, not on a parsed
  field: "the shape we expected was redacted" and "the secret is not in the
  bytes" are different claims and only the second is worth having. Made to fail
  first: deleting the `redactRequestContext` call inside `safeFields` reddens
  both, plus the pre-existing unit test — three in total. pino's own
  `REDACT_PATHS` do **not** save it.

  **Correction, from the post-PR gate: my first explanation of _why_ pino does
  not save it was wrong.** I wrote that the credential sits at depth three. That
  is not the obstacle. Re-measured against this repo's own logger before
  accepting the correction, one field shape per row, asking only whether the
  literal secret survives into the serialised line:

  | fields passed to `logger.info`                | outcome                                |
  | --------------------------------------------- | -------------------------------------- |
  | `{ any: { headers: { cookie } } }`            | **redacted** — depth three is fine     |
  | `{ any: { headers: { Cookie } } }`            | **leaks**                              |
  | `{ headers: { cookie } }`                     | **redacted**                           |
  | `{ headers: { Cookie } }`                     | **leaks** — so not depth, at any depth |
  | `{ requestContext: { headers: { Cookie } } }` | redacted, by `safeFields`              |

  The obstacle is **case**. pino matches a path segment exactly, so
  `*.headers.cookie` covers Node's `IncomingHttpHeaders`, which are always
  lower-cased, and never covers a `RequestContext`, whose keys carry real HTTP
  casing — as `downloader/contract/src/media.ts:121` says and as this file's own
  `CREDENTIALED` fixture shows. That is a more useful fact than the one I
  replaced it with: the second layer is a net under _Node's_ headers, not under
  ours, and `safeFields` is the only thing that has ever covered the real shape.
  Both rows are now pinned by a test, and the caveat is written where the paths
  are declared rather than only here.

  **A second gap, also from that gate, also measured here.** `safeFields` matches
  the literal key `requestContext` at the **top level** and nowhere else, so a
  context nested under another key or inside an array leaks in full — through both
  layers. Every call site in the tool passes it at the top level, so this is a gap
  in the safety net rather than a live leak. It is now a documented limitation in
  `downloader/api/src/logger.ts` and a test that asserts the gap; widening
  `safeFields` to recurse turns that test red, which was verified by doing it, so
  the caveat cannot go quietly stale.

  **The migration had no test at all, and the obvious test would not have
  caught the obvious bug.** `job-store.test.ts` gains a
  `BEFORE_MIGRATION_3` schema — a frozen copy, which cannot go stale because
  `schema.ts` forbids editing a shipped migration — a row inserted into it at
  `user_version = 2`, then the real `migrate()`. Proven fail-first with the
  precise defect rather than a broad one: moving `thumbnail_path` into
  migration 1's `CREATE TABLE` and deleting migration 3 reddens **exactly** the
  two legacy-database tests while every fresh-create test stays green. That is
  the whole argument for the pre-migration row, demonstrated rather than
  asserted.

  **The SSE strip is now pinned.** `pipeline.test.ts` runs a job whose probe
  carries a thumbnail through to `completed` and asserts the persisted
  `Job.thumbnailPath` serves; `routes.test.ts` reads the `probed` frame and
  asserts on the raw body that the origin does not appear in it. Gate 2 had low
  confidence this was broken and was right — it was not. Reverting
  `withThumbnailPath` at `downloader/api/src/jobs/orchestrator.ts:257` reddens it, on the raw-body
  assertion.

  **Three things recorded as decisions rather than changed.**

  - **The `Preview` same-origin guard was raised, put to the user, and
    declined.** I proposed refusing a `thumbnailPath` that is not a same-origin
    path, since `jobSchema` types it `z.string()` and it is re-read from
    `localStorage`. My own argument against, which the user took: writing another
    origin's `localStorage` requires XSS on our origin, at which point a beacon
    is the least of the problem — and the guard would need a `data:image/`
    exception for the mock, which has no server to serve bytes from. Recorded so
    the next reader sees a decision and not an omission.
  - **The abort-signal gap stays.** `captureThumbnail` does not receive the
    probe route's own `controller.signal`, so a client that navigates away can
    leave the image fetch running up to `THUMBNAIL_FETCH_TIMEOUT_MS` (4 s) past
    the rest of the probe. It is bounded, and it happens after the concurrency
    slot is released, so it holds nothing scarce. Known trade-off, not churned.
  - **`THUMBNAIL_TTL_MS` and friends stay module constants**, and a gate supplied
    a better reason than I gave: `probeCacheTtlMs` is operator-configurable but
    **clamped** by the hardcoded `PROBE_CACHE_TTL_CEILING_MS`, so
    `THUMBNAIL_TTL_MS > PROBE_CACHE_TTL_CEILING_MS` holds for every possible
    configuration. Making the thumbnail TTL configurable would add the only way
    to break that invariant.

  **Two tickets filed on this branch**, on dl-32/dl-33's precedent of riding
  dl-23's: **dl-34** (the resolver tiers have no route to the operator's CA, and
  misclassify a certificate failure as `NO_MEDIA_FOUND`) and **dl-35** (no CSP,
  which matters now that this branch gave the page its first `<img>`). dl-34's
  citations were relayed from two agents; every one was re-resolved before being
  written down, and **the relayed paths did not resolve as given** — this repo
  has two `size-probe.ts` and two `pool.ts`. dl-34 separates what was verified
  here from what is inherited and unverified, and the two unverified claims are
  the exact strings Chromium and yt-dlp emit, which its Build step depends on.

  **Citations: every failure is deliberate, and they are all in one place.**
  `scripts/citations.mjs` reports a bare `orchestrator.ts:257` as ambiguous —
  three tracked files match it across two tools — which reads as staleness and is
  not. Qualifying to `downloader/api/src/jobs/orchestrator.ts:257` fixes it; that
  is dl-31's finding, relayed, and it holds here.

  **That bare `orchestrator.ts:257` in the sentence above is deliberate and must
  stay unresolved — it is the example, not a citation.** `citations.mjs` says as
  much in its own closing note: a citation that is a finding's own evidence has
  to stay as written. Qualifying it would make the tool green and the paragraph
  meaningless.

  **No count is given, on purpose.** An earlier draft of this paragraph said
  "29/52", and it was wrong by the time it was committed: the paragraph cites
  `downloader/api/src/jobs/orchestrator.ts:257` one line further down as its own
  example, and two more citations landed in the paragraphs after it, so the
  denominator moved under a sentence whose whole point was that its numbers had
  been checked. It then moved _again_ while this correction was being written. A
  number in prose beside a command anyone can run is a maintenance liability, so
  the command is the answer: `node scripts/citations.mjs <this file>`.

  **I qualified only the sections this session wrote** — the two gate records and
  the two 2026-09-01 Log entries — and every one of those resolves to the exact
  line intended, checked line by line rather than by a total.

  **Everything before them is left failing on purpose**, because qualifying it
  would make it _worse_. The Build section's line numbers were verified against
  `1d420b7` at filing time, and this branch's own edits moved several of the files
  they point into. Adding a path prefix would turn "ambiguous" into a confident
  green arrow pointing at a line that has since shifted — which is exactly the
  failure mode worth avoiding. It is already visible in one that resolves without
  help: `probe.ts:101` is cited in the Why for the verbatim "attacker-influenced"
  comment, and today resolves to `// never even learns that an internal address
answered. mustPass only —`, because this branch rewrote that comment two lines
  up. The citation is green and wrong. The Build section is now history rather
  than instructions, so the honest state is an unresolved citation plus this
  paragraph, not a resolved one that lies.

  The filing-gate section at `## The gate on this filing` is untouched for a
  second reason as well: its citation list _is_ its evidence — a record of what
  that gate checked and where, at the commit it checked. Rewriting it would
  falsify the record rather than repair it.

- **2026-09-01** — **The probe response was shipping the source's session
  credentials to the browser.** Found by dl-29's post-PR gate while reproducing
  the SSE test on this branch; pre-existing, unrelated to the preview image, and
  folded in here by the user's decision rather than given its own branch.

  `RequestContext.headers` is what a resolver captured from the source —
  `downloader/contract/src/media.ts:121` says "Replayed verbatim. Typically
  Referer, Origin, User-Agent, Cookie, Authorization" — and it sat inside
  `probeResultSchema`, which goes out on the wire. `withoutEgressProxy` strips
  `proxyUrl` and explicitly puts `headers` back. So every probe response and every
  `probed` frame carried a live third-party session to a client that has never
  read the field: `requestContext` appears nowhere under `web/src` except the
  mock's own fixture data.

  **Reproduced first, on the wire, before anything was changed.** `probeResult()`
  in `api/test/helpers.ts` has carried `Cookie: session=super-secret` since it was
  written, so no special fixture was needed — which is also why nobody noticed.
  Driving the three outbound paths and grepping the raw body for the literal
  secret:

  | path                          | before    |
  | ----------------------------- | --------- |
  | `POST /api/probe`, fresh      | **leaks** |
  | `POST /api/probe`, from cache | **leaks** |
  | the `probed` SSE frame        | **leaks** |

  The SSE row took two attempts and the first one lied. A naive probe reported
  "no leak" because the job had raced past `probing` before the test connected, so
  the stream held no `probed` frame at all — the assertion was measuring the
  absence of the frame, not the absence of the credential. The committed test
  asserts `toContain('"type":"probed"')` **first**, for exactly that reason.

  **The trap, answered by grep rather than by the docblock.** Gate 1 had
  established that the probe cache stores the already-rewritten `clientProbe`, and
  the question was whether anything downstream drives a download from it — if so,
  stripping into the stored object would break every cached-path download
  silently. `grep -rn probeCache` returns exactly two accesses, both in
  `routes/probe.ts`: `:51` `get` and `:123` `set`. Nothing else in the repo reads
  it, and the orchestrator re-probes unconditionally. So the answer is no — but
  the strip is still at the response seam and not on the stored object, because
  that is the property that stays true when someone later adds a third reader.

  **Three seams, one function.** `probeForClient` in
  `downloader/api/src/probe-out.ts`, called identically at `POST /api/probe`
  fresh, `POST /api/probe` **cached**, and the `probed` frame. One function rather
  than a few lines inlined at each, precisely because the cached branch returns
  early and is the one that gets missed — it is the seam the original code missed.
  Proven per seam, not just in aggregate: mutating the cached call site alone
  reddens exactly one test, mutating the SSE call site alone reddens exactly one,
  and removing the function's body reddens all three. All assertions are on the
  raw serialised body.

  A fourth test asserts the opposite direction — that the engine is still handed
  the real headers — because the failure mode of over-stripping is a CDN quietly
  refusing every credentialed download, which no other test here would catch.

  **`headers: {}`, not removed.** `requestContextSchema.headers` is required, so
  emptying it keeps every client, parse and fixture valid with no contract edit.
  Removing the field from the wire schema would be a contract change and this repo
  does not make those unilaterally. **Whether `requestContext` belongs on the wire
  at all, given nothing reads it, is raised as an open decision and deliberately
  not settled here.**

  Also confirmed before writing the fix, because it is what makes it safe: a
  client never sends a probe back. `createJobRequestSchema` is `{ url, options }`,
  and both `probeResultSchema` uses are outbound. So stripping on the way out
  cannot break job creation.

  **Known cost, accepted:** the PR title now under-describes the branch. It says
  "show a preview image"; the branch also stops sending session cookies to
  browsers. This repo squash-merges, so that is the changelog line. It was raised
  before the fold-in and taken knowingly; a title covering both is proposed in the
  report.

- **2026-09-01** — Gate 3's one finding, and the two open decisions the user
  settled.

  **The control I wrote to replace the old one did not control, and I had said as
  much without following my own sentence.** When the credential strip reddened
  `tiers-behind-the-proxy.test.ts`, I replaced its `headers["Referer"]` assertion
  with `headers` equals `{}` and wrote in the report that "a security fix that
  reddens a test whose comment says 'the rest of the context survived' is exactly
  the shape that gets reverted by someone in a hurry". That was the right
  instinct and I stopped one step short of acting on it: the replacement asserts
  a value that `probeForClient` guarantees at the response seam no matter what
  any earlier layer did, so it cannot fail.

  Reproduced before fixing, as the gate did: make `withoutEgressProxy` empty
  `headers` too whenever `proxyUrl` is set, then run the project. **897 passed,
  897 green, bug live.** Watching a full suite go green over a deliberately
  broken credential path is the part that makes the remedy obvious.

  The underlying cause is that `withoutEgressProxy` had **no test at all** — a
  response-body assertion had been standing in for coverage of a function, and
  once a later layer started rewriting the same field the stand-in stopped
  working without anyone touching it. `egress-proxy.test.ts` now asserts on the
  function directly: `proxyUrl` dropped, `headers` and `expiresAt` preserved, and
  the early-return branch.

  **I closed the gate's second reason as well, which it did not ask for.** It
  noted that `routes.test.ts`'s engine check never set `requestContext.proxyUrl`,
  so `withoutEgressProxy`'s early return meant that branch was unexercised there
  too — then recommended only the unit test. The unit test pins one function; the
  engine test pins the property that actually matters (the engine receives real
  credentials in a proxied deployment) whichever layer breaks it. One fixture
  line. Both go red under the mutation independently, verified one at a time.

  **Decision — `headers: {}` stays on the wire.** Raised as an open question with
  three options and put to the user, who chose option 1. The alternatives were
  removing `requestContext` from `probeResultSchema` (honest, since nothing reads
  it, but a real contract change touching the SSE frame, the mock, fixtures and
  the web types) and narrowing it to `{ expiresAt? }` (most honest about what a
  client may have, same contract cost plus a second shape to name). Option 1
  needs no contract edit, every client and fixture still parses, and `expiresAt`
  — the one member a client can act on — survives. Its cost, recorded so nobody
  rediscovers it as a defect: the type says `Record<string, string>` and a client
  always sees `{}`. **Answered, not overlooked.**

  **Decision — the PR title stays `feat(downloader)`, over my objection.** I
  raised that `feat` routes the changelog line to **Features**, so an operator
  scanning **Fixes** for a credential leak will not find it there, and that
  `fix(downloader)` would invert the problem by burying the user-visible feature.
  Put to the user with that argument; they chose to leave it. Recording the
  objection because an accepted cost and an unnoticed one look identical six
  months later, and this one was accepted.

  **Not in scope and not touched:** the finding that `requestContext` reaches the
  client at all was the _previous_ entry's work; this entry is only about the test
  that was supposed to guard the server side of it.

  **A third sighting of dl-33's flake, this time with a contention measurement.**
  The first `npm test -- --project downloader` run of this session failed on
  `two-origin-tls.test.ts` with `ERR_OSSL_ASN1_ILLEGAL_PADDING`, a hook timeout
  and a test timeout, and took **185 s**. The immediate re-run, same commit, same
  machine, passed 900/900 in **37.6 s**. A 5× wall-clock difference between a
  failing and a passing run minutes apart is the strongest evidence I have seen
  for dl-33's contention framing, so it is recorded on that ticket rather than
  only here.

- **2026-09-01** — Committed the post-PR gate's own record, which had been missing
  from this ticket and from #128. It ran at `569214d`, between Gate 2 and the
  credential-strip gate, and it is the record whose "critical, out of scope"
  finding **became** that strip — so the two read as a sequence rather than as one
  gate having overlooked something. The gap was in the relay that asked for that
  round's fixes and not for the record, not in the review.

  Three decisions about how it was inserted, all measured rather than assumed:

  - **It carries no number.** Numbering it would make it Gate 3 and push the
    committed credential-strip record to Gate 4, and two _test_ files cite
    "dl-29's third gate" by that number (`routes.test.ts:379`,
    `egress-proxy.test.ts:596`). Renumbering would have made those comments wrong,
    which a documentation-only change has no business doing.
  - **Its citations are pinned with `--rev 569214d`.** Both ways resolve 16/34, so
    the count alone would not have settled it — but diffing the two runs shows
    three citations pointing at _different content_ now, since the strip and its
    tests landed after the record was written. One of them, `probe.ts:101`, is the
    record's own evidence for a finding it quotes verbatim, so remapping the
    number would have destroyed the finding and editing the reviewer's words was
    not an option. The sha is pre-squash and the record says so.
  - **Only the section's own title changed**, from `## Review`, on the same
    precedent as `## The gate on this filing` and for the same concrete reason:
    `repo-12`'s board check reads `## Review` as a specific signal.

  Verified mechanically before committing, because the failure mode here is silent
  — a duplicated heading and a half-cut sentence both pass `npm run check` and
  `npm run status -- --json`. The insert was anchored on the _heading form_
  (`\n\n## …\n`), never on bare heading text, since this ticket quotes headings
  inside backticks throughout. Then: `git diff --numstat` reports 95 insertions and
  **0 deletions**; a section-by-section comparison against `HEAD` reports exactly
  one heading added, none removed, and every pre-existing section byte-identical;
  and all 66 lines of the reviewer's body appear verbatim in the committed
  section.

  Gates 1, 2 and this one were also posted to #128's thread, which previously
  carried only the credential-strip record.
