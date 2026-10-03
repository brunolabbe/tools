---
id: dl-71
tool: downloader
title: Create the downloader's Turnstile widget from the Cloudflare setup script
kind: work-package
status: done
milestone: M5
depends_on: [dl-50]
difficulty: standard
---

# dl-71 — The Turnstile widget, as a call instead of a dashboard click

**Packages:** none in `tools/downloader` — `scripts/cloudflare-setup.mjs`, its
test, `.env.prod.example` and `docs/02-DEPLOYMENT.md`.

## Why

[dl-50](./dl-50-a-human-check-without-an-account.md) ships the human check
**off**. It runs only when the host's `.env` carries `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY`, and those come from a Turnstile widget that someone
creates in the Cloudflare dashboard. [dl-49](./dl-49-open-without-a-login.md)
step 4 makes that the precondition for taking the login off: with the keys
unset, removing Access opens the service with no check at all.

The owner asked on 2026-09-22 for help with that step. The rest of the
Cloudflare half of a deployment is already executable: `scripts/cloudflare-setup.mjs`
creates the tunnel's hostnames, DNS and Access applications, plans by default,
writes only with `--apply`, and never deletes. The widget is the last dashboard
click the downloader's deployment needs, and it fits the same shape. Cloudflare's
API creates one with `POST /accounts/{account_id}/challenges/widgets`, taking a
name, a list of domains and a mode, and answering with the site key and secret.

## Decision — answered 2026-09-22 by the owner, not open

**D1 (a)** and **D2 (a)**, both the recommendation: the same
`CLOUDFLARE_API_TOKEN` gains `Account · Turnstile · Edit`, and `--apply` prints
the site key and the secret once, as `.env` lines to paste, writing nothing to
disk. The options as they were put:

**D1. Which token creates the widget.** The script's header lists exactly three
permissions for `CLOUDFLARE_API_TOKEN` and says a token with more "is a token
doing more than this".

- **(a) Recommended: add `Account · Turnstile · Edit` to that same token**, and
  to the header's list. One token, one script and one run, and the header stays
  true because the script now does one more thing.
- (b) A second variable, used only by this step and optional: without it the
  step is skipped, with a line saying so. Keeps the existing token as narrow as
  it is today, at the cost of a second token to create and rotate.

**D2. Where the secret goes.** The API hands the secret back on creation. It is a
credential: the site key is public, and the secret belongs only in the host's
`.env`.

- **(a) Recommended: print the site key and secret once, on `--apply`**, with the
  two `.env` lines ready to paste, and write nothing to disk. The script has never
  written a file, and a secret in terminal scrollback is the owner's to manage,
  the same as the token they exported to run it.
- (b) Append both lines to the host's `.env` directly. One less paste, but the
  script becomes a writer of a credential file. An agent could then never run or
  test the write, because reading a real `.env` is denied here.
- (c) Print only the site key, and have the owner copy the secret from the
  dashboard. Nothing sensitive is printed, and the owner is back in the dashboard
  for half of the step.

## Build

1. **`TOOLS`** gains an optional `turnstile` field on the downloader's entry
   (widget name, mode `managed`), so the planner's entry, which has no check,
   is unchanged by construction.
2. **A `planTurnstile` step**, pure and exported like `planAccess`: given the
   account's existing widgets and the desired one, report _create_ or
   _already present_. It is additive and refuses rather than overwrites, like the
   rest of the file: a widget with the same name whose domains differ is a
   conflict with an exit code, never an edit.
3. **`--apply` creates it** and hands over the keys per D2. Plan mode shows the
   widget it would create and never calls the create endpoint.
4. **Re-running reports nothing to do.** Whether the API returns an existing
   widget's secret on a later `GET` is not measured. If it does not, a lost
   secret means rotating it in the dashboard, and the docs say so.
5. **`scripts/test/cloudflare-setup.test.ts`** covers the plan: create when
   absent, nothing when present, a conflict when the domains differ, and the
   planner's entry producing no widget. Use fixtures, never the live API.
6. **Docs:** the script's header (the token's permissions, per D1),
   `docs/02-DEPLOYMENT.md` beside its other Cloudflare steps, and
   `.env.prod.example`'s dl-50 section pointing at the command.

## Done when

- Against fixtures: plan mode proposes the widget, `--apply` creates it once, and
  a second run proposes nothing. A differing widget of the same name is a refusal
  with a non-zero exit.
- The planner's entry produces no widget.
- The keys are handed over as D2 decides, and no test, fixture or log line
  contains a real secret.
- `npm run check` and `npm test` are green.
- Run by the owner against `oludoi.com`: the widget exists for
  `downloader.oludoi.com`, and with the keys in the host's `.env`,
  `GET /api/config` answers a `siteKey`. That is dl-49's step 4, done this way.

**Serialise with dl-49**, whose step 1 edits the same `TOOLS` array in the same
file. Either order works, but they must not run concurrently.

## Review

**Gate: CONCERNS** — 2026-10-02 · `24acb04...3074307` · code-review at medium (the dispatch named no depth) · reviewed on Claude Opus 5.5 · branch-introduced coordinates re-resolved at `f2d9572`; `origin/main` was still `24acb04` after the fetch

Re-issued at `f2d9572` with words, rows and verdicts unchanged: the citations whose claims the second round corrected — the exit-code row, `docs/02-DEPLOYMENT.md` lines 256 and 278, and `scripts/cloudflare-setup.mjs` lines 472, 588 and 607 — are prose naming `3074307`, the sha this section gated, and the conflict row now anchors on the test title, because its assertion text also occurs in a process test since `ca5bff7`.

| Done when                                                             | Proof                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan mode proposes the widget                                         | `scripts/test/cloudflare-turnstile.test.ts:212 "turnstile downloader (managed) for"` ✓ — mutant `if (!args.apply)` to `if (false)` fails 1 of 26                                                                                                                                                                                       |
| `--apply` creates it once                                             | `scripts/test/cloudflare-turnstile.test.ts:222 "POST /challenges/widgets"` ✓                                                                                                                                                                                                                                                           |
| A second run proposes nothing                                         | `scripts/test/cloudflare-turnstile.test.ts:231 "turnstile downloader (downloader.example.com)"` and `scripts/test/cloudflare-turnstile.test.ts:234 "toHaveLength(written)"` ✓ — mutant that never matches an existing widget fails 4 of 26                                                                                             |
| A differing same-name widget is a refusal                             | `scripts/test/cloudflare-turnstile.test.ts:237-245 "with different domains refuses, and nothing is written"` ✓ — mutants: conflict pushed to `ok` fails 2 of 26; turnstile conflicts left out of the count fails 1 of 26                                                                                                               |
| … with a non-zero exit                                                | **verified**, not asserted — run as a process, exit 1; mutant `process.exit(1)` to `process.exit(0)` at line 607 of `scripts/cloudflare-setup.mjs` at `3074307` leaves 26 of 26 green. Med below                                                                                                                                       |
| The planner entry produces no widget                                  | `scripts/test/cloudflare-turnstile.test.ts:50 "without).widgets).toEqual([])"` ✓ — mutant giving the planner a `turnstile` field fails 3 of 26                                                                                                                                                                                         |
| Keys handed over as D2 decides                                        | `scripts/test/cloudflare-turnstile.test.ts:93 "expect(envLines({ sitekey"` ✓ and `scripts/test/cloudflare-turnstile.test.ts:220 "const first = await runSetup"` (lines 223–224 assert both `.env` lines) ✓ — mutant dropping the secret line fails 2 of 26; writes nothing: the script has no import at all, so no file API — verified |
| No test, fixture or log line holds a real secret                      | **verified** — the only key strings in the diff are `0xFAKE-…`; no snapshot; the create answer has one consumer, traced below                                                                                                                                                                                                          |
| `npm run check` and `npm test` green                                  | **verified** — check exit 0; `npm test` 3731 passed, 2 skipped of 3733 in 199 files; `cloudflare-setup.test.ts` 17 of 17 at base and at head, the new suite 9 of 9; no existing test file touched                                                                                                                                      |
| Owner run against `oludoi.com`, `GET /api/config` answers a `siteKey` | **unproven (gate)** — needs the owner token and the live API; the container firewall blocks it and the ticket forbids it                                                                                                                                                                                                               |

- **API shape** — confirmed, none contradicted, none unfindable, against Cloudflare published OpenAPI (`cloudflare/api-schemas` `openapi.json` on `main`, fetched 2026-10-02) and the official SDK `cloudflare@7.2.0` (`src/resources/turnstile/widgets.ts`): list and create are both `/accounts/{account_id}/challenges/widgets`; create requires `name`, `mode`, `domains`; `mode` admits `managed`; the create result carries `sitekey` and `secret`; list items carry `sitekey`, `name`, `domains` and no `secret`; `per_page` is min 5, default 25, max 1000.
- **Secret trace** — the create answer is bound once, at `scripts/cloudflare-setup.mjs:590 "const created = await call(token, WIDGETS"`, and read once, by `envLines`, whose two strings go only to stdout. A failed call throws a message built from method, path, status and `errors[]`, never `result`; `envLines` throws a message carrying no field of the widget; `planTurnstile` copies only `sitekey` from a listed widget. Found by `grep -n created`, `grep -c envLines(` (2: definition and one call) and the two widget call sites from `grep -n WIDGETS`.
- **med** · The non-zero exit on refusal has no test. The refactor moved `process.exit(1)` from `fail` to the entry point, and neither Cloudflare suite runs the script as a process, so the exit-0 mutant above is green. The repo project says the exit code is the contract: `vitest.config.ts@24acb04:38 "argument parsing and the exit code are the contract"`. Measured by hand with a fake `fetch` preloaded through `node --import`: a same-name conflict, a 403 on the widget list, and an empty token each exit 1, and the two with `--apply` record no write.
- **low** · `docs/02-DEPLOYMENT.md` line 278 at `3074307`, "Lose the secret and you rotate it", and the two lines after it, call a later read of the secret unmeasured. The published OpenAPI answers it: `GET /accounts/{account_id}/challenges/widgets/{sitekey}` lists `secret` among the required fields of its result. Only the list omits it, so the script is right not to need it, but rotation is not the only way back, and the Log repeats the unmeasured claim.
- **low** · `docs/02-DEPLOYMENT.md` line 256 at `3074307` says the stop comes before any write; the test for it runs in plan mode and asserts no write list. It holds because every read precedes the apply loop, and a process run with `--apply` and a 403 recorded no write.
- **low** · The `.catch` on the widget list, after line 472 of `scripts/cloudflare-setup.mjs` at `3074307`, appends the missing-permission hint to every failure of that read — a 5xx, a refused connection, a 400 — not only a 401 or 403. The original message is kept, so it misleads rather than hides.
- **low** · The heading at line 588 of `scripts/cloudflare-setup.mjs` at `3074307` prints before `envLines` validates, so a create answer with no secret prints the heading and then the error. Measured by process. Cosmetic.
- **low** · open decision, in the report · The branch repoints two `scripts/cloudflare-setup.mjs` citations in the merged pl-2 record (its lines 164 and 178) to bare head lines. Unpinned, they move again on the next edit to the script, and dl-49 edits the same `TOOLS` array. CI does not need them: with pl-2 restored to its base text, `citations-gate.mjs --against 24acb04` still exits 0, the two reported as moved, not failed. The edit puts a `tools/planner` path in the diff.
- **title** · `preflight.mjs --base origin/main` at `3074307`: `feat(downloader): …` exits 8, the title check, because every `tools/` path in the diff is markdown (the dl-71 ticket and the pl-2 record); `chore(repo): …` exits 0, every check ok.
- **dropped** · Cloudflare widget names are not unique, so a widget a person made by hand for the same hostname under another name gets a second widget beside it. The brief chose matching by name (Build 2), and a second widget is harmless. A product choice, not a defect.
- **dropped** · The dl-52 brief, option B, still says "a fourth permission". That option was answered A on 2026-09-28, and the Log names it. Historical text.
- **dropped** · `widgetList.length >= PER_WIDGETS` refuses at exactly 1000 widgets. Conservative and harmless.
- **findings** · code-review at medium returned 9; 6 carried (med 1, low 5), 3 dropped.
- NFR: security ✓ (secret to stdout only, one consumer) · performance n/a · reliability — the med and the `.catch` low · maintainability — the pl-2 repoint.

## Log

- 2026-09-22 — Filed at the owner's request while dl-50 was in review, to help
  create the Turnstile widget. Nothing measured against the live API: the script's
  token is not available to an agent, and reading a real `.env` is denied.
- 2026-09-22 — The owner answered D1 (a) and D2 (a). Moved to `ready`.
- 2026-10-02 — Built (Claude Sonnet 5.5, base `24acb04`), D1 (a) and D2 (a) as
  answered. Against fixtures only; **nothing was run against the live Cloudflare
  API**.
  - **Plan, apply and re-run, through the real `main`.** `main` is now exported
    with its argv and environment as parameters, and `fail` throws a `CliError`
    that the entry point turns into the exit code, so a test can drive a whole
    run against a fake `fetch`. `npx vitest run scripts/test/cloudflare-turnstile.test.ts`
    → `Tests  9 passed (9)`; `scripts/test/cloudflare-setup.test.ts` →
    `Tests  17 passed (17)`, unchanged. Plan mode makes no write call
    (`account.writes` is `[]`); `--apply` makes exactly one
    `POST /challenges/widgets` and prints the two `.env` lines; a second run
    prints `ok       turnstile downloader (downloader.example.com)` and
    `nothing to do.` and writes nothing; a same-named widget guarding
    `other.example.com` throws `CliError` ("1 conflict(s)") with no write.
  - **Red first.** Replacing the domain comparison in `planTurnstile` with
    `else if (true)` failed 2 of 26 (the pure conflict case and the `main`
    refusal); replacing `if (!args.apply) {` with `if (false) {` failed 1 of 26
    (plan mode proposes and never creates). Restored, 26 of 26.
  - **The secret.** Printed once, to stdout, by `envLines`, and written nowhere.
    A create response with no `secret` throws instead of printing an empty
    `TURNSTILE_SECRET_KEY=`. The fixtures' keys are `0xFAKE-…` strings made up
    for the test.
  - **Not measured against the live API, and the script does not depend on it:**
    whether the real `GET /accounts/{id}/challenges/widgets` list, or a GET of one
    widget by site key, returns `secret`. The fake's list leaves it out, so the
    re-run is proven not to need it. (Corrected by gate 1, 2026-10-02: Cloudflare's
    published OpenAPI document,
    `raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json` read
    2026-10-02, lists `secret` among the required fields of the result of
    `GET /accounts/{account_id}/challenges/widgets/{sitekey}` and omits it from the
    list. That is the document, not the live API: still not measured there.) The
    list's `per_page` ceiling of 1000, the create body's `name`/`domains`/`mode`
    and the `sitekey`/`secret` fields of its answer were taken from memory of
    Cloudflare's API reference when built (the docs site is not reachable from
    here); gate 1 later confirmed all of them against the published OpenAPI and the
    `cloudflare` SDK, which is still not the live API. The first live `--apply` is
    the check; a wrong field name fails loudly there (`envLines` throws), not
    silently.
  - **The brief had wrong or left open:** (1) Build 5 says the tests go in
    `scripts/test/cloudflare-setup.test.ts`; they are in a new
    `scripts/test/cloudflare-turnstile.test.ts`, because the import list of the
    existing file would have moved `:63`, `:87` and `:270`, which
    `pl-2-container-image.md` cites. (2) "`--apply` creates it once, a second run
    proposes nothing" cannot be shown against the pure planners; it needed `main`
    to be callable, which the brief did not name. (3) A token made before this
    change has no Turnstile permission and the list read fails; that is now a
    message naming `Account · Turnstile · Edit` and stops before any write,
    rather than a bare 403 on a script that had not otherwise changed.
  - **Citations.** The header and the widget code moved `cloudflare-setup.mjs`
    lines that `tools/planner/docs/work/pl-2-container-image.md` cites;
    `:117` → `:127` and `:257` → `:329` repointed there, coordinate only. That is
    a `tools/planner` path in this branch: see the pull request type.
  - **Folded in:** nothing. Could have folded: `dl-52`'s brief still says the
    token has "three permissions", which is now four. Not done because that
    ticket is unbuilt and its line quotes the header's own closing words, which
    are unchanged; it is for whoever builds dl-52 to see.
- 2026-10-02 — Gate 1's findings applied by the fixer (Claude Sonnet 5.5), no
  ship authority, no gate record committed.
  - **The exit code now has a test.** Two cases in
    `scripts/test/cloudflare-turnstile.test.ts` start the script as a process
    (`spawnSync`, argument array, `shell: false`) with
    `scripts/test/fixtures/cloudflare-fake-fetch.mjs` preloaded by `--import`, and
    assert exit 1 and no write under `--apply` for a same-named widget guarding
    another domain and for a 403 on the widget list. With the entry point's
    `process.exit(1)` made `process.exit(0)` both fail (`expected +0 to be 1`);
    restored, they pass.
  - **The permission hint is for a 401 or a 403 only.** `call` now carries
    `status` on the error it throws; any other failure of the widget list
    propagates as it was, unhinted. Tested both sides, and the 401 and 403 cases
    run under `--apply` and assert an empty write list. The heading "Paste these
    two lines" prints after `envLines` validates, so a create answer with no
    secret is an error and no heading.
  - **Decisions the owner made on 2026-10-02**, both the gate's recommendation:
    the pull request title is
    `chore(repo): create the Turnstile widget from the Cloudflare setup script (dl-71)`,
    not `feat(downloader)`, which preflight rejects because every path under `tools/` in this branch is markdown; and
    the two `scripts/cloudflare-setup.mjs` citations in
    `tools/planner/docs/work/pl-2-container-image.md` are pinned at `24acb04`
    (lines 117 and 257 there), not repointed to bare head lines, which would
    move again on the next edit to the script. That supersedes the repoint to
    `:127` and `:329` recorded above.
  - **Gate 2's three findings.** The entry guard is now
    `process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href`
    (the form `scripts/commit-message.mjs` uses), so the process tests do not
    depend on the Windows-broken `file://` concatenation. Shown on Linux with a
    script in a directory whose name has a space: before, exit 0 and no output;
    after, exit 1 and the permission message. Not shown through a symlink: there
    `argv[1]` is the link and `import.meta.url` the real path, so the guard
    mismatches before and after. The child process now gets `...process.env` with
    the test's overrides on top, as `scripts/test/agent-cost.test.ts` does, and the
    stale sentence about unmeasured fields above is corrected. Windows itself was
    not run.
  - **Gate 3's two lows.** A process case at the end of
    `scripts/test/cloudflare-turnstile.test.ts` copies the script into a temp
    directory named `cf setup …` (a space), runs it with an empty token and
    expects exit 1 and `CLOUDFLARE_API_TOKEN is not set`. With the guard reverted
    to `file://${process.argv[1]}` it failed (`expected '' to contain
'CLOUDFLARE_API_TOKEN is not set'`, 1 of 14); restored, 31 of 31 across the two
    Cloudflare suites. The guard's comment no longer implies the fix covers a
    symlink: it says a space or a %-encoded character reproduces the mismatch on
    Linux and a symlink still mismatches.
