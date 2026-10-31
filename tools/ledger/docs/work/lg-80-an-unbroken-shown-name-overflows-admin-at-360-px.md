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
three places:

- `tools/ledger/contract/src/api.ts`, `renamePersonRequestSchema` (lines 245–246)
  and `addMemberRequestSchema`'s `person` (line 207): `.max(64)`.
- `tools/ledger/api/src/directory.ts`, lines 385 and 749: a person's name is
  refused above 64 characters.

The household's limit is `tools/ledger/api/src/directory.ts` line 568: refused
above 80 characters. Admin prints it in each card's title
(`tools/ledger/web/src/admin/Admin.tsx` line 129).

The defect was found by lg-74's gate 1 (pull request #680), which dropped it there
as not that branch's. It does not depend on lg-74: the person probe below renames a
person who has an email, on `main`. The layout spec does not catch it, because its
Admin case reads the seeded names (`alex`, `sam`), which are short, and passes on
`main` (control, below).

**Not measured:** which element on Admin is wider than the window. The fix's
builder finds it first (Build, step 2). Whether the Household screen shows the
household's name, and overflows with an 80-character one, is not measured. The
Household screen with a 64-character member name does not overflow (below).

## Build

1. Add the cases to `tools/ledger/e2e/layout.spec.ts` before any change, and run
   them on `main`'s styles. Reach Admin through `fitsBothWidths` with a
   `page.route` stub of `GET /api/admin/households`:
   - **Person:** rename the first member to 64 `R`s in `members` and in `people`,
     as the reproduction does. On `main`'s styles it must fail with `scrollWidth`
     763 at 360 px.
   - **Household:** replace each household's `name` with 80 `H`s. On `main`'s
     styles it must fail with `scrollWidth` 1005 at 360 px and 1341 at 1280 px.
   - **Control:** the same stub with an 80-character household name that has a
     space every ten characters. It fits at both widths, before and after the fix,
     so the case cannot pass merely because the stub is wrong.

   **Do not rename through the API**: the seed is shared across the run, and the
   other cases assert the seeded names (`Home: alex and sam`).

2. Find the element on Admin that is wider than the window at 360 px (a measurement
   of each element's `getBoundingClientRect().right` against `innerWidth`), so the
   fix goes on that element and not on a container that already fits. Do it for
   both names: the household's title is a different element from the person's
   member row, and the 1280 px overflow is only on the household one.
3. Fix it in `tools/ledger/web/src/styles.css` (or `Admin.tsx`, if the element is
   there). `responsive-layout.md` allows two shapes: let the name break
   (`overflow-wrap: anywhere`), or put it in a box with `overflow-x: auto`. Either
   is within the rule; choose the one that keeps the Admin card legible, and say
   which in the Log. Never `overflow-x: hidden` on an element that wraps the page.
4. Open the Admin screenshot at 360 px (`e2e/.artifacts/layout/Admin-360.png`) and
   read it: the names must show whole or scroll inside their own box, not be cut at
   the right edge.
5. If the case is split from the fix into its own pull request, mark it
   `test.fixme` naming `lg-80`, as `responsive-layout.md` says.

## Done when

1. `tools/ledger/e2e/layout.spec.ts` has a case on the Admin screen with a
   64-character unbroken shown name, measured at 360 px and at 1280 px through
   `fitsBothWidths`. On `main`'s styles it fails with `scrollWidth` 763 at 360 px;
   on the fixed branch it passes at both widths. Both runs are in the Log.
2. `tools/ledger/e2e/layout.spec.ts` has a case on the Admin screen with an
   80-character unbroken household name, measured at 360 px and at 1280 px through
   `fitsBothWidths`. On `main`'s styles it fails with `scrollWidth` 1005 at 360 px
   and 1341 at 1280 px; on the fixed branch it passes at both widths. The control
   (80 characters with a space every ten) passes at both widths before and after,
   in the same case or beside it. Both runs are in the Log.
3. The Admin screenshots at 360 px, taken by those cases, are opened and show the
   names whole or in their own scrolling boxes, not clipped at the edge.
4. `npm run check` passes, and `npm run e2e:ledger` passes with the new cases and
   every existing one.

## Reproduction

Run on `main` at `f05108d2` by the dispatch that filed this ticket, 2026-10-31, and
again on the lg-80 base (also `f05108d2`) by the builder. The household-name
measurement below was run by the builder on the same base, at the owner's request
(see the Log); the coordinator reports a re-run of the person probe on
`bf3ca7d2`'s base with the same six lines the builder measured. The builder did not
re-run that one.

### Person name, 64 characters

The probe stubs `GET /api/admin/households` and writes the page's `scrollWidth` at
each width to a file. Copy it into `tools/ledger/e2e/` to run it, then remove the
copy; it is not committed. Its output path is `OUT`, which the run needs to be a
file the probe can append to.

```ts
// Probe: does a 64-character unbroken name overflow the Admin screen at 360 px
// for a person who HAS an email (so, independent of lg-74)? Writes to a file.
import { appendFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const OUT = "lg80-admin.log"; // any file the run may append to
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

Run: `E2E_PORT=<a free port> npx playwright test -c tools/ledger/playwright.config.ts -g "overflow probe"`
(the builder ran it through a script, to keep the variable out of a chained shell
command; the port was 8181).

**The dispatch's run on `main` at `f05108d2`** (2026-10-31):

```
membership person, 64 unbroken chars, Admin at 360 px: scrollWidth 763
membership person, 64 unbroken chars, Admin at 1280 px: scrollWidth 1280
```

**Builder's re-run on the base, `f05108d2`** (2026-10-31), `tools/ledger/e2e/`
copy removed afterwards. The Playwright summary:

```
Running 1 test using 1 worker
[1/1] [chromium] › tools/ledger/e2e/lg80-overflow-probe.spec.ts:9:1 › overflow probe: unbroken name on a membership person
  1 passed (7.2s)
```

and the file it wrote:

```
membership person, 64 unbroken chars, Admin at 360 px: scrollWidth 763
membership person, 64 unbroken chars, Admin at 1280 px: scrollWidth 1280
```

### Household name, 80 characters

The same idea, on the household's `name` instead of a member's. Each household
returned by `GET /api/admin/households` is given the name under test. The probe
runs two cases: 80 unbroken characters, and the control, 80 characters with a space
every ten. It asserts the name is on the screen before it measures. Copy it into
`tools/ledger/e2e/` to run it, then remove the copy.

```ts
// Measurement: an 80-character HOUSEHOLD name on the Admin screen, at 360 px and
// 1280 px. Two cases: one unbroken, one with a space every ten characters (the control).
import { appendFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const OUT = "lg80-householdname.log"; // any file the run may append to
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

Run: `E2E_PORT=<a free port> npx playwright test -c tools/ledger/playwright.config.ts -g "household name probe"`
(run through a script, port 8181).

**Builder's run on the base, `f05108d2`** (2026-10-31). The Playwright summary:

```
Running 2 tests using 1 worker
[1/2] [chromium] › tools/ledger/e2e/lg80-householdname-probe.spec.ts:43:1 › household name probe: 80 unbroken characters
[2/2] [chromium] › tools/ledger/e2e/lg80-householdname-probe.spec.ts:47:1 › household name probe: 80 characters with a space every ten
  2 passed (5.7s)
```

and the file it wrote:

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
the screen before it measures, and then measures at both widths:

```
Running 1 test using 1 worker
[1/1] [chromium] › tools/ledger/e2e/lg80-household-probe.spec.ts:10:1 › household overflow probe: unbroken name on the Household screen
  1 passed (5.9s)
```

```
household screen, 64 unbroken chars, at 360 px: scrollWidth 360
household screen, 64 unbroken chars, at 1280 px: scrollWidth 1280
```

So the Household screen does not break the same way with a 64-character member
name. The stub changed only the first member's name on that screen, so this
measures that one place the name shows. It does not measure the household's own
name on the Household screen.

### Control: the layout spec's own Admin case

Run unstubbed on the base:

```
npx playwright test -c tools/ledger/playwright.config.ts tools/ledger/e2e/layout.spec.ts -g "Admin"
  1 passed (5.1s)
```

It runs `Admin fits a phone and a desktop` at both widths with the seeded names.

**Run of the person probe that did not finish.** The builder's first run of the
person probe, in the background, exited with status 1 and printed no Playwright
summary, though it had already appended its two lines to the log. A foreground
re-run passed (above). Not reproduced beyond that.

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
