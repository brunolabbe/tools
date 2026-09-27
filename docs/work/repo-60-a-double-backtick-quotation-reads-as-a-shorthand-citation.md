---
id: repo-60
tool: repo
title: A double-backtick quotation of a port number reads as a shorthand line citation
kind: fix
status: in-flight
milestone: null
depends_on: []
difficulty: standard
---

# repo-60 — a double-backtick quotation reads as a shorthand citation

## Why

`` `:443` `` inside a **double-backtick** markdown span is a quotation — a
reviewer writing about the exact backtick syntax something else misreads,
the way `docs/work/repo-25-citations-checker-misses-shorthand-references.md`
does for `dl-38`'s port numbers. `scripts/citations.mjs`'s `SHORTHAND` regex
cannot tell that apart from an ordinary shorthand citation, `` `:443` `` used
to mean line 443 of the file named above it: both are a backtick, a colon, a
number, a backtick, and the double backticks that mark a quotation are not
part of what `SHORTHAND` matches against, so they are invisible to it.

repo-50's `--displaced-since` is what turned this from a cosmetic
misclassification into a live failure. Before it, a misread port merely
resolved to whatever line that number happened to name in the inherited
file — visible as a loud, ordinary failure the moment the file was too short,
and silent (`unanchored`, uninteresting) the rest of the time. `--displaced-since`
adds a third outcome: if the misread line's text differs from what it read at
some earlier ref, the quotation is reported `displaced`, a state a
`<!-- citations: evidence -->` declaration cannot excuse (`displaced`'s own
non-excusability is deliberate, matching `unpinned-volatile`) and that no
coordinate edit can fix without rewriting what the reviewer's prose actually
says — repo-50 gate 2 recommended editing the coordinates and pinning the
citation, but the owner chose instead to keep repo-25's text byte-identical
to origin/main, letting `` `:443` `` stand unedited in the gate record even
though the coordinates it carries are unanchored.

So today `docs/work/repo-25-citations-checker-misses-shorthand-references.md`
fails `--displaced-since` on this branch, permanently, unless this defect is
fixed or the record's wording is edited — neither of which repo-50 does.
Reproduced at `5ad3286` (repo-50's branch tip):

```
$ node scripts/citations.mjs docs/work/repo-25-citations-checker-misses-shorthand-references.md --displaced-since origin/main
...
10 verified, 0 moved, 7 unanchored, 0 unresolvable, 13 unchecked, 18 evidence, 1 displaced — of 49 references, 9 pinned
exit 128 — 1 displaced
```

The record's own line 196 reads (unedited, exactly as committed):

```
- **low** · `dl-38`'s backticked port numbers (`` `:443` ``/`` `:8443` ``) were misread as shorthand line citations, ...
```

`` `:443` `` here is inside a double-backtick span (` ` `:443` ` `), which
is markdown's own way of escaping a literal backtick inside quoted text — the
whole point of the sentence is that this text is an example of the
misreading, not an instance of it. `SHORTHAND`'s regex requires only a single
backtick immediately before and after the token, so it matches the _inner_
pair and ignores that an _outer_ pair of backticks surrounds the whole thing.

## Build

Teach `extractCitations` (or the regexes it composes, `SHORTHAND` and
`INLINE`) to recognise a double-backtick span and skip scanning inside it for
a shorthand or inline citation, the same way a fenced code block is already
skipped for heading detection in `extractSections`. A double-backtick span is
` ` ... ` ` in CommonMark: two backticks, content, two backticks, and the
content may itself contain single backticks. `scripts/citations.mjs`'s own
top docblock already writes several — search it for ` ` ` `` to find real
examples to test against, including at least one that quotes a citation-shaped
token on purpose (the port examples this ticket is filed from, and the
literal ```` ` `` `:99999` `` ` ```` reproduction a few lines above them in `repo-25`'s own record).

**The reproduction is inside a fenced code block was considered and is not
the same shape**: `extractSections`'s fence-skip is about _heading_ detection
specifically and does not touch `extractCitations`'s own scan, which
deliberately reads inside fences (a changelog fragment quoting an anchor is
real content to check, per that function's own docblock). This ticket is
narrower — only a double-backtick _inline span_, not a fenced block — and
should not widen to touch fence handling.

Watch the paragraph-inheritance rule (`nearby`, `currentFile`, `currentRev`):
a citation inside a skipped double-backtick span must not update
`currentFile` either, or a later, real shorthand on the same line or in the
same paragraph would inherit from a phantom citation the reproduction quoted
rather than from the citation actually meant.

## Done when

- `node scripts/citations.mjs docs/work/repo-25-citations-checker-misses-shorthand-references.md --displaced-since origin/main` exits 0 (no other change to that record), with the double-backtick port quotation no longer read as a citation at all — not `unanchored`, not `displaced`, absent from the reference count.
- A quoted shorthand (`` ` `` `:99999` `` ` ``, the reproduction earlier in the same record) is likewise not read as a citation.
- A real shorthand elsewhere in the same record, inheriting from a qualified citation that appears _before_ a double-backtick quotation, still resolves against the right file — the quotation must not consume or reset `currentFile`.
- A test plants a double-backtick quotation of a citation-shaped token in a fixture record and shows it uncounted; the same fixture with single backticks around the same token is still read as a citation, so the fix is "double-backtick is a quotation" and not "this token never parses".
- `npx vitest run scripts/test/citations.test.ts` and `npm run check` both pass.

## Log

- 2026-09-26 — Filed from repo-50 gate 2's med finding, on the owner's decision
  (option (b) over the gate's own recommended (a)): repo-25's Review-section
  text describing this exact misreading stays byte-identical to `origin/main`
  rather than being edited to carry a pin, and `--displaced-since` fails on it
  until this ticket is built. Neither CI nor `preflight.mjs` passes the flag
  today, so nothing enforced fails in the meantime.
- 2026-09-27 — Built. The Why's reproduction (`exit 128 — 1 displaced` at
  `5ad3286`) does not reproduce against today's `origin/main`: at `5ad3286`,
  `node scripts/citations.mjs docs/work/repo-25-...md --displaced-since
origin/main` exits 0, not 128. What moved is the ref, not the record —
  `origin/main` at the time the Why was written was `1e3204e`, main's tip
  _before_ repo-50's own PR (#291) merged as `9fb2096`. Re-run with
  `--displaced-since 1e3204e` against the same `5ad3286` tree: `exit 128 — 1
displaced`, matching the quoted output exactly. Once repo-50 merged,
  `origin/main` caught up to the tree `docs/work/repo-25-...md` already
  described, so the drift `--displaced-since` was built to catch had nothing
  left to catch it against — until this ticket's fix, which uncovers it
  again for a different reason (below).

  Fixed by teaching `extractCitations` a `DOUBLE_BACKTICK` span
  (`/\x60\x60(?:(?!\x60\x60).)*?\x60\x60/g`) and skipping a match of
  `INLINE`, the `PIN_SHAPED` pair, `SHORTHAND` or `SHORTHAND_PIN` whose start
  falls inside one — applied to all four, not only the two the Build names,
  since a double-backtick-quoted pin is the same defect. **Gate 1 found this
  claim wrong** — "the corpus has none today to disturb" — and it was, on my
  own re-run rather than taken on the gate's word:
  `docs/work/repo-31-the-windows-leg-is-almost-all-red.md` record line 103
  carries `` `scripts/test/citations.test.ts@fdafd1a:1331` `` (anchor omitted
  here) inside a
  double-backtick span, a real pinned, anchored citation, and it lost its
  anchor under this first version of the rule. Fixed in the same round as the
  gate-1 write-up below (the anchor carve-out); this sentence is corrected
  rather than deleted so the mistake stays legible. A skipped match is never
  pushed into `found` at all, so its `make()` never runs and it cannot set
  `currentFile` either — the mechanism the third `Done when` line asks for.

  **The first `Done when` line's parenthetical ("no other change to that
  record") does not fully hold, and I made the change anyway.** Fixing the
  defect removes the quoted `` `:443` ``/`` `:8443` ``/`` `:99999` `` matches
  at record lines 150, 195, 196, 522 and 534 from the reference count
  entirely — which is what the ticket asks for — and that leaves two of the
  record's `<!-- citations: evidence -->` declarations (record lines 130 and 204) naming a location, `` `index.ts:443` `` and
  `` `scripts/citations.mjs:8443` ``, that nothing in the record cites any
  more. `applyDeclarations` correctly refuses that as stale (`exit 8 — 2
stale evidence declaration`, `... is declared evidence, but this record
does not cite it`), which is the script's own documented behavior for
  exactly this situation ("a citation whose failure was fixed should lose its
  declaration in the same edit"). I trimmed both declarations to drop the
  now-dead entries only (`` `index.ts:440` `` and the other two locations in
  each stay); the reviewer's
  prose — the bulleted text the ticket's Why is about keeping
  byte-identical — is untouched. `--displaced-since origin/main` now exits 0.
  Recorded here rather than asked as an open decision because the mechanism's
  own error message names this exact remedy; there was no second reading of
  it to weigh.

  Also updated `extractCitations`'s own docblock (the paragraph naming this
  exact repo-25 tight-list example for the `nearby` rule), which the fix
  otherwise leaves silently false: the citations it describes as failing and
  needing a declaration no longer exist post-fix. Rewritten in the past tense
  with a pointer to `citations.test.ts` for the mechanism it was
  illustrating.

  **Two knock-on effects from editing `scripts/citations.mjs` itself,
  neither anticipated by the Build.** First: inserting the new regex and its
  guard shifted every line below it by 34, which `node scripts/citations-gate.mjs`
  (not named in this ticket, but what `preflight.mjs`'s citations check
  actually runs) caught as `moved` against two already-merged, already-gated
  records that cite `scripts/citations.mjs` by line with an anchor —
  `docs/work/repo-50-citations-cannot-see-a-displaced-unanchored-citation.md`
  (**correction, gate 1**: 5 distinct citations across 4 record lines, not "4
  citations, 5 occurrences" as first written here — record line 93 alone
  repoints two) and
  `docs/work/repo-52-citations-into-claude-pages-are-pinned-or-by-heading.md`
  (2 citations, 3 occurrences). Repointed each to the line the same anchor
  text now holds — verified individually before editing — per the tool's own
  documented remedy for `moved` ("repoint it at the line that now holds what
  it meant to say"); their prose is otherwise untouched. Second: the general
  fix also removes a real, independent false positive from
  `tools/planner/docs/work/pl-32-vite-config-test.md`'s own Review section —
  a parenthesised `` `(`:23`)` `` quoting the shorthand syntax, same shape as
  this ticket's own case, at that record's line 79 — which
  `citations-gate.mjs` reported `STALE` (holds 1 failing reference now, not
  the 2 its `GRANDFATHERED` entry names). Tightened `pl-32`'s entry from 2 to
  1; `repo-25`'s went from 2 to 1 in this same commit, then — gate 1, med,
  correctly — all the way out of `GRANDFATHERED`, once dropping the also-dead
  `99999` entry from record line 204's declaration (its only remaining
  citation, record line 469, is separately excused by the declaration at
  record line 210) left the whole record's Review-scoped debt at zero.
  Neither ticket's own file was touched, only the ratchet's memory of it in
  `scripts/citations-gate.mjs`, which is squarely `repo`-scoped. `pl-32` is a
  `tools/planner` ticket and I
  did not add a Log entry there, since no file of its own changed — flagged
  here for whoever reviews this branch to judge whether it should.

  Verified: `npx vitest run scripts/test/citations.test.ts` 105/105 (3 new,
  102 pre-existing), `npm run check` exit 0, `npx vitest run --project repo`
  493/493, `node scripts/citations.mjs docs/work/repo-25-...md
--displaced-since origin/main` exit 0, `node scripts/citations-gate.mjs`
  "112 enforced, 0 failing; 7 grandfathered" exit 0.

- 2026-09-27 — Gate 1 (FAIL) fixed. Each finding reproduced before touching
  anything; verdicts below.

  **High, fixed as the owner's chosen (a): skip a quoted reference only when
  it carries no anchor.** Reproduced first: the unconditional skip dropped 23
  real, anchored citations from `docs/work/repo-31-the-windows-leg-is-almost-
all-red.md`'s Review section alone (5 references there fell to 2; the
  whole-record `moved` count went from 6 to 0 — live drift hidden, matching
  the gate's framing exactly). Fixed by moving the `inQuotation` check in the
  `INLINE` and `SHORTHAND` passes to after each match's groups are read, and
  gating the skip on `g.anchor === undefined` (`INLINE`) or `g.inner ===
undefined && g.outer === undefined` (`SHORTHAND`); `PIN_SHAPED` and
  `SHORTHAND_PIN` are left unconditional, since neither carries an anchor
  concept at all, so the same gate would always be true there. Verified: the
  repo-31 Review section is back to 5/5 `ok`, the whole-record run is back to
  `exit 2 — 6 moved` (matching base exactly), repo-25's command still exits 0
  on the same 37 references, and a corpus-wide scan (`extractCitations` at
  base vs. head, over every `docs/work/*.md` and `tools/*/docs/work/*.md`)
  shows a delta of exactly 39 references removed — the same number the gate
  measured in its own scratch copy — none of them state-changed, none added.

  **Med, fixed: `DOUBLE_BACKTICK`'s closing run must equal the opening
  one's length, not merely meet it.** Reproduced: a triple-backtick span
  closed on only the first two of its three closing backticks, leaving one
  dangling. Fixed with a backreference, `/(\x60{2,})[\s\S]*?\1(?!\x60)/g`;
  verified the repo-25 four-backtick reproduction, the two-spans-per-line
  case, and the triple-backtick probe all still resolve correctly, and the
  corpus scan above is unchanged by this half (0 hits, as the finding said).

  **Med, fixed: the Done-when-3 test replaced.** Reproduced the gate's
  mutation by hand — letting the `INLINE` pass's guard set `currentFile`
  before its `continue` — against the _old_ fixture (a quotation holding
  only a shorthand): stayed green, confirming the finding. The _new_ fixture
  quotes a qualified `INLINE` citation into a second file instead; against
  the same mutation it resolves the trailing shorthand to the quoted file
  (`b/two.ts` rather than `a/one.ts`), red as intended, green on the
  unmutated code and on every other test in the file.

  **Med, fixed per the owner's decision (a): the Build's line 76 prefixed
  with one word when landing this section, and the `extractSections`
  divergence filed as `repo-63`.** Reproduced: `extractSections` on this
  ticket's own file read `## Build` as swallowing `## Done when` and
  `## Log` both, because CommonMark does not treat a backtick run followed
  by more backticks on the same line as a fence opener at all (a backtick
  info string may not contain a backtick), and this file's own reproduction
  of `` `:99999` `` is written exactly that way. Not this ticket's to fix —
  its own Build says not to widen into fence handling — so filed as
  `repo-63` with the reproduction, and worked around here only by moving
  "literal" to open the physical line instead of the backtick run (oxfmt
  does not reflow a line that already fits the width, so a word appended to
  the _previous_ line — my first attempt — left line 76 untouched; moving it
  to open the line itself survives formatting). Verified:
  `extractSections` on the fixed file finds `Build`, `Done when` and `Log`
  each as their own section.

  **Low, fixed: the prose-pass finding.** Confirmed it goes away under the
  high's fix — verified directly, no `line 99` reference appears for
  `repo-31` any more since the citation around it is read again.

  **Low, accepted as documented, not fixed: backtick-adjacency and
  per-line scope (two findings).** Both 0 corpus hits, both would need
  either single-backtick span state or cross-line lexing that nothing else
  in this scan does, disproportionate to a low with no live instance.
  Documented in `DOUBLE_BACKTICK`'s own docblock instead, including the
  fence-inside-quotation half, which is this same per-line limitation
  cutting the other way (hides a citation `extractCitations` deliberately
  still reads inside a fence) rather than a new one.

  **Log corrections** (three, all confirmed by re-running rather than taken
  on the gate's word): the entry above is corrected in place rather than
  silently — "the corpus has none today to disturb" (a double-backtick pin)
  was wrong, `repo-31` record line 103 has one and it was disturbed until
  the high's fix; "(4 citations, 5 occurrences)" for `repo-50` was backwards,
  it is 5 distinct citations across 4 record lines; and the exit-128
  reproduction claim holds exactly as the gate re-confirmed.

  **Open decisions closed by the owner, not by me**: all three were
  answered through the coordinator's `AskUserQuestion`, each choosing the
  gate's own recommendation. Nothing left open from this round.

  **`pl-32`**: no Log entry added there, per the gate's own "dropped"
  disposition (not a defect; a `fix(repo)` pull request touching a
  `tools/planner` path releases that tool for a change describing nothing
  planner-specific) — reversing the flag I raised in the entry above.

  Verified after all of the above: `npx vitest run scripts/test/citations.test.ts`
  105/105, `npm run check` exit 0, `npx vitest run --project repo` 493/493,
  `node scripts/citations.mjs docs/work/repo-25-...md --displaced-since
origin/main` exit 0, `node scripts/citations-gate.mjs` "113 enforced, 0
  failing; 6 grandfathered" exit 0.
