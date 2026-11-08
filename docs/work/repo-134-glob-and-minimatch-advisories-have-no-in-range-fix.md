---
id: repo-134
tool: repo
title: glob and minimatch advisories reach the tree only through @fastify/static; no code here runs them
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-134 — glob and minimatch advisories have no in-range fix

## Why

On 2026-10-31, after node-forge 1.4.2 cleared that package's twelve advisories
(dl-132), `npm audit` reports 9 moderate vulnerabilities from two advisories:

- **GHSA-3g3m-2fjr-6pw4**: glob `>=9.0.0 <=14.0.1`, "AbortSignal cancellation
  bypass allows post-timeout filesystem traversal". Fixed in glob 14.0.2.
- **GHSA-g3hv-75wg-m249**: minimatch `<11.0.1`, "denial of service via globparts
  amplification". Fixed in minimatch 11.0.1.

Both fixes are new majors, and no package here that depends on them accepts one.
They reach the tree two ways:

1. **`@fastify/static`**, which all three APIs use, depends on `glob ^13`. Its
   newest release, 10.1.8 (2026-10-27), still does. Forcing glob 14 with a scoped
   override was measured on 2026-10-31, and `npm audit` still reported 9 moderate,
   so an override buys nothing.
2. **`exceljs`**, the ledger's workbook reader, pulls in glob 7 with minimatch 3 and
   minimatch 5 through `archiver`, `zip-stream`, `readdir-glob` and
   `unzipper → fstream → rimraf`. exceljs 4.4.0 (2023) is its latest release.
   Forcing minimatch 11 there would break glob 7, which calls
   `require('minimatch')` as a function. **lg-84 removes exceljs**, and that is how
   this half clears.

**No code here runs either bug.** `@fastify/static` calls glob only when
registered with `wildcard: false`. None of the three `routes/web.ts` files sets
`wildcard`, so it defaults to `true`, and the patterns would be fixed ones anyway,
with no `AbortSignal`. The ledger only _loads_ workbooks. archiver and rimraf are
exceljs's write path, which only the ledger's test helpers reach, and no pattern
anywhere comes from a user.

The ticket exists so these advisories are not explained only by a pull request
description. `npm audit` reports them on every run with no reason attached.

## Build

1. `npm view @fastify/static dependencies`. If glob is still `^13`, there is
   nothing to do; leave the ticket `ready`.
2. Once a `@fastify/static` release depends on glob 14.0.2 or later, take it the
   way `.claude/rules/dependency-updates.md` says. The advisory exemption applies,
   since the rule sets no reachability test (dl-132's Log). If that release is a
   new `@fastify/static` major, it is a ticket of its own instead.
3. Re-run `npm audit`. If lg-84 has landed, nothing should remain. If not, what
   remains should be exactly the exceljs chain above.

## Done when

- `npm audit` reports no glob or minimatch advisory through `@fastify/static`,
  and `npm test` passes.

## Log

- 2026-10-31: filed with lg-84 (replace exceljs) on the owner's choice, over
  recording the advisories alone or leaving them unrecorded. If GitHub shows
  Dependabot alerts for either advisory, dismiss them as "vulnerable code is not
  actually used", linking this ticket.
- 2026-11-01: lg-84 removes exceljs and its chain on its branch. `npm audit` there
  reports 3 moderate, down from 9: `@fastify/static`, glob and minimatch, the
  first half above and nothing else. Build 3's "nothing should remain" holds once
  this ticket's `@fastify/static` release lands too.
- 2026-11-08: the `note:` line ("not startable until @fastify/static depends on
  glob ^14") is stale and is removed. `npm view @fastify/static@10.1.9
  dependencies.glob` prints `^14.0.0`, and 10.1.9 was published 2026-11-04T09:47Z.
  From that release the title's "fixed only in majors no dependent accepts" and
  the Why's "no package here that depends on them accepts one" are false, so the
  title is reworded; the Why is left as the 2026-10-31 record. Build 2's
  exemption applies. exceljs is already gone at the base `4a9b8af4`:
  `grep -c exceljs package-lock.json` prints `0`. Base audit, `npm audit
  --package-lock-only`: `3 moderate` (`@fastify/static 7.0.0 - 10.1.8`, `glob
  9.0.0 - 14.0.1`, `minimatch 7.0.0 - 11.0.0`).
- 2026-11-08, the relock. Two `npx -y npm@11.21.1 update … --package-lock-only
  --ignore-scripts` commands, then npm 10.9.9's `npm install --package-lock-only
  --ignore-scripts`, the rule's npm 10 step run only for the lockfile. Three
  points the rule does not give:
  - `update @fastify/send --before=2026-11-01T00:00Z` first: `4.1.2 → 4.2.0`
    (2026-10-20). 10.1.9 requires `@fastify/send ^4.2.0`, and a later cutoff
    would fetch 4.2.1 (2026-11-02T22:38Z), which is inside seven days and fixes
    no audited advisory.
  - `update @fastify/static glob minimatch --before=2026-11-04T09:48Z`, the
    release's own publish instant. It takes `@fastify/static 10.1.6 → 10.1.9`
    (named as the exemption), `glob 13.0.6 → 14.0.3` (2026-10-28), `minimatch
    10.2.6 → 11.0.4` (2026-11-02), `path-scurry 2.0.2 → 3.0.0` (2026-10-27), and
    the new `@isaacs/nonrecursive-glob-match 1.0.3` (2026-10-28).
  - Two entries are inside seven days. `@fastify/static 10.1.9` is the named
    advisory exemption. `minimatch 11.0.4` is read as exempt too, because 11.0.4
    is a release at or past the GHSA-g3hv fix (11.0.1). That is this builder's
    reading of the rule, and the gate should judge it. The cutoff could not give
    minimatch 11.0.3 (2026-10-28): `npm update` does not move a lock entry
    already at a satisfying version down, and the cutoff that admits 10.1.9 is
    later than 11.0.4.
  - Not used: a bare `update @fastify/static` picks 10.1.10 (2026-11-04T17:11Z,
    not named), glob 14.0.4 (2026-11-06) and minimatch 11.0.5 (2026-11-05). A
    single cutoff of 2026-11-04T09:48Z also pulls `@fastify/send 4.2.1`, as above.
  - npm 11's output fails `scripts/check-lockfile-sync.mjs` with `"peer": true`
    on platform packages. The npm 10 pass removes those lines and changes no
    version: 408 of 408 entries compared, zero differences.
  - Results: `npm audit --package-lock-only` prints `found 0 vulnerabilities`
    (base: 3 moderate). `node scripts/check-lockfile-sync.mjs` exits 0.
    `package.json` is unchanged: the three `api` ranges `^10.1.3` admit 10.1.9.
  - Not measured here: `npm test`. The farm links `node_modules` to the shared
    checkout's copies (`@fastify/static 10.1.6`, glob 13), so a run in this
    worktree would test the old tree. CI reads the new lockfile on the draft
    pull request, and `npm test` is `unproven (gate)` until that run reads.
