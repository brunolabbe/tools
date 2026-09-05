---
id: repo-24
tool: repo
title: status.mjs renders a quoted frontmatter scalar with its quotes
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-24 — status.mjs renders a quoted frontmatter scalar with its quotes

**Blocked on the Decision below.** Do not start until it is answered: the three
options produce different parsers, and two of them change what the ticket format
accepts. The Build section assumes an answer and says which.

## Why

`parseScalar` (`scripts/status.mjs:115-118`) returns the raw remainder of the
line:

```js
function parseScalar(value) {
  const trimmed = value.trim();
  return trimmed === "null" || trimmed === "" ? null : trimmed;
}
```

Nothing strips surrounding quotes, so a frontmatter value written the way YAML
would write it keeps its quotation marks all the way into rendered output.

The parser's own docblock (`scripts/status.mjs:66-78`) says it is "deliberately
strict" and that a key nobody agreed on "is a named failure rather than a row
quietly missing from a table". Carrying quotation into a rendered title is
neither strict nor named — it is a third behaviour the docblock does not allow
for. That is the argument that this is a defect and not a documented limitation.

### It survived a full gate round, and that bounds the severity

repo-22's gate ran `npm run status -- --show repo-22`, recorded it as exiting 0,
and was correct: it did. **The exit code was never wrong; only the rendering
was, and the gate asked about the exit code.** That is worth stating precisely,
because it is what a reader needs in order to size this:

- **`--json`'s exit code is unaffected by a quoted `title`, `note` or
  `milestone`.** Measured below: exit 0, `problems: []`. `EXIT_ON_PROBLEMS` is
  `["json"]` (`scripts/status.mjs:610`) and it fires only on a dangling
  dependency or a gate record on a `ready` ticket. CI's board gate is
  `node scripts/status.mjs --json > /dev/null` (`.github/workflows/ci.yml:115`),
  so a quoted title never turns CI red.
- **A quoted `depends_on` entry is a different story and does reach the exit
  code.** See the third row of the field table below. That is a correction to
  the framing this ticket was filed under, not a restatement of it.

### Blast radius today

One ticket, now zero. repo-22 was the only ticket on the board rendering with
literal quote marks; every sibling rendered clean. `command grep -rn '^title: *"'`
and the equivalents for `note:` and for a quoted `depends_on` entry match nothing
under `docs/work/` or `tools/*/docs/work/` on `main`. So this is a defect worth
filing rather than an outage worth fixing in place — which is why it is here and
not folded into repo-22.

Found by repo-23's filer, which hit the same wall writing its own title and
sidestepped it by rewording. **Two authors reached for YAML quoting in two
days**, which is the frequency argument for fixing rather than only documenting.

## The reproduction

### The live case, captured before it was reworded

repo-22's title had to be quoted because it opened with a backtick, which YAML
reserves as an indicator character. The quoted title is in
`docs/work/repo-22-grep-is-a-wrapper.md` on `repo-file-grep-wrapper-ticket`
(PR #150), introduced at **`693e7f2`** and last carried at **`e605d54`**:

```yaml
title: "`grep` here is a wrapper that silently honours ignore files"
```

It was reworded away at **`4f63e10`**, whose Log entry states in the ticket
itself that the reword "was a workaround, not a fix" and that "the parser still
keeps quotes on any title that genuinely needs them". Cite `e605d54`, not the
branch tip — the tip no longer reproduces.

### Run it

Reproduced 2026-09-05 against `origin/main` at `c37cab9`, using the real bytes
of repo-22 at `693e7f2` in a scratch root. `status.mjs` takes `--root`; the
fixture shape is `repoWith` in `scripts/test/status.test.ts:29`, and the empty
`tools/` directory is required because the walk scans it.

```bash
R=$(mktemp -d); mkdir -p "$R/docs/work" "$R/tools/downloader/docs/work"
git show 693e7f2:docs/work/repo-22-grep-is-a-wrapper.md \
  > "$R/docs/work/repo-22-grep-is-a-wrapper.md"
node scripts/status.mjs --root "$R" --show repo-22
node scripts/status.mjs --root "$R"
node scripts/status.mjs --root "$R" --markdown
node scripts/status.mjs --root "$R" --json; echo "exit=$?"
```

Quotes in, literal quotes out, on every rendering path. Observed:

```text
--show      repo-22  "`grep` here is a wrapper that silently honours ignore files"
default     • repo-22 "`grep` here is a wrapper that silently honours ignore files"
--ready     repo-22	repo	"`grep` here is a wrapper that silently honours ignore files"
--markdown  the "What it is" cell carries the quotes, and the column width is
            computed from the quoted string
--json      "title": "\"`grep` here is a wrapper ...\"" — problems: [], exit 0
```

### What else is affected — measured field by field

Every row below was run, not reasoned. The fields split three ways, and the
split is the useful part:

| Field                                                        | Quoted behaviour                                                                                                                                                                                                                                                                  | Exit  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `id`, `kind`, `status`, `tool`, `difficulty`                 | **Fails loudly.** Validated against a list or against the filename, so a quoted value is a named error — for example `""ready"" is not a status. Use one of: ready, in-flight, done, dropped`                                                                                     | 1     |
| `title`, `note`, `milestone`                                 | **Silently carries the quotes** into every render. A quoted `milestone: "m1"` additionally groups as a second, distinct milestone alongside an unquoted `m1`, producing two rows for one milestone                                                                                | 0     |
| `depends_on`, via `parseList` (`scripts/status.mjs:121-129`) | **Silently corrupts.** `depends_on: ["repo-90"]` yields the entry with its quotes, which matches no ticket id, so `danglingDependencies` raises `depends_on ""repo-90"", which is not a ticket` — a false problem naming a ticket that exists, with doubled quotes in the message | **1** |

So `parseList` has the same gap and a worse consequence: it is the one path
where quoting a value fails CI's board gate on a ticket that is actually sound.

### The quoting was never required by this parser

The line grammar is `^(?<key>[a-z_]+): ?(?<value>.*)$` — the value is the rest of
the line, taken literally. An unquoted leading backtick parses and renders
correctly. This frontmatter line:

```text
title: `grep` here is a wrapper that silently honours ignore files
```

renders as `` `grep` here is a wrapper that silently honours ignore files ``,
exit 0. Verified. The quotes in repo-22 were YAML habit, not a requirement of
`status.mjs`. That matters twice: it makes the "reject quotes" option below
viable rather than a dead end, and `docs/01-TICKETS.md` never says either way.

## Decision

`docs/01-TICKETS.md` documents the fields but **never mentions quoting**, and its
worked example (`docs/01-TICKETS.md:51`) shows an unquoted title. `status.mjs`'s
docblock says the grammar is "the subset the tickets actually use ... **Not
YAML, and not pretending to be**". So there is no existing rule to read the fix
off, and the options differ in what the format accepts afterwards.

`status.mjs` is the **only** reader of this frontmatter — `parseFrontmatter` has
no caller in `scripts/`, `.claude/hooks/` or `.github/` other than
`scripts/test/status.test.ts`. So whichever option is picked, nothing outside
this file has to agree with it.

**Option A — strip matched surrounding quotes in `parseScalar`.** Accepts the
YAML-ism, so an author who quotes out of habit gets what they meant. Cheapest
for authors, and the only option under which an already-quoted ticket file
starts rendering correctly with no edit to it. Costs: it introduces an escaping
question the grammar has never had, and it can corrupt a legitimate value.
Concretely, `title: "ready" does not mean "startable"` both starts and ends with
a quote and would be stripped to `ready" does not mean "startable`. That is not
hypothetical here — `dl-25`'s title today is `A CDN hostname containing "srt"
classifies the track as SubRip`, and repo-19 is about the phrase `ready` versus
`startable`. A title of that shape is one keystroke away. Sub-questions this
option must settle: single quotes as well as double; whether an escaped quote
inside is recognised; and whether stripping applies to every scalar or only to
the free-text ones (`title`, `note`, `milestone`) — the enum-validated fields
already fail loudly and arguably should keep doing so, since a quoted `status`
is a typo rather than a preference.

**Option B — reject a quoted scalar with a named error.** Matches the parser's
stated design: strict, loud, not YAML. The message tells the author to unquote,
and because the value is taken literally to the end of the line, **no title ever
needs quoting** — including one opening with a backtick, verified above. Costs:
it rejects a file that is valid YAML, which will surprise someone; and a value
that genuinely should begin and end with a quote character becomes unwriteable,
a real if unlikely loss. It is also the fiddliest option to get right for
`depends_on`, where the rule has to be threaded through `parseList` per entry.

**Option C — document that values are literal, change no code.** Zero risk, zero
cost, and `docs/01-TICKETS.md` gains the sentence it is missing. Costs: the trap
stays live for the next author who reaches for YAML habit, which is two authors
in two days so far, and it leaves `parseList`'s false-dangling failure — the one
that fails CI — in place. This option is only defensible if paired with a
decision to leave `parseList` alone as well, and that should be stated rather
than implied.

**Recommended: B, for `parseScalar` and for `parseList`.** The parser is
documented as strict, and the behaviour it currently has is the one thing the
docblock says it does not do. A named error at parse time is strictly more
informative than either a wrong render or a false dangling dependency, and the
measurement above removes B's main objection by showing that no title actually
needs quoting. A is the reasonable alternative if authors quoting by habit
should simply be accommodated; if A is chosen it should be scoped to the
free-text fields only, and it must not strip when the result would still contain
an unbalanced quote.

**Second decision, smaller: does `parseList` follow `parseScalar`?** It can be
answered independently. Leaving it unchanged keeps a live path from a
plausible-looking ticket to a red CI board, so the recommendation is that it
follows whatever `parseScalar` does. It is recorded separately because a builder
that fixes only the scalar and reports success would be reporting the smaller
half.

## Build

**Assumes Option B for both helpers.** If another option is chosen, steps 1, 2
and 4 change and the `Done when` lines must be rewritten with them.

1. `scripts/status.mjs:115-118` — `parseScalar` throws a named error when the
   trimmed value both starts and ends with `"`, or with `'`, and is at least two
   characters long. The message names the file, the line and the key, matching
   the shape of the errors already raised in `parseFrontmatter`
   (`scripts/status.mjs:96-105`), and says the value is taken literally so the
   quotes are not needed. `parseScalar` currently takes only `value`; it needs
   `file` and `line` as `parseList` already does, passed from the call site at
   `scripts/status.mjs:106`.
2. `scripts/status.mjs:121-129` — `parseList` applies the same rule per entry,
   after the split and trim. Its error must not double the quotes the way
   `danglingDependencies` does today when it echoes a corrupted id.
3. `docs/01-TICKETS.md` — state the rule in the Fields section: a value runs to
   the end of the line and is taken literally, so quoting is neither required
   nor permitted. This is the sentence whose absence let two authors reach for
   YAML in two days, and it is required under every option including C.
4. `scripts/test/status.test.ts` — cases per the `Done when` lines. `repoWith`
   (`:29`), `ticket` (`:40`) and `run` (`:97`) already provide the fixture and
   the CLI harness. `run` returns `{ stdout, stderr, status }`, so **assert on
   `stdout`, not only on `status`** — see the note under Done when.
5. Do not touch `danglingDependencies` or `EXIT_ON_PROBLEMS`. The false dangling
   dependency should disappear because the parse now fails first; if it does
   not, that is a finding worth reporting rather than a second edit.

## Done when

Every line names a command. Run the whole set red before fixing anything — the
red run is the deliverable of a defect ticket.

1. **`parseFrontmatter` rejects a quoted `title`.** A unit case in
   `scripts/test/status.test.ts` asserts the thrown message names the file, the
   line and `title`. `npx vitest run scripts`.
   _Fails today:_ the value parses and is returned with its quotes.
2. **No rendering path emits a quote mark that was not in the title.** Cases
   over `--show`, the default view, `--ready` and `--markdown` assert on
   **`run(...).stdout`**, never on `run(...).status` alone.
   `npx vitest run scripts`.
   _Fails today, and this is the shape that matters:_ an acceptance written
   against the exit code passes right now, which is how this got through a gate.
   A reviewer checking this row must confirm the assertion reads `stdout`.
3. **A quoted `depends_on` entry never produces a `dangling-dependency`
   problem.** A case asserts that `--json`'s `problems` array contains no
   `dangling-dependency` for a fixture whose only dependency is written
   `["repo-90"]` against an existing `repo-90`. `npx vitest run scripts`.
   _Fails today:_ it produces exactly that problem, and `--json` exits 1.
4. **`note` and `milestone` are covered too, or the Log names why not.** A case
   for each. `npx vitest run scripts`.
   _Fails today:_ both carry their quotes, and `milestone` additionally splits
   into two milestone rows.
5. **`docs/01-TICKETS.md` states the quoting rule** in the Fields section.
   `command grep -n quot docs/01-TICKETS.md` returns the sentence.
   _Fails today:_ that grep matches nothing at all — the document never uses the
   word "quote" in any form. Do not weaken this to a grep for `literal`, which
   already matches an unrelated line at `docs/01-TICKETS.md:173` and so passes
   today; see the Log.
6. **The real board still parses and the CI gate stays green.**
   `node scripts/status.mjs --json > /dev/null; echo $?` prints `0`, and
   `npm run check` passes.
   _Passes today._ It is a regression guard rather than an acceptance, and it is
   here because step 1 makes the parser throw on input it used to accept.

## Log

**2026-09-05 — filed.** Reproduced before anything was written, per the brief.

- The live case was captured before it disappeared. repo-22's quoted title was
  introduced at `693e7f2` and last carried at `e605d54`; the reword landed at
  `4f63e10` while this ticket was being written, so the branch tip no longer
  reproduces. The recipe under **Run it** uses the real bytes from `693e7f2` in
  a scratch root, and that is what was actually run — a fixture built from the
  real file, not that branch checked out in place.
- **The brief's framing of the severity was right about `title` and wrong as a
  general claim, and the correction is in the ticket.** It held that a quoted
  scalar affects rendering and never the exit code. That is true for `title`,
  `note` and `milestone` — measured, exit 0 with `problems: []`. It is false for
  `depends_on`: `parseList` has the same gap and turns a quoted entry into a
  false `dangling-dependency`, which makes `--json` exit 1 and fails
  `.github/workflows/ci.yml:115`, the board's whole CI gate. The brief asked
  whether `parseList` "may or may not have the same gap". It does, and it is the
  more serious half.
- **The quoting was never required by this parser.** An unquoted leading
  backtick parses and renders correctly, verified. That is not obvious from
  repo-22's Log, which reads as though quoting was forced, and it is what makes
  Option B viable — so it is recorded here rather than left in a transcript.
- The enum-validated fields (`id`, `kind`, `status`, `tool`, `difficulty`) were
  each tested quoted, and each fails loudly. That three-way split was not in the
  brief and it is what shapes the decision: the format already has a strict
  behaviour for quoted input, applied to some fields and not to others.
- Rated `standard`. The ticket is blocked on a decision, but the rating is of
  the build once the decision is answered: two small helpers, one documentation
  sentence, and cases in a suite that already has the fixture harness for them.
  Not `mechanical`, because a naive quote strip can corrupt a legitimate value
  and the implementer has to get that edge right.
- Id taken as the union of both lists. `docs/work/` on `main` tops out at
  `repo-19`; `repo-20` is on `docs/record-2026-09-04-orchestration-batch`,
  `repo-21` on `repo-cleanup-orchestrate-skill`, `repo-22` on
  `repo-file-grep-wrapper-ticket`, and `repo-23` on `repo-deployment-doc-shape`,
  which has no remote branch and no PR yet. `gh pr list --state all` names
  nothing above `repo-22`.
- **Every `Done when` line was run red before this was committed, and one of
  them was wrong.** `Done when` 5 was first written as
  `command grep -n literal docs/01-TICKETS.md`, which returns
  `docs/01-TICKETS.md:173` — an unrelated sentence about a gate "applying them
  literally". The acceptance passed today and would have passed after the fix
  without proving anything. Replaced with a grep for `quot`, which matches
  nothing in the file at all (exit 1). Recorded rather than quietly corrected,
  because it is the same failure this ticket is about: a check that returns the
  answer you wanted for a reason you did not look at.
- Not implemented, per the filing instruction.
