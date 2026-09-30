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

`scripts/review-record.mjs --help` prints an incomplete usage message. The
script has three usage lines — `--gate`, `--verify`, and `--land` — but only
the first is shown. Three landing fixers in the 2026-09-30 batch needed
`--verify`/`--rev` and did not find it in the output.

## Build

Update `scripts/review-record.mjs` to print all three usage lines when
`--help` is requested. The full usage should show:

```
usage: node scripts/review-record.mjs <ticket-file> <section-file> [--gate <n>]
usage: node scripts/review-record.mjs <ticket-file> <section-file> --verify [--rev <sha>]
usage: node scripts/review-record.mjs <ticket-file> <section-file> --land
```

## Done when

- `node scripts/review-record.mjs --help` prints all three usage lines.
- `npm run check` passes.

## Log

- 2026-09-30 — Filed from landing fixer reports, reproduced at b658179.
  Three fixers on 2026-09-30 reported needing `--verify`/`--rev` without
  finding them in the usage line printed by `--help`.
