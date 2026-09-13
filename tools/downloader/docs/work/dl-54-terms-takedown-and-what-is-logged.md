---
id: dl-54
tool: downloader
title: Publish terms and a takedown contact, and decide what the operator keeps about who fetched what
kind: work-package
status: needs-decision
milestone: M5
depends_on: []
difficulty: standard
---

# dl-54 — Terms, takedown, and what is logged

**Packages:** `web` (a terms page and a link to it), `api` (log fields and
retention, if that changes), and `docs/02-DEPLOYMENT.md`.

## Why

[00-ANALYSIS.md](../00-ANALYSIS.md) §8 says what is legal to download "depends
on the content and the site's terms — that is a decision for whoever operates
it". The code enforces one line, `DRM_PROTECTED`, and leaves everything else to
the operator. For a public instance, the operator is the owner, answering for
strangers' requests.

A public service is expected to say three things. Today it says none of them:

1. **What it may be used for.** The UI has no terms and no statement at all.
2. **Who to contact** when a rights holder, or the owner of a site being
   hammered through it, wants something stopped.
3. **What it records.** `request-log.ts` logs every request's `ip` next to its
   redacted path. Whether a probed page's URL also reaches a log line, and how
   long the host keeps those logs, is not written down. That is also what the
   owner would need to answer an abuse report.

This is not legal advice, and the ticket must not pretend otherwise. It records
the owner's choices, and the build makes the service say them.

## The decision

**1 — Logging retention.**

- **A — Keep `ip` and the probed URL for a short, fixed period (recommended),**
  such as 14 days. That is long enough to answer "who asked for this", and it
  is stated on the terms page.
- **B — Keep no address at all.** Nothing to disclose and nothing to answer an
  abuse report with. It also blinds dl-51's and dl-52's tuning, which reads
  these logs.
- **C — Leave logs as they are.** Retention is then whatever the host's Docker
  logging driver does, which today nothing pins.

**2 — The contact.** An address the owner is willing to publish. It should not
be the one the Access policy allows, so the login address stays unpublished
while the planner still uses it.

**3 — The terms text itself.** The owner writes it or approves it. An agent
drafts it, and the draft is labelled as a draft until the owner approves it.

## Build

Written with the decision. It will include:

- A first step that measures exactly which fields reach a log line during one
  probe and one download.
- A terms page served same-origin, which dl-35's CSP needs no change for.
- The retention made explicit in `compose.downloader.prod.yaml`'s logging
  options.

## Done when

Written with the decision.

## Log

- 2026-09-13 — Filed as `needs-decision`. The log fields named above were read
  from `request-log.ts` on `origin/main` `1835657`. The per-probe fields have
  not been measured.
