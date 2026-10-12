---
id: repo-98
tool: repo
title: The ledger's Access policy admits any address that proves itself
kind: work-package
status: ready
milestone: null
depends_on: [lg-20]
difficulty: standard
---

# repo-98 — The ledger's Access policy admits any address that proves itself

## Why

The ledger's Access application admits exactly two addresses: `--email` and
`--ledger-email` in `scripts/cloudflare-setup.mjs`, whose header comment argues
for the second address. On 2026-10-12 the owner decided that more than one
household uses the ledger, that membership lives in the ledger's own directory
(lg-20), and that a household's members add their own members from the app
(lg-22). An allowlist on Access would be a second list of members, and a
household could not add anyone without the operator's dashboard. So Access stops
deciding _who_ and keeps deciding _whether someone proved an address_
(`tools/ledger/docs/00-ANALYSIS.md` §7, _Access proves the address and the
ledger decides who is in_).

The policy becomes `allow` with `include: [{ everyone: {} }]`. That is not a
Bypass. An unauthenticated request still stops at Cloudflare, and every request
that reaches the origin still carries a token the ledger verifies.

It depends on lg-20 because lg-20 rewrites the same ledger section of
`docs/02-DEPLOYMENT.md`, and because lg-20 adds the "no household" page and
the rate limit on refused addresses that a stranger now reaches.

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
3. **`docs/02-DEPLOYMENT.md`.**
   - Rewrite _The ledger's: two people, and still no Bypass_. Keep its _No Bypass
     rule, ever_. Its _Never "widen it" to public_ becomes "never Bypass, and never
     admit without proof of an address", with the reason.
   - Remove `--ledger-email` from the setup command.
4. **Zero Trust seats.** Every address that signs in takes a seat on the Zero Trust
   plan, strangers included. The free plan's limit was reported as 50 at filing,
   from Cloudflare's 2020 announcement; no current official page confirmed it.
   Read the account's current limit, and how a seat is freed, in the dashboard,
   and write both into the deployment notes. Do not quote the 2020 figure as
   current.

## Done when

1. `cloudflare-setup.mjs`'s desired state gives the ledger `allow` + `everyone` and
   leaves every other tool's policy unchanged; `scripts/test/cloudflare-setup.test.ts`
   proves both.
2. `docs/02-DEPLOYMENT.md` carries the dashboard steps for the live application,
   and the seat limit as read from the account, not as remembered.
3. After the owner applies it, an address in no household signs in through Access
   and sees lg-20's "no household" page, and a member reaches their books. This
   reading is the owner's, after the deploy.
4. Gates green.

## Log

- 2026-10-12 — Filed with lg-20, lg-21 and lg-22. The owner weighed keeping the
  allowlist on Access and replacing Access with an OIDC provider such as Auth0,
  and chose this.
