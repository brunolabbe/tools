---
id: dl-124
tool: downloader
title: The IPv6 rate-limit log test fails whenever a request id contains aaaa, bbbb or cccc
kind: fix
status: ready
milestone: null
depends_on: [dl-107]
difficulty: mechanical
---

# dl-124 — The IPv6 rate-limit log test matches a request id

## Why

`tools/downloader/api/test/visitor-data.test.ts` > "the address on a log line" >
"an IPv6 client's rate-limited line says the /48, while the limiter still counts
its /64" (dl-107) ends with

```ts
expect(raw).not.toMatch(/2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|cccc/u);
```

`aaaa`, `bbbb` and `cccc` are the interface ids of the three addresses the test
sends from (`2001:db8:1:1::aaaa`, `2001:db8:1:2::bbbb`, `2001:db8:1:1::cccc`),
written bare so that a leak of the interface id alone is caught. But `raw` is the
whole log, and every `request` line carries `requestId`, a `randomUUID()` unless
the caller sent `x-request-id` (`requestIdFrom` in `src/request-log.ts`). A UUID
is hex, so any of them can contain `aaaa`, `bbbb` or `cccc`, and then the test
fails with nothing leaked.

**Reproduction (as filed, from CI).** `test (windows-latest, informational)` of
PR #474 (lg-8, head `bd5a4381`), run 38355111789, job 115156202754:

```
AssertionError: expected '{"level":"info",…' not to match /2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|cccc/u
```

The received log has every `ip` and `key` field at `2001:db8:1::/48`, so nothing
leaked. The match is `"requestId":"f74250e2-bbbb-4ab7-9146-1d93423997db"`.
lg-8 touches no downloader code. The same test passed on main's Windows run
38355501857 at `4f756c40`: it is random, and not a Windows fault.

**How often.** The test sends four requests, so four request ids. Over two
million `randomUUID()` values, 1,472 matched `aaaa|bbbb|cccc`, which is one in
1,358 per id and about 0.3% per run (the measurement is in the Log). Small enough
to pass for months and large enough to land on a pull request that touched
nothing near it.

## Build

1. **Make the collision happen every run.** In the IPv6 test, send
   `x-request-id: f74250e2-bbbb-4ab7-9146-1d93423997db` on each inject (the id
   from the failing log). `requestIdFrom` accepts it, because it matches
   `SAFE_REQUEST_ID`, so each `request` line carries it. With the regex
   unchanged, the test fails on every run, on every platform.
2. **Take that one id out of the string the leak check reads, and nothing else.**
   `raw.replaceAll(HEX_RUN_REQUEST_ID, "")` before the `not.toMatch`, with the
   regex left as it is. Do not narrow the regex to `:aaaa` or to `::aaaa`: that
   stops catching an interface id leaking as its own field value (`"remote":"aaaa"`).
3. **Assert the lines carry the pinned id first**, so the strip cannot silently
   cover nothing, and a `requestIdFrom` that stopped honouring the header would
   show as that assertion and not as a flake.
4. **Positive control.** Plant a leak in the `request` line (`remote:
request.ip`; then only the /64 prefix; then only the interface id), confirm
   the test fails for each, restore.

## Done when

- The IPv6 test fails against its old regex when a request id contains `bbbb`,
  deterministically, and passes with the fix (the red and the green are in the
  Log).
- The check still fails for a planted leak of the full address, of the /64
  prefix, and of the bare interface id (the Log).
- `npm run check` and the downloader project's tests pass.

## Log

### 2026-10-13 — filed and fixed (Sonnet 5.5, builder-standard)

Handed over from the peer session that found the failure on PR #474's Windows
leg; the orchestrator read the CI log. The reading held:

```
$ node probe.mts   # the received requestId against the test's regex, no server
old regex matches: bbbb
```

**The rate, measured.** `/aaaa|bbbb|cccc/u.test(randomUUID())` over 2,000,000
values:

```
1472 of 2000000 UUIDs match; per test run (4 ids) ~ 0.00294
```

**Red, deterministic, on Linux.** Only the `x-request-id` header added to the
four injects, regex unchanged:

```
$ npx vitest run tools/downloader/api/test/visitor-data.test.ts -t "rate-limited line says the /48"
AssertionError: expected '{"level":"info","time":"2026-10-13T12…' not to match /2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|…/u
Tests  1 failed | 27 skipped (28)
```

**Green.** With the id stripped from `raw` and the pinned id asserted on the
`request` lines:

```
$ npx vitest run tools/downloader/api/test/visitor-data.test.ts
Test Files  1 passed (1)
Tests  28 passed (28)
```

**Positive control.** `src/request-log.ts` line 206 (the `request` line's
fields) given a `remote` field, one variant at a time; each run fails with
`AssertionError: expected '{"level":"info",…' not to match
/2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|…/u`, `Tests  1 failed | 27 skipped (28)`:

| Planted field                                 | Caught |
| --------------------------------------------- | ------ |
| `remote: request.ip` (the whole address)      | yes    |
| `remote: request.ip.split("::")[0]` (the /64) | yes    |
| `remote: request.ip.split("::")[1]` (`aaaa`)  | yes    |

The file was then restored with `git checkout -- tools/downloader/api/src/request-log.ts`
and the full file re-run (28 of 28).

**A first design was wrong and was dropped.** Anchoring the regex as
`/2001:db8:1:[12]|:(?:aaaa|bbbb|cccc)/u` passed the red case and caught the full
address and the /64, and then missed the third plant: a bare `"remote":"aaaa"` has
a quote between the colon and the hex. That is a weaker check than the one it
replaced, which the brief ruled out, so the regex is untouched and the request id
is taken out of the input instead.

**Not measured.** The failure on a Windows runner was not reproduced, and does not
need to be: the received string in the CI log carries the match, and the pinned id
reproduces it on Linux. A search of `api/test` for another `not.toMatch` with a
bare `aaaa`, `bbbb`, `cccc`, `dead` or `beef` alternative found none
(`grep -rnE "not\.toMatch\(/[^/]*(aaaa|bbbb|cccc|dead|beef)" tools/downloader/api/test`,
no output); a pattern of another shape was not looked for. The tests that follow
this one carry colons or dots in their patterns (`/2001:db8:5:[12]/u`,
`/203\.0\.113\.7[78]/u`).

### 2026-10-13 — gate 1's two lows applied at landing (Sonnet 5.5, fixer)

**The owner's answer.** Gate 1 (Opus 5.5, CONCERNS) left two lows. The question put
to the owner, by the orchestrator through `AskUserQuestion`, was what the landing
should do with them. The options were (a) apply both at landing (recommended),
(b) apply only the hostname pin, (c) record both and land as built. The owner chose
(a) on 2026-10-13.

**Low 1, the hostname.** `createCoreLogger` writes `os.hostname()` into every
line's `base`, and `bindings` is spread after it, so a `bindings: { hostname }`
overrides it. The `logged` helper in `visitor-data.test.ts` now passes
`bindings: { hostname: "test-host" }`. No other test in the file reads `hostname`
(`grep -n hostname tools/downloader/api/test/visitor-data.test.ts` finds only the
new line and its comment), so the pin changes nothing else.

Red, with a hostname that matches (`bindings: { hostname: "abbbbc" }`, the pin
temporarily set to a value holding `bbbb`):

```
$ npx vitest run tools/downloader/api/test/visitor-data.test.ts -t "rate-limited line says the /48"
AssertionError: expected '{"level":"info","time":"2026-10-13T12…' not to match /2001:db8:1:1|2001:db8:1:2|aaaa|bbbb|…/u
"hostname":"abbbbc"   (in the received string)
Tests  1 failed | 27 skipped (28)
```

Green, with `"test-host"`, and `raw` shown to carry it (a temporary
`expect(raw).toContain('"hostname":"test-host"')` in the same test, removed after):

```
$ npx vitest run tools/downloader/api/test/visitor-data.test.ts -t "rate-limited line says the /48"
Test Files  1 passed (1)
Tests  1 passed | 27 skipped (28)
$ npx vitest run tools/downloader/api/test/visitor-data.test.ts
Test Files  1 passed (1)
Tests  28 passed (28)
```

**Low 2, the rate.** The comment above `HEX_RUN_REQUEST_ID` said "about one run in a
hundred"; the Log's own measurement above is 0.00294 per run, one in 340. The
comment now says "about one run in 340".
