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
  JobProgress,
  JobResult,
  JobStatus,
  MediaVariant,
} from "@downloader/contract";
import type { Database, Statement } from "better-sqlite3";

export interface FileToken {
  token: string;
  jobId: string;
  path: string;
  filename: string;
  sizeBytes: number;
  expiresAt: string;
}

/**
 * Where a completed job's preview image was written, filed under the same token
 * the in-memory store minted. See `thumbnails.ts` and dl-44.
 */
export interface ThumbnailFile {
  token: string;
  jobId: string;
  /** Absolute, inside `STORAGE_DIR/out/<jobId>/`. Re-confined at the point of use. */
  path: string;
  contentType: string;
}

export interface CreateJobInput {
  id: string;
  sourceUrl: string;
  options: JobOptions;
  variantId: string | null;
  createdAt: string;
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

/** `new URL(raw).hostname`, or null for a string that will not parse. */
function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname;
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
    insertToken: Statement;
    tokenByValue: Statement;
    tokenByJob: Statement;
    deleteToken: Statement;
    expiredTokens: Statement;
    markSwept: Statement;
    prunableTokens: Statement;
    unfinished: Statement;
    insertThumbnail: Statement;
    thumbnailByToken: Statement;
    dropThumbnailsForJob: Statement;
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
                           result_json, error_json, attempts, options_json, created_at, updated_at, finished_at, host)
         VALUES (@id, @source_url, @variant_id, NULL, @status, @progress_json,
                 NULL, NULL, 0, @options_json, @created_at, @created_at, NULL, @host)`,
      ),
      byId: db.prepare(`SELECT * FROM jobs WHERE id = ?`),
      list: db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`),
      count: db.prepare(`SELECT COUNT(*) AS total FROM jobs`),
      update: db.prepare(
        `UPDATE jobs SET status = @status, progress_json = @progress_json, result_json = @result_json,
                         error_json = @error_json, variant_id = @variant_id, variant_json = @variant_json,
                         attempts = @attempts, updated_at = @updated_at, finished_at = @finished_at,
                         thumbnail_path = @thumbnail_path
         WHERE id = @id`,
      ),
      touch: db.prepare(
        `UPDATE jobs SET progress_json = @progress_json, updated_at = @updated_at WHERE id = @id`,
      ),
      delete: db.prepare(`DELETE FROM jobs WHERE id = ?`),
      insertToken: db.prepare(
        `INSERT INTO file_tokens (token, job_id, path, filename, size_bytes, expires_at, created_at)
         VALUES (@token, @job_id, @path, @filename, @size_bytes, @expires_at, @created_at)`,
      ),
      tokenByValue: db.prepare(`SELECT * FROM file_tokens WHERE token = ?`),
      tokenByJob: db.prepare(`SELECT * FROM file_tokens WHERE job_id = ?`),
      deleteToken: db.prepare(`DELETE FROM file_tokens WHERE token = ?`),
      expiredTokens: db.prepare(
        `SELECT * FROM file_tokens WHERE expires_at <= ? AND swept_at IS NULL`,
      ),
      markSwept: db.prepare(`UPDATE file_tokens SET swept_at = @swept_at WHERE token = @token`),
      prunableTokens: db.prepare(`SELECT token FROM file_tokens WHERE expires_at <= ?`),
      unfinished: db.prepare(
        `SELECT * FROM jobs WHERE status IN ('queued', 'probing', 'downloading', 'muxing')`,
      ),
      insertThumbnail: db.prepare(
        `INSERT INTO thumbnail_files (token, job_id, path, content_type, created_at)
         VALUES (@token, @job_id, @path, @content_type, @created_at)`,
      ),
      thumbnailByToken: db.prepare(`SELECT * FROM thumbnail_files WHERE token = ?`),
      dropThumbnailsForJob: db.prepare(`DELETE FROM thumbnail_files WHERE job_id = ?`),
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
    this.#statements.insert.run({
      id: input.id,
      source_url: input.sourceUrl,
      variant_id: input.variantId,
      status: "queued" satisfies JobStatus,
      progress_json: JSON.stringify(initialProgress("queued")),
      options_json: JSON.stringify(input.options),
      created_at: input.createdAt,
      // Hostname only, never the path or query string a signed URL carries its
      // credential in (dl-57). The route already validated `sourceUrl` with the
      // SSRF guard before calling here, so this should never fail to parse —
      // `null` is the honest answer on the day that stops being true.
      host: hostnameOf(input.sourceUrl),
    });
    const created = this.find(input.id);
    if (created === null)
      throw new AppError("INTERNAL", "The job vanished immediately after insert.");
    return created;
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

  // --- capability tokens ---------------------------------------------------

  /**
   * Stores the token for a job's output file.
   *
   * The token is generated by the caller (`tokens.ts`) from 32 random bytes and
   * is never derived from the job id — the whole point is that holding a job id
   * does not entitle you to the file.
   */
  saveToken(token: FileToken, now = new Date().toISOString()): void {
    this.#statements.insertToken.run({
      token: token.token,
      job_id: token.jobId,
      path: token.path,
      filename: token.filename,
      size_bytes: token.sizeBytes,
      expires_at: token.expiresAt,
      created_at: now,
    });
  }

  findToken(token: string): FileToken | null {
    const row = this.#statements.tokenByValue.get(token) as
      | {
          token: string;
          job_id: string;
          path: string;
          filename: string;
          size_bytes: number;
          expires_at: string;
        }
      | undefined;
    if (row === undefined) return null;
    return {
      token: row.token,
      jobId: row.job_id,
      path: row.path,
      filename: row.filename,
      sizeBytes: row.size_bytes,
      expiresAt: row.expires_at,
    };
  }

  findTokenForJob(jobId: string): FileToken | null {
    const row = this.#statements.tokenByJob.get(jobId) as { token: string } | undefined;
    return row === undefined ? null : this.findToken(row.token);
  }

  /** Expired tokens whose file the sweep has not yet deleted. */
  expiredTokens(nowIso = new Date().toISOString()): FileToken[] {
    const rows = this.#statements.expiredTokens.all(nowIso) as { token: string }[];
    return rows
      .map((row) => this.findToken(row.token))
      .filter((token): token is FileToken => token !== null);
  }

  /** Marks a token's file as deleted. The row stays, so the route can still 410. */
  markSwept(token: string, now = new Date().toISOString()): void {
    this.#statements.markSwept.run({ token, swept_at: now });
  }

  /** Rows old enough that keeping them no longer buys a useful error message. */
  prunableTokens(beforeIso: string): string[] {
    return (this.#statements.prunableTokens.all(beforeIso) as { token: string }[]).map(
      (row) => row.token,
    );
  }

  deleteToken(token: string): void {
    this.#statements.deleteToken.run(token);
  }

  // --- persisted preview images -------------------------------------------

  /**
   * Records where a completed job's preview image was written.
   *
   * The token is not minted here and is not new: it is the one the in-memory
   * store already handed out, which is what lets `thumbnailPath` keep meaning
   * the same thing before and after the bytes reach disk.
   */
  saveThumbnail(thumbnail: ThumbnailFile, now = new Date().toISOString()): void {
    this.#statements.insertThumbnail.run({
      token: thumbnail.token,
      job_id: thumbnail.jobId,
      path: thumbnail.path,
      content_type: thumbnail.contentType,
      created_at: now,
    });
  }

  findThumbnail(token: string): ThumbnailFile | null {
    const row = this.#statements.thumbnailByToken.get(token) as
      | { token: string; job_id: string; path: string; content_type: string }
      | undefined;
    if (row === undefined) return null;
    return {
      token: row.token,
      jobId: row.job_id,
      path: row.path,
      contentType: row.content_type,
    };
  }

  /**
   * Drops the rows for a job whose output directory has been swept.
   *
   * Unlike `file_tokens`, the row buys nothing once the bytes are gone: a
   * missing preview renders as no preview, so there is no better answer to
   * preserve the way `410 Gone` is better than `404` for a download link.
   */
  removeThumbnailsForJob(jobId: string): void {
    this.#statements.dropThumbnailsForJob.run(jobId);
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
}
