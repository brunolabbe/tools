---
id: dl-71
tool: downloader
title: Create the downloader's Turnstile widget from the Cloudflare setup script
kind: work-package
status: ready
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

## Log

- 2026-09-22 — Filed at the owner's request while dl-50 was in review, to help
  create the Turnstile widget. Nothing measured against the live API: the script's
  token is not available to an agent, and reading a real `.env` is denied.
- 2026-09-22 — The owner answered D1 (a) and D2 (a). Moved to `ready`.
