/**
 * The citation gate: run `citations.mjs`'s checks over a *set* of work records
 * and fail the build on any that does not hold up.
 *
 * `citations.mjs` answers about one record and one scope. That is the right
 * shape for a person checking the record in front of them, and the wrong shape
 * for CI, which has to ask the same question of a corpus that grows by one
 * record every time a ticket is gated. This is that loop, and it is deliberately
 * the *only* one: `.github/workflows/ci.yml` runs this, not a shell `for` over a
 * glob, so widening what is enforced is an edit to `SCOPE` below rather than an
 * edit to YAML.
 *
 * **Why the scope is data.** repo-29's answered decision is option D — enforce
 * where a citation carries a verdict, the `## Review` gate records — as the
 * *first slice* of option C, corpus-wide enforcement, which the owner named as
 * the destination. So the section filter is a value in `SCOPE` and not a rule
 * written into the logic: C is `section: null`, and nothing else here changes.
 *
 * ## What it checks
 *
 * Exactly what `citations.mjs` checks, with `--require-anchors` in force. A
 * citation that carries no anchor text resolves and is *not verified* — nothing
 * compared the claim against the line — and under this gate that is a failure
 * rather than a note. The evidence is in repo-29: a citation onto a blank line,
 * five coordinates drifted onto unrelated content, and four ranges bound to the
 * wrong file entirely, all of them reported at exit 0 by an unanchored run.
 *
 * ## Why there is a grandfather list
 *
 * Because measured on `b384033` the corpus is 639 unanchored citations across 56
 * of the 63 records carrying a `## Review` section, and only **4** of those 63
 * records pass this gate today. Turning it on for all of them is not a gate, it
 * is an outage — the thing repo-29's option C says in its own words cannot be
 * done first.
 *
 * So every record that fails today is named in `GRANDFATHERED`, and every record
 * that is not on that list is enforced. That is the half that earns the gate:
 * **a `## Review` section written from now on is checked**, which is where every
 * reproduction in repo-29 comes from — all of them were produced during a live
 * review cycle rather than aged into staleness.
 *
 * **What keeps the list honest is repo-25's rule, and it is enforced in exactly
 * one direction — say which, because an earlier draft of this paragraph claimed
 * both.** A grandfathered record that now passes, or that the scope no longer
 * reaches, is an *error*, exactly as an evidence declaration that excuses
 * nothing is an error: the entry has outlived what it was for, and a waiver
 * nobody has to keep true is the failure every refusal in `citations.mjs` exists
 * to prevent. So an entry cannot survive the debt it names being paid off, and
 * the run prints how much is left on every push.
 *
 * **The other direction is a norm and not a check, and this gate does not close
 * it.** Nothing here refuses a *new* entry, and nothing notices a listed record
 * getting worse. Reproduced by repo-29's gate rather than argued: breaking an
 * anchor in a passing record and adding that record to this list in the same
 * change gives `3 enforced, 0 failing; 60 grandfathered` at **exit 0**, silently.
 * A per-record count that could only ratchet down would close it, and it was not
 * built here for a reason that is a judgement rather than an oversight — a count
 * grows when an *unrelated* branch shifts a cited file, so the ratchet would
 * turn a red build on whoever moved the source. That is a real tax on a real
 * corpus (52 `moved` in the grandfathered set the moment repo-34 lands beside
 * this), and whether the repo wants it is an owner's call, recorded as open in
 * repo-29's Log. Until it is answered, read this list as debt somebody has to
 * look at, not as a boundary the tool defends.
 *
 * ## What it does not do
 *
 * It does not anchor anything. repo-29 built and ran an automatic sweep over
 * this scope, and the sweep is why the migration is not folded in here: it minted
 * two false anchors inside the first two records inspected, one of them onto a
 * TLS *port* that repo-25's own record quotes as a known false positive. An
 * anchor that verifies the wrong thing is worse than the unanchored citation it
 * replaced, which is repo-29 option B's stated objection reproducing itself. The
 * measurement is in that ticket's Log; option B stays open.
 *
 * Plain `.mjs`, no dependencies, matching `citations.mjs` and `status.mjs` — the
 * repo's tooling answers without a build step.
 *
 * Usage:
 *   node scripts/citations-gate.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applyDeclarations,
  candidateFiles,
  checkCitations,
  extractCitations,
  extractDeclarations,
  extractSections,
  makeReader,
  makeResolver,
  selectSection,
} from "./citations.mjs";

/**
 * What is enforced. One object, because "which records, and which part of them"
 * is the whole of the policy and repo-29's option C widens it by editing these
 * two fields — `section: null` to check a whole record rather than its gate.
 *
 * The pathspecs spell `*.md` on purpose. A tools-side pathspec ending at the
 * `work` directory rather than at `*.md` matches **zero** files, because git's
 * default wildcard spans `/`, so a combined pathspec written that way silently
 * returns only `docs/work`'s records with no error. That is how repo-25's
 * builder lost every corpus figure it first reported.
 *
 * (Spelled in prose rather than quoted, because the literal form carries the
 * two characters that end a block comment.)
 */
export const SCOPE = {
  records: ["docs/work/*.md", "tools/*/docs/work/*.md"],
  section: "Review",
};

/**
 * The records whose `## Review` section predates this gate.
 *
 * Every one of them failed on `b384033`, the commit this gate was written
 * against. They are not excused for being old — they are excused because
 * repairing 639 unanchored citations is a migration with its own judgement in
 * every line, and holding the gate hostage to it is how enforcement never
 * arrives. Each removal from this list is a record somebody read.
 *
 * **Adding to it is not the way past a red gate.** A new `## Review` section
 * comes with anchors; that is what `.claude/skills/review-ticket/SKILL.md` now
 * asks of a reviewer, and this list is the debt that convention arrived too late
 * for.
 */
export const GRANDFATHERED = new Set([
  "docs/work/repo-1-generated-status-tables.md",
  "docs/work/repo-2-retire-the-status-page.md",
  "docs/work/repo-4-fixture-ignore-pattern.md",
  "docs/work/repo-11-stale-fixture-formatting-notes.md",
  "docs/work/repo-12-board-shows-merged-work.md",
  "docs/work/repo-13-codeql-false-positives-recur.md",
  "docs/work/repo-14-citations-section-flag-is-a-no-op.md",
  "docs/work/repo-15-deny-list-does-not-protect-itself.md",
  "docs/work/repo-16-suppression-does-not-dismiss.md",
  "docs/work/repo-18-citations-resolve-is-not-correct.md",
  "docs/work/repo-19-ready-does-not-mean-startable.md",
  "docs/work/repo-20-reviewer-setup-order-builds-the-wrong-tree.md",
  "docs/work/repo-21-the-orchestration-skill-outgrew-its-loop.md",
  "docs/work/repo-22-grep-is-a-wrapper.md",
  "docs/work/repo-23-deployment-reads-as-downloader-only.md",
  "docs/work/repo-24-quoted-scalars-render-with-quotes.md",
  "docs/work/repo-25-citations-checker-misses-shorthand-references.md",
  "docs/work/repo-26-no-test-runs-a-script-as-a-process.md",
  "docs/work/repo-27-difficulty-must-change-a-dispatch.md",
  "docs/work/repo-28-the-standard-sonnet-trial.md",
  "docs/work/repo-31-the-windows-leg-is-almost-all-red.md",
  "docs/work/repo-36-citations-loses-the-record-path.md",
  "tools/downloader/docs/work/dl-15-component-render-tests.md",
  "tools/downloader/docs/work/dl-16-e2e-through-the-sniffer.md",
  "tools/downloader/docs/work/dl-18-pipeline-high-water-mark.md",
  "tools/downloader/docs/work/dl-19-ffmpeg-verifies-tls.md",
  "tools/downloader/docs/work/dl-22-web-binds-the-host-it-is-given.md",
  "tools/downloader/docs/work/dl-23-rate-limit-the-download-route.md",
  "tools/downloader/docs/work/dl-32-the-job-list-has-no-caller.md",
  "tools/downloader/docs/work/dl-33-tls-fixture-certificates-fail-under-contention.md",
  "tools/downloader/docs/work/dl-34-resolver-tiers-and-the-operator-ca.md",
  "tools/downloader/docs/work/dl-35-content-security-policy.md",
  "tools/downloader/docs/work/dl-36-fixture-certificate-serials-are-negative.md",
  "tools/downloader/docs/work/dl-37-tiers-move-onto-the-terminating-proxy.md",
  "tools/downloader/docs/work/dl-38-tls-rejection-log-does-not-track-successes.md",
  "tools/downloader/docs/work/dl-40-twenty-rows-that-differ-invisibly.md",
  "tools/downloader/docs/work/dl-41-preview-in-the-completed-result.md",
  "tools/downloader/docs/work/dl-42-direct-file-claims-audio-it-never-checked.md",
  "tools/downloader/docs/work/dl-43-gate-progress-on-what-actually-happened.md",
  "tools/downloader/docs/work/dl-44-persist-the-thumbnail-beside-the-file.md",
  "tools/downloader/docs/work/dl-45-keep-the-failover-mirrors.md",
  "tools/downloader/docs/work/dl-46-rate-limit-the-probe-stage-channel.md",
  "tools/planner/docs/work/pl-5-orchestrator-and-fan-out.md",
  "tools/planner/docs/work/pl-10-plan-view-and-provenance.md",
  "tools/planner/docs/work/pl-17-dockerfile-workspace-scan.md",
  "tools/planner/docs/work/pl-18-destination-asked-early.md",
  "tools/planner/docs/work/pl-20-intake-fixture-builders.md",
  "tools/planner/docs/work/pl-24-grounding-seam-and-fixtures.md",
  "tools/planner/docs/work/pl-25-grounding-cache.md",
  "tools/planner/docs/work/pl-26-lift-the-ssrf-guard.md",
  "tools/planner/docs/work/pl-27-travel-time-reaches-the-composer.md",
  "tools/planner/docs/work/pl-28-valhalla-adapter.md",
  "tools/planner/docs/work/pl-29-detours-along-a-leg.md",
  "tools/planner/docs/work/pl-31-vite-config-in-no-tsconfig-project.md",
  "tools/planner/docs/work/pl-32-vite-config-test.md",
  "tools/planner/docs/work/pl-33-overpass-payload-and-notability.md",
  "tools/planner/docs/work/pl-34-locality-free-query-confident-wrong-place.md",
  "tools/planner/docs/work/pl-36-more-osm-attribution-gaps.md",
  "tools/planner/docs/work/pl-37-locate-cannot-see-the-trip.md",
]);

/** The states that fail this gate. `unanchored` is here; that is the whole point. */
const FAILING = new Set(["unanchored", "moved", "unresolvable"]);

/**
 * Every record the scope names, from the index rather than the filesystem, so
 * an untracked scratch file in `docs/work/` cannot fail CI.
 *
 * @param {string} repo
 * @param {string[]} pathspecs
 */
export function findRecords(repo, pathspecs) {
  const out = execFileSync("git", ["-C", repo, "ls-files", "-z", ...pathspecs], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((line) => line !== "");
}

/**
 * Check one record, or report that the scope does not reach it.
 *
 * **A record with no matching section is out of scope, not an error**, which is
 * the one place this deliberately disagrees with `citations.mjs --section`. That
 * flag refuses a name matching nothing because a typo'd section would otherwise
 * report success having checked nothing — a real risk when a human types the
 * name once. Here the name is a constant and the *record set* is the variable:
 * every ticket that has not been gated yet has no `## Review` section, and there
 * are dozens of them. Refusing those would make the gate unrunnable.
 *
 * An **ambiguous** name is still an error, and is reported as a failure: two
 * `## Review` sections in one record is a record to fix, not a scope to skip.
 *
 * @param {string} repo
 * @param {string} record
 * @param {string | null} section
 * @param {(file: string) => string[] | null} read
 * @param {(file: string) => {path: string} | {error: string}} resolve
 */
export function checkRecord(repo, record, section, read, resolve) {
  const markdown = fs.readFileSync(path.join(repo, record), "utf8");

  let chosen = null;
  if (section !== null) {
    const sections = extractSections(markdown);
    const matches = sections.filter((s) => s.title.toLowerCase() === section.toLowerCase());
    if (matches.length === 0) return { record, skipped: true };
    try {
      chosen = selectSection(sections, section);
    } catch (error) {
      return { record, skipped: false, error: /** @type {Error} */ (error).message };
    }
  }

  const inScope = (line) => chosen === null || (line >= chosen.start && line <= chosen.end);
  const citations = extractCitations(markdown).filter((c) => inScope(c.line));
  const declarations = extractDeclarations(markdown).filter((d) => inScope(d.line));
  const { results, stale } = applyDeclarations(
    checkCitations(citations, read, resolve),
    declarations,
  );

  /** @type {Record<string, number>} */
  const counts = {};
  for (const r of results) counts[r.state] = (counts[r.state] ?? 0) + 1;
  const failures = results.filter((r) => FAILING.has(r.state));

  return {
    record,
    skipped: false,
    error: null,
    total: results.length,
    counts,
    failures,
    stale,
    passed: failures.length === 0 && stale.length === 0,
  };
}

/**
 * The gate's verdict over a whole record set.
 *
 * @param {string} repo
 * @param {{records: string[], section: string | null}} scope
 * @param {Set<string>} grandfathered
 */
export function gate(repo, scope = SCOPE, grandfathered = GRANDFATHERED) {
  const read = makeReader(repo, null);
  const resolve = makeResolver(candidateFiles(repo, null));

  const inScope = [];
  const failed = [];
  const excused = [];
  /** @type {Record<string, number>} */
  const debt = {};

  for (const record of findRecords(repo, scope.records)) {
    const result = checkRecord(repo, record, scope.section, read, resolve);
    if (result.skipped) continue;
    inScope.push(result);
    if (result.passed && result.error == null) continue;
    if (grandfathered.has(record)) {
      excused.push(result);
      for (const [state, n] of Object.entries(result.counts ?? {})) {
        if (FAILING.has(state)) debt[state] = (debt[state] ?? 0) + n;
      }
      continue;
    }
    failed.push(result);
  }

  // repo-25's rule, one level up: a waiver that excuses nothing has outlived
  // what it was for. A grandfathered record that now passes, or that the scope
  // no longer reaches at all, is an entry to delete — and saying so is what
  // keeps the list shrinking without anybody remembering to prune it.
  const reached = new Set(inScope.map((r) => r.record));
  const staleEntries = [...grandfathered]
    .filter((record) => !reached.has(record) || excused.every((r) => r.record !== record))
    .map((record) => ({
      record,
      why: reached.has(record)
        ? "passes this gate now"
        : "is no longer a record with a matching section",
    }));

  return { inScope, failed, excused, staleEntries, debt };
}

/** The `state: count` half of a record's line, worst first and zeroes dropped. */
const countLine = (counts) =>
  ["unresolvable", "moved", "unanchored", "unchecked", "evidence", "verified"]
    .filter((state) => (counts[state] ?? 0) > 0)
    .map((state) => `${counts[state]} ${state}`)
    .join(", ");

function main() {
  if (process.argv.length > 2) {
    process.stderr.write("usage: node scripts/citations-gate.mjs\n");
    process.exitCode = 1;
    return;
  }

  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { inScope, failed, excused, staleEntries, debt } = gate(repo);

  const scope = SCOPE.section === null ? "every citation" : `the "${SCOPE.section}" section`;
  process.stdout.write(
    `citation gate — ${scope} of ${inScope.length} record(s), anchors required\n\n`,
  );

  for (const result of failed) {
    if (result.error != null) {
      process.stdout.write(`  FAIL ${result.record}\n         ${result.error.split("\n")[0]}\n`);
      continue;
    }
    process.stdout.write(`  FAIL ${result.record} — ${countLine(result.counts)}\n`);
    for (const f of result.failures) {
      const range = f.start === f.end ? `${f.start}` : `${f.start}-${f.end}`;
      const where = f.file === null ? `:${range}` : `${f.file}:${range}`;
      process.stdout.write(
        `         ${f.state.padEnd(12)} ${where}  (record line ${f.line})\n` +
          `                      ${f.reason}\n`,
      );
    }
    for (const s of result.stale) process.stdout.write(`         declaration  ${s.reason}\n`);
  }

  for (const entry of staleEntries) {
    process.stdout.write(`  STALE ${entry.record} — ${entry.why}\n`);
  }

  const enforced = inScope.length - excused.length;
  process.stdout.write(
    `\n${enforced} enforced, ${failed.length} failing; ` +
      `${excused.length} grandfathered, holding ${countLine(debt) || "nothing"}.\n`,
  );

  if (failed.length === 0 && staleEntries.length === 0) return;

  const advice = [];
  if (failed.length > 0) {
    advice.push(
      `${failed.length} record(s) failed. Every citation under a \`## Review\` heading must carry a\n` +
        `fragment of the line it points at — \`file.ts:120 "a fragment of the line"\` — and must still\n` +
        `resolve. Run \`node scripts/citations.mjs <record> --section Review --require-anchors\` for the\n` +
        `full per-citation output on one of them. Adding a record to GRANDFATHERED is not the fix:\n` +
        `that list is repo-29's migration debt, and it only shrinks.`,
    );
  }
  if (staleEntries.length > 0) {
    advice.push(
      `${staleEntries.length} GRANDFATHERED entr(y/ies) in scripts/citations-gate.mjs excuse nothing and\n` +
        `should be deleted. A waiver nobody has to keep true is a rubber stamp — the same rule\n` +
        `citations.mjs applies to an evidence declaration that excuses a citation which now passes.`,
    );
  }
  process.stderr.write(`\n${advice.join("\n\n")}\n`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${/** @type {Error} */ (error).message}\n`);
    process.exitCode = 1;
  }
}
