---
id: repo-66
tool: repo
title: A preflight test times out on the Windows CI leg, on code that never touched it
kind: fix
status: needs-decision
milestone: null
depends_on: []
---

# repo-66 — a preflight test times out on the Windows CI leg

## Why

`scripts/test/preflight.test.ts`'s `"the CLI never leaks next-id.mjs's
id-sweep wording when gh fails inside check 5"` is flaky on the
`test (windows-latest, informational)` CI leg, on commits that touch neither
`scripts/preflight.mjs` nor that test file:

- 6,867 ms — run 36333161971, PR #298 at `f1adeb4`
- 6,081 ms — run 36333555081, `main` at `6988b65`
- **timed out at 30,000 ms** (ran 41,330 ms) — run 36334718531 attempt 1, #298
  at `18ca055`
- 2,024 ms — run 36334718531 attempt 2, the same sha

The same sha passed in 2 s on its retry and failed at 41 s on its first
attempt, so this is not a deterministic regression in anything the diffs at
those shas touch — it is intermittent, and the leg is `informational`
(`continue-on-error`), so it never blocked either pull request.

**An unverified hypothesis, from `dl-53`'s builder, offered as a hypothesis
to test rather than a finding.** The test
(`scripts/test/preflight.test.ts:838`) fakes `gh` with a shell script:

```js
fs.writeFileSync(ghPath, "#!/bin/sh\nexit 1\n");
fs.chmodSync(ghPath, 0o755);
```

then prepends `shimDir` to `PATH` and spawns the CLI, expecting `checkMergeTree`
to fail fast on the fake `gh` exiting 1. **Windows does not honour a `#!`
shebang line** — `.claude/rules/testing.md`'s own documented gotcha, measured
elsewhere in this repo for a different spawn (`packages/core`'s oxfmt scan,
which learned this by a Windows-only failure that read as a wording change
rather than a missing process). If the same holds here, `spawnSync("gh", ...)`
on Windows may not execute this fake file at all, falling through to
whatever `gh` is actually on the runner's `PATH` — the hypothesis being that
this reaches a **real** `gh` and real network latency, which would explain an
intermittent multi-second-to-timeout spread on a check that should fail in
milliseconds against a local fake.

**Not yet checked**, and worth checking before building anything:

- Does `windows-latest`'s runner image carry a `gh` binary on `PATH` by
  default? (GitHub-hosted Windows runners are documented to preinstall the
  `gh` CLI as of this writing, which would make the fallback path real rather
  than a `ENOENT`.)
- What `spawnSync` actually returns on Windows for a `PATH` entry containing an
  extension-less file that starts with `#!/bin/sh` — a `useless_command`
  process object with an error, an immediate `ENOENT`, or something the shell
  or `cmd.exe` resolves through a different mechanism.
- Whether the same shim pattern appears in any other test in this suite, or
  is unique to this one.

## Build

**Contract-adjacent nothing; this is a test-infrastructure fix once the
hypothesis is confirmed.** Proposed by the hypothesis's own shape, not yet
verified:

1. Confirm or refute the hypothesis directly: on a Windows runner (or a local
   Windows checkout if one is available), write the same shim and
   `spawnSync("gh", [...])` it with a `PATH` prepended the same way; observe
   whether the fake or a real `gh` answers, and at what latency.
2. If confirmed, fix the fake the way `.claude/rules/testing.md` already
   prescribes for this exact class: resolve `gh`'s real absolute path is not
   applicable here (there is no `gh` package under `node_modules`), so the
   fix is likely a `.cmd` or `.bat` shim on Windows specifically (matching how
   npm itself writes `.cmd`/`.ps1` beside a `.bin` shim), selected by
   `process.platform`, rather than a bare extension-less script everywhere.
3. If refuted, look for the real cause with the same rigor — a slow
   `spawnSync` teardown, a runner-wide resource contention on that leg,
   something else entirely — before proposing a fix.

## Done when

- The hypothesis above is confirmed or refuted, with the command and its
  output, not asserted from the shape alone.
- Whichever holds, the test is reliable on the Windows leg: three consecutive
  windows-latest runs of `scripts/test/preflight.test.ts` complete without a
  timeout, or the flakiness is shown to have a different, named cause and this
  ticket is updated or reassigned accordingly.
- `npm run check` and `npx vitest run scripts/test/preflight.test.ts` pass
  locally (they already do; this is a Windows-leg-only symptom).

## Log

- 2026-09-27 — Filed on the coordinator's instruction, as item 17 of the
  2026-09-27 batch close-out (`repo-64`). The four run timings above were
  measured by the coordinator via the batch's own CI runs; not independently
  re-run here. The Windows-shebang hypothesis is `dl-53`'s builder's,
  relayed as a hypothesis to test — filed rather than fixed because nothing
  here yet confirms it.
