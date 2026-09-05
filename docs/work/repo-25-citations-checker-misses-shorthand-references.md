---
id: repo-25
tool: repo
title: The citation checker silently skips shorthand and prose references, then reports full coverage
kind: fix
status: ready
milestone: null
depends_on: [repo-18]
difficulty: standard
---

# repo-25 — a clean citation report over a ticket whose references were never read

**Files:** `scripts/citations.mjs`, `scripts/test/citations.test.ts`.

## Why

`scripts/citations.mjs` detects a citation by matching backticked `file:line`
text. Anything referring to a location in another shape is not checked — **and
is not reported as unchecked**, which is the defect. The summary line counts
what it found, so a ticket carrying five references and three citations reports
`3 citations … 2/3 resolve`, and reads as complete coverage.

### Reproduction

A scratch ticket containing five references to real locations:

```markdown
See [`release-please-config.json:31`](../../../release-please-config.json), and
the `docs` line at `:27` in the same file.

Also [`manifest/hls.ts:456`](../../resolvers/src/manifest/hls.ts) and then
line 367 of that file, and hls.ts:367 as a bare mention.
```

`node scripts/citations.mjs <file>` reports **3 citations**, of which one fails
as ambiguous. Silently skipped:

| Reference               | Why it is missed                         |
| ----------------------- | ---------------------------------------- |
| `` `:27` ``             | shorthand — no filename in the backticks |
| `line 367 of that file` | prose, not backticked                    |

Both name real lines. Both could be wrong without any signal. Nothing in the
output says two references went unread; the count is of what was _detected_, and
a reader has no way to tell that from what was _written_.

**Two sessions hit this independently on 2026-09-05**, on the same shape — a
fully-qualified reference followed later in the same sentence by a bare `:NN`
shorthand, which is a natural way to write and exactly what is invisible.

### It is not what repo-18 fixes

[repo-18](./repo-18-citations-resolve-is-not-correct.md) (PR #146, gated) makes
the tool verify that a citation _says what it claims_ rather than merely
resolving. That is the other half: it improves the verdict on citations the tool
already sees. A reference it never detects gets no verdict either way, and gains
nothing from anchor-text checking. `depends_on: [repo-18]` because that PR
rewrites this file and is merge-ready — build on it rather than against it.

## The open decision

**What should count as a citation, and what should an unrecognised reference
do?** The second question matters more than the first: silence is the bug, and
any of these fixes it.

- **A. Detect shorthand, resolve it against the nearest preceding qualified
  citation (recommended).** Matches how people actually write, and the file is
  unambiguous from context. Costs a notion of "current file" while scanning, and
  needs a rule for a shorthand with nothing before it — which should be an error,
  not a skip.
- **B. Report unrecognised references instead of resolving them.** Flag anything
  that looks like a location but was not detected — a bare `:NN`, a
  `line NNN` phrase — as `unchecked` rather than resolving it. Cheaper and
  strictly honest; leaves the writer to qualify it by hand. Weaker, but it makes
  the gap visible, which is the whole complaint.
- **C. Also read markdown link targets.** Would catch `[`:27`](../file.json)`.
  Does not help the prose case, and link targets are relative paths that need
  resolving against the ticket's own location — more machinery than A for less
  coverage.

**A and B are not exclusive**, and doing both is probably right: resolve what can
be resolved, report what cannot. The tool already ends its output by naming two
things it cannot judge, so it has a place to say so.

## The carve-out is prose, and something is about to automate around it

**A ticket whose citations must not resolve is not an edge case — three exist
already.** This one (its reproduction sample and its own evidence), and
`repo-21`, which states the same thing about itself: _"both failures are
deliberate … repointing either would destroy the evidence it exists to carry —
the carve-out `citations.mjs` names and cannot check. Do not 'fix' them."_

That carve-out exists in exactly two places, and **a machine can read neither**:
a sentence in the tool's own output footer, and a "do not fix these" warning in
each ticket's prose.

Two things now converge on it:

- **repo-18 (#146) ships `--require-anchors`**, which folds `unanchored` into the
  failure count (`summarize`, `scripts/citations.mjs`), so it exits non-zero on
  citations that today only warn. It widens what counts as a failure.
- **repo-21 proposes running `citations.mjs --require-anchors` in
  `.github/workflows/ci.yml`** over `SKILL.md`. That would be the first thing to
  run this checker automatically — at which point "this ticket must fail" stops
  being a note to a human and becomes a red build.

Not listed in `depends_on`: neither is a prerequisite for fixing the
under-reporting, and `repo-21` does not exist on this branch, where a dangling
id would make `scripts/status.mjs --json` exit non-zero — which _is_ the CI
board gate.

**So whatever lands here should give the carve-out a form a CI job can read** — a
frontmatter field, or a marker on the citation itself — rather than adding a
third prose warning. The three failure classes are not alike and should not
collapse into one exit code: a citation that cannot be resolved, one that
resolves to the wrong content, and one that is _deliberately_ unresolvable
because it is the evidence.

## Build

1. Land on top of #146 rather than beside it — both change `scripts/citations.mjs`.
2. Take the decision above.
3. `scripts/test/citations.test.ts` is the existing suite; extend it. The
   reproduction above is the fixture — a shorthand after a qualified reference,
   a prose reference, and a bare basename that is ambiguous, in one file.
4. **Do not make a bare basename resolve by guessing.** `index.ts:440` matching
   ten tracked files must keep failing; ambiguity is a real answer and the
   current behaviour there is correct.

## Done when

- A ticket containing a shorthand reference either resolves it or reports it as
  unchecked, and in neither case is it silently absent from the count.
- A test proves the reproduction above accounts for every reference in it.
- A prose reference does not cause a false failure on ordinary ticket text —
  worth checking against the existing `docs/work/` corpus, which is full of
  sentences containing numbers.
- A ticket that declares its citations deliberately unresolvable is
  distinguishable from a broken one **by exit code**, not only by prose — so
  that anything wiring this into CI can tell them apart.
- `npm run check` and `npm test` pass.

## Log

- **2026-09-05 — filed.** Found while path-qualifying six ambiguous citations
  across dl-40..dl-43 on PR #151, and independently hit the same day by the
  session working on #147, which was the tell that it is a shape rather than a
  slip. The measurement in the reproduction was taken before filing: five
  references written, three detected, and a summary line that distinguishes
  neither. The related trap for anyone fixing a list of ambiguous citations is
  that the obvious qualification is not always enough — `api/src/config.ts` and
  `api/src/db/schema.ts` each still match both `downloader` and `planner`.
- **This ticket fails its own checker on purpose, twice.** `node
scripts/citations.mjs` on this file reports `2/4 resolve`: `hls.ts:367` inside
  the reproduction block, and `index.ts:440` in the Build section, are both
  deliberately unqualified — they are the evidence, and qualifying them would
  destroy it. That is the second case the tool's own footer names ("a citation
  that is a finding's own evidence must stay as written"). Nothing in CI runs
  this checker, so the non-zero exit is advisory. Do not "fix" those two.
