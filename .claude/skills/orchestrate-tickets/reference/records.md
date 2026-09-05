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

  **A record and a Log passage pin to different commits, and swapping them breaks
  one of them.** This repo squash-merges, so a branch sha does not survive the
  merge — pin a record to it and the `--rev` dangles for everyone who reads the
  ticket afterwards. The obvious correction, pinning to the base instead, is
  worse: a gate record cites the tests the branch *introduced*, and those lines
  do not exist at the base, so every citation fails. So:

  - **A gate record pins to the sha it reviewed**, and says in its header that
    this is a pre-squash branch sha, kept because it is the only tree where those
    citations resolve, reachable afterwards through the ticket's pull request.
  - **A Log passage citing pre-existing code pins to a sha that survives** — the
    base, or a `main` commit.

  **A committed record can be spliced by a later edit, and nothing here catches
  it.** `review-ticket` spends several paragraphs protecting "the caller commits
  the gate record **verbatim**", and frames the threat as the caller editing a
  reviewer's words. The realistic threat is different: a *later* agent, appending
  something unrelated, splicing into the record it is not touching.

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
    silent. (Measure that exit code without a pipe: `$?` after `| tail` is
    tail's.)

  **So a bare filename is not a citation in this repo — it is a coin flip the
  tool refuses to make.** `travel.ts:286` matches three tracked files and
  `brief.ts:505` matches two; the resolver fails both rather than picking, which
  is the right design and is also the reason the habit has to be to *write* the
  qualifying path, not to fix it when the script complains. Four ambiguous
  citations across three tickets in one day is what made this worth stating.
  Qualify far enough left to be unique — `api/src/runs/travel.ts:286-310`,
  `contract/src/brief.ts:505` — and the check becomes a confirmation instead of
  a rework.

  It cannot judge two of the four modes, and says so: a citation whose *content*
  changed still resolves, and a citation that is a finding's own evidence must
  stay wrong. Those are yours. Run it as the genuinely last action before
  `git add` regardless — it is a second and cheaper thing to be last, not a
  replacement for being careful about the order.

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
    remap will silently "fix" it and destroy the finding.

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

## `citations.mjs` reports resolution, not correctness

**A green run is not evidence a citation is right.** The script checks that a
cited line *exists* at the rev, not that it says what the citation claims — so a
citation whose referent moved lands on whatever is now at that number and is
reported as resolved. Measured 2026-09-02: a fix inserted 28 lines, a cited
comment moved from `144-149` to `170-175`, and the run reported **9/9 resolve**
while three citations pointed at a function signature and an unrelated doc
comment.

Measured again 2026-09-04, on the gate record of the ticket that fixes this: the
pre-fix script reported **10/10 resolve, exit 0** over a `## Review` section where
two of the cited lines had become `: "";` and a stray `*/`, while the same branch's
anchor-checking version over the identical section reported **2 verified, 8
moved**, naming where each of the eight went. Both numbers were reproduced
independently by the reviewer. Run the thing you are changing over the artefact
that gates the change — it is the cheapest demonstration a ticket like this has.

This is the **dominant** case for a gate record, not an edge: a record is always
committed on a branch whose fix moved lines. So **judge the printed lines
individually and never read the total** — comparing counts would have shown 9/9
at every point in that work. And the rule the same session drew, which prevents
the error upstream: **cite what you read, never compute one citation from
another.** The off-by-one that started it was an end anchor minus a length,
missing the `+1` an inclusive range needs.
