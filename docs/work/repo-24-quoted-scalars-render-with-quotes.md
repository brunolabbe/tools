---
id: repo-24
tool: repo
title: status.mjs renders a quoted frontmatter scalar with its quotes
kind: fix
status: done
milestone: null
depends_on: []
difficulty: standard
---

# repo-24 — status.mjs renders a quoted frontmatter scalar with its quotes

**The Decision below is answered: Option B, for `parseScalar` and for
`parseList` both** — 2026-09-06, by the owner, taking the ticket's own
recommendation. It was written as "blocked on the Decision below", which is what
this paragraph used to say; the answer is recorded here rather than left in a
builder's prompt, per `docs/01-TICKETS.md`. Built on
`repo-24-reject-quoted-frontmatter-scalars`.

## Why

`parseScalar` (`scripts/status.mjs:115-119`) returns the raw remainder of the
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

**Answered 2026-09-06 — Option B, for `parseScalar` and for `parseList` both.**
The second, smaller decision is answered the same way: `parseList` follows. The
options and their costs are left below as filed, because the costs B accepts are
real and a future reader needs to see what was traded, not only what was picked.

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

1. `scripts/status.mjs:115-119` — `parseScalar` throws a named error when the
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

## The gate on this filing

**Gate: PASS** — 2026-09-05 · `origin/main...HEAD` (`0d78637029ffdcb277a11ce37de3ad628fe2a316`, base `c37cab9`) · Sonnet against an Opus build · own defect hunt, no `code-review` dispatch (subagent has no `Skill` tool)

This diff adds only the ticket brief — no implementation, no test, confirmed by `git diff --stat c37cab9...0d78637` (one file, 319 insertions, no `scripts/` path touched). Gated on the filing's own actually-checkable acceptance rather than its ten future `Done when` lines, per the `dl-29` precedent this ticket itself follows.

### This diff's own acceptance (what I gated)

| Check                                                                        | Result                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Both claims that correct the filing brief reproduce                          | **proven** — see below, both reproduced directly                   |
| The three-way field split (enum / free-text / `depends_on`) holds            | **proven** — reproduced directly                                   |
| Every `Done when` command returns the red/green the ticket claims            | **proven** — all six reproduced, matching exactly                  |
| Cited shas for repo-22's history are accurate                                | **proven** — `git show` at each sha                                |
| `dl-25`'s `"srt"` example and repo-19's "ready"/"startable" framing are real | **proven**                                                         |
| `repo-24` is unclaimed on any other branch or in any PR title                | **proven** — every remote branch checked, `gh pr list --state all` |
| Decision surfaced as options with a recommendation, not resolved in prose    | **proven** — read directly                                         |
| `npm run check`, `npm run format`, `npx vitest run scripts`                  | **proven** — all pass unchanged (126 tests, same as base)          |
| `node scripts/status.mjs --json` / `-- --show repo-24`                       | **proven** — exit 0, `problems: []`, renders with no quote marks   |

**Claim 1 (parseList reaches the exit code), reproduced against a scratch root** (`repo-90` sound, `repo-91` with `depends_on: ["repo-90"]`):

```
node scripts/status.mjs --root "$R" --json
```

→ `"dependency": "\"repo-90\""`, `"message": "docs/work/repo-91-slug.md: depends_on \"\"repo-90\"\", which is not a ticket"`, and the process itself exits 1. Confirms the brief's correction of your framing: this is not bounded to rendering.

**Claim 2 (quoting was never required), reproduced**: a scratch ticket with `title: `` `grep`here is a wrapper... `` `` (unquoted, leading backtick) renders via`--show`, default and `--json` intact, exit 0 throughout.

**Three-way split, reproduced**: a quoted `status: "ready"` throws `""ready"" is not a status. Use one of: ready, in-flight, done, dropped`, exit 1. A quoted `title`/`note` carries its quotes through `--show`, the default view, `--ready`, `--markdown` and `--json`, exit 0. A quoted `milestone: "m1"` groups separately from an unquoted `m1` — reproduced two distinct milestone rows for one milestone.

**`Done when` lines, run against the real board and scratch fixtures, all six as claimed**:

1. `parseFrontmatter` called directly on a quoted `title` — returns it unchanged (`"\"a quoted title\""`), does not throw. Fails today, as claimed.
2. Quoted title carried through every rendering path (`--show`, default, `--ready`, `--markdown`, `--json`) — verified all five. Fails today, as claimed.
3. `depends_on: ["repo-90"]` against a real `repo-90` — false `dangling-dependency`, `--json` exit 1. Fails today, as claimed.
4. `note`/`milestone` both carry quotes; `milestone` splits into two rows. Fails today, as claimed.
5. `grep -n quot docs/01-TICKETS.md` → exit 1 (no match). `grep -n literal docs/01-TICKETS.md` → exit 0, matches only `docs/01-TICKETS.md:173`, an unrelated sentence about a gate applying rules "literally." Both exactly as claimed — the self-caught defect is real and correctly recorded rather than quietly fixed.
6. `node scripts/status.mjs --json > /dev/null; echo $?` → 0. `npm run check` → exit 0. Passes today, as claimed (regression guard).

**Corroborating citations, all verified exact except one (below)**: `dl-25`'s title is literally `A CDN hostname containing "srt" classifies the track as SubRip` (`tools/downloader/docs/work/dl-25-srt-row-matches-a-hostname.md:4`); repo-19's title is `ready does not mean startable, and the board cannot say which`. repo-22 was quoted at `693e7f2` and still quoted at `e605d54` (both `git show`n directly), reworded at `4f63e10` (unquoted, phrase changed), whose own Log there contains the quoted "workaround, not a fix" and "the parser still keeps quotes on any title that genuinely needs them" text verbatim. `parseScalar` is exactly `scripts/status.mjs:115-119`; `parseList` exactly `:121-129`; the call site handing `file`/`line` only to `parseList` is exactly `:106`; `EXIT_ON_PROBLEMS = ["json"]` is exactly `:610`; `ci.yml`'s board gate is exactly `:115`; `parseFrontmatter`'s only caller outside `status.mjs` is `scripts/test/status.test.ts`, confirmed by grep across `scripts/`, `.claude/hooks/`, `.github/`. `repoWith`/`ticket`/`run` are exactly at `scripts/test/status.test.ts:29/40/97`.

**Id uniqueness**: checked `docs/work/repo-2[0-9]*` across every remote branch (`dl-32-remove-job-list-route`, `dl-34-classify-tls-failures`, `dl-37-tiers-onto-terminating-proxy`, `docs/record-2026-09-04-orchestration-batch`, `fix/dev-server-stale-contract`, `pl-17-image-closure`, `repo-18-citation-anchors`, `repo-19-needs-decision-status`, `repo-cleanup-orchestrate-skill`, `repo-file-grep-wrapper-ticket`, `worktree-pl-19-pin-through-the-browser`) plus `gh pr list --state all`. `repo-24` appears only on `repo-status-quoted-scalar-ticket`. `fix/dev-server-stale-contract` does carry `repo-25-citations-checker-misses-shorthand-references.md` — no collision, one above.

**On the CLI-runs-not-tests substitution**: sound for a filing. `docs/01-TICKETS.md`'s "a ticket carries a decision or a reproduction" makes the reproduction itself the deliverable here, and I independently re-ran every one of those commands myself (not trusting the Log's numbers) against both scratch fixtures and the real board, getting identical results — the harder bar `unproven`/`verified` distinguishes.

- **low** · The ticket's own citation `scripts/status.mjs:115-118` for `parseScalar` (`## Why` line 20, Build step 1 line 212 — two occurrences) stops one line short of the closing brace at 119; `parseList`'s adjacent citation `:121-129` includes its own closing brace, so the document used two conventions for the same kind of citation. Caught by the builder cross-checking this record before committing, not by my own defect hunt — I had certified `115-118` as resolving "exactly" without re-deriving the boundary myself. Corrected here to `:115-119`. Changes no acceptance row and no reproduction above; `scripts/citations.mjs` still reports `115-118` as `ok` because it only bounds-checks against EOF (`scripts/citations.mjs:222`), which is the tell, not a clean bill.
- **dropped** — none.
- **findings** · own defect hunt (as described in the header) returned 0; the builder's cross-check of this record before committing surfaced 1 more (above); 1 carried, 0 dropped.
- NFR: security n/a (docs-only) · performance n/a · reliability n/a to this diff directly (it documents, correctly, a real reliability defect in `status.mjs` without fixing it, which is the right scope for a filing) · maintainability — strong; every citation but one checked resolves exactly, decision gives concrete costs per option, nothing left for a future builder to re-derive.

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

**2026-09-05 — gated PASS**, by a Sonnet reviewer against this Opus build. Its
record is above, carrying one `low` finding that came out of the exchange rather
than out of its defect hunt.

- **The citation `scripts/status.mjs:115-118` was wrong and is now `:115-119`.**
  It stopped one line short of `parseScalar`'s closing brace at `:119`, while
  `parseList` two lines below was cited `:121-129`, JSDoc through brace — two
  conventions for the same kind of citation, in one document. The tell was
  internal: the code block quoted under `## Why` is `116-119`, four lines
  including the brace, sitting under a citation that said `115-118`. Corrected
  in the body (two occurrences) and in one clause of the gate record, and
  written up as a `low` finding rather than quietly patched, so the record says
  what was found and by whom.
- **Both directions of the review worked.** The builder caught the reviewer's
  certification of `115-118` as "exact"; the reviewer then caught the builder's
  claim that there were three occurrences to fix when there were two. Both
  catches came from re-deriving the number rather than re-reading it — which is
  also how the wrong number got in: it was transcribed from the filing brief,
  which had explicitly said not to.
- **`repo-22`'s Log on `repo-file-grep-wrapper-ticket` still says `115-118`.**
  Not touched, because it is another branch. Worth a one-line fix whenever that
  branch is next open.
- **A citation checker did not catch this, and the one being built to catch
  citation errors would not either.** Today,
  `node scripts/citations.mjs docs/work/repo-24-quoted-scalars-render-with-quotes.md`
  reports **every citation resolving, exit 0**, and marks `115-118` `ok` — as it
  still does if the loose boundary is substituted back into the file as it
  stands. No ratio is quoted here on purpose: the count grows every time
  anything is appended to this ticket, so a number written into it is stale by
  the next edit. It bounds-checks a range against end of file
  (`scripts/citations.mjs:222`) and nothing else.
  repo-18 (PR #146) adds anchor checking, and **verified first-hand by reading
  `scripts/citations.mjs` at `origin/repo-18-citation-anchors@02197ea`, not from
  that ticket's description** — its rule, in the docblock above the verification
  pass, is "Verified iff the anchor's text starts on a line inside
  [start, end]", and the same paragraph says "The end is deliberately loose: an
  anchor may run past the cited range." Line numbers on that branch are
  deliberately not cited here: this file is checked against `main`, where those
  same numbers land on unrelated text and `citations.mjs` reports them `ok`
  regardless — which is this bullet's own point, met by accident while drafting
  it. So an anchor drawn from line
  116 verifies against `115-118`, `115-119` and `110-125` alike.
  **Anchor checking proves the range contains the claim; it does not prove the
  range is the claim.** A boundary one line short of a brace, or twenty lines
  long, passes both the old tool and the new one.
- **That is a limit of repo-18, not a defect in it, and it is not a reason to
  reopen anything.** The looseness is deliberate and reasoned in that docblock:
  requiring end-containment would make any wrapped anchor unverifiable unless the
  author computed an end line from the anchor's length, which is the exact
  authoring error repo-18 exists to stop. Start-in-range is the right predicate.
  The limit simply has not been written down, and this is the first live
  instance of it: a wrong range, in a gate record, certified by a reviewer,
  surviving the tool built to catch wrong citations — on a branch whose subject
  is a parser that silently accepts what it should reject. Worth carrying into
  repo-25 and any repo-18 follow-on.
- Three checks in this one filing returned the wanted answer for a reason nobody
  had looked at: `Done when` 5's `grep -n literal`, `citations.mjs` marking a
  loose boundary `ok`, and repo-22's gate reading an exit code instead of
  stdout. That recurrence is the ticket's real subject.
- **A fourth, caught by the reviewer in this Log itself.** The bullet above
  originally quoted a `citations.mjs` ratio measured while drafting. It was
  accurate then and wrong by the time it was committed, because the gate record
  and this Log added citations to the very file the ratio counts. The general
  form is worth more than the fix: **a ratio in a document counts that document,
  so any edit invalidates it — including the edit that fixes it.** That is why
  the remedy is not a better number. Dropped the ratio and kept the claim, which
  holds at any count: `115-118` still reports `ok` when substituted back into
  the file as it stands.
- The remedy is copied rather than invented. repo-21 hit the same drift across
  three rounds and settled it by stating the count once, at the top of its page,
  and having later mentions not repeat it — "a figure restated in three places
  is three places to go stale", with its historical figures left as
  measured-at-the-time rather than updated. This ticket needs no count at all,
  so it carries none.
- **`citations.mjs --rev <sha>` does not check the ticket as it was at that
  sha.** The ticket file is read from the working tree unconditionally
  (`scripts/citations.mjs:389`); `rev` reaches only `makeReader` and
  `candidateFiles` (`:403-404`), which resolve the citation _targets_. So
  `--rev` answers "did these citations point at the right thing back then", not
  "what did this document claim back then" — to get the second, extract the file
  with `git show <sha>:<path>` and run against the extraction. Worth recording
  because it is this ticket's own subject one level out: a flag that plainly
  answers a different question than the one a reader assumes, with no error to
  say so. Surfaced the wrong way round — the builder inferred a mechanism the
  reviewer had never claimed and "corrected" it; the reviewer pointed out there
  was no claim to correct, and the fact about the tool is true and useful
  anyway. Reproduction beat inference in both directions, which is the only
  reason it ended up right.

**2026-09-06 — built, Option B.** Branch
`repo-24-reject-quoted-frontmatter-scalars`, off `origin/main@cf433aa`. Three
files: `scripts/status.mjs`, `scripts/test/status.test.ts`,
`docs/01-TICKETS.md`. `status` moved to `done` here, and the stale "blocked on
the Decision" header replaced with the answer, because the answer arrived in a
prompt and `docs/01-TICKETS.md` says it belongs on the ticket instead.

- **Run red first, and it was.** All fifteen new cases were written and run with
  **nothing in the tree changed but the test file** — `status.mjs` untouched and
  the `docs/01-TICKETS.md` sentence not yet written: **11 failed, 179 passed of
  190**
  (`npx vitest run scripts`). The four that passed red are the ones asserting
  the sound path — a quote mark at one end only, a title carrying quote marks of
  its own, a backtick title, the same dependency unquoted — and they are there
  so that "no rendering path emits a quote mark" cannot be satisfied by a parser
  that emits nothing at all. Green after: **190 passed of 190**. Nothing was
  substituted for a required check; every command in `Done when` was run as
  written.
- **Every line number in the brief was already stale on `main`, and none of them
  were off by a little.** `parseScalar` was cited `scripts/status.mjs:115-119`
  and was at `:143-146` on `cf433aa`; `parseList` was cited `:121-129` and was
  at `:148-156`; the call site was cited `:106` and was at `:133`;
  `EXIT_ON_PROBLEMS` was cited `:610` and was at `:727`. The whole file had
  moved down by roughly 28 lines since the filing, and `scripts/status.mjs:115`
  now resolves to `if (end === -1) throw ...` — a real line of the same
  function, which is why nothing complained. The mechanism the brief described
  was correct in every case; only the coordinates were not, so nothing had to be
  redesigned. **The tell is the one the gate record above predicted:**
  `node scripts/citations.mjs docs/work/repo-24-…md` still reports **exit 0**,
  because every citation in this file is unanchored and the tool prints them for
  a human rather than checking them. A range that is wrong by 28 lines passes
  exactly as cleanly as one wrong by one. **No count is given, and the first
  draft of this bullet gave one** — it said "all 23", which the gate below
  measured as 27 within the hour, because appending to this ticket adds
  citations to the file the count counts. That is the failure named three
  bullets above this one in the 2026-09-05 entry, committed by the author
  quoting it. The claim needs no number.
- **The brief was a field short.** It said `parseScalar` "needs `file` and
  `line` as `parseList` already does". It needs `key` as well, or the message
  cannot name which field is quoted — and naming it is `Done when` 1. The
  signature is now `parseScalar(value, key, file, line)`.
- **The rule is one helper, not two copies.** `rejectQuoted` is shared by both
  parsers so the two messages cannot drift, and it takes how the message should
  name the thing (`"title"`, or `a depends_on entry`) rather than deriving it.
  Matched surrounding quotes only, length two or more, `"` and `'` both:
  `"srt" in a hostname` and `a hostname can contain "srt"` are ordinary values
  and stay ordinary, and so does `"mismatched at the other end'`. Each is a
  case.
- **The message echoes the offending value once.** `depends_on` reads
  `a depends_on entry is quoted ("repo-90").` — not the doubling that
  `danglingDependencies` produced when it wrapped a corrupted id in quotes of
  its own and said `depends_on ""repo-90"", which is not a ticket` about a
  ticket that was right there. There is a case asserting the message does not
  contain a doubled quote.
- **Build step 5 held: the false dangling dependency disappeared on its own.**
  `danglingDependencies` and `EXIT_ON_PROBLEMS` are untouched, confirmed by the
  diff. The parse fails first, so the problem is never raised —
  `--json` on the `repo-90`/`repo-91` fixture now exits 1 naming the quoting,
  with `dangling-dependency` appearing on neither stream. **That changes the
  shape of `Done when` 3 and it is worth saying plainly**: the line asks that
  `--json`'s `problems` array carry no `dangling-dependency`, and under B there
  is no `problems` array to read, because there is no JSON. The case asserts the
  absence on both streams and asserts the parse error instead, and a second case
  runs the same fixture with the dependency unquoted to show the board is
  otherwise sound and exits 0 with `problems: []`. Without that second case the
  first would pass against a parser that refused everything.
- **The live case is dead on every path.** repo-22's real bytes from `693e7f2`
  in a scratch root, the recipe under **Run it**: `--show`, the default view,
  `--ready`, `--markdown` and `--json` each now print
  `docs/work/repo-22-grep-is-a-wrapper.md:4: "title" is quoted (…)` and exit 1,
  where all five used to render the quotes and four of them exited 0.
- **No branch anywhere is broken by this.** Every ticket file on all **28**
  remote branches was extracted and its frontmatter scanned for a matched-quoted
  value and for a quoted `depends_on` entry: **zero hits**. So the strict parse
  cannot redden a board on merge, and repo-22 in particular is safe — it was
  reworded at `4f63e10` before this landed.
- **This ticket should have been filed `needs-decision`, and was filed `ready`.**
  Its own opening paragraph said "do not start until it is answered" while its
  frontmatter said startable, which is the exact divergence `needs-decision`
  exists to remove — and the status this ticket is about is a parser that
  accepts what it should reject, one level down. Recorded rather than fixed,
  since it goes to `done` in this commit either way.
- **This edit moved a citation in the Log above, and the number is left as it
  was measured.** `docs/01-TICKETS.md:173` was cited as the unrelated sentence
  about a gate "applying them literally"; the nine lines inserted for the
  quoting rule pushed it to `:212`. Following the precedent this ticket already
  quotes from repo-21 — historical figures stay as measured at the time — the
  earlier bullet is not rewritten. The claim it makes still holds, and the new
  location is here.
- **`Done when` 5's grep is now satisfied by a test, not only by a grep.**
  `command grep -n quot docs/01-TICKETS.md` returns four lines (101, 103, 105, 108) where it returned nothing at all. A case in `scripts/test/status.test.ts`
  asserts the same thing, so the sentence cannot be deleted without the suite
  saying so — which the grep alone could not do. The rule is stated once, in the
  Fields section, and the wording matches the parser's error on purpose.
- **`Done when` 6 needed no new test.** "Every ticket in the repo parses, and its
  dependencies resolve" (`scripts/test/status.test.ts`) already runs the real
  board through the real parser on every run, and is the regression guard that
  line asks for. Adding a second would have been a copy to keep true.
- **One fold-in, taken against the builder's recommendation, and the objection
  is answered rather than dropped.** The agent preamble in `docs/01-TICKETS.md`
  told an agent to run `npm install` in a fresh worktree — minutes, and it can
  fail outright when `ffmpeg-static`'s postinstall cannot reach the network,
  leaving no `node_modules` at all. It now names
  `bash .claude/scripts/worktree-farm.sh`. I recommended filing it instead, on
  the grounds that the preamble is pasted verbatim into prompts and that
  `.claude/` is only partly tracked, so citing a path under it might not be
  safe. The owner heard that and took the cost; the objection was not wrong, so
  it is settled here in writing rather than silently. **Measured, not assumed:**
  `git check-ignore .claude/scripts/worktree-farm.sh` exits **1**, so the script
  is tracked and safe to cite, and it has been since `ab909c9`. The doc now
  carries that command as the way to answer the same question for any other
  `.claude/` path, because `.claude/*` is gitignored except for a named
  allowlist that grows — which is exactly why the question was worth asking
  before the answer turned out to be yes.
- **A cross-reference for whoever holds repo-25**, carried out of the gate
  record above and not touched here: `scripts/citations.mjs` bounds-checks a
  range against end of file and nothing else, so a range wrong by 28 lines —
  this ticket's own, measured today — reports `ok`. Anchor checking proves the
  range _contains_ the claim, not that it _is_ the claim. `scripts/citations.mjs`
  was deliberately not opened on this branch.

**2026-09-06 — gated CONCERNS, and the med finding closed.** By a Sonnet
reviewer in its own detached worktree at `faa65ee`; its record is above. One
`med`, two `low`, no acceptance line left unproven.

- **The med reproduced, and it is the error message that was the defect.**
  `rejectQuoted` cannot tell a wrapped value from one whose first and last
  characters merely happen to be quote marks, so
  `title: "downloaded" is not "verified"` throws — reproduced first-hand in both
  quote kinds before accepting it, six cases through `parseFrontmatter`. That
  much is the cost Option B was chosen knowing about. What was not accepted with
  it is that the message said **"write it unquoted"**, which for this shape is
  advice that corrupts the value: Option A's hazard reappearing inside Option B,
  delivered by a human following bad instructions instead of by a strip. The
  message now ends `— unwrap it. If these marks are not wrapping and the value
genuinely starts and ends with one, write those terms in backticks instead.`
- **"Permanently unwritable" was the one clause of the finding that did not
  survive the repro**, and the difference matters because it is the difference
  between a loss and an inconvenience: `` `downloaded` is not `verified` ``
  parses untouched — measured — and backticks are already how this repo writes a
  code-ish term in a title. Pinned as a case, so the way out cannot be removed
  without the suite saying so.
- **The rule was deliberately not narrowed, and this is the boundary and why.**
  The obvious narrowing — reject only when the interior holds no quote of the
  same kind — separates the two cases cleanly and was rejected: it would let
  `title: "the \"srt\" host"` parse and render its backslashes. That trades a
  loud false positive for a silent wrong render, and a silent wrong render is
  the defect this ticket exists to remove. Recorded in `rejectQuoted`'s docblock
  and in `docs/01-TICKETS.md`, not only here, because the next reader of that
  function will have the same idea.
- **The doc sentence overstated and the reviewer was right about it.**
  "containing quote marks of its own, parses exactly as written" is true only
  when the marks are not at both boundaries. Split in two: one paragraph for
  what parses, with `dl-25`'s real title as the example, and one naming the
  positional rule, the rejected shape and the backtick way out.
- **Its first `low` was a difference in revert scope, not a discrepancy, and its
  account is the correct one.** It reverted `scripts/status.mjs` alone and got
  10 failed / 180 passed; reverting `docs/01-TICKETS.md` as well reproduced 11 /
  179 exactly. My red run predated my own docs edit. The bullet above now says
  which files were unchanged rather than only which one was, so a re-runner does
  not have to derive it.
- **Its second `low` caught this Log committing the failure this Log had just
  named.** The citation bullet said "all 23 citations"; the reviewer measured 27
  within the hour, because appending to this ticket adds citations to the file
  the count counts — the exact mechanism recorded in the 2026-09-05 entry, three
  bullets above the one that broke it. Number dropped, claim kept.
- **Both directions worked again.** The reviewer found a message whose advice
  corrupted the value it was about; re-running its own case found that the value
  was writable all along. Neither of us would have got to "fix the message and
  pin the escape hatch" alone, and the patch either of us would have written
  alone — document the loss, or narrow the rule — would have been worse.
