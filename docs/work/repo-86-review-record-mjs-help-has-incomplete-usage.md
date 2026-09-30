---
id: repo-86
tool: repo
title: review-record.mjs --help prints only the first usage line
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: mechanical
---

# repo-86 — review-record.mjs --help prints only the first usage line

## Why

`scripts/review-record.mjs --help` is not a recognised option: it prints
`unknown option --help`, only the first of the script's three usage lines, and
exits 1. The other two are not printed anywhere a caller can reach without
reading the source: `--verify` at
`scripts/review-record.mjs@b658179:597 "--verify <ticket-file> <section-file>"`
and `--land` at
`scripts/review-record.mjs@b658179:921 "--land <ticket-file>"`. Three landing
fixers in the 2026-09-30 batch needed `--verify`/`--rev` and did not find it in
the output.

**Reproduction** (run from the repository root at `b658179`):

```
$ node scripts/review-record.mjs --help; echo "exit=$?"
unknown option --help
usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]
exit=1
```

## Build

Make `scripts/review-record.mjs` print all three usage lines when it is given
`--help`. The real lines, as the script has them, are:

```
usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]
usage: node scripts/review-record.mjs --verify <ticket-file> <section-file> [--gate <n>] [--rev <rev>]
usage: node scripts/review-record.mjs --land <ticket-file> <section-file>... --base <ref> --status done|in-flight --title "<title>"
```

**Open choice for the builder to settle in the Log:** whether `--help` should
exit 0 (a requested help text is not a failure) or keep exit 1, as the unknown
option does today. Not decided here.

## Done when

- `node scripts/review-record.mjs --help` prints all three usage lines.
- `npm run check` passes.

## Log

- 2026-09-30 — Filed from landing fixer reports, reproduced at b658179.
  Three fixers on 2026-09-30 reported needing `--verify`/`--rev` without
  finding them in the usage line printed by `--help`.
