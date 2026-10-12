/**
 * Entry point of `npm run household:ledger` (lg-20). Everything is in
 * `household-command.ts`; this file owns only the process, as `main.ts` does
 * for the server.
 */

import process from "node:process";
import { runHouseholdCommand } from "./household-command.ts";

process.exitCode = runHouseholdCommand(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
  cwd: process.env["INIT_CWD"] ?? process.cwd(),
  now: () => new Date(),
});
