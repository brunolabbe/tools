---
id: repo-72
tool: repo
title: status.mjs detects a duplicate ticket id but cannot name it
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-72 — status.mjs detects a duplicate ticket id but cannot name it

## Why

`scripts/status.mjs`'s `readTickets` correctly detects a duplicate id — `byId.size !== tickets.length` is true whenever two tickets share one — but the
line that is supposed to say _which_ ticket and _which_ id always reports
`undefined` for both:

```js
const seen = new Set();
const duplicate = tickets.find((ticket) => !seen.add(ticket.id));
throw new Error(`${duplicate?.file}: "${duplicate?.id}" is used by more than one ticket`);
```

`Set.prototype.add` returns the `Set` itself, which is always truthy, so
`!seen.add(ticket.id)` is always `false` and `.find()` never matches —
`duplicate` is always `undefined`.

**Evidence.** #300's CI `check` job failed on `node scripts/status.mjs --json`
at `540192d` merged with `origin/main` with exactly this message, from a real
collision (this branch's `repo-66` against `main`'s own `repo-66`, from #301):

```
undefined: "undefined" is used by more than one ticket
```

That is CI run 36340116984, on the merge reproduction the coordinator ran
(the branch alone and `main` alone each exit 0; only the merge of the two
carries both tickets and exits 1).

**Reproduced independently**, with a disposable two-file fixture sharing one
id, using `--root` so nothing under the real `docs/work/` is touched:

```
$ node scripts/status.mjs --root <fixture> --json
undefined: "undefined" is used by more than one ticket
```

exit 1, same message, same defect — confirming the bug is not specific to
the `repo-66` collision, only exercised by it.

## Build

Not built here, on the coordinator's instruction: this ticket carries the
reproduction, not the fix. Whoever builds it should replace the broken
`.find()` with something that actually names the second ticket to claim an
id already seen — for example, tracking a `Map<string, ticket>` of ids seen
so far and finding the first ticket whose id is already in it, rather than
relying on `Set.prototype.add`'s return value.

## Done when

- `readTickets` (or whatever replaces this check) throws an error naming a
  real file and a real id, not `undefined` for either, when two tickets
  share one.
- A test locks it: two fixture tickets sharing an id, asserting the error
  message names one of the two real files and the real id.
- `npm run check` and the `repo` project's suite pass.

## Review

**Gate: PASS** — 2026-09-27 · `origin/main...HEAD` (base `1a8321c`, head `5f24f5b`) · code-review at medium

| Done when                                                                                                                       | Proof                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readTickets` throws an error naming a real file and a real id, not `undefined` for either, when two tickets share one          | `scripts/test/status.test.ts:1675` "a duplicate id is named, with both of" ✓ — reproduced red against base's `status.mjs` (2 failed, 127 passed) and green at head (129 passed)                     |
| A test locks it: two fixture tickets sharing an id, asserting the error message names one of the two real files and the real id | `scripts/test/status.test.ts:1675` "a duplicate id is named, with both of" and `:1685` "the command reports the duplicate by name" ✓ — names **both** files, going past the line's "one of the two" |
| `npm run check` and the `repo` project's suite pass                                                                             | verified — `npm run check` exit 0; `npx vitest run --project repo` → 506 passed (10 files)                                                                                                          |

- **findings** · code-review at medium returned 0; 0 carried, 0 dropped.
- NFR: security n/a · performance n/a (same O(n) walk, one `Map` instead of one `Map` plus one `Set`) · reliability ✓ (the fix's own subject) · maintainability ✓ — `duplicateIdMessage` is documented at its call site and at its definition, and the Log gives the reason it sits at the end of the file rather than beside `readTickets`.

## Log

- 2026-09-27 — Filed on the coordinator's instruction, from the #300 CI
  incident (run 36340116984) that exposed it: a real `repo-66` id collision
  between this branch and `main`'s #301. Reproduced independently with a
  disposable `--root` fixture, above. Not fixed here, per instruction.
- 2026-09-27 — Built. `readTickets` now walks the tickets with a
  `Map` of ids already seen and throws on the first ticket whose id is in it,
  naming **both** files: the one that reached the id second leads the line,
  as every other `readTickets` error leads with its file, and the one it
  collides with follows in parentheses. The check:
  `scripts/status.mjs:299` "if (first) throw new Error(duplicateIdMessage"; the
  message: `:1135` "is used by more than one ticket (also ${first.file})". Both, rather than
  the one the brief asked for, because the remedy for a collision is to
  renumber one of the two and the reader has to know which two to choose
  between. The message keeps its old text up to the parenthesis, so anything
  matching `is used by more than one ticket` still matches; nothing else in
  the output, `--json` included, and nothing about `reviewedButReady`, changed.

  **The message lives at the end of the file on purpose.** The first draft
  wrote the check with its comment in place, ten lines longer than the code
  it replaced, and preflight's citations check failed three merged records
  whose `scripts/status.mjs` citations sit below it: `repo-12` (2 moved),
  `repo-19` (3 moved) and `pl-26` (6 moved). Repointing `pl-26` is not open
  to a `fix(repo)` branch — it is a path under `tools/planner/`, and
  release-please would release the planner for it. So the check in
  `readTickets` is exactly as many lines as the one it replaced, and the
  message and its reason moved to `duplicateIdMessage`, after every line any
  record cites (the highest is `printTicket`, a thousand lines in).

  Red, then green, on the same two tests, appended at the end of the suite.
  The unit, two `pl-2` files in one directory:
  `scripts/test/status.test.ts:1675` "a duplicate id is named, with both of".
  The CLI with `--json` over two `repo-66` files, asserting exit 1, empty
  stdout and no `undefined` on stderr:
  `:1685` "the command reports the duplicate by name and exits non-zero".
  With `scripts/status.mjs`
  checked out from `origin/main`,
  `npx vitest run scripts/test/status.test.ts`: `Tests  2 failed | 127 passed (129)`,
  `Received: "undefined: "undefined" is used by more than one ticket"`. With
  the fix: `Tests  129 passed (129)`.

  The brief's own `--root` reproduction, re-run on the fix over a scratch
  fixture of two `repo-66` tickets:

  ```
  $ node scripts/status.mjs --root <fixture> --json
  docs/work/repo-66-theirs.md: "repo-66" is used by more than one ticket (also docs/work/repo-66-mine.md)
  exit=1
  ```

  **What the brief had wrong, or left out.** Its evidence dates the defect to
  #300's CI run, but it had been seen and deliberately left before: `repo-36`'s
  Log ("Observed but deliberately not fixed here … worth its own ticket") and
  the orchestrate-tickets history page both record it from the `repo-33` →
  `repo-36` renumber, where the clashing id "had to be recovered by hand". So
  this is the second time a real collision paid for it, not the first. Those
  two records are left as written; they are history of what was seen then.

  **Fold-in considered, not taken.** The only adjacent work either record
  names is the window in which two sessions can take the same id before
  either publishes it; that needs a decision about how ids are reserved, not
  a line here, so it is not free and is not folded in.
