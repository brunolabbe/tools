---
id: dl-32
tool: downloader
title: Decide whether the job list has a caller, then scope it or say it does not
kind: fix
status: done
milestone: null
depends_on: []
difficulty: hard
---

# dl-32 — `GET /api/jobs` answers everyone with everyone's jobs

## Why

_Stated as it stood when this was filed. The answer is under
[The decision, and the answer](#the-decision-and-the-answer); the route is gone._

`GET /api/jobs` took no credential, and there is no session model in this
service to take one from. It answered any caller who could reach the port with
every job in the store — not their jobs, because the concept does not exist.

[dl-23](./dl-23-rate-limit-the-download-route.md) closed the sharpest half of
this while it was next door: the list used to carry `result.downloadUrl`, a live
capability token for a finished file, so one unauthenticated call harvested every
downloadable file at once. That was fixed and tested; the list then returned a
`JobListItem` with the capability stripped — a type that has since gone with the
route — and `GET /api/jobs/:id` keeps the capability, because reaching it costs
an attacker a `randomUUID()` job id.

**What was left is not a capability but a history**, and nobody had decided
whether that is a problem. It was recorded in dl-23's Log as needing its own
ticket rather than folded in, because the fix is not a redaction — it is a trust
model this service has never had.

## The reproduction

**Historical as of this ticket.** `GET /api/jobs` no longer exists; the same
request now answers `404 NOT_FOUND`, and `routes.test.ts` asserts that none of
the fields below reach the body. What follows is what it returned before, kept
because the shape is the reasoning.

Measured against the branch as it stood, through the real Fastify stack, with an
unauthenticated `GET /api/jobs` and no id, token or header supplied. One
completed job returned:

```json
{
  "id": "4bb9f9e5-0e59-4609-8032-e3dd0f8de596",
  "sourceUrl": "https://site.example/watch/42",
  "status": "completed",
  "variant": { "url": "https://cdn.example/master.m3u8", "label": "1080p · H.264 + AAC", "…": "…" },
  "result": { "filename": "video.mp4", "sizeBytes": 27, "durationSec": 120, "expiresAt": "…" },
  "createdAt": "…",
  "updatedAt": "…",
  "finishedAt": "…",
  "attempts": 1,
  "progress": { "…": "…" }
}
```

Three things in there are worth naming separately, because they are not equally
bad:

1. **`sourceUrl` and `result.filename` are a browsing history.** Every page
   anyone pointed this service at, with a timestamp and a title-derived filename.
   For a single-user laptop deployment that is nothing; for the shared instance
   `docs/02-DEPLOYMENT.md` describes putting behind Cloudflare, it is the whole
   privacy story of every user.
2. **`variant.url` is a media URL, and the contract itself says these carry
   credentials.** `RequestContext`'s note in `contract/src/media.ts` states that
   CDNs "routinely" require "a signed query parameter with a short TTL". The
   field's _presence_ in the list response is measured above; whether a given
   deployment's variants are signed is not, and depends entirely on the origin.
   Where they are, this is a second credential leaving by the same door dl-23
   just closed — and unlike the download token it is one `redactUrl` was
   literally written for.
3. **`error` can carry a payload with `details`.** Bounded by the allowlist in
   `http-errors.ts`, so this is the least of the three, but it is caller-visible
   diagnostic text about someone else's failure.

## The decision, and the answer

**Answered 2026-09-05: option D — remove the `GET /api/jobs` list route.**

Put to the repo's owner as the four options below, verbatim from this page and
deliberately unranked, because the right answer depends on how the service is
actually deployed and the code cannot tell you that. They chose D.

**Why the other three were not taken**, in the owner's own frame of the choice:

| Option                                            | Why not                                                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** — document a single trust boundary          | It buys the invariant with prose alone, and `docs/02-DEPLOYMENT.md` already contemplates the shared instance behind Cloudflare that the invariant would have to retract. Every future "just expose the API" stays a footgun with nothing but a sentence guarding it. |
| **B** — scope by a proxy-supplied identity header | It is the cheapest option that produces real scoping and the easiest to misconfigure into a false sense of one: an unset or wrong `trustProxy` silently makes every job belong to one caller, and the failure is invisible from inside the service.                  |
| **C** — a real session                            | By far the largest, and it puts a login in front of a tool whose entire appeal is that it has none.                                                                                                                                                                  |

**D's cost was accepted, not overlooked.** It is the only option that is hard to
reverse cheaply — the client interface, its mock and its tests went with the
route — and it removes a debugging affordance and an obvious future feature. It
is also the only one that closes the exposure without inventing a trust model
this tool does not have, and the only one that costs the product nothing, because
nothing ever called it.

### Where this is recorded, and why not an ADR

**An amendment to this ticket, plus a paragraph in the tool's own
[`01-ARCHITECTURE.md`](../01-ARCHITECTURE.md) security posture. Deliberately not
an ADR.** The root `CLAUDE.md` reserves `docs/adr/` for "decisions binding more
than one tool", and all five existing ADRs are repo-wide (per-tool docs, release
mechanics, the generated status page, compose fragments, excusing a scanning
finding). This binds one tool: it is a statement about the downloader's HTTP
surface and nothing else, and the planner has no job list and no stake in it.
Filing it as an ADR would put a downloader fact in the repo-wide directory, which
is the fusion the layout rules exist to prevent.

The architecture doc is the right second home rather than an optional extra:
`docs/02-DEPLOYMENT.md:155` "see the security posture in" already sends a
reader to that section, so the answer is on the page an operator is already
pointed at.

### The single read was reconsidered and kept

The trap below says anything decided for the list has to be decided for
`GET /api/jobs/:id` too. That is right for **B and C** — scoping a list while
leaving the read open moves enumeration behind a `randomUUID()` rather than
closing it. It does not follow for **D**, and the difference is not a
convenience:

- Removing the list **closes** enumeration rather than relocating it. There is
  no longer a door that answers without an id.
- The residual at `/:id` is bounded by 122 bits of CSPRNG, and that id already
  buys `result.downloadUrl` and therefore the file. The history behind it is not
  a further step for anyone who has the id — it is strictly less than what they
  already hold.
- `useJobs.ts:112` and `useJobs.ts:136` call `getJob`: it is the reconcile after
  an SSE drop and the source of the download button. Removing it stops the
  product doing the thing it is for.

So `/:id` stays, and `routes.test.ts` keeps two guards on that reasoning — the
link is still served there, and job ids are still unguessable. **If job ids ever
stop being `randomUUID()`, this conclusion expires** and the single read needs
real authorisation.

### The options as they were put

**There was no session, no user, no ownership column and no notion of "caller"
anywhere in the service**, so every option below was a different answer to a
question that had never been asked, not a different implementation of an agreed
one.

**Option A — say it is single-trust-boundary, and write that down.**
The service is one user's tool on one machine; anyone who can reach the port is
that user. Close this with a documented invariant in `01-ARCHITECTURE.md` and a
sentence in `docs/02-DEPLOYMENT.md` saying the API must never be exposed without
an authenticating proxy in front of it.
_Cost:_ no code. But `docs/02-DEPLOYMENT.md` already contemplates a shared
instance behind Cloudflare with `TRUST_PROXY` set, so this option requires either
retracting that or bounding it explicitly. It also makes every future
"just expose the API" a footgun with only prose guarding it.

**Option B — scope the list to a caller identity supplied by a proxy.**
Trust an authenticated header (`X-Forwarded-User` or similar) from a proxy the
operator already runs, store it on the job, filter the list by it.
_Cost:_ a schema migration on `jobs`, a config knob for the header name, and a
hard dependency on `trustProxy` being set correctly — with the failure mode that
an unset or misconfigured proxy silently makes every job belong to one caller.
It is the cheapest option that produces real scoping, and the easiest to
misconfigure into a false sense of one.

**Option C — give the service a real session.**
A first-class notion of a user, an owning session on every job, and the list
filtered by it.
_Cost:_ by far the largest, and it puts a login in front of a tool whose entire
appeal is that it has none. It also makes the file token redundant, which is
either a simplification or a rewrite depending on how it lands.

**Option D — remove the list route.**
Nothing in the UI calls `listJobs` today — measured during dl-23 — so deleting it
costs the product nothing and closes the exposure entirely.
_Cost:_ it removes a debugging affordance and an obvious future feature, and it
is the only option that is hard to reverse cheaply, because the client interface,
its mock and its tests all go with it.

## Build

What D implied, as built:

- **`api/src/routes/jobs.ts`** — delete the `app.get(ROUTES.jobs, …)` handler,
  `toListItem`, `intParam` and `MAX_LIST_LIMIT`. `ROUTES.jobs` itself stays:
  `POST /api/jobs` is the create route on the same path, and the removal is of a
  method, not a path.
- **`contract/`** — delete `JobListResult` and `JobListItem` (`job.ts`), and
  `JobListResponse`, `jobListResultSchema`, `jobListItemSchema` and
  `jobListResponseSchema` (`api.ts`). These existed for one endpoint.
- **`web/src/api/`** — delete `listJobs` from the `ApiClient` interface, from
  the HTTP transport and from the mock. The interface is the enforcement: an
  object literal typed `ApiClient` that grows a `listJobs` back fails to compile.
- **Not the store.** `JobStore.list` stays. It is a DB primitive, not a surface,
  and it has a live caller that is not the route: `pipeline.test.ts:283` reads
  the only job's status from it _before_ `POST /api/jobs` has returned an id,
  which is the one thing a captured id cannot do.

Traps worth knowing, and what each turned out to mean:

- **`trustProxy` is off by default and that is load-bearing.** It mattered only
  to option B. Nothing in this change goes near `config.ts`, and it was left
  alone.
- **`GET /api/jobs/:id` is the same exposure at retail.** Reconsidered and kept
  — the reasoning is under "The single read was reconsidered and kept" above,
  and the short form is that D closes enumeration rather than relocating it.
- **The SSE stream at `/api/jobs/:id/events` is a third door**, and it carries a
  full `JobResult` including `downloadUrl` on the `completed` frame — which is
  correct and load-bearing, since it is how the UI learns its link. Untouched.
- **A fourth door the page did not name, and it is the deployed one.** With
  `WEB_DIR` set — which is how the container ships — an unmatched path reaches
  the SPA fallback before the 404 handler. `wantsHtml` in `routes/web.ts`
  excludes `/api/` for exactly this reason, so the removed route still answers a
  typed 404 rather than `index.html` with a 200. That is behaviour this change
  now depends on, so it has its own test rather than being inherited.

## Done when

1. The decision above is recorded — as an ADR if it binds the architecture, or as
   an amendment to this ticket if it does not — naming which option was taken and
   why the others were not.
2. Whatever that option implies is built and tested, or the ticket is closed
   `dropped` with the reasoning if the answer is "no change".
3. If any code lands: a test proves an unauthenticated `GET /api/jobs` no longer
   returns a job it should not, through the real stack rather than at the client.

**Done-when 3 needed interpreting for D, and this is the reading taken.** The
line was written for A/B/C, where the route survives and returns less. Under D
there is no route, so the honest form is that the path resolves to a route miss:
`404` with `NOT_FOUND` from `@webtools/core` — a URL that matched no route — and
**not** `JOB_NOT_FOUND`, which names a job the runner has no record of and would
be the wrong code re-worded at the call site. The weaker reading available here
was to assert only the status code; the test asserts the code, and additionally
that the token, the job id, the `sourceUrl`, the media host and the filename are
all absent from the response body, so it would still fail if a future handler
answered 404 with a body.

## Review

**Gate: PASS** — 2026-09-05 · `origin/main (c37cab9)...c6c40fd` · own defect hunt (no `Agent`/`Skill` tool available to the reviewer) at medium depth · reviewer is Sonnet ("You are powered by the model named Sonnet 5. The exact model ID is claude-sonnet-5."), builder is Opus ("You are powered by the model named Opus 5 (1M context). The exact model ID is claude-opus-5[1m]."), both quoted verbatim from each side's own context — cross-model gate established two-sidedly

| Done when                                                                                                          | Proof                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — the decision is recorded, naming which option was taken and why the others were not                            | **proven** — this ticket's own "The decision, and the answer" (lines 82–182) plus `01-ARCHITECTURE.md`'s new "There is no caller, so there is nothing that lists" section                                                                                                                                                          |
| 2 — whatever that option implies is built and tested                                                               | **proven** — `api/test/routes.test.ts:461`, `:492`, `:506`; `downloader/api/test/web-serving.test.ts:92`; `api/test/rate-limit.test.ts:247`; `web/test/mock-api.test.ts:280`; the contract and client removals are compiler-enforced (`npm run check` exit 0, re-run)                                                              |
| 3 — a test proves an unauthenticated `GET /api/jobs` no longer returns a job it should not, through the real stack | **proven** — `api/test/routes.test.ts:461` (`server.inject` against the real harness with a genuinely completed job in the store) and `downloader/api/test/web-serving.test.ts:92` (same request under the container's `WEB_DIR` configuration, where an unmatched path would otherwise hit the SPA fallback before a 404 handler) |

- **verified** · orphan scan: `command grep -rn "listJobs|JobListItem|JobListResult|JobListResponse|toListItem|MAX_LIST_LIMIT|jobListResultSchema|jobListItemSchema|jobListResponseSchema"` across `tools/downloader` and `packages` returns zero hits in live code; only survivors are historical references in `dl-15`'s and `dl-23`'s own Logs (correctly untouched history) and this ticket's own text.
- **verified** · `ROUTES.jobs` retained correctly: `app.post(ROUTES.jobs, …)` remains at `api/src/routes/jobs.ts:37`; `app.get(ROUTES.jobs, …)` is gone. `api/test/routes.test.ts` 40/40 pass.
- **verified** · Done-when 3's stronger form: the five `not.toContain` literals (token, id, `SOURCE_URL`, `"cdn.example"`, `"video.mp4"`) traced to their real fixture sources (`api/test/helpers.ts:21`, `:27`, `:154`) rather than assumed to match by inspection, and the 404 body confirmed non-trivial (`downloader/api/src/server.ts:495`'s `NOT_FOUND` carries `details.path`), so the negative assertions have real content to fail against.
- **verified, method recorded** · test counts are genuinely net-zero, not coincidentally so: built a **second, independent worktree at `origin/main` (`c37cab9`)** — farmed with `worktree-farm.sh`, built with `npm run build`, then ran both suites there rather than trusting the branch's own numbers or the ticket's Log. Baseline: 62 files / 979 tests (downloader), 122 / 1966 (full monorepo). This branch: identical on both counts, both suites. Read the diff of all four touched test files (`api/test/routes.test.ts`, `api/test/rate-limit.test.ts`, `web/test/mock-api.test.ts`, `web/test/app.test.tsx`, plus additions in `api/test/web-serving.test.ts`): no assertion was weakened, and `api/test/rate-limit.test.ts:247` was strengthened (reads a specific job by id instead of the removed list — a tighter proof of "what it already started").
- **verified** · disclosed weakness 1 (`api/test/routes.test.ts:492`, the POST guard, green in both directions "by construction"): reproduced the mutation check independently — repointed `app.post(ROUTES.jobs, …)` at `/api/jobs-mutated` in a scratch edit, re-ran: `AssertionError: expected 404 to be 201` at line 502, matching the builder's own report exactly. Reverted; `git status` clean after. Judged sound: the assertion does not depend on `GET /api/jobs`'s existence, so mutating what it actually depends on is the only way to get a real red state from it.
- **verified** · disclosed weakness 2 (`api/test/routes.test.ts:461`'s five `not.toContain` lines "never exercised red"): reproduced independently — restored `origin/main`'s `api/src/routes/jobs.ts` in a scratch edit, re-ran: fails at the status-code assertion (`expected 200 to be 404`) and stops there, so the five lines are genuinely never reached in that red run. Reverted; clean after. The compensating positive test at `api/test/routes.test.ts:506` (same five strings asserted present on `GET /api/jobs/:id`) is judged sound, and confirmed further than reading it: the five literals independently trace to real fixture values on both sides (not independently-typed strings that happen to coincide), so a typo in either list would in fact have been caught.
- **verified** · the judgment call — does removing the list transfer the trap to `GET /api/jobs/:id`? Checked all three of the builder's reasons independently; concur it does not transfer, no escalation:
  1. No route answers without an id: `JobStore.list` has zero production callers in `api/src` or `engine/src` (the only caller anywhere is `api/test/pipeline.test.ts:283`; `api/src/db/job-store.ts:220` is the only other hit, its own definition).
  2. Job ids are `randomUUID()` v4 (`api/src/routes/jobs.ts:20,57`), 122 bits, asserted by `api/test/routes.test.ts:530`'s regex (passing); the same id already reaches `result.downloadUrl` via the same route (`api/test/routes.test.ts:506`).
  3. `web/src/hooks/useJobs.ts:112` and `:136` both call `api.getJob` for real, live product paths — the SSE-drop reconcile (`attach`'s `refetch`) and the on-mount restore effect that merges job state, including `result.downloadUrl`, into what the UI renders. Read the surrounding code at both sites, not just the cited line.
- **verified** · `JobStore.list` correctly kept as a DB primitive, not a surface: zero production callers, one live test caller (`api/test/pipeline.test.ts:283`).
- **verified** · `docs/02-DEPLOYMENT.md` correctly untouched (`git diff origin/main...HEAD -- docs/02-DEPLOYMENT.md` empty); its "no authentication anywhere in the application" claim (`:140`) is unchanged and still accurate.
- **dropped** · reviewer initially raised the file location of `docs/02-DEPLOYMENT.md` (root `docs/` rather than `tools/downloader/docs/`) as a possible layout inconsistency, based on reading only its first ~150 lines. Retracted on the builder's correction, independently re-verified: the file is 530 lines, 27 mentions of "planner" and 20 of "downloader", with a 187-line planner-only section (`:287`–`:473`) and an explicit `## Adding the second tool` section (`:474`) contrasting the two tools' deployment and Access-policy differences line by line. It is genuinely repo-wide (one tunnel serving both tools) and the sibling of `adr/004`. Not a finding, and the reviewer's own error, not the builder's.
- **findings** · own defect hunt (no `Agent`/`Skill` tool; ran at medium depth) returned 0 med/high findings; 2 disclosed weaknesses reproduced and judged sound; 1 dropped (reviewer's own mistaken observation, corrected above).
- NFR: security ✓ — this is the fix; the exposure is closed with no new one opened. performance n/a. reliability ✓ — full suite green before and after, no assertion weakened. maintainability ✓ — contract/type surface shrank cleanly, duplication (`toListItem` in two places) removed.
- Repo invariants checked: `AppError`/`NOT_FOUND` (not `JOB_NOT_FOUND`) used and asserted correctly; no bare `Error`, no shell, no new `console.` in the diff's added lines; `packages/core/test/{spawn-safety,image-closure}.test.ts` pass 11/11; no new test files, so nothing to register in `tsconfig.tests.json`; style (`import type`, `.ts` extensions, no `any`) consistent.
- `npm run check` exit 0. `npm run format` leaves the tree clean. `node scripts/status.mjs --json` exit 0, `problems: []`, `dl-32` shows `status: done`. `node scripts/citations.mjs tools/downloader/docs/work/dl-32-the-job-list-has-no-caller.md`: 18/18 resolve at gate time, before this section existed; re-run against the committed tip with this section included returns 38/38 — the 20 citations this section itself adds all resolve too. Higher-value citations additionally hand-verified for content by hand, not just line resolution. `git merge-tree --write-tree c6c40fd b6969dc8e67810a6ea26e6bb9c7f118eed715a78` (this branch vs. PR #147's head): exit 0, no conflict — confirmed the two branches' `01-ARCHITECTURE.md` edits land in non-overlapping sections (env-var table around line 132 vs. this ticket's security-posture addition at the file's end, line 245+).

## Log

- **2026-08-31** — Filed from dl-23's gate D, at the user's request. dl-23 closed
  the capability half of this (the list no longer carries `result.downloadUrl`)
  and deliberately left the rest, because redacting a token is a fix and deciding
  who may read a history is not. The reproduction above was measured on dl-23's
  branch rather than reasoned about; `variant.url`'s _presence_ is measured and
  its credential-bearing _content_ is the contract's own claim, not something
  this session observed.
- **2026-09-05** — Built option D. `GET /api/jobs` is gone, with
  `JobListItem`/`JobListResult`/`JobListResponse` and their three schemas, and
  `listJobs` from the client interface, the HTTP transport and the mock. The
  decision and the reasons the other three were declined are recorded above and
  in `01-ARCHITECTURE.md`'s security posture; **not** as an ADR, because the root
  `CLAUDE.md` reserves `docs/adr/` for decisions binding more than one tool and
  this binds one.

  **What the brief had wrong or did not anticipate:**

  - **The "nothing in the UI calls `listJobs`" claim is correct, and now
    stronger than it was stated.** Re-measured across `web/src`, `web/test` and
    `e2e/` rather than inherited: the only call sites anywhere were
    `mock-api.test.ts` testing the mock's own method, plus a stub entry in
    `app.test.tsx` that existed because the interface demanded it. `useJobs`
    uses `probe`, `createJob`, `getJob`, `cancelJob` and `openJobEvents` and
    nothing else. No e2e spec mentions the path.
  - **The Build section said "the client interface, its mock and its tests all
    go with it" and stopped there.** Three route tests elsewhere also went with
    it, and two were not obviously about the list: `routes.test.ts`'s "listing
    returns newest first with a total" (removed — the ordering half it really
    tested is covered at the store, `api/test/job-store.test.ts:286`), and
    `rate-limit.test.ts`'s "POST /api/jobs is limited, and reading jobs is not",
    which used the list as its cheap read. That one was rewritten onto
    `GET /api/jobs/:id`, which is a **better** proof of its own claim: "what it
    already started" is one job, by id, not everyone's.
  - **The ticket named three doors and there is a fourth.** With `WEB_DIR` set —
    the container's configuration, and the shared-instance deployment the `Why`
    section is actually about — an unmatched path hits the SPA fallback before
    the 404 handler. It answers correctly, because `wantsHtml` excludes `/api/`,
    but that is now load-bearing for this fix and was covered only generically
    (`/api/nope`). It has its own test now.
  - **Done-when 3 was written for a surviving route** and had to be interpreted;
    the reading taken, and the weaker one declined, are recorded under `Done
when` rather than left implicit.
  - **`JobStore.list` was kept**, and the ticket says nothing either way. It is
    not a surface, and it is not dead: `pipeline.test.ts:283` needs it to read
    the only job's status before `POST /api/jobs` has returned an id.
  - **Not done, and deliberately:** `docs/02-DEPLOYMENT.md` is unchanged. Its
    claim is that there is no authentication anywhere in the application, which
    is still exactly true — D removed a surface, it did not add a boundary. The
    option that would have required editing that page was A.

  **Acceptance, line by line:**

  | Done when                                                                                                          | Verdict  | Evidence                                                                                                                                                                                                                                                                                                                 |
  | ------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | 1 — the decision is recorded, naming the option taken and why the others were not                                  | **pass** | This page, `The decision, and the answer`; plus `01-ARCHITECTURE.md`'s security posture. ADR judged inapplicable, with the reason written down rather than assumed.                                                                                                                                                      |
  | 2 — what the option implies is built and tested                                                                    | **pass** | `api/test/routes.test.ts:461` · `api/test/routes.test.ts:492` · `downloader/api/test/web-serving.test.ts:92` · `api/test/rate-limit.test.ts:247` · `web/test/mock-api.test.ts:280`. The contract and client removals are enforced by the compiler, not by a test: `npm run check` fails on a `listJobs` that comes back. |
  | 3 — a test proves an unauthenticated `GET /api/jobs` no longer returns a job it should not, through the real stack | **pass** | `api/test/routes.test.ts:461`, through `server.inject` against a real harness with a genuinely completed job in the store. `downloader/api/test/web-serving.test.ts:92` covers the same request in the `WEB_DIR` configuration the container ships.                                                                      |

  **Red before green, measured rather than asserted:**

  - `routes.test.ts:461` — run against the unfixed source: `expected 200 to be
404`. It reddened on the live route, not on a missing symbol.
  - `downloader/api/test/web-serving.test.ts:92` — same run, same failure: `expected 200 to be 404`.
  - `routes.test.ts:492` (the POST guard) is green before and after by
    construction, so it was **mutation-checked instead**: repointing
    `app.post(ROUTES.jobs, …)` at `/api/jobs-mutated` turns it red with
    `expected 404 to be 201`. Reverted, and the suite re-run.
  - The five `not.toContain` assertions in `routes.test.ts:461` were never
    reached in the red run, which bailed at the status line — so they were
    proven non-vacuous the other way instead: `routes.test.ts:506` now asserts
    that the same five strings **are** present on `GET /api/jobs/:id`. Absent
    that pair, a typo in either list would have passed silently.
