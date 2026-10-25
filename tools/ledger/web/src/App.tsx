/**
 * The shell: the home screen and the salaries (lg-5), the paste screen (lg-2),
 * the inbox and the rules (lg-4), the period (lg-6), and the spending
 * categories (lg-15) and the history's charts (lg-9), and a receipt photographed
 * and filed (lg-8).
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
 * screen (`people.tsx`), again on every change of tab, so a rename made on the
 * admin's screen is on the next one opened. Until it answers, or if it fails,
 * each person is shown under their id.
 */

import { useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { HealthResponse, MeResponse } from "@ledger/contract";
import { Admin } from "./admin/Admin.tsx";
import { fetchHealth } from "./api/health.ts";
import { fetchAdminHouseholds } from "./api/households.ts";
import { fetchInbox } from "./api/inbox.ts";
import { fetchMe } from "./api/me.ts";
import { fetchPeopleNames } from "./api/people.ts";
import { History } from "./history/History.tsx";
import { Home } from "./home/Home.tsx";
import { Household } from "./household/Household.tsx";
import { Inbox } from "./inbox/Inbox.tsx";
import { NoHousehold } from "./NoHousehold.tsx";
import { PeopleNamesProvider } from "./people.tsx";
import type { ShownNames } from "./people.tsx";
import { Periods } from "./periods/Periods.tsx";
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
  | "household"
  | "admin";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("home");
  const [waiting, setWaiting] = useState<number | null>(null);
  // Bumped when a paste is stored, which leaves rows waiting with no change of tab.
  const [stored, setStored] = useState(0);
  const [inNoHousehold, setInNoHousehold] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [adminOnly, setAdminOnly] = useState(false);
  const [names, setNames] = useState<ShownNames>({});

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal)
      .then(setMe)
      .catch(async (error: unknown) => {
        if (controller.signal.aborted || AppError.from(error).code !== "FORBIDDEN") return;
        // An admin in no household, or nobody the ledger knows: only the admin
        // list's FORBIDDEN says the second. Any other failure of it leaves the
        // shell, as /api/me's own does (lg-22's gate 1, F2).
        try {
          await fetchAdminHouseholds(controller.signal);
          if (!controller.signal.aborted) setAdminOnly(true);
        } catch (adminError: unknown) {
          if (!controller.signal.aborted && AppError.from(adminError).code === "FORBIDDEN") {
            setInNoHousehold(true);
          }
        }
      });
    return () => controller.abort();
  }, []);

  // Asked again on every change of tab, and when a paste is stored (lg-54): a
  // person who stays on the paste screen sees the new number at once.
  // A failure keeps the number shown before: the inbox says what went wrong when opened.
  useEffect(() => {
    const controller = new AbortController();
    fetchInbox(controller.signal)
      .then((rows) => setWaiting(rows.length))
      .catch(() => undefined);
    return () => controller.abort();
    // `tab` and `stored` are triggers: the request reads neither, and asks again when either changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tab, stored]);

  // Only a member has books to ask; a failure keeps the map it had.
  const member = me !== null;
  useEffect(() => {
    if (!member) return;
    const controller = new AbortController();
    fetchPeopleNames(controller.signal)
      .then(setNames)
      .catch(() => undefined);
    return () => controller.abort();
    // `tab` is a trigger: the request does not read it, and asks again when it changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [tab, member]);

  if (adminOnly) {
    return (
      <div className="shell">
        <header>
          <h1>Ledger</h1>
          <p className="muted">Admin</p>
        </header>
        <main>
          <Admin />
        </main>
        <Health />
      </div>
    );
  }

  if (inNoHousehold) {
    return (
      <div className="shell">
        <header>
          <h1>Ledger</h1>
        </header>
        <main>
          <NoHousehold />
        </main>
        <Health />
      </div>
    );
  }

  return (
    <div className="shell">
      <header>
        <h1>Ledger</h1>
        <p className="muted">The household&rsquo;s shared account.</p>
      </header>
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
      <main>
        <PeopleNamesProvider value={names}>
          {tab === "home" && <Home />}
          {tab === "stats" && <Stats />}
          {tab === "period" && <Periods />}
          {tab === "history" && <History />}
          {tab === "receipt" && <Receipts />}
          {tab === "paste" && (
            <StatementPaste
              onStored={() => setStored((count) => count + 1)}
              onOpenInbox={() => setTab("inbox")}
            />
          )}
          {tab === "inbox" && <Inbox onCount={setWaiting} />}
          {tab === "rules" && <Rules />}
          {tab === "spending" && <Spending />}
          {tab === "salaries" && (
            <>
              <Salaries />
              <MortgageSplitCard />
            </>
          )}
          {tab === "household" && me !== null && <Household id={me.person.household} />}
          {tab === "admin" && me?.admin === true && <Admin />}
        </PeopleNamesProvider>
      </main>
      <Health />
    </div>
  );
}

type Status =
  | { state: "loading" }
  | { state: "ready"; health: HealthResponse }
  | { state: "failed"; message: string };

function Health(): React.ReactElement {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setStatus({ state: "ready", health }))
      .catch((error: unknown) => {
        // A cancelled request is the effect being cleaned up, not a failure to
        // report — under StrictMode it happens on every mount in development.
        if (controller.signal.aborted) return;
        setStatus({ state: "failed", message: AppError.from(error).message });
      });
    return () => controller.abort();
  }, []);

  return (
    <footer className="health muted" aria-live="polite">
      {status.state === "loading" && <p>Checking the server…</p>}
      {status.state === "failed" && <p className="bad">{status.message}</p>}
      {status.state === "ready" && <p>Server v{status.health.version}</p>}
    </footer>
  );
}
