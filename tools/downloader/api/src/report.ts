/**
 * A read-only report over what dl-57's `probe_outcomes` table and the `jobs`
 * table already hold: which sites fail and at which resolver, how long a probe
 * takes per resolver, and what share of downloads finish.
 *
 * Opens the database **read-only**, in its own connection, so this can run
 * beside the live server without contending with its writer. Run inside the
 * built image:
 *
 *     docker compose exec downloader node dist/report.js --days 7
 *
 * `buildReport` and `formatReport` are exported separately from `main` so a
 * test can exercise them against a database it seeded, without shelling out or
 * opening the real `DATABASE_PATH`.
 */

import process from "node:process";
import Database from "better-sqlite3";
import { loadApiConfig } from "./config.ts";

const DEFAULT_DAYS = 7;

export interface ReportArgs {
  days: number;
}

/** `--days N`, defaulting to a week. A missing or non-positive value falls back rather than failing — this is an operator's convenience tool, not a boot-time config. */
export function parseReportArgs(argv: readonly string[]): ReportArgs {
  const flagIndex = argv.indexOf("--days");
  const raw = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  const days = raw === undefined ? DEFAULT_DAYS : Number(raw);
  return { days: Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS };
}

interface ProbeOutcomeSqlRow {
  host: string;
  outcome: string;
  resolver: string | null;
  attempts_json: string;
  duration_ms: number;
  cached: number;
  variants: number | null;
  drm: number;
  created_at: string;
}

interface JobSqlRow {
  status: string;
  error_json: string | null;
  created_at: string;
  finished_at: string | null;
}

interface ResolverShare {
  resolver: string;
  successes: number;
  /** Of all successes, not of that resolver's own attempts. */
  share: number;
}

interface FailingHost {
  host: string;
  failures: number;
  codes: string[];
  /** Every tier that was tried across the host's failures, deduplicated. */
  tiersAttempted: string[];
}

interface ResolverDuration {
  resolver: string;
  p50Ms: number;
  p95Ms: number;
  n: number;
}

interface JobCodeCount {
  code: string;
  count: number;
}

export interface Report {
  windowDays: number;
  probes: {
    total: number;
    attempted: number;
    gateRefusals: number;
    successes: number;
    /** Null when nothing was attempted in the window — no divide-by-zero rate. */
    successRate: number | null;
    byResolver: ResolverShare[];
    topFailingHosts: FailingHost[];
    durationByResolver: ResolverDuration[];
  };
  downloads: {
    total: number;
    successes: number;
    successRate: number | null;
    codeCounts: JobCodeCount[];
    p50DurationMs: number | null;
  };
}

function parseAttempts(raw: string): Array<{ resolver: string; code: string | null }> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as Array<{ resolver: string; code: string | null }>)
      : [];
  } catch {
    return [];
  }
}

function jobErrorCode(raw: string | null): string {
  if (raw === null) return "UNKNOWN";
  try {
    const parsed: unknown = JSON.parse(raw);
    const code = (parsed as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] as number;
}

/**
 * Reads `probe_outcomes` and `jobs` since `sinceIso` and computes the report.
 *
 * A `RATE_LIMITED` outcome is always the concurrency gate here, never the
 * per-client bucket — `probe.ts` never records that bucket's refusals, so
 * every such row is a capacity signal and is excluded from the success rate's
 * denominator rather than counted as a failed attempt.
 */
export function buildReport(db: Database.Database, sinceIso: string, windowDays: number): Report {
  const outcomes = db
    .prepare(`SELECT * FROM probe_outcomes WHERE created_at >= ? ORDER BY created_at`)
    .all(sinceIso) as ProbeOutcomeSqlRow[];

  const gateRefusals = outcomes.filter((row) => row.outcome === "RATE_LIMITED").length;
  const attempted = outcomes.length - gateRefusals;
  const successes = outcomes.filter((row) => row.outcome === "ok").length;

  const successesByResolver = new Map<string, number>();
  for (const row of outcomes) {
    if (row.outcome !== "ok" || row.resolver === null) continue;
    successesByResolver.set(row.resolver, (successesByResolver.get(row.resolver) ?? 0) + 1);
  }
  const byResolver: ResolverShare[] = [...successesByResolver.entries()]
    .map(([resolver, count]) => ({
      resolver,
      successes: count,
      share: successes === 0 ? 0 : count / successes,
    }))
    .toSorted((a, b) => b.successes - a.successes);

  const hostFailures = new Map<
    string,
    { failures: number; codes: Set<string>; tiers: Set<string> }
  >();
  for (const row of outcomes) {
    if (row.outcome === "ok" || row.outcome === "RATE_LIMITED") continue;
    const entry = hostFailures.get(row.host) ?? {
      failures: 0,
      codes: new Set<string>(),
      tiers: new Set<string>(),
    };
    entry.failures += 1;
    entry.codes.add(row.outcome);
    for (const attempt of parseAttempts(row.attempts_json)) entry.tiers.add(attempt.resolver);
    hostFailures.set(row.host, entry);
  }
  const topFailingHosts: FailingHost[] = [...hostFailures.entries()]
    .map(([host, entry]) => ({
      host,
      failures: entry.failures,
      codes: [...entry.codes],
      tiersAttempted: [...entry.tiers],
    }))
    .toSorted((a, b) => b.failures - a.failures)
    .slice(0, 20);

  const durationsByResolver = new Map<string, number[]>();
  for (const row of outcomes) {
    // Cache hits are excluded: their recorded duration is 0 and would deflate
    // the very latency this exists to measure — see `probe-outcomes.ts`.
    if (row.outcome !== "ok" || row.cached !== 0 || row.resolver === null) continue;
    const values = durationsByResolver.get(row.resolver) ?? [];
    values.push(row.duration_ms);
    durationsByResolver.set(row.resolver, values);
  }
  const durationByResolver: ResolverDuration[] = [...durationsByResolver.entries()]
    .map(([resolver, values]) => ({
      resolver,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      n: values.length,
    }))
    .toSorted((a, b) => b.n - a.n);

  const jobs = db
    .prepare(
      `SELECT status, error_json, created_at, finished_at FROM jobs
       WHERE finished_at IS NOT NULL AND finished_at >= ?`,
    )
    .all(sinceIso) as JobSqlRow[];

  const jobSuccesses = jobs.filter((job) => job.status === "completed").length;
  const codeCountsByCode = new Map<string, number>();
  for (const job of jobs) {
    if (job.status === "completed") continue;
    const code = jobErrorCode(job.error_json);
    codeCountsByCode.set(code, (codeCountsByCode.get(code) ?? 0) + 1);
  }
  const codeCounts: JobCodeCount[] = [...codeCountsByCode.entries()]
    .map(([code, count]) => ({ code, count }))
    .toSorted((a, b) => b.count - a.count);

  const completedDurations = jobs
    .filter((job) => job.status === "completed" && job.finished_at !== null)
    .map(
      (job) => new Date(job.finished_at as string).getTime() - new Date(job.created_at).getTime(),
    );

  return {
    windowDays,
    probes: {
      total: outcomes.length,
      attempted,
      gateRefusals,
      successes,
      successRate: attempted === 0 ? null : successes / attempted,
      byResolver,
      topFailingHosts,
      durationByResolver,
    },
    downloads: {
      total: jobs.length,
      successes: jobSuccesses,
      successRate: jobs.length === 0 ? null : jobSuccesses / jobs.length,
      codeCounts,
      p50DurationMs: completedDurations.length === 0 ? null : percentile(completedDurations, 0.5),
    },
  };
}

function formatRate(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`Downloader outcome report — last ${report.windowDays} day(s)`);
  lines.push("");

  lines.push("Probes");
  lines.push(
    `  success rate: ${formatRate(report.probes.successRate)}` +
      ` (${report.probes.successes}/${report.probes.attempted} attempted,` +
      ` ${report.probes.gateRefusals} refused by the concurrency gate)`,
  );
  if (report.probes.byResolver.length === 0) {
    lines.push("  no successful probe in this window");
  } else {
    lines.push("  successes by winning resolver:");
    for (const entry of report.probes.byResolver) {
      lines.push(`    ${entry.resolver}: ${entry.successes} (${formatRate(entry.share)})`);
    }
  }
  lines.push("  hosts that fail most:");
  if (report.probes.topFailingHosts.length === 0) {
    lines.push("    none");
  } else {
    for (const entry of report.probes.topFailingHosts) {
      const tiers =
        entry.tiersAttempted.length === 0 ? "no tier reached" : entry.tiersAttempted.join(", ");
      lines.push(
        `    ${entry.host}: ${entry.failures} (${entry.codes.join(", ")}; tried ${tiers})`,
      );
    }
  }
  lines.push("  probe duration (ms), p50 / p95, per winning resolver (cache hits excluded):");
  if (report.probes.durationByResolver.length === 0) {
    lines.push("    no timed probe in this window");
  } else {
    for (const entry of report.probes.durationByResolver) {
      lines.push(`    ${entry.resolver}: p50=${entry.p50Ms} p95=${entry.p95Ms} (n=${entry.n})`);
    }
  }

  lines.push("");
  lines.push("Downloads");
  lines.push(
    `  success rate: ${formatRate(report.downloads.successRate)}` +
      ` (${report.downloads.successes}/${report.downloads.total})`,
  );
  if (report.downloads.codeCounts.length === 0) {
    lines.push("  no failed download in this window");
  } else {
    for (const entry of report.downloads.codeCounts) {
      lines.push(`    ${entry.code}: ${entry.count}`);
    }
  }
  lines.push(
    `  p50 download duration: ${
      report.downloads.p50DurationMs === null ? "n/a" : `${report.downloads.p50DurationMs} ms`
    }`,
  );

  return lines.join("\n");
}

async function main(): Promise<void> {
  const { days } = parseReportArgs(process.argv.slice(2));
  const config = loadApiConfig();
  const db = new Database(config.databasePath, { readonly: true, fileMustExist: true });
  try {
    const sinceIso = new Date(Date.now() - days * 24 * 3_600_000).toISOString();
    process.stdout.write(`${formatReport(buildReport(db, sinceIso, days))}\n`);
  } finally {
    db.close();
  }
}

// Only when invoked directly — `node dist/report.js` — so a test can import
// `buildReport`/`formatReport` without executing the CLI or opening
// `DATABASE_PATH`, which will not exist under a test runner.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
