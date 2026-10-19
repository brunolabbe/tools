---
id: repo-98
tool: repo
title: The ledger's Access policy admits any address that proves itself, if the ledger is ever to be open
kind: work-package
status: needs-decision
milestone: null
depends_on: [lg-20, lg-22]
difficulty: standard
---

# repo-98 — The ledger's Access policy admits any address that proves itself, if the ledger is ever to be open

## Why

The ledger's Access application admits listed addresses only: two at creation
(`--email` and `--ledger-email` in `scripts/cloudflare-setup.mjs`), and after
lg-20 every household's members, each added by the operator in the dashboard.
The directory decides which household an admitted address is in
(`tools/ledger/docs/00-ANALYSIS.md` §7, _Access keeps its allowlist, and the
directory decides who is in_). That was the owner's choice on 2026-10-12, at
review, over the open policy this ticket first described: at two or three
households, a new address is a dashboard edit a few times in the tool's life,
and no stranger ever reaches the origin.

**This ticket is the other choice, kept for the day the owner wants the ledger
open to anyone** — households the operator does not admit by hand. The decision
it waits on is that one, and nothing builds it before. It does not need a
provider of the ledger's own: Access already fronts Google, GitHub and a
one-time PIN, so "anyone who proves an address" is a policy change, and the
tool keeps no login of its own (the ledger `CLAUDE.md`).

The policy would become `allow` with `include: [{ everyone: {} }]`. That is not
a Bypass. An unauthenticated request still stops at Cloudflare, and every
request that reaches the origin still carries a token the ledger verifies. What
it costs, measured at filing:

- **Every stranger who proves an address takes a Zero Trust seat, and a full
  plan blocks every new sign-in.** Cloudflare's seat-management page: once the
  subscription's seats are consumed, additional users who attempt to log in are
  blocked, and inactive users are not removed by default. So fifty strangers,
  or one with fifty mailboxes, lock the next household out until the operator
  clears seats. The free plan's seat count was reported as 50 from Cloudflare's
  2020 announcement, and no current official page confirmed it.
- **The identity check and the admin routes become reachable by any stranger.**
  Both fail closed today, and the authority sweep (lg-22) proves it, but they
  are then a surface, and the refusal path needs a limit of its own.

## Build

1. **`scripts/cloudflare-setup.mjs`.**
   - The ledger's entry in `TOOLS` stops taking `extraEmailFlag`, and its policy
     includes `everyone` with decision `allow`.
   - `--ledger-email` goes, and so does the `MISSING … admits a second person`
     refusal. If nothing else uses `extraEmailFlag`, remove its machinery too.
   - Rewrite the header comment's ledger paragraph.
   - The downloader's and the planner's policies are unchanged, and
     `scripts/test/cloudflare-setup.test.ts` › "the ledger admits a second address,
     and only the ledger does" becomes a test that only the ledger admits everyone,
     and only with `allow`.
2. **The live application is changed by hand.** The script creates applications
   and never repairs an existing one (its own comment: "no later run repairs an
   existing one"), so a re-run will not touch the deployed ledger policy. Write the
   dashboard steps in `docs/02-DEPLOYMENT.md`: Zero Trust → Access → Applications →
   ledger → its Allow policy → replace the email includes with _Everyone_, and
   keep the login methods as they are.
3. **Seat expiration on, before the policy opens.** Zero Trust → Settings →
   Admin controls, at its shortest window (one month at filing), so a stranger's
   seat frees itself. Read the account's current seat count and the window in
   the dashboard and write both into the deployment notes, with what a full plan
   does to a new sign-in. Do not quote the 2020 figure as current.
4. **Refused requests are rate limited by client address.** A stranger who
   proves any address reaches the identity check (lg-20). A refusal is keyed on
   the client address (`trustProxy`, as `ApiConfig` already configures it) and
   not on a person, since there is none. A test proves the limit holds. Every
   other route keeps its per-person limit.
5. **The sweep and the page meet a stranger.** lg-22's authority sweep already
   walks an admitted address that is neither member nor admin; name that case
   as the stranger's and keep it. lg-20's "no household" page is what a stranger
   sees, and it must go on naming nobody and nothing.
6. **`docs/02-DEPLOYMENT.md`.**
   - Rewrite the ledger's step 2 section. Keep its _No Bypass rule, ever_. Its
     _Never "widen it" to public_ becomes "never Bypass, and never admit without
     proof of an address", with the reason.
   - Remove `--ledger-email` from the setup command.
   - lg-22's screens stop telling a member that the operator must admit the
     address.

## Done when

1. `cloudflare-setup.mjs`'s desired state gives the ledger `allow` + `everyone` and
   leaves every other tool's policy unchanged; `scripts/test/cloudflare-setup.test.ts`
   proves both.
2. Refused requests are rate limited by client address; a test proves it.
3. `docs/02-DEPLOYMENT.md` carries the dashboard steps for the live application,
   seat expiration, and the seat count as read from the account, not as remembered.
4. After the owner applies it, an address in no household signs in through Access
   and sees lg-20's "no household" page, and a member reaches their books. This
   reading is the owner's, after the deploy.
5. Gates green.

## Log

- 2026-10-12 — Filed with lg-20, lg-21 and lg-22. The owner weighed keeping the
  allowlist on Access and replacing Access with an OIDC provider such as Auth0,
  and chose this.
- 2026-10-12 — Reviewed before merge, and the owner reversed it: the allowlist
  stays, and this ticket is the deferred opening, `needs-decision` until the
  owner wants the ledger open to anyone. The review brought the seat rule from
  Cloudflare's own page (a full plan blocks new sign-ins; expiration off by
  default), which the first filing had as "read the limit". The limit on
  refusals by client address moved here from lg-20, since only this ticket lets
  a stranger reach the check.
- 2026-10-19 — Asked again while clearing the decision queue; the owner keeps it
  deferred. Still `needs-decision`: the allowlist stays until the owner wants the
  ledger open to anyone.
