/**
 * Job persistence, and the only place the job FSM is enforced.
 *
 * `canTransition()` from `@downloader/contract` is authoritative. An illegal
 * transition is **rejected**, not tolerated: the brief is explicit about that,
 * and the reason is that a tolerated illegal transition produces a job whose
 * history is a lie — `completed` after `failed`, say, which the UI will happily
 * render as a working download link to a file that was deleted.
 *
 * The check and the write happen in one SQLite transaction, so two callers
 * racing to finish the same job cannot both win.
 */

import { AppError, canTransition, jobSchema, TERMINAL_STATUSES } from "@downloader/contract";
import type {
  AppErrorPayload,
  Job,
  JobOptions,
  JobLink,
  JobProgress,
  JobResult,
  JobStatus,
  MediaVariant,
} from "@downloader/contract";
import type { Database, Statement } from "better-sqlite3";
import { hostnameOrNull } from "../host.ts";

/**
 * A job's single-use link, as stored (dl-53). `usedAt` is what spends it:
 * set once, atomically, by the first `GET` — see `claimLink`.
 */
export interface JobLinkRecord {
  token: string;
  jobId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface CreateJobInput {
  id: string;
  sourceUrl: string;
  options: JobOptions;
  variantId: string | null;
  createdAt: string;
  /** The link that starts it, created in the same transaction (dl-53). */
  link: { token: string; url: string; expiresAt: string };
}

/**
 * One resolver's turn during a probe, win or lose. Structurally the same shape
 * `ResolverRegistry.resolve()`'s `attempts` out-parameter fills — duplicated
 * rather than imported so this module, which persists rows, does not need to
 * depend on `@downloader/resolvers`, which resolves them.
 */
export interface ProbeAttempt {
  resolver: string;
  code: string | null;
  durationMs: number;
}

/** What `POST /api/probe` records on every way out. See dl-57. */
export interface ProbeOutcomeInput {
  /** Hostname only — never a path, a query string or an address. */
  host: string;
  /** `"ok"`, or the `AppError` code that ended the probe. */
  outcome: string;
  /** The tier that answered, or null when nothing won. */
  resolver: string | null;
  attempts: readonly ProbeAttempt[];
  durationMs: number;
  cached: boolean;
  /** Null when there is no successful `ProbeResult` to count variants on. */
  variants: number | null;
  drm: boolean;
}

export interface ProbeOutcomeRow {
  id: number;
  host: string;
  outcome: string;
  resolver: string | null;
  attempts: ProbeAttempt[];
  durationMs: number;
  cached: boolean;
  variants: number | null;
  drm: boolean;
  createdAt: string;
}

interface ProbeOutcomeSqlRow {
  id: number;
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

/** Fields a transition may set alongside the new status. */
export interface TransitionPatch {
  progress?: JobProgress;
  result?: JobResult | null;
  error?: AppErrorPayload | null;
  variant?: MediaVariant | null;
  variantId?: string | null;
  attempts?: number;
  /** Our proxied path for the preview image, or null when there is none. */
  thumbnailPath?: string | null;
  /** The job's link snapshot; null once it has been opened or has expired. */
  link?: JobLink | null;
}

interface JobRow {
  id: string;
  source_url: string;
  variant_id: string | null;
  variant_json: string | null;
  status: string;
  progress_json: string;
  result_json: string | null;
  error_json: string | null;
  attempts: number;
  options_json: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  thumbnail_path: string | null;
  host: string | null;
  link_json: string | null;
}

export function initialProgress(stage: JobStatus = "queued"): JobProgress {
  return {
    stage,
    // Null, not 0. There is genuinely no total yet, and a fabricated 0% is a
    // claim we cannot support — see the "never fake progress" rule.
    percent: null,
    downloadedBytes: 0,
    totalBytes: null,
    segmentsDone: null,
    segmentsTotal: null,
    speedBps: null,
    etaSec: null,
    processedSec: null,
  };
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function probeOutcomeRow(row: ProbeOutcomeSqlRow): ProbeOutcomeRow {
  return {
    id: row.id,
    host: row.host,
    outcome: row.outcome,
    resolver: row.resolver,
    attempts: parseJson<ProbeAttempt[]>(row.attempts_json) ?? [],
    durationMs: row.duration_ms,
    cached: row.cached !== 0,
    variants: row.variants,
    drm: row.drm !== 0,
    createdAt: row.created_at,
  };
}

function rowToJob(row: JobRow): Job {
  const job: Job = {
    id: row.id,
    sourceUrl: row.source_url,
    variantId: row.variant_id,
    variant: parseJson<MediaVariant>(row.variant_json),
    status: row.status as JobStatus,
    progress: parseJson<JobProgress>(row.progress_json) ?? initialProgress(),
    result: parseJson<JobResult>(row.result_json),
    error: parseJson<AppErrorPayload>(row.error_json),
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    thumbnailPath: row.thumbnail_path,
    link: parseJson<JobLink>(row.link_json),
  };

  // The database is a boundary like any other: a row written by an older build,
  // or edited by hand, must not flow into the API's responses unchecked.
  const parsed = jobSchema.safeParse(job);
  if (!parsed.success) {
    throw new AppError("INTERNAL", "A stored job could not be read.", {
      details: { jobId: row.id, issues: parsed.error.issues.slice(0, 3) },
    });
  }
  return parsed.data;
}

export class JobStore {
  readonly #db: Database;
  readonly #statements: {
    insert: Statement;
    byId: Statement;
    list: Statement;
    count: Statement;
    update: Statement;
    touch: Statement;
    delete: Statement;
    insertLink: Statement;
    linkByToken: Statement;
    claimLink: Statement;
    releaseLink: Statement;
    expiredLinks: Statement;
    pruneLinks: Statement;
    unfinished: Statement;
    hostById: Statement;
    insertProbeOutcome: Statement;
    listProbeOutcomes: Statement;
    pruneProbeOutcomes: Statement;
  };

  constructor(db: Database) {
    this.#db = db;
    this.#statements = {
      insert: db.prepare(
        `INSERT INTO jobs (id, source_url, variant_id, variant_json, status, progress_json,
                           result_json, error_json, attempts, options_json, created_at, updated_at, finished_at, host, link_json)
         VALUES (@id, @source_url, @variant_id, NULL, @status, @progress_json,
                 NULL, NULL, 0, @options_json, @created_at, @created_at, NULL, @host, @link_json)`,
      ),
      byId: db.prepare(`SELECT * FROM jobs WHERE id = ?`),
      list: db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
      count: db.prepare(`SELECT COUNT(*) AS total FROM jobs`),
      update: db.prepare(
        `UPDATE jobs SET status = @status, progress_json = @progress_json, result_json = @result_json,
                         error_json = @error_json, variant_id = @variant_id, variant_json = @variant_json,
                         attempts = @attempts, updated_at = @updated_at, finished_at = @finished_at,
                         thumbnail_path = @thumbnail_path, link_json = @link_json
         WHERE id = @id`,
      ),
      touch: db.prepare(
        `UPDATE jobs SET progress_json = @progress_json, updated_at = @updated_at WHERE id = @id`,
      ),
      delete: db.prepare(`DELETE FROM jobs WHERE id = ?`),
      insertLink: db.prepare(
        `INSERT INTO job_links (token, job_id, expires_at, used_at, created_at)
         VALUES (@token, @job_id, @expires_at, NULL, @created_at)`,
      ),
      linkByToken: db.prepare(`SELECT * FROM job_links WHERE token = ?`),
      // The `used_at IS NULL` is the whole of "single-use": two GETs racing for
      // one link both run this, and SQLite lets exactly one of them change a row.
      claimLink: db.prepare(
        `UPDATE job_links SET used_at = @used_at WHERE token = @token AND used_at IS NULL`,
      ),
      releaseLink: db.prepare(`UPDATE job_links SET used_at = NULL WHERE token = ?`),
      expiredLinks: db.prepare(`SELECT * FROM job_links WHERE expires_at <= ? AND used_at IS NULL`),
      pruneLinks: db.prepare(`DELETE FROM job_links WHERE expires_at < ?`),
      // Running, or queued behind a link somebody opened: in both, a request
      // was being served when the process died. A queued job whose link nobody
      // has opened is not interrupted — it is waiting, and the sweep expires it.
      unfinished: db.prepare(
        `SELECT * FROM jobs
          WHERE status IN ('probing', 'downloading')
             OR (status = 'queued' AND NOT EXISTS (
                   SELECT 1 FROM job_links
                    WHERE job_links.job_id = jobs.id AND job_links.used_at IS NULL))`,
      ),
      hostById: db.prepare(`SELECT host FROM jobs WHERE id = ?`),
      insertProbeOutcome: db.prepare(
        `INSERT INTO probe_outcomes (host, outcome, resolver, attempts_json, duration_ms, cached, variants, drm, created_at)
         VALUES (@host, @outcome, @resolver, @attempts_json, @duration_ms, @cached, @variants, @drm, @created_at)`,
      ),
      listProbeOutcomes: db.prepare(`SELECT * FROM probe_outcomes ORDER BY id`),
      pruneProbeOutcomes: db.prepare(`DELETE FROM probe_outcomes WHERE created_at < ?`),
    };
  }

  create(input: CreateJobInput): Job {
    const link: JobLink = { url: input.link.url, expiresAt: input.link.expiresAt };
    const run = this.#db.transaction((): void => {
      this.#insertJob(input, link);
      this.#statements.insertLink.run({
        token: input.link.token,
        job_id: input.id,
        expires_at: input.link.expiresAt,
        created_at: input.createdAt,
      });
    });
    run();
    const created = this.find(input.id);
    if (created === null)
      throw new AppError("INTERNAL", "The job vanished immediately after insert.");
    return created;
  }

  #insertJob(input: CreateJobInput, link: JobLink): void {
    this.#statements.insert.run({
      id: input.id,
      source_url: input.sourceUrl,
      variant_id: input.variantId,
      status: "queued" satisfies JobStatus,
      progress_json: JSON.stringify(initialProgress("queued")),
      options_json: JSON.stringify(input.options),
      created_at: input.createdAt,
      // Hostname only, never the path or query string a signed URL carries its
      // credential in (dl-57), and never a bare IP literal (dl-57 decision C).
      // The route already validated `sourceUrl` with the SSRF guard before
      // calling here, so this should never fail to parse — `null` is the
      // honest answer on the day that stops being true.
      host: hostnameOrNull(input.sourceUrl),
      link_json: JSON.stringify(link),
    });
  }

  find(id: string): Job | null {
    const row = this.#statements.byId.get(id) as JobRow | undefined;
    return row === undefined ? null : rowToJob(row);
  }

  get(id: string): Job {
    const job = this.find(id);
    if (job === null) throw new AppError("JOB_NOT_FOUND", undefined, { details: { jobId: id } });
    return job;
  }

  options(id: string): JobOptions {
    const row = this.#statements.byId.get(id) as JobRow | undefined;
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", undefined, { details: { jobId: id } });
    return parseJson<JobOptions>(row.options_json) ?? {};
  }

  list({ limit = 50, offset = 0 } = {}): { jobs: Job[]; total: number } {
    const rows = this.#statements.list.all(limit, offset) as JobRow[];
    const { total } = this.#statements.count.get() as { total: number };
    return { jobs: rows.map(rowToJob), total };
  }

  /** Jobs that were mid-flight when the process died. */
  unfinished(): Job[] {
    return (this.#statements.unfinished.all() as JobRow[]).map(rowToJob);
  }

  /**
   * Moves a job to `to`, rejecting the move if the FSM forbids it.
   *
   * Returns the updated job. Throws `INTERNAL` on an illegal transition — it is
   * a bug in the orchestrator, not something a client did, so it is not worth a
   * dedicated error code, but it must be loud rather than silently ignored.
   */
  transition(
    id: string,
    to: JobStatus,
    patch: TransitionPatch = {},
    now = new Date().toISOString(),
  ): Job {
    const run = this.#db.transaction((): Job => {
      const current = this.get(id);
      if (current.status === to && !TERMINAL_STATUSES.has(to)) {
        // A no-op re-entry into the same non-terminal state is harmless; the
        // patch still applies. Terminal states are excluded so "completed
        // twice" stays an error.
        return this.#write(current, to, patch, now);
      }
      if (!canTransition(current.status, to)) {
        throw new AppError("INTERNAL", "Illegal job state transition.", {
          details: { jobId: id, from: current.status, to },
        });
      }
      return this.#write(current, to, patch, now);
    });
    return run();
  }

  #write(current: Job, to: JobStatus, patch: TransitionPatch, now: string): Job {
    const terminal = TERMINAL_STATUSES.has(to);
    const progress = patch.progress ?? { ...current.progress, stage: to };
    const variant = patch.variant === undefined ? current.variant : patch.variant;
    const result = patch.result === undefined ? current.result : patch.result;
    const error = patch.error === undefined ? current.error : patch.error;
    const link = patch.link === undefined ? (current.link ?? null) : patch.link;

    this.#statements.update.run({
      id: current.id,
      status: to,
      progress_json: JSON.stringify(progress),
      result_json: result === null ? null : JSON.stringify(result),
      error_json: error === null ? null : JSON.stringify(error),
      variant_id: patch.variantId === undefined ? current.variantId : patch.variantId,
      variant_json: variant === null ? null : JSON.stringify(variant),
      attempts: patch.attempts ?? current.attempts,
      updated_at: now,
      finished_at: terminal ? (current.finishedAt ?? now) : null,
      // `?? null` as well as the `undefined` check: the column is `TEXT NULL`
      // and `current.thumbnailPath` is optional on `Job`, so a job read back
      // from a pre-dl-29 row would otherwise hand better-sqlite3 an `undefined`
      // it refuses to bind.
      thumbnail_path:
        patch.thumbnailPath === undefined ? (current.thumbnailPath ?? null) : patch.thumbnailPath,
      link_json: link === null ? null : JSON.stringify(link),
    });
    return this.get(current.id);
  }

  /**
   * Updates fields without touching status.
   *
   * Needed because not every write is a state change: attaching the chosen
   * variant, bumping `attempts`, clearing a stale error. Routing those through
   * `transition` would mean naming the current status at every call site and
   * would make a typo look like a legal self-transition.
   */
  patch(id: string, patch: TransitionPatch, now = new Date().toISOString()): Job {
    const run = this.#db.transaction((): Job => {
      const current = this.get(id);
      return this.#write(current, current.status, patch, now);
    });
    return run();
  }

  /**
   * Records a progress snapshot without touching status.
   *
   * Separate from `transition` because progress arrives many times a second and
   * must never be able to move the FSM by accident.
   */
  recordProgress(id: string, progress: JobProgress, now = new Date().toISOString()): void {
    this.#statements.touch.run({ id, progress_json: JSON.stringify(progress), updated_at: now });
  }

  delete(id: string): void {
    this.#statements.delete.run(id);
  }

  // --- single-use links (dl-53) ------------------------------------------

  findLink(token: string): JobLinkRecord | null {
    const row = this.#statements.linkByToken.get(token) as
      | { token: string; job_id: string; expires_at: string; used_at: string | null }
      | undefined;
    if (row === undefined) return null;
    return { token: row.token, jobId: row.job_id, expiresAt: row.expires_at, usedAt: row.used_at };
  }

  /**
   * Spends a link. True for exactly one caller however many race for it; false
   * when it was already spent. Clears the job's link snapshot in the same
   * transaction, so no reader sees a job still offering a link that is gone.
   */
  claimLink(token: string, now = new Date().toISOString()): boolean {
    const run = this.#db.transaction((): boolean => {
      const changed = this.#statements.claimLink.run({ token, used_at: now }).changes === 1;
      if (!changed) return false;
      const link = this.findLink(token);
      if (link !== null) this.patch(link.jobId, { link: null }, now);
      return true;
    });
    return run();
  }

  /**
   * Un-spends a link whose request was refused before any work started — the
   * wait for a slot ran out (dl-53, owner decision 6). The job goes back to
   * offering the same link, so the visitor can simply try again.
   */
  releaseLink(token: string, link: JobLink, now = new Date().toISOString()): void {
    const run = this.#db.transaction((): void => {
      this.#statements.releaseLink.run(token);
      const record = this.findLink(token);
      if (record !== null) this.patch(record.jobId, { link }, now);
    });
    run();
  }

  /** Links past their expiry that nobody opened. */
  expiredLinks(nowIso: string): JobLinkRecord[] {
    return (
      this.#statements.expiredLinks.all(nowIso) as {
        token: string;
        job_id: string;
        expires_at: string;
        used_at: string | null;
      }[]
    ).map((row) => ({
      token: row.token,
      jobId: row.job_id,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
    }));
  }

  /** Drops link rows that expired before `beforeIso`. Returns how many. */
  pruneLinks(beforeIso: string): number {
    return this.#statements.pruneLinks.run(beforeIso).changes;
  }

  // --- probe outcomes (dl-57) -----------------------------------------------

  /**
   * The hostname stored for a job at creation, or null for a job that has none
   * — either it predates dl-57, or its source URL would not parse. Narrower
   * than `Job`: nothing in the wire schema needs this, it exists for the
   * offline report and for tests.
   */
  jobHost(id: string): string | null {
    const row = this.#statements.hostById.get(id) as { host: string | null } | undefined;
    return row?.host ?? null;
  }

  /**
   * Records one row for a probe's outcome. Never throws on a constraint this
   * table itself cannot satisfy — the caller (`probe-outcomes.ts`) is the one
   * that decides a failed write must not fail the probe it describes; this
   * method just does the write.
   */
  recordProbeOutcome(input: ProbeOutcomeInput, now = new Date().toISOString()): void {
    this.#statements.insertProbeOutcome.run({
      host: input.host,
      outcome: input.outcome,
      resolver: input.resolver,
      attempts_json: JSON.stringify(input.attempts),
      duration_ms: input.durationMs,
      cached: input.cached ? 1 : 0,
      variants: input.variants,
      drm: input.drm ? 1 : 0,
      created_at: now,
    });
  }

  /** Every recorded outcome, oldest first. Test and reporting use only. */
  probeOutcomes(): ProbeOutcomeRow[] {
    return (this.#statements.listProbeOutcomes.all() as ProbeOutcomeSqlRow[]).map(probeOutcomeRow);
  }

  /** Drops outcome rows older than `beforeIso`. Returns how many were removed. */
  pruneProbeOutcomes(beforeIso: string): number {
    return this.#statements.pruneProbeOutcomes.run(beforeIso).changes;
  }

  // --- retention (dl-54) ----------------------------------------------------

  /**
   * Deletes every job created before `beforeIso`, whatever state it is in, and
   * returns how many went.
   *
   * The **row**, not just `source_url`. The page URL is also in `error_json`
   * (`details.url`, query string included — measured on a failed probe), and a
   * variant's media URL, which routinely carries a signed credential, is in
   * `variant_json` and `result_json`. Clearing one column would leave the others
   * and make the terms page's "deleted" untrue. The job's link row goes with it
   * (`ON DELETE CASCADE`), so a link older than this answers `404`, not `410`.
   *
   * No status guard: a job still `downloading` fourteen days on is a row the
   * restart reconciliation failed long ago or a bug, and keeping its URL
   * forever is the one outcome the promise rules out.
   */
  pruneJobs(beforeIso: string): number {
    // Prepared here and not in the constructor: the sweep runs it every few
    // minutes, and keeping it off that list keeps every line below it where the
    // merged records that cite them found them.
    return this.#db.prepare(`DELETE FROM jobs WHERE created_at < ?`).run(beforeIso).changes;
  }
}
