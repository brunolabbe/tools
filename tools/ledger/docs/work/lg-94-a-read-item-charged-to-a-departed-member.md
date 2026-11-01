---
id: lg-94
tool: ledger
title: A read item charged to a departed member is filed to the first current other
kind: fix
status: needs-decision
milestone: null
depends_on: [lg-90]
difficulty: standard
---

# lg-94 — A read item charged to a departed member is filed to the first current other

## Why

An item that a receipt's proposal marks as someone else's, and charges to a person
who has since left the household, is shown and filed as the first current other,
with nobody having chosen it. The screen gives no sign of it: the item's share
button reads the substitute's name, and nothing on the form says the original
charge was dropped.

The code is `whose`, a closure inside the `Receipts` component in
`tools/ledger/web/src/receipts/Receipts.tsx` (on `main` at `686b213c`, line 591):

```ts
const whose = (item: ItemDraft): string | null =>
  !several
    ? null
    : item.chargedTo !== null && others.includes(item.chargedTo)
      ? item.chargedTo
      : other;
```

A `chargedTo` that is not among the current `others` falls through to `other`.
`itemOf` (line 180) takes the answer for a `theirs` item (line 195), so the request
carries the substitute's name, or `null` when there are only two members, which the
API reads as that one other member. `whose` predates lg-90.

lg-90's Build step 2 (branch `lg-90-shared-item-checkbox`, PR #724) says a charge to
someone is always the person's choice, never a default. lg-90 applies that to
unchecking an item, and its brief does not reach a charge that a read brings in.
The finding was raised by lg-90's gate 1 (Opus 5.5), which recorded it as dropped
(outside the diff) and carried it to the owner as an open decision on 2026-11-01.
The owner chose to file it as this ticket.

**lg-90 rewrites the share control in `Receipts.tsx`**, so this ticket is built
after lg-90 merges (`depends_on: [lg-90]`). At PR #724's current head,
`bb4968240a0499ba26e14cbeb57be28022d67924`, `whose` is unchanged, which was checked
by reading that head's file. Its diff to `Receipts.tsx` is wider than the control:
the share cycle (`NEXT_SHARE`), the `Stage` type, an import, the file's header
comment, and the item row around the share button. Rebase or merge onto it
rather than onto `main`'s lines.

### Is this reachable today? No, not from the app as built

The probe below feeds a `theirs` item with a `chargedTo` through a mocked read,
which is a response shape the current reader never produces. Read on `main` at
`686b213c`:

- **The reader never proposes a charge.** `toItem` in
  `tools/ledger/receipts/src/reader.ts` (line 180) sets `share: "shared"` and
  `chargedTo: null` on every item (lines 192–193), and its comment says "every item
  is `shared`: which are not is the person's to say". `RECEIPT_PROMPT` in the same
  file does not mention a share or a person.
- **The API stores nothing on a read.** `readReceipt` in
  `tools/ledger/api/src/receipts.ts` (line 239) runs the reader, checks the
  proposals and returns them. Its own doc says "nothing is stored".
- **No stored draft.** No `localStorage` or `sessionStorage` in `tools/ledger/web/src`.
  The queue (`useReceiptQueue` in `web/src/receipts/Queue.tsx`) is in memory.
- **No re-opened receipt.** `readReceipt` refuses a receipt with a filing
  (`RECEIPT_ALREADY_FILED`), and no route returns a stored filing to the web.
  `storedFiling` (`api/src/receipts.ts` line 182) is called only from
  `api/test/schema.test.ts`.

So today a read item reaches `whose` with `chargedTo: null` and `share: "shared"`,
and it can become `theirs` only by the person's own tap, from a current member.
The defect is latent. It becomes live when the reader or a stored draft starts to
propose a share or a charge.

### Reproduction

Run on `main` at `686b213c` (the branch's base), 2026-11-01. No source was changed.
The gate's `probe-tail.tsx` could not run here: it calls helpers from lg-90
(`sharedBox`, `whoseSelect`, `leaveOut`, `optionsOf`) that `main` does not have.
So the probe was adapted to `main`'s share button, which is named
`<item>, <label>`, and kept to the departed-member cases (its section B).

The probe file is appended to a copy of `web/test/receipts.test.tsx`, run, and
removed from the test tree in the same script. Its departed-member part:

```tsx
async function readBasketCharged(chargedTo: string | null): Promise<void> {
  vi.mocked(readReceipt).mockResolvedValue({
    receiptId: 3,
    model: "claude-haiku-5-5",
    proposals: [
      {
        proposal: {
          ...BASKET,
          items: BASKET.items.map((item) =>
            item.text === "BIERE 6X355" ? { ...item, share: "theirs" as const, chargedTo } : item,
          ),
        },
        flags: [],
        merchantCategoryId: null,
      },
    ],
  });
  await takePhoto();
  fireEvent.click(await screen.findByRole("button", { name: "Read it" }));
  await waitFor(() => expect(field("Total").value).toBe("24.76"));
}

test.each([
  ["one+left dana", ["alex"], ["dana"], "dana"],
  ["two+left dana", ["alex", "sam"], ["dana"], "dana"],
  ["three+left dana", ["alex", "casey", "sam"], ["dana"], "dana"],
  ["three, read null", ["alex", "casey", "sam"], [], null],
])("LG94 departed: %s", async (name, members, left, chargedTo) => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(members, left));
  await readBasketCharged(chargedTo);
  // then: the item's share button, its "Whose is" select if rendered, the live
  // line, and the items the mocked fileReceipt was called with
});
```

Command and output:

```
$ bash <scratch>/lg-94/build/probe-main.sh      # cat receipts.test.tsx + probe; npx vitest run <probe> -t LG94; rm probe
 Test Files  1 passed (1)
      Tests  4 passed | 39 skipped (43)
exit 0
```

The records, one per case, as the probe wrote them:

```
B one+left dana button="BIERE 6X355, The other's" select=none live="Not shared 0.00 $ · The other's 15.54 $ · Shared 9.22 $" hint=["There is nobody else in the household to charge an item to."] filed=NOT FILED, alert="There is nobody else in the household to charge an item to."
B two+left dana button="BIERE 6X355, sam's" select=none live="Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs",null],["SAVON","shared",null]]
B three+left dana button="BIERE 6X355, casey's" select=value="casey" shows="casey" options=["casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
B three, read null button="BIERE 6X355, casey's" select=value="casey" shows="casey" options=["casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
```

Read against the gate's measurements:

- **Three current members, charged to dana:** the select shows casey, and the request
  carries `theirs` with `"casey"`. Reproduced.
- **Three members, read item charged to nobody:** it files casey. Reproduced.
- **Two current members, charged to dana:** the request carries `theirs` with `null`,
  which the API reads as sam. Reproduced. The gate also said "the select shows sam".
  That is lg-90's tree. On `main` a household of two has **no** select: the select
  renders only with more than one other member (`several && item.share === "theirs"`,
  line 830), so the item reads `sam's` and nothing shows the choice.
- **One current member, charged to dana:** the form refuses to file, with
  `NOBODY_ELSE` on screen. That is correct, and it is the one case that is not
  silent.

## Decision — open

**Open: what a read item's charge to a departed member should do.** Nothing in
the app produces this input today (see Why), so the choice is about the rule the
code should follow, not about a live bug.

1. **Refuse to file until a current member is picked, with no default.** A departed
   charge shows as unpicked, the select gets an empty first option, and the form
   says which item needs a person, as `unfileable` already does for NOBODY_ELSE.
   This is the rule lg-90's Build step 2 states. _Recommended._ Cost: a new refusal
   line and an empty option in the select. Open sub-question: with exactly one
   current other, the lg-30 path makes the request name nobody, and that is a
   default too. Does this option cover that case, or only three or more members?
   Changes the lg-30 tests that pin the two-person path.
2. **Keep the substitution, and say it on the item.** The button reads, for
   example, `dana's, no longer a member: sam's`, with a hint, and the filing still
   goes to the current other. Cost: still a default, now visible. The smallest
   change, and the amounts stay as they are.
3. **File the departed charge as not shared.** The item stays with whoever paid,
   with a hint. Cost: the money moves to the payer, a reading that is wrong if the
   person meant the other member, and the live line changes under the reader.
4. **Leave it as it is, and close the ticket as latent.** Cost: nothing changes
   today, since no path reaches it. Whoever later makes the reader propose shares,
   or stores a draft, inherits a silent substitution, with no ticket pointing at it.

Difficulty is rated for the work once answered: the change is contained to `whose`,
`itemOf`'s caller, `unfileable` and the select in `Receipts.tsx`, but the owner's
answer carries the judgement (`standard`).

## Done when

1. The owner's answer is recorded under `## Decision — answered <date> by <who>`,
   with the option chosen, before any source changes. Status becomes `ready` in
   the commit that records it.
2. Each of the four cases in Reproduction behaves as the chosen option says, and
   a test in `web/test/receipts.test.tsx` pins each one. Under option 1, each
   test fails on `main` at `686b213c`, and the probe's `B` records show the
   behaviour the test asserts.
3. The fix is built after lg-90 merges, and the branch is rebased or merged onto
   the lg-90 result (`depends_on: [lg-90]`), with line numbers re-resolved against
   the merged file.
4. `npm run check` and `npm test -- --project ledger` pass.

## Log

**2026-11-01, filed by a builder (maintenance dispatch, lg-94, base `686b213c`).**

- Source read: `whose` (`web/src/receipts/Receipts.tsx` line 591), `itemOf` (line 180,
  line 195), the select (line 830), `unfileable` (lines 665–670). `whose` gives the
  first current other for any charge outside `others`.
- Build: `npm run build` exit 0 at `686b213c` after `worktree-farm.sh`.
- Probe (see Reproduction): four cases, exit 0, `Tests 4 passed | 39 skipped (43)`.
  The gate's probe tail does not run on `main`; the adapted one is recorded here.
- Reachability, from `grep` on `686b213c`:
  - `grep -n 'share: "shared"\|chargedTo: null' tools/ledger/receipts/src/reader.ts`
    gives `192:    share: "shared",` and `193:    chargedTo: null,`.
  - `grep -n 'theirs\|share' tools/ledger/receipts/src/reader.ts` gives no line that
    sets a share other than `shared`.
  - `grep -rln 'localStorage\|sessionStorage' tools/ledger/web/src` gives nothing.
  - `grep -rn 'storedFiling(' tools/ledger/api/src` gives only its definition at
    `api/src/receipts.ts:182`.
- lg-90's PR #724 has moved: its head is now `bb4968240a0499ba26e14cbeb57be28022d67924`,
  not `a2ab1d56` as the gate read it. `whose` is unchanged there
  (`git show origin/lg-90-shared-item-checkbox:tools/ledger/web/src/receipts/Receipts.tsx`,
  `589: const whose = (item: ItemDraft)`, the same expression).
- The gate's two-member reading ("the select shows sam") describes lg-90's tree;
  on `main` there is no select for a household of two (see Reproduction).
