# Records

A gate written into a reviewer's worktree **did not happen** — the worktree is
discarded. So:

- **Put the long form on the pull request and the short form in the ticket.** Both
  are durable and the thread costs the repo nothing, so committing the full report
  *and* posting it — which is what the rule below produced for five sessions — stores
  every gate twice and creates two copies that can drift. Measured on the fifth
  session's three tickets: **303 lines of gate record committed, 294 of the same
  text posted.** Commit the verdict, the findings table with `file:line` and a
  disposition each, and what the gate did **not** do; post the reasoning, the
  enumerations and the reproductions to the thread, and link it.
- **The Log is where the bloat is, not the gate record.** Same three tickets: Logs
  **753 lines**, gate records **303** — and one of those Logs ran to **371 lines
  for a three-line config change**. The cause is upstream, in the relay: every
  *"say why"*, *"what is the mechanism"*, *"what could you not measure"* converts a
  measurement into paragraphs, and those instructions are elsewhere on this page
  because they are worth it. So keep asking — and put the answer where it is read
  once. **The Log's shape is a claim, its command, and that command's output.** The
  narrative belongs in the pull request body. **One carve-out, because the repo's
  own `CLAUDE.md` says it has nowhere else to live:** what the brief turned out to
  have wrong stays in the Log, as a claim with its command like any other. Judge a
  Log by whether a later agent can re-run it, not by whether it reads well.

- The reviewer returns the section; **the builder commits the short form of it**
  (the two bullets above say which form) to the ticket, above
  `## Log`, one subsection per gate, never overwriting an earlier one.
- The builder then posts the reviewer's report to the PR thread
  (`gh pr comment <n> --body-file <f>`). That is what makes a self-transcribed
  verdict falsifiable, and it is the only check on it.
- Verdicts are recorded **as given**. "FAIL, since addressed" is a verdict softened
  in place; put the addressing in the dispositions.
- **A claim that reached a record is withdrawn in place, never deleted.** Two
  corrections landed inside committed gate records on 2026-09-04 and both were
  corrected in place rather than rewritten, which is the way: mark the wrong
  paragraph
  `WITHDRAWN — do not cite this paragraph`, leave it standing with the retraction
  directly beneath it, restore whatever it displaced as the standing statement, and
  put a forward-pointer on any earlier entry that repeated it. A record showing only
  the corrected state hides that the claim was **made, propagated to another agent
  and acted on**, and the propagation is the part a later reader needs. **Attribute
  the error to the link that made it** — one of the two was the orchestrator's
  wrong citation, transcribed faithfully by the gate, and a reader comparing the
  record against the frontmatter would otherwise have had no way to see which link
  failed. **And do not over-correct.** The builder that retracted a claim about its
  own model replaced it with *unknown from where I sit; Opus likely on other
  agents' evidence about themselves; not established here*, rather than asserting
  the opposite with equal confidence. Swapping one unsupported claim for another is
  the same failure in different clothes, and it is the pull after a retraction.
- Every finding is listed, including those needing no change.
- **A fix that lands after the verbatim section is committed does not edit the
  section.** The section stays as a description of the sha it reviewed; the
  builder adds a dated post-gate Log entry naming the new sha and saying the
  record above describes the earlier one; and a citation the fix deleted
  outright cannot be repointed — it goes back to the reviewer for an amended
  bullet, marked in place as amended at the new sha, because a finding's words
  are the reviewer's to change (2026-09-13, 2026-09-18). **A multi-round record
  is several subsections whose coordinates are each correct only against their
  own header's sha**, and the citations gate checks the whole `## Review`
  against one tree — so an earlier round's coordinates that a later round's
  fixes moved are pinned to the sha that round reviewed, or the record goes red
  the moment it is committed to a ticket file (2026-09-20, seen on a PR-thread
  record where it was harmless).
- **A record cannot assert that its own branch is green, and this is structural
  rather than a lapse.** *"Any commit that corrects a status claim invalidates the
  status claim"* — measured 2026-09-04: a Log said "every completed run on the
  branch is `success`"; a second opinion tallied it with
  `gh run list --json status,conclusion` and got **13 `completed`/`success`, 1
  `completed`/`cancelled`, 1 `in_progress`** out of 15, so the sentence was false
  as written, a cancelled run being completed. The correction became a commit, the
  commit moved the tip, and the corrected claim was stale on arrival. Being more
  careful does not fix it: writing the assertion changes the thing asserted. So
  **record what a named sha's runs did, never that "the branch is green"**, and
  say the tip is unobserved when it is. The only true form of that claim is one
  look after the final commit and immediately before merge. **That look is
  available — just not to you.** A gate stops before the merge and writes its
  record earlier still; a builder stops before the PR and moves the sha by
  recording the check. The orchestrator is the one participant alive at merge time
  that is not writing to the branch, and `SKILL.md`'s `## After a merge` now
  carries the command. Do not write "nobody can check this": that was this rule's
  first wording, and it was refuted the same day by an orchestrator that simply
  ran it.
- **Re-resolve every `file:line` in the record as the genuinely last action before
  `git add`** — after the final `npm run format`, with nothing between. Verify
  programmatically (check that each cited line still contains what the record
  claims) and say in the record which commit the citations resolve against.
  Without this, **every gate record this page prescribes is stale on arrival.**
  There are four ways it goes stale, and only the first is the obvious one:

  1. **Your own fix moves the lines.** Fixing one finding in the second session
     lengthened a comment by six lines and pushed four citations
     (`:313→:319`, `:331→:337`, `:341→:347`, `:384→:390`); another branch remapped
     22 after a lint fix moved code.
  2. **The reviewer's citation was wrong when written.** Five of twenty-five did
     not resolve on one third-session branch against a directory that was
     *byte-identical* to the commit reviewed — so this step catches reviewer error,
     not just drift. **This mode dominates, and the ordering here understates it:**
     the fourth session caught **ten** of them across four branches — one off by a
     line (`:14→:15`), five clustered in one direction (each pointing at the
     comment block *above* a test rather than its `test(` line), three one-line
     boundary misses where the quoted string ran past the cited range, and one
     more (`:96→:94`) on a fourth branch. Reviewers mis-cite systematically, in a
     consistent direction per reviewer, which is why a spot-check misses it and an
     enumeration does not. Mode 1 occurred too, on the branch whose fix moved the
     very lines its record cited — handled not by remapping but by **pinning the
     record to the commit the gate reviewed** and saying so, which is the cheaper
     answer when the reviewed tree is the one the findings describe.
  3. **You re-resolve, then make one more edit.** One builder ran its check clean
     at 10/10, then applied a comment fix that moved two citations. It caught this
     only by re-running. "Before committing" is not tight enough; it has to be
     last.
  4. **The formatter reflows the file after you write the record.** oxfmt
     rewrapping gate tables broke a self-referential row twice on one branch and
     was confirmed on another. Format first, resolve second.

  **There is a script for this now: `node scripts/citations.mjs <ticket-file>`**,
  and `--rev <sha>` resolves against the commit the gate reviewed rather than the
  working tree, which is the cheaper answer to mode 1. It enumerates rather than
  spot-checks, reads the `line` column of a findings table, resolves the bare
  filenames real records actually contain, **fails an ambiguous one instead of
  guessing** (this repo has two `logging.test.ts`), and exits non-zero so it can
  gate a commit. It prints each cited line so you can judge the content.

  **Since repo-25 it counts every reference, not the ones it can check.** A
  backticked shorthand takes its file from the nearest qualified citation above
  it, and is printed as `:27 in <file> (named at record line N)` — the file is a
  guess, and both ends are on screen so you can see whether the guess is right. A
  prose `line 367` is reported `unchecked`: counted, never resolved, and never
  fatal. Before this, a record carrying five references and three citations
  reported three and read as full coverage, which is the same defect as `9/9
  resolve` one layer out.

  The exit code is a **bitmask** — `1` unresolvable, `2` moved, `4` unanchored
  under `--require-anchors`, `8` a wrong evidence declaration, `16` an indistinct
  anchor under `--require-distinct-anchors`, `32` a malformed pin — and the run prints
  it as `exit 3 — 1 unresolvable, 1 moved`. So a CI job can tell a record that
  cannot be right from one that says the wrong thing, and either from a record
  whose failures are deliberate.

  **A gate record never pins to a branch-only sha.** This repo squash-merges and
  deletes the branch, so a pre-squash sha is unreachable from a fresh clone once
  the branch is gone, and `citations-gate.mjs` then fails every pin as
  `unresolvable` — on `main` and on every open pull request at once. Measured
  2026-09-14/15: 16 pins to `dl-51`'s own gate-fix commit, `main` red, four
  repair rounds across five pull requests. The rule this paragraph replaced said
  to pin to the sha reviewed, "reachable afterwards through the ticket's pull
  request"; it was measured false — CI checks out with `fetch-depth: 0`, which
  fetches branches and tags and never `refs/pull/*`. **A checkout that once
  fetched the branch still holds the object until gc, so the check passes
  locally and fails in CI**; a fresh clone, or a squash plus
  `git gc --prune=now`, is the only valid test, and `git branch -r --contains
  <sha>` printing nothing is the tell. Pinning to the base is no better: a record
  cites the tests the branch *introduced*, which do not exist there. So:

  - **A gate record cites the tip it reviewed by coordinate with an anchor, and
    is re-resolved as the last action before commit.** After the squash those
    lines are on `main` under the same content, so an unpinned, anchored
    citation survives the merge where a pin does not.
  - **Where a later commit deleted the cited text outright, rewrite the citation
    as prose naming the reviewed sha, or declare it as evidence.** `dl-58`'s
    owner decision D4(b) is the worked example: pins dropped from the record in
    favour of prose plus declarations (2026-09-17).
  - **A Log passage citing pre-existing code pins to a sha that survives** — the
    base, or a `main` commit — as before.
  - A tag on the reviewed commit would also keep pins reachable, exit 0 in the
    same simulation; the owner chose prose (2026-09-15). Do not re-derive the tag
    remedy without re-asking.

  **A committed record can be spliced by a later edit, and nothing here catches
  it.** `review-ticket` spends several paragraphs protecting "the builder commits
  it to the ticket, on the branch under review, **verbatim**" (repo-38), and
  frames the threat as the builder editing a reviewer's words. The realistic
  threat is different: a *later* agent, appending something unrelated, splicing
  into the record it is not touching.

  The mechanism, verified in this repo: an agent anchored its insertion on the
  bare string `## The gate on this filing`, which also appears **backticked inside
  a gate record's own prose** — ticket prose here quotes headings constantly, and
  in that file the quoted form sits nearly 500 lines above the real heading. The
  insert landed inside the committed record, cutting a sentence in half; ninety
  lines of unrelated narrative went in, and the sentence resumed as a second,
  garbled heading duplicating the real one.

  **Nothing mechanical fails.** Measured directly: with a duplicated `## Review`
  heading and a half-sentence in a ticket, `npm run check` exits **0** — oxfmt
  formats markdown, it does not validate heading semantics — and
  `npm run status -- --json` exits **0**, because it reads frontmatter. The ticket
  looks fine to every gate this repo has. **A record that has been edited reads
  exactly like one that has not**, which is why the discipline cannot be an
  inspection.

  So, two practices, both one line:

  - **Anchor on the heading *form*, never the bare heading text** — `\n\n## …\n`,
    not `## …`. Headings get quoted inside prose here as a matter of course.
  - **Diff the record's section against `HEAD` before committing any edit to a
    ticket that carries one.** One command, and it is the only thing that detects
    this.
  - **Verify a pin by diffing the two runs, never by comparing totals.** Measured
    on the same batch: a record pinned with `--rev` and the same record resolved
    against the working tree both reported **16/34 — identical** — while three
    citations pointed at *different content*, because a later commit had moved the
    lines under them. One was the record's own quoted evidence for a finding, so
    remapping the number would have destroyed the finding. This is the script's
    documented limit arriving in practice: it tells you a citation is not
    *impossible*, and a matching count says nothing at all.
  - **Renumbering records can break things outside the ticket.** Inserting a
    late-arriving record in run order looked like a rename of the ones after it,
    until a builder found two *test files* citing "dl-29's third gate" by number.
    Prefer a date-and-sha label over renumbering, and grep for the ordinal first.

  Provenance: the two incidents are the `repo-13` session's, reported to this one
  — it happened twice on one ticket, to two different agents, for the identical
  reason, which is what makes it a pattern rather than an accident; a reviewer
  caught the first, and the second agent caught itself by diffing before
  committing. The quoted-heading mechanism and the two exit codes above were
  verified here.

  Surfaced in the sixth session by a builder that **refused the pin it was given**
  and returned three options instead. The orchestrator had conflated the two
  cases; only the builder was close enough to the tree to see that the base pin
  resolved nothing.

  Two more things that session measured about this script, both of which read as
  staleness and are not:

  - **`--section <name>` is documented and unimplemented.** It appears once, in
    the usage line, with no parser and no validation, so it is silently accepted:
    `--section Log`, `--section Nonsense` and no flag return byte-identical
    output. A whole-file pass wearing the label of a filtered one. Filed as
    `repo-14`.
  - **A flag's value can be eaten as the positional argument.** `argv.find((a) =>
    !a.startsWith("--"))` takes the first non-`--` token as the ticket path, so
    `citations.mjs --rev HEAD <ticket>` opens `HEAD` as the ticket. **Always put
    the ticket path first.** It fails loudly — ENOENT, exit 1 — so any run that
    reported "N/N resolve" used a valid invocation; only the `--section` no-op is
    silent. (`$?` after `| tail` is tail's — one instance of the bullet below.)

  **So a bare filename is not a citation in this repo — it is a coin flip the
  tool refuses to make.** `travel.ts:286` matches three tracked files and
  `brief.ts:505` matches two; the resolver fails both rather than picking, which
  is the right design and is also the reason the habit has to be to *write* the
  qualifying path, not to fix it when the script complains. Four ambiguous
  citations across three tickets in one day is what made this worth stating.
  Qualify far enough left to be unique — `api/src/runs/travel.ts:286-310`,
  `contract/src/brief.ts:505` — and the check becomes a confirmation instead of
  a rework.

  **A bare sha is the same coin flip, and `citations.mjs` does not cover it.** A
  commit names at least two texts — its **message** and its **tree** — and the
  same author routinely writes the finding into both, in different words.
  Measured 2026-09-04: a quote attributed to "`cfae096`'s Log" was verbatim from
  the ticket file that commit adds to, and a reviewer checking it reached for
  `git show -s --format=%B` instead, found three wording differences inside the
  quotation marks, and reported a fabricated quote. **The finding did not
  reproduce and the citation was still at fault**: it resolved to two texts and
  did not say which. So write `<sha>:<path>` — or the words "the commit message
  at `<sha>`" — whenever you quote from a commit. This one costs a reviewer a
  finding and a builder a round, and neither party is wrong.

  It cannot judge one of the four modes, and says so: a citation whose *content*
  changed still resolves unless you anchor it. The other — a citation that must
  stay as written — has two mechanisms since repo-35, and **which one to reach
  for is decided by a command rather than by taste**:

  > **Reach for a pin when the citation was true of some commit in this
  > repository. Reach for a declaration when it was true of none.**

  ```bash
  git log --all -S'<the anchor text>' -- <the cited file>
  ```

  Non-empty: some tree held it, so a rev exists and the repair is a **pin**.
  Empty: nothing in this repository's history ever contained it — a coordinate
  fabricated on purpose as a defect's evidence, an upstream project's path, an
  ambiguous basename — and the **declaration** stands. A citation that merely
  went stale is the first case, however it reads today.

  **A pin** is written inside the location, `<file>@<rev>:<line>`, with its anchor
  after it as usual. The rev is 7 to 40 hex characters naming a commit, and it
  goes before the colon. It is checked at that commit on every run, whatever tree
  the run reads and overriding `--rev`, and a shorthand after it inherits the pin.
  **A pin is permanent**: it is never re-checked against the present, which is
  the point on a history page and a cost everywhere else. Pin to a sha that
  survives — the base or a `main` commit, never a pre-squash branch tip — because
  a rev this repository does not have is `unresolvable`. A pin written wrong — a
  rev that is not hex, too short, placed after the line number, or carried by a
  shorthand — is `MALFORMED`, exit bit `32`, and nothing excuses it. The summary
  line adds `N pinned` whenever there is one, and says nothing about pins when
  there are none.

  **A declaration** is an HTML comment on a line of its own —
  `<!-- citations: evidence <file>:<line>, <file>:<line> -->` — naming one or more
  citations exactly as the record writes them, qualified, pin included if the
  citation has one. Those are reported `evidence` and set no exit bit, so the
  record passes with its wrong coordinates intact. Put the declaration in the same
  `##` section as the citations it excuses, so a `--section` run is excused too.
  **A declaration that excuses nothing fails** — because the citation now passes,
  or because the record no longer contains it — which is what stops a waiver
  outliving the finding it was written for.

  **And the rule above is enforced where it can be told without history.** A
  declared citation whose anchor is on another line of the very file it was
  checked against is verified by that tree, so its declaration is refused on bit
  `8` and the citation goes on failing as `moved`, naming the line it is at —
  repoint it, or pin it. The other half, telling a rewritten file from a
  fabricated anchor when both read "not anywhere in the file", is not checked:
  that is the command above, and running it is yours.

  Run it as the genuinely last action before `git add` regardless — it is a
  second and cheaper thing to be last, not a replacement for being careful about
  the order.

  Three mechanics make the check actually catch things, all learned by nearly
  missing them:

  - **Assert that every `path:line` in the record is in the checked set.** Without
    it a citation you forgot to register passes silently, which is the one failure
    the check exists to prevent. One builder built this and it is the difference
    between a resolver and a rubber stamp.
  - **Bare numbers with no file token are citations too.** A reviewer's evidence
    table with a `line` column carries them, and every naive regex skips the whole
    column. Two builders hit this independently.
  - **Do not remap a citation that is the finding's own evidence.** A gate that
    reports "`:93-94` is wrong, the text is at `:94-95`" contains a coordinate that
    must stay wrong — it is a quotation of the defect, not a pointer. A positional
    remap will silently "fix" it and destroy the finding. Declare it instead, so
    the next run agrees with you rather than being argued with in prose.

  **A caveat specific to editing this file.** `.claude/` sits in `.oxfmtrc.json`'s
  `ignorePatterns`, so `oxfmt` never touches this page and `npm run check` cannot
  catch a broken table, an unterminated code span or a mangled list in it. "Format
  first, resolve second" does not apply here — nothing reflows — but neither does
  the formatter's usual backstop, so proofread structure by eye.

  And two things that are not staleness and will look like it: a citation whose
  *content* you changed (it resolves, it just no longer says what it said), and a
  gate record citing text a later correction deleted outright — inherent to
  committing a gate in the branch that fixes it. Say so in the record's preamble
  rather than repointing them.
- **A command's flags and its exit code carry what its output cannot, and reading
  the matching line discards them.** Three instances, all of which produce a
  truthful transcript of a question you did not ask:

  - **`$?` after a pipe is the last stage's.** `node scripts/citations.mjs … | tail`
    reports `tail`'s status, so the tool's own exit code — the entire signal — is
    gone. Redirect to a file and read `$?` unpiped.
  - **`-l` under an alternation cannot say which alternative matched.** The worked
    reproduction, including why `sort -u` is load-bearing in the `-o` transcript, is
    in `repo-20`'s Log; do not restate it here. Re-run 2026-09-07, it has drifted
    and still holds: `grep -rlnE 'repo-(40|80|90|99|404|808|901|999)' scripts packages`
    now names **two** files and `-roE … | sort -u` shows **two** of the eight ids,
    so `-l` reads as "all eight are there" where it was "one of eight" when the rule
    was written. The count changed; what `-l` can answer did not.
  - **A missing search path still prints the matches from the paths that exist.**
    `grep -rlnE 'repo-(40|404)' scripts nosuchdir` warns on **stderr**, prints real
    matches on **stdout**, and exits **2**. With stderr discarded an incomplete
    search is indistinguishable from a complete one — the third comment on #148.
  - **A `&& echo "<verdict>"` on the end of a check is your label, not the tool's
    result.** Measured 2026-09-07, on the branch that wrote this bullet. A builder
    compared two citation runs with `diff <(… | sed 's/record line [0-9]*/record
    line N/g') <(…) && echo "IDENTICAL to main"`, then wrote *"byte-identical"*
    into a committed Log. The comparison was right and the sentence was false: the
    `sed` it had written itself was normalising away the only thing that differed.
    **A `diff` that finds nothing says so by printing nothing**, and once the
    invented word had scrolled past, the transcript could not tell a gloss from an
    answer. Quote the silence and the exit code; if a check needs a word to be
    legible, write the word in the record where it can be argued with, never in
    the command where it reads as output.

  In all four the fix is the same: take the exit code unpiped, choose flags that
  print the thing you are about to write down rather than a superset of it, and
  never let a string you authored occupy the position a result would.
- **A count with no denominator is not a measurement.** "Removing the guard fails
  3" says nothing without the command it was taken from and the total it is out
  of. Two builders in one session recorded per-**scenario** counts while their
  gates recorded per-**run** ones — neither wrong, both looking wrong, and the
  disagreement cost a round each. One re-measured at a stated scope and found a
  **third** figure nobody had disputed; all of its errors traced to one habit,
  reading a `| head`-truncated failure list instead of the runner's own total.
  Write the command and the denominator beside the number — `4 of 71,
  npx vitest run <spec>` — and **never adopt the other party's figure to settle
  what is actually a disagreement about scope.** This is the same defect as a
  positional reference with no file: a number whose object is unstated.
- **A Log citing a path under the scratchpad is a promise only the session that
  wrote it can keep.** `/tmp` does not survive a container rebuild, and no later
  agent can re-run what it names. What makes such an entry durable is the command
  and its **output**, pasted in — a path sitting beside them reads like an artifact
  anyone can reproduce and is not one. If the harness is worth re-running, commit
  it; if it is not, cite the output and drop the path.
- Record what the gate **did not** do, alongside what it did. A narrow second gate
  that says "did not re-sweep the citations, did not re-run the full suite, ran
  `--project repo` because that is what parses the ticket tree" is far more useful
  later than one that only lists conclusions.

## When there is no ticket

The mirror of the section below, and the skill's step 9 assumes it away: it says
the builder commits the gate record **onto the ticket**, and an unticketed branch
— a skill correction, a records pass, anything the loop produces about itself —
has no ticket to commit it to. A ticket the branch merely *files* is not the
answer: attributing a gate of the whole branch to work nobody has started makes
the next reader think that ticket was built. **So the pull request thread is the
record**, in full and verbatim, and the PR body says so in a sentence — a reader
should never have to wonder whether a branch was gated. Measured 2026-09-04, on
the branch that recorded this batch.

## When there is no pull request yet

The skill's own default produces this state every time — builders stop before the
PR — and three rules on these pages assume it away. What to do instead, measured
on a gated-but-unopened branch on 2026-09-02:

- **Both halves of the gate go in the ticket**, short form and reasoning, with a
  one-line preamble saying the long form is here because no PR thread existed to
  hold it. The two-locations rule exists so the copies cannot drift; one location
  cannot drift.
- **Ship authority becomes authority to _commit_**, not to open. `sizing.md`
  phrases it as "open the PR yourself"; on a pre-PR branch the equivalent is
  "commit the record yourself if these conditions hold, and do not check back".
  It still removes a round.
- **A reviewer is retired when its record is committed and its exchange is over**
  — `worktree-hygiene.md`'s test names the PR thread as the second location, and
  when there is none, the commit is the whole test.

## Anchor a citation, or nothing has checked it

**Write the fragment you read, next to the line number:**

```md
`tls-origin.ts:144-149` "Defence in depth, and **not** what fixes the collision"
```

`citations.mjs` then checks that text is actually inside the cited range, and
says where it went when it is not — which is the only thing about a citation
that can be verified mechanically. The number on its own cannot be: it says a
line *exists*, and a line always exists.

Both spellings work, and the quoting rule is tight on purpose: a straight
double-quoted fragment, optionally after the closing backtick, with at most one
space between. A quotation further along the sentence is prose, not an anchor.

```md
`file.ts:120` "a fragment"        the anchor outside the code span
`file.ts:120 "a fragment"`        the anchor inside it
| `file.ts` | 120 "a fragment" |  in a findings table, in the `line` cell
```

**Keep an anchor to one line's worth of text.** Lines are joined before matching,
so an anchor that wraps across two lines of prose is fine; one that wraps across
a comment's `//` or `*` markers is not, and reports `not anywhere in the file`.
Shorten it — a shorter anchor is a *weaker* claim but never a wrong one.

### What the run tells you now, and what it does not

Four states, and no `N/N`:

| | means |
| --- | --- |
| `ok` | the anchor is in the cited range. The only state anything verified |
| `MOVED` | the anchor is not there. The reason says which line it is at now, or that it is nowhere in the file. **Exit 2** |
| `unanchored` | the lines exist and nothing checked them. The cited line is printed for you to judge by hand, which is the only check it has. **Exit 4**, but only under `--require-anchors` |
| `FAIL` | it cannot be right at all — file gone, line past the end, bare name matching several files, or a pin naming a commit this repository does not have. **Exit 1** |
| `MALFORMED` | a pin the checker cannot read — a rev that is not 7 to 40 hex characters, one after the line number, or one on a shorthand. Nothing excuses it. **Exit 32** |

**The exit code is a bitmask, not a ranking.** `citations.mjs` sets `EXIT` to
`unresolvable: 1`, `moved: 2`, `unanchored: 4`, `declaration: 8`, `indistinct: 16`,
`malformedPin: 32`, so a run with
one `MOVED` and one `FAIL` exits **3** — run to confirm on 2026-09-07, not read
off the table. Reading the code as "the worst thing that happened" loses the other
half; `!= 0` is the only reading a script should make of it. *(Cited as prose
rather than `file:line` on purpose: a real citation here becomes the nearest
preceding one for the two illustrative shorthands below, which then resolve
against a file they have nothing to do with.)*

**An unanchored run is not a passing run, it is an unchecked one.** `0 verified,
0 moved, 9 unanchored, 0 unresolvable` exits 0 and means nobody has looked.

**`--require-anchors` makes that exit 1**, for a branch holding itself to the
standard before the default gets there. It changes the exit code and nothing
else: the states, the counts and the per-citation lines are identical with and
without it, because whether an unchecked citation is tolerable is your policy and
not a fact about the record. The summary says `, anchors required` when it is in
force, so a CI log names the policy next to the numbers it judged.

The summary prints every bucket even at zero, because the fraction it replaced is
what this repo was measured getting wrong. Measured 2026-09-02: a fix inserted 28
lines, a cited comment moved from `144-149` to `170-175`, and the run reported
**9/9 resolve** while three citations pointed at a function signature and an
unrelated doc comment. That is the **dominant** case for a gate record rather than
an edge — a record is always committed on a branch whose fix moved lines.

Measured again 2026-09-04, on the gate record of the ticket that fixes this: the
pre-fix script reported **10/10 resolve, exit 0** over a `## Review` section where
two of the cited lines had become `: "";` and a stray `*/`, while the same branch's
anchor-checking version over the identical section reported **2 verified, 8
moved**, naming where each of the eight went. Both numbers were reproduced
independently by the reviewer. Run the thing you are changing over the artefact
that gates the change — it is the cheapest demonstration a ticket like this has.

The rule that prevents it upstream, and still holds: **cite what you read, never
compute one citation from another.** The off-by-one that started it was an end
anchor minus a length, missing the `+1` an inclusive range needs.

Two things it still cannot judge, and you must. A citation that is a finding's
own evidence ("the text is at `:94-95`, not `:93-94`") must stay as written even
when the run calls it moved — pin it to the commit it was true at, or, if no
commit ever held it, say so in a `<!-- citations: evidence ... -->` declaration.
The rule for which, and the command that decides it, sit beside the declaration
syntax above; whether the citation earns either is still yours. And an anchor is
only as good as the fragment chosen: `"const"` is on every line of the file and
verifies nothing.

**A citation into the record it is written in can never be distinct**, and
`--require-distinct-anchors` — which the citation gate always passes — reports it
by name as a `self-citation` rather than telling you to quote more. The fragment
it quotes is written on the citing line too, so lengthening it lengthens both
copies. Point it at the real subject, or write it as prose; no declaration excuses
it.

### Migration: nothing already committed is rewritten

Anchors arrived with repo-18, on 2026-09-04. **The 965 citations already in the
tree stay exactly as they are**, and this is the decision, not a deferral:

- Re-deriving an anchor for a merged record means re-reading the code each
  citation pointed at *at the rev it was written against* and deciding what it
  claimed. That is re-judging finished work, not migrating a format, and it would
  produce 965 unreviewed assertions in one commit.
- The reader is two-format on purpose and permanently. An unanchored citation is
  not an error and never becomes one by age; it is reported as `unanchored`, which
  is what it always was and what the old `N/N resolve` was hiding.
- **13 citations across six records were already anchored by hand**, in exactly
  this format, before anything could read them — `dl-23`, `pl-24`, `pl-25`,
  `dl-29`, `repo-7`. The format is theirs. Running the new script over them found
  a real defect nobody had seen: `pl-24` cites
  `grounding-fixtures.test.ts:29` for a test that is at line **53**, and the old
  script called that resolved.

**Anchor every citation in a record you are writing now.** That is the whole
migration: the population that matters is the records still being read against
live code, and they are the ones being written this week.

Making it an error **by default** is still not settled, and still needs a ticket
rather than a habit: turning it on for everyone today fails every gate run
against all 965. What exists is the opt-in above, so a later ticket flipping the
default finds the machinery built and tested rather than starting from nothing.
