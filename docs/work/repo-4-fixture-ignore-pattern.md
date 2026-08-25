---
id: repo-4
tool: repo
title: Anchor the fixture ignore pattern, which today matches nothing and formats every fixture
kind: fix
status: done
milestone: null
depends_on: []
---

# repo-4 — `.oxfmtrc.json` exempts `test/fixtures/` and the pattern matches nothing

**Packages:** `.oxfmtrc.json`, and every `test/fixtures/` directory it was meant
to cover

## Why

Found on the `pl-28-valhalla-adapter` branch, while checking whether the Valhalla
`/sources_to_targets` capture at
`tools/planner/api/test/fixtures/valhalla-sources-to-targets.json` had been
altered by `npm run format`. It had been: the file is committed in oxfmt's
shape. Its values were confirmed intact, so that capture is fine — the defect is
the ignore pattern, and it is older and wider than one branch.

The root `CLAUDE.md` rule is that fixtures are real captured payloads, checked
in and parsed offline:

> Fixtures, not live network calls — real services change, rate-limit and
> geo-vary, which makes CI failures meaningless. Check in real payloads under
> `test/fixtures/` and parse them offline.

`.oxfmtrc.json` carries what looks like the guard for that:

```json
{
  "ignorePatterns": [
    ".claude/",
    "dist/",
    "node_modules/",
    "storage/",
    "coverage/",
    "test/fixtures/",
    "**/CHANGELOG.md"
  ]
}
```

**`test/fixtures/` matches nothing.** These are gitignore-shaped patterns: one
with no internal slash matches at any depth, one with a slash in it is anchored
to the config's directory. There is no `test/fixtures/` directory at the repo
root, so the entry is inert, and every fixture in the repo is formatted like
source.

Reproduced on `origin/main` at `0c67b8e`, with the pinned oxfmt (0.62.0). A real
fixture is **matched**, not skipped — note "on 1 files":

```
$ npx oxfmt --check tools/planner/contract/test/fixtures/road-trip.json
Checking formatting...

All matched files use the correct format.
Finished in 87ms on 1 files using 12 threads.   # exit 0
```

Contrast a file the config really does exempt, which oxfmt reports quite
differently:

```
$ npx oxfmt --check tools/downloader/CHANGELOG.md
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                # exit 2
```

And it will rewrite a fixture, not merely read it. A deliberately mis-indented
probe dropped into a fixture directory:

```
$ npx oxfmt --check tools/planner/contract/test/fixtures/_probe.json
Checking formatting...

tools/planner/contract/test/fixtures/_probe.json (0ms)

Format issues found in above 1 files. Run without `--check` to fix.
                                                # exit 1
```

So `npm run check` currently fails on an unformatted fixture and `npm run
format` currently rewrites one, which is the opposite of both intentions.

**The trap is that the neighbouring entries do work**, which is why nobody
noticed. A probe file at `tools/planner/contract/probe-dist/dist/x.json` — five
directories deep, deliberately mis-indented — is skipped with the
`excluded by ignore rules` message and exit 2, because `dist/` has no internal
slash and therefore matches at every level. Reading `dist/`, `coverage/` and
`storage/` and generalising to `test/fixtures/` is the natural mistake, and the
list gives no sign it was made.

**The obvious fix does work.** Verified by copying `.oxfmtrc.json`, replacing
that one entry with `**/test/fixtures/`, and pointing oxfmt at it with
`--config` — the copy at the repo root, so the anchoring base is unchanged:

```
$ npx oxfmt --config oxfmtrc-probe.json --check tools/planner/contract/test/fixtures/_probe.json
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                # exit 2
```

### What is actually being formatted today

**20 files**, across the three `test/fixtures/` directories the repo has:

```
$ npx oxfmt --check 'tools/**/test/fixtures/**'
…
Finished in 365ms on 20 files using 12 threads.
```

They are 10 `.html`, 9 `.json` and 1 `.mjs`. The other 33 files in those
directories — the `.m3u8` manifests, the `.mpd`, the `.m4s` and `.mp4`
segments, the `.png`, the `.txt` — oxfmt does not claim, so they were never at
risk and this ticket does not touch them. A 21st file joins the list on the
`pl-28-valhalla-adapter` branch:
`tools/planner/api/test/fixtures/valhalla-sources-to-targets.json`.

### How bad it is, precisely

**For JSON, it is indentation and nothing else, and the evidence survives.** A
probe carrying the shapes that would worry you comes back byte-identical except
for whitespace and array layout:

in — the probe as written, deliberately mis-indented:

```
{
    "distance": 0.0,
    "time": 200,
    "big": 12345678901234567890,
    "exp": 1e3,
    "s": "caf\u00e9",
    "arr": [1,
2]
}
```

out — after `npx oxfmt <path>`:

```
{
  "distance": 0.0,
  "time": 200,
  "big": 12345678901234567890,
  "exp": 1e3,
  "s": "caf\u00e9",
  "arr": [1, 2]
}
```

`0.0` is not collapsed to `0`, the integer past 2^53 is not reparsed, `1e3` is
not expanded, the escape is not decoded. Only the indentation and the array's
line breaks moved. The Valhalla capture that led here was checked the same way
and its values are intact.

**For HTML it is already more than indentation.** The same experiment, on a
fragment with a wrapped text node and an inline script (fenced as plain text on
purpose — oxfmt formats fenced HTML inside markdown too, and rewrote this
example the first time it was written as `html`):

```
in:   <p>one
      two   three</p><script>var x=1</script>

out:  <p>one two three</p>
      <script>
        var x = 1;
      </script>
```

The text node is reflowed and the inline script is rewritten — a semicolon it
did not have has been inserted. Ten of the twenty files are the downloader's
page fixtures under `tools/downloader/resolvers/test/fixtures/pages/`, which are
served to a real browser by the resolvers' fixture server and are the input the
sniffer is tested against. A formatter that reflows text nodes and rewrites
inline `<script>` is editing the thing under test.

So the honest statement of the problem is not "the fixtures are corrupt" — they
are not, and this ticket should not be written as though they were. It is that
**the guard written to keep a formatter away from captured evidence is not
running**, has never run, and the only thing standing between a rewritten
payload and a green suite is that JSON's formatting happens to be lossless. The
next fixture format checked in gets no such luck by design, only by accident.

## Build

1. **`.oxfmtrc.json`** — change `test/fixtures/` to `**/test/fixtures/`. That is
   the whole fix. Do not "helpfully" broaden it to `**/fixtures/`: that would
   also swallow `tools/downloader/e2e/fixtures/hls-origin.ts` and
   `tools/planner/web/test/fixtures.ts`, which are TypeScript the repo does want
   formatted.
2. **Prove the pattern before and after**, in the Log, with the two messages
   this ticket quotes — `on N files` versus `excluded by ignore rules`. They are
   how oxfmt distinguishes "checked and clean" from "not checked", and they are
   easy to confuse, because both look like success.
3. **Re-check the 20 files for damage already done**, and record the answer
   either way. `git log --follow` each fixture and look for a commit that
   reformatted it without changing a value; the `.html` ones are where to look
   first, for the reason above. If something was reflowed, restore it from the
   capture rather than by hand, and if nothing was, say so — a later reader
   should not have to redo this.
4. **Say the rule where it is enforced.** Root `CLAUDE.md`'s fixture rule states
   the intent; it does not mention the formatter. Add a clause there, or a
   comment in the config, tying the two together — an inert entry in an ignore
   list is invisible, and this one has been inert since `5ab843f`, the Phase 0
   commit that created the file on 2026-08-05. It is in the repo's first
   `.oxfmtrc.json`, unchanged.
5. Consider whether anything should fail when a pattern matches nothing. oxfmt
   has no such flag, so this is a note rather than a step: if there is a cheap
   check, file it; if there is not, do not invent one for this ticket.

## Done when

- `.oxfmtrc.json` names `**/test/fixtures/`, and no other entry changed.
- `npx oxfmt --check tools/planner/contract/test/fixtures/road-trip.json` prints
  `excluded by ignore rules` instead of `on 1 files`.
- `npx oxfmt --check 'tools/**/test/fixtures/**'` reports that every matched
  file was excluded, rather than a file count.
- A mis-indented probe under any `test/fixtures/` directory passes
  `npm run check`, and `npm run format` leaves it alone. Delete the probe.
- Step 3's answer is in the Log: either the commit that reformatted a fixture,
  named, or the statement that none did.
- `npm run check` and `npm test` are green.

## Log

**2026-08-25 — anchored the pattern, and audited what the inert one had done.**

Branch `repo-4-fixture-ignore-pattern`. One line of config, plus the two places
that now say why. `.oxfmtrc.json` names `**/test/fixtures/`; no other entry moved.

### The brief was right about the bug and wrong about three details

- **`5ab843f` checks out exactly.** `git log --follow --oneline .oxfmtrc.json`
  returns three commits — `5ab843f` (2026-08-05, Phase 0), `786d686` (2026-08-05,
  adds `.claude/`), `2f97370` (2026-08-14, adds `**/CHANGELOG.md`, dl-10). The
  file at `5ab843f` is `{"ignorePatterns": ["dist/", "node_modules/", "storage/",
"coverage/", "test/fixtures/"]}`, so the entry is in the repo's first
  `.oxfmtrc.json` and its text never changed. Inert for 20 days, as claimed.
  Worth noting that `2f97370` added `**/CHANGELOG.md` **with** the `**/` prefix,
  directly below a sibling that needed it and did not have it.
- **It is 21 files on `main` now, not 20.** The 21st the brief predicted —
  `tools/planner/api/test/fixtures/valhalla-sources-to-targets.json` — merged in
  `60e48e7` (pl-28, 2026-08-23). 10 `.html`, 10 `.json`, 1 `.mjs`.
- **There are four `test/fixtures/` directories, not three.** The brief missed
  `tools/downloader/engine/test/fixtures/`, which holds one `ffmpeg-progress.txt`
  — a file oxfmt does not claim, which is why the count never noticed the
  directory. It is covered now like the others.
- **The anti-instruction is right, but only one of its two examples is.**
  Measured below: broadening to `**/fixtures/` does swallow
  `tools/downloader/e2e/fixtures/hls-origin.ts`, so the instruction stands. It
  does **not** swallow `tools/planner/web/test/fixtures.ts` — that is a _file_
  named `fixtures.ts`, and a pattern with a trailing slash matches directories
  only. The conclusion survives on one leg, not two.

### Step 2 — the pattern, before and after

Both messages, both states, `oxfmt 0.62.0`. The control line is the same
`CHANGELOG.md` the brief used, and it does not move.

Before, on unmodified config:

```
$ npx oxfmt --check tools/planner/contract/test/fixtures/road-trip.json
Checking formatting...

All matched files use the correct format.
Finished in 250ms on 1 files using 16 threads.        # exit 0   ← MATCHED

$ npx oxfmt --check tools/downloader/CHANGELOG.md
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                      # exit 2   ← control

$ npx oxfmt --check 'tools/**/test/fixtures/**'
Checking formatting...

All matched files use the correct format.
Finished in 958ms on 21 files using 16 threads.       # exit 0   ← 21 matched
```

After, same three commands:

```
$ npx oxfmt --check tools/planner/contract/test/fixtures/road-trip.json
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                      # exit 2   ← EXCLUDED

$ npx oxfmt --check tools/downloader/CHANGELOG.md
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                      # exit 2   ← control, unmoved

$ npx oxfmt --check 'tools/**/test/fixtures/**'
Checking formatting...

Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                      # exit 2   ← no file count
```

**How many files changed hands: 21, and nothing went the other way.** Counted by
classifying all 54 files under a `test/fixtures/` directory one at a time, on
each config, and diffing the two lists:

```
before CLAIMED: 21   after CLAIMED: 0
before SKIPPED: 33   after SKIPPED: 54
newly excluded (CLAIMED before, SKIPPED after): 21
went the other way (SKIPPED before, CLAIMED after): (none)
```

Cross-checked repo-wide, both configs run with an identical file set present:
`494 files` under the old pattern versus `472` under the new — a delta of 22,
being the 21 fixtures plus the probe described below. The per-file count and the
repo-wide count agree.

### Step 1 — why `**/test/fixtures/` and not `**/fixtures/`, measured

Five `fixtures` directories exist (`find . -type d -name fixtures`, node_modules
pruned): the four `test/fixtures/` ones and `tools/downloader/e2e/fixtures/`.
There is no sixth the brief missed. Both candidate patterns were put in a config
at the repo root — so the anchoring base is unchanged — and pointed at every
`fixtures`-named path in the repo:

```
======== "**/test/fixtures/"                    ======== "**/fixtures/"
  EXCLUDED  …/contract/test/fixtures/road-trip.json   EXCLUDED  …/contract/test/fixtures/road-trip.json
  CLAIMED   …/planner/contract/test/fixtures.ts       CLAIMED   …/planner/contract/test/fixtures.ts
  CLAIMED   …/downloader/e2e/fixtures/hls-origin.ts   EXCLUDED  …/downloader/e2e/fixtures/hls-origin.ts   ← the loss
  CLAIMED   …/planner/web/test/fixtures.ts            CLAIMED   …/planner/web/test/fixtures.ts            ← brief wrong
  CLAIMED   …/downloader/web/test/fixtures.ts         CLAIMED   …/downloader/web/test/fixtures.ts
  CLAIMED   …/planner/web/test/plan-fixtures.ts       CLAIMED   …/planner/web/test/plan-fixtures.ts
  CLAIMED   …/planner/api/src/grounding/fixtures.ts   CLAIMED   …/planner/api/src/grounding/fixtures.ts
```

The row that mattered most to check is `tools/planner/contract/test/fixtures.ts`
— a TypeScript file sitting immediately beside the `test/fixtures/` directory,
at exactly the path a careless pattern would collide with. It stays `CLAIMED`
under the shipped pattern. The trailing slash is what makes the entry
directory-only, and that is now stated in both places the entry is documented.

### Step 3 — was any fixture already damaged? No commit reformatted one.

`git log --follow` over all 21 files, rename-aware: `--follow --format=%H
--name-only` gives the path the file had _at_ each commit, and consecutive blobs
were compared at their own paths, so the 2026-08-14 monorepo reshape (a pure
rename) does not break the chain. Each transition was classified by comparing raw
bytes and whitespace-stripped bytes.

**Zero whitespace-only transitions across all 21 files.** Every transition is
either `IDENTICAL bytes (move only)` or a genuine authored edit:

- **All 10 `.html` page fixtures** — the category that actually matters, since
  oxfmt reflows text nodes and rewrites inline `<script>` — have **never been
  edited**. Created at `725740c` (2026-08-05), moved untouched at `d1ec2c6`, and
  byte-identical to their original blobs today. Verified directly, not inferred:
  `git show 725740c:packages/resolvers/test/fixtures/pages/<f> | cmp -s - <f>`
  returns identical for all ten. The three resolver `.json`/`.mjs` fixtures are
  identical to their creating commits too.
- The three `content changed` edits are all real: `1ac6de6` (pl-15) migrated
  `place` → `location`/`kind` across six planner candidate sets — a contract
  change, visible as such in the diff; `50701dc` (pl-14) edited `road-trip.json`;
  `7b3b0f4` (dl-12) added an `echo-args` case to `fake-ytdlp.mjs`.

**The honest limit on that answer, which matters here.** Git can only show a
reformat that landed in its _own_ commit. It cannot see a `npm run format` run
_before_ a commit, where the reformat is inseparable from the edit in the diff —
and that is demonstrably what happened at least twice, because two ticket logs
say so contemporaneously. `pl-15-candidate-legs.md` records "the compact style in
the candidate sets is oxfmt's own output, not authored", and
`pl-28-valhalla-adapter.md` records "`oxfmt` indents the fixture … Every key,
value and numeric literal survived, `0.0` and `null` included; only whitespace
moved." So the formatter did reach fixtures — inside authoring commits, on JSON
only, and both authors checked the values at the time and found them intact.

So: **no fixture in this repo has lost information, and no commit exists that
reformatted one without changing a value.** The `.html` fixtures, where a
reformat would have been destructive rather than cosmetic, were never touched at
all. The guard is now running before that luck ran out.

Two independent rediscoveries of this bug (pl-15 on 2026-08-16, pl-28 on
2026-08-23) both deferred it to a `repo-` ticket. Both of their logs now carry
advice that this ticket falsified — filed as **repo-11**, and see below for why
it could not ride here.

### Prove it — the probe, run against both patterns

A deliberately mis-indented `repo4-probe.json` under
`tools/planner/contract/test/fixtures/`, sha `b47ad19e…`:

```
$ npx oxfmt --config <old pattern> --check …/test/fixtures/repo4-probe.json
tools/planner/contract/test/fixtures/repo4-probe.json (0ms)
Format issues found in above 1 files. Run without `--check` to fix.
Finished in 296ms on 1 files using 16 threads.        # exit 1   ← the negative case, watched failing

$ npx oxfmt --config <old pattern> …/test/fixtures/repo4-probe.json   # write mode
Finished in 335ms on 1 files using 16 threads.        # exit 0
                                # sha b47ad19e… → d146f177…  the fixture was rewritten

$ npx oxfmt --check …/test/fixtures/repo4-probe.json                  # shipped config
Expected at least one target file. All matched files may have been excluded by ignore rules.
                                                      # exit 2
```

Probe restored to its mis-indented state, then the two gates the acceptance names:

```
$ npm run check                                       # exit 0
    oxfmt --check → All matched files use the correct format. …on 470 files
$ npm run format                                      # exit 0, …on 470 files
    probe sha b47ad19e… before → b47ad19e… after      # untouched
$ git status --porcelain                              # only ` M .oxfmtrc.json` + the untracked probe
```

Probe and both throwaway configs deleted; `find . -name 'repo4-*'` returns
nothing inside the repo.

### Step 4 — the rule now sits in both places, and the comment was tested first

Root `CLAUDE.md`'s fixture rule gains a paragraph: the `**/` is what makes the
entry work, gitignore anchoring is why, HTML is why it is worth caring about, a
directory must be named `test/fixtures/` to be covered, and `**/fixtures/` is
named as the wrong broadening with the file it would cost.

`.oxfmtrc.json` gains a two-line comment above the entry. **This was measured
before it was proposed, not assumed** — `.json` is not obviously comment-bearing:

- oxfmt parses a `.json` config carrying a `//` comment (used it via `--config`,
  fixture correctly excluded, exit 2).
- oxfmt's own formatter _preserves_ the comment when it formats that file, so
  `npm run format` will not strip it.
- Nothing in the repo parses `.oxfmtrc.json`. `grep -rn oxfmtrc` over `ts/mjs/js/
json/yml/md` returns prose references only — no `JSON.parse`, so a comment
  cannot break a reader.

Both homes rather than either, because the failure mode was precisely that the
intent lived in `CLAUDE.md` and the enforcement in `.oxfmtrc.json` with nothing
tying them together — so a reader of either file could not tell the guard was
dead. `CLAUDE.md` is where conventions are read; the comment is the tripwire at
the point of edit, which is where the next person will be standing.

### Step 5 — no check filed, deliberately

The ticket says not to invent one, and I did not. Recording what was looked at:
oxfmt has `--no-error-on-unmatched-pattern`, which is the inverse of what is
wanted and applies to _positional path arguments_, not to `ignorePatterns`
entries — it does not help. The two checks that would work are both worse than
the bug. Asserting each `ignorePatterns` entry matches something in the tree
means reimplementing gitignore anchoring semantics, which is the exact thing that
was got wrong here and would be got wrong again. Spawning `oxfmt --check` per
entry inside a unit suite couples the suite to the toolchain and pays formatter
startup per assertion. Dropped rather than filed.

### What was left out, and why it could not ride here

`pl-15-candidate-legs.md` and `pl-28-valhalla-adapter.md` both carry statements
this ticket made false — most sharply pl-15's "a fixture edit must be followed by
`npm run format` or `format:check` fails", which now sends a planner agent
looking for a diff that will not appear. Annotating them was free work sitting
right here and I deliberately did not do it: both files are under
`tools/planner/`, release-please routes by path, and this branch's title is
`fix(repo): …`, a type that is **not** `hidden` in `release-please-config.json`
(checked: `hidden` today is `refactor`, `docs`, `test`, `build`, `ci`, `chore`).
Adding either path to this squash would cut a planner release whose changelog
line is a sentence about the repo's formatter. It needs its own pull request
under a `docs(planner):` title — filed as **repo-11**, `depends_on: [repo-4]`.

This branch touches `.oxfmtrc.json`, `CLAUDE.md` and `docs/` only, nothing under
`tools/`, so it releases nothing.

### Gates

```
npm run build   exit 0
npm run check   exit 0   (oxfmt --check: 470 files; oxlint: 1 pre-existing
                          no-await-in-loop warning in tools/planner/e2e/pin.spec.ts)
npm test        exit 0   Test Files 103 passed (103) · Tests 1528 passed (1528)
npm run format  exit 0   run after the .md edits; git status clean of anything unintended
```

`npm test` in full rather than one project, since this moves shared config.

One full-suite run in the middle of this work exited 1 with `102 passed (102)` /
`1515 passed (1515)` — **not a test failure**: vitest could not start a forks
worker (`[vitest-pool]: Failed to start forks worker … Timeout waiting for worker
to respond`) for `tools/downloader/web/test/error-panel.test.tsx`, so the file
never ran. `npx vitest run tools/downloader/web/test/error-panel.test.tsx` passes
13 tests, exactly the 13 missing from that run, and the next full run was
`103 passed` / `1528 passed`, exit 0. Machine contention, not this change —
recorded because an exit 1 in a log is worth being able to dismiss on evidence.
