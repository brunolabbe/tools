/**
 * Entry point of `npm run backfill-spending:ledger` (lg-53). Everything is in
 * `spending-backfill-command.ts`; this file owns only the process, as `main.ts`
 * does for the server.
 */

import process from "node:process";
import { runSpendingBackfillCommand } from "./spending-backfill-command.ts";

process.exitCode = runSpendingBackfillCommand(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.env["INIT_CWD"] ?? process.cwd(),
  now: () => new Date(),
});
