---
id: dl-66
tool: downloader
title: A request whose body Fastify cannot parse is reported as `INTERNAL` 500
kind: fix
status: ready
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
- **Lands after dl-58.** Both edit `registerErrorHandling` in
  `api/src/server.ts`; added to `depends_on`.

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
   `BAD_REQUEST` `AppError`; keep `INTERNAL` for everything else. Rebase onto
   dl-58's landed change to `registerErrorHandling` in `server.ts` rather than
   editing it independently.
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
