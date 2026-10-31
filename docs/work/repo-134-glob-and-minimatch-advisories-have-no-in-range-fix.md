---
id: repo-134
tool: repo
title: glob and minimatch carry moderate advisories fixed only in majors no dependent accepts, in code nothing here runs
kind: chore
status: ready
milestone: null
depends_on: []
difficulty: mechanical
note: not startable until @fastify/static depends on glob ^14 — check npm view @fastify/static dependencies first
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
