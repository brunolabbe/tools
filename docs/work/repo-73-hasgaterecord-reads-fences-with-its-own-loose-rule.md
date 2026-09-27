---
id: repo-73
tool: repo
title: status.mjs's hasGateRecord reads fences with its own loose rule
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# repo-73 — `status.mjs`'s `hasGateRecord` reads fences with its own loose rule

## Why

Found by repo-63's gate (Opus), verbatim:

> `scripts/status.mjs:326 "function hasGateRecord(text)"` keeps a fence reader
> of its own — any line that starts with three backticks or three tildes flips
> it, with no info-string, character or length rule — so it carries the shape
> this ticket fixed, and more. Measured with `node scripts/status.mjs --json`,
> `reviewed` for repo-60 is true at the base and false at the head, because the
> workaround this branch removes was what kept that line from flipping it.
> Nothing changes today: `reviewedButReady` reads only `ready` tickets and
> repo-60 is `done`. It also reads this ticket wrong, pre-existing at the base:
> with this section spliced above `## Log` and `status` left `ready`,
> `status.mjs` reports `reviewed` false for repo-63 and exits 0 with an empty
> problems list, because the brief quotes a four-backtick line inside a
> five-backtick fence. So the reviewed-but-ready check cannot catch this ticket
> landing without its `status` flipped.
>
> A mismatched fence toggle can also run the other way: it can expose a quoted
> `## Review` inside a real fence and turn CI red for an unrelated ready
> ticket. I worked that out from the code and did not measure it.

**Reproduced** at `1a8321c` (`origin/main`), running `main`'s `status.mjs`
with `--root` over two extracted ticket trees:

```
$ node scripts/status.mjs --root <main's tickets> --json            # exit 0
repo-60 done reviewed=true
repo-63 ready reviewed=false
$ node scripts/status.mjs --root <repo-63 head 1b148a2's tickets> --json   # exit 0
repo-60 done reviewed=false
repo-63 done reviewed=false
```

At repo-63's head both tickets carry a `## Review` section and both read as
ungated: repo-60's Build line 76 now opens with a four-backtick inline span, and
repo-63's Why quotes that line inside a five-backtick fence, which the loose
rule toggles three times and ends inside.

**The unmeasured direction, measured.** A `~~~` line inside a backtick fence
closes it under the loose rule and exposes the quoted `## Review` below it:
`reviewedButReady` reports a ticket that has no gate record. That is the red
pipeline the gate predicted — see the red run in the Log.

## Build

1. Make `hasGateRecord` read sections with `extractSections` from
   `scripts/citations.mjs` — a level-2 heading whose title starts with the word
   `Review` — rather than keep a fence reader of its own. `review-record.mjs`
   already imports it the same way.
2. Check the docblock's documented trade before sharing the rule: an unclosed
   fence swallowing the rest of the file is deliberate, and must survive.
3. Keep `scripts/status.mjs`' line count neutral from the first cited line down:
   merged records cite it, and #302 (repo-72) edits `readTickets` just above.
4. Tests must hold with and without repo-63's `extractSections` fix merged.
5. **Folded in on 2026-09-27:** `scripts/preflight.mjs`' check 3,
   `checkReview`, is a third reader of `## Review` with a rule of its own —
   `/^## Review\b/mu` over the whole file, no fences at all. Export
   `hasGateRecord` and call it there, keeping every cited line of
   `preflight.mjs` and `scripts/test/preflight.test.ts` in place (#303 edits
   the test file, and its record cites `:838`).

## Done when

- A five-backtick fence quoting a four-backtick line does not hide a `## Review`
  below it, and `reviewedButReady` reports that ticket when `ready`.
- A `~~~` line inside a backtick fence does not expose a quoted `## Review`.
- The unclosed-fence test in `status.test.ts` still passes unchanged.
- `reviewed` is unchanged for every ticket on `main` (0 of 205 differ).
- Preflight's review check does not count a `## Review` quoted in a fence, and
  reads a real one the way `status.mjs` does.
- `npm run check`, the `repo` project's suite and
  `node scripts/citations-gate.mjs --against origin/main` pass.

## Log

- 2026-09-27 — Built, in one pull request with repo-74, repo-75 and repo-76,
  on the owner's direction to file and fix this batch's gate findings together.

  **The documented trade is not reversed.** `hasGateRecord`'s docblock accepts
  that an unclosed fence swallows the rest of the file. `extractSections` does
  the same — an opened fence with no closer never resets — so that test
  (`status.test.ts`, "an unclosed fence hides a real gate record below it")
  passes unchanged. What changes is only which lines count as fences:
  CommonMark's character, length and indentation rule instead of "any line
  starting with three of either". The asymmetry the check rests on (a false
  negative is a stale row, a false positive is a red pipeline) is served
  better, not worse: the loose rule produced false positives too.

  Red, before the fix — new suite `scripts/test/status-gate-record.test.ts`,
  run as `npx vitest run scripts/test/status-gate-record.test.ts`:
  `Tests 4 failed | 6 passed (10)`. The four: a shorter backtick fence inside
  a longer one (`expected false to be true`); `~~~` inside a backtick fence
  (`expected true to be false`, the gate's unmeasured direction, now
  measured); a shorter tilde fence inside a longer one; and a fence indented
  three spaces. Green after:
  `npx vitest run scripts/test/status-gate-record.test.ts scripts/test/status.test.ts`
  → `137 passed (137)`.

  With and without repo-63: the same two suites against `origin/repo-63-backtick-info-string`'s
  `citations.mjs` swapped in → `137 passed (137)`. No shape in the new suite
  starts with a backtick run followed by another backtick, so neither version of
  `extractSections` decides a case differently.

  Every ticket, old rule against new, compared by a scratch script over
  `status.mjs --json`: on `main`'s tickets
  `differ: 0 of 205; reviewed old=124 new=124; problems old=0 new=0`. On repo-63's head (`1b148a2`) with this fix
  and `main`'s `extractSections`: repo-63 `false -> true`, repo-60 still false.
  On the merge of this branch with repo-63's head: repo-60 and repo-63 both
  `false -> true`, `problems` 0. So repo-60 is read right only once both land.

  `git merge-tree --write-tree HEAD origin/repo-63-backtick-info-string` → one
  tree oid, exit 0: clean.

  **Why a new test file.** `status.test.ts`'s end is claimed by #302, whose own
  record cites the tests it appends there. Appending too would conflict, and
  inserting above them would move those citations after the merge.

  **Line neutrality.** The import costs a line at the top, so the file's first
  docblock paragraph lost one; `hasGateRecord`'s six body lines became a
  five-line comment and the `return`. Only `main`'s lines 19–27 move (up one);
  from 28 to the end every line keeps its number, and lines 327–332 are the only
  ones whose text changes. A first cut put the comment in the docblock instead,
  which moved `function hasGateRecord(text)` from 326 to 331 — and repo-63's own
  gate record, on its unmerged branch, cites
  `scripts/status.mjs:326 "function hasGateRecord(text)"`. A scratch merge of
  this branch with `origin/repo-63-backtick-info-string` and
  `origin/repo-72-status-names-duplicate-id` caught it: the citations gate
  failed that record `moved … it is at 331`.

  **Could have folded, did not (superseded by the next entry):** `scripts/preflight.mjs`' `checkReview` is a
  third reader, `/^## Review\b/mu` over the whole file with no fence handling
  at all, so a `done` ticket quoting `## Review` in a fence passes it. Sharing
  `extractSections` there too would be a line. Not done: it is a different
  check with the opposite failure direction (a false pass, not a false alarm),
  and nothing specified it — reported to the orchestrator instead.

- 2026-09-27 — **`checkReview` folded in**, on the orchestrator's direction:
  it is this ticket's defect in a third place, a reader of `## Review` with a
  fence rule of its own (here, none), and one of this batch's gates had already
  named the missing check — that a gate does not check its section is seen by
  _every_ reader of `## Review`. The owner's "perform the work now" covered it.
  Built as Build step 5: `hasGateRecord` is exported and `checkReview` calls
  it, so all three readers now share `extractSections`.

  Red, with `checkReview`'s old line put back by hand:
  `npx vitest run scripts/test/status-gate-record.test.ts -t "preflight"` gave
  `1 failed | 1 passed`, failing "preflight's review check does not count a

  ## Review quoted in a fence" (it passed as gated). Green after, with the

  status, preflight and spawn-safety suites: `193 passed (193)`.

  **Lines**: in `preflight.mjs` the import took the blank line between the
  `node:` imports and the local ones, so only `main`'s lines 58–65, all
  imports, move (up one); from 66 every line keeps its number, and the
  `checkReview` line and its docblock line change in place.
  `export` went in front of `function hasGateRecord(text)` at `status.mjs:326`,
  in place — repo-63's record anchors on `function hasGateRecord(text)`, still a
  fragment of the line. `scripts/test/preflight.test.ts` is untouched.
