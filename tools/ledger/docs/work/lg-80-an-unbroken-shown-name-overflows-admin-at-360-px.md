---
id: lg-80
tool: ledger
title: A 64-character shown name with no space makes the Admin screen 763 px wide at 360 px
kind: fix
status: ready
milestone: null
depends_on: []
difficulty: standard
---

# lg-80 — An unbroken 64-character name overflows Admin at 360 px

## Why

`.claude/rules/responsive-layout.md` requires every screen to fit a 360 px phone
with no horizontal scroll of the page. The Admin screen does not, when one
person's shown name is 64 characters with no space in it. Measured on `main` at
`f05108d2`: `document.documentElement.scrollWidth` is **763** in a 360 px window,
and **1280** in a 1280 px one.

The longest name the books show a person is 64 characters, so this is a name the
product allows, not a hostile input. The limit is set in three places:

- `tools/ledger/contract/src/api.ts`, `renamePersonRequestSchema` (lines 245–246)
  and `addMemberRequestSchema`'s `person` (line 207): `.max(64)`.
- `tools/ledger/api/src/directory.ts`, lines 385 and 749: a person's name is
  refused above 64 characters.

The defect was found by lg-74's gate 1 (pull request #680), which dropped it there
as not that branch's. It does not depend on lg-74: the probe below renames a
person who has an email, on `main`. The layout spec does not catch it, because its
Admin case reads the seeded names (`alex`, `sam`), which are short, and passes on
`main` (control, below).

**Not measured:** which element on Admin is wider than the window. The fix's
builder finds it first (Build, step 2). The Household screen is measured below and
does not overflow with the same name.

## Build

1. Add the case to `tools/ledger/e2e/layout.spec.ts` before any change, and run it
   on `main`'s styles: it must fail with `scrollWidth` 763 at 360 px. Reach Admin
   through `fitsBothWidths` with a `page.route` stub of `GET /api/admin/households`,
   renaming the first member to 64 `R`s in `members` and in `people`, as the
   reproduction does. **Do not rename through the API**: the seed is shared across
   the run, and the other cases assert the seeded names (`Home: alex and sam`).
2. Find the element on Admin that is wider than the window at 360 px (a measurement
   of each element's `getBoundingClientRect().right` against `innerWidth`), so the
   fix goes on that element and not on a container that already fits.
3. Fix it in `tools/ledger/web/src/styles.css` (or `Admin.tsx`, if the element is
   there). `responsive-layout.md` allows two shapes: let the name break
   (`overflow-wrap: anywhere`), or put it in a box with `overflow-x: auto`. Either
   is within the rule; choose the one that keeps the Admin card legible, and say
   which in the Log. Never `overflow-x: hidden` on an element that wraps the page.
4. Open the Admin screenshot at 360 px (`e2e/.artifacts/layout/Admin-360.png`) and
   read it: the name must show whole or scroll inside its own box, not be cut at
   the right edge.
5. If the case is split from the fix into its own pull request, mark it
   `test.fixme` naming `lg-80`, as `responsive-layout.md` says.

## Done when

1. `tools/ledger/e2e/layout.spec.ts` has a case on the Admin screen with a
   64-character unbroken shown name, measured at 360 px and at 1280 px through
   `fitsBothWidths`. On `main`'s styles it fails with `scrollWidth` 763 at 360 px;
   on the fixed branch it passes at both widths. Both runs are in the Log.
2. The Admin screenshot at 360 px, taken by that case, is opened and shows the name
   whole or in its own scrolling box, not clipped at the edge.
3. `npm run check` passes, and `npm run e2e:ledger` passes with the new case and
   every existing one.

## Reproduction

Run on `main` at `f05108d2` by the dispatch that filed this ticket, 2026-10-31, and
again on the lg-80 base (also `f05108d2`) by the builder.

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

**Household screen, same stub idea, builder's run on `f05108d2`.** This probe
stubs `GET /api/households/:id` (the `HouseholdResponse` the Household screen
reads), renames the first member to the same 64 `R`s, asserts the name is on the
screen before it measures, and then measures at both widths:

```
Running 1 test using 1 worker
[1/1] [chromium] › tools/ledger/e2e/lg80-household-probe.spec.ts:10:1 › household overflow probe: unbroken name on the Household screen
  1 passed (5.9s)
```

```
household screen, 64 unbroken chars, at 360 px: scrollWidth 360
household screen, 64 unbroken chars, at 1280 px: scrollWidth 1280
```

So the Household screen does not break the same way with this name. The stub
changed only the first member's name on that screen, so this measures that one
place the name shows, not every place a name can appear on it.

**Control: the layout spec's own Admin case, unstubbed, on the base:**

```
npx playwright test -c tools/ledger/playwright.config.ts tools/ledger/e2e/layout.spec.ts -g "Admin"
  1 passed (5.1s)
```

It runs `Admin fits a phone and a desktop` at both widths with the seeded names.

**Run of the Admin probe that did not finish.** The builder's first run of the
Admin probe, in the background, exited with status 1 and printed no Playwright
summary, though it had already appended its two lines to the log. A foreground
re-run passed (above). Not reproduced beyond that.

## Log

**2026-10-31 — filed.** Found by lg-74's gate 1 (pull request #680), which dropped it
as not that branch's. Reproduced on `main` at `f05108d2` by the dispatch, and again
by the builder on the base at the same sha, with the outputs above.

Checked alongside the reproduction:

- The longest name the books show a person: 64 characters, by
  `renamePersonRequestSchema` and `addMemberRequestSchema` in the contract, and by
  the directory's own checks (`directory.ts` lines 385 and 749). A household name is
  allowed to be 80 characters (`directory.ts` line 568), and Admin prints it in each
  card's title (`tools/ledger/web/src/admin/Admin.tsx` line 129). That path is not
  measured here, and is not this ticket's: the probe is about a person's name.
- The Household screen does not overflow with the same 64-character member name
  (`360` at 360 px). The Admin screen does.
- The layout spec's Admin case passes on the base with the seeded names. The check
  does not cover a long name, which is why it did not find this.
