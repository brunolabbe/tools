---
id: lg-57
tool: ledger
title: Refuse C1 controls and zero-width characters in a member's address
kind: fix
status: ready
milestone: null
depends_on: [lg-52]
difficulty: standard
---

# lg-57 — Refuse C1 controls and zero-width characters in a member's address

## Why

lg-52 refuses the C0 controls (`\u0000` to `\u001f`) and DEL (`\u007f`) in a
member's address, in `ADDRESS` in `api/src/directory.ts`, and leaves a wider set
to this ticket on purpose: its Build item 2 says the floor is C0 and DEL only,
and its Decision section records the owner's answer to how wide the refusal is.
The set left is the C1 controls (`\u0080` to `\u009f`) and the zero-width
characters (`​` to `‍`, and `﻿`). None of them is visible in a
member list or an email client, and no Access token can be expected to carry
one, so an address that holds one is a directory row nobody can sign in as, the
same outcome lg-52 describes for a NUL.

lg-52's gate 1 found that `readAddress` accepts two of them today, in its F5:
"Build item 2 leaves 'whether to refuse more than that' (C1 controls such as
`\u0085`, zero-width such as `​`) as 'the builder's to measure and report',
in prose." The owner's decision of 2026-10-18 was to leave them out of lg-52 and
file them here. **The lock-out is lg-52's claim and is not measured here**; what
is measured is that `readAddress` returns the value.

## Reproduction

On `origin/main@9ec8943e`, in a worktree with the farm and `npm run build` done.
A terminal swallows `\u0085` and `​`, so the one-liner is piped through
`od -c`, which shows the bytes `302 205` (U+0085) and `342 200 213` (U+200B) in
the output. The whole set, from a script that writes every non-printable
character as `\uXXXX`:

```
$ node -e 'import("./tools/ledger/api/src/directory.ts").then((m) => console.log(JSON.stringify(m.readAddress("a\u0085@b.test")), JSON.stringify(m.readAddress("a​@b.test"))))' | od -c | head -3
0000000   "   a 302 205   @   b   .   t   e   s   t   "       "   a 342
0000020 200 213   @   b   .   t   e   s   t   "  \n
```

```
readAddress("a\u0085@b.test") => "a\u0085@b.test"
readAddress("a\u009f@b.test") => "a\u009f@b.test"
readAddress("a\u0080@b.test") => "a\u0080@b.test"
readAddress("a​@b.test") => "a​@b.test"
readAddress("a‌@b.test") => "a‌@b.test"
readAddress("a‍@b.test") => "a‍@b.test"
readAddress("a﻿@b.test") => undefined
readAddress("a@b.test") => "a@b.test"
```

**`﻿` is already refused**, and not by anything this ticket adds: it is
White_Space in JavaScript's `\s`, which `ADDRESS` already excludes. It is named
here because the owner's set names it, and so that a build does not conclude it
has work to do for it.

## Build

It extends lg-52's single `ADDRESS` change, in the same place, so that every
writer lg-52 lists inherits it: `Directory.addMember` (the admin route, the
member route and the host `member` verb) and `LEDGER_ADMINS` through
`readAddress`. **Do not add a second check beside `readAddress` in any caller**,
as lg-52's item 1 says.

**lg-52's Decision answers apply unchanged:** removal still matches a stored row
without the new check (its Build item 4), so a directory that already holds an
address with one of these characters can still have it removed, and no schema
trigger and no migration is added.

1. Extend `ADDRESS` to refuse `\u0080` to `\u009f`, `​` to `‍` and
   `﻿`. Refuse nothing else: this ticket names the set and does not widen
   it.
2. A test per refusal, written to fail on `main` first, in the shape of lg-52's
   item 3: `readAddress` and `addMember` with `\u0085`, `\u009f`, `​` and
   `‍` are refused `BAD_REQUEST` "That is not an email address."; the same
   through each of the two routes; the host command's `member` exits non-zero;
   a `LEDGER_ADMINS` entry carrying one stops the boot. `﻿` is already
   refused, so its test cannot fail first: say so, and keep it as a guard.
3. Name what proves a clean address still passes: `readAddress("a@b.test")`,
   and an ordinary non-ASCII letter (`readAddress("é@b.test")`), so that a
   change refusing everything outside ASCII cannot pass.
4. A row holding one of these characters, inserted past `Directory`, is removed
   by `removeMember` and by the host `remove` verb with the tightened `ADDRESS`
   in place, as lg-52's item 4 does for a NUL.

## Done when

- `readAddress` returns `undefined` for an address carrying any character in
  `\u0080` to `\u009f`, `​` to `‍` or `﻿`, and still returns
  `a@b.test` and `é@b.test` (a directory test).
- `POST /api/admin/households/:id/members` and
  `POST /api/households/:id/members` answer `400` for one, and no row is written.
- The host command's `member` verb exits non-zero for one and writes no row.
- A `LEDGER_ADMINS` entry carrying one stops the boot.
- A row holding one, inserted past `Directory`, is removed by `removeMember` and
  by the host `remove` verb.
- lg-52 is on `main` first; this ticket changes `ADDRESS` after it.

## Log

- 2026-10-18 — Filed at the owner's decision of 2026-10-18, from lg-52's gate 1,
  F5: the C1 controls and the zero-width characters, left out of lg-52 so that it
  stays at C0 and DEL. Reproduced on `origin/main@9ec8943e` before filing: the
  output is above, and `﻿` is the one of the set that is already refused.
  Nothing was built.
