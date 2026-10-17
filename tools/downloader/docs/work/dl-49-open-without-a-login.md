---
id: dl-49
tool: downloader
title: Take the login off downloader.oludoi.com, once an anonymous visitor cannot spend the host
kind: work-package
status: in-flight
milestone: M5
depends_on: [dl-50, dl-51, dl-52, dl-53, dl-54, dl-57, dl-58, dl-60]
difficulty: standard
---

# dl-49 — Open the downloader without a login

**Packages:** none in `tools/downloader` — `scripts/cloudflare-setup.mjs` and its
test, `docs/02-DEPLOYMENT.md`, `SECURITY.md`, and one Cloudflare dashboard change
that only the owner makes.

## Why

**The owner's decision, 2026-09-13: the downloader goes public, and visitors are
not made to log in.** Today `downloader.oludoi.com` sits behind a Cloudflare
Access application that allows one address, with a Bypass on `api/files/*` so
download links stay shareable.

[02-DEPLOYMENT.md](../../../../docs/02-DEPLOYMENT.md) makes the app's own
authentication the precondition for removing that application ("When you want it
genuinely public"). That precondition is the one this decision rejects, so it is
replaced rather than met: dl-50 through dl-54 are what stands in
for a login. Each answers one way an anonymous visitor could spend the host —
automation ([dl-50](./dl-50-a-human-check-without-an-account.md)), one client
holding every slot ([dl-51](./dl-51-one-client-holds-every-job-slot.md)),
limits sized for one trusted user
([dl-52](./dl-52-limits-for-anonymous-traffic.md)), copies of unchecked video
kept on the host ([dl-53](./dl-53-finished-files-and-the-tunnel.md), which
streams instead and accepts Cloudflare's terms risk), and what the
operator owes when someone points it at something they should not
([dl-54](./dl-54-terms-takedown-and-what-is-logged.md)).

**The planner is not part of this.** Its Access application stays. The comment
on `TOOLS` in `scripts/cloudflare-setup.mjs` says why: it has no owner model, so
the allowlist is the only configuration in which its data model is coherent.

## Build

1. **`scripts/cloudflare-setup.mjs`** — drop the downloader's `allow`
   application from `TOOLS`, so a later `--apply` does not recreate the login
   the owner removed. The script never deletes, so it cannot remove the live
   application itself, and it must not learn to: that refusal is argued in its
   header. The `api/files/*` Bypass becomes redundant once nothing is gated; it
   goes too (the owner's answer, 2026-10-16, in the Log), so the downloader has
   no Access application at all. Keep `scripts/test/cloudflare-setup.test.ts`
   asserting the downloader's intended shape and the planner's unchanged one.
2. **`docs/02-DEPLOYMENT.md`** — rewrite step 4 and "When you want it genuinely
   public". Step 4 currently says the service "is unsafe without it". It should
   say what makes it safe without a login now (dl-50 through dl-54), and that a
   host that has **not** applied those still needs Access. A reader deploying
   their own copy is the audience.
3. **`SECURITY.md`** opens with "There is no instance run for you and no service
   to attack". That stops being true. Say which instance is public, and that
   reports about it go through the same private channel.
4. **The owner turns the human check on before anything below** (added by dl-50,
   2026-09-22). dl-50 ships the check _off_: it runs only when the host's `.env`
   carries both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`, which
   `compose.downloader.prod.yaml` passes through. So removing Access with them
   unset opens the service with no check at all. Create a Turnstile widget for
   `downloader.oludoi.com` in the dashboard (Managed mode), put both keys in the
   host's `.env`, `docker compose up -d`, and confirm
   `curl -sS https://downloader.oludoi.com/api/config` — from a session Access
   lets through — answers a `siteKey`, not `null`. The owner's, because the
   secret key is a credential no agent should hold.
   [dl-71](./dl-71-create-the-turnstile-widget-from-the-setup-script.md) makes
   the widget a `cloudflare-setup.mjs --apply` rather than a dashboard click.
5. **The owner deletes the downloader's Access application** on the dashboard.
   This is outward-facing and hard to take back quietly, so it is the owner's
   action, not an agent's. The ticket's Log records who did it and when. **Delete
   the live `api/files/*` Bypass application in the same visit**: the script
   never deletes, so it stays until someone does.
6. **The owner turns on Cloudflare Web Analytics for `downloader.oludoi.com`**
   (automatic setup) on the dashboard, in the same sitting as step 5. It counts
   visitors, and [dl-57](./dl-57-a-record-of-how-probes-and-downloads-end.md)
   counts what they do. The beacon runs only because
   [dl-50](./dl-50-a-human-check-without-an-account.md)'s CSP allows it, which
   is one more reason this ticket waits on dl-50. A dashboard toggle, so the
   owner's, for the same reason as step 5.

## Done when

- `curl -sS https://downloader.oludoi.com/api/config` answers
  `{"humanCheck":{"siteKey":…}}`, and a `POST /api/probe` with no
  `humanCheckToken` answers `403` `HUMAN_CHECK_FAILED` — the check is on before
  the login is off (dl-50).
- From outside the host, `curl -sS https://downloader.oludoi.com/api/health`
  returns the API's JSON rather than an Access login page.
- `curl -sS -o /dev/null -w '%{http_code}' https://planner.oludoi.com/` still
  answers `302` to the Access login.
- `node scripts/cloudflare-setup.mjs --domain oludoi.com …` (plan mode) reports
  nothing to do and proposes no downloader `allow` application.
- `scripts/test/cloudflare-setup.test.ts` asserts the new downloader shape and
  the unchanged planner shape.
- `docs/02-DEPLOYMENT.md` and `SECURITY.md` no longer say the instance is private
  or that it needs a login.
- `npm run check` and `npm test` are green.
- Loading `https://downloader.oludoi.com/` in a browser, the document carries
  the `static.cloudflareinsights.com` beacon, the console shows no CSP
  violation, and the Web Analytics dashboard counts the visit. **The violation
  to look for is a `connect-src` one on the beacon's report** (to
  `/cdn-cgi/rum`, expected same-origin): dl-50 left `connect-src 'self'`
  unwidened on the documentation's word and could not measure it, because the
  hostname answered every unauthenticated request with a `302` to Access. If it
  is refused, `cloudflareinsights.com` goes in `connect-src` with its reason
  beside the policy in `api/src/routes/web.ts`.

## Review

**Gate: FAIL** — 2026-10-16 · `76ce7d52..34fcfac1` · Opus 5.5, depth medium · slice: Build 1–3 only, scoped by the orchestrator's dispatch; no request made to `oludoi.com`

| Done when                                                                                                 | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/config` answers a `siteKey`, and `POST /api/probe` with no token answers `403` `HUMAN_CHECK_FAILED` | **unproven (scope)**: the dispatch keeps this slice to Build 1–3 and forbids live requests. It lands with the owner's Build 4                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/api/health` from outside answers JSON, not an Access login                                              | **unproven (scope)**: lands with the owner's Build 5 (the dashboard deletion)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `planner.oludoi.com/` still answers `302` to Access                                                       | **unproven (scope)**: a live request, forbidden by the dispatch. The planner's table entry is pinned by `scripts/test/cloudflare-setup.test.ts` › "the planner's and the ledger's applications are unchanged"                                                                                                                                                                                                                                                                                                                                                                  |
| Plan mode against `oludoi.com` reports nothing to do and proposes no downloader `allow` app               | **unproven (scope)** for the live run. **Verified offline**: `plan-offline.mts` ran plan and `--apply` against a fake, fully set-up account that still holds the downloader's login and its `api/files/*` Bypass. Both runs printed `nothing to do.`, 0 writes, 0 DELETE/PATCH, and no `access  downloader` line. On the base script the same harness prints both downloader apps as `ok`, which is the positive control. Partly asserted by `scripts/test/cloudflare-turnstile.test.ts` › "applications already live are not written again, and no downloader login is named" |
| `cloudflare-setup.test.ts` asserts the new downloader shape and the unchanged planner shape               | `scripts/test/cloudflare-setup.test.ts` › "the downloader has no Access application at all, and nothing bypasses" (`apps` domains equal planner and ledger only, and `TOOLS` downloader `access` equals `[]`) and › "the planner's and the ledger's applications are unchanged" (whole-object `toEqual`) ✓. 9 of 9 planted `TOOLS` mutations turn the two files red (below)                                                                                                                                                                                                    |
| `02-DEPLOYMENT.md` and `SECURITY.md` no longer say the instance is private or needs a login               | **verified** by reading. Neither file says so any more. F1 and F2 are false statements in the new text                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run check` and `npm test` are green                                                                  | PR #496 at `34fcfac1`: `check` pass, `test (ubuntu-latest)` pass, `test (windows-latest, informational)` pass. Locally, `npx vitest run` on the two spec files: 34 of 34                                                                                                                                                                                                                                                                                                                                                                                                       |
| Browser: beacon present, no CSP violation, visit counted                                                  | **unproven (scope)**: lands with the owner's Build 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

- **high** · F1 · no `Done when` line depends on it · false in the unsafe direction. The safety argument for the setup script's write order is now false for the downloader, both on the page and in the script.
  - `docs/02-DEPLOYMENT.md`, "Steps 2 and 3, in one command", still says: "**Access applications are created before the routing**… In the other order the endpoint would be live and open… This way round, the worst case is a policy guarding a name that does not resolve yet."
  - The `applyOrder` comment in `scripts/cloudflare-setup.mjs` still says the widget goes last so that "if it is the call that fails, everything that guards the host is already in place".
  - The downloader now has no Access application, so its routing lands with no guard at all. Its only guard is the widget, which is created _after_ the routing, and it guards nothing until a person pastes the keys into `.env` and restarts the container.
  - Any host whose downloader container is already running when `--apply` routes it is therefore open with the human check off. The page itself calls that state "exactly as unsafe as the others".
  - Reproduction: `node <scratch>/widget-fails.mts <tree>` runs `--apply` on an empty fake account whose widget POST answers 500. At head the writes are `POST access planner`, `POST access ledger`, `PUT ingress` (with downloader), `POST dns ×3`, then the widget fails. The summary line reads `downloader routed with no Access app and no widget: true`. At the base the first two writes are the downloader's login and Bypass, and the line reads `false`.
  - Fix (text only): say the downloader has no application to order, so its hostname answers the moment it routes. Say that on a host serving it without a login, both Turnstile lines go in `.env` before the downloader container is up; say it in step 4 too. Correct the `applyOrder` comment's "everything that guards the host".
  - Making the app refuse probes when the keys are absent in production (fail closed) would close the gap in code. That is a separate decision for the owner, not this slice.
- **high** · F2 · no `Done when` line depends on it · false in the unsafe direction, and it contradicts the same page. The new downloader section in `docs/02-DEPLOYMENT.md` gives this as a reason the login can come off: "**No client can hold every slot** (dl-51): `MAX_JOBS_PER_CLIENT` and `MAX_PROBES_PER_CLIENT` per address".
  - The same page's "Tightening it past one user" table says "**one address can hold both job slots**".
  - `compose.downloader.prod.yaml` sets `MAX_JOBS_PER_CLIENT: "2"` next to `MAX_CONCURRENT_JOBS: "2"`, with the comment "one address can hold both running slots". The code default in `API_DEFAULTS` is also 2 and 2.
  - The bound holds for probes. It does not hold for job slots on either the shipped compose or the defaults.
  - Fix: reword the bullet to say what the cap bounds (jobs running or waiting per address), and that on this instance it equals the running slots by the owner's choice, linking the table.
- **low** · F3 · safe direction. `SECURITY.md`, `02-DEPLOYMENT.md` and both READMEs state in the present tense that `downloader.oludoi.com` has no login and anyone may use it. That is false until the owner's Build 5, and the branch's Log says so. Merging ahead of Build 5 puts the claim on `main` early, and a reader meets a login rather than an open door.
- **low** · F4 · unverified, and safe direction if false. `SECURITY.md` says the planner and the ledger "run behind a login, on the maintainer's own host". Nothing in the repo records a live ledger instance: there is no `ledger.oludoi` anywhere in the tracked markdown.
- **low** · F5 · safe direction, and nothing relies on it. The doc comment on `planAccess` in `scripts/cloudflare-setup.mjs` still says "the two downloader applications differ only by that path". There are none now.
- **low** · F6 · `scripts/test/cloudflare-turnstile.test.ts` › "applications already live are not written again, and no downloader login is named": the second (`before`) run asserts only absences (`not.toContain("access  downloader")` and no `/access/apps` writes). Nothing proves that run reached the access section, so a run that returned early with nothing printed would pass. Add `expect(beforeRun.out).toContain("ok       access  planner.example.com (allow)")`.
- **dropped** · the plan says nothing about a leftover downloader application. The brief keeps the script from managing or deleting it, and Build 5 and the page name the deletion, so this is a product choice, not a defect.
- **dropped** · the `maxJobsPerClient` comment in `API_DEFAULTS` ("One client should not be able to hold both of the default two running slots") sits beside a value that lets it. That is older than this branch and outside the reviewed range.
- **findings** · the hunt returned 8: 6 carried, 2 dropped.
- Positive controls: `run-mutations.sh` changed `TOOLS` 9 ways, and each one failed the two files (`exit=1`). The changes were the planner's path, its email (extra flag), its decision, its name and a second planner app; the ledger's extra flag removed; and the downloader's old pair, Bypass alone and login alone restored. Failing counts: 4, 3, 3, 1, 5, 3, 5, 5 and 5 of 34. `anchors.mjs` checked 120 links in the four edited files, plus every link into `02-DEPLOYMENT.md#…` repo-wide: 0 broken. A planted link to the removed `#the-downloaders-keep-the-download-links-shareable` was reported as broken. The removed anchors are referenced nowhere (`git grep` empty).
- Never deletes: the only writes in the script at head are `POST` to access apps, DNS and widgets, and the ingress `PUT`. No DELETE, no PATCH, and no write to an existing app, in either mode.
- Release: the title `chore(repo): …` passes `scripts/commit-message.mjs --text` (exit 0). `chore` is `hidden` in `release-please-config.json` and has no `!`, so per `docs/03-RELEASING.md` the `tools/downloader/` paths release nothing. That is right: no image content changed.
- Invariants: no shell, no new spawn, no imports across tools, no contract edit. Skipped as untouched: `AppError`, SSRF, redaction, progress, image closure, test registration (both specs are existing `repo` files).
- NFR: security, see F1 and F2 · performance n/a · reliability ✓ (the script stays additive; the two files went from 31 to 34 tests (17+14 at the base by `^test(` count, 18+16 at head). The two replaced setup tests asserted the old downloader shape, so they were rewritten, not weakened) · maintainability, see F5 and F6.

## Log

- 2026-09-13 — Filed with dl-50 through dl-54 as the plan to open the downloader
  without a login. Nothing is built.
- 2026-09-14 — Added step 5 and its Done when line. The owner chose Cloudflare
  Web Analytics for visitor counts, with its CSP half in dl-50. The owner also
  ruled out ads on the downloader. The roadmap's Phase 5 says why.
- 2026-09-22 — dl-50 built, and it ships the check **off** until the host has
  both Turnstile keys, so step 4 and the first Done when line were added: the
  keys go in before Access comes out. Steps 4 and 5 above are now 5 and 6 (the
  2026-09-14 entry names the old number). The Web Analytics line now names the
  one thing dl-50 could not measure — whether the beacon's report is refused
  under `connect-src 'self'` — because it can only be seen on the live
  hostname once the new policy is deployed.
- 2026-10-16 — The owner answered Build 1's open decision (via the orchestrator,
  which recommended the first option). Question: once the downloader has no
  Access application, does the `api/files/*` Bypass application go too? Options:
  (a) remove it, so the script stops creating it, the test asserts the
  downloader has no Access application at all, and deleting the live Bypass joins
  the owner's step-5 dashboard visit; (b) keep it, inert while nothing is gated
  and ready if a login returns. **The owner chose (a).** Build 1 and step 5 above
  now say so. The script still never learns to delete.
- 2026-10-16 — Builder, Build steps 1 to 3 only (branch `dl-49-public-script-docs`).
  **Status stays `ready`: steps 4, 5 and 6 are the owner's and nothing in them was
  attempted, and no request was made to `oludoi.com`.**
  - Step 1: `TOOLS` gives the downloader `access: []`, so `--apply` creates neither
    the login nor the `api/files/*` Bypass; the widget entry is untouched. The
    header and the `applyOrder` comment were reworded where they named the
    downloader's Bypass or an open downloader as the reason for the ordering. New
    and changed tests, in `scripts/test/cloudflare-setup.test.ts`: _a live
    downloader application is neither adopted nor proposed again_, _the downloader
    has no Access application at all, and nothing bypasses_, _the planner's and the
    ledger's applications are unchanged_ (whole objects); and, at the end of
    `scripts/test/cloudflare-turnstile.test.ts`, which already holds the fake
    account, _applications already live are not written again, and no downloader
    login is named_ and _--apply on an empty account creates the planner's and the
    ledger's applications and no downloader one_. Watched failing first: with the
    old two entries put back in `TOOLS`, 5 of the 34 tests in those two files fail.
  - Step 2: `docs/02-DEPLOYMENT.md`. Step 2 is retitled "Decide who may reach each
    tool" and its downloader subsection is "The downloader: with a login or
    without one": what stands in for a login (dl-50 to dl-54, each linked), that
    the human check is off until both keys are in `.env`, that a host without
    them still needs Access (the application and the Bypass by hand, since the
    script no longer makes them), and that a login already live is removed on the
    dashboard. "When you want it genuinely public" keeps its heading, so the
    anchor holds, and now says the downloader is the case that met its
    precondition. Verifying, the terms-page paragraph and the expiring-session
    note are conditional on a host that kept the login. Also touched, because each
    stated the old arrangement: the root `README.md` deploy paragraph and
    `tools/downloader/README.md`'s deploy paragraph.
  - Step 3: `SECURITY.md` names `downloader.oludoi.com` as the one public instance,
    says the planner and the ledger have none, and sends reports about it through
    the same private channel. Its "Running it exposed and unauthenticated" bullet
    now says the public instance's missing login is not a finding and a way past
    its replacement is.
  - **The brief was wrong about two things.** It says to rewrite "step 4" of
    `02-DEPLOYMENT.md`; the login is step 2 (step 4 is "Bring it up"). And the
    sentence it quotes, "is unsafe without it", is not on the page; the text was
    "no tool here is safe without it".
  - **Left for the owner:** Build 4 (Turnstile keys in the host `.env`, then
    `curl /api/config`), Build 5 (delete the downloader's Access application **and
    the live `api/files/*` Bypass application**, per the answer above), Build 6
    (Web Analytics), and the Done when lines they carry: both `/api/config` and
    `POST /api/probe` curls, `/api/health` answering JSON, the planner's `302`, the
    live plan-mode run, and the beacon and CSP check in a browser. The new text in
    the docs and `SECURITY.md` describes the state after step 5, so it reads ahead
    of the live host until then.
  - **Not folded in:** the plan prints nothing about a leftover downloader
    application still live on a host. A one-line `NOTE` would be small but is not
    specified, and it would be the first thing in this script to speak about an
    object it does not manage; step 5 and the docs already name the deletion.
    The comments in `compose.downloader.prod.yaml` and `.env.example` that call
    the check-off state "right behind a login" are still true of a host that keeps
    one, so they were left alone.
- 2026-10-16 — Builder, fix round for gate 1 at 34fcfac1 (F1, F2, F5, F6; F3 and F4
  not touched).
  - F1: the ordering argument ("Access first, then routing") no longer covers the
    downloader, which has no application, so its hostname answers as soon as the
    routing lands and its widget guards nothing until the keys are in `.env` and
    the container has restarted. `docs/02-DEPLOYMENT.md` now says so under
    "Steps 2 and 3, in one command" and again in step 4 (both Turnstile lines in
    `.env` before the downloader container is up), and the `applyOrder` comment no
    longer says the widget's failure leaves "everything that guards the host" in
    place. The script's order is unchanged. **Open for the owner, not done here:**
    making the app refuse probes when the keys are absent in production (fail
    closed) would close the gap in code.
  - F2: the dl-51 bullet said no client can hold every slot. It now says
    `MAX_JOBS_PER_CLIENT` bounds jobs running or waiting per address, that on this
    instance it equals `MAX_CONCURRENT_JOBS` (2) by the owner's choice, so one
    address can still hold both job slots, and links the table.
  - F5: the `planAccess` doc comment no longer says the downloader has two
    applications. F6: the `before` run now also asserts the `ok access
planner.example.com (allow)` line.
- 2026-10-17 — The owner answered two questions raised by the gates (via the
  orchestrator). **Fail closed.** Question: dl-49's gate notes an optional code
  fix, in production the downloader would refuse probes when the Turnstile keys
  are missing (fail closed), and without it a host that routes before the keys are
  in `.env` is open; the text fix documents that gap; file a ticket? Options: file
  a dl- ticket; do not file. **The owner chose to file** (the orchestrator's
  recommendation). It is being filed as dl-126, on branch
  `dl-126-file-fail-closed-without-turnstile-keys`; this replaces the 2026-10-16
  fix-round entry's "Open for the owner" wording for that item, which is left as
  written above. **Merge timing.** Options: merge once gated; hold as a draft until
  step 5. **The owner chose to merge once gated**, so the docs and `SECURITY.md`
  read ahead of the live host until the owner's step 5.
