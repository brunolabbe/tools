---
id: repo-60
tool: repo
title: A double-backtick quotation of a port number reads as a shorthand line citation
kind: fix
status: ready
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
```` ` `` `:99999` `` ` ```` reproduction a few lines above them in `repo-25`'s own record).

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
  since a double-backtick-quoted pin is the same defect and the corpus has
  none today to disturb. A skipped match is never pushed into `found` at all,
  so its `make()` never runs and it cannot set `currentFile` either — the
  mechanism the third `Done when` line asks for.

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
  (4 citations, 5 occurrences) and
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
  the 2 its `GRANDFATHERED` entry names). Tightened both `GRANDFATHERED`
  entries, `repo-25` and `pl-32`, from 2 to 1; neither ticket's own file was
  touched, only the ratchet's memory of it in `scripts/citations-gate.mjs`,
  which is squarely `repo`-scoped. `pl-32` is a `tools/planner` ticket and I
  did not add a Log entry there, since no file of its own changed — flagged
  here for whoever reviews this branch to judge whether it should.

  Verified: `npx vitest run scripts/test/citations.test.ts` 105/105 (3 new,
  102 pre-existing), `npm run check` exit 0, `npx vitest run --project repo`
  493/493, `node scripts/citations.mjs docs/work/repo-25-...md
--displaced-since origin/main` exit 0, `node scripts/citations-gate.mjs`
  "112 enforced, 0 failing; 7 grandfathered" exit 0.
