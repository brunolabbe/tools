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
 *   node scripts/citations-gate.mjs [--against <ref>]
 *
 * `--against` is the ratchet's memory: it compares this tree's `GRANDFATHERED`
 * with the one at `ref` and fails on any entry whose number went up, an absent
 * entry counting as zero. Without it this reads only the current tree, which is
 * the right default for a local run and is exactly why an accurate number could
 * silence a regression until the owner asked for this.
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
 * The records whose `## Review` section predates this gate, and **how much debt
 * each one is allowed to hold**.
 *
 * Every one of them failed on `b384033`, the commit this gate was written
 * against. They are not excused for being old — they are excused because
 * repairing 741 failing references is a migration with its own judgement in
 * every line, and holding the gate hostage to it is how enforcement never
 * arrives. Each removal from this list is a record somebody read.
 *
 * **The number is the ratchet, and it is why this is a Map and not a Set.** A
 * record may hold the failures its entry names and no more. Exceed it and the
 * run says `WORSE` and fails; drop below it and the entry is `STALE` and must be
 * tightened. So the list moves one way as records are repaired, and a break in a
 * listed record is caught the moment it takes that record past its number.
 *
 * That was a real hole, not a hypothetical: with bare paths, breaking an anchor
 * in a passing record and adding that record here in the same change gave
 * `3 enforced, 0 failing` at exit 0, silently. The cost of closing it is that an
 * unrelated branch which shifts a cited file turns this red and has to repoint —
 * **accepted knowingly by the owner on 2026-09-08**, on the reasoning that the
 * failure is already happening and is better loud than silent. repo-29's Log
 * carries the decision and the measurement behind it.
 *
 * ## What the ratchet does not defend against on its own
 *
 * Stated because an earlier draft of this docblock claimed more than it had.
 *
 * **A number that is exactly right is silent to `gate` alone**, and that is what
 * an entry *means* rather than a bug in it. Reproduced by repo-29's gate, three
 * runs on one record:
 *
 *   A. break a citation in a passing record and add that record here at its
 *      exact new count — `3 enforced, 0 failing`, **exit 0**;
 *   B. break a second citation in it, entry untouched — `WORSE … 2 failing, and
 *      its GRANDFATHERED entry allows 1`, **exit 1**;
 *   C. raise the entry from 1 to 2 in the same change — **exit 0**, absorbed.
 *
 * B is the in-tree ratchet working. **A and C are what `compareAgainst` is
 * for**, and both now fail: `RAISED … its GRANDFATHERED entry went from 0 to 1`
 * and `from 4 to 5`, exit 1, because an entry's previous value is a fact about
 * the base branch and nothing in the current tree can supply it. The owner chose
 * that over a per-entry justification string on the reasoning that anyone
 * willing to paste a number will also write a sentence, and accepted its cost
 * knowingly: **a legitimate increase now has to be argued for in review instead
 * of landing quietly.** There is deliberately no escape hatch for one.
 *
 * ## What is left, which is smaller and still real
 *
 * - **A base that never had this file is excused, and has to be.** It is what
 *   the branch introducing this gate hits: nothing to compare against, `No
 *   history compared` printed rather than assumed, and the founding 59 entries
 *   accepted unchecked. That window cannot be closed without failing the commit
 *   that opens it, and it stays open exactly as long as there is no earlier list
 *   — which is once, for one branch, ever.
 *
 *   **What used to be here as well, and is not any more: the same window
 *   reopening.** An earlier draft said the bootstrap "happens exactly once";
 *   that was falsified rather than argued, by three commits in a scratch
 *   repository — an honest list, a commit deleting this file outright, and a
 *   third re-adding it with `9999` where the `1` had been. The third compared
 *   against the second reported `raised: []`. It now refuses, because
 *   `compareAgainst` asks `git log` whether the base's history ever carried this
 *   file: never had it is a bootstrap, had it and lost it is a deletion, and
 *   only the first is excused. The disclosure it replaces was correct for one
 *   day and is kept in repo-29's Log with the decision that reversed it.
 *
 *   **Renaming this file used to evade that probe**, in one commit rather than
 *   the deletion route's two: rename the script, repoint `SELF`, update
 *   `ci.yml`'s invocation, and set an entry to exactly the debt its record
 *   really holds, and the probe asked whether the base ever carried a path that
 *   genuinely never existed, answered no, and excused the run. Found by
 *   repo-29's fourth gate and reproduced end to end — through the attacker's own
 *   renamed copy, invoked as CI invokes it — which reported `0 enforced, 0
 *   failing` and `No history compared` while absorbing a second broken citation.
 *   **`GATE_GLOB` is what closed it**, and the constant's own docblock says why a
 *   path glob rather than a content probe.
 *
 *   **The inflated version never needed it**: an entry larger than its record's
 *   debt trips the in-tree `STALE` jaw, which reads no history at all. So the
 *   silent route always required a rename *and* an exact count — the gate-2
 *   residual composing with this one — and now requires editing `GATE_GLOB` too.
 *
 *   The alternative considered and not taken was locating the base's list by
 *   *content*, and it is recorded because the numbers are the argument: `git
 *   grep -l` for the list's own declaration over a whole ref runs in **38 ms**
 *   but returns **three** paths — this file, its test, which carries the same
 *   text in a fixture, and repo-29's own record, which quotes the search string
 *   while describing this measurement. That needs a discriminator neither a test
 *   fixture nor a ticket writing about it can satisfy. The glob matches **one**
 *   path in **2 ms** and neither of the other two.
 *
 *   The content count was **two** when first written here and three by the time
 *   it was committed, because the sentence recording it created the third match.
 *   That is not a footnote: a rule keyed on "exactly one file contains this
 *   string" is defeated by *writing about the rule*, which is why the mechanism
 *   above keys on a path instead.
 *
 *   **The founding 59 are not covered by any of that**, and no later check can
 *   retroactively cover them — they were written before the comparison existed.
 *   What they rest on is an audit, and it was done: every entry compared against
 *   what its record actually holds, **59 of 59 matching exactly**, none allowing
 *   more debt than exists, four re-derived through the `citations.mjs` CLI to
 *   rule out the audit script itself being the broken thing. That is their whole
 *   guarantee and restoring this check does not touch it.
 * - **A shallow clone cannot answer "did this file ever exist here", and is
 *   refused rather than guessed at.** `git log` over a truncated history says
 *   "never" for a file it simply cannot see, which is the wrong answer arrived
 *   at confidently — this ticket's entire subject. Unreachable in this repo's CI,
 *   where the checkout is deep on purpose, and kept because the failure it
 *   prevents is silent.
 * - **A push straight to `main` compares `main` with itself and finds nothing.**
 *   Pushing to `main` is denied and this repo squash-merges, so the pull request
 *   run is the gate; a direct push would be outside more rules than this one.
 * - **A raise that survives review on the base branch is inherited as
 *   legitimate** by every branch cut afterwards. That is the intended shape —
 *   the check moves the decision to a human, it does not make it — and it is why
 *   the failure message says to repair the citations rather than the number.
 * - **`--against` is not passed by a local run**, which says `No history
 *   compared` on stdout. Silence there would be the worst of both, so it is
 *   stated on every run, clean ones included.
 *
 * **Adding to it is not the way past a red gate.** A new `## Review` section
 * comes with anchors; that is what `.claude/skills/review-ticket/SKILL.md` now
 * asks of a reviewer, and this list is the debt that convention arrived too late
 * for.
 */
export const GRANDFATHERED = new Map([
  ["docs/work/repo-1-generated-status-tables.md", 16],
  ["docs/work/repo-11-stale-fixture-formatting-notes.md", 4],
  ["docs/work/repo-12-board-shows-merged-work.md", 8],
  ["docs/work/repo-13-codeql-false-positives-recur.md", 30],
  ["docs/work/repo-14-citations-section-flag-is-a-no-op.md", 6],
  ["docs/work/repo-15-deny-list-does-not-protect-itself.md", 3],
  ["docs/work/repo-16-suppression-does-not-dismiss.md", 12],
  ["docs/work/repo-18-citations-resolve-is-not-correct.md", 23],
  ["docs/work/repo-19-ready-does-not-mean-startable.md", 23],
  ["docs/work/repo-2-retire-the-status-page.md", 4],
  ["docs/work/repo-20-reviewer-setup-order-builds-the-wrong-tree.md", 10],
  ["docs/work/repo-21-the-orchestration-skill-outgrew-its-loop.md", 2],
  ["docs/work/repo-22-grep-is-a-wrapper.md", 14],
  ["docs/work/repo-23-deployment-reads-as-downloader-only.md", 4],
  ["docs/work/repo-24-quoted-scalars-render-with-quotes.md", 16],
  ["docs/work/repo-25-citations-checker-misses-shorthand-references.md", 12],
  ["docs/work/repo-26-no-test-runs-a-script-as-a-process.md", 4],
  ["docs/work/repo-27-difficulty-must-change-a-dispatch.md", 5],
  ["docs/work/repo-28-the-standard-sonnet-trial.md", 1],
  ["docs/work/repo-31-the-windows-leg-is-almost-all-red.md", 3],
  ["docs/work/repo-36-citations-loses-the-record-path.md", 28],
  ["docs/work/repo-4-fixture-ignore-pattern.md", 3],
  ["tools/downloader/docs/work/dl-15-component-render-tests.md", 57],
  ["tools/downloader/docs/work/dl-16-e2e-through-the-sniffer.md", 6],
  ["tools/downloader/docs/work/dl-18-pipeline-high-water-mark.md", 26],
  ["tools/downloader/docs/work/dl-19-ffmpeg-verifies-tls.md", 20],
  ["tools/downloader/docs/work/dl-22-web-binds-the-host-it-is-given.md", 4],
  ["tools/downloader/docs/work/dl-23-rate-limit-the-download-route.md", 5],
  ["tools/downloader/docs/work/dl-32-the-job-list-has-no-caller.md", 29],
  ["tools/downloader/docs/work/dl-33-tls-fixture-certificates-fail-under-contention.md", 20],
  ["tools/downloader/docs/work/dl-34-resolver-tiers-and-the-operator-ca.md", 9],
  ["tools/downloader/docs/work/dl-35-content-security-policy.md", 17],
  ["tools/downloader/docs/work/dl-36-fixture-certificate-serials-are-negative.md", 8],
  ["tools/downloader/docs/work/dl-37-tiers-move-onto-the-terminating-proxy.md", 9],
  ["tools/downloader/docs/work/dl-38-tls-rejection-log-does-not-track-successes.md", 13],
  ["tools/downloader/docs/work/dl-40-twenty-rows-that-differ-invisibly.md", 6],
  ["tools/downloader/docs/work/dl-41-preview-in-the-completed-result.md", 7],
  ["tools/downloader/docs/work/dl-42-direct-file-claims-audio-it-never-checked.md", 8],
  ["tools/downloader/docs/work/dl-43-gate-progress-on-what-actually-happened.md", 19],
  ["tools/downloader/docs/work/dl-44-persist-the-thumbnail-beside-the-file.md", 4],
  ["tools/downloader/docs/work/dl-45-keep-the-failover-mirrors.md", 23],
  ["tools/downloader/docs/work/dl-46-rate-limit-the-probe-stage-channel.md", 10],
  ["tools/planner/docs/work/pl-10-plan-view-and-provenance.md", 17],
  ["tools/planner/docs/work/pl-25-grounding-cache.md", 23],
  ["tools/planner/docs/work/pl-28-valhalla-adapter.md", 38],
  ["tools/planner/docs/work/pl-29-detours-along-a-leg.md", 11],
  ["tools/planner/docs/work/pl-32-vite-config-test.md", 22],
  ["tools/planner/docs/work/pl-36-more-osm-attribution-gaps.md", 12],
]);

/** The states that fail this gate. `unanchored` is here; that is the whole point. */
const FAILING = new Set(["unanchored", "moved", "unresolvable"]);

/** This file, as git names it — the thing `--against` reads an older copy of. */
export const SELF = "scripts/citations-gate.mjs";

/**
 * Every path a gate file could plausibly live at, as a git pathspec.
 *
 * **The history probe uses this rather than `SELF`, and that is the whole of the
 * rename defence.** Asking "did the base ever carry `SELF`" is defeated by
 * renaming the file: the new path genuinely never existed there, so the answer
 * is honestly no and the run takes the excused bootstrap path. Asking "did the
 * base ever carry *a gate file*" is not, because the old name still matches.
 *
 * Measured before it was built rather than assumed, since a probe that matched
 * too much would refuse every legitimate first run: this matches **one** path in
 * the tree, in **2 ms**. It does not match `scripts/test/citations-gate.test.ts`,
 * whose fixtures carry the same declaration text, nor repo-29's own record,
 * which quotes it while describing the measurement — both of which a
 * *content*-based probe does match, and which is why this is a path glob and not
 * that.
 *
 * **It is a guardrail and not a boundary, in the same sense the repo's deny list
 * is.** Someone renaming the file can edit this line too, and renaming it to a
 * path outside the glob *and* editing this line evades the check — a bigger,
 * stranger diff than the one it closes, and no in-tree constant can do better
 * than make the diff louder.
 *
 * **Editing this line is necessary and not merely sufficient**, which is the
 * difference between a residual that reads as one of several routes and one that
 * has a tell. Measured by repo-29's fifth gate and reproduced here: renaming to
 * `scripts/gate.mjs` while leaving this constant alone still **refuses**, exit 1,
 * because the unedited glob goes on matching the *old* filename in the base's
 * history. Only editing it as well reaches `No history compared` at exit 0. So
 * the residual costs an edit to the one constant whose whole job is catching
 * renames — which is about the strongest tell a diff in this repo can carry.
 */
export const GATE_GLOB = "scripts/citations-gate*.mjs";

/**
 * The `GRANDFATHERED` entries as a source file spells them.
 *
 * **Parsed textually rather than imported, and that is not laziness.** The copy
 * being compared against is a git blob from another commit; importing it would
 * mean writing it somewhere and resolving its own `./citations.mjs` import
 * against that location, which either pollutes `scripts/` with a file the linter
 * and formatter would pick up, or fails outright from a temp directory. A regex
 * over a literal this file also owns is the smaller risk, and this function is
 * pinned against the live constant by a test so the two cannot drift.
 *
 * Returns `null` when the file carries no `GRANDFATHERED` block at all, which is
 * a real state rather than an error: it is what every commit before this gate
 * existed looks like.
 *
 * @param {string} source
 * @returns {Map<string, number> | null}
 */
export function parseGrandfathered(source) {
  const block = /export const GRANDFATHERED = new Map\(\[([\s\S]*?)\n\]\);/.exec(source);
  if (block === null) return null;
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const entry of block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*(\d+)\s*\]/g)) {
    out.set(entry[1], Number(entry[2]));
  }
  return out;
}

/**
 * What this tree's `GRANDFATHERED` allows that `ref`'s did not.
 *
 * **This is the memory the ratchet does not otherwise have, and without it the
 * ratchet is silent against anyone willing to type an accurate number.** A count
 * that exactly matches a record's failures is excused by design — that is what
 * makes an entry mean "this much inherited debt" — so a citation broken in the
 * same change that adds the record at its new count, or that raises an existing
 * record's number by one, passes at exit 0 and goes on passing. Both were
 * reproduced against the live corpus before this was written. Neither is
 * reachable from the current tree alone; both are obvious the moment the
 * previous value of the number is in hand.
 *
 * **An addition is an increase.** A record absent from the base is allowed 0
 * there, so appending it at any count is caught by the same comparison rather
 * than by a rule of its own. That is the norm this file already stated in prose
 * — adding to the list is not the way past a red gate — finally enforced.
 *
 * **Lowering a number, or deleting an entry, is always allowed**, because that
 * is the ratchet turning the way it is meant to.
 *
 * Two outcomes are reported rather than swallowed and are not failures: a ref
 * whose tree has no copy of this file — every commit before this gate landed, so
 * the branch that introduces it has nothing to compare against — and no ref at
 * all, which is the ordinary local run.
 *
 * A ref that does not resolve **is** an error. Treating an unfetched ref as
 * "nothing to compare" is how this check would report success having compared
 * nothing, and in CI it means a shallow clone rather than a typo.
 *
 * @param {string} repo
 * @param {string} ref
 * @param {Map<string, number>} current
 */
export function compareAgainst(repo, ref, current = GRANDFATHERED) {
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  } catch {
    throw new Error(
      `--against ${ref}: no such commit. In CI that means the checkout was shallow — this\n` +
        `needs \`fetch-depth: 0\`, which ci.yml's changes job already sets and check now does too.`,
    );
  }

  let source;
  try {
    // stderr ignored on purpose: git's own "exists on disk, but not in <ref>" is
    // the ordinary bootstrap case here, and printing it beside this run's own
    // explanation of the same thing reads as an error when it is not one.
    source = execFileSync("git", ["-C", repo, "show", `${ref}:${SELF}`], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // The file is absent at `ref`, and the two ways that happens are not alike.
    //
    // **Genuine bootstrap**: `ref` predates this gate entirely, which is every
    // commit before the branch that introduced it. Nothing to compare against,
    // reported and not fatal, and true exactly once per branch.
    //
    // **Reset**: `ref` once had a gate file and no longer has one under the name
    // this copy answers to. Two ways that happens and they are one refusal —
    // deleting the file and re-adding it later, which repo-29's third gate
    // reproduced with `9999` sailing through, and renaming it, which its fourth
    // gate reproduced in a single commit. Both reopen the bootstrap window,
    // where any number at all is accepted unchecked.
    //
    // **The probe is `GATE_GLOB` and not `SELF`, which is what covers the
    // rename**: a renamed file's own path honestly never existed at the base, so
    // asking about it answers no; asking whether the base carried *a* gate file
    // finds the old name. Deletion and rename are deliberately not told apart in
    // the message — distinguishing them needs a second pattern in a second
    // syntax, since `git ls-tree` does not honour this pathspec, and two
    // spellings of one idea drifting apart is the defect this ticket is about.
    // One `git log`, one refusal, both named.
    const everExisted =
      git("log", "--oneline", "--max-count=1", ref, "--", GATE_GLOB).trim() !== "";
    if (everExisted) {
      throw new Error(
        `--against ${ref}: no ${SELF} there, but that branch's history carried a file matching\n` +
          `${GATE_GLOB} — so it was deleted, or this one has been renamed. Either reopens the one\n` +
          `window in which any GRANDFATHERED number is accepted unchecked, so this refuses rather\n` +
          `than excusing it. Restore the file on ${ref}, or land the rename in a change that has\n` +
          `nothing else in it.`,
      );
    }
    // A shallow clone can answer the question above with "no history, so it
    // never existed", which is the wrong answer arrived at confidently — the
    // exact failure this whole ticket is about. Refuse rather than guess.
    if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
      throw new Error(
        `--against ${ref}: no ${SELF} there, and this clone is shallow — so whether a file\n` +
          `matching ${GATE_GLOB} was ever present cannot be told from the history available.\n` +
          `\`fetch-depth: 0\` is what makes that answerable.`,
      );
    }
    return {
      skipped: `${ref} has no ${SELF} and never did, so there is no earlier list to compare against`,
      raised: [],
    };
  }

  const base = parseGrandfathered(source);
  if (base === null) {
    throw new Error(
      `--against ${ref}: ${SELF} exists there but carries no GRANDFATHERED block this can read.\n` +
        `Rather than assume it was empty — which would report every entry as new — this stops.`,
    );
  }

  const raised = [];
  for (const [record, allowed] of current) {
    const was = base.get(record) ?? 0;
    if (allowed > was) raised.push({ record, was, now: allowed });
  }
  return { skipped: null, raised };
}

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
export function checkRecord(repo, record, section, read, resolve, requireDistinct = true) {
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

  // An indistinct anchor is `verified` and still a failure here, which is the
  // one place a state and a verdict come apart. `citations.mjs` keeps the state
  // because how many lines a fragment occupies is a fact about the fragment;
  // this gate supplies the policy, exactly as it does for `unanchored`.
  const indistinct = requireDistinct
    ? results.filter((r) => r.state === "verified" && (r.occurrences ?? 1) > 1)
    : [];
  if (indistinct.length > 0) counts.indistinct = indistinct.length;
  const failures = [...results.filter((r) => FAILING.has(r.state)), ...indistinct];

  return {
    record,
    skipped: false,
    error: null,
    total: results.length,
    counts,
    failures,
    stale,
    // The number the grandfather list ratchets on. Declarations have already
    // been applied, so a citation a record legitimately declares as evidence is
    // not counted against it.
    failing: failures.length + stale.length,
    passed: failures.length === 0 && stale.length === 0,
  };
}

/**
 * The gate's verdict over a whole record set.
 *
 * @param {string} repo
 * @param {{records: string[], section: string | null}} scope
 * @param {Map<string, number>} grandfathered
 */
export function gate(repo, scope = SCOPE, grandfathered = GRANDFATHERED) {
  const read = makeReader(repo, null);
  const resolve = makeResolver(candidateFiles(repo, null));

  const inScope = [];
  const failed = [];
  const excused = [];
  const regressed = [];
  /** @type {Record<string, number>} */
  const debt = {};

  for (const record of findRecords(repo, scope.records)) {
    const result = checkRecord(repo, record, scope.section, read, resolve);
    if (result.skipped) continue;
    inScope.push(result);
    if (result.passed && result.error == null) continue;
    if (!grandfathered.has(record)) {
      failed.push(result);
      continue;
    }
    const allowed = grandfathered.get(record) ?? 0;
    // The ratchet. A listed record may hold the debt its entry names and no
    // more — so appending a record to the list no longer silences a break in
    // it, because the entry has to name a number somebody wrote down, and a
    // record that got worse exceeds it.
    if (result.failing > allowed) {
      regressed.push({ ...result, allowed });
      continue;
    }
    excused.push(result);
    for (const [state, n] of Object.entries(result.counts ?? {})) {
      if (FAILING.has(state) || state === "indistinct") debt[state] = (debt[state] ?? 0) + n;
    }
  }

  // repo-25's rule, one level up: a waiver that excuses nothing has outlived
  // what it was for. Three ways an entry can: the record passes outright, the
  // scope no longer reaches it, or it now holds *less* debt than its number
  // claims — which is the other jaw of the ratchet, and the one that makes the
  // list tighten as records are repaired rather than drift loose.
  const reached = new Map(inScope.map((r) => [r.record, r]));
  const staleEntries = [];
  for (const [record, allowed] of grandfathered) {
    const result = reached.get(record);
    if (result === undefined) {
      staleEntries.push({ record, why: "is no longer a record with a matching section" });
    } else if (result.passed && result.error == null) {
      staleEntries.push({ record, why: "passes this gate now" });
    } else if (result.failing < allowed) {
      staleEntries.push({
        record,
        why: `now holds ${result.failing} failing reference(s), not ${allowed} — tighten the number`,
      });
    }
  }

  return { inScope, failed, excused, regressed, staleEntries, debt };
}

/** The `state: count` half of a record's line, worst first and zeroes dropped. */
const countLine = (counts) =>
  ["unresolvable", "moved", "unanchored", "indistinct", "unchecked", "evidence", "verified"]
    .filter((state) => (counts[state] ?? 0) > 0)
    .map((state) => `${counts[state]} ${state}`)
    .join(", ");

const USAGE = "usage: node scripts/citations-gate.mjs [--against <ref>]";

function main() {
  const argv = process.argv.slice(2);
  let against = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--against") {
      process.stderr.write(`unknown argument ${argv[i]}\n${USAGE}\n`);
      process.exitCode = 1;
      return;
    }
    // A flag that takes a value must consume one, or it swallows nothing and
    // reports success having compared against undefined — repo-14, one flag over.
    against = argv[++i];
    if (against === undefined) {
      process.stderr.write(`--against needs a value\n${USAGE}\n`);
      process.exitCode = 1;
      return;
    }
  }

  const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const { inScope, failed, excused, regressed, staleEntries, debt } = gate(repo);
  const history = against === null ? null : compareAgainst(repo, against, GRANDFATHERED);

  const scope = SCOPE.section === null ? "every citation" : `the "${SCOPE.section}" section`;
  process.stdout.write(
    `citation gate — ${scope} of ${inScope.length} record(s), distinct anchors required\n\n`,
  );

  for (const result of [...failed, ...regressed]) {
    if (result.error != null) {
      process.stdout.write(`  FAIL ${result.record}\n         ${result.error.split("\n")[0]}\n`);
      continue;
    }
    const worse =
      result.allowed === undefined
        ? ""
        : ` — ${result.failing} failing, and its GRANDFATHERED entry allows ${result.allowed}`;
    process.stdout.write(
      `  ${result.allowed === undefined ? "FAIL " : "WORSE"} ${result.record} — ${countLine(result.counts)}${worse}\n`,
    );
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

  for (const entry of history?.raised ?? []) {
    process.stdout.write(
      `  RAISED ${entry.record} — its GRANDFATHERED entry went from ${entry.was} to ${entry.now}` +
        ` against ${against}\n`,
    );
  }

  const enforced = inScope.length - excused.length - regressed.length;
  process.stdout.write(
    `\n${enforced} enforced, ${failed.length + regressed.length} failing; ` +
      `${excused.length} grandfathered, holding ${countLine(debt) || "nothing"}.\n`,
  );
  // Said on every run, including the clean ones. A comparison that quietly did
  // not happen is the one thing worse than not having it: the line below is how
  // a CI log distinguishes "nothing went up" from "nothing was checked".
  process.stdout.write(
    history === null
      ? `No history compared — pass --against <ref> to check the list only grew smaller.\n`
      : history.skipped !== null
        ? `No history compared — ${history.skipped}.\n`
        : `${GRANDFATHERED.size} entr(y/ies) compared against ${against}: ` +
          `${history.raised.length} raised.\n`,
  );

  if (
    failed.length === 0 &&
    regressed.length === 0 &&
    staleEntries.length === 0 &&
    (history?.raised.length ?? 0) === 0
  ) {
    return;
  }

  const advice = [];
  if (failed.length > 0) {
    advice.push(
      `${failed.length} record(s) failed. Every citation under a \`## Review\` heading must carry a\n` +
        `fragment of the line it points at — \`file.ts:120 "a fragment of the line"\` — that fragment must\n` +
        `occur only once in that file, and the citation must still resolve. Run\n` +
        `\`node scripts/citations.mjs <record> --section Review --require-anchors --require-distinct-anchors\`\n` +
        `for the full per-citation output on one of them.`,
    );
  }
  if (regressed.length > 0) {
    advice.push(
      `${regressed.length} grandfathered record(s) hold more failing references than their entry allows.\n` +
        `Repair the citations. **Raising the number in GRANDFATHERED is not the fix** — that list is\n` +
        `repo-29's migration debt and it ratchets one way, which is the whole reason it carries counts\n` +
        `rather than bare paths. If an unrelated edit of yours moved a line these records cite, the\n` +
        `repair is to repoint them: the anchor says where it went.`,
    );
  }
  if (staleEntries.length > 0) {
    advice.push(
      `${staleEntries.length} GRANDFATHERED entr(y/ies) in scripts/citations-gate.mjs are wrong: the record\n` +
        `passes, or the scope no longer reaches it, or it now holds less debt than the number claims.\n` +
        `Delete or tighten each. A waiver nobody has to keep true is a rubber stamp — the same rule\n` +
        `citations.mjs applies to an evidence declaration that excuses a citation which now passes.`,
    );
  }
  if ((history?.raised.length ?? 0) > 0) {
    advice.push(
      `${history.raised.length} GRANDFATHERED entr(y/ies) allow more than they did at ${against}.\n` +
        `An entry only ever goes down. Going up means a record got worse and the number was moved to\n` +
        `match it, or a record was appended to silence a break in it — the two ways a count that is\n` +
        `accurate can still hide a regression, and the reason this comparison exists. Repair the\n` +
        `citations instead; the anchor on each one says where it went.`,
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
