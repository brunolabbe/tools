---
id: lg-94
tool: ledger
title: A read item charged to a departed member is filed to the first current other
kind: fix
status: done
milestone: null
depends_on: [lg-90]
difficulty: standard
---

# lg-94 — A read item charged to a departed member is filed to the first current other

## Why

An item that a receipt's proposal marks as someone else's, and charges to a person
who has since left the household, is shown and filed as the first current other,
with nobody having chosen it. The form says nothing about the original charge being
dropped.

On `main` (`686b213c`) the code is `whose`, a closure inside the `Receipts` component
in `tools/ledger/web/src/receipts/Receipts.tsx` (line 591):

```ts
const whose = (item: ItemDraft): string | null =>
  !several
    ? null
    : item.chargedTo !== null && others.includes(item.chargedTo)
      ? item.chargedTo
      : other;
```

A `chargedTo` that is not among the current `others` falls through to `other`.
`itemOf` (line 180) takes that answer for a `theirs` item (line 195), so the request
carries the substitute's name, or `null` when there are only two members, which the
API reads as that one other member. `whose` predates lg-90.

lg-90's Build step 2 (branch `lg-90-shared-item-checkbox`, PR #724) says a charge to
someone is always the person's choice, never a default. lg-90 applies that to
unchecking an item, and its brief does not reach a charge that a read brings in.
lg-90's gate 1 (Opus 5.5) recorded this as dropped (outside the diff) and carried it
to the owner as an open decision; the owner chose on 2026-11-01 to file it here.

### What lg-90 changes in `Receipts.tsx`

lg-90 rewrites the share control, so this ticket is built after lg-90 merges
(`depends_on: [lg-90]`). Read with `git diff -U0 686b213c bb4968240a0499ba26e14cbeb57be28022d67924`
(PR #724's landed head), not run. It prints five hunks, which make six changes (the
third hunk both deletes `NEXT_SHARE` and `nextShare` and adds `MINE`):

- the file's header comment;
- an import, `sharedAmount`;
- `NEXT_SHARE` and `nextShare`, the tap cycle, deleted;
- `MINE`, added as `""`: the `Whose is` value for not-shared, which the contract
  cannot take as a person id;
- the `shareLabel` doc comment;
- the item row: the share button becomes a Shared checkbox and a `Whose is` select.

`whose`, `itemOf` and `unfileable` are not in its diff. At that head the select's
value is `item.share === "not-shared" ? MINE : (whose(item) ?? other ?? "")`, so with
two members a departed charge makes the select show the substitute as the chosen
value. The disabled `Someone else's` option renders only for a `theirs` item in a
household of one. Rebase or merge onto lg-90's result, not onto `main`'s line numbers.

### Is this reachable today? No, not from the app as built

The probe below feeds a `theirs` item with a `chargedTo` through a mocked read, a
response shape the current reader never produces. Read on `main` at `686b213c`:

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
and it becomes `theirs` only by the person's own tap, from a current member. The
defect is latent: it becomes live when the reader or a stored draft starts to propose
a share or a charge.

### Reproduction

Rewritten 2026-11-01 against the select the screen has now: the first version looked for
share buttons (`NEXT_SHARE`), which lg-90 removed. Run on `main` at `bd95ab0b` (lg-90 and
lg-91 merged), from the repository root. The command reads the probe from this ticket,
appends it to a copy of `web/test/receipts.test.tsx` (which defines `household`,
`takePhoto`, `BASKET` and `field` on `main`), runs the `LG94` tests, prints the records
and removes its own files. It names no scratch path. Its helpers are `lg94`-prefixed, so
it also runs on the fixed tree, where the records read as the fix makes them (the
fixed tree's records are in the Log).

The probe is a recorder, not a verdict: each case appends one record to `LG94_OUT`,
and the records are the reading. Its last test fails if fewer than four were written.

````sh lg94-run
export LG94_OUT=lg94-probe.out
rm -f "$LG94_OUT"
{ cat tools/ledger/web/test/receipts.test.tsx; awk '/^```tsx lg94-probe$/{f=1;next} /^```$/{f=0} f' tools/ledger/docs/work/lg-94-a-read-item-charged-to-a-departed-member.md; } > tools/ledger/web/test/lg94-probe.test.tsx
npx vitest run tools/ledger/web/test/lg94-probe.test.tsx -t LG94; echo "vitest exit $?"
rm -f tools/ledger/web/test/lg94-probe.test.tsx
cat "$LG94_OUT"
rm -f "$LG94_OUT"
````

The probe, which the command extracts from the block below:

```tsx lg94-probe
// ---- LG94 probe (lg-94): a recorder, not a verdict. Each case appends one record to
// LG94_OUT; the records are the reading. The last test checks all four were written.
import { appendFileSync, readFileSync } from "node:fs";

const LG94_OUT = process.env.LG94_OUT ?? "lg94-probe.out";

function lg94Filed(): string {
  const filed = vi.mocked(fileReceipt).mock.calls.at(-1)?.[1];
  return JSON.stringify(
    filed?.proposal.items.map((item) => [item.text, item.share, item.chargedTo]),
  );
}

// A read item someone else's, charged to a person who has left (or to nobody).
async function lg94Read(chargedTo: string | null): Promise<void> {
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
  ["C0 one+left dana", ["alex"], ["dana"], "dana"],
  ["C1 two+left dana", ["alex", "sam"], ["dana"], "dana"],
  ["C2 three+left dana", ["alex", "casey", "sam"], ["dana"], "dana"],
  ["C3 three, read null", ["alex", "casey", "sam"], [], null],
])("LG94 departed: %s", async (name, members, left, chargedTo) => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(members, left));
  await lg94Read(chargedTo);
  const select = screen.getByLabelText("Whose is BIERE 6X355") as HTMLSelectElement;
  const hints = [...document.querySelectorAll("p.hint.bad")].map((node) => node.textContent);
  const live = screen.getByLabelText("What is shared").textContent;
  const shows = JSON.stringify(select.selectedOptions[0]?.text ?? null);
  const options = JSON.stringify([...select.options].map((option) => option.text));
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  let filed: string;
  try {
    await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1), { timeout: 500 });
    filed = lg94Filed();
  } catch {
    filed = `NOT FILED, alert=${JSON.stringify(screen.queryByRole("alert")?.textContent ?? null)}`;
  }
  appendFileSync(
    LG94_OUT,
    `B ${name} select shows=${shows} options=${options} live="${live}" hint=${JSON.stringify(hints)} filed=${filed}\n`,
  );
});

test("LG94 wrote all four records", () => {
  const written = readFileSync(LG94_OUT, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("B "));
  expect(written).toHaveLength(4);
});
```

Output of the command, at `bd95ab0b` (the probe's own tests: `Tests 5 passed`):

```
 Test Files  1 passed (1)
      Tests  5 passed | 57 skipped (62)
vitest exit 0
B C0 one+left dana select shows="Someone else’s" options=["Someone else’s","Mine"] live="Not shared 0.00 $ · The other's 15.54 $ · Shared 9.22 $" hint=["There is nobody else in the household to charge an item to."] filed=NOT FILED, alert="There is nobody else in the household to charge an item to."
B C1 two+left dana select shows="sam" options=["Mine","sam"] live="Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs",null],["SAVON","shared",null]]
B C2 three+left dana select shows="casey" options=["Mine","casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
B C3 three, read null select shows="casey" options=["Mine","casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
```

Read:

- **C2, three current members, charged to dana:** the select shows casey, and the request
  carries `theirs` with `"casey"`. Reproduced on `main`.
- **C3, three members, read item charged to nobody:** nobody has departed in it. It files
  casey. Reproduced on `main`; the owner's answer (Question 3 (a)) refuses it too.
- **C1, two current members, charged to dana:** the select shows sam and the request carries
  `theirs` with `null`, which the API reads as sam. Reproduced on `main`. The first version
  of this ticket said a household of two has no select on `main`; that was `main` before
  lg-90. It has one now, with the options `Mine` and `sam`.
- **C0, one current member, charged to dana:** the form refuses to file, with
  `NOBODY_ELSE` on screen. That is correct, and it is the one case that is not silent.

## Build

Option 1 (Decision, answered 2026-11-01), built on `main` with lg-90 and lg-91 merged,
in `web/src/receipts/Receipts.tsx`: `whose` (non-joint branch), a new `unpicked`
predicate, `unfileable`, and the lg-90 select. Scope is the card destination's select;
the joint select and joint-row behaviour are lg-91's and unchanged. Line numbers are
not kept here, since they move; the names are the map. The Reproduction probe runs on
the fixed tree too (its helpers are `lg94`-prefixed).

## Decision — answered 2026-11-01 by the owner

**Question 1 — answered: what a read item's charge to a departed member should do.**
Chosen: **option 1, refuse to file until a current member is picked, with no
default** (the recommendation), from the five options listed below (1 refuse; 2 keep
the substitution and say it; 3 file as not shared; 4 leave it and close as latent;
5 keep the charge on the departed member).

**Question 3 — answered: does option 1 also refuse a `theirs` item charged to nobody
(C3: three current members, alex paying, casey and sam; the reader marks an item
`theirs` with no name, and `main` silently files casey)?** The options were (a)
refuse C3 too: the same unpicked state and refusal, nobody preselected when there are
two or more others, matching the rule that with more than one other member a `theirs`
item must name one (recommended); (b) keep C3 as is, with Done when 2 pinning `main`.
Chosen: **(a)**. Done when 2's C3 line is reworded below; the line it supersedes is
left beside it.

The five options as they were put, for the record. Nothing in the app produces this
input today (see Why), so the choice was about the rule the code should follow, not
about a live bug. Costs for the options that touch lg-90's control were read from
`bb4968240a0499ba26e14cbeb57be28022d67924` and were not run; lg-90 has since merged
(8b1a88e0, #724).

1. **Refuse to file until a current member is picked; no default.** The select shows
   an unpicked state whose value is neither `MINE` (`""`) nor any person id, so the
   item cannot read as Mine. `whose` returns `null` for a departed charge, `unfileable`
   names the item, and filing sends nothing. This is the rule lg-90's Build step 2
   states, and it covers two members too, since lg-90's select renders for two.
   Cost, not priced on lg-90's tree: a second sentinel, checked against the contract's
   person-id shape (`chargedTo` is `z.string().min(1).max(100)`, and lg-90's gate 1
   recorded a 1–64 character id); a new refusal line; and the disabled `Someone else's`
   option, which sits in the same select for a household of one, needs reconciling
   with the unpicked state.
2. **Keep the substitution, and say it beside the select.** The select keeps showing
   the current other, with a hint such as `dana has left: this is sam's now`, and
   filing is unchanged. Cost: still a default, now visible. lg-90's control has no
   share button, so the name would appear in the hint. Whether the name map resolves a
   departed id (`shownName`) is not checked.
3. **File the departed charge as not shared.** The select shows Mine, with a hint such
   as `dana has left: this stays with alex`, and the item files `not-shared`. Cost: the
   money moves to the payer, and a person who meant the other member is charged
   nothing; the amounts change under the reader.
4. **Leave it as it is, and close the ticket as latent.** Cost: nothing changes today,
   since no path reaches it. Whoever later makes the reader propose shares, or stores a
   draft, inherits a silent substitution, with no ticket pointing at it.
5. **Keep the charge on the departed member.** The filing keeps `chargedTo` as the
   departed name. lg-30's brief allows this: a name "need not be a current member, so a
   charge to someone who has since left stays possible and the screen offers current
   members only". The select must then show a name it does not offer, which needs an
   extra option labelled as departed, since a select value with no option renders as
   its first option. Cost: the select lists a name that is not a member, and the line
   is owed by someone no longer in the household. The server accepts it: `chargedToOf`
   in `api/src/receipts.ts` (line 512) checks a named `chargedTo` with
   `requireKnownPerson` against `context.people`, which `ruleContext` builds from
   `knownPeople` (`api/src/people.ts`, every row of the books' `people` table, a retired
   person included), and returns it without checking the current members. Read, not run.
   With one member the filing cannot name it: at lg-90's head `unfileable` (line 667)
   refuses a `theirs` item whenever the household is `alone`, whatever `chargedTo` is,
   so C0 stays refused unless option 5 also changes `unfileable`. Read, not run.

Difficulty is rated for the work once answered: the change is contained to `whose`,
`itemOf`'s caller, `unfileable` and the select in `Receipts.tsx`, but the owner's
answer carries the judgement (`standard`).

**Question 2 — answered 2026-11-01 by the owner: should "keep the charge on the
departed member" be among the options?** The two answers offered were (a) list it,
with its cost, or (b) say why it is excluded. Chosen: (a). It is option 5 above.

## Done when

1. The owner's answer to Question 1 is recorded under `## Decision — answered <date> by <who>`,
   with the option chosen and the options it was chosen from, before any source change.
   Status becomes `ready` in that commit. Option 4 closes the ticket on this line alone.
2. Under the option chosen, its test in `web/test/receipts.test.tsx` asserts, for each
   of the four labelled records in Reproduction (the `test.each` names, and so the
   printed records, carry the labels): C0 `one+left dana`, C1 `two+left dana`, C2
   `three+left dana` and C3 `three, read null`. C0 to C2 each have dana departed;
   nobody has departed in C3. "Fails on `main`" is read off the records printed there.
   - Option 1: the select shows the unpicked state, and `fileReceipt` is not called.
     - C1, C2: as stated. Fail on `main`, which file the substitute.
     - C0: the refusal (`NOBODY_ELSE`, nothing filed) is pinned unchanged. Passes on
       `main`, since its refusal is already there.
     - C3 (answered 2026-11-01 by the owner, Question 3 (a)): the select shows the
       unpicked state and `fileReceipt` is not called, as for C1 and C2. Fails on
       `main`, which files `theirs` with `casey`.
     - ~~C3: the option as written covers a charge to a departed member, and C3 has
       none, so C3 pins `main`'s reading (files `theirs` with `casey`) and passes on
       `main`.~~ Superseded by the line above.
   - Option 2: a hint names the departed member and the current one the charge falls
     to, and filing is unchanged.
     - C1, C2: as stated (`dana has left`, and `sam` or `casey`). Fail on `main`, which
       shows no hint.
     - C0: no current member for the charge to fall to, so the refusal is pinned
       unchanged. Passes on `main`.
     - C3: no hint, filing unchanged (`casey`). Passes on `main`.
   - Option 3: the select shows Mine, a hint shows, and the item files `not-shared`
     with `chargedTo: null`.
     - C0, C1, C2: as stated. Fail on `main`; for C0 this replaces the refusal with a
       filing, which is the option's cost for a household of one.
     - C3: no hint, files `theirs` with `casey`. Passes on `main`.
   - Option 5: the select keeps the departed name and the filing names it.
     - C1, C2: as stated, `chargedTo: "dana"`. Fail on `main`.
     - C0: the filing cannot name it, because `unfileable` refuses a `theirs` item
       whenever the household is alone (see option 5's cost). The refusal is pinned
       unchanged and passes on `main`, unless option 5 also changes `unfileable`.
     - C3: no extra option, files `theirs` with `casey`. Passes on `main`.

   Option 4 has no test.

   The tests for options 1–3 and 5 can only be run after lg-90 merges, against the
   merged file; the `main` reading in Reproduction is the only reading taken before
   then.

3. The fix is built after lg-90 merges, rebased or merged onto lg-90's result, with
   line numbers re-resolved against the merged file. Not applicable to option 4.
4. `npm run check` and `npm test -- --project ledger` pass. Not applicable to option 4.

## Review

**Gate: CONCERNS** — 2026-11-01 · `bd95ab0b..b09aadd2` · Opus 5.5, depth standard

| Done when                                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Owner's answer recorded under `## Decision — answered <date> by <who>`, options listed, `ready` in that commit, before any source change | **verified** by reading: `779f6269` touches only the ticket, sets `status: ready`, carries `## Decision — answered 2026-11-01 by the owner` with option 1 chosen from options 1–5 and Question 3 (a); the source commit `b09aadd2` follows it                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2. Option 1: C1, C2, C3 show the unpicked state and `fileReceipt` is not called; C0's `NOBODY_ELSE` refusal pinned                          | `web/test/receipts.test.tsx` › "a read item charged to someone who has left, or to nobody, files nothing until a current member is picked: C1 two+left dana / C2 three+left dana / C3 three, read null (lg-94)" ✓ (`selectedOptions[0].text` is `Whose?` and `disabled`, the alert is `UNPICKED_CHARGE`, `fileReceipt` not called); › "with nobody else, a read charge to someone who has left is refused as before (lg-94 C0)" ✓ (alert `NOBODY_ELSE`, not called). Positive control: reverting the `unfileable` clause fails C1–C3 (3 of 3); reverting `whose`'s fallback fails C2 and C3. "Fails on `main`": the gate's probe at `bd95ab0b` source files `sam`/`null` (C1) and `casey` (C2, C3) |
| 3. Built after lg-90 merged, line numbers re-resolved                                                                                       | **verified**: `8b1a88e0` (lg-90) and `a5f4acf2` (lg-91) are ancestors of the base `bd95ab0b`; the Build section names symbols, not lines                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4. `npm run check` and `npm test -- --project ledger` pass                                                                                  | **verified**: check exit 0; ledger `99 passed (99)` files, `2179 passed (2179)` tests. PR #744 CI at `b09aadd2`: every check green, `test (windows-latest, informational)` included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- **med** · no `Done when` line depends on it · open decision · A read `theirs` item that
  is unpicked because it names nobody (C3) or the payer is filed `not-shared` after
  "Paid with the joint card?" then "Paid with my own card", with no pick: `payMyself` (lg-91)
  turns every `theirs` item charged to `null` or the payer into Mine. Measured at
  `b09aadd2`, three current members: refused before, `Mine` after, filed
  `["BIERE 6X355","not-shared",null]`. The mechanism is lg-91's and the same round trip lands
  on Mine at the base, but it defeats option 1's rule that the item "cannot read as Mine"; a
  departed or unknown name survives the round trip (stays unpicked). Graded `med` rather than
  `low` (no live call site) because the whole ticket governs this latent input and the owner
  chose option 1 to prevent exactly this outcome.
- **low** · Stale alert: after a refused tap the alert stays once the form is fileable.
  Pre-existing on `main` for `NOBODY_ELSE` (measured at the base source). The branch adds
  `UNPICKED_CHARGE` to the same path, and after a refused joint attach then "Paid with my own
  card" the stale `NOBODY_CHOSEN` alert ("a joint-account purchase has no payer") shows beside
  the `UNPICKED_CHARGE` hint. `unfileable` itself never holds both.
- **low** · `UNPICKED_CHARGE` says "charged to someone who has left, or to nobody", which is
  false for a read naming the payer or a name the books never held; false in the safe
  direction (the refusal holds, the reason is misnamed).
- **low** · unverified, read not run · In a household of two the live line reads
  `Whose not chosen yet` for the whole charged amount whenever any item is unpicked, including
  another item that is the one other member's. Display only; filing is refused.
- **dropped** · `""` shared by `Whose?` and Mine filing `not-shared` silently: no direct path
  does it. Across 20 read cells (households of 1–4 × current other, payer, departed, no name,
  unknown) every unpicked select shows `Whose?` and refuses; only an explicit pick of Mine
  files `not-shared`. The round trip above is the one path, carried as the `med`.
- **dropped** · Shared checked then unchecked turns an unpicked item into Mine: lg-90's stated
  rule ("unchecked starts on Mine"), the person's own tap on the item.
- **dropped** · a read naming the payer files as owed to the pot by the payer once paid jointly:
  lg-91's rule, the payer is a member there.
- **findings** · the hunt returned 7; 4 carried, 3 dropped.
- NFR: security n/a (no input reaches a URL or a log) · performance n/a · reliability — the
  `med` above · maintainability ✓ (two `""` options rely on React matching the first; the code
  says so, and `Someone else's` and `Whose?` cannot render together). Layout: one short option
  added to an existing select, no new screen; ledger `e2e` green on CI at `b09aadd2`, not run
  locally.

### Gate 2

**Gate: PASS** — 2026-11-01 · `b09aadd2..6a294daa` · Opus 5.5, depth standard, scoped to the round (`500881b1`, `6a294daa`)

| Done when                                                                                                                                   | Proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Owner's answer recorded under `## Decision — answered <date> by <who>`, options listed, `ready` in that commit, before any source change | **verified** by reading; the round's commits touch only `## Log` of the ticket, and the Decision and `status: ready` are as gate 1 read them                                                                                                                                                                                                                                                                                                                                       |
| 2. Option 1: C1, C2, C3 show the unpicked state and `fileReceipt` is not called; C0's `NOBODY_ELSE` refusal pinned                          | `web/test/receipts.test.tsx` › "a read item charged to someone who has left, or to nobody, files nothing until a current member is picked: %s (lg-94)" ✓ (C1–C3: `Whose?`, alert is the new `UNPICKED_CHARGE`, `fileReceipt` not called); › "with nobody else, a read charge to someone who has left is refused as before (lg-94 C0)" ✓. `-t lg-94`: 10 of 10 pass. Gate 1's 20-cell probe at the head gives the same 20 records as at `b09aadd2`, apart from the new refusal text |
| 3. Built after lg-90 merged, line numbers re-resolved                                                                                       | **verified**: the round adds no merge; lg-90 and lg-91 are still ancestors of the base                                                                                                                                                                                                                                                                                                                                                                                             |
| 4. `npm run check` and `npm test -- --project ledger` pass                                                                                  | **verified**: check exit 0; ledger `99 passed (99)` files, `2183 passed (2183)` tests (gate 1: 2179; the round adds 4, deletes none, and changes one constant to the new text). PR #744 CI at `6a294daa`: all 10 checks `SUCCESS`, `test (windows-latest, informational)` and ledger `e2e` included                                                                                                                                                                                |

Gate 1's findings:

- **med, the joint round trip** · **fixed**. Across gate 1's 20 cells × 8 sequences (160 records), the outcome after one and after two joint round trips matches the no-round-trip outcome in every cell. Every pick goes where it was picked. Positive control: with `!item.asRead &&` removed from `payMyself`, the two new round-trip tests fail (`2 failed | 8 passed`, `-t lg-94`), and 18 of the probe's 160 records flip to `Mine`.
- **low, the stale alert** · not fixed. The owner chose to record it (answer C).
- **low, the `UNPICKED_CHARGE` text** · **fixed**. The new text shows in 11 cells: households of 2–4 for a read naming the payer, a departed member or an unknown name, and households of 3–4 for no name. It is true in all 11. For the payer cell, "no other member" holds because the payer is not an _other_.
- **low, the household-of-two live line** · not fixed. The owner chose to record it (answer C).

New in the round:

- **low** · `nfr:maintainability` · Three behaviours of `asRead` have no test on the branch:
  - the builder's own counter-case: an item unchecked while paid jointly is Mine again on my own card;
  - a household of two with no name now stays the other member's through a round trip (answer A), where it used to land on Mine;
  - a household of one now stays refused `NOBODY_ELSE`, where it used to land on Mine.

  The probe shows all three behave correctly. A change to `payMyself` could break any of them and no test would fail.

- **low** · The test "a refusal's words are true for a name the books never held, the payer and a departed member alike (lg-94)" reads only `zed`. Its title claims more than its body asserts. No `Done when` line rests on it.
- **low** · The Log's round 1 entry describes gate 1's third low as "it reads `Whose not chosen yet` with one candidate". Gate 1's section says the line reads the whole charged amount as not chosen, an item that is the other member's included. The Log points to gate 1's section for the text. The stale-alert summary matches.
- **dropped** · "no other member" being false for a departed name (the code's comments say "a member who has left"): the household screen removes a member who leaves, so a person reads "member" as current.
- **dropped** · A pick is lost when the form is left for the queue and reopened. It is older than this branch: `backToQueue` drops the draft. The reopened part reads `Whose?` and refuses, which is the safe direction.
- **findings** · the hunt returned 5; 3 carried, 2 dropped. None is a `high`.
- NFR: security n/a · performance n/a · reliability ✓ (the gate 1 `med` is fixed) · maintainability — the first low above. Layout: no new control and no new screen; ledger `e2e` green on CI at `6a294daa`, not run locally.

## Log

**2026-11-01, filed by a builder (maintenance dispatch, lg-94, base `686b213c`).**

- Source read: `whose` (`web/src/receipts/Receipts.tsx` line 591), `itemOf` (line 180,
  line 195), the select (line 830), `unfileable` (lines 665–670). `whose` gives the
  first current other for any charge outside `others`.
- Build: `npm run build` exit 0 at `686b213c` after `worktree-farm.sh`.
- Probe: the four-case run recorded here reported `Tests 4 passed | 39 skipped (43)`,
  exit 0. That run used a scratch script that is not part of this ticket; round 1 below
  replaces it with the command in Reproduction.
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
- The gate's two-member reading ("the select shows sam") describes lg-90's tree; on
  `main` there is no select for a household of two.

**2026-11-01, round 1 (the narrow gate graded `0f65e8cb` FAIL with five findings; all five
accepted after reading the code, and fixed here).**

- **F1, reproduction recorded nothing and rested on a scratch file.** Fixed: the probe is
  inline in Reproduction, and the command extracts it from this ticket and names no
  scratch path. The probe writes one record per case, and its last test fails when fewer
  than four were written. Run from the repository root on this tree (`686b213c` plus the
  ticket): `Tests 5 passed | 39 skipped (44)`, `vitest exit 0`, the four `B` records shown
  in Reproduction. Positive control: those records diffed against the filer's earlier
  probe run, `diff` silent over 4 lines. Negative control: the count test alone, with no
  records file, `Error: ENOENT`, `Tests 1 failed | 43 skipped (44)`, `vitest exit 1`.
- **F2, Done when read three ways.** Fixed: Done when is per option. It states what each
  option's test asserts for cases C1 to C4, and which of them fail on `main`. C0 (one
  member) passes on `main` by design, since its refusal is already there. Option 4 closes
  on line 1 alone.
- **F3, options priced against `main`'s control.** Fixed: options 1 to 3 and 5 are restated
  against lg-90's select at `bb4968240a0499ba26e14cbeb57be28022d67924` (the value
  expression, `MINE` as `""`, the disabled `Someone else's` option for a household of one,
  and the Shared checkbox in place of the share button). Costs are read from that head,
  not run, and the Decision says so.
- **F4, a fifth option missing.** Added as option 5, "keep the charge on the departed
  member", with its cost. Recorded as **Question 2, answered 2026-11-01 by the owner**:
  the options offered were (a) list it, with its cost, or (b) say why it is excluded;
  chosen (a).
- **F5, the `Stage` claim.** Fixed: the Why lists the five hunks of lg-90's diff, read from
  `git diff -U0 686b213c bb496824`: the header comment, the `sharedAmount` import, the
  deletion of `NEXT_SHARE` and `nextShare`, the addition of `MINE`, the `shareLabel` doc
  comment (the hunk the gate's header `@@ -245 +243 @@ type Stage =` labels), and the item
  row. `Stage` is not among them.
- Also: a `## Build` section (absent before), and the empty `## Review` placeholder removed,
  since the format leaves that heading absent until the work is reviewed.

**2026-11-01, landing (gate 2 graded `a20392e7` CONCERNS, no `high`; the fixer applied F2
and F5 as stated, base `686b213c`, no third gate).**

- 2026-11-01 — Fixed at landing: gate 2, F2 — "label the four records with
  the labels Done when 2 uses, in the probe's test.each names and so in the printed
  records". The four records are now C0 `one+left dana`, C1 `two+left dana`, C2
  `three+left dana` and C3 `three, read null`, in the probe, in the printed output and in
  the "Read against" bullets. Done when 2 now says per option what each labelled case
  asserts, including C3 (nobody departed) and C0 under option 5, which `unfileable` keeps
  refused (read at lg-90's head, not run), now also in option 5's cost line; and "Option 4
  has no test." is on its own line. One departure from the stated direction: Done when 2
  used five labels (C0 to C4) for four records, so it now uses C0 to C3, and "C1 to C4"
  became "C1 to C3". Proof: `git diff a20392e7 HEAD -- tools/ledger/docs/work/lg-94-a-read-item-charged-to-a-departed-member.md | grep -c '^-.*departed case C1 to C4 in Reproduction'`
  gives `1`. The reproduction command was re-run from the repository root at this tree
  (`686b213c` plus the ticket, built): `Tests 5 passed | 39 skipped (44)`, `vitest exit 0`,
  the four `B C0` to `B C3` records now in Reproduction (`diff` against the ticket's
  `B` lines, silent); the count test alone with no records file, `Error: ENOENT`,
  `Tests 1 failed | 43 skipped (44)`, exit 1.
- 2026-11-01 — Fixed at landing: gate 2, F5 — "The Why lists six bullets,
  because the third hunk is both the NEXT_SHARE/nextShare deletion and the MINE addition".
  The Why now says "It prints five hunks, which make six changes", and names the third
  hunk's two. Proof:
  `git diff a20392e7 HEAD -- tools/ledger/docs/work/lg-94-a-read-item-charged-to-a-departed-member.md | grep -c '^-.*Its hunks change five things'`
  gives `1`; `git diff -U0 686b213c bb4968240a0499ba26e14cbeb57be28022d67924 -- tools/ledger/web/src/receipts/Receipts.tsx | grep -c '^@@'`
  gives `5`.
- Open, for the owner's answer to Question 1: whether option 1 also refuses a `theirs`
  item charged to nobody (C3). The option as written covers a departed charge only, so
  Done when 2 has C3 pin `main`'s reading under it.
- 2026-11-01 — Gate 1's and gate 2's full reports are on the pull request thread, #725;
  status unchanged (`needs-decision`; Question 1 is open for the owner).

**2026-11-01, build (branch `lg-94-refuse-unpicked-charge`, base `bd95ab0b`; lg-90 #724 and
lg-91 #734 merged).** Owner's answers (Question 1 option 1; Question 3 (a), C3 refused too)
recorded in the first commit, which also set `status: ready`.

- **What was built**, in `web/src/receipts/Receipts.tsx`:
  - `unpicked(item)`: not paid jointly, not alone, a `theirs` item whose `chargedTo` is not a
    current other. A `chargedTo` of `null` counts as unpicked only with more than one other.
  - The lg-90 select, for an unpicked item: a disabled `Whose?` option first, and the select's
    value `MINE` (`""`), which React matches to that first option, as it already does for
    `Someone else's` in a household of one.
  - `unfileable` gains `UNPICKED_CHARGE` after `NOBODY_ELSE`, shown as the form's hint and as
    the alert when filing is tapped, and nothing is sent.
  - `whose`'s non-joint, several-others branch now answers `null` for a charge outside the
    current others, not `other`; the live line reads `Whose not chosen yet` for it (the words
    lg-91 uses), in a household of two as well.
- **No second sentinel was needed.** The ticket's option 1 cost named one, checked against the
  person-id shape (`z.string().min(1).max(100)`). lg-91's joint select uses the value `""` for
  its unpicked `Whose?`, which is free there because the joint select has no Mine. lg-90's
  select spends `""` on Mine, so lg-91's value could not be reused as it stands. What is reused
  is lg-91's disabled `Whose?` option and wording, placed first with the same `""` value, the
  way lg-90 already places `Someone else's` in a household of one. No value that is a person id
  and no new sentinel enters the code. Proof it holds: the `C1` to `C3` test selects `Whose?`
  (`selectedOptions[0].text`, `disabled`), then picks a person and then `Mine` in a second
  test; `Mine` files `not-shared`.
- **One departure from the answer's wording, flagged.** Question 3 (a) says nobody is
  preselected "when there are two or more others". A `theirs` item with `chargedTo: null` in
  a household of two (one other) is therefore not unpicked: the request has always meant the
  one other, nothing is substituted, and the existing lg-39 test
  (`readBasketWithTheirs`, a `theirs` item with no name, two members) files it and still does.
  A charge naming someone who is not a current member is unpicked at any size above one other
  (C1). Refusing the null case in a household of two as well is a one-token change
  (`several` in `unpicked`). Answered by the owner on 2026-11-01, see the round 1 entry
  below: keep filing it to the one other member.
- **Done when 2, per case.** Test: `web/test/receipts.test.tsx`, `a read item charged to someone
  who has left, or to nobody, files nothing until a current member is picked` (`test.each` of
  C1 to C3), `with nobody else, a read charge to someone who has left is refused as before
  (lg-94 C0)`, plus `an unpicked read charge can be answered Mine` and `a read charge to a
  member who is still here keeps its person`. On `main` (the tests run before the source
  change): `Tests 3 failed | 3 passed | 51 skipped (57)` with `-t lg-94`: C1, C2, C3 fail
  (`expected 'sam' to be 'Whose?'`, `'casey'` for C2 and C3) and C0, Mine and still-here pass.
  After: `Tests 57 passed (57)` for the whole file. Records, the Reproduction command at the
  fixed tree (`Tests 5 passed | 57 skipped (62)`, `vitest exit 0`):

  ```
  B C0 select shows="Someone else’s" ... filed=NOT FILED, alert="There is nobody else in the household to charge an item to."
  B C1 select shows="Whose?" options=["Whose?","Mine","sam"] live="Not shared 0.00 $ · Whose not chosen yet 15.54 $ · Shared 9.22 $" ... filed=NOT FILED, alert="Choose whose each item left out is: it was charged to someone who has left, or to nobody."
  B C2 select shows="Whose?" options=["Whose?","Mine","casey","sam"] ... filed=NOT FILED, alert="Choose whose each item left out is: ..."
  B C3 select shows="Whose?" options=["Whose?","Mine","casey","sam"] ... filed=NOT FILED, alert="Choose whose each item left out is: ..."
  ```

- **What the brief had wrong**, all in the filing's text:
  - It said lg-90 was not merged; it is (8b1a88e0, #724). Its `Receipts.tsx` line numbers, and
    the base shas `686b213c` and `bb4968240a`, no longer describe `main`.
  - Its Reproduction probe looked for share buttons lg-90 removed, so it could not run; rewritten
    above against the select, with records on `main` at `bd95ab0b`.
  - "A household of two has no select on `main`" was `main` before lg-90: it has one now,
    `Mine` and `sam`, and C1's `main` reading is that it shows `sam`.
  - lg-91's handover: `whose` gained a joint branch that never falls back to `other`; the
    non-joint branch did, and now does not. `itemOf` is unchanged. `unfileable` and the two
    selects are as the handover says. The joint select and joint-row behaviour are untouched.
- **Stale alert, not fixed.** After a refused tap the alert stays until the next filing even
  once the person has picked (the hint beside the items goes at once). This is how
  `NOBODY_ELSE` and lg-91's `NOBODY_CHOSEN` already behave; the test notes it. Not folded in:
  it touches lg-91's and the lg-39 refusals too, and has no reproduction filed.
- **Fold-ins: none.** Nothing other than the stale alert was in reach.

**2026-11-01, round 1 (gate 1, ticket-reviewer-opus, graded `b09aadd2` CONCERNS; the owner's
three answers, relayed by the coordinator).**

- **Answer A, the build's open decision: a `theirs` item with no name in a household of
  two.** Options: keep filing it to the one other member (recommended), or refuse it too
  (`several` dropped from `unpicked`, and the lg-39 test rewritten). Chosen: **keep filing
  it.** The sentence in the build entry that left it open is replaced above.
- **Answer B, gate 1's medium: the joint round trip.** A read `theirs` item charged to nobody
  (C3) or to the payer is filed `not-shared` after "Paid with the joint card?" then "Paid with
  my own card" with no pick, because `payMyself` (lg-91) turns every `theirs` item charged to
  `null` or the payer into Mine, which defeats option 1's rule that the item cannot read as
  Mine. Options: (a) fix it in lg-94 (the gate's direction, recommended); (b) file it as a
  ticket; (c) accept it as the person's choice. Chosen: **(a).** Built below.
- **Answer C, gate 1's lows.** Options: fix the second (the refusal text) and record the first
  and third (recommended); that, and also file the stale alert; record all three. Chosen: **fix
  the second, record the first and third.**
  - Low 2, fixed below: `UNPICKED_CHARGE` said "charged to someone who has left, or to
    nobody", false for a read naming the payer or a name the books never held.
  - **Recorded, not fixed:** the stale alert after a refused tap (the build entry's "Stale
    alert, not fixed"; unchanged, and shared with `NOBODY_ELSE` and `NOBODY_CHOSEN`), and the
    household-of-two live line (it reads `Whose not chosen yet` for the whole charged amount whenever any item is unpicked, an item that is the one other member's included). Gate 1's
    section holds their text.
- **Built, B (the joint round trip).** `ItemDraft` gains `asRead`, true when the read proposed
  the item `theirs` and cleared by any choice of the person's (the Shared box, either select).
  `payMyself` returns to Mine only a `theirs` item charged to nobody or the payer that is not
  `asRead`, so a read charge is left as it was and `unpicked` refuses it again. The alternative
  gate 1 described, remembering which items `payJointly` moved from `not-shared`, would not
  cover an item the person unchecked while paid jointly, which lg-91 also returns to Mine.
  Red before green, with the one line `!item.asRead &&` mutated to `true &&` and restored
  (`cp` from the scratch copy): `npx vitest run tools/ledger/web/test/receipts.test.tsx`
  gives `Tests 2 failed | 59 passed (61)`, both `a read charge to nobody|the payer is still
  unpicked after the joint card and back to my own` with `expected 'Mine' to be 'Whose?'`;
  unmutated, `Tests 61 passed (61)`. lg-91's `an item left as Mine names nobody once paid
  jointly, and is Mine again on my own card` passes in both, and a new test pins that an
  item picked on the joint card is Mine again.
- **Built, low 2 (the refusal's words).** `UNPICKED_CHARGE` now reads "the receipt's charge
  for it names no other member of the household", true for a departed member, a name the books
  never held, the payer and nobody. The records quoted in the build entry carry the old words;
  they are the readings at `b09aadd2`. Test: `a refusal's words are true for a name the books
  never held`, which also pins that the words say neither `has left` nor `to nobody`.

**2026-11-01, landing (gate 2, ticket-reviewer-opus, graded `6a294daa` PASS; the owner's
answer on gate 2's three lows, relayed by the coordinator).**

- **Answer D, gate 2's three lows.** Options: all three at landing (recommended); the second
  and third only; record all three. Chosen by the owner: **all three at landing, with no
  re-gate.** Each is marked below as _Fixed at landing_.

- 2026-11-01 — Fixed at landing by owner choice: gate 2, the first new low — "Three behaviours of asRead have no test on the branch". Three tests added at the end of `web/test/receipts.test.tsx`, `npx vitest run tools/ledger/web/test/receipts.test.tsx -t lg-94` → `13 passed | 51 skipped (64)` (10 before). Under `mutate2.mjs`'s mutation (`!item.asRead &&` removed from `payMyself`, committed tree, restored by checking the file out of the tests commit) the result is `4 failed | 9 passed`: the two lg-94 round-trip tests of the branch, plus `with one other member, a read charge to nobody stays theirs through the joint card and back (lg-94)` and `with nobody else, a read charge to nobody is still refused after the joint card and back (lg-94)`. The third, `an item unchecked while paid jointly is Mine again on my own card, though the read charged it to nobody (lg-94)`, cannot fail under that mutation: the mutation makes every such item Mine, which is that test's expected result. It fails under the opposite one, the Shared box's `asRead: false` removed from its `onChange`: `1 failed | 12 passed`.
- 2026-11-01 — Fixed at landing by owner choice: gate 2, the second new low — "reads only zed. Its title claims more than its body asserts". The body of `a refusal's words are true for a name the books never held, the payer and a departed member alike (lg-94)` now loops over `zed`, `alex` (the payer) and `dana` (a departed member), each asserting `Whose?` selected and the `UNPICKED_CHARGE` hint shown; it passes in the `-t lg-94` run above (`13 passed`).
- 2026-11-01 — Fixed at landing by owner choice: gate 2, the third new low — "The Log's round 1 entry describes gate 1's third low as it reads Whose not chosen yet with one candidate". The round 1 entry now carries gate 1's wording, in place. `git diff 6a294daa HEAD -- tools/ledger/docs/work/lg-94-a-read-item-charged-to-a-departed-member.md | grep -c '^-.*with one candidate'` → `1`.
