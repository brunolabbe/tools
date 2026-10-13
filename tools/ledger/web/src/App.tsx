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
 */

import { useEffect, useState } from "react";
import { AppError } from "@ledger/contract";
import type { HealthResponse } from "@ledger/contract";
import { fetchHealth } from "./api/health.ts";
import { fetchInbox } from "./api/inbox.ts";
import { fetchMe } from "./api/me.ts";
import { Home } from "./home/Home.tsx";
import { Inbox } from "./inbox/Inbox.tsx";
import { NoHousehold } from "./NoHousehold.tsx";
import { Periods } from "./periods/Periods.tsx";
import { Receipts } from "./receipts/Receipts.tsx";
import { Rules } from "./rules/Rules.tsx";
import { Salaries } from "./salaries/Salaries.tsx";
import { Spending } from "./spending/Spending.tsx";
import { Stats } from "./stats/Stats.tsx";
import { StatementPaste } from "./statements/StatementPaste.tsx";

type Tab =
  | "home"
  | "stats"
  | "period"
  | "receipt"
  | "paste"
  | "inbox"
  | "rules"
  | "spending"
  | "salaries";

export function App(): React.ReactElement {
  const [tab, setTab] = useState<Tab>("home");
  const [waiting, setWaiting] = useState<number | null>(null);
  const [inNoHousehold, setInNoHousehold] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted && AppError.from(error).code === "FORBIDDEN") {
        setInNoHousehold(true);
      }
    });
    return () => controller.abort();
  }, []);

  // Asked again on every change of tab, which is when a paste has just left some.
  // A failure leaves the number out: the inbox says what went wrong when opened.
  useEffect(() => {
    const controller = new AbortController();
    fetchInbox(controller.signal)
      .then((rows) => setWaiting(rows.length))
      .catch(() => undefined);
    return () => controller.abort();
  }, [tab]);

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
      </nav>
      <main>
        {tab === "home" && <Home />}
        {tab === "stats" && <Stats />}
        {tab === "period" && <Periods />}
        {tab === "receipt" && <Receipts />}
        {tab === "paste" && <StatementPaste />}
        {tab === "inbox" && <Inbox onCount={setWaiting} />}
        {tab === "rules" && <Rules />}
        {tab === "spending" && <Spending />}
        {tab === "salaries" && <Salaries />}
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
