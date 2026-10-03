/**
 * Shared by the rules and the classification tests (lg-4): an app whose caller
 * is whoever the test names, a small invented history, and the calls both suites
 * make. Nothing here is a real row or a real caisse.
 */

import { ROUTES } from "@ledger/contract";
import type { InboxResponse, Rule, RuleDraft } from "@ledger/contract";
import { createApp } from "../../src/server.ts";
import type { App } from "../../src/server.ts";
import { ALEX, accessConfig } from "./access.ts";
import { renderPaste, withBalances } from "./paste.ts";
import type { PasteRow } from "./paste.ts";

/** Whoever the development identity names is the caller; no token is needed. */
export async function startApp(
  person: string = ALEX,
  now: () => Date = () => new Date("2026-10-03T09:30:00Z"),
): Promise<App> {
  return await createApp({
    config: {
      databasePath: ":memory:",
      logLevel: "silent",
      access: accessConfig({ devIdentity: person }),
    },
    now,
  });
}

export const TRANSFER = "Virement entre folios /Caisse du Lac";
export const MORTGAGE = "Hypothèque /Prêteur Exemple";
export const GROCERIES = "Achat /Marché Exemple";

/** Oldest first. The second transfer is not the usual amount; the groceries match no rule. */
export const HISTORY: PasteRow[] = [
  { date: "2026-09-02", description: TRANSFER, amountCents: 40000 },
  {
    date: "2026-09-12",
    category: "Loyer/Prêt hypothécaire",
    description: MORTGAGE,
    amountCents: -70000,
  },
  { date: "2026-09-14", description: TRANSFER, amountCents: 45000 },
  { date: "2026-09-20", category: "Épicerie", description: GROCERIES, amountCents: -12345 },
];

export function paste(from = 0, to = HISTORY.length): string {
  return renderPaste(withBalances(HISTORY, 150000).slice(from, to));
}

export const TRANSFER_RULE: RuleDraft = {
  descriptionPattern: TRANSFER,
  category: "Virements",
  amountCents: 40000,
  personId: "sam",
  bucket: "mortgage",
};

export const MORTGAGE_RULE: RuleDraft = {
  descriptionPattern: "Hypothèque*",
  category: null,
  amountCents: null,
  personId: null,
  bucket: "mortgage",
};

export async function addRule(target: App, draft: RuleDraft): Promise<Rule> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.rules,
    payload: draft,
  });
  if (response.statusCode !== 200) throw new Error(`rule refused: ${response.body}`);
  return response.json<Rule>();
}

export async function pasteStatement(target: App, text = paste()): Promise<void> {
  const response = await target.server.inject({
    method: "POST",
    url: ROUTES.statements,
    payload: { text },
  });
  if (response.statusCode !== 200) throw new Error(`paste refused: ${response.body}`);
}

export async function readInbox(target: App): Promise<InboxResponse["rows"]> {
  const response = await target.server.inject({ method: "GET", url: ROUTES.inbox });
  return response.json<InboxResponse>().rows;
}

export interface StoredClassification {
  id: number;
  row_id: number;
  bucket: string;
  person_id: string | null;
  rule_id: number | null;
  source: string;
  classified_at: string;
  classified_by: string;
}

export function classifications(target: App): StoredClassification[] {
  return target.context.db
    .prepare("SELECT * FROM classifications ORDER BY id")
    .all() as StoredClassification[];
}

/** The stored row id for a description and an amount, which a paste does not hand back. */
export function rowId(target: App, description: string, amountCents: number): number {
  const found = target.context.db
    .prepare("SELECT id FROM statement_rows WHERE description = ? AND amount_cents = ?")
    .get(description, amountCents) as { id: number } | undefined;
  if (found === undefined) throw new Error(`no stored row for ${description}`);
  return found.id;
}
