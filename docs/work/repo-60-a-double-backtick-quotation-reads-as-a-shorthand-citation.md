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
