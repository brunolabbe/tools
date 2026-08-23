---
id: repo-6
tool: repo
title: Warn beside the table when a depends_on dangles, instead of exiting with no output
kind: fix
status: ready
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

## Log

_Not started._
