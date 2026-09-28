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

- The reviewer returns the section; **whoever lands the ticket — the builder, or
  the fixer — commits the short form of every gate's section once, at the
  landing** (the two bullets above say which form), to the ticket, above
  `## Log`, one subsection per gate, never overwriting an earlier one. **Until
  the landing, a round's section is held, not committed**: in the gate's own
  file in the ticket's scratch directory, and on the PR thread when one is open.
  _A multi-round record lands once, at the end_, below, says why and what the
  final gate returns (repo-67, 2026-09-27).
- Each gate's report goes to the PR thread
  (`gh pr comment <n> --body-file <f>`): posted by whoever takes the round, as
  it comes back, when a pull request is already open, and otherwise by the
  lander, every one of them, when it opens the pull request. That is what makes
  a self-transcribed verdict falsifiable, and it is the only check on it.
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
- **A multi-round record lands once, at the end.** A multi-round record is
  several subsections whose coordinates are each correct only against the tree
  they were resolved against, and the citations gate checks the whole
  `## Review` against one tree (2026-09-20). Until 2026-09-27 each round's
  section was committed as it came back, so every later fix round moved or
  corrected lines an already-committed section cited, and each move cost a
  repoint, a pin or a trip back to the reviewer. On the 2026-09-27 batch — the
  orchestrator's own measurement, relayed in `repo-67`'s Why rather than read
  off one ticket — that was re-resolutions and repoints on `pl-48`, `repo-60`
  and `repo-64`, `dl-53`'s three landing stops, and on `repo-64` one shape (a
  citation repointed onto the very correction it should have gone back for)
  three times across three gate rounds. `citations-gate.mjs` refused each
  correctly; the cost was committing mid-flight. So, since `repo-67`:

  - **Nothing is committed per round.** Each gate writes each section it
    returns to a file in the ticket's scratch directory (`roles/reviewer.md`),
    and the orchestrator holds the paths. A round's dispatch to a builder or a
    fixer carries findings, never a record to commit.
  - **Every re-gate re-issues every earlier section**, alongside its own new
    `### Gate <n>`, re-resolved against the tip it reviewed: words, rows and
    verdicts unchanged, and a citation whose text a later round deleted, or
    whose claim a later round corrected though its anchor survives, rewritten
    by the gate as prose naming the sha that round gated, with one preamble
    sentence saying which. **Every re-gate, not only the last**: a gate cannot
    know its round is the last until the orchestrator has routed its findings,
    and the alternative is one more wake of the gate whenever it is.
  - **The lander commits the last set as given and repoints nothing**: gate 1's
    file without `--gate`, each later one with `--gate <n>`, one commit per
    gate, all at the tip the final gate reviewed. `review-record.mjs` refuses a
    section it finds `MOVED`; at a landing that means the tip moved after the
    final gate, so stop and report, and the orchestrator asks the gate for a
    re-issue. It is never the lander's to repoint — `dl-53`'s landing was
    ordered to splice byte-for-byte first and re-resolve second (2026-09-27),
    which the tool cannot do, and under this rule there is nothing to
    re-resolve. The lander's own Log entry moves no cited line, because a
    record never cites its own ticket file by coordinate (`dispatching.md`,
    _Send the findings in full_, on self-citation).
  - **Under conditional ship authority the records go in before the fixes.**
    A lander told to apply a last round of fixes and ship if the checks hold
    (`sizing.md`) lands past the tip the final gate reviewed. So it splices
    every record first, at that tip, where they resolve as given, and
    commits the fixes after — which makes them the case _A fix that lands
    after the records are committed_, below. Splicing after the fixes would
    meet a `MOVED` with no gate left to send it back to.
  - **The status goes in with the landing's first record commit** — `done`,
    or `in-flight` for work that lands partial — so no commit carries a record
    on a `ready` ticket. Before the landing there is no record, and neither
    `status.test`'s `reviewedButReady` nor preflight's `## Review` presence
    check has anything to read; `roles/builder.md` has the reasoning.
  - **A branch parked without landing still commits what it holds.** The
    scratch directory does not survive a container rebuild (the scratchpad
    bullet below), so when a batch ends with a branch unlanded — an open
    decision, a FAIL whose author stops — the last set the gate returned is
    committed then, with `in-flight`. That is `dl-58`'s "the gate record is
    committed whatever else is held" (2026-09-17), which still binds.

  **Re-resolved, never pinned — a pin here is exactly the branch-only sha this
  page forbids two sections down, and this is not hypothetical.** This page
  used to say an earlier round's coordinates "are pinned to the sha that round
  reviewed," and two builders (`pl-48`, `repo-60`) followed that wording on
  2026-09-27, pinning to `ac00b8d`, `f1bde60` and `247073d` — each a commit
  that exists only on the branch being built. Both pins cost a reviewer
  re-resolution once they were checked against a tree that could no longer
  reach those shas. There is no reading where a multi-round record's own
  coordinates are exempt from that rule.

- **A fix that lands after the records are committed does not edit a
  section.** Two cases are left where a committed record meets a later fix,
  both conditional ship: a last round of fixes applied after the records, and
  a pull request opened and then one narrow gate (`SKILL.md`, _The PR is not
  the end of gating_). The section stays as a description of the sha it
  reviewed; the builder adds a dated post-gate Log entry naming the new sha and
  saying the record above describes the earlier one; a coordinate the fix moved
  is repointed by the builder, coordinate only and only where the anchor text
  still reads unchanged, each change named in the Log — a fixer stops and
  reports instead (`roles/fixer.md`); and a citation the fix deleted outright, or whose claim it corrected
  even where the anchor survives, goes back to the reviewer for an amended
  bullet, marked in place as amended at the new sha, because a finding's words
  are the reviewer's to change (2026-09-13, 2026-09-18). The reviewer returns
  text and never edits a file, and a coordinate-only repoint changes no
  verdict, row or severity, so it is the same kind of repair as the
  self-citation one and not the builder editing the record.
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
     very lines its record cited — handled at the time, correctly for that
     session, not by remapping every citation mechanically but by **pinning
     the record to the commit the gate reviewed** (`git log -S 'pinning the
     record' -- reference/records.md` dates that wording to `ea52f8b`,
     2026-08-24 — this is what that session actually did, restored here
     rather than rewritten into "repointed" — gate 2, finding A, on a rewrite
     that also made "not by remapping but by repointing" self-contradictory,
     since the two name the same act). **That was the cheaper answer when the
     reviewed tree was the one the findings describe, and it is not today's
     rule.** A pin to that commit is exactly the branch-only-sha rule below
     forbids: this repo squash-merges and deletes the branch, so a pin to a
     commit that exists only there goes `unresolvable` the moment it is gone
     — see the branch-only-sha
     rule below, and repo-64's own history row, twice.
  3. **You re-resolve, then make one more edit.** One builder ran its check clean
     at 10/10, then applied a comment fix that moved two citations. It caught this
     only by re-running. "Before committing" is not tight enough; it has to be
     last.
  4. **The formatter reflows the file after you write the record.** oxfmt
     rewrapping gate tables broke a self-referential row twice on one branch and
     was confirmed on another. Format first, resolve second.
  5. **You run the check from a checkout that is not the branch's.** By
     default — no `--rev` — both `citations.mjs` and `citations-gate.mjs`
     resolve every unpinned `file:line` against the working tree of the
     process running them, never against a sha you merely name in your head.
     `citations.mjs --rev <sha>` is the documented exception below and does
     resolve against a named commit; `citations-gate.mjs` has no `--rev` at
     all, so for it this mode is unconditional (**gate 1, finding 13**, on
     this paragraph's own first draft). So a run from the orchestrator's own
     worktree, or from a shared checkout that is on a different branch,
     silently checks the wrong tree and reports numbers about content that is
     not the ticket's. Measured on the 2026-09-27 batch, twice: once against
     the orchestrator's own checkout, once inside a round-1 gate's worktree
     that had not detached to the sha under review yet. Run it from inside a
     worktree already checked out at the exact commit you mean to check, and
     say which sha that was.

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
  <sha>` printing nothing is the tell. **Pinning to the base has one blind
  spot, not a general failure: a record cites the tests *this* branch
  introduces, and those do not exist at the base yet.** Everything else a
  record cites — pre-existing code, another ticket's own file, a shared script,
  a rule page — already exists there, and pinning it there is strictly better
  than the alternative below, because a pin is read at its own commit
  regardless of what the working tree holds later. So, since repo-78:

  - **A citation of content that already existed at the base pins to the
    base — or to any other `main` commit that holds it — by default, not only
    for a Log passage citing pre-existing code, which is the case this page
    used to single out.** A gate's own `## Review` section cites exactly as
    much pre-existing content as a Log entry does, and until repo-78 those
    citations were left unpinned, anchored, and "re-resolved as the last
    action before commit" — which only proves the citation true *at that
    instant*, and every one of the four incidents below is the same failure:
    a citation true when written, broken by a commit that landed after it.
    Three of the four are a different branch entirely; the fourth (repo-48)
    is a citation broken by its *own* record's later round, which the
    existing "re-resolved as the last action before commit" discipline was
    already supposed to catch and, on that occasion, did not.
    - repo-60's merged record cited a line in repo-63's own ticket file;
      repo-63's landing splice moved it (#306).
    - repo-67's record cited `scripts/preflight.mjs:410` "if (hasGateRecord(content))",
      which #308 rewrote in place, same number, new text (#304).
    - repo-48's evaluation cited line 318 of this skill's own
      `reference/concurrency.md`, moved by its own later round (#307).
    - `SKILL.md` cited `CLAUDE.md`'s "## Handing back" by line; #305's edit
      moved it.

    Each repair turned the coordinate into a pin at the base by hand, because
    the base is a `main` commit and stays reachable — the property that
    already made it safe for a Log citing pre-existing code, below, and the
    same reason a pin does not launder anything: it is checked exactly as
    hard as an unpinned citation, just against a rev that does not move.
    Write it that way from the day the citation is written rather than after
    the first drift finds it — `file@<base sha>:line`, anchor after it as
    always. Proven end to end against a citation that moved for exactly this
    reason, one record with both forms of the same claim over the same
    drifted commit — unpinned reports `MOVED`, pinned to the base reports
    `ok`: `scripts/test/citations.test.ts:2945` "a citation pinned to the base survives".
  - **A citation of content the branch under review itself introduces has
    nothing on `main` to pin to yet, so it stays unpinned, anchored, and
    re-resolved as the last action before commit** — the rule this page
    always gave, kept for exactly the case it was written for. After the
    squash those lines are on `main` under the same content, so an unpinned,
    anchored citation survives the merge where a pin to the branch's own tip
    does not; it is still exposed to an *unrelated* later edit of the same
    file, the same as any unpinned citation is, and the repair, when that
    happens, is the ordinary one — repoint it, or pin it once the content is
    reachable from `main`. **One exception: introduced content that lives
    under `.claude/` is named by page and heading, never by an unpinned
    line** — `citations-gate.mjs` checks every `.claude/` citation for a pin
    unconditionally, so an unpinned coordinate into one, even of this
    branch's own new material, is `unpinned-volatile` in CI the day it is
    committed, not merely exposed later (repo-78 gate 1, F2; reproduced —
    a one-bullet section citing this page's own new gap-6 paragraph by bare
    coordinate spliced clean, then `citations-gate.mjs --against origin/main`
    exit 1, `1 unpinned-volatile`). Run the dry-run in `roles/reviewer.md`
    with `--require-claude-pins` so it sees what CI sees. **A heading-form
    reference is not read by the checker at all** — `INLINE` requires a line
    number, so `extractCitations` never extracts one, and it is not counted
    even as `unchecked` — which makes it a disclosed limit on what this page
    can verify, not a claim that anything checks the heading still exists.
  - **Whose repoint it is when a *later, unrelated* commit moves a line an
    already-merged record cites — repo-81's gap 6, and repo-47's own
    subject — is not settled by this rule, and this rule does not try to
    settle it.** A base-pinned citation is immune to this by construction:
    the pin is read at the base commit, which no later splice on any branch
    can move, so there is nothing to repoint for that population. Two
    populations remain exposed, both real: every record merged before this
    rule existed, unpinned; and, under this rule itself, any citation of
    content a branch introduces, which can never be pinned to the base and
    stays a live, unpinned coordinate on `main` forever once merged
    (reproduced — one comment line inserted above the tests repo-60 and
    repo-63's own merged records cite in this repository's
    `scripts/test/citations.test.ts`, then `citations-gate.mjs --against
    origin/main` exit 1, 2 records newly `moved`). **Today's rule, unchanged
    by this ticket, is that the branch whose change moves the line repoints
    it — coordinate only, pinned to a commit where the content now exists,
    named in its own Log — because that branch's own CI is the one the move
    turns red.** Whether that allocation of the cost is the right one is
    exactly repo-47's open question
    (`docs/work/repo-47-the-citations-gate-fails-a-code-pr-on-merged-records.md`,
    `status: needs-decision`), which this ticket does not reopen, decide or
    pre-empt. This ticket's own `Done when` survival claim is scoped to the
    first population only — a citation of content that predates the branch —
    for exactly this reason: a citation of content the branch introduces
    survives by being repointed by the owner today's rule names, not by
    being immune to drift the way a base pin is.
  - **Where a later commit deleted the cited text outright, rewrite the citation
    as prose naming the reviewed sha, or declare it as evidence.** `dl-58`'s
    owner decision D4(b) is the worked example: pins dropped from the record in
    favour of prose plus declarations (2026-09-17).
  - A tag on the reviewed commit would also keep pins reachable, exit 0 in the
    same simulation; the owner chose prose (2026-09-15). Do not re-derive the tag
    remedy without re-asking.
  - **The same holds for a sha in a ticket's `Done when` or Log**, because a
    ticket outlives the branch that filed it by definition. Name a `main` commit,
    a tag, or the pull request whose head ref (`refs/pull/<n>/head`) keeps the
    branch-only commits fetchable — a filed ticket named three such shas with no
    route back to them and was caught by its own gate (2026-09-20).

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
  - **Since repo-55 both practices above are enforced by
    `scripts/review-record.mjs` rather than followed by hand**: it finds the
    insertion point by heading form, checks the section, restores from `HEAD`
    on a failed check, and prints the normalised diff that is the disclosure
    note. `review-ticket` step 8 names it. The provenance above stays as the
    record of why it exists (2026-09-20).
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

  **For a gate record's own citation, run `git log origin/main -S'<...>' --`,
  never `--all`.** `--all` walks every local ref, including the branch under
  review itself, and a text that lived only on that branch's own earlier
  commit still returns non-empty — answering "pin" for a sha the branch-only
  rule below forbids pinning to. `dl-53`'s lander had to substitute this by
  hand for gate 5's `DEMUX_READ_FAILED` citation (its Landed Log entry). A
  gate record with no match on `origin/main` gets a declaration, not a pin to
  wherever `--all` found it.

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

- **Both halves of each gate go in the ticket at the landing**, short form and
  reasoning, with a one-line preamble saying the long form is here because no
  PR thread existed to hold it. The two-locations rule exists so the copies cannot drift; one location
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
when the run calls it moved — pin it to a commit that survives (the base or a
`main` commit, never the branch under review's own), or, if no such commit
ever held it, say so in a `<!-- citations: evidence ... -->` declaration. The
rule for which, and the command that decides it, sit beside the declaration
syntax above — `git log origin/main -S` rather than `--all` when the citation
is a gate record's own; whether the citation earns either is still yours. And
an anchor is only as good as the fragment chosen: `"const"` is on every line
of the file and verifies nothing.

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

**A citation into any file under `.claude/` is written either pinned —
`<file>@<rev>:<line>` with `<rev>` a `main` commit — or as the page and the
heading it sits under, with no line number. A bare `file:line` into `.claude/`
is a finding** (repo-52, 2026-09-20). Those pages are prose the loop edits
every few sessions, and every insertion displaces every unanchored coordinate
below it, silently: the gate reads `## Review` only, and an unanchored citation
is `unanchored` whatever line it now lands on. One sweep of the rule pages
paid three of its four gate rounds for that class and pinned 35 citations in
eleven merged records by hand before repo-52 pinned the rest. The checker
reports the bare form as `unpinned-volatile` under `--require-claude-pins`,
off by default; a citation failing for a more specific reason keeps that
state.

**Since repo-78 the same pin-to-a-surviving-sha rule applies to a citation
into pre-existing content anywhere, not only under `.claude/`** — the
paragraph above two sections up, _A gate record never pins to a branch-only
sha_, is where that generalisation lives; `.claude/` is the one place it is
also **mechanically enforced**, because `--require-claude-pins` and
`citations-gate.mjs` only ever check a citation's *target* path against that
one prefix. A citation elsewhere that a reviewer leaves unpinned against
pre-existing content is caught by drift, the same way it always was, and not
by CI before that: nothing refuses it. **`--displaced-since` is not that
enforcement, and this page said so wrongly at first** (repo-78 gate 1, F5):
it is already threaded through the whole gate, not merely a one-record tool —
`node scripts/citations-gate.mjs --displaced-since <ref>` reads every record
`citations-gate.mjs` reaches, 214 of them measured at the base — but it only
reports a citation that is **both unanchored and unpinned**, and this page's
own _Anchor a citation, or nothing has checked it_ already requires an anchor
on everything `citations-gate.mjs` enforces. So an enforced record has
nothing left for `--displaced-since` to find regardless of whether CI passes
the flag; it answers a real question, just not this one. **Extending
`citations-gate.mjs` to refuse an unpinned citation of pre-existing content
is real machinery this ticket did not build** — repo-80
(`docs/work/repo-80-land-records-one-command.md`), which already touches
`review-record.mjs`'s landing path, carries it now: its `--land` refuses a
section with an unpinned citation of content that predates the branch,
since landing is the one place that already knows the base.

**Anchor every citation in a record you are writing now.** That is the whole
migration: the population that matters is the records still being read against
live code, and they are the ones being written this week.

Making it an error **by default** is still not settled, and still needs a ticket
rather than a habit: turning it on for everyone today fails every gate run
against all 965. What exists is the opt-in above, so a later ticket flipping the
default finds the machinery built and tested rather than starting from nothing.
