---
id: dl-126
tool: downloader
title: With no Turnstile keys the downloader serves probes with the human check off, in production too
kind: fix
status: ready
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

**Answered by the owner on 2026-10-17: Decision 1, option 1 (an explicit
setting); Decision 2, option 1 (refuse at boot).** The setting was offered as
`REQUIRE_HUMAN_CHECK=true`, and that is its name. The options below are kept as
they were asked.

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

Both decisions are answered (above): `REQUIRE_HUMAN_CHECK`, refused at boot.
Step 3's option 2 and Decision 2's contract question no longer apply.

1. **Decisions recorded** on 2026-10-17, in their own commit.
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
- 2026-10-17 — Owner answered both decisions through `AskUserQuestion`, each
  asked with its options as written above, the recommended one first. Decision
  1: option 1, an explicit setting, offered as `REQUIRE_HUMAN_CHECK=true` set in
  `compose.downloader.prod.yaml`. Decision 2: option 1, refuse at boot with
  `AppError("INTERNAL")` naming the missing variables. `status: ready`. #496 has
  merged (`78b188fc`), so Build step 6's ordering constraint is met.
- 2026-10-17 — Built (branch `dl-126-fail-closed`, from `8e50f0d4`). Build step 1
  was already done by the filing's own Log entry above (merged in #502), so no
  separate decisions commit.
  - **Code.** `config.ts`: `turnstile()` takes a third argument and, with neither
    key and the setting on, throws `AppError("INTERNAL", "REQUIRE_HUMAN_CHECK is
set, but TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are not.")` with a hint
    naming both and the opt-out. It sits on the environment branch only; the
    `"turnstile" in overrides` branch is untouched, which a test pins
    (`loadApiConfig({ turnstile: undefined }, { REQUIRE_HUMAN_CHECK: "true" })`
    stays `undefined`). `human-check.ts` is unchanged (Decision 2, option 1).
  - **Parsing differs from `bool` on purpose.** `requireHumanCheck()` reads blank
    and `0/false/no/off` as unset and **everything else as set**, where `bool`
    falls back to the default on a word it does not know. For this setting the
    default is the check off, so a typo (`ture`) through `bool` would be the
    failure the ticket exists to prevent. A test pins `ture` as a refusal.
  - **Compose line is `${REQUIRE_HUMAN_CHECK:-true}`, not a literal `true`.** The
    brief says "set in `compose.downloader.prod.yaml` beside the two keys"; a
    literal would leave a self-hoster behind Access, who runs this file with no
    keys, with no way to start except editing the shipped file. The default is
    on, so the public host that omits the line is closed; the opt-out is
    `REQUIRE_HUMAN_CHECK=false` in `.env`. **Consequence for the owner's own
    host:** it runs this file with empty keys today, so on its next pull of an
    image carrying this change it does not start until both keys are in `.env`
    (or it opts out). That is the intended fail-closed behaviour, and it lands
    after #496.
  - **Red then green.** Tests added at the end of `describe("the settings")` in
    `human-check.test.ts` (four, so the existing ones keep their lines). Before
    `config.ts` changed, `npx vitest run tools/downloader/api/test/human-check.test.ts`:
    `Tests 1 failed | 17 passed (18)`, the failure `REQUIRE_HUMAN_CHECK with
neither key refuses to boot, naming the variables` with `expected
[Function] to throw an error`. After: `human-check.test.ts`, `terms-page.test.ts`
    (reads the compose file) and `config.test.ts` together, `Tests 32 passed (32)`.
    The other three new tests pass on the old code by design: they pin that the
    open default, the both-keys path, the override path and the no-leak rule did
    not move.
  - **Docs.** `.env.example`, `.env.prod.example`, `compose.downloader.prod.yaml`
    (its header and the line), `docs/01-ARCHITECTURE.md` (the `TURNSTILE_SITE_KEY`
    row, a new `REQUIRE_HUMAN_CHECK` row, and the prose paragraph on the human
    check), `docs/02-DEPLOYMENT.md` (step 2's bullet, the setup-script section's
    ordering paragraph, and step 4). Build step 6 names `docs/02-DEPLOYMENT.md`
    under the tool's docs; it is the repo-wide file at the root, which the brief
    had slightly wrong, and it is edited here as that file.
  - **Not folded in.** Adding dl-126 to dl-49's `depends_on` is an edit to a
    ticket that is `in-flight` and was left alone
    by the filing; not done here. Done when 8 (a container built and run) was not
    run: it is a container build and no gate was asked for one on this machine,
    so it stays `unproven (gate)`.
- 2026-10-17 — Round 1, after gate 1 (Opus 5.5, `8e50f0d4..f2c343d9`, FAIL). The
  owner answered each open decision through `AskUserQuestion` on 2026-10-17, from
  the options the gate and the builder offered:
  - **F1** (Done when 5): "Spawn test over real stderr", over rewording the Done
    when line. A test now spawns the real `main.ts`.
  - **F2** (upgrade and rollback): "Upgrade note only", over also marking the title
    breaking (`fix(downloader)!:`). The title stays non-breaking; the notes are in
    `docs/02-DEPLOYMENT.md`, "Updating and rolling back".
  - **Compose default**: "Overridable :-true + fix hints", over a literal `"true"`.
    `${REQUIRE_HUMAN_CHECK:-true}` stays, and F3 is fixed in this round.
  - **F1, done.** `human-check.test.ts`, "main.ts, spawned with
    REQUIRE_HUMAN_CHECK on, exits 1 and writes a refusal with no key value":
    four env shapes, `node --import tsx api/src/main.ts`, `shell: false`, asserts
    exit 1, `"msg":"failed to start"`, `"code":"INTERNAL"`, the missing variable
    names, and neither Cloudflare test key anywhere in stdout or stderr. Proven
    able to fail: with the one-key message mutated to print `rawSecretKey`, it
    went red (`expected '{"level":"error","time":… not to contain
'1x0000000000000000000000000000000AA'`) along with two in-process tests.
    **Cost:** green it is about 2 s for the four spawns together. Against the old
    `config.ts` the same test takes 45 s and fails, because the process starts and
    listens until the test's own kill timer fires.
  - **F2, done.** Two paragraphs after "Rolling back is the same three commands":
    upgrading past dl-126 stops a host with no keys (both keys in, or
    `REQUIRE_HUMAN_CHECK=false`; an unset or blank entry does not opt out; do it
    before the pull that moves the tag), and rolling back past it reopens a
    keyless host.
  - **F3, reproduced and fixed.** `compose-matrix.sh` from gate 1, `docker compose
config` over the three-file stack: `unset` and `blank` both give
    `REQUIRE_HUMAN_CHECK: "true"`, `false`, `false` with a trailing space, quoted
    and with a trailing comment give `"false"`, and `0` gives `"0"`. Both boot
    hints now say `REQUIRE_HUMAN_CHECK=false` and leave both keys empty, the
    one-key hint only when the setting is on (without it, "unset both" is still
    right); the compose comment, `.env.example` and the ARCHITECTURE row say that
    under the compose default only an explicit `false` opts out. A test pins both
    hints. That matrix is also the first time the compose edit was parsed; round 0
    reported it unmeasured.
  - **F4, reproduced and fixed.** The no-key leak assertion ran inside a bare
    `try`/`catch`, so a throw that never came passed it. A `refusalFor()` helper
    fails the test when `loadApiConfig` does not throw. Proven: against the base
    `config.ts` the rewritten test went red where the old one could not.
  - **F5, the gate is right.** Round 0's "1 failed | 17 passed" was measured
    before I added the `ture` assertion to "unset or off leaves the open
    default", and the entry above was not updated. Against the base `config.ts` the
    final spec gives, with the round's tests included, `Tests 5 failed | 15 passed
(20)`; of round 0's four tests, two fail on the old code (the Done when 1
    test, and "unset or off" on its `ture` line) and two pass (the both-keys test, and the old leak test, which is F4). Round 0's
    figure above stands as a record of the earlier state.
- 2026-10-17 — Fixed at landing by owner choice: gate 2, F7 — "the upgrade note
  says 'Do this **before** the `docker compose pull` that moves the tag, or expect
  the outage between the pull and the edit'. `pull` does not recreate the
  container; the outage starts at the `docker compose up -d` that follows", fixed
  as "between the `up -d` and the edit". `grep -n "outage between"
docs/02-DEPLOYMENT.md` → `685:outage between the `up -d` and the edit.` F6
  (the spawn test's single `SIGKILL` after 45 s on its regression path) is
  recorded and left unfixed, by the same owner choice.
