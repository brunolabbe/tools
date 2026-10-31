---
id: lg-80
tool: ledger
title: Unbroken 64- or 80-character names overflow the Admin screen
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-80 — Unbroken 64- or 80-character names overflow Admin

## Why

`.claude/rules/responsive-layout.md` requires every screen to fit a 360 px phone
with no horizontal scroll of the page. The Admin screen does not, when a name on it
has no space in it and is long enough to be wider than the window. Two names reach
it:

- **A person's shown name, 64 characters.** Measured on `main` at `f05108d2`:
  `document.documentElement.scrollWidth` is **763** in a 360 px window, and **1280**
  in a 1280 px one.
- **A household's name, 80 characters.** Measured on the same base: **1005** in a
  360 px window, and **1341** in a 1280 px one. The desktop overflow is new: the
  person's name fits 1280 px.

Both are names the product allows, not hostile input. The person's limit is set in
five places, all 64 characters:

- `tools/ledger/contract/src/api.ts`: `addMemberRequestSchema`'s `person` (line 207),
  `renamePersonRequestSchema`'s `name` (line 246) and `createHouseholdRequestSchema`'s
  `person` (line 268), each `.max(64)`.
- `tools/ledger/api/src/directory.ts`, lines 385 and 749: a person's name is refused
  above 64 characters.

The household's limit is `tools/ledger/api/src/directory.ts` line 568: refused
above 80 characters.

Which elements carry the names, read from `tools/ledger/web/src/admin/Admin.tsx` at
`f05108d2`: `householdLabel` (line 127) builds each card's title from the household's
name and its people's shown names, and line 178 draws it as the card's `h3`. (Line 129,
`${household.name} (${household.id})`, is the title only for a household with no
people, which the cases below never reach; line 130 is the one they do.) So **the
household's name reaches only that `h3`, and a person's name reaches the `h3` and
also the member row (line 186, a `<strong>`) and the People list (line 441, a
`<strong>`)**. Measured at 360 px on `main` with the hook in Build 1, the right edge
of the text holding the name is **988** px for the household's name (the `h3`), and
**746** (the `h3`) and **667** and **667** (the two `<strong>`s) for the person's.

The defect was found by lg-74's gate 1 (pull request #680), which dropped it there
as not that branch's. It does not depend on lg-74: the person probe below renames a
person who has an email, on `main`. The layout spec does not catch it, because its
Admin case reads the seeded names (`alex`, `sam`), which are short, and passes on
`main` (control, below).

**Not measured:** whether the Household screen shows the household's own name, and
so whether an 80-character household name overflows there. The Household screen with
a 64-character member name does not overflow (probe below).

## Build

1. Add the cases to `tools/ledger/e2e/layout.spec.ts` before any change, and run
   them on `main`'s styles. Reach Admin through `fitsBothWidths` with a
   `page.route` stub of `GET /api/admin/households`, and pass `nameIsWhole` (below)
   as its `also`. Each case asserts `expect(NAME).toHaveLength(64)` (or `80`) so the
   stub cannot be narrowed unnoticed. **Give each case its own `screen` label**:
   `fitsBothWidths` writes `e2e/.artifacts/layout/<screen>-<width>.png`, and the
   existing seeded case writes `Admin-<width>.png`, which a new case reusing the
   label would overwrite. Use `Admin (long person name)`, `Admin (long household
   name)` and `Admin (spaced household name)`, and give each the same entry in
   `CARDS` as `Admin` (3), so `cardsStandApart` reads the stubbed page too.
   - **Person:** rename the first member to 64 `R`s in `members` and in `people`,
     as the person probe below does. On `main`'s styles it must fail with
     `scrollWidth` 763 at 360 px.
   - **Household:** replace each household's `name` with 80 `H`s. On `main`'s
     styles it must fail with `scrollWidth` 1005 at 360 px and 1341 at 1280 px.
   - **Control:** the same stub with an 80-character household name that has a
     space every ten characters. It fits at both widths, before and after the fix,
     so the case cannot pass merely because the stub is wrong.

   **Do not rename through the API**: the seed is shared across the run, and the
   other cases assert the seeded names (`Home: alex and sam`).

   **`nameIsWhole`** exists because `scrollWidth` cannot tell a name that wrapped
   or scrolls from a name that an ancestor clipped: `.card { overflow: hidden }`
   turns both `scrollWidth` readings to 360 and the name stays 988 px wide, cut at
   the card's edge. It walks every text node under `main` that holds the name,
   takes the box of the text itself (a `Range`, so text that spills out of its
   element is counted), and climbs the ancestors: an element with `overflow-x:
   hidden` or `clip` must contain what is inside it, an element with `auto` or
   `scroll` is a box the name may scroll in (and from there only that box has to
   fit), and at the top the result must be inside the window. It also fails when no
   text node holding the name has a box, so a stub whose route stopped matching
   cannot pass. This body is the one run in this ticket's Log; it returns what is
   wrong, and the hook asserts it empty:

   ```ts
   async function nameProblems(page: Page, name: string): Promise<string[]> {
     return page.locator("main").evaluate((main, needle) => {
       const problems: string[] = [];
       let drawn = 0;
       const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
       for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
         if (!(node.nodeValue ?? "").includes(needle)) continue;
         const range = document.createRange();
         range.selectNodeContents(node);
         const text = range.getBoundingClientRect();
         // An <option> is in the page and has no box: it is not on the screen.
         if (text.width === 0) continue;
         drawn += 1;
         let { left, right } = text;
         for (let el = node.parentElement; el !== null; el = el.parentElement) {
           const overflow = getComputedStyle(el).overflowX;
           if (overflow === "visible") continue;
           const box = el.getBoundingClientRect();
           // hidden and clip cut what lies outside the box; auto and scroll let it be scrolled to.
           if (
             (overflow === "hidden" || overflow === "clip") &&
             (right > box.right + 0.5 || left < box.left - 0.5)
           ) {
             problems.push(
               `<${el.tagName.toLowerCase()}> cuts the name (it ends at ${String(Math.round(right))}, the box at ${String(Math.round(box.right))})`,
             );
           }
           // From here out only the box itself can be seen.
           ({ left, right } = box);
         }
         if (right > window.innerWidth + 0.5 || left < -0.5) {
           problems.push(
             `the name reaches ${String(Math.round(right))} px in a ${String(window.innerWidth)} px window`,
           );
         }
       }
       if (drawn === 0) problems.push("the name is not drawn on the screen");
       return problems;
     }, name);
   }

   function nameIsWhole(name: string, screen: string) {
     return async (page: Page, width: number): Promise<void> => {
       expect
         .soft(await nameProblems(page, name), `${screen} at ${String(width)} px: the name`)
         .toEqual([]);
     };
   }
   ```

   A builder who changes the hook re-runs the variants in the Log (a clip must
   fail it, a break and a scroll box must pass it) and logs the result.

2. Find each element on Admin that is wider than the window at 360 px: on `main`'s
   styles `nameIsWhole` names them (the `h3`, and for the person also the two
   `<strong>`s), so the fix goes on every element it names and not on a container
   that already fits. The title and the member rows are different elements, and a
   fix on the member rows alone leaves the person case red because the title
   carries the same name. The 1280 px overflow is only on the household's title.
3. Fix it in `tools/ledger/web/src/styles.css` (or `Admin.tsx`, if the element is
   there). `responsive-layout.md` allows two shapes: let the name break
   (`overflow-wrap: anywhere`), or put it in a box with `overflow-x: auto`. Either
   is within the rule; choose the one that keeps the Admin card legible, and say
   which in the Log. Never `overflow-x: hidden` (or `clip`) on an element that
   wraps the page, and not on the card or the title either: it turns
   `scrollWidth` green and `nameIsWhole` red, because the name is then cut.
4. Open the Admin screenshots at 360 px
   (`e2e/.artifacts/layout/Admin (long person name)-360.png` and `Admin (long
   household name)-360.png`) and read them: the names must show whole or scroll
   inside their own box, not be cut at the right edge.
5. If the case is split from the fix into its own pull request, mark it
   `test.fixme` naming `lg-80`, as `responsive-layout.md` says.

## Done when

1. `tools/ledger/e2e/layout.spec.ts` has a case on the Admin screen with a
   64-character unbroken shown name, measured at 360 px and at 1280 px through
   `fitsBothWidths` with `nameIsWhole` as its `also`, and asserting the name's
   length. On `main`'s styles it fails with `scrollWidth` 763 at 360 px; on the
   fixed branch it passes at both widths. Both runs are in the Log.
2. `tools/ledger/e2e/layout.spec.ts` has a case on the Admin screen with an
   80-character unbroken household name, measured at 360 px and at 1280 px through
   `fitsBothWidths` with `nameIsWhole` as its `also`, and asserting the name's
   length. On `main`'s styles it fails with `scrollWidth` 1005 at 360 px and 1341
   at 1280 px; on the fixed branch it passes at both widths. The control (80
   characters with a space every ten) passes at both widths before and after, in
   the same case or beside it. Both runs are in the Log.
3. The names are whole, or in their own scrolling boxes, not clipped at the edge.
   **The proof is the `nameIsWhole` assertion** in the cases of lines 1 and 2,
   green at both widths on the fixed branch (it is red on `main`'s styles, in the
   same runs as those lines). It is not the screenshots alone. The two 360 px
   screenshots named in Build 4 are also opened and read, and the Log says what
   they show.
4. `npm run check` passes, and `npm run e2e:ledger` passes with the new cases and
   every existing one.

## Reproduction

Run on `main` at `f05108d2`, 2026-10-31. Each probe is a throwaway Playwright
spec: copy it into `tools/ledger/e2e/` under the file name given, run it with the
command given (the config's `testMatch` is `**/*.spec.ts`, and `E2E_PORT` is a free
port you choose, `8108` being the config's default), then delete the copy and the
log it wrote in the working directory. None is committed.

### Person name, 64 characters

The probe stubs `GET /api/admin/households` and writes the page's `scrollWidth` at
each width to `lg80-person.log`. File: `lg80-person-probe.spec.ts`.

```ts
// Probe: does a 64-character unbroken name overflow the Admin screen at 360 px
// for a person who HAS an email (so, independent of lg-74)? Writes to a file.
import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = "lg80-person.log"; // any file the run may append to
const NAME = "R".repeat(64);

test("overflow probe: unbroken name on a membership person", async ({ page }) => {
  await page.route("**/api/admin/households", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as {
      households: {
        members: { address: string | null; person: string; name: string }[];
        people: { person: string; name: string; standing: string }[];
      }[];
    };
    await route.fulfill({
      json: {
        households: body.households.map((household) => {
          const first = household.members[0]?.person;
          return {
            ...household,
            members: household.members.map((member) =>
              member.person === first ? { ...member, name: NAME } : member,
            ),
            people: household.people.map((one) =>
              one.person === first ? { ...one, name: NAME } : one,
            ),
          };
        }),
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: "Admin" })
    .click();
  await page.waitForLoadState("networkidle");
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const measured = await page.evaluate(() => document.documentElement.scrollWidth);
    appendFileSync(
      OUT,
      `membership person, 64 unbroken chars, Admin at ${String(width)} px: scrollWidth ${String(measured)}\n`,
    );
  }
});
```

Run: `npx playwright test -c tools/ledger/playwright.config.ts lg80-person-probe`
with `E2E_PORT` set.

Output on `main` at `f05108d2`, the same on both of the 2026-10-31 runs (the filer's
and the builder's):

```
membership person, 64 unbroken chars, Admin at 360 px: scrollWidth 763
membership person, 64 unbroken chars, Admin at 1280 px: scrollWidth 1280
```

### Household name, 80 characters

The same idea, on the household's `name` instead of a member's. Each household
returned by `GET /api/admin/households` is given the name under test. The probe
runs two cases: 80 unbroken characters, and the control, 80 characters with a space
every ten. It asserts the name is on the screen before it measures, and writes to
`lg80-household-name.log`. File: `lg80-household-name-probe.spec.ts`.

```ts
// Measurement: an 80-character HOUSEHOLD name on the Admin screen, at 360 px and
// 1280 px. Two cases: one unbroken, one with a space every ten characters (the control).
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const OUT = "lg80-household-name.log"; // any file the run may append to
const UNBROKEN = "H".repeat(80);
// Seven spaces, eighty characters: nine H's and a space, seven times, then ten H's.
const SPACED = ("H".repeat(9) + " ").repeat(7) + "H".repeat(10);

async function measure(page: Page, label: string, name: string): Promise<void> {
  await page.route("**/api/admin/households", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as { households: { name: string }[] };
    await route.fulfill({
      json: { ...body, households: body.households.map((household) => ({ ...household, name })) },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: "Admin" })
    .click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText(name).first()).toBeVisible();
  appendFileSync(OUT, `${label}: name length ${String(name.length)}\n`);
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const measured = await page.evaluate(() => document.documentElement.scrollWidth);
    appendFileSync(
      OUT,
      `${label}, Admin at ${String(width)} px: scrollWidth ${String(measured)}\n`,
    );
  }
}

test("household name probe: 80 unbroken characters", async ({ page }) => {
  await measure(page, "household name, 80 unbroken chars", UNBROKEN);
});

test("household name probe: 80 characters with a space every ten", async ({ page }) => {
  await measure(page, "household name, 80 chars spaced every ten (control)", SPACED);
});
```

Run: `npx playwright test -c tools/ledger/playwright.config.ts lg80-household-name-probe`
with `E2E_PORT` set.

Output on `main` at `f05108d2` (2026-10-31), `2 passed`, and the file it wrote:

```
household name, 80 unbroken chars: name length 80
household name, 80 unbroken chars, Admin at 360 px: scrollWidth 1005
household name, 80 unbroken chars, Admin at 1280 px: scrollWidth 1341
household name, 80 chars spaced every ten (control): name length 80
household name, 80 chars spaced every ten (control), Admin at 360 px: scrollWidth 360
household name, 80 chars spaced every ten (control), Admin at 1280 px: scrollWidth 1280
```

### The Household screen, 64-character member name

This probe stubs `GET /api/households/:id` (the `HouseholdResponse` the Household
screen reads), renames the first member to the same 64 `R`s, asserts the name is on
the screen before it measures, and measures at both widths, writing to
`lg80-household-screen.log`. File: `lg80-household-screen-probe.spec.ts`.

```ts
// Probe: the same 64-character unbroken name on the Household screen, at 360 px
// and at 1280 px. The stub is GET /api/households/:id (HouseholdResponse), the
// route the Household screen reads; the first member is renamed to NAME.
import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = "lg80-household-screen.log"; // any file the run may append to
const NAME = "R".repeat(64);

test("household overflow probe: unbroken name on the Household screen", async ({ page }) => {
  await page.route("**/api/households/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = (await (await route.fetch()).json()) as {
      household: unknown;
      members: { address: string; person: string; name: string }[];
      history: unknown[];
    };
    const first = body.members[0]?.person;
    await route.fulfill({
      json: {
        ...body,
        members: body.members.map((member) =>
          member.person === first ? { ...member, name: NAME } : member,
        ),
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ledger", exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: "Household" })
    .click();
  await page.waitForLoadState("networkidle");
  // The stub reached the screen: the renamed name is on it, so the widths below are its.
  await expect(page.getByText(NAME).first()).toBeVisible();
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const measured = await page.evaluate(() => document.documentElement.scrollWidth);
    appendFileSync(
      OUT,
      `household screen, 64 unbroken chars, at ${String(width)} px: scrollWidth ${String(measured)}\n`,
    );
  }
});
```

Run: `npx playwright test -c tools/ledger/playwright.config.ts lg80-household-screen-probe`
with `E2E_PORT` set.

Output on `main` at `f05108d2` (2026-10-31), `1 passed`, and the file it wrote:

```
household screen, 64 unbroken chars, at 360 px: scrollWidth 360
household screen, 64 unbroken chars, at 1280 px: scrollWidth 1280
```

So the Household screen does not break the same way with a 64-character member
name. The stub changed only the first member's name on that screen, so this measures
that one place the name shows. It does not measure the household's own name on the
Household screen.

### Control: the layout spec's own Admin case

Run unstubbed on the base:

```
npx playwright test -c tools/ledger/playwright.config.ts tools/ledger/e2e/layout.spec.ts -g "Admin"
  1 passed (5.1s)
```

It runs `Admin fits a phone and a desktop` at both widths with the seeded names.

## Log

**2026-10-31 — filed.** Found by lg-74's gate 1 (pull request #680), which dropped it
as not that branch's. Reproduced on `main` at `f05108d2` by the dispatch, and again
by the builder on the base at the same sha, with the outputs above.

Checked alongside the reproduction:

- The longest shown name the books hold for a person: 64 characters, by
  `renamePersonRequestSchema` and `addMemberRequestSchema` in the contract, and by
  the directory's own checks (`directory.ts` lines 385 and 749).
- The Household screen does not overflow with the same 64-character member name
  (`360` at 360 px). The Admin screen does.
- The layout spec's Admin case passes on the base with the seeded names. The check
  does not cover a long name, which is why it did not find this.

**2026-10-31 — household name measured, folded in.** The filing left the
household's name unmeasured. The builder measured it on the base at `f05108d2`, as
the coordinator asked: each household's `name` in `GET /api/admin/households`
replaced with 80 unbroken `H`s, and with 80 characters spaced every ten as a control.
Admin's `scrollWidth`: **1005** at 360 px and **1341** at 1280 px for the unbroken
name, which overflows both widths; **360** and **1280** for the spaced control, which
fits. The person's name fits at 1280 px and the household's does not, so the
desktop overflow is new here. The output is in the Reproduction section above.

**2026-10-31 — owner's answer, folded in.** The coordinator put a question to the
owner, which the owner answered: whether the household-name overflow is folded into
lg-80, filed as `lg-81`, or recorded only. The answer, relayed by the coordinator:

- Options: (1) fold into lg-80; (2) file as `lg-81` in the same pull request; (3)
  record only.
- Chosen: **(1) fold into lg-80**, the coordinator's recommendation, because both
  overflows are on the same screen and are likely one fix.
- Consequence for this ticket: the title now names both names. The Why, the Build
  and the Done when each carry the household case, and its measured numbers replace
  the "not measured" sentences that stood here before.

Not measured, and still open: whether the Household screen shows the household's
own name, and whether an 80-character household name overflows there.

**2026-10-31 — gate 1 (CONCERNS, `330ce54b`): F1 to F6 fixed in this round.** No
code; the ticket is the only file changed, and its file was renamed on this unmerged
branch (F6). Each probe and the hook were run from the blocks as they stand in this
file, extracted by script, on `main`'s styles at `f05108d2` (the farm and
`npm run build` run first, since the probes serve `web`).

- **F1 (med): reproduced, and fixed by a check.** Gate 1's own probe was right:
  `.card { overflow: hidden }` turns `scrollWidth` to 360 and the name stays cut. The
  Build now carries `nameIsWhole`, passed to `fitsBothWidths` as its `also`, and
  `Done when` 3 is that assertion green on the fixed branch rather than a screenshot
  read by hand (the screenshots are still opened). It was run on six
  variants (the first adds no style), both widths, both names; the two columns are
  what `fitsBothWidths` reads and what the hook reads (`.card, main > * { min-width:
  0 }` is added to the last four so the grid items can shrink; none of them is a
  proposed fix):

  | Injected style                         | `scrollWidth` check, person / household             | `nameIsWhole`, person / household        |
  | -------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
  | none (`main`'s styles)                 | red at 360 (763) / red at 360 and 1280 (1005, 1341) | red at 360 / red at both                 |
  | `.card { overflow: hidden }`           | **green** / **green**                               | **red** at both widths / **red** at both |
  | `.card h3 { overflow: hidden }`        | **green** / **green**                               | **red** at both / **red** at both        |
  | `.card h3 { overflow-wrap: anywhere }` | green / green                                       | green / green                            |
  | `.card h3 { overflow-x: auto }`        | green / green                                       | green / green                            |
  | `.card { overflow-x: auto }`           | green / green                                       | green / green                            |

  The first row's person case at 1280 px is green on both, as the Why says. The
  hook's messages on `main`: `the name reaches 988 px in a 360 px window` (household,
  the `h3`) and 746, 667, 667 (person: the `h3` and the two `<strong>`s); under the
  card clip: `<section> cuts the name (it ends at 988, the box at 344)`.
  Break-or-scroll stays the fix builder's choice: both pass.

- **F2: fixed.** Build 1 now asserts the name's length in each case and the hook
  fails when no text node holding the name has a box. A stub serving 40 `H`s while
  the hook looks for 80: `the name is not drawn on the screen` at both widths, from
  the same run. (The hook skips the `<option>` that also holds a person's name, which
  has a zero-width box.)
- **F3: fixed.** Build 2 no longer states which element overflows as fact. The Why
  names the elements from `Admin.tsx` and gives the hook's reading of each, and
  Build 2 says the title carries both names, so a fix on the member rows alone leaves
  the person case red.
- **F4: fixed.** The Why cites `householdLabel` (line 127) and the title it builds
  (line 130), draws it at line 178, and says line 129 is the no-people fallback; the
  person's limit is five sites, with `createHouseholdRequestSchema`'s `person`
  (line 268) added and `renamePersonRequestSchema`'s line given as 246 (`name`) since
  line 245 is the person's id.
- **F5: fixed.** (a) The Household-screen probe is now in the ticket and was
  re-run: `1 passed`, `scrollWidth` 360 at 360 px and 1280 at 1280 px, as before
  (the other option was dropping the claim; the probe existed and one run priced it).
  (b) Each probe names its file, its run command and `E2E_PORT`; the three probes
  re-ran from the ticket's own blocks with those commands, 4 files, 18 tests passed
  (`18 passed`), and their output matches the sections above line for line.
  (c) The process narration is gone, as are the "did not finish" paragraph (an exit
  1 with no summary on one background run, never reproduced; `common.md` notes a
  probe spec can exit 1 after writing its results) and the sha that exists only on
  this branch (`bf3ca7d2`).
- **F6: fixed.** Each new case takes its own `screen` label, so none overwrites
  `Admin-360.png`, and `Done when` 3 and Build 4 name the new files. The ticket
  file is now `lg-80-unbroken-names-overflow-admin-at-360-px.md`.

Not measured: how the same fonts measure on CI's `ledger.yml` e2e job (the numbers
are this container's Chromium); gate 1 said the same.
