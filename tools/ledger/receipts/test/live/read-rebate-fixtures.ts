/**
 * lg-89's Done when 7: the owner's paid read of the three synthetic receipts,
 * through the reader the API uses, at its default model. **It spends money**
 * (three reads), so it is a script and never a suite, and it refuses to run
 * without `--paid`. It reads its key from a file, never the environment: the
 * file holds the key alone, or a `LEDGER=<key>` line among others. It refuses
 * to run with `ANTHROPIC_CUSTOM_HEADERS` set, which the SDK applies to every
 * request whatever the client is given (`paid-read.ts`, pl-39).
 *
 *     node --import tsx tools/ledger/receipts/test/live/read-rebate-fixtures.ts \
 *       --paid .claude/.keys <out.json>
 *
 * It prints one verdict line per receipt and writes every item read to
 * `<out.json>`; the exit code is 0 only when all three read as lg-89 expects
 * (`rebate-fixtures.ts`). The verdict lines are what lg-89's Log records. A
 * read that fails prints its error's code and nothing else: the SDK's own
 * messages can hold the key.
 *
 * Not a suite (`rebate-fixtures.ts` says why it lives here).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { ReceiptProposal } from "@ledger/contract";
import { createModelReader } from "../../src/index.ts";
import { assertPaidReadConsent, failureNote, keyFrom } from "./paid-read.ts";
import { FIXTURES, REBATE_FIXTURES, wrong } from "./rebate-fixtures.ts";

function refuse(error: unknown): never {
  process.stderr.write(`${error instanceof Error ? error.message : "Refusing."}\n`);
  process.exit(2);
}

let keyFile = "";
let out = "";
let apiKey = "";
try {
  ({ keyFile, out } = assertPaidReadConsent(process.argv.slice(2), process.env));
  apiKey = keyFrom(readFileSync(keyFile, "utf8"));
} catch (error: unknown) {
  refuse(error);
}

const reader = createModelReader({ provider: "anthropic", apiKey });
const results: { name: string; verdict: string; proposals: ReceiptProposal[] }[] = [];
for (const fixture of REBATE_FIXTURES) {
  const bytes = readFileSync(path.join(FIXTURES, `${fixture.name}.png`));
  let proposals: ReceiptProposal[];
  try {
    proposals = await reader.read({ bytes, mediaType: "image/png" });
  } catch (error: unknown) {
    process.stderr.write(`${fixture.name}: the read failed: ${failureNote(error)}\n`);
    process.exit(1);
  }
  const items = proposals.flatMap((proposal) => proposal.items);
  const why =
    proposals.length === 1 ? wrong(fixture, items) : `${String(proposals.length)} receipts read`;
  const verdict = why === null ? "pass" : `FAIL: ${why}`;
  results.push({ name: fixture.name, verdict, proposals });
  process.stdout.write(`${fixture.name}: ${verdict} (${reader.model})\n`);
}
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`wrote ${out}\n`);
process.exit(results.every((result) => result.verdict === "pass") ? 0 : 1);
