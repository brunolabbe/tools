/**
 * lg-89's Done when 7: the owner's paid read of the three synthetic receipts,
 * through the reader the API uses, at its default model. **It spends money**
 * (three reads), so it is a script and never a suite, and it refuses to run
 * without `--paid`. It reads its key from a file, never the environment: the
 * file holds the key alone, or a `LEDGER=<key>` line among others.
 *
 *     node --import tsx tools/ledger/receipts/test/live/read-rebate-fixtures.ts \
 *       --paid .claude/.keys <out.json>
 *
 * It prints one verdict line per receipt and writes every item read to
 * `<out.json>`; the exit code is 0 only when all three read as lg-89 expects
 * (`rebate-fixtures.ts`). The verdict lines are what lg-89's Log records.
 *
 * Not a suite (`rebate-fixtures.ts` says why it lives here).
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { ReceiptProposal } from "@ledger/contract";
import { createModelReader } from "../../src/index.ts";
import { FIXTURES, REBATE_FIXTURES, wrong } from "./rebate-fixtures.ts";

const [flag, keyFile, out] = process.argv.slice(2);
if (flag !== "--paid" || keyFile === undefined || out === undefined) {
  process.stderr.write(
    "usage: read-rebate-fixtures.ts --paid <key-file> <out.json>\n" +
      "Three paid reads: --paid is the consent, and nothing is sent without it.\n",
  );
  process.exit(2);
}

function keyFrom(file: string): string {
  const text = readFileSync(file, "utf8");
  const line = text.split(/\r?\n/u).find((each) => each.startsWith("LEDGER="));
  return (line === undefined ? text : line.slice("LEDGER=".length)).trim();
}

const reader = createModelReader({ provider: "anthropic", apiKey: keyFrom(keyFile) });
const results: { name: string; verdict: string; proposals: ReceiptProposal[] }[] = [];
for (const fixture of REBATE_FIXTURES) {
  const bytes = readFileSync(path.join(FIXTURES, `${fixture.name}.png`));
  const proposals = await reader.read({ bytes, mediaType: "image/png" });
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
