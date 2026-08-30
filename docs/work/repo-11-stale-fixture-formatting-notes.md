---
id: repo-11
tool: repo
title: Two planner ticket logs still say fixtures get formatted, which repo-4 made false
kind: chore
status: done
milestone: null
depends_on: [repo-4]
---

# repo-11 — pl-15 and pl-28 carry advice that repo-4 invalidated

## Why

repo-4 anchored `.oxfmtrc.json`'s fixture entry to `**/test/fixtures/`, so
checked-in fixtures are no longer formatted. Two planner ticket logs found that
bug independently, recorded it accurately at the time, and both now read as
current advice when they are stale:

- `tools/planner/docs/work/pl-15-candidate-legs.md` (~line 123) — "**`test/fixtures/`
  is in `.oxfmtrc.json`'s `ignorePatterns` and oxfmt formats these files anyway.**
  … a fixture edit must be followed by `npm run format` or `format:check` fails.
  Nothing depends on the ignore working, so it is left as it is."
  The last sentence is now false in both halves: the ignore works, and a fixture
  edit must **not** be followed by `npm run format` — the formatter will decline
  to touch it, and `format:check` passes regardless of the fixture's shape.
- `tools/planner/docs/work/pl-28-valhalla-adapter.md` (~lines 264 and 472) —
  "F6 · no change, deliberately … widening it is a repo-wide toolchain change
  that touches both tools and wants a `repo-` ticket" and "`oxfmt` indents the
  fixture, and **`test/fixtures/` … does not actually exempt it** — worth
  knowing, and left alone rather than fixed here."
  The `repo-` ticket they are deferring to is repo-4, and it has landed.

A planner agent reading either one will run `npm run format` after editing a
fixture expecting a diff, get none, and go looking for what it broke. That is
the same twenty minutes pl-15's own note was written to save.

## Build

1. Append a dated annotation to each of the two logs — not an edit of the
   original text, which was true when written. Say that repo-4 anchored the
   pattern, name the commit, and state the two consequences: fixtures are exempt,
   and a fixture edit no longer needs `npm run format`.
2. Leave `status` on both tickets alone. Both are historical records; neither is
   reopened by this.

**This must be its own pull request, and its title must carry a `hidden` type**
— `docs(planner):` is the natural one. Both files are under `tools/planner/`, and
release-please routes by path: any non-hidden type here cuts a planner release
whose changelog line is a sentence about the repo's formatter config. `hidden`
types today are `refactor`, `docs`, `test`, `build`, `ci` and `chore` — read that
off `release-please-config.json` rather than off this sentence.

That path constraint is exactly why repo-4 did not fold this in: repo-4's own
title is `fix(repo): …`, which is not hidden, so adding either planner path to
that branch would have released planner.

## Done when

- Both logs carry a dated annotation naming repo-4 and stating that fixtures are
  now exempt and `npm run format` is no longer required after a fixture edit.
- The pull request title's type is `hidden` in `release-please-config.json`, and
  `node scripts/commit-message.mjs --text "<title>"` accepts it.
- No planner release is cut by the merge.

## Log

**2026-08-30 — done.** Both annotations appended, plus a third passage the brief
did not know about and a measurement folded into `pl-33`. Branch cut from
`origin/main` at `1d420b7`.

### The premise holds, and it was checked by measurement rather than by reading

The brief's claim rests on `.oxfmtrc.json` carrying `**/test/fixtures/`, but the
config saying so and `oxfmt` behaving so are two facts, and only the second one
matters to a reader who is about to run `npm run format`. Both halves, on this
tree, with oxfmt 0.62.0:

```
$ npx oxfmt --check tools/planner/contract/test/fixtures/road-trip.json
Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                                             # exit 2
$ npx oxfmt --check tools/planner/api/test/fixtures/valhalla-sources-to-targets.json
                                                                             # same, exit 2
```

And the behavioural half, which is the one the two logs get wrong:
`road-trip.json` re-indented to eight spaces, 4776 → 9910 bytes; `npm run format`
leaves it at 9910; `npm run format:check` then exits 0 with "All matched files
use the correct format." The fixture was restored from a copy, not from `git
checkout`, and `git status` was clean before anything was written.

repo-4 is `13d9735`, merged 2026-08-29 as #98. Named in both annotations.

### Where the brief was wrong

- **It undercounts pl-28: three passages, not two.** Beyond `:264` and `:472` it
  misses `:608`, in that Log's own `### Gates` list — "`npm run format` — run;
  the deployment doc, the adapter and the fixture were all reformatted by it."
  That is the same stale claim in the most authoritative-looking place in the
  file, a gate result. Folded in; the annotation corrects all three.
- **Its reading of pl-15's bullet does not survive the actual text.** The brief
  says "the last sentence is now false in both halves: the ignore works, and a
  fixture edit must **not** be followed by `npm run format`." Those two halves
  come from two different sentences. The `npm run format` instruction is the
  second-to-last sentence; the last one is "Nothing depends on the ignore
  working, so it is left as it is rather than fixed into a repo-wide reformat".
  The substance is right — both claims are stale — but the sentence-accounting
  is not, and the fix is not the flat negation the brief implies. "Nothing
  depends on the ignore working" was a reasonable call on a directory of JSON
  and is false for a different reason than the brief gives: no test pins the
  pattern even now, but `.claude/rules/testing.md` was written on top of it and
  records what JSON indentation hid — oxfmt reflows HTML text nodes and rewrites
  inline `<script>`, so on an `.html` fixture the formatter edits the thing under
  test. The annotation says that instead of "this sentence is false."
- **`:264` cannot be reached from an appended note, and the brief's
  append-only constraint has no answer for it.** F6 lives under `## Review`, and
  everything appended lands at the end of `## Log`, ~450 lines below. A reader
  who opens pl-28 at F6 and stops there still gets the stale advice. Complied
  with the constraint — the original text was accurate when written and editing
  it in place would destroy a gate record — and the annotation names the problem
  out loud rather than pretending the placement works.

### Folded in

- **pl-28's third passage** (`:608`), above.
- **A measurement on
  [pl-33](../../tools/planner/docs/work/pl-33-overpass-payload-and-notability.md)**,
  authorised at intake: its Build cannot be executed from this environment, with
  the evidence and, more usefully, the shape. Re-probed here rather than
  transcribed. `overpass-api.de`, `en.wikipedia.org` and `en.wikivoyage.org` all
  return `000` with curl exit 28 and `time_connect=0.000000`; `api.github.com`
  and `registry.npmjs.org` return `200`; DNS resolves all three blocked hosts; no
  proxy is set. Two probes were added beyond the ones handed over, and both earn
  their place:
  - **`https://example.com` fails identically.** This is what makes "allowlist"
    a measurement instead of an inference. Without it, three dark hosts are
    equally consistent with three outages or with something aimed at those
    hosts.
  - **`download.geofabrik.de` and `dumps.wikimedia.org` are also dark.** pl-33's
    own Build offers a self-hosted Overpass over a regional extract, and
    Wikivoyage dumps, as alternatives. Leaving them unchecked would have left a
    hole the ticket itself points at.
    `status` on pl-33 deliberately untouched: `ready` means dependencies unblocked,
    and an environment limit is not a dependency.

### Considered and not folded in

- **`.claude/rules/testing.md`, `CLAUDE.md` and `pl-29`** were all checked for
  the same stale claim and all three are already correct — testing.md at `:54`
  describes the anchored pattern and names repo-4, pl-29 at `:803` cites
  `13d9735` by hash. Nothing to do.
- **No test asserts that `.oxfmtrc.json`'s `ignorePatterns` entries match
  anything in the tree.** repo-4's own Log floats the idea and did not build it,
  and a bare `test/fixtures/` matching nothing is exactly what such a test
  catches. Not folded in: it is a `packages/core` test, not a documentation
  change, so it would put source in a branch whose whole point is that it carries
  none — and the PR-title constraint below is built on this branch touching only
  `.md`. Worth a `repo-` ticket; not filed from here, because filing is the
  orchestrator's call.

### Gates

- `npm run check` — exit 0. Run because oxfmt formats markdown here and
  `ci.yml`'s `check` job filters on nothing, so a prose-only branch can break
  `main`. `npm run format` was run first and did realign the probe table in
  pl-33, which is the whole reason that rule exists.
- `npm test` — exit 0, **1615 passed, 108 files**. The full suite rather than one
  project: no source changed, so there was nothing to scope to. The tree was
  confirmed clean of the fixture mangling first.
- `node scripts/citations.mjs` on both annotated tickets. pl-15: 1/1. pl-28:
  23/24, and **the one failure is pre-existing and not this branch's** —
  `logging.test.ts:53` at record line 154, which the resolver reports as
  ambiguous because both tools have a `logging.test.ts`. It is inside gate 1's
  acceptance table, which this ticket must not edit. Every citation this branch
  wrote resolves: `pl-15-candidate-legs.md:123` and
  `pl-28-valhalla-adapter.md:264` both print the intended line. The `:472` and
  `:608` references are bare line numbers the script does not parse as
  citations, so they were checked by hand with `sed -n '472p;608p'` and both hit
  their sentence. Appending cannot move a line above the insertion point, which
  is why all four still hold.
- **The PR title's type is `hidden`, read off the config.**
  `release-please-config.json:31` is `{ "type": "docs", "section":
"Documentation", "hidden": true }`, and `node scripts/commit-message.mjs --text
"docs(planner): correct two stale fixture notes, and record why pl-33 cannot
start here (repo-11)"` exits 0.
- **No planner release is cut** — asserted from the config above and from the
  branch touching no planner file outside `docs/work/`, not observed. Nothing
  here ran release-please, and nothing on a pre-merge branch can.
