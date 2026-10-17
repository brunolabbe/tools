---
id: dl-126
tool: downloader
title: With no Turnstile keys the downloader serves probes with the human check off, in production too
kind: fix
status: needs-decision
milestone: M5
depends_on: []
difficulty: standard
---

# dl-126 — With no Turnstile keys the downloader serves probes with the human check off

## Why

The human check is what stands in for the login that
[dl-49](./dl-49-open-without-a-login.md) removes. It is on only when the host's
environment carries both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
([dl-50](./dl-50-a-human-check-without-an-account.md)). Nothing in the API refuses
to run without them when it is deployed as the public instance, so a host whose
keys are absent serves probes and jobs with no check at all. That is documented
as intended for a self-hoster behind Access, and it is the wrong default for the
one host that is public.

**Measured on `origin/main` at `76ce7d52`**, the code facts that make it so:

- `tools/downloader/api/src/config.ts:487`:
  `if (siteKey === "" && secretKey === "") return undefined;`. Blank or missing
  keys are the same as unset, and unset is a valid configuration with no error.
- `tools/downloader/api/src/human-check.ts:118`: `if (turnstile === undefined) {`,
  whose branch returns `siteKey: null` and `require: async () => {}`. No network
  call, no refusal.
- `tools/downloader/api/src/routes/probe.ts:56` and
  `tools/downloader/api/src/routes/jobs.ts:53` call
  `context.humanCheck.require(...)` before any work, so with no check configured
  both routes pass straight through.
- `tools/downloader/api/src/config.ts:300-306`, the field's own comment: "with
  neither, no token is asked for, which is every deployment before dl-50 and the
  right answer for a self-hoster behind Access". `.env.example` lines 250-256 and
  `docs/01-ARCHITECTURE.md` line 248 say the same.
- `tools/downloader/Dockerfile:142` sets `ENV NODE_ENV=production`, so every
  operator who runs the image is in production by that variable's name. `git grep
NODE_ENV` under `tools/downloader` finds that line and nothing that reads it.
- `compose.downloader.prod.yaml:108-109` passes both keys through as
  `"${TURNSTILE_SITE_KEY:-}"` and `"${TURNSTILE_SECRET_KEY:-}"`, so a host whose
  `.env` lacks them starts with empty strings, which the loader reads as unset.

The existing test that pins the open default is
`tools/downloader/api/test/human-check.test.ts`, "both keys turn the check on, and
neither leaves it off", which asserts `loadApiConfig({}, {}).turnstile` is
`undefined`. A fix changes what that test asserts for production only.

Measurement, a scratch script (not committed) that imports `loadApiConfig` and
`createHumanCheck` from the worktree at `76ce7d52` with both keys absent, run as
`node empty-keys.mts <worktree>`:

```
loadApiConfig({}, {}).turnstile = undefined
siteKey on GET /api/config = null
require(undefined) resolved: the request proceeds with no token
network calls to siteverify: 0; warn lines logged: 0
```

**The gap that surfaced it.** dl-49's gate 1 (Opus 5.5, 2026-10-16) on draft
pull request #496, finding F1, reports that the setup script routes the
downloader before its Turnstile widget exists. The widget is the only guard the
downloader would have, and it guards nothing until a person pastes the keys into
`.env` and restarts the container. The gate's script `widget-fails.mts`, which
lives in the gate's scratch and not in the repo, runs `--apply` on a fake account
whose widget `POST` answers 500. The builder re-ran it on PR #496's current head,
`fa94651d`, which the gate did not review (the gate reviewed `34fcfac1`, and
`fa94651d` descends from it). The writes, in order, and the summary line:

```
POST /access/apps planner.example.com
POST /access/apps ledger.example.com
PUT /cfd_tunnel/abc/configurations
POST .../dns_records downloader.example.com
POST .../dns_records planner.example.com
POST .../dns_records ledger.example.com
POST /challenges/widgets
error: POST /accounts/A/challenges/widgets -> 500 (no detail)
downloader routed with no Access app and no widget: true
```

The text fix on #496 documents that order. This ticket is the code half: a
production instance that has no keys refuses probes and jobs, and does not serve
them with the check off. It closes the window only for a host that runs an image
carrying the change. A host whose container runs an older image with no keys
stays open until it is redeployed, and no code change reaches it sooner.

## Decision

Two open decisions. The builder does not settle either: the first commit on this
branch records the owner's answer on this ticket and sets `status: ready`, and
only then is there anything to build.

### Decision 1 — what "production" means

1. **An explicit setting**, named by the owner, set in
   `compose.downloader.prod.yaml` beside the two keys, and read by
   `loadApiConfig`. _Recommended._ It is the only option that names the public
   instance and not every operator who runs the image. Cost: a new variable, in
   `.env.example` and the settings table in `docs/01-ARCHITECTURE.md`. A host that
   runs its own compose file without the line stays open, which is the same
   omission one level up; the shipped file is the one place to get it right.
2. **`NODE_ENV === "production"`**, which the image already sets
   (`Dockerfile:142`). Cost: the image sets it for every operator, so a
   self-hoster behind Access who runs the image without keys is refused as well.
   The documented "right behind a login" case then needs an opt-out, and the API
   gains its first read of `NODE_ENV`.
3. **No production mode**: refuse with no keys for every deployment, with an
   explicit opt-out for a self-hoster behind Access. Cost: it changes the
   documented pre-dl-50 behaviour for every existing deployment on its next
   restart, and it has the widest blast radius of the three. The test helper
   `tools/downloader/api/test/helpers.ts` (around line 249) passes
   `turnstile: undefined` to keep its suites off the check; they would keep
   passing, but only because they override it.

### Decision 2 — what a refusal looks like

1. **Refuse at boot**, the way the one-key case already does
   (`config.ts:488-495`, `AppError("INTERNAL")` naming the missing variable).
   _Recommended._ It reuses a refusal the codebase already has, and needs no new
   code. Cost: on a host with the setting and no keys, a restart does not start
   the service, and the failure shows in the container log, not as a `403` to a
   visitor.
2. **Boot, and refuse each probe and job** with no keys. `/api/config` answers
   `siteKey: null`, so the page renders no widget and every visitor is refused
   with `HUMAN_CHECK_FAILED` (403). Cost: the visitor is told the human check
   failed when the fault is the operator's. A dedicated code would be a change to
   `tools/downloader/contract`, which the owner has to approve, and the contract
   is not something a builder edits.

## Done when

1. With the production setting (Decision 1) and neither key, the API does not
   serve a probe or a job: the boot refuses (Decision 2, option 1), or a probe and
   a job with no token are both refused (option 2). A test in
   `tools/downloader/api/test/human-check.test.ts` proves it, and it fails on
   `76ce7d52` first, as the measurement above shows.
2. Without the production setting and with no keys, the open default is unchanged,
   and `human-check.test.ts`'s "both keys turn the check on, and neither leaves it
   off" still passes.
3. With both keys set, `POST /api/probe` with no token answers `403`
   `HUMAN_CHECK_FAILED`, as the existing suite asserts.
4. One key without the other still refuses to boot, naming only the missing
   variable, as the existing "one key without the other refuses to boot" test
   asserts.
5. A refusal, if one is logged, names the variable and never a key value; a test
   over captured logger output proves neither key appears.
6. `.env.example`, `docs/01-ARCHITECTURE.md` (the settings table) and
   `docs/02-DEPLOYMENT.md` name the production setting and what it refuses. No
   sentence still says "right behind a login" without saying which setting makes
   that true.
7. `npm run check` and `npm test -- --project downloader` are green.
8. A container built from the branch, started with the production setting and no
   keys, does not serve a probe. The proof is a container run, which no unit suite
   gives, so the gate reads it as `unproven (gate)` unless somebody runs it.

## Build

Not to be started until Decision 1 and Decision 2 are answered.

1. **First commit:** write the owner's answer on this ticket, with who gave it,
   the date and the options it was chosen from. Set `status: ready`, and nothing
   else in the commit.
2. **`tools/downloader/api/src/config.ts`**: read the production setting in
   `loadApiConfig`, next to the Turnstile read at around line 630. Trap: the
   `"turnstile" in overrides` branch (around line 628) is how tests turn the check
   off on purpose. A production rule must apply to the environment path, not
   override it, or the suites that pass `turnstile: undefined` start refusing.
3. **For Decision 2, option 1:** extend `turnstile()` (around line 480) so that
   production with both keys empty throws `AppError("INTERNAL", …)`, with the same
   hint shape as the one-key case. **For option 2:** extend `createHumanCheck`'s
   no-check branch (`human-check.ts` around line 118) to refuse in production,
   with `HUMAN_CHECK_FAILED` or the code the owner chose.
4. **Tests:** add the cases at the end of the `describe("the settings", …)` block
   in `human-check.test.ts`, not in the middle of the file, so existing test
   citations stay where they are.
5. **Compose:** set the production setting in `compose.downloader.prod.yaml`
   beside lines 108-109.
6. **Docs:** `.env.example` lines 250-261, the row at
   `docs/01-ARCHITECTURE.md` line 248, and the sections of `docs/02-DEPLOYMENT.md`
   that dl-49's PR #496 rewrites. Land this after #496 merges, so the two do not
   edit the same paragraph.

## Log

- 2026-10-17 — Filed from dl-49's gate 1 (Opus 5.5, 2026-10-16) on PR #496,
  finding F1. The owner was asked on 2026-10-16 whether to file it, with options
  "File a dl- ticket" and "Don't file", and chose to file. Measured at
  `76ce7d52` as in Why. Re-ran the gate's `widget-fails.mts` on PR #496's head
  `fa94651d`: the summary line still reads `downloader routed with no Access app
and no widget: true`.
- 2026-10-17 — `depends_on` is empty on purpose. dl-49's step 5 removes the
  Access application, and this fix has to land before that step. `depends_on:
[dl-49]` would block the fix until the gap is already open. dl-49's own
  `depends_on` does not list this ticket; adding it is an edit to dl-49's file on
  PR #496, which this filing does not make.
- 2026-10-17 — `kind: fix`, because the open default is a hole in the production
  path, not a feature gap. Milestone M5, the milestone of dl-49 and dl-50.
  `difficulty: standard`, rated on the work once the decisions are answered: it
  mirrors the one-key refusal and its test. The rating is the filer's, and `hard`
  is the alternative if the owner prefers the boot path, since it changes how the
  whole service starts.
