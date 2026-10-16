---
id: dl-49
tool: downloader
title: Take the login off downloader.oludoi.com, once an anonymous visitor cannot spend the host
kind: work-package
status: ready
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
