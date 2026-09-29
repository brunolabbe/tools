---
id: repo-63
tool: repo
title: extractSections reads a backtick info string as an unclosed fence, hiding every heading after it
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-63 — `extractSections` reads a backtick info string as an unclosed fence, hiding every heading after it

## Why

Filed from repo-60 gate 1's med finding: `extractSections`'s fence-skip regex,
``/^ {0,3}(`{3,}|~{3,})/``, matches a line that opens with three or more
backticks and treats it as a code-fence opener, then hides every heading until
a line closes it with a run of the same character at least as long. CommonMark
does not read it that way for a **backtick** fence: "If the info string comes
after a backtick fence, it may not contain any backtick characters" — a line
whose backtick run is immediately followed by more backticks later on the same
line is not a valid fence opener at all, and a reader (or a renderer) does not
skip past it looking for a close.

`docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md`
hit this by construction, in its own `## Build` section, at the line (76,
before the lander's one-word prefix that works around it):

`````
```` ` `` `:99999` `` ` ```` reproduction a few lines above them in `repo-25`'s own record).
`````

Four backticks open, and the rest of the line carries more backticks — a
CommonMark reader never treats this as a fence at all, since the would-be info
string contains backtick characters. `extractSections`'s regex only checks the
opening run, not the info string, so it opens a fence here and never finds a
closer (nothing else in the file has a run of four or more backticks), which
silently swallows every heading below it — `## Done when`, `## Log`, and
critically `## Review` once a gate's section is spliced in.

Reproduced at `247073d` (repo-60's branch tip, before the one-word prefix):

```
$ node -e '
import { extractSections } from "./scripts/citations.mjs";
import fs from "node:fs";
const md = fs.readFileSync("docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md", "utf8");
for (const s of extractSections(md)) console.log(JSON.stringify(s));
' --input-type=module
{"title":"repo-60 — a double-backtick quotation reads as a shorthand citation","level":1,"start":12,"end":187}
{"title":"Why","level":2,"start":14,"end":64}
{"title":"Build","level":2,"start":65,"end":187}
```

`## Done when` and `## Log` never appear — everything from line 65 to the end
of the file is read as `Build`'s span. Two real consumers read `extractSections`
this way and are both affected, silently:

- `scripts/citations-gate.mjs`'s `SCOPE.section = "Review"` finds no `## Review`
  heading in a record shaped like this, so the record drops out of the gate's
  119-record corpus entirely rather than failing or erroring — invisible, not
  loud.
- `scripts/review-record.mjs` anchors a first gate's insertion on the `## Log`
  heading (`citations.mjs`'s own `extractSections`, reused). A record whose
  brief has this shape ahead of `## Log` would have nothing for the script to
  anchor on — unmeasured here whether it errors or inserts somewhere wrong, and
  worth checking as part of this ticket's Build.

This is present at `origin/main`'s current tip too, wherever a record's prose
writes an example fence long enough to nest a shorter one, which is exactly the
shape a ticket about backtick-quotation syntax is likely to need again.

## Build

Teach the fence check in `extractSections` (`scripts/citations.mjs`) that a
**backtick** fence's info string may not itself contain a backtick — per
CommonMark, a line opening with a run of three or more backticks only opens a
fence if the remainder of that line, after the run, contains no additional
backtick character. A **tilde** fence has no such restriction and is unaffected.

Concretely: when the matched fence character is `` ` `` and the text following
the matched run (trimmed or not — CommonMark trims the info string but a
backtick anywhere in it disqualifies it either way) contains another `` ` ``,
this line does not open (or close) a fence — treat it as ordinary text and keep
scanning for headings normally.

Check `scripts/review-record.mjs`'s `## Log` anchor against a record shaped
this way (an unclosed-per-the-old-rule fence ahead of `## Log`) while making
this change, since the Why above left it unmeasured whether it fails loud or
silent.

Do not widen into anything else `extractSections`'s fence-skip does — this is
narrowly the backtick-info-string rule, not a general CommonMark fence rewrite.

## Done when

- A test plants a line resembling repo-60's own (a backtick run of length N
  followed later on the same line by more backticks) and shows
  `extractSections` finds every heading after it, matching what a CommonMark
  reader would.
- A test confirms an ordinary backtick or tilde fence — no backtick in the info
  string, or a tilde fence with one — still hides headings inside it, unchanged.
- `docs/work/repo-60-...md`'s own line (once its one-word prefix workaround is
  no longer needed) is covered by, or cited as, one of the above.
- `npx vitest run scripts/test/citations.test.ts` and `npm run check` both pass.

## Review

**Gate: PASS** — 2026-09-27 · `1a8321c...e55c577` (base `1a8321c`, still the tip of `origin/main` after this gate fetched; head `e55c577` on `repo-63-backtick-info-string`) · code-review at medium

| Done when                                                                                                                  | Proof                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A test plants a line shaped like the one in repo-60 and `extractSections` finds every heading after it, as CommonMark does | `scripts/test/citations.test.ts@2ffb72a:2880 "does not read a backtick info string as an unclosed fence"`, asserting `scripts/test/citations.test.ts@2ffb72a:2891 "level: 2, start: 3, end: 4"` and `scripts/test/citations.test.ts@2ffb72a:2892 "level: 2, start: 5, end: 6"` ✓ — red against the base `citations.mjs` (1 failed of 108)   |
| An ordinary backtick fence, and a tilde fence with a backtick in its info string, still hide headings                      | `scripts/test/citations.test.ts@2ffb72a:2903 "expect(extractSections(backtick))"` and `scripts/test/citations.test.ts@2ffb72a:2908 "expect(extractSections(tilde))"` ✓ — green at the base by design; a mutant that drops the backtick-only condition fails it (1 of 108)                                                                   |
| The repo-60 line, its prefix removed, is covered                                                                           | `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md:76 "reproduction a few lines above them in"` now opens with the backtick run, and the first row planted it verbatim up to that word ✓ — the real file reads `Done when`, `Review` and `Log` at the head, and only `Why` and `Build` under the base function |
| `npx vitest run scripts/test/citations.test.ts` and `npm run check` pass                                                   | **verified** — 108 of 108 (base: 100 top-level tests, head 102, no test line deleted); `npm run check` exit 0; `npx vitest run --project repo` 506 of 506                                                                                                                                                                                   |

- **low** · `scripts/status.mjs:326 "function hasGateRecord(text)"` keeps a fence reader of its own — any line that starts with three backticks or three tildes flips it, with no info-string, character or length rule — so it carries the shape this ticket fixed, and more. Measured with `node scripts/status.mjs --json`, `reviewed` for repo-60 is true at the base and false at the head, because the workaround this branch removes was what kept that line from flipping it. Nothing changes today: `reviewedButReady` reads only `ready` tickets and repo-60 is `done`. It also reads this ticket wrong, pre-existing at the base: with this section spliced above `## Log` and `status` left `ready`, `status.mjs` reports `reviewed` false for repo-63 and exits 0 with an empty problems list, because the brief quotes a four-backtick line inside a five-backtick fence. So the reviewed-but-ready check cannot catch this ticket landing without its `status` flipped. The open decision on it is in the gate report.
- **dropped** · pre-existing at the base: a closing fence followed by a non-backtick info string (three backticks, then ` foo`) still closes, at base and head alike, where CommonMark 4.5 allows only spaces or tabs after a closer. The brief scoped this out, as not a general CommonMark fence rewrite.
- **dropped** · the second new test cannot go red at the base: it guards the old behaviour, and the mutant above shows it catches a fix that reaches tilde fences. Not a defect.
- **dropped** · at the base, `planInsertion` with `--gate 2` on a record of this shape threw a misleading no-Review-yet error; the Log checks only the first-gate path, `scripts/review-record.mjs@2ffb72a:191 "cannot find the"`. Both paths return the right line at the head, so the fix makes it moot.
- **findings** · code-review at medium returned 4; 1 carried, 3 dropped.
- Blast radius: `extractSections` is called by `citations.mjs` for `--section`, by `citations-gate.mjs` and by `review-record.mjs`; `status.mjs` and `preflight.mjs` do not call it, and preflight reaches it through `citations-gate`. Section lists, base function against head function, over all 205 records under `docs/work` and `tools/*/docs/work`: 1 changed in the head tree (repo-60), 0 in the base tree. repo-60 `--section Review`: 35 references, exit 0 at the head; the base script on the same file exits 1, no section matches Review. `citations-gate --against origin/main`: 124 records, 118 enforced, 0 failing, exit 0. `preflight` with the PR title: exit 0.
- CommonMark 4.5 probe: 20 inputs through both functions; the head agrees on 19, the base on 14, and the one the head misses (the closer above) the base misses too.
- NFR: security n/a · performance n/a, one slice and one search per fence-shaped line · reliability ✓, a `## Review` can no longer drop silently out of the gate · maintainability — the low above.

## Log

- 2026-09-27 — Filed from repo-60 gate 1's med finding (code-review at medium,
  `c87153d...247073d`): present at the base, in repo-60's own brief, not
  introduced by that ticket's fix. The owner chose (a), the gate's own
  recommendation, over fixing `extractSections` in the same branch — filed here
  instead, so repo-60 does not widen past the citation-extraction change its
  own Build asked for.

- 2026-09-27 — Built. `extractSections` (`scripts/citations.mjs`) now checks,
  for a matched fence line whose character is a backtick, whether the text
  after the matched run itself contains another backtick; if it does, the line
  disqualifies as a fence opener or closer and scanning continues normally. A
  tilde fence is untouched, per the Build's own scope note. Two tests added at
  the end of `scripts/test/citations.test.ts` (new tests go at the end of the
  suite so they do not shift the line numbers merged `## Review` sections cite
  — an earlier mid-file draft of this same change failed
  `node scripts/citations-gate.mjs --against origin/main` on four unrelated
  records for exactly that reason, moved rather than fixed): one plants
  repo-60's own backtick-run-then-more-backticks shape and shows every heading
  after it is found; the other confirms an ordinary backtick fence and a tilde
  fence with a backtick in its info string still hide headings inside them.

  Checked `scripts/review-record.mjs`'s `## Log` anchor against a record shaped
  this way, per the Build's ask: with the pre-fix `extractSections` (copied
  from `origin/main` into scratch and driven directly, since the fix already
  lands in the same file otherwise), `selectSection(level2, "Log")` throws `no
section matches "Log"`, and `planInsertion` wraps that in `cannot find the
"## Log" heading to anchor the splice on: …` — a loud, named failure, not a
  silent wrong-place insertion. No change to `review-record.mjs` was needed;
  the underlying `extractSections` fix is what removes the failure mode.

  Folded in: `docs/work/repo-60-a-double-backtick-quotation-reads-as-a-shorthand-citation.md`'s
  own Build line no longer needs the one-word `literal` prefix it was worked
  around with (repo-60's Log, gate 1 med) — removed it and logged the removal
  there, satisfying this ticket's third Done-when directly rather than only
  citing the shape in a synthetic fixture.

  Verified: `npx vitest run scripts/test/citations.test.ts` 108/108;
  `npm run format` then `npm run check` exit 0;
  `node scripts/citations-gate.mjs --against origin/main` — `118 enforced, 0
failing; 6 grandfathered, holding 1 unresolvable, 19 unanchored. 6
entr(y/ies) compared against origin/main: 0 raised.`, exit 0;
  `npx vitest run --project repo` 506/506;
  `node scripts/preflight.mjs --base origin/main` exit 0.
