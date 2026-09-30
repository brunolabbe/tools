---
id: repo-85
tool: repo
title: The shared logger's `redactFields` hook never sees the message, an `Error`, or the `bindings` option
kind: fix
status: ready
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

## Log

- 2026-09-30 — **Filed** on repo-66's branch, from gate 1's F4, on the owner's
  choice (recorded by the coordinator, via `AskUserQuestion`). The
  reproduction above was re-derived from the gate's probe into a form that
  runs from the repo, and run on `6c3f8ea`; the five lines are that run's
  output.
