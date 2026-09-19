---
id: dl-66
tool: downloader
title: A request whose body Fastify cannot parse is reported as `INTERNAL` 500
kind: fix
status: done
milestone: null
depends_on: [dl-58]
difficulty: standard
---

# dl-66 — A malformed request body is reported as `INTERNAL`

**Packages:** `core` (`@webtools/core` gains the new transport code), `api`
(`http-errors.ts`'s `STATUS_BY_CODE`, `server.ts`'s `registerErrorHandling`),
`web` (`error-presentation.ts`'s `ERROR_PRESENTATION`).

## Why

Found while reproducing [dl-65](./dl-65-cancel-from-the-ui-never-reaches-the-server.md).
Against the API on `origin/main` at `3be20cf`:

```bash
curl -s -XPOST http://127.0.0.1:8932/api/jobs/<id>/cancel -H 'content-type: application/json'
# {"error":{"code":"INTERNAL","message":"Something went wrong on our end.","retryable":false}}  — HTTP 500
```

Fastify rejects the empty body with `FST_ERR_CTP_EMPTY_JSON_BODY`, which carries
`statusCode: 400`. `toErrorResponse` (`api/src/http-errors.ts`) passes it through
`AppError.from`, which turns anything that is not an `AppError` into `INTERNAL`,
so a client's mistake is answered as a 500, logged at `error` as `request failed`,
and shown to the user as "This one is on us". dl-65 was invisible for exactly this
reason: the log read as a server fault, not a malformed request.

The same path presumably catches Fastify's other content-type-parser and
body-limit errors (malformed JSON, unsupported media type, body too large) —
measure each before relying on that.

## The decision

**dl-66: what code should a request Fastify cannot parse get?** No code in
the taxonomy fits "the request itself was malformed". This ticket named three
options and no recommendation; asked of the repository owner with
`AskUserQuestion` on 2026-09-17, with the orchestrator's own recommendation
attached since the ticket had none.

1. **Add a transport code to `@webtools/core`** (say `BAD_REQUEST`, 400). It
   describes the transport, not the downloader's domain, so by the root
   `CLAUDE.md` rule it belongs in core — which the planner also consumes.
2. **Map Fastify 4xx errors onto an existing code** in the downloader only — none
   is honest (`INVALID_URL` names the wrong thing), so this re-words at the call
   site, which the root `CLAUDE.md` calls the tell of a wrong code.
3. **Pass the status through but keep `INTERNAL` as the code** — fixes the 500
   and the log level, keeps the wrong copy.

**Chosen: 1, by the repository owner, on 2026-09-17 — matching the
orchestrator's recommendation.** Costs carried forward:

- **`@webtools/core` gains `BAD_REQUEST` (400) in `CORE_ERROR_CODES` and
  `CORE_ERROR_MESSAGES`.** Measured which downstream copy tables that forces
  open, rather than assumed: `DEFAULT_ERROR_MESSAGES` in both tools'
  `contract/src/errors.ts` spreads `CORE_ERROR_MESSAGES` first, so it inherits
  the new entry automatically and needs no edit — confirmed by temporarily
  adding a test code to core and running `tsc --build` on both contracts
  clean. The two tables that are **not** built by spreading and do break are
  the downloader's own: `STATUS_BY_CODE` in `api/src/http-errors.ts` and
  `ERROR_PRESENTATION` in `web/src/lib/error-presentation.ts` — both
  `Record<ErrorCode, …>`, confirmed by the same experiment
  (`tsc --build tools/downloader/api tools/downloader/web` fails naming the
  missing key on each; `tools/planner/api` and `tools/planner/web` build
  clean). **This corrects the ticket's own framing**, which named only
  `error-presentation.ts` and predicted a planner-side cost that the spread
  pattern already absorbs — there is no planner edit this ticket's core
  change forces.
- **If the planner's API has the same Fastify gap, fixing it is a separate
  PR** — one tool per PR, per the root `CLAUDE.md`. Not measured here; `Build`
  below asks the builder to check it, and if the gap is real it is a ticket
  to file for the planner, not a change to make in this branch.
- **Lands after dl-58** (satisfied — dl-58 merged as #269). The stated reason
  was wrong: `git show fb15bc9 --stat` shows dl-58's diff never touches
  `server.ts` or `http-errors.ts` — it is `logger.ts`, the ffmpeg runner and
  their tests. `depends_on` left as `[dl-58]` since it is satisfied either way
  and reordering the field is not worth a second edit. (The first build round
  believed the fix lived entirely in `toErrorResponse` with no `server.ts`
  edit; the review gate found that `registerErrorHandling` computes its own
  second `AppError` for its log line, so `server.ts` **is** genuinely touched
  by this ticket after all — see the Log.)

## The width decision

**dl-66: once the widening rule exists, how wide should it reach?** The rule
that fixes the ticket's own reproduction — any error carrying a numeric
Fastify `statusCode` in `[400, 500)` that is not already an `AppError` becomes
`BAD_REQUEST` — is not narrow to the body-parser errors the ticket named. The
review gate measured it (`downloader-probe.test.ts`, see the Log) and found it
also reaches `@fastify/static`'s own precondition-failed (412) and
range-not-satisfiable (416) responses, and Fastify's own body-too-large (413)
and unsupported-media-type (415). Three options, asked of the repository owner
with `AskUserQuestion` on 2026-09-19:

A. **Keep the rule as written, and record the measured table.** Every widened
case moves from 500 to 400 — never to a worse answer than the ticket's own
bug produced — but four of them (412, 413, 415, 416) trade a status
Fastify or `@fastify/static` already had right for the generic 400.
B. **Pass the real 4xx status through**, keeping `BAD_REQUEST` as the code but
reporting each case's actual status (412, 413, 415, 416, …) rather than
collapsing all of them to 400.
C. **Narrow the rule to Fastify's own `FST_ERR_CTP_*` family** — leave
`@fastify/static`'s 412/416 and any other non-body-parser 4xx exactly as
they were before this ticket (`INTERNAL`, 500), matching the ticket's
original, narrower scope.

**Chosen: A, by the repository owner, on 2026-09-19 — matching both the
reviewer's and the orchestrator's recommendation. A overrode nobody.** Nothing
further changes in the code for this: `isClientRequestStatusError` and the
core `BAD_REQUEST` doc comment are corrected to describe this width
accurately (they previously read as body-parser-only, which was true of the
ticket's original reproduction and not of the code as shipped) — see the Log
for the measured table.

## Build

1. Add `BAD_REQUEST` to `CORE_ERROR_CODES` and `CORE_ERROR_MESSAGES` in
   `packages/core/src/errors.ts` (400, a transport-neutral message — "The
   request could not be understood.").
2. Add `BAD_REQUEST: 400` to `STATUS_BY_CODE` in
   `tools/downloader/api/src/http-errors.ts`.
3. Add a `BAD_REQUEST` entry to `ERROR_PRESENTATION` in
   `tools/downloader/web/src/lib/error-presentation.ts` (tone `"input"`,
   `allowRetry: false` — the same shape as `INVALID_URL`).
4. In `toErrorResponse` (`api/src/http-errors.ts`), before `AppError.from`:
   map an error carrying a Fastify `statusCode` in the 4xx range to a
   `BAD_REQUEST` `AppError`; keep `INTERNAL` for everything else. **Also
   check `server.ts`'s `registerErrorHandling`**: it computes its own
   `AppError.from(error)` for the fields it logs, separately from the one
   `toErrorResponse` builds for the response — if that second computation is
   not widened the same way, the response says `BAD_REQUEST` and the log
   still says `INTERNAL` for the identical request, which is the ticket's own
   `Why` in miniature. Have `toErrorResponse` hand its `AppError` back to the
   caller so there is only one computation, and read `server.ts`'s copy from
   that rather than calling `AppError.from` a second time.
5. Check whether the planner's API (`tools/planner/api/src/server.ts` and
   `http-errors.ts`) has the same Fastify-body-parse gap. If it does, file a
   `pl-` ticket for it rather than fixing it here — this branch stays
   downloader-only.

## Done when

- An `inject` of `POST /api/jobs/:id/cancel` with `content-type:
application/json` and no body answers 400 `BAD_REQUEST`, and logs at
  `info`, not `error`.
- The same for a malformed JSON body on `POST /api/jobs`.
- `npm run check` and `npm test` are green.

## Log

- 2026-09-16 — Filed from dl-65's reproduction. dl-65 removed the one request the
  UI made that hit this; the server-side mapping is still wrong for any other
  client.
- 2026-09-17 — Owner chose **option 1** (`BAD_REQUEST` in `@webtools/core`)
  via `AskUserQuestion`, matching the orchestrator's recommendation (the
  ticket itself named none). Moved to `ready`, added `depends_on: [dl-58]`
  (both land in `registerErrorHandling`, `api/src/server.ts`) and a
  **Packages:** line naming `core`, `api` and `web`. Corrected the ticket's
  own cost estimate: it named only `error-presentation.ts` and predicted a
  planner-side cost; measured with a temporary code added to
  `packages/core/src/errors.ts` and `tsc --build` run against both tools'
  `contract`, `api` and `web` projects (reverted before commit, `git diff`
  confirmed clean) — both tools' `contract` packages inherit a new core
  message via `DEFAULT_ERROR_MESSAGES`'s `...CORE_ERROR_MESSAGES` spread with
  no edit needed, the downloader's `api/src/http-errors.ts` and
  `web/src/lib/error-presentation.ts` are the two tables that actually break,
  and the planner's `api`/`web` build clean. `Build` rewritten to name the
  concrete files and steps; `Done when` names `BAD_REQUEST` explicitly.
- 2026-09-19 — Built. `BAD_REQUEST` (400) added to `CORE_ERROR_CODES` and
  `CORE_ERROR_MESSAGES` in `packages/core/src/errors.ts`; `STATUS_BY_CODE` in
  `tools/downloader/api/src/http-errors.ts` and `ERROR_PRESENTATION` in
  `tools/downloader/web/src/lib/error-presentation.ts` each gained an entry.
  `toErrorResponse` (`http-errors.ts`) now maps any error carrying a numeric
  `statusCode` in `[400, 500)` that is not already an `AppError` to
  `BAD_REQUEST` before falling through to `AppError.from`; `INTERNAL` is
  unchanged for anything with a 5xx or missing `statusCode`. **Corrected the
  ticket's own dependency reasoning**: it said dl-66 lands after dl-58 because
  "both edit `registerErrorHandling` in `api/src/server.ts`" — checked with
  `git show fb15bc9 --stat` (dl-58, #269), which never touches `server.ts` or
  `http-errors.ts` (it is `logger.ts`, the ffmpeg runner and their tests). The
  dependency was still satisfied (dl-58 had merged) but the stated reason was
  wrong; the actual fix lives entirely in `toErrorResponse`, which
  `registerErrorHandling` already calls unchanged. `server.ts` is untouched by
  this branch. Left `depends_on: [dl-58]` as-is since it is satisfied either
  way.

  Checked the planner for the same gap per Build step 5 (own read of
  `tools/planner/api/src/http-errors.ts` and `server.ts`, not inferred): its
  `toErrorResponse` is `AppError.from(error)` with no Fastify-`statusCode`
  branch either, and its `STATUS_BY_CODE` is a `Partial` that falls back to
  500 for anything unmapped — the identical bug. Filed
  [pl-51](../../planner/docs/work/pl-51-a-malformed-request-body-is-reported-as-internal.md)
  rather than fixing it here (one tool per PR, and `tools/planner/web` has no
  `error-presentation.ts` to touch — confirmed by search — so pl-51 is
  `api`-only).

  Fold-in considered and declined: `STATUS_BY_CODE` here is an exhaustive
  `Record<ErrorCode, number>`, so nothing about this change makes the
  planner's `Partial` table exhaustive for free — that would be a second,
  larger decision (whether the planner's table should be exhaustive at all)
  that this ticket did not open and pl-51 does not need answered to fix its
  own gap.

  Tests: `routes.test.ts` gained a unit case for `toErrorResponse` on a
  Fastify-shaped 4xx error and a 5xx boundary case, plus an integration
  describe block reproducing the ticket's own two `Done when` lines through
  `createHarness`/`inject` with a captured logger (asserts the response body,
  the status, and that `request rejected` — not `request failed` — is the one
  line written, at `info`). `error-presentation.test.ts`'s existing
  exhaustiveness check covers the new code with no edit. `mock-api.test.ts`'s
  "every ErrorCode is demonstrable" needed one line: `BAD_REQUEST` joins
  `NOT_FOUND`/`THUMBNAIL_NOT_FOUND` in `notReachableInTheMock`, since the mock
  client calls typed functions directly and has no wire body to fail to
  parse.

  Ran narrowest first: `npx vitest run tools/downloader/api/test/routes.test.ts`
  (44 passed), then `tools/downloader/web/test/error-presentation.test.ts` +
  `error-panel.test.tsx` (22 passed), then `npm test -- --project downloader`
  (86 files, 1461 passed — up from 1457 before this branch), then
  `npm test -- --project core` (5 files, 23 passed — the packages project;
  it is named `core` in `vitest.config.ts`, not `packages`). `npm run check`
  exits 0 (lint, `oxfmt --check`, `tsc --build` across every project).

- 2026-09-19 — First gate: **CONCERNS**, two `med`, three `low`, one open
  decision. Both `med`s reproduced and fixed:
  - **`registerErrorHandling` logged the wrong code.** It computed its own
    `AppError.from(error)` for the log line, separately from the `AppError`
    `toErrorResponse` built for the response — so a widened `BAD_REQUEST`
    reached the client while the log still said `INTERNAL` for the same
    request, which is half of this ticket's own `Why` left standing.
    `toErrorResponse` now returns the `AppError` it built alongside `status`
    and `body`, and `server.ts` reads that instead of calling `AppError.from`
    a second time. Both new integration tests gained a
    `expect(rejected[0]).toContain('"code":"BAD_REQUEST"')` line, confirmed
    red against the pre-fix code before the fix landed. This makes `server.ts`
    genuinely touched by this ticket, correcting what the first build round
    (and the premise-correction note above) believed — updated in place
    rather than left to contradict the Log.
  - **The citations gate broke a merged record.** `node
scripts/citations-gate.mjs --against origin/main` failed
    `dl-32-the-job-list-has-no-caller.md` — 9 anchors into
    `api/test/routes.test.ts` moved by the exact number of lines a new
    top-of-file `import { createLogger }` added. Fixed by not adding a
    top-of-file import at all: the two integration tests load `createLogger`
    with `await import("../src/logger.ts")`, a pattern already used elsewhere
    in this suite (`thumbnails.test.ts`, `vite-config.test.ts`). Separately,
    rebased this branch onto `origin/main` (`4463431`, was `fb15bc9`) — dl-56
    had landed in between and touched `server.ts` and `helpers.ts` well above
    where this ticket's own edits sit, so gating against the stale base was
    itself part of what the gate's first run was measuring. Re-ran
    `citations-gate.mjs` after both fixes: `90 enforced, 0 failing`.
  - **`low`: pl-51 needs a reproduction**, not "confirmed by reading" — the
    reviewer supplied one (`POST /api/intakes` empty-JSON, `POST /api/plans`
    malformed-JSON, both 500 `INTERNAL` at `43d2e5e`); added to pl-51 with
    the exact commands and output rather than restated as this ticket's own
    claim, since it is the reviewer's measurement to attribute.
  - **`low`: the width of the widened rule is an open decision**, forwarded
    by the reviewer to the orchestrator (every non-`AppError` error carrying a
    4xx `statusCode` becomes `BAD_REQUEST`, so `@fastify/static`'s own 412/416
    and Fastify's own 413/415 lose their more specific status). Not resolved
    here — the code and its comments are left as the reviewer measured them
    pending that answer, rather than narrowed or widened on this branch's own
    judgement.
  - **`low`: stale comments** — deferred with the width decision above, since
    narrowing the comment now and having the width decision widen the rule
    back would just be a second edit to the same sentence.

  Re-ran after both fixes: `routes.test.ts` 44/44 (with the two new `code`
  assertions passing), `npm test -- --project downloader` unchanged at 1461,
  `npm run check` exit 0, `citations-gate.mjs --against origin/main` 0
  failing.

- 2026-09-19 — Owner answered the width decision (**A**, see `## The width
decision` above) via `AskUserQuestion`, matching both the reviewer's and the
  orchestrator's recommendation. Applied in the same round as the rest of this
  gate's findings:

  **Reproduced the reviewer's measurement independently** rather than
  transcribing it: copied the reviewer's probe
  (`.../scratchpad/dl-66-gate/downloader-probe.test.ts`) into
  `tools/downloader/api/test/`, ran it (`GATE_OUT=<file> npx vitest run`)
  against this branch's tip (`eb81ae1`, after the MED 1 fix below), deleted it
  afterward — it is not part of this ticket's own suite. Measured table (all
  15 named cases from the probe; before/after are `fb15bc9`/`eb81ae1`):

  | Case                                          | Before                              | After                                                                          |
  | --------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
  | empty JSON `POST .../cancel`                  | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | malformed JSON `POST /api/jobs`               | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | unsupported media type (415)                  | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | body too large (413)                          | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | bad `content-length`                          | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | `__proto__` poisoning payload                 | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | empty JSON on an unknown `/api/` route        | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | `@fastify/static` range not satisfiable (416) | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | `@fastify/static` precondition failed (412)   | 500 INTERNAL                        | 400 BAD_REQUEST                                                                |
  | `GET /api/nope` (route miss)                  | 404 NOT_FOUND                       | 404 NOT_FOUND — unchanged                                                      |
  | `DELETE /api/jobs` (method miss)              | 404 NOT_FOUND                       | 404 NOT_FOUND — unchanged                                                      |
  | `@fastify/static` `..%2f` traversal           | 404 NOT_FOUND                       | 404 NOT_FOUND — unchanged                                                      |
  | rate limit                                    | 429 RATE_LIMITED                    | 429 RATE_LIMITED — unchanged (an `AppError`, never reaches the widened branch) |
  | malformed URL percent-encoding                | 400 (Fastify's own default handler) | 400 — unchanged (never reaches `toErrorResponse` at all)                       |

  Plainly, so it cannot be missed by a later reader: **413, 415, and
  `@fastify/static`'s 412 and 416 all answer 400 `BAD_REQUEST` now**, where
  before this ticket they answered 500 `INTERNAL`. No case regresses to an
  answer worse than the 500 this ticket exists to fix; four of them trade a
  status a framework already had right for the generic 400.

  **Comments corrected to describe this width** rather than only the
  body-parser case the ticket's own reproduction started from: `http-errors.ts`'s
  widening predicate is renamed `isClientRequestStatusError` (was
  `isUnparsedClientRequestError` — "unparsed" was never accurate for a range or
  precondition failure, which parse fine and fail on evaluation instead) and
  its doc comment, and core's `BAD_REQUEST` doc comment in
  `packages/core/src/errors.ts`, both now name `@fastify/static`'s 412/416
  explicitly and say the rule is deliberately wide rather than
  `FST_ERR_CTP_*`-specific. pl-51 updated to use the new name and to copy
  decision A explicitly (its own Build step 1) rather than leave its width
  unanswered.

  Re-ran after the rename and comment changes: `npm run build` clean,
  `routes.test.ts` 44/44, `npm test -- --project downloader` 88 files / 1493
  passed, `npm test -- --project core` 5/23, `npm run check` exit 0,
  `citations-gate.mjs --against origin/main` 0 failing (test counts moved from
  the previous entry's 86/1461 because the branch was rebased onto current
  `origin/main` in between, which is recorded above under the MED 2 fix, not
  because of anything in this round).
