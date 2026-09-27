---
id: repo-63
tool: repo
title: extractSections reads a backtick info string as an unclosed fence, hiding every heading after it
kind: fix
status: ready
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

## Log

- 2026-09-27 — Filed from repo-60 gate 1's med finding (code-review at medium,
  `c87153d...247073d`): present at the base, in repo-60's own brief, not
  introduced by that ticket's fix. Following the gate's own recommendation (a),
  filed here instead of widening repo-60 past the citation-extraction change
  its own Build asked for: `extractSections` is narrower than the tickets that
  cite it.
