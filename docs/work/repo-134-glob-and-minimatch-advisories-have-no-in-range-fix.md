---
id: repo-134
tool: repo
title: glob and minimatch advisories reach the tree only through @fastify/static; no code here runs them
kind: chore
status: done
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

## Review

**Gate: PASS** — 2026-11-08 · `4a9b8af4..8b6dc238` · Sonnet 5.5 (claude-sonnet-5-5), depth narrow

Narrow depth: the named attacks and the acceptance table, no hunt of my own and no invariant walk. No build was run: the diff is `package-lock.json` and the ticket only, and the farm links `main`'s `node_modules`, so `npm test` is read from CI, not run here. Landing condition, not an acceptance line: the owner's answer of 2026-11-08 holds the landing until 2026-11-09 04:51Z, when `minimatch` 11.0.4 (published 2026-11-02T04:50:40Z) is 7.0002 days old.

| Done when                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm audit` reports no glob or minimatch advisory through `@fastify/static` | **verified** — `npm audit --package-lock-only` on the head lockfile prints `found 0 vulnerabilities`; the same command on the base lockfile (a second detached tree) prints the 3 moderate advisories (`@fastify/static 7.0.0 - 10.1.8`, `glob 9.0.0 - 14.0.1`, `minimatch 7.0.0 - 11.0.0`), so the harness can produce the failure. No test asserts it; I re-ran it. `node scripts/check-lockfile-sync.mjs` exits 0 (`up to date`), and CI's `check` job ran it green on the head.                                                                                                 |
| …and `npm test` passes                                                      | **proven** — CI `test (ubuntu-latest)` ran `npm test -- --project core --project repo --project downloader --project ledger --project planner --exclude scripts/test/status.test.ts` at `8b6dc238` and passed: 340 of 341 files passed, 1 skipped, none failed. `status.test.ts` is excluded from that leg and ran green in CI's `check` job. The same head passed `e2e` (downloader direct and sniffer, ledger, planner), `docker` x3, `codeql`, `CodeQL`, `dependency-review`. The informational `test (windows-latest, informational)` leg is red and is read below, not graded. |

- **low** · `nfr:maintainability` · no `Done when` line depends on it · the ticket's Log (third bullet of the 2026-11-08 relock entry), the pull request body and the commit body all say `minimatch` 11.0.4 is "inside seven days" and "taken as exempt" or "read as exempt", for the gate to judge. The owner has judged: it is not exempt; the landing waits until 2026-11-09 04:51Z and the pull request names only `@fastify/static` 10.1.9 as the advisory-exempt young release. The text is false in the unsafe direction (it claims a looser reading of the seven-day rule than the owner allowed), but it is self-flagged as the builder's reading, it is one ticket's Log, and no call site relies on it. Fully stated fix, for the landing with no re-gate: in the Log's relock entry replace the sentences "`minimatch 11.0.4` is read as exempt too … the gate should judge it" with the owner's answer (dated 2026-11-08, naming the owner: not exempt, landing held to 2026-11-09 04:51Z, 11.0.4 then 7.0002 days old), and make the pull request body's last paragraph name only `@fastify/static` 10.1.9.
- **low** · `nfr:maintainability` · no `Done when` line depends on it · the ticket's H1 still reads "glob and minimatch advisories have no in-range fix", and the reworded frontmatter title ("reach the tree only through @fastify/static; no code here runs them") is in the present tense; both stop being true when this merges, because the advisories no longer reach the tree. False in the safe direction: they describe the problem as filed.
- **low** · `nfr:maintainability` · no `Done when` line of this ticket depends on it · outside the named attacks, seen in passing: `docs/work/repo-135-…md` Build 4 ("Convert repo-122's and repo-134's notes") names a `note:` this branch deletes, so repo-135's builder finds nothing to convert for repo-134. Its Done when 4 (repo-134 absent from `--ready` on `main`) still holds once this ticket is `done`. One sentence in repo-135's Build 4 at the landing.
- **dropped** · `test (windows-latest, informational)` red at the head: 2 of 7,489 tests (`tools/ledger/web/test/history.test.tsx` › "after a stored save whose re-read is still running, focus is on the row's button …(lg-99)"; `tools/downloader/resolvers/test/browser/consent-scope.test.ts` › c12, `page.goto: net::ERR_NO_BUFFER_SPACE`). Neither imports `@fastify/static`, `glob`, `minimatch`, `path-scurry` or `@fastify/send`, and the latter is the Windows socket-buffer failure `repo-99` and lg-71's gate already record. Latest `push` run on `main` whose matrix ran: `4a34361d` (run 42440985233), `test (windows-latest, informational)` success. Informational; not a finding against this diff.
- **dropped** · `@fastify/static` 10.1.10 (2026-11-04T17:11Z, the `latest` tag) is not taken. A choice the dispatch and the rule leave to the cutoff; 10.1.10 is younger and fixes no audited advisory.
- **dropped** · the 10.1.6 to 10.1.9 and `@fastify/send` 4.1.2 to 4.2.0 code changes (an `onFile` hook, `#` and `?` in file names, error propagation from `reply.sendFile`, encoding fallback order) touch no option the three APIs set (`root`, `prefix`, `index`, `dotfiles`, `setHeaders` only). No live call site.
- **dropped** · glob 14's `glob()` call in `@fastify/static` runs only under `wildcard: false`, which no `routes/web.ts` sets; unexercised here and in CI. No live call site.
- **findings** · the hunt returned 7; 3 carried, 4 dropped.
- NFR: security ✓ (the three advisories clear; the one young release is the named exemption; tarball integrity of all four moved registry tarballs equals the lockfile's) · performance n/a · reliability ✓ (one copy of each moved package, every range satisfied, CI green on the leg that gates) · maintainability — above.

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
    advisory exemption. `minimatch 11.0.4` is not exempt. The owner answered on
    2026-11-08 (the entry at the end of this Log): the landing is held to
    2026-11-09T04:51Z, when 11.0.4 is 7.0002 days old. The cutoff could not give
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
- 2026-11-08 — The owner's answer (via the orchestrator) to the builder's open
  decision on `minimatch 11.0.4` (published 2026-11-02T04:50Z, six days old at
  the time). Options: keep 11.0.4 and land only once it is seven days old (the
  orchestrator's recommendation); keep 11.0.4 as advisory-exempt now (the
  builder's recommendation); pin 11.0.3 with an override. The owner chose the
  first. 11.0.4 is not exempt: the rule's exemption covers a fix with no older
  fixed release, and 11.0.3 (2026-10-28) carries the fix. The merge waits until
  2026-11-09T04:51:00Z, and only `@fastify/static 10.1.9` is named as the
  advisory-exempt young release.
- 2026-11-08 — Fixed at landing by owner choice: gate 1, the first low — "the
  Log says minimatch 11.0.4 is read as exempt, for the gate to judge". The
  relock entry's third bullet now carries the owner's answer instead; the pull
  request body names only `@fastify/static 10.1.9` as exempt. Proof, run on
  this file after the commit:
  `git diff 8b6dc238 HEAD -- <file> | grep -c '^-.*is read as exempt too'` → `1`.
- 2026-11-08 — Fixed at landing by owner choice: gate 1, the third low — "repo-135
  Build 4 names a note: this branch deletes". One sentence is added to repo-135's
  Build 4: its `note:` is deleted by repo-134's own branch, so convert only
  repo-122's. Proof, run after the commit:
  `git diff 8b6dc238 HEAD -- <repo-135 file> | grep -c '^+.*convert only'` → `1`.
