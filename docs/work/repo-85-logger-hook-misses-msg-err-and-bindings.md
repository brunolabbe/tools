---
id: repo-85
tool: repo
title: The shared logger's `redactFields` hook never sees the message, an `Error`, or the `bindings` option
kind: fix
status: done
milestone: null
depends_on: [repo-66]
difficulty: standard
---

# repo-85 — The `redactFields` hook never sees the message, an `Error`, or the `bindings` option

## Why

Found by gate 1 on repo-66 (2026-09-30) and filed on the owner's answer to
that gate's open decision: file it, rather than fold it into repo-66 (it
changes logged output, so it is a `fix` and cannot ride a `refactor` branch)
or accept it with a comment.

`redactFields` is applied in one place, `packages/core/src/logger.ts`'s `emit`
and its `child`, and it is handed the **`fields` object and nothing else**. So
a signed URL — which the root `CLAUDE.md` calls as sensitive as a cookie — is
written verbatim on every route that does not go through `fields`:

- **the message string.** `logger.info("fetching " + url)`.
- **an `Error` passed as a field.** Its `message` and `stack` are not
  enumerable, so the downloader's URL walk (`redactUrlsDeep`, which iterates
  `Object.entries`) never reaches them, and pino's own `err` serialiser then
  writes both.
- **the `createLogger` `bindings` option**, spread into pino's `base` at
  `packages/core/src/logger.ts:136 "...options.bindings"` without passing the
  hook. (`child` bindings do pass it.)
- **an `Error` with an enumerable URL field**, the other way round: the walk
  copies the `Error` to a plain object, so what is written has the redacted
  field and **no message and no stack**. Nothing leaks, but the line is
  useless for the failure it was written for.

**Nothing regressed and nothing reaches these today.** The gate's parity probe
(34 inputs per tool through the base and the head logger, 102 of 102 outputs
byte-identical) found all four behaving the same at `e79b04f`, before
repo-66; and no call site passes a URL in a message, logs an `Error` object
(errors are logged as `String(error)` or a code) or passes `bindings`. So this
is a net with four unmarked edges, not a live leak, which is why it is a
ticket and not an incident.

### Reproduction

From the repo root, after `npm run build`, save this as `repro.mjs` and run
`node repro.mjs`:

```js
import { createLogger } from "./tools/downloader/api/dist/logger.js";

const url = "https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1";
const show = (label, run, options = {}) => {
  const lines = [];
  run(createLogger({ level: "debug", write: (line) => lines.push(JSON.parse(line)), ...options }));
  const { time, pid, hostname, ...rest } = lines[0];
  console.log(`${label.padEnd(18)} ${JSON.stringify(rest)}`);
};

show("control (a field)", (l) => l.info("m", { url }));
show("msg", (l) => l.info(`fetching ${url}`));
show("err", (l) => l.error("m", { err: new Error(`failed ${url}`) }));
show("bindings option", (l) => l.info("m"), { bindings: { url } });
show("err + enumerable", (l) => {
  const error = new Error(`failed ${url}`);
  error.details = { url };
  l.error("m", { err: error });
});
```

Output, run on repo-66's branch at `6c3f8ea` (the `err` line's stack trimmed
to its first frame; the rest is verbatim):

```text
control (a field)  {"level":"info","url":"https://cdn.example/v.mp4?[redacted]","msg":"m"}
msg                {"level":"info","msg":"fetching https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1"}
err                {"level":"error","err":{"type":"Error","message":"failed https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1","stack":"Error: failed https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1\n    at file:///.../repro.mjs:13:40 ..."},"msg":"m"}
bindings option    {"level":"info","url":"https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1","msg":"m"}
err + enumerable   {"level":"error","err":{"details":{"url":"https://cdn.example/v.mp4?[redacted]"}},"msg":"m"}
```

The control line shows the hook working; the next three each contain
`SECRET`; the last has none but has lost `message` and `stack`.

## Build

The mechanism is in the shared adapter, so the fix is too: give the adapter a
way to run the same redaction over the three things `fields` does not carry,
and have the downloader's hook supply it. The planner and the ledger pass no
hook and are unaffected.

1. **`bindings`.** Pass the option through the hook in `createLogger`, as
   `child` already does. Smallest of the four.
2. **The message.** A string, not an object, so the `(fields) => fields` hook
   cannot take it. Either a second, optional `redactMessage` hook, or widen
   the hook's contract; the downloader's would call `redactUrlsInText`. Decide
   in the branch and record the choice in the Log.
3. **An `Error`.** Serialise it before the walk (or teach the walk to descend
   into `message` and `stack` and to copy an `Error` as an `Error`), so that
   both the leak and the lost message and stack close together. They are one
   mechanism, and fixing only the first would leave a redacted line with no
   failure in it.
4. Tests, appended in new files: one per route above, asserting the raw
   serialised line for `SECRET` and that the message and stack survive.

A `fix(core)` at least, and it changes logged output for the downloader, so
it needs its own pull request and a gate.

## Done when

- `node repro.mjs` above prints no `SECRET` on any line, and the last line
  still carries `message` and `stack`.
- A test per route (message, `Error`, `bindings`, `Error` with an enumerable
  URL field) fails on the base and passes on the fix.
- The downloader's existing `tools/downloader/api/test/logging.test.ts` passes
  unchanged.
- `npm run check` and every project's suite pass.

## Review

### Gate 1

_Re-issued at `8487daa`, the gated sha `76a0728` unchanged: coordinates re-resolved. Citations whose text the round after it deleted, or whose claim it corrected, are now prose naming `76a0728`: the two source lines in F1, the `instanceof` line in F2, the three test lines in F4. Two anchors in row 2 changed because their text is no longer unique in the file, so the `Error` and `bindings` proofs now cite their test names._

**Gate: FAIL** — 2026-10-01 · `b7fb3fb...76a0728` (head `76a0728`; `origin/main` still at `b7fb3fb` after fetch) · code-review at medium

| Done when                                                                          | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node repro.mjs` prints no `SECRET`, and the last line keeps `message` and `stack` | **verified** — the brief repro, imports pointed at this worktree `dist`: 0 of 5 lines carry `SECRET` on a head build (`grep -c redactMessage` over core and downloader `dist`: 7, 2), 3 of 5 on a base build (0, 0). Last line asserted at `tools/downloader/api/test/logging-routes.test.ts:103 "expect(err?.details).toEqual({ url: REDACTED_URL });"` with message and stack on the two lines after it ✓                                                                                                                                                                                                                                                           |
| A test per route fails on the base and passes on the fix                           | **proven** — message `tools/downloader/api/test/logging-routes.test.ts:55 "fetching ${REDACTED_URL}"` and `packages/core/test/logger-redaction-routes.test.ts:64 "deep [hook]"`; `Error` `tools/downloader/api/test/logging-routes.test.ts:84 "loses the URL from its message and its stack, and keeps both"`; `bindings` `tools/downloader/api/test/logging-routes.test.ts:236 "loses a URL's query string, as a child's bindings do"` and `packages/core/test/logger-redaction-routes.test.ts:100 "x?[hook]"`; enumerable field, row 1. Both new files run over the base sources with the base rebuilt: 13 failed, 8 passed of 21; on the head, rebuilt: 21 of 21 ✓ |
| `logging.test.ts` passes unchanged                                                 | **verified** — `git diff --stat b7fb3fb HEAD` over it and `packages/core/test/logger.test.ts` is empty; 47 of 47 at the head ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `npm run check` and every suite pass                                               | **verified** — check exit 0; `npm test` 3563 passed and 2 skipped of 3565 in 193 files, against 3542 and 2 of 3544 in 191 at the base: +21 is the 9 core and 12 downloader tests added ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

- **high** · F1 — two findings, one mechanism: `redactError` skips every own accessor but `stack`, in its own-accessor skip as of `76a0728`, and the copy keeps the accessor as it was. (a) **A regression:** an `Error` with an own enumerable getter returning a signed URL was redacted on the base, because the base walk at `tools/downloader/api/src/logger.ts@b7fb3fb:159 "Object.entries(value as Record<string, unknown>)"` invokes getters; on the head it is written raw, since pino reads every enumerable key of `err`. (b) An own `message` accessor: the stack is now redacted and the `message` is still raw. The doc comment above `redactError` as of `76a0728` says not evaluating a getter avoids a hazard the walk already had; the base walk did evaluate them, and pino evaluates them anyway. Not synthetic in kind: Node own `ERR_SYSTEM_ERROR` carries `errno` and `syscall` as own enumerable accessors (measured, `os.setPriority(999999, 0)`). No call site logs such an error today. Remedy: read an own accessor through the error, as `stack` is, and write the copy property as data with the original enumerability; one test per half.
- **low** · F2 — an `Error` from another realm is not `instanceof Error` (the `instanceof Error` test in `redactUrlsDeep` as of `76a0728`), falls to the plain-object branch, and its `message` and `stack` are written raw — on the base and the head alike. pino itself duck-types (`typeof err.message`). No `node:vm` anywhere in the downloader `src`, so nothing reaches it.
- **low** · F3 — an error whose `message` is a prototype getter over an internal slot (`DOMException`) breaks on the copy: pino throws, and the line falls back to `fieldsDropped: true` with no `err` at all. The base leaked the URL there; the head leaks nothing and keeps nothing. A frozen `Error` gives `fieldsDropped` on both.
- **low** · F4 — three findings, one mechanism: tests whose only content assertion is the absence of `SECRET`. The nested-`Error` test as of `76a0728` cannot fail — pino writes an `Error` nested below `err` as `{}`, measured as `"attempts":[{}]` on the base and the head. The `cause`-cycle test passes on the base, whose line is `{"cause":"[Circular]"}` with no message, and asserts nothing about message or stack surviving. The child-logger test, ending in `toHaveLength(3)`, counts lines rather than reading them. The Log names the two base-green tests as controls; they are named as redaction tests.
- **low** · F5 — `createLogger` now throws when `redactFields` throws on the `bindings` option (`packages/core/src/logger.ts:165 "options.redactFields(options.bindings)"`; measured on the core `dist`: `createLogger threw: hook`), where the base never called the hook there. `child` already behaved so. The Log records this as a decision not taken, in prose — see open decision D1.
- **low** · F6 — this branch moves five unpinned citations in repo-66 Gate 1, three of whose anchors are now nowhere in `packages/core/src/logger.ts`. Reported and not failed: `citations-gate.mjs --against b7fb3fb` gives 139 enforced, 0 failing. All five still resolve at `3aaa21a`, the repo-66 merge on `main`, so a repin there in this pull request is one edit. dl-58 also cites `tools/downloader/api/src/logger.ts` in unanchored `evidence` comments, which this branch shifts by 7 lines with nothing reporting it.
- **dropped** · a non-string message from an untyped caller is now `[message dropped]` in the downloader, where the base wrote `42`, or an object carrying the raw URL. The type forbids that call, and the new output leaks less.
- **open** · D1 — a throwing hook on the `bindings` option, or a `child`. Options: (1) accept — `createLogger` runs once at boot, and no hook here throws except over a frozen `Error`; (2) guard both in this branch with a `bindingsDropped` marker, about ten lines and two tests. Recommend (1), recorded as a decision rather than a Log aside.
- **open** · D2 — release routing. `packages/core` is not a release-please package, so the only path that releases is `tools/downloader/api/src/logger.ts`: a `fix` title cuts a downloader patch whose changelog line is scoped `core`. Preflight passes the title (type and paths agree). The downloader output changes for no call site that exists today, only for the routes this ticket closes. Options: (1) keep `fix(core)` — a downloader patch with a core-scoped line; (2) retitle `fix(downloader):`, since the downloader is the one tool whose output changes and the one changelog it lands in; (3) split the core half into its own pull request. Recommend (2).
- **findings** · code-review at medium returned 11: F1 (two), F2, F3, F4 (three), F5 with its decision D1, F6, D2, and the dropped one; 10 carried, 1 dropped.
- NFR: security — F1, F2 · performance n/a: one own-property scan and one stack read per logged `Error`, one regex pass per message · reliability — F3, F5 · maintainability — F4, and the F1 comment.

### Gate 2

_Re-issued at `8487daa`, the gated sha `8d182a9` unchanged: coordinates re-resolved. G1 cited the key-set line of `redactError`, which the round after it rewrote, so that citation is now prose naming `8d182a9`._

**Gate: PASS** — 2026-10-02 · `76a0728..8d182a9` only (`origin/main` still at `b7fb3fb` after fetch) · code-review at medium

| Gate 1 finding                                         | Verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — `redactError` skipped own accessors               | **fixed** — every key is now read through the error and copied as data, `tools/downloader/api/src/logger.ts:251 "const original: unknown = (error as unknown as Record"`; tests `tools/downloader/api/test/logging-routes.test.ts:165 "own enumerable getter"` and `tools/downloader/api/test/logging-routes.test.ts:177 "accessor is redacted along with the stack"`. The new spec over the `76a0728` sources, rebuilt (no `isError` in `dist`): 4 failed, 12 passed of 16, the four being the F1 to F3 tests; over `8d182a9`: 16 of 16 ✓                                                                                                                                                                    |
| F2 — another realm                                     | **fixed** — `tools/downloader/api/src/logger.ts:180 "Object.prototype.toString.call(value)"`; test `tools/downloader/api/test/logging-routes.test.ts:190 "an error from another realm is redacted too"`, which also asserts the error is not `instanceof Error` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| F3 — `DOMException` fell back to `fieldsDropped`       | **fixed** — test `tools/downloader/api/test/logging-routes.test.ts:201 "keeps its failure, whose message"`; the probe line now carries `err` with `type`, a redacted `message` and stack, and `code` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| F4 — three tests checked only for absence              | **fixed** — the `cause`-cycle test asserts message and stack, `tools/downloader/api/test/logging-routes.test.ts:161 "Error: loop ${REDACTED_URL}"`, and **fails on `b7fb3fb`**, the gap the round left unmeasured: base and downloader rebuilt (no `redactMessage` in either `dist`), the new spec gave 12 failed, 4 passed of 16, this test among the failures with `err?.stack` undefined. The nested test is renamed and pins the shape, `tools/downloader/api/test/logging-routes.test.ts:139 "toEqual({ attempts: [{}, {}] })"`; the child test reads level, `requestId` and `msg` of each line, `tools/downloader/api/test/logging-routes.test.ts:58 "so does one on a child logger, at every level"` ✓ |
| F5 — `createLogger` throws on a throwing bindings hook | **closed by decision** — D1, accepted by the owner, now recorded in the comment above the bindings at `packages/core/src/logger.ts:159 "decision on repo-85, 2026-10-01"` ✓                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F6 — repo-66 citations moved, dl-58 drift              | **fixed** — the five repo-66 citations are pinned to `3aaa21a`: `citations.mjs` on that record under Review gives 22 verified, 0 moved of 23, with 1 prose line unchecked. `citations-gate.mjs --against b7fb3fb`: 139 enforced, 0 failing, and moved citations outside the branch down from 22 in 11 records to 17 in 10. The ranges dl-58, dl-29 and dl-43 cite in `tools/downloader/api/src/logger.ts` (72 to 112, 115, 125, 127, 142) are byte-identical to the base; the first hunk against the base is the added call to isError, below all of them ✓                                                                                                                                                   |

Acceptance re-run at `8d182a9`, rebuilt (`isError` in the downloader `dist`): the brief repro prints 0 of 5 lines with `SECRET`; `npm run check` exit 0; `npm test` 3567 passed and 2 skipped of 3569 in 193 files, the +4 over `76a0728` being the four appended tests; the three logger specs 72 of 72, `logging.test.ts` still unchanged. Planner and ledger output is byte-identical to the base over 10 lines. The full leak-route probe, 31 routes plus 5 aimed at the rewrite (a Node `ERR_SYSTEM_ERROR` with a URL message, a `Symbol.toStringTag` spoof, a symbol-keyed property, two throwing getters), prints no `SECRET` on any line; of the 29 rows also run at `76a0728`, 23 are byte-identical and 6 changed, all to clean: the F1 to F3 rows and a frozen `Error`, which now keeps its `err` where both earlier states dropped the fields.

- **low** · G1 — the rewrite reads every own property, non-enumerable accessors included, at the key-set line of `redactError` as of `8d182a9`, though pino never writes a non-enumerable one. A non-enumerable own getter that throws now sends the whole call to `fieldsDropped`: an `Error("plain")` with one logs `{"fieldsDropped":true}` here, where `b7fb3fb` and `76a0728` both log its `err` in full; with a signed URL in the message, `76a0728` logged it redacted and this head drops it. No leak. Unmeasured whether any real error carries such a getter: the one Node error checked, ERR_SYSTEM_ERROR, has enumerable accessors that do not throw. Remedy: read a non-enumerable own key only when pino reads it (`message`, `stack`, `name`, `cause`, `errors`), or catch per key and leave that key out of the copy.
- **findings** · code-review at medium over the round returned 1; 1 carried, 0 dropped.
- NFR: security ✓ — no `SECRET` on any of 36 probe lines · performance n/a — one `for…in` and one read per key of each logged `Error` · reliability — G1 · maintainability ✓, the corrected `redactError` comment now matches what the walk and pino do.

## Log

- 2026-09-30 — **Filed** on repo-66's branch, from gate 1's F4, on the owner's
  choice (recorded by the coordinator, via `AskUserQuestion`). The
  reproduction above was re-derived from the gate's probe into a form that
  runs from the repo, and run on `6c3f8ea`; the five lines are that run's
  output.

- 2026-10-01 — **Built** on `repo-85-logger-hook-coverage`, from `b7fb3fb`. Four routes
  closed, none of them touching a log line a tool or test reads: no existing
  test changed, and no call site passes a URL in a message, logs an `Error`
  object or passes `bindings` (the brief's own survey), so there was no
  tool-visible behaviour to bring back as options.
  - **Message: a second hook, `redactMessage?: (message: string) => string`,
    not a widened `redactFields`.** Widening the fields hook to `string | object`
    would break every hook already written (the downloader's `safeFields`
    is typed over an object) to save one optional property; the planner and the
    ledger pass neither and are untouched. The downloader supplies
    `redactUrlsInText`, the same matcher its field walk uses. A `redactMessage`
    that throws writes `[message dropped]`, never the raw input: the message is
    the thing it was asked to clean, so the fallback must not be the input.
  - **`bindings` option:** `createLogger` passes it through `redactFields`, as
    `child` does — but only when `bindings` is given. Calling the hook on
    `undefined` at construction broke two existing `logger.test.ts` tests (the
    hook seeing `[undefined, undefined]`, and a throwing hook failing
    `createLogger` itself), found by running that file, not by reasoning.
    A hook returning `undefined` yields no bindings, not the raw ones (my first cut
    fell back to the raw input with `??`; a new test caught it).
  - **`Error`: the downloader's walk copies it as an `Error`** (`redactError`, called
    from `redactUrlsDeep`), not core's adapter, so the planner and ledger
    pay nothing and core grows no second walk. The copy keeps the prototype
    (pino still reports `type` as the subclass's name) and each property's
    enumerability, so a non-`err` key serialises exactly as before.
    **The brief was missing one fact: on this Node `stack` is an own accessor,
    and a descriptor copied onto another object reads back `undefined`.** The
    first cut logged `"stack":""` — `message` fixed, stack silently emptied, the
    exact "redacted line with no failure in it" the brief warned about — so a copy
    now always carries `stack` as a plain non-enumerable data property. `cause`
    needs no code of its own: pino 7.1 folds the chain into `message` and `stack`,
    and both are redacted (`logging-routes.test.ts`, "redacts a `cause`").
  - **Reproduction, base then branch** (`node repro.mjs` from the brief, imports
    pointed at this worktree's `dist`; `grep -c SECRET` counts lines): base,
    after a build of `b7fb3fb`, printed the brief's five lines — `msg`, `err`,
    `bindings option` containing `SECRET` and `err + enumerable` with no
    `message` or `stack`. Branch: `0` of `5` lines contain `SECRET`; `err` and
    `err + enumerable` both carry `"message":"failed https://cdn.example/v.mp4?[redacted]"`
    and a stack beginning `Error: failed https://cdn.example/v.mp4?[redacted]`.
  - **Red on the base, green on the branch.** The two new files with the two
    `logger.ts` sources restored to `HEAD` **and `npm run build` rerun**, because
    the downloader's suite reads `@webtools/core` from its `dist` — a first
    attempt without the rebuild showed `12 failed` and read the new core through
    the old downloader, which hid the downloader's `bindings` test. Then
    `npx vitest run packages/core/test/logger-redaction-routes.test.ts tools/downloader/api/test/logging-routes.test.ts`:
    `13 failed | 8 passed` of 21 on the base (`6` of `9` in core, `7` of `12` in
    the downloader). On the branch, rebuilt: `21 passed` of 21. **Corrected by
    gate 1 (F4), see the round entry below:** of the eight that passed on the
    base I called all "controls", and only six are — the nested-`Error` and
    `cause`-cycle tests are named as redaction tests and asserted too little to
    fail on a leak.
  - **Suites:** `npx vitest run packages/core tools/downloader/api` — `707 passed`
    and `2 skipped` of 709, `logging.test.ts` unchanged and green;
    `npx vitest run tools/planner/api tools/ledger/api` — `541 passed` of 541.
  - **The brief's `logger.ts:136 "...options.bindings"` is the base's line**; this
    branch moves it, and the brief is left describing the base on purpose.
  - **Raised as a decision in the round below** (it was a "could have folded in"
    aside here, which hid it): `child` calls the hook unguarded, and now so does
    `createLogger` for its `bindings`.

- 2026-10-01 — **Gate 1 round (Opus, FAIL at `76a0728`, one high), fixed.**
  - **F1 (high), reproduced then fixed.** A probe (scratch, `node probe.mjs`;
    `dist` built from `76a0728`) printed `LEAK` for "own enumerable getter" and
    "own message accessor", plus F2's "cross-realm Error", and `fieldsDropped`
    for a `DOMException` (F3). `redactError` skipped every own accessor except
    `stack` and kept it uncopied, so the getter's URL reached pino raw — a
    regression on the walk's `Object.entries`, which evaluated getters. Node's
    own `ERR_SYSTEM_ERROR` has this shape. Now every own property, plus
    `message`, `stack` and `name`, is **read through the error and written to the
    copy as data**, with the original's enumerability. After a rebuild the same
    probe prints `clean` on all five and the `DOMException` line carries its
    `message`, a stack beginning `AbortError: failed https://…?[redacted]`, and
    `code`. The doc comment that said skipping getters avoided a hazard the walk
    already had is rewritten: it was wrong, the walk evaluated them and pino does.
  - **F2 (low), fixed.** `isError` now also accepts `Object.prototype.toString`
    `"[object Error]"`, so an error from another realm is copied. (`types.isNativeError`
    needed an import line and shifted dl-58's unanchored `evidence` citations; see F6.)
  - **F3 (low), fixed, same change.** A `DOMException`'s `message`, `name` and
    `code` are prototype getters that throw on a plain copy and pino reads them
    off it, so the copy owns them as data, keys taken from `for…in` as well as the
    own names.
  - **F4 (low), fixed.** The two mislabelled tests now assert what they claim:
    the nested-`Error` test is renamed to say it pins pino writing `{}` and is not
    a redaction test (an `Error` below any key but `err` has no way to leak or to
    show its message), and asserts that shape; the `cause`-cycle test asserts
    `message` and `stack` survive; the child-logger test reads the three lines
    (level, `requestId`, `msg`) instead of counting them.
  - **Red/green for F1–F3**, four new tests appended to `logging-routes.test.ts`:
    with `tools/downloader/api/src/logger.ts` at `76a0728`,
    `npx vitest run tools/downloader/api/test/logging-routes.test.ts` gave
    `4 failed | 12 passed` (the getter, the `message` accessor, the cross-realm
    error and the `DOMException`); with the fix, `16 passed` of 16. That run does
    not need a rebuild: the downloader's own `src` is what the suite imports, and
    core did not change between the two. Whether the strengthened `cause`-cycle
    test now fails on `b7fb3fb` is **unmeasured**; the gate reports the base line
    carried no message.
  - **D1 — a hook that throws on `bindings`: decided by the owner, 2026-10-01,
    via `AskUserQuestion`: accept it.** `createLogger` throws when `redactFields`
    throws on the `bindings` option, as `child` already throws when it throws on a
    child's bindings; the alternative (guard both with a `bindingsDropped`
    marker) was declined. Reason as the owner took it: bindings are set at
    construction or per request, not on a hot path, and a hook broken enough to
    throw on them is better found at boot than hidden behind a marker. Recorded in
    the comment above `bindings` in `packages/core/src/logger.ts` too. The base
    never ran the hook at construction, so this is new behaviour, bounded to a
    hook that throws on a bindings object it was handed.
  - **D2 — title: decided by the owner, 2026-10-01: keep `fix(core): …`**, over
    `fix(downloader)` (the gate's and the orchestrator's recommendation) and a
    split into two pull requests. The commit also touches
    `tools/downloader/api/` and so lands in the downloader's changelog under a
    core-scoped line; that was weighed and accepted.
  - **F5 (low)** is D1 above.
  - **F6 (low), fixed.** repo-66's five moved citations (`packages/core/src/logger.ts`
    at `:103`, `:114`, `:136`; `tools/downloader/api/src/logger.ts` at `:228`,
    `:229`) are pinned to `3aaa21a`, repo-66's merge, where each anchor still
    resolves: `node scripts/citations.mjs docs/work/repo-66-lift-the-logger-into-core.md --section Review`
    printed five `MOVED` before and none after. The silent drift gate 1 found in
    dl-58's unanchored `evidence` comments (they point at `logger.ts:115/125/127/142`)
    came from the seven-line header paragraph and the `node:util` import this
    branch added above them; both are gone, the paragraph's text now sits above
    `createLogger` at the file's end, and the first line this branch adds is the
    `isError(value)` line at 148, past all four cited lines
    (`git diff origin/main -U0 -- tools/downloader/api/src/logger.ts` shows its
    first hunk at `@@ -147,0 +148 @@`).

- 2026-10-02 — **Gate 2 (PASS at `8d182a9`), one new low, G1, fixed.**
  - **G1, reproduced.** The probe (`node probe.mjs`, `dist` built from `8d182a9`)
    printed `fieldsDropped` for an `Error("plain")` and for an error with a signed
    URL in its message, each carrying a non-enumerable own getter that throws. My
    round-1 fix read **every own property name**, so it evaluated a getter pino
    never reads.
  - **Remedy chosen: read only the keys pino reads, rather than catching each
    read.** The keys are every enumerable one, own or inherited (`for…in`, which
    is what pino iterates), plus `message`, `stack`, `name`, `cause` and `errors`.
    Why not a per-read `try`/`catch`: it would have to decide what to do with an
    unreadable key, and for an _enumerable_ getter that throws there is no good
    answer — pino throws on the original too, the base walk threw there, and
    `emit` already catches it, so swallowing it here would hide the error from the
    one place built to handle it and write a line pino would then have thrown on
    anyway. Narrowing the read set removes the cause instead of the symptom, and
    leaves a throwing _enumerable_ getter exactly where it always was.
  - **Probe across the rows, after a rebuild:** all ten print `clean` — own
    enumerable getter, own enumerable getter with a URL in the message, own
    `message` accessor, cross-realm error, `DOMException`, G1 plain, G1 with a
    signed URL, a frozen `Error` with a URL, `ERR_SYSTEM_ERROR` (from
    `os.setPriority(999999, 0)`), and an error with a `cause` carrying a URL. The
    two G1 rows now carry `message` and `stack` instead of `fieldsDropped`.
  - **Red/green:** two tests appended to `logging-routes.test.ts`. With
    `tools/downloader/api/src/logger.ts` at `8d182a9`,
    `npx vitest run tools/downloader/api/test/logging-routes.test.ts` gave
    `2 failed | 16 passed`; with the fix, `18 passed` of 18. The suite imports the
    downloader's `src`, so no rebuild was needed between the two.
  - **Unchanged:** the first line this branch adds to the downloader's `logger.ts`
    is still the `isError(value)` line at 148.

- 2026-10-02 — **A function-valued `cause`, folded in by the owner's decision.**
  Gate 3's reviewer found, and recorded as dropped, a leak that is **pre-existing
  on `main` at `b7fb3fb`** and unchanged by this branch: an `Error` whose `cause`
  is a function (VError style) has `err.cause()` called by pino, which writes the
  returned error's stack as `caused by: …`; the walk leaves a function as it finds
  it, so a signed URL in what the function returns went out raw. The reviewer
  offered (1) leave it, which was its recommendation and the orchestrator's, (2)
  fold it into this branch, (3) file it. **The owner chose (2), overriding that
  recommendation, via `AskUserQuestion` on 2026-10-02**; nothing in downloader
  source passes a function as `cause` today, so this closes a latent route, not a
  live one.
  - **Reproduced first**, at `8b026d9`: an error with a function `cause` returning
    `new Error("failed https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1")`,
    logged as `{ err }` through the downloader's `createLogger`, wrote
    `"stack":"Error: outer … caused by: Error: failed https://cdn.example/v.mp4?X-Amz-Signature=SECRET&x=1 …"`.
  - **How pino calls it**, read in `pino-std-serializers/lib/err-helpers.js`:
    `getErrorCause` tests `typeof err.cause === 'function'` and calls `err.cause()`
    — on every serialisation of the stack and of the message, down the chain — and
    keeps the result only if it has a string `message`. And `err.js` serialises
    only the error under the `err` key (and what that error's own enumerable
    properties and `errors` hold); an error under any other key is plain JSON and
    its `cause` is never asked for.
  - **Fix: wrap, do not call.** `redactError` replaces a function `cause` on its
    copy with one that calls the original (as a method of the original error) and
    runs the result through the walk. The walk reaches errors under every key, so
    calling the function eagerly there would run a function pino never runs; the
    wrapper is called when, and as often as, pino calls it. The result's own
    function `cause` is wrapped again by the same code, so a chain is covered.
    Only an error with a function `cause` is copied that it was not before; every
    other row takes the path it took. **Corrected by gate 4's H1, below: as first
    written the wrapper was called as often as pino calls it only for a chain with
    no loop.**
  - **Red/green:** four tests appended to the end of `logging-routes.test.ts`,
    helpers included, so no citation into that file moves. With `logger.ts` at
    `8b026d9`, `npx vitest run tools/downloader/api/test/logging-routes.test.ts`
    gave `2 failed | 20 passed` (the redaction test and the chain test; the
    plain-cause control and the call-count test pass there, as they should: they
    guard the fix, not the leak); with the fix, `22 passed` of 22. The call-count
    test compares against the shared logger with no hook, so it fails if the
    wrapper ever calls the function more often than pino does, or at all for an
    error under a key pino does not serialise.
  - **Unchanged:** the fix adds nothing above `redactError`; the first line this
    branch adds to the downloader's `logger.ts` is still the `isError(value)` line
    at 148, and the new test and its helpers sit after the last existing line of
    `logging-routes.test.ts`.

- 2026-10-02 — **Gate 4 (PASS at `ebb5e32`), one new low, H1, fixed by the owner's
  choice** (via `AskUserQuestion`, 2026-10-02, over landing it recorded or
  reverting the fold-in).
  - **H1, reproduced.** A cause chain that loops ran until the stack overflowed.
    pino stops a loop by remembering the errors it has seen; the wrapper returned a
    fresh copy on every call, so pino never recognised one. Two tests appended to
    `logging-routes.test.ts`, with `logger.ts` at `ebb5e32`: a self-returning
    `cause` called the original **6153** times where pino alone calls it **2**, and
    two errors returning each other **[3077, 3076]** where pino alone gives
    **[2, 2]**; both lines were `{"fieldsDropped":true}`. Nothing leaked. The Fix
    bullet above claimed the wrapper is called as often as pino calls it, true only
    without a loop; its call-count test never fed it one.
  - **Fix: one copy per error per line.** `redactError` keeps a map from each
    original error to its copy, per logged call, keyed by the `ancestors` set that
    call's walk creates and every wrapper it made holds. An error already copied
    comes back as the same copy, so pino's own guard stops the loop where it stops
    it on the original. The same map makes a shared error under two keys one copy,
    which changes nothing written.
  - **Red/green:** five tests appended to the end of the file, helpers included.
    Red at `ebb5e32`, `npx vitest run tools/downloader/api/test/logging-routes.test.ts`:
    `2 failed | 25 passed` (the two loops). Green at the fix: `27 passed` of 27. Each
    row asserts the per-error call counts equal pino alone's, the line has no
    `fieldsDropped` and no secret. Controls that pass on both: one level, a chain of
    three, a `cause` that throws (equal counts, `fieldsDropped` on both sides), and
    the earlier test for an error under `details`, whose cause is not called at all.
  - **Unchanged:** nothing above line 148 of the downloader's `logger.ts`
    moved; the first added line is still `isError(value)` there.
