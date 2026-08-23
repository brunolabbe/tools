---
id: repo-4
tool: repo
title: Anchor the fixture ignore pattern, which today matches nothing and formats every fixture
kind: fix
status: ready
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

_Not started._
