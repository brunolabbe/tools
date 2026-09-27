---
id: repo-76
tool: repo
title: Duplicate ids differing by leading zeros are not detected
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-76 — Duplicate ids differing by leading zeros are not detected

## Why

Found by repo-72's gate (Sonnet), verbatim:

> _Leading zeros_ (`dl-3` vs `dl-003`): **not detected as a duplicate** — both
> parse, both are valid distinct strings, `readTickets` returns both
> (`['dl-003', 'dl-3']`, no throw), even though `byIdOrder` would sort them to
> the same slot. This is **pre-existing, unchanged by this diff** — the base's
> `Map(tickets.map(t => [t.id, t]))` dedups by the identical string key too, so
> the base code has the same gap.

**Measured on this branch**, whose id handling is `1a8321c`'s unchanged, with a
scratch script over a fixture holding `dl-3-a.md` and `dl-003-b.md`, driving
the worktree's own scripts:

| Script                                                  | What it does with `dl-003`                                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status.mjs` `readTickets`                              | Returns both, `[["dl-003",3],["dl-3",3]]`, no throw. `validate`'s `/^[a-z]+-(?<number>\d+)$/` accepts the zero and `Number()` drops it.                                    |
| `status.mjs --json`                                     | exit 0, no problem reported.                                                                                                                                               |
| `status.mjs --show dl-003` / `--show dl-3`              | Each exit 0 and shows its own file: `--show` matches the id string exactly. `--show dl-03` exits 1, `no ticket called "dl-03"`.                                            |
| `status.mjs`, `depends_on: [dl-03]` with `dl-3` present | exit 1, `depends_on "dl-03", which is not a ticket` — the string, not the number.                                                                                          |
| `next-id.mjs`                                           | `idsIn` reads `dl-003` as `3`. Across two sources it reports a clash on 3 and `next free` 4; **within one source the two collapse to one claim and no clash is reported**. |
| `commit-message.mjs`                                    | `fix(downloader): a thing (dl-003)` → `{"ok":true}`. It does not parse ticket ids at all, so there is nothing for it to disagree about.                                    |

So the scripts disagree: `next-id` normalises the number, `status` keys by the
string.

**How many ids carry a leading zero today: none.**
`git ls-tree -r --name-only origin/main -- docs/work tools` → 205 ticket files,
0 named `<prefix>-0…`; `git grep -hE "^id: [a-z]+-0"` over both ticket roots → 0;
`git grep -nE "\b(dl|pl|lg|repo)-0[0-9]+" origin/main` over the whole tree → no
output.

## The decision — answered 2026-09-27: reject leading zeros

**Asked of the owner** by the orchestrator on 2026-09-27, with three options:
**Reject leading zeros (recommended)**, **Compare numerically** (which needs
stacking on #302) and **Leave it**.

**Answered by the owner: Reject leading zeros** — option 1 below. The count it
depended on is the one above: 0 of 205 tickets carry one, so the rule rejects
nothing that exists.

The options as filed:

1. **Reject a leading zero in the id grammar** — `validate`'s pattern becomes
   `/^[a-z]+-(?<number>[1-9]\d*)$/`, failing `dl-003` by file as
   `is not "<prefix>-<n>"` does today. One line, line-neutral, and **outside the
   lines #302 (repo-72) rewrites**, so it does not need stacking. 0 of 205
   tickets affected. Afterwards a `dl-003` file cannot pass CI's
   `status --json`, so `next-id`'s normalisation and `status`' string keys can
   no longer disagree about a ticket that exists. **Recommended.**
2. **Detect the duplicate by number** in `readTickets`' duplicate check, keying
   on prefix and `Number()` — needs exactly the lines #302 rewrites, so this
   would be stacked on #302. Leaves `dl-003` a legal spelling that `--show` and
   `depends_on` still treat as distinct from `dl-3`.
3. **Leave it**: zero occurrences, and `next-id` never proposes a padded id.

## Build

1. `scripts/status.mjs`' `validate`: the id's number is `[1-9]\d*`, in place on
   its own line, so no line of the file moves and #302's lines are untouched.
2. Tests: a padded id (`repo-003`, `repo-01`) and `repo-0` are each refused by
   file with the existing message; `repo-10` still parses. In
   `scripts/test/status-gate-record.test.ts`, because `status.test.ts`' end is
   #302's.

## Done when

- `readTickets` refuses an id whose number has a leading zero, naming the file
  and the id, and still parses one with an inner zero.
- `node scripts/status.mjs --json` on this branch still exits 0 (no ticket has
  one).
- `npm run check`, the `repo` suite and
  `node scripts/citations-gate.mjs --against origin/main` pass.

## Log

- 2026-09-27 — Filed with the measurement above, in one pull request with
  repo-73, repo-74 and repo-75. No fix committed: the orchestrator is asking the
  owner which option to take.
- 2026-09-27 — Answered (above) and built; `status` moved to `ready` in the
  commit recording it. Red before the pattern changed,
  `npx vitest run scripts/test/status-gate-record.test.ts`: `3 failed` —
  `repo-003`, `repo-01` and `repo-0` all parsed. `repo-0` was accepted by the
  old `\d+` too; ids start at 1, so it goes with the others. Green after, with
  the status and preflight suites and the spawn-safety scan:
  `Test Files 4 passed (4)`, `Tests 193 passed (193)`.

  `next-id.mjs` and `commit-message.mjs` are unchanged: `next-id` already reads
  the number, which now has one spelling, and `commit-message` does not parse
  ticket ids at all.
