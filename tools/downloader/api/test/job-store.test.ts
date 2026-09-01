/**
 * The store is the only place the job FSM is enforced, so these tests are
 * really tests of that enforcement. The brief is explicit: reject illegal
 * transitions rather than tolerating them.
 */

import Database from "better-sqlite3";
import { AppError } from "@downloader/contract";
import { beforeEach, describe, expect, test } from "vitest";
import { initialProgress, JobStore } from "../src/db/job-store.ts";
import { migrate } from "../src/db/schema.ts";

let store: JobStore;
let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  store = new JobStore(db);
});

function create(id = "job-1"): void {
  store.create({
    id,
    sourceUrl: "https://site.example/watch",
    options: {},
    variantId: null,
    createdAt: "2026-08-06T10:00:00.000Z",
  });
}

function codeOf(work: () => unknown): string {
  try {
    work();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof AppError ? error.code : "NOT_APP_ERROR";
  }
}

describe("creation", () => {
  test("a new job starts queued with honest, empty progress", () => {
    create();
    const job = store.get("job-1");
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
    expect(job.result).toBeNull();
    expect(job.error).toBeNull();
    expect(job.finishedAt).toBeNull();
    // Null rather than 0: there is genuinely no total yet, and a fabricated
    // 0% is a claim we cannot support.
    expect(job.progress.percent).toBeNull();
    expect(job.progress.totalBytes).toBeNull();
  });

  test("an unknown id is JOB_NOT_FOUND, and find() is the non-throwing form", () => {
    expect(codeOf(() => store.get("nope"))).toBe("JOB_NOT_FOUND");
    expect(store.find("nope")).toBeNull();
  });
});

describe("the FSM", () => {
  test("walks the legal path to completed", () => {
    create();
    expect(store.transition("job-1", "probing").status).toBe("probing");
    expect(store.transition("job-1", "downloading").status).toBe("downloading");
    expect(store.transition("job-1", "muxing").status).toBe("muxing");
    const done = store.transition("job-1", "completed");
    expect(done.status).toBe("completed");
    expect(done.finishedAt).not.toBeNull();
  });

  test("allows the one back-edge, downloading → probing, and no other", () => {
    create();
    store.transition("job-1", "probing");
    store.transition("job-1", "downloading");
    expect(store.transition("job-1", "probing").status).toBe("probing");
    expect(store.transition("job-1", "downloading").status).toBe("downloading");

    // The back-edge is for an expired URL mid-download. Once muxing has begun
    // there is nothing to re-resolve, and the FSM stays forward.
    store.transition("job-1", "muxing");
    expect(codeOf(() => store.transition("job-1", "probing"))).toBe("INTERNAL");
    expect(store.get("job-1").status).toBe("muxing");
  });

  test("rejects a skipped state rather than tolerating it", () => {
    create();
    // queued → downloading skips probing, which would mean a job that never
    // re-probed. Tolerating it would produce a history that is a lie.
    expect(codeOf(() => store.transition("job-1", "downloading"))).toBe("INTERNAL");
    expect(store.get("job-1").status).toBe("queued");
  });

  test("rejects any move out of a terminal state", () => {
    create();
    store.transition("job-1", "probing");
    store.transition("job-1", "failed", {
      error: { code: "TIMEOUT", message: "x", retryable: true },
    });

    for (const target of ["probing", "downloading", "completed", "canceled"] as const) {
      expect(
        codeOf(() => store.transition("job-1", target)),
        target,
      ).toBe("INTERNAL");
    }
    expect(store.get("job-1").status).toBe("failed");
  });

  test("re-entering the same non-terminal state applies the patch without moving", () => {
    create();
    store.transition("job-1", "probing");
    const patched = store.transition("job-1", "probing", { attempts: 3 });
    expect(patched.status).toBe("probing");
    expect(patched.attempts).toBe(3);
  });

  test("but completing twice is still an error", () => {
    create();
    store.transition("job-1", "probing");
    store.transition("job-1", "downloading");
    store.transition("job-1", "completed");
    expect(codeOf(() => store.transition("job-1", "completed"))).toBe("INTERNAL");
  });

  test("finishedAt is stamped once and never moves", () => {
    create();
    store.transition("job-1", "probing", {}, "2026-08-06T10:00:01.000Z");
    const canceled = store.transition("job-1", "canceled", {}, "2026-08-06T10:00:02.000Z");
    expect(canceled.finishedAt).toBe("2026-08-06T10:00:02.000Z");
  });
});

describe("patch and progress", () => {
  test("patch updates fields without touching status", () => {
    create();
    store.transition("job-1", "probing");
    const patched = store.patch("job-1", { attempts: 2, variantId: "v9" });
    expect(patched.status).toBe("probing");
    expect(patched.attempts).toBe(2);
    expect(patched.variantId).toBe("v9");
  });

  test("recordProgress cannot move the FSM", () => {
    create();
    // The stage field says `downloading` but the job is queued: progress
    // arrives many times a second and must never be able to advance state.
    store.recordProgress("job-1", { ...initialProgress("downloading"), downloadedBytes: 99 });
    const job = store.get("job-1");
    expect(job.status).toBe("queued");
    expect(job.progress.downloadedBytes).toBe(99);
  });
});

describe("the preview path, and the migration that adds its column", () => {
  /**
   * The schema as it stood before migration 3, written out rather than derived.
   *
   * A frozen copy is the right shape here and cannot go stale: `schema.ts` says
   * never to edit a shipped migration, so this is what is in every deployed
   * database that predates dl-29. Deriving it by re-running `migrate()` would
   * only ever produce the *current* schema, which is precisely the thing this
   * test must not assume.
   */
  const BEFORE_MIGRATION_3 = `
    CREATE TABLE jobs (
      id            TEXT PRIMARY KEY,
      source_url    TEXT NOT NULL,
      variant_id    TEXT,
      variant_json  TEXT,
      status        TEXT NOT NULL,
      progress_json TEXT NOT NULL,
      result_json   TEXT,
      error_json    TEXT,
      attempts      INTEGER NOT NULL DEFAULT 0,
      options_json  TEXT NOT NULL DEFAULT '{}',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      finished_at   TEXT
    ) STRICT;
    CREATE INDEX jobs_created_at ON jobs (created_at DESC);
    CREATE INDEX jobs_status ON jobs (status);
    CREATE TABLE file_tokens (
      token      TEXT PRIMARY KEY,
      job_id     TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
      path       TEXT NOT NULL,
      filename   TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      swept_at   TEXT
    ) STRICT;
    CREATE UNIQUE INDEX file_tokens_job ON file_tokens (job_id);
    CREATE INDEX file_tokens_expires_at ON file_tokens (expires_at);
  `;

  /** A database as a deployment running the previous release would have it. */
  function legacyDatabase(): Database.Database {
    const legacy = new Database(":memory:");
    legacy.exec(BEFORE_MIGRATION_3);
    legacy.pragma("user_version = 2");
    legacy
      .prepare(
        `INSERT INTO jobs (id, source_url, variant_id, variant_json, status, progress_json,
                           result_json, error_json, attempts, options_json, created_at, updated_at, finished_at)
         VALUES ('legacy-1', 'https://site.example/watch', 'v1', NULL, 'completed', @progress,
                 NULL, NULL, 1, '{}', '2026-08-01T10:00:00.000Z', '2026-08-01T10:05:00.000Z',
                 '2026-08-01T10:05:00.000Z')`,
      )
      .run({ progress: JSON.stringify(initialProgress("completed")) });
    return legacy;
  }

  test("an existing row survives migration 3 and reads back with no preview", () => {
    // **The load-bearing case.** A migration test that only exercises the
    // fresh-create path passes against a broken `ALTER TABLE`, because the
    // fresh path never runs one. The row has to already be there.
    const legacy = legacyDatabase();
    expect(legacy.pragma("user_version", { simple: true })).toBe(2);

    migrate(legacy);

    expect(legacy.pragma("user_version", { simple: true })).toBe(3);
    const upgraded = new JobStore(legacy).get("legacy-1");
    expect(upgraded.status).toBe("completed");
    // Null, not absent and not invented: nothing may fabricate a token that was
    // never minted. `rowToJob` re-parses through `jobSchema`, so a column that
    // failed to appear would surface here as an INTERNAL rather than as a quiet
    // undefined.
    expect(upgraded.thumbnailPath).toBeNull();
    legacy.close();
  });

  test("migrate is idempotent — a second run is a no-op, not a duplicate column", () => {
    const legacy = legacyDatabase();
    migrate(legacy);
    expect(() => migrate(legacy)).not.toThrow();
    expect(legacy.pragma("user_version", { simple: true })).toBe(3);
    expect(new JobStore(legacy).get("legacy-1").thumbnailPath).toBeNull();
    legacy.close();
  });

  test("a freshly created job starts with no preview", () => {
    create();
    expect(store.get("job-1").thumbnailPath).toBeNull();
  });

  test("patch sets the path, preserves it when not named, and clears it on null", () => {
    create();
    store.transition("job-1", "probing");

    expect(store.patch("job-1", { thumbnailPath: "/api/thumbnail/tok" }).thumbnailPath).toBe(
      "/api/thumbnail/tok",
    );
    // The `undefined` branch: an unrelated patch must not clobber it. This is
    // the one `#write` needs `?? null` for, and a regression here would lose a
    // job's preview on its next unrelated write rather than loudly.
    expect(store.patch("job-1", { attempts: 3 }).thumbnailPath).toBe("/api/thumbnail/tok");
    // And an explicit null still clears, which is what a re-probe that found no
    // image writes.
    expect(store.patch("job-1", { thumbnailPath: null }).thumbnailPath).toBeNull();
  });

  test("a transition carries the path through as well as a patch does", () => {
    create();
    // `patch` and `transition` share `#write`, but only one of them was
    // exercised above and they are different call sites.
    store.transition("job-1", "probing", { thumbnailPath: "/api/thumbnail/tok" });
    expect(store.get("job-1").thumbnailPath).toBe("/api/thumbnail/tok");
    expect(store.transition("job-1", "downloading").thumbnailPath).toBe("/api/thumbnail/tok");
  });
});

describe("listing and restart recovery", () => {
  test("lists newest first with a total", () => {
    for (const [index, id] of ["a", "b", "c"].entries()) {
      store.create({
        id,
        sourceUrl: "https://site.example/watch",
        options: {},
        variantId: null,
        createdAt: `2026-08-06T10:0${index}:00.000Z`,
      });
    }
    const { jobs, total } = store.list({ limit: 2 });
    expect(total).toBe(3);
    expect(jobs.map((job) => job.id)).toEqual(["c", "b"]);
  });

  test("unfinished() finds exactly the jobs a restart would strand", () => {
    create("running");
    store.transition("running", "probing");
    create("done");
    store.transition("done", "probing");
    store.transition("done", "downloading");
    store.transition("done", "completed");

    expect(store.unfinished().map((job) => job.id)).toEqual(["running"]);
  });
});

describe("file tokens", () => {
  test("a token is stored against its job and read back whole", () => {
    create();
    store.saveToken({
      token: "tok",
      jobId: "job-1",
      path: "/storage/out/job-1/video.mp4",
      filename: "video.mp4",
      sizeBytes: 27,
      expiresAt: "2026-08-06T16:00:00.000Z",
    });
    expect(store.findToken("tok")?.filename).toBe("video.mp4");
    expect(store.findTokenForJob("job-1")?.token).toBe("tok");
    expect(store.findToken("other")).toBeNull();
  });

  test("expiredTokens finds only what has actually lapsed", () => {
    create();
    store.saveToken({
      token: "old",
      jobId: "job-1",
      path: "/p",
      filename: "f",
      sizeBytes: 1,
      expiresAt: "2026-08-06T09:00:00.000Z",
    });
    expect(store.expiredTokens("2026-08-06T10:00:00.000Z").map((t) => t.token)).toEqual(["old"]);
    expect(store.expiredTokens("2026-08-06T08:00:00.000Z")).toEqual([]);
  });

  test("a swept token keeps its row so the route can still answer 410", () => {
    // Regression: the sweep used to delete the row along with the file, which
    // turned "this expired" into "never existed" — a 404 that reads as a typo
    // rather than as a retention window closing.
    create();
    const token = {
      token: "tok",
      jobId: "job-1",
      path: "/p",
      filename: "f",
      sizeBytes: 1,
      expiresAt: "2026-08-06T09:00:00.000Z",
    };
    store.saveToken(token);

    expect(store.expiredTokens("2026-08-06T10:00:00.000Z")).toHaveLength(1);
    store.markSwept("tok", "2026-08-06T10:00:00.000Z");

    // Not offered to the sweep twice...
    expect(store.expiredTokens("2026-08-06T10:00:00.000Z")).toHaveLength(0);
    // ...but still readable, which is what makes the 410 possible.
    expect(store.findToken("tok")).not.toBeNull();
  });

  test("rows are pruned only long after the file went", () => {
    create();
    store.saveToken({
      token: "tok",
      jobId: "job-1",
      path: "/p",
      filename: "f",
      sizeBytes: 1,
      expiresAt: "2026-08-06T09:00:00.000Z",
    });
    // An hour later the row is still wanted.
    expect(store.prunableTokens("2026-08-06T10:00:00.000Z")).toEqual(["tok"]);
    expect(store.prunableTokens("2026-08-06T08:00:00.000Z")).toEqual([]);
  });

  test("deleting a job takes its token with it", () => {
    create();
    store.saveToken({
      token: "tok",
      jobId: "job-1",
      path: "/p",
      filename: "f",
      sizeBytes: 1,
      expiresAt: "2026-08-06T16:00:00.000Z",
    });
    store.delete("job-1");
    // ON DELETE CASCADE: a token outliving its job would serve a file nothing
    // remembers owning.
    expect(store.findToken("tok")).toBeNull();
  });
});
