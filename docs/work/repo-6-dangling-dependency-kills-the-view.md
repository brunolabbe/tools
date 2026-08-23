---
id: repo-6
tool: repo
title: Warn beside the table when a depends_on dangles, instead of exiting with no output
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-6 — one dangling `depends_on` denies every ticket to every reader

**Packages:** `scripts`

## Why

`readTickets` (`scripts/status.mjs:127`) validates every `depends_on` id against
the ticket files present **on the current branch**, and throws when one names a
ticket it cannot find — `scripts/status.mjs:155-161`:

```js
for (const ticket of tickets) {
  for (const dependency of ticket.depends_on) {
    if (!byId.has(dependency)) {
      throw new Error(`${ticket.file}: depends_on "${dependency}", which is not a ticket`);
    }
  }
}
```

`main` calls it at `scripts/status.mjs:402`, on the third line, **before any
view is selected and long before any renderer runs**. The top-level handler at
`:521-525` writes the message to stderr and sets exit 1. So the failure is not a
warning beside a table: it is the whole command, for every tool and every mode,
producing nothing.

### Reproduced

Reproduced here on `60e48e7` (`origin/main`), in a throwaway copy of the ticket
tree with one scratch ticket added carrying `depends_on: [repo-404]`. Every mode
the script has:

```
$ npm run status
> node scripts/status.mjs

docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1

$ node scripts/status.mjs --ready
docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1

$ node scripts/status.mjs --json
docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1

$ node scripts/status.mjs --show dl-16
docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1

$ node scripts/status.mjs --markdown
docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1

$ node scripts/status.mjs --tool downloader
docs/work/repo-99-scratch-probe.md: depends_on "repo-404", which is not a ticket
                                                                       # exit 1
```

That one line is the entire output. The error is on **stderr**, and stdout is
empty — measured, not assumed: `node scripts/status.mjs --json 2>/dev/null` is
**0 bytes**. `--show dl-16` is included deliberately: `dl-16` has nothing to do
with the malformed ticket, and asking about it still fails. `--tool downloader`
narrows to a tool the offending ticket is not in, and fails too, because the
narrowing at `:416` happens after the read.

Re-running the same probe with `depends_on: [dl-22]` — a real id that is in
review on #78 and not on `main` — gives the identical failure, naming `dl-22`.
The check is `byId.has(dependency)` over the files on this branch, so
"never filed" and "not merged yet" are the same condition to it.

### Two independent encounters, and they are not the same kind of evidence

**1. A deliberate probe, which mapped the blast radius.** pl-26's gate 1 (PR
#72, `origin/pl-26-not-ready-yet`, in that ticket's `## Review`) was testing
whether `depends_on` could name a not-yet-filed slice. The reviewer constructed
a scratch ticket with `depends_on: [pl-99]` on purpose and enumerated the
effect across the views. Read it with
`git show origin/pl-26-not-ready-yet:tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md`;
the finding is:

> a `depends_on` naming a ticket that does not exist does not merely fail for
> that ticket — `readTickets` throws before any view renders, so **every**
> invocation exits 1 repo-wide (`--ready`, the default, `--json`, `--show`).

That is the stronger evidence and it is where the mechanism was established.

**2. An accidental encounter during ordinary work**, in a parallel session
(`tools-45`), from the opposite direction. It was filing an unrelated ticket and
wrote `depends_on: [dl-22]` because dl-22 genuinely was a prerequisite —
in review at the time, not yet merged. It was not testing the script;
`npm run status` simply stopped working. One encounter, not a sweep — and that
is the point of it. **The defect fires without anyone hunting for it**, which is
a different claim from "it can be triggered".

The second half is also where the cost lives. A ticket with a not-yet-merged
`depends_on` is **valid on its own branch**, where the ticket it names is
present. It becomes a repo-wide outage only if it merges ahead of the ticket it
depends on — so the person who wrote it never sees the failure, and the person
who does has no reason to connect their broken `npm run status` to someone
else's merge. `depends_on` is documented as "ticket ids that must land first"
([docs/01-TICKETS.md](../01-TICKETS.md)), which is exactly the field's purpose,
and the ordinary use of it is the trap.

### This is not [repo-3](./repo-3-show-a-closed-ticket.md), and here is the line between them

Close enough to be mistaken for a duplicate, so:

- **Different function, and this one fires earlier.** repo-3 is about
  `printTicket` / `describeTicket` — a **closed** ticket whose dependencies are
  satisfied ends its `--show` output with the word `unblocked`. repo-6 is about
  validation during **parsing**, in `readTickets`. In repo-6's failure repo-3's
  code never executes at all, because nothing reaches a renderer.
- **Different blast radius.** One misleading line in one view, versus the entire
  command — every tool, every mode, no output.
- **Neighbours worth doing in one sitting.** Same file, both about how
  `depends_on` is handled, and the tests for both belong in
  `scripts/test/status.test.ts` using the same `repoWith` helper. Whoever picks
  up either should read the other first.

repo-3 is in review on PR #75 and is not on `main` yet, which is why this
ticket's `depends_on` is `[]` and names it only in prose — a forward reference
in the frontmatter of _this_ ticket would be the defect it documents.

## Build

1. **`scripts/status.mjs:155-161` — collect instead of throwing.** Have
   `readTickets` gather the dangling edges and let the caller decide, rather than
   ending the process from inside the reader. Shape is open (a second return
   value, a `problems` array on the result, an optional `onProblem` callback);
   the requirement is that a malformed ticket costs its own row and nothing
   else, and that every other ticket still renders.

   Keep the message text as it stands — it is a good line, it is asserted by a
   test, and only where it is printed and what happens afterwards should
   change.

2. **`describeTicket` (`:273-280`) must be fixed in the same change, and this is
   the trap.** Deleting the throw alone makes `--show` on the offending ticket
   _worse_, not better. Measured, with the throw neutered in a copy of the
   script:

   ```
   $ node scripts/status.mjs --show repo-99
   Cannot read properties of undefined (reading 'status')      # exit 1
   ```

   Because `:277-279` does `byId.get(dependency)` and then filters on
   `.status`, and a dangling id maps to `undefined`. Today's named message is
   replaced by an anonymous `TypeError` naming no file. A dangling id has to
   reach `printTicket` as something printable — `repo-404 (not a ticket)` beside
   the real blockers is the obvious shape.

3. **The other two readers already cope, so do not "fix" them.** Verified with
   the same neutered copy:
   - `readyTickets` (`:224-226`) filters on `depends_on.every((id) =>
done.has(id))`. A dangling id is not in `done`, so the ticket is withheld
     from `--ready` — conservative, and the right answer already.
   - The default view prints `(waits on repo-404)` from `:455`, which reads
     `depends_on` directly. It rendered every other ticket correctly.

   So the surface that actually needs work is step 1's plumbing plus
   `describeTicket`. Do not rewrite the renderers.

4. **Where the warning goes.** stderr, beside the table rather than instead of
   it, so a pipeline that reads stdout is unaffected and a person sees it. Emit
   one line per dangling edge, naming the file and the id — the same text as
   today.

5. **Decide the exit code deliberately and write it down.** The two are
   separable and should be separated: the _payload_ is what the reader gets, the
   _exit code_ is how a pipeline fails. A reasonable rule is that the interactive
   views (default, `--ready`, `--show`, `--markdown`) exit 0 with a warning —
   because a person got their answer — and that `--json` keeps a non-zero exit.

   **`.github/workflows/ci.yml:109` is what decides this, and it is worth
   reading before choosing:**

   ```yaml
   - run: node scripts/status.mjs --json > /dev/null
   ```

   It discards stdout entirely, so **the exit code is the whole of CI's check on
   ticket frontmatter** — that is the only place in CI that reads the tickets at
   all, as the comment above it says. Make `--json` exit 0 on a dangling
   dependency and that gate silently stops catching them. **The strict check
   must not be lost**; this ticket is about who pays for it, not about dropping
   it. Pick a rule, say why in the Log, and check that step by hand.

### What `--json` should do

Neither encounter covers this, and it is the sharpest part of the defect. Today
`--json` gives a machine consumer **exit 1 and zero bytes on stdout**. Three
different conditions are indistinguishable from that:

- a malformed ticket somewhere in the repo;
- a repo with no tickets at all;
- the script not being installed, not being reachable, or not having run.

One signal, three causes, and the only thing separating them is a prose line on
stderr that no JSON consumer parses. An agent asking "what is ready" gets the
same empty answer whether the board is clear or the tooling is broken, and the
safe reading of an empty board — "nothing to do" — is the wrong one in two cases
out of three.

**Recommendation: `--json` emits the tickets it _could_ read, plus a structured
description of the ones it could not.** Something like:

```json
{
  "tickets": [ … ],
  "problems": [
    { "file": "docs/work/x.md", "kind": "dangling-dependency", "id": "repo-6", "dependency": "dl-22" }
  ]
}
```

A consumer that ignores `problems` behaves exactly as it does today on a healthy
repo; one that reads it can tell all three conditions apart, because valid JSON
on stdout is itself the proof that the script ran. **The exit code is a separate
decision from the payload**: a caller that wants to fail a pipeline on malformed
input still needs to be able to, so emitting the payload and exiting non-zero is
a coherent combination and probably the right one for `--json` specifically —
CI's existing `--json` step keeps failing, and a human reading the output now
learns what is wrong and what the rest of the board looks like. Write the choice
into the Log either way; a JSON shape is a contract the moment something reads
it.

If the implementer concludes otherwise after reading the script, say so with the
reasoning rather than transcribing this.

## Tests

`scripts/test/status.test.ts` exists (355 lines) and is where this belongs, with
two things to know before writing:

- **One existing test asserts the current behaviour and must be rewritten, not
  added to** — `:188-191`:

  ```ts
  test("a dependency on a ticket that does not exist is caught", () => {
    const root = repoWith({ [at("pl-1")]: pl("pl-1", { depends_on: "[pl-99]" }) });
    expect(() => readTickets(root)).toThrow(/depends_on "pl-99", which is not a ticket/);
  });
  ```

  It is the whole of the current coverage. Its replacement should assert the
  same condition is still _detected_ — the point of the strict parser survives —
  while the other tickets still come back.

- **The CLI cannot be pointed at a throwaway root.** `main` hardcodes
  `const repoRoot = DEFAULT_ROOT` (`:401`) and there is no `--root` flag, so the
  `run()` helper (`:66`) always executes against the real repo. An end-to-end
  CLI assertion about a malformed ticket therefore has nowhere to put one, short
  of writing a broken ticket into the repo — which is not acceptable. Either
  test the reader and the renderers directly with `repoWith`, or add a root
  argument for the tests to use and say so in the Log.

What to assert, using `repoWith`:

- a repo with one dangling `depends_on` and three sound tickets returns all four
  tickets, and reports exactly one problem naming the file and the missing id;
- `--ready`-equivalent output still lists the sound ready tickets, and does not
  list the malformed one;
- `describeTicket` on the malformed ticket returns rather than throwing, and
  `printTicket` renders a line naming the missing id — the regression guard for
  the `TypeError` in Build step 2;
- `describeTicket` on an unrelated ticket in the same repo is unaffected;
- the `--json` payload contains both halves, and parses;
- a genuinely broken ticket is still reported, so the strictness the parser
  exists for is not quietly dropped.

## Done when

- With a ticket whose `depends_on` names an id no file carries, `npm run status`,
  `-- --ready`, `-- --markdown`, `-- --tool <name>` and `-- --show <unrelated>`
  each print their normal output plus a warning naming the file and the missing
  id. None of them prints only the error.
- `npm run status -- --show <the malformed ticket>` prints the ticket and names
  the missing dependency, and does not print `Cannot read properties of
undefined`.
- `npm run status -- --json` writes parseable JSON to stdout that contains the
  readable tickets and a structured account of the unreadable dependency. Its
  exit code is whatever Build step 5 decided, and the Log says which and why.
- The strict check still exists: a test proves the dangling dependency is
  detected and reported, and `node scripts/status.mjs --json > /dev/null` —
  `.github/workflows/ci.yml:109`, which reads nothing but the exit code — still
  fails on a repo containing one.
- `scripts/test/status.test.ts:188-191` has been rewritten rather than deleted,
  and the tests listed under **Tests** exist and fail against `60e48e7`.
- `npm run check` and `npm test` are green.

## Gates

### Gate 1 — 2026-08-23 · **CONCERNS**

Reviewed at `399433c`. The code was found sound and every mechanical claim
reproduced: the mutation sweep with its control at 0, the seven-mode table run
independently against a scratch ticket of the reviewer's own, and the CI premise
checked against real run logs rather than the diff — run `32664738928`, the
`4e3c48e` docs-only merge, shows `check` green in 27s with `test` skipped, which
is exactly the scenario the exit-code decision rests on. The verdict is
CONCERNS on the strength of two documentation findings, both now addressed.

**Citations re-resolved against this branch's tip.** `scripts/status.mjs` and
`scripts/test/status.test.ts` are byte-identical to `399433c`, so the
line numbers below are the reviewer's except for five that were already
approximate in the record and are corrected here: `ticketDirs`'s `readdirSync`
is `:235-239` not `:234-236`; the top-level handler is `:634-641` not
`:632-637`; `(waits on …)` is `:565` not `:455`; the real-blocker-and-dangling-id
test is `:362-371` not `:365-370`; the healthy-repo `test.each` is `:573-584`
not `:583-592`. All twenty-five citations in this section were verified
programmatically — each span checked to still contain the string it is cited
for — and the reviewer's own file is posted unedited on the pull request, so the
delta is visible rather than quietly folded in. The `docs/work/repo-3-…`
citations in finding 1 are deliberately left as the reviewer wrote them: they
are the stale-before values and documenting what was wrong is their whole
purpose.

| #   | Severity           | Finding                                                                                                                                                                                                                                                                            | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | med                | `docs/work/repo-3-show-a-closed-ticket.md` — all four `file:line` citations invalidated by this branch (`repo-3:72`, `:88`, `:112`, `:130`), and both code blocks it quotes as current code no longer exist anywhere in the file. repo-3 is the next ticket built.                 | **Fixed.** Both snippets replaced with the code as it reads now; `describeTicket` `:277-279` → `:325-329`, `printTicket` `:479-483` → `:591-597`, Build step 1's `:465-484` → `:575-598`, the `OPEN` callers `:250`/`:298-299`/`:441` → `:286`/`:348-349`/`:551`, the test citations `:249-271`/`:332-337` → `:324-379`/`:449-454`. Build step 2's `{ ticket, blockers }` corrected to `{ ticket, blockers, missing }`, since it is the sentence asking repo-3's builder to choose a return shape. A new Build step 5 records what repo-6 changed for it, including that its closed branch goes **in front of** the `holding.length === 0` condition rather than in place of it, and that the defect itself still reproduces. No part of repo-3 implemented. |
| 2   | med-low            | `docs/adr/003:187-192` asserts a `depends_on` pointing at nothing "is a named failure rather than a row quietly missing from a table" — false for one of its four items after this branch, and the only uncorrected statement of the old rule that is not historical ticket prose. | **Fixed.** An `_Outcome, 2026-08-23:_` annotation appended to that bullet, in the pattern the same section already uses twice (`:180-185`, `:193-199`) — the ADR's own claim is left byte-unchanged, because it records what was believed when the decision was taken. The annotation says which three items remain fatal and why (a ticket that will not parse has no row to fall back to), and that the strictness is charged to `--json` rather than dropped. My Log named that pattern and then did neither, which is what the finding was about.                                                                                                                                                                                                        |
| 3   | low                | `--root` is discoverable — in `OPTIONS` at `scripts/status.mjs:430` and in the parser's error message — but absent from both prose flag lists, so the Log's "a plain option listed in `OPTIONS`, not hidden" claims more than `OPTIONS` can carry.                                 | **Fixed, in one of the two lists.** `docs/01-TICKETS.md`'s flag block now lists `--root <dir>` marked as a test seam, with a sentence saying it is listed for completeness rather than for use and that the six above it are the whole of "what is next". `CLAUDE.md`'s `## Commands` is deliberately left at six: it is the short list a person reads to run the repo, and root `CLAUDE.md` is explicit that its sections are not to be padded. Reviewer's verification that the cheaper route does not exist is recorded and matches mine — `DEFAULT_ROOT` derives from the script's own location (`scripts/status.mjs:50`), so setting `cwd` on the spawn would have changed nothing.                                                                     |
| 4   | low, informational | `--root` on a path that does not exist gives a raw `ENOENT` from `ticketDirs` (`scripts/status.mjs:235-239`), unguarded. Measured: `--root /nonexistent-xyz` → `ENOENT … scandir '/nonexistent-xyz/tools'`, exit 1; a directory with an empty `tools/` → exit 0, zero bytes.       | **No change, and none needed.** The message names the offending path and goes through the top-level handler at `scripts/status.mjs:634-641`, so there is no stack trace and no anonymous failure — the property this ticket exists to protect. Guarding it would be a second error path for a flag whose only caller is the test suite. Reviewer agreed with the reasoning; recorded here so it is not re-derived.                                                                                                                                                                                                                                                                                                                                           |
| 5   | low, informational | `.github/workflows/ci.yml:98-100`'s comment says the step "**fails** by file and line" on "a `depends_on` pointing at nothing", and strictly a dangling edge is no longer a parse failure.                                                                                         | **No change, and none needed.** What that step _observes_ is byte-for-byte what it observed before: exit 1, and the same file-and-id line on stderr in the CI log. The comment describes the step's behaviour, which did not change; rewriting it would make the workflow diff say something happened there when nothing did. That the workflow needed no edit is itself the evidence the exit-code rule is the right one. Reviewer agreed.                                                                                                                                                                                                                                                                                                                  |

**Acceptance**

| #   | `Done when` line                                                                                                                                                                              | Verdict      | Proof                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | every interactive mode prints its normal output plus a warning naming the file and the missing id                                                                                             | **proven**   | `scripts/test/status.test.ts:483-494` (`test.each` over the default view, `--ready`, `--markdown`, `--tool`, `--show <unrelated>`; each asserts its own payload on stdout, `status === 0`, and `stderr` equal to exactly the one warning line). Reproduced independently by the reviewer across all seven modes plus `--prs`. |
| 2   | `--show <the malformed ticket>` names the missing dependency and does not print `Cannot read properties of undefined`                                                                         | **proven**   | `scripts/test/status.test.ts:561-568`; unit-level guard at `:352-357`. Reviewer measured `blocked by  repo-808 (not a ticket)`, 263 B, exit 0.                                                                                                                                                                                |
| 3   | `--json` writes parseable JSON containing the readable tickets and a structured account of the unreadable dependency; the exit code is Build step 5's decision and the Log says which and why | **proven**   | `scripts/test/status.test.ts:525-549` (parses, both halves, `status === 1`) and `:551-557` (narrowed by `--tool`, problem still reported). The decision and its reasoning are in the Log below and in `EXIT_ON_PROBLEMS`'s JSDoc.                                                                                             |
| 4   | the strict check still exists, and `node scripts/status.mjs --json > /dev/null` still fails on a repo containing one                                                                          | **proven**   | `scripts/test/status.test.ts:231-244` (the condition is still detected, by file and id) and the `status === 1` assertion in `:525-549`. **verified** as a command by both builder and reviewer: exit 1 with the ticket present, 0 without.                                                                                    |
| 5   | `scripts/test/status.test.ts:188-191` rewritten rather than deleted, and the listed tests fail against `4e3c48e`                                                                              | **proven**   | The rewrite is at `:231-244`, and `:499-520` pins the negative half — the same tree minus its malformed ticket produces byte-identical stdout for the views that do not list it. The whole new suite against `4e3c48e`'s `status.mjs`: **21 tests fail** — builder and reviewer measured the same number.                     |
| 6   | `npm run check` and `npm test` green                                                                                                                                                          | **verified** | Both re-run by the reviewer in its own worktree: `check` exit 0, `npm test` 101 files / 1436 tests, `npm run format` clean with no drift. Re-run again after this round.                                                                                                                                                      |

**What the gate did not cover**, recorded because it is the half a green report
hides: e2e and container gates unrun (out of scope, and this change touches
neither); the Windows half of the CI matrix unrun; six of the ten mutations not
independently reproduced (four were, plus the control and the against-`main`
run); and the reviewer did not re-derive the original defect, accepting the
builder's reproduction. One claim it could not verify: that the mutation sweep
was run with the command the Log states, inferred rather than observed — the
control exiting 0 and the four reproduced kills make it trustworthy regardless.

## Log

### 2026-08-23 — built on `repo-6-dangling-dependency`, base `4e3c48e`

**Reproduced first, on unfixed code**, with `docs/work/repo-99-scratch-probe.md`
carrying `depends_on: [repo-404]`, across every mode the script has. The brief's
account holds exactly: eight invocations, eight times `exit 1`, 0 bytes on
stdout, 81 bytes on stderr. `--prs`, which the brief does not enumerate, fails
the same way. Row counts before and after, so "every other ticket still renders"
is a number rather than a green run:

| mode                | clean tree | dangling, before | dangling, after        |
| ------------------- | ---------- | ---------------- | ---------------------- |
| default             | 14 rows    | 0, exit 1        | 15 rows, exit 0        |
| `--ready`           | 11 rows    | 0, exit 1        | 11 rows, exit 0        |
| `--show dl-16`      | 271 B      | 0, exit 1        | 271 B, exit 0          |
| `--show repo-99`    | n/a        | 0, exit 1        | 257 B, exit 0          |
| `--markdown`        | 14 rows    | 0, exit 1        | 15 rows, exit 0        |
| `--json`            | 61 tickets | 0, exit 1        | 62 + 1 problem, exit 1 |
| `--tool downloader` | 5 rows     | 0, exit 1        | 5 rows, exit 0         |
| `--prs`             | 1685 B     | 0, exit 1        | 1757 B, exit 0         |

`--ready`, `--show dl-16` and `--tool downloader` are **byte-identical** to the
clean tree afterwards. The default view and `--markdown` differ by three lines
each: the malformed ticket's own row, and the two counts it belongs to. Nothing
else moved.

**The exit code, decided.** `--json` keeps a non-zero exit; the interactive
views — default, `--ready`, `--show`, `--markdown`, `--tool`, `--prs` — exit 0
with the warning on stderr. This is the brief's proposal and I agree with it
after reading `.github/workflows/ci.yml:109`, which is
`node scripts/status.mjs --json > /dev/null`: stdout is discarded, so the exit
code is the entire gate, and it is the only thing in CI that reads a ticket at
all. Two further facts settle it rather than one. First, an all-markdown pull
request — which is what filing a ticket _is_ — skips the unit matrix through
`ci.yml`'s `changes` job, so that step is not merely the ticket gate, it is
frequently the only gate the change gets. Second, `ci.yml`'s own comment above
the step already claims it "fails by file and line on … a `depends_on` pointing
at nothing", and keeping `--json` non-zero is what lets that comment stay true
without editing the workflow — the workflow is unchanged in this branch, which
is the tell that the rule is the right one. The interactive half exits 0 because
a person asked a question and got the answer; `npm run status` ending non-zero
also prints an `npm ERR!` block under every table, which trains the reader to
ignore the tail of the output — the opposite of what a warning is for. Payload
and exit code are separated exactly as the brief argues: `--json` emits the
tickets it could read **and** `problems`, and still exits 1.

Checked by hand: with the scratch ticket present, `node scripts/status.mjs
--json > /dev/null` exits 1; without it, 0.

**`--json`'s shape, which is now a contract.** `{ tickets, problems }`, with
`problems` **always present, empty included** — that is what separates "the
board is clear" from "a ticket would not parse" from "the script never ran",
which one empty stdout and one exit code could not. Each problem is
`{ file, kind: "dangling-dependency", id, dependency, message }`; `message` is
the same line stderr carries, so the text lives in one place. `problems` is
**not** narrowed by `--tool`: a dangling edge anywhere is a fact about the graph
the reader is being handed a slice of, and hiding it behind a narrowing would
reintroduce the "valid on my branch" blindness that caused this.

**`describeTicket`'s shape, for [repo-3](./repo-3-show-a-closed-ticket.md).** It
now returns `{ ticket, blockers, missing }`. `blockers` is **unchanged** — the
real, non-`done` ticket objects, nothing emptied, nothing synthesised — and
`missing` is a `string[]` of ids no ticket carries. This is deliberately the
first of repo-3's two options ("leave `describeTicket` returning the true
blocker list and let `printTicket` decide"), so repo-3 is free to add a `closed`
flag beside `missing` if it prefers the second; adding a third field to an
object return breaks nobody. Its Build step 2's prohibition — _do not silently
empty `blockers`_ — is respected. What repo-3 must know: `printTicket` now
destructures `missing` and prints `repo-404 (not a ticket)` beside the real
blockers, and the `unblocked` branch is gated on **both** lists being empty, so
the closed-ticket branch repo-3 adds goes _in front of_ that condition rather
than replacing it.

**What the brief had wrong, or left open.**

- **Nothing in the reproduction was wrong.** Both traps are real and were
  measured here before the fix: with the throw neutered, `--show repo-99` dies
  with `Cannot read properties of undefined (reading 'status')` and exit 1, and
  the two readers step 3 says already cope do cope — `--ready` withheld the
  malformed ticket, and the default view printed `(waits on repo-404)` with
  every other row intact.
- **The brief enumerates six modes; there are seven.** `--prs` is missing from
  its table and fails identically. It is in the table above.
- **The `--root` question, which the brief left to the implementer, is
  answered: I added the flag.** Without it `main` hardcodes `DEFAULT_ROOT`, so
  no test can ask what the _CLI_ does with a malformed ticket, and five of the
  six acceptance lines are about the CLI. Every one of them is now proven by a
  test rather than by my terminal. It is a plain option listed in `OPTIONS`,
  not a hidden one — a flag the parser refuses to name is a flag the next
  reader finds by reading the source.
- **The test helper had to change with it.** `run()` used `execFileSync` and
  merged stderr into stdout on failure, which cannot express this defect at
  all: which stream carries the warning is half the fix. It is `spawnSync` now
  and returns `{ stdout, stderr, status }` separately. Two existing tests
  (`--tool sniffer`, `--write`/`--check`) moved their assertion from `stdout` to
  `stderr`, which is what they always meant.
- **One line outside the two files named in the brief had gone false**:
  `docs/01-TICKETS.md` listed a dangling `depends_on` among the things the
  parser "fails by file and line" on. It now says what actually happens, and
  why the strictness is not softened but paid for by `--json`. `ci.yml`'s
  comment needed no change, per the exit-code decision above. ADR 003 is left
  byte-unchanged: its `## Consequences` claim is a record of what was believed
  when it was taken, and this repo annotates those rather than rewriting them.

**`readTickets` still throws on everything else**, and that is deliberate: an
unknown field or a status outside the taxonomy means the ticket has no row to
print, so there is nothing to fall back to, whereas a dangling edge leaves a
perfectly renderable ticket. I considered filing the sibling ticket for it and
did not: unlike a dangling dependency it cannot reach `main`, because `ci.yml`'s
unfiltered `check` job runs `--json` on every push. Recorded here so the next
reader can disagree with a reason rather than a silence.

**Gates.** `npm run check` exit 0. `npx vitest run scripts` — 2 files, 66 tests,
green (the project that owns `scripts/test`, and the only one that parses the
ticket tree). Full `npm test` — 101 files, **1436 tests**, green, against a
measured baseline of 101/1416 at `4e3c48e`; the 20 new tests are all in
`scripts/test/status.test.ts`. `npm run format` run for the two `.md` files
touched.

**Mutation-checked, control first.** `npx vitest run scripts` over the
unmutated tree exits **0** — stated explicitly because a mutation report built
on a command that fails on a clean tree is worthless. Ten behaviours reverted in
turn, every one red, tree restored and the control re-run at 0 afterwards:
reader throws again (11 failed), `describeTicket` dereferences a missing id (3),
`printTicket` drops the missing ids (1), `--json` exits 0 (2), every view exits
1 (6), warning to stdout (9), `--json` drops `problems` (3), only the first edge
reported (1), a healthy repo warns anyway (11), `--json` narrows `problems` to
`--tool` (1). Separately, the new suite against `4e3c48e`'s `status.mjs`: **21
tests fail**, so they are red against the code this fixes.

### 2026-08-23 — gate 1, CONCERNS, addressed

Both findings were about documents rather than code, and both were right.

**repo-3's citations were collateral I did not think to check.** I wrote a Log
paragraph _for_ repo-3's builder and never opened repo-3's file, so all four of
its `file:line` citations and both of the code blocks it quotes as current code
were left pointing at nothing — `printTicket (:465-484)` now lands on
`EXIT_ON_PROBLEMS`'s JSDoc. Refreshed, both snippets requoted from the file as
it now reads, and a Build step 5 added recording what repo-6 changed for it.
The general lesson, which is not repo-3-specific: **a ticket that quotes code
verbatim ages against every branch that touches that file, and the branch that
moves the lines is the only one in a position to know.** The repo's convention
already says a shape-level defect goes in the sibling's Build section in the
same pull request; a stale citation is the same thing and I treated it as
somebody else's problem.

**The ADR annotation is the finding I most deserved.** My previous entry said
"this repo annotates those rather than rewriting them" as the reason for
touching nothing, which is the correct pattern and not what I did — I neither
annotated nor rewrote, and named the pattern as though naming it were the act.
`docs/adr/003` now carries an `_Outcome, 2026-08-23:_` bullet in the same style
as the two already in that section, saying that three of its four strict
failures still end the command and the fourth does not, and why. The ADR's own
claim is byte-unchanged.

**`--root` is now in one prose list of two, deliberately.** `docs/01-TICKETS.md`
lists it marked as a test seam, with a line saying the six above it are the whole
of "what is next"; `CLAUDE.md`'s `## Commands` stays at six, because it is the
short list a person reads to run the repo. The reviewer was right that "listed in
`OPTIONS`, not hidden" claims more than `OPTIONS` can carry: source and an error
string are not documentation.

Findings 4 (raw `ENOENT` on a bad `--root`) and 5 (`ci.yml`'s comment) needed no
change and are recorded above with their reasoning, so the next reader does not
re-derive them.

**On re-resolving the record before committing it.** Five of the reviewer's
twenty-five citations did not resolve against the tip — and `scripts/` is
byte-identical to the commit it read, so those five were approximate when
written rather than moved by me. Corrected in the committed section, listed
individually there, and the reviewer's file is posted unedited on the pull
request so the delta is visible. Every citation in the `## Gates` section was
checked programmatically: each span re-read and asserted to still contain the
string it is cited for, 25/25.

Gates re-run after this round: `npm run check` exit 0; `npx vitest run scripts`
2 files / 66 tests; `npm test` 101 files / 1436 tests; `npm run format` for the
four `.md` files touched. No source file changed in this round — the diff is
`docs/work/repo-3-…`, `docs/adr/003-…`, `docs/01-TICKETS.md` and this ticket.
