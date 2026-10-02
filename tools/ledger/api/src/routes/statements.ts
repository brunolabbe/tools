/**
 * `POST /api/statements`: store a pasted AccèsD statement (lg-2).
 *
 * The route reads the body, names the caller and answers with the report; what
 * storing means is `importStatement`'s. It sits behind the identity check like
 * every API route but health, and records who pasted from `personOf` — never
 * from anything the body says.
 */

import { AppError, ROUTES, importStatementRequestSchema } from "@ledger/contract";
import type { ImportStatementReport } from "@ledger/contract";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.ts";
import { personOf } from "../identity.ts";
import { importStatement } from "../statements.ts";

export function registerStatementRoutes(app: FastifyInstance, context: AppContext): void {
  app.post(ROUTES.statements, async (request) => {
    const body = importStatementRequestSchema.safeParse(request.body);
    if (!body.success) {
      // The issues name a field, never a value: the body is a bank statement.
      throw new AppError("BAD_REQUEST", "Send the pasted statement as { text }, and not empty.");
    }
    const report: ImportStatementReport = importStatement(
      { db: context.db, personId: personOf(request).id, now: context.now },
      body.data.text,
    );
    return report;
  });
}
