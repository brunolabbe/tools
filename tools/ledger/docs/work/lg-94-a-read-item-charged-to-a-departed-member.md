---
id: lg-94
tool: ledger
title: A read item charged to a departed member is filed to the first current other
kind: fix
status: ready
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

Run on `main` at `686b213c`, from the repository root. The command reads the probe
from this ticket, appends it to a copy of `web/test/receipts.test.tsx` (which defines
`household`, `takePhoto`, `BASKET` and `shared` on `main`), runs the `LG94` tests,
prints the records and removes its own files. It names no scratch path.

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

const OUT = process.env.LG94_OUT ?? "lg94-probe.out";
function rec(line: string): void {
  appendFileSync(OUT, `${line}\n`);
}

// Main's share control is a plain button named "<item>, <label>" (no checkbox).
function itemButton(item: string): HTMLButtonElement {
  const found = screen
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-label")?.startsWith(`${item}, `));
  if (found === undefined) throw new Error(`no share button for ${item}`);
  return found as HTMLButtonElement;
}

function filedItems(): string {
  const filed = vi.mocked(fileReceipt).mock.calls.at(-1)?.[1];
  return JSON.stringify(
    filed?.proposal.items.map((item) => [item.text, item.share, item.chargedTo]),
  );
}

async function fileLine(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: "File as alex’s line" }));
  try {
    await waitFor(() => expect(fileReceipt).toHaveBeenCalledTimes(1), { timeout: 500 });
    return filedItems();
  } catch {
    return `NOT FILED, alert=${JSON.stringify(screen.queryByRole("alert")?.textContent ?? null)}`;
  }
}

// A read item someone else's, charged to a person who has left (or to nobody).
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
  ["C0 one+left dana", ["alex"], ["dana"], "dana"],
  ["C1 two+left dana", ["alex", "sam"], ["dana"], "dana"],
  ["C2 three+left dana", ["alex", "casey", "sam"], ["dana"], "dana"],
  ["C3 three, read null", ["alex", "casey", "sam"], [], null],
])("LG94 departed: %s", async (name, members, left, chargedTo) => {
  vi.mocked(fetchHousehold).mockResolvedValue(household(members, left));
  await readBasketCharged(chargedTo);
  const button = itemButton("BIERE 6X355");
  const select = screen.queryByLabelText("Whose is BIERE 6X355") as HTMLSelectElement | null;
  const selectState =
    select === null
      ? "none"
      : `value=${JSON.stringify(select.value)} shows=${JSON.stringify(select.selectedOptions[0]?.text ?? null)} options=${JSON.stringify([...select.options].map((option) => option.text))}`;
  const hints = [...document.querySelectorAll("p.hint.bad")].map((node) => node.textContent);
  rec(
    `B ${name} button=${JSON.stringify(button.getAttribute("aria-label"))} select=${selectState} live="${shared()}" hint=${JSON.stringify(hints)} filed=${await fileLine()}`,
  );
});

test("LG94 wrote all four records", () => {
  const written = readFileSync(OUT, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("B "));
  expect(written).toHaveLength(4);
});
```

Output of the command, at `686b213c`:

```
 Test Files  1 passed (1)
      Tests  5 passed | 39 skipped (44)
vitest exit 0
B C0 one+left dana button="BIERE 6X355, The other's" select=none live="Not shared 0.00 $ · The other's 15.54 $ · Shared 9.22 $" hint=["There is nobody else in the household to charge an item to."] filed=NOT FILED, alert="There is nobody else in the household to charge an item to."
B C1 two+left dana button="BIERE 6X355, sam's" select=none live="Not shared 0.00 $ · sam's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs",null],["SAVON","shared",null]]
B C2 three+left dana button="BIERE 6X355, casey's" select=value="casey" shows="casey" options=["casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
B C3 three, read null button="BIERE 6X355, casey's" select=value="casey" shows="casey" options=["casey","sam"] live="Not shared 0.00 $ · casey's 15.54 $ · Shared 9.22 $" hint=[] filed=[["PAIN","shared",null],["BIERE 6X355","theirs","casey"],["SAVON","shared",null]]
```

Read against the gate's measurements (lg-90's gate 1, on lg-90's tree):

- **C2, three current members, charged to dana:** the select shows casey, and the request
  carries `theirs` with `"casey"`. Reproduced on `main`.
- **C3, three members, read item charged to nobody:** nobody has departed in it. It files casey. Reproduced on `main`.
- **C1, two current members, charged to dana:** the request carries `theirs` with `null`,
  which the API reads as sam. Reproduced on `main`. The gate also said "the select
  shows sam", which describes lg-90's tree. On `main` a household of two has no select:
  it renders only with more than one other member (`several && item.share === "theirs"`).
  The item reads `sam's` and nothing shows the choice.
- **C0, one current member, charged to dana:** the form refuses to file, with
  `NOBODY_ELSE` on screen. That is correct, and it is the one case that is not silent.

## Build

Not dispatchable until Question 1 in Decision is answered. Then build the chosen
option after lg-90 merges, against the merged `web/src/receipts/Receipts.tsx`. The
code involved is `whose` (`main` line 591), `itemOf` (lines 180 and 195), `unfileable`
(lines 665–670) and, on lg-90's head, the select's value expression. The Reproduction
probe does not re-run on the fixed tree: it finds share buttons named `<item>, <label>`,
which lg-90 removes.

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
