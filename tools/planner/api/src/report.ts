/**
 * Process entry point for the cost report: `node tools/planner/api/dist/report.js --days N`.
 *
 * Owns the two things `cost-report.ts` must not — the process's streams and its
 * exit code — the way `main.ts` owns the socket for `server.ts`. The report
 * itself writes to stdout, which this tool keeps free for data; errors go to
 * stderr. See `cost-report.ts` for what it prints and what it refuses to.
 */

import process from "node:process";
import { runReport } from "./cost-report.ts";

process.exitCode = runReport({
  argv: process.argv.slice(2),
  env: process.env,
  now: new Date(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
