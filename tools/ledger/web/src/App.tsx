/**
 * The shell: the home screen and the salaries (lg-5), the paste screen (lg-2),
 * the inbox and the rules (lg-4), the period (lg-6), and the spending
 * categories (lg-15) and the history's charts (lg-9), and a receipt photographed
 * and filed (lg-8), and a workbook imported through a layout a model describes
 * (lg-66).
 *
 * The books arrive with their design — `docs/00-ANALYSIS.md` first, then the
 * tickets it produces — and a screen guessed at before its ticket is one more
 * thing to unpick, so each one lands with the work that stores what it shows.
 * A handful of screens does not need a router: a tab is a piece of state, and the inbox
 * carries the number of rows waiting so a paste that left some is not missed.
 *
 * An address the household directory does not hold sees none of it (lg-20):
 * `/api/me` answers `FORBIDDEN`, and the shell gives way to one page saying so.
 * Any other failure leaves the shell, where each screen says what went wrong.
 *
 * lg-22: a member gets a household tab, and an admin an admin tab. An admin in
 * no household is refused by `/api/me` like a stranger, so the shell asks for
 * the admin's list before it says "no household": answered, the admin's screen
 * is the whole of the shell, with no books tab at all.
 *
 * lg-33: the shell fetches how each person is shown and hands it to every
 * screen (`people.tsx`), so a rename made on the admin's screen is on the next
 * one opened. Until it answers, or if it fails, each person is shown under their
 * id.
 *
 * lg-98: the shell's reads are queries in the one cache (`queries.ts`), as every
 * screen's are, so a change of tab asks for nothing. The rename marks the names
 * stale and they are read again (`writes.ts`), and the inbox's count is the
 * inbox's own answer, so a paste, a filing or an answer moves it as soon as the
 * API has it (lg-54), on whichever tab the person is.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppError } from "@ledger/contract";
import { AppFooter, AppHeader, TOOL_VERSION } from "@webtools/ui";
import { Admin } from "./admin/Admin.tsx";
import { Glyph } from "./Glyph.tsx";
import { History } from "./history/History.tsx";
import { Home } from "./home/Home.tsx";
import { Household } from "./household/Household.tsx";
import { ImportWorkbook } from "./import/ImportWorkbook.tsx";
import { Inbox } from "./inbox/Inbox.tsx";
import { NoHousehold } from "./NoHousehold.tsx";
import { PeopleNamesProvider } from "./people.tsx";
import { Periods } from "./periods/Periods.tsx";
import { adminHouseholdsQuery, inboxQuery, meQuery, peopleQuery, shownNames } from "./queries.ts";
import { Receipts } from "./receipts/Receipts.tsx";
import { Rules } from "./rules/Rules.tsx";
import { MortgageSplitCard } from "./salaries/MortgageSplit.tsx";
import { Salaries } from "./salaries/Salaries.tsx";
import { Spending } from "./spending/Spending.tsx";
import { Stats } from "./stats/Stats.tsx";
import { StatementPaste } from "./statements/StatementPaste.tsx";

type Tab =
  | "home"
  | "stats"
  | "period"
  | "history"
  | "receipt"
  | "paste"
  | "inbox"
  | "rules"
  | "spending"
  | "salaries"
  | "import"
  | "household"
  | "admin";

/** What the ledger is, said under its name on every screen but the admin's. */
const HOUSEHOLD_TAGLINE = "The household\u2019s shared account.";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("home");
  const asked = useQuery(meQuery);
  const me = asked.data ?? null;
  // An admin in no household, or nobody the ledger knows: only the admin list's
  // FORBIDDEN says the second. Any other failure of either leaves the shell, as
  // /api/me's own does (lg-22's gate 1, F2).
  const refused = asked.error !== null && AppError.from(asked.error).code === "FORBIDDEN";
  const admin = useQuery({ ...adminHouseholdsQuery, enabled: refused });
  const adminOnly = refused && admin.data !== undefined;
  const inNoHousehold =
    refused && admin.error !== null && AppError.from(admin.error).code === "FORBIDDEN";

  // A failure keeps the number shown before: the inbox says what went wrong when opened.
  const inbox = useQuery(inboxQuery);
  const waiting = inbox.data?.length ?? null;

  // Only a member has books to ask; a failure keeps the map it had.
  const people = useQuery({ ...peopleQuery, select: shownNames, enabled: me !== null });
  const names = people.data ?? {};

  if (adminOnly) {
    return (
      <div className="shell stack">
        <AppHeader name="Ledger" tagline="Admin" glyph={<Glyph />} />
        <main className="stack">
          <Admin />
        </main>
        <AppFooter version={TOOL_VERSION} termsHref="/terms.html" />
      </div>
    );
  }

  if (inNoHousehold) {
    return (
      <div className="shell stack">
        <AppHeader name="Ledger" tagline={HOUSEHOLD_TAGLINE} glyph={<Glyph />} />
        <main className="stack">
          <NoHousehold />
        </main>
        <AppFooter version={TOOL_VERSION} termsHref="/terms.html" />
      </div>
    );
  }

  return (
    <div className="shell stack">
      <AppHeader name="Ledger" tagline={HOUSEHOLD_TAGLINE} glyph={<Glyph />} />
      <nav className="tabs" aria-label="Screens">
        <button type="button" aria-pressed={tab === "home"} onClick={() => setTab("home")}>
          Home
        </button>
        <button type="button" aria-pressed={tab === "stats"} onClick={() => setTab("stats")}>
          Stats
        </button>
        <button type="button" aria-pressed={tab === "period"} onClick={() => setTab("period")}>
          Period
        </button>
        <button type="button" aria-pressed={tab === "history"} onClick={() => setTab("history")}>
          History
        </button>
        <button type="button" aria-pressed={tab === "receipt"} onClick={() => setTab("receipt")}>
          Receipt
        </button>
        <button type="button" aria-pressed={tab === "paste"} onClick={() => setTab("paste")}>
          Paste
        </button>
        <button type="button" aria-pressed={tab === "inbox"} onClick={() => setTab("inbox")}>
          Inbox{waiting === null || waiting === 0 ? "" : ` (${String(waiting)})`}
        </button>
        <button type="button" aria-pressed={tab === "rules"} onClick={() => setTab("rules")}>
          Rules
        </button>
        <button type="button" aria-pressed={tab === "spending"} onClick={() => setTab("spending")}>
          Categories
        </button>
        <button type="button" aria-pressed={tab === "salaries"} onClick={() => setTab("salaries")}>
          Salaries
        </button>
        <button type="button" aria-pressed={tab === "import"} onClick={() => setTab("import")}>
          Import
        </button>
        {me !== null && (
          <button
            type="button"
            aria-pressed={tab === "household"}
            onClick={() => setTab("household")}
          >
            Household
          </button>
        )}
        {me?.admin === true && (
          <button type="button" aria-pressed={tab === "admin"} onClick={() => setTab("admin")}>
            Admin
          </button>
        )}
      </nav>
      <main className="stack">
        <PeopleNamesProvider value={names}>
          {tab === "home" && <Home />}
          {tab === "stats" && <Stats />}
          {tab === "period" && <Periods />}
          {tab === "history" && <History />}
          {tab === "receipt" && <Receipts />}
          {tab === "paste" && <StatementPaste onOpenInbox={() => setTab("inbox")} />}
          {tab === "inbox" && <Inbox />}
          {tab === "rules" && <Rules />}
          {tab === "spending" && <Spending />}
          {tab === "salaries" && (
            <>
              <Salaries />
              <MortgageSplitCard />
            </>
          )}
          {tab === "import" && <ImportWorkbook />}
          {tab === "household" && me !== null && <Household id={me.person.household} />}
          {tab === "admin" && me?.admin === true && <Admin />}
        </PeopleNamesProvider>
      </main>
      <AppFooter version={TOOL_VERSION} termsHref="/terms.html" />
    </div>
  );
}
