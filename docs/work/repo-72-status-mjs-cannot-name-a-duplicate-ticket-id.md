---
id: repo-72
tool: repo
title: status.mjs detects a duplicate ticket id but cannot name it
kind: fix
status: ready
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

## Log

- 2026-09-27 — Filed on the coordinator's instruction, from the #300 CI
  incident (run 36340116984) that exposed it: a real `repo-66` id collision
  between this branch and `main`'s #301. Reproduced independently with a
  disposable `--root` fixture, above. Not fixed here, per instruction.
