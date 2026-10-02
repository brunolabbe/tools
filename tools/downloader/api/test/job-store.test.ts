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

let linkCounter = 0;

/** A distinct link per job: `job_links.job_id` is unique, and so is the token. */
function freshLink(expiresAt = "2026-08-06T10:15:00.000Z"): {
  token: string;
  url: string;
  expiresAt: string;
} {
  linkCounter += 1;
  const token = `tok-${linkCounter}`;
  return { token, url: `/api/files/${token}`, expiresAt };
}

function create(id = "job-1"): void {
  store.create({
    id,
    sourceUrl: "https://site.example/watch",
    options: {},
    variantId: null,
    link: freshLink(),
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

    // The back-edge is for an expired URL before the first byte. There is no
    // `muxing` any more (dl-53), so no state past `downloading` offers it.
    store.transition("job-1", "completed");
    expect(codeOf(() => store.transition("job-1", "probing"))).toBe("INTERNAL");
    expect(store.get("job-1").status).toBe("completed");
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

    // 6, not 3: dl-44 appended `thumbnail_files`, dl-57 appended
    // `probe_outcomes` plus `jobs.host`, and dl-53 the links. The number is the count of shipped
    // migrations, and it moves every time one is added — which is the point of
    // asserting it rather than asserting "greater than 2".
    expect(legacy.pragma("user_version", { simple: true })).toBe(6);
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
    expect(legacy.pragma("user_version", { simple: true })).toBe(6);
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
        link: freshLink(),
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
    // Waiting for a click is not interrupted (dl-53): the sweep expires it.
    create("unopened");
    // Queued behind a link somebody opened: a request was being served.
    create("opened");
    const opened = store.get("opened").link?.url.split("/").at(-1) ?? "";
    expect(store.claimLink(opened)).toBe(true);

    expect(
      store
        .unfinished()
        .map((job) => job.id)
        .toSorted(),
    ).toEqual(["opened", "running"]);
  });
});

describe("single-use links (dl-53)", () => {
  function tokenOf(id: string): string {
    return store.get(id).link?.url.split("/").at(-1) ?? "";
  }

  test("a job is created with its link, and the link is read back whole", () => {
    create();
    const token = tokenOf("job-1");
    expect(store.get("job-1").link).toEqual({
      url: `/api/files/${token}`,
      expiresAt: "2026-08-06T10:15:00.000Z",
    });
    expect(store.findLink(token)).toEqual({
      token,
      jobId: "job-1",
      expiresAt: "2026-08-06T10:15:00.000Z",
      usedAt: null,
    });
    expect(store.findLink("other")).toBeNull();
  });

  test("a link is claimed exactly once, and claiming it withdraws it from the job", () => {
    create();
    const token = tokenOf("job-1");
    expect(store.claimLink(token, "2026-08-06T10:01:00.000Z")).toBe(true);
    expect(store.claimLink(token, "2026-08-06T10:01:00.000Z")).toBe(false);
    expect(store.findLink(token)?.usedAt).toBe("2026-08-06T10:01:00.000Z");
    expect(store.get("job-1").link).toBeNull();
  });

  test("a released link is usable again, and the job offers it again", () => {
    create();
    const offered = store.get("job-1").link;
    const token = tokenOf("job-1");
    store.claimLink(token);
    store.releaseLink(token, offered ?? { url: "", expiresAt: "" });
    expect(store.findLink(token)?.usedAt).toBeNull();
    expect(store.get("job-1").link).toEqual(offered);
    expect(store.claimLink(token)).toBe(true);
  });

  test("expiredLinks finds only unopened links that have lapsed", () => {
    create("lapsed");
    create("opened");
    store.claimLink(tokenOf("opened"));
    expect(store.expiredLinks("2026-08-06T10:20:00.000Z").map((link) => link.jobId)).toEqual([
      "lapsed",
    ]);
    expect(store.expiredLinks("2026-08-06T10:10:00.000Z")).toEqual([]);
  });

  test("rows are pruned only once their grace has passed", () => {
    create();
    const token = tokenOf("job-1");
    expect(store.pruneLinks("2026-08-06T10:00:00.000Z")).toBe(0);
    expect(store.findLink(token)).not.toBeNull();
    expect(store.pruneLinks("2026-08-06T11:00:00.000Z")).toBe(1);
    expect(store.findLink(token)).toBeNull();
  });

  test("deleting a job takes its link with it", () => {
    create();
    const token = tokenOf("job-1");
    store.delete("job-1");
    // ON DELETE CASCADE: a link outliving its job would start nothing.
    expect(store.findLink(token)).toBeNull();
  });
});

describe("jobs.host (dl-57)", () => {
  test("is the hostname of the source URL, computed at creation", () => {
    create();
    expect(store.jobHost("job-1")).toBe("site.example");
  });

  test("never carries the path, the query string or a credential in it", () => {
    store.create({
      id: "job-2",
      sourceUrl: "https://cdn.example/watch/42?sig=super-secret-token",
      options: {},
      variantId: null,
      link: freshLink(),
      createdAt: "2026-08-06T10:00:00.000Z",
    });
    const host = store.jobHost("job-2");
    expect(host).toBe("cdn.example");
    expect(host).not.toContain("/watch/42");
    expect(host).not.toContain("sig=");
    expect(host).not.toContain("super-secret-token");
  });

  test("is null for an id with no row, rather than throwing", () => {
    expect(store.jobHost("nope")).toBeNull();
  });

  test("masks an IP-literal source URL's host, dl-57 decision C", () => {
    store.create({
      id: "job-3",
      sourceUrl: "http://93.184.215.14/x",
      options: {},
      variantId: null,
      link: freshLink(),
      createdAt: "2026-08-06T10:00:00.000Z",
    });
    const host = store.jobHost("job-3");
    expect(host).toBe("ip-literal");
    expect(host).not.toContain("93.184.215.14");
  });
});

describe("probe_outcomes (dl-57)", () => {
  test("records a row with the fields given, and reads it back typed", () => {
    store.recordProbeOutcome(
      {
        host: "site.example",
        outcome: "ok",
        resolver: "browser",
        attempts: [{ resolver: "yt-dlp", code: "NO_MEDIA_FOUND", durationMs: 12 }],
        durationMs: 340,
        cached: false,
        variants: 3,
        drm: false,
      },
      "2026-08-06T10:00:00.000Z",
    );

    const rows = store.probeOutcomes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      host: "site.example",
      outcome: "ok",
      resolver: "browser",
      attempts: [{ resolver: "yt-dlp", code: "NO_MEDIA_FOUND", durationMs: 12 }],
      durationMs: 340,
      cached: false,
      variants: 3,
      drm: false,
      createdAt: "2026-08-06T10:00:00.000Z",
    });
  });

  test("never carries a path, a query string or an address — only a hostname", () => {
    // The row itself has no field that could hold one; this pins that the
    // schema stayed that way rather than growing a `url` column back.
    store.recordProbeOutcome({
      host: "cdn.example",
      outcome: "NO_MEDIA_FOUND",
      resolver: null,
      attempts: [],
      durationMs: 10,
      cached: false,
      variants: null,
      drm: false,
    });
    const [row] = store.probeOutcomes();
    expect(Object.keys(row as object).toSorted()).toEqual(
      [
        "attempts",
        "cached",
        "createdAt",
        "drm",
        "durationMs",
        "host",
        "id",
        "outcome",
        "resolver",
        "variants",
      ].toSorted(),
    );
  });

  test("pruneProbeOutcomes drops rows older than the cutoff and keeps newer ones", () => {
    store.recordProbeOutcome(
      {
        host: "old.example",
        outcome: "ok",
        resolver: "direct",
        attempts: [],
        durationMs: 1,
        cached: false,
        variants: 1,
        drm: false,
      },
      "2026-08-01T00:00:00.000Z",
    );
    store.recordProbeOutcome(
      {
        host: "new.example",
        outcome: "ok",
        resolver: "direct",
        attempts: [],
        durationMs: 1,
        cached: false,
        variants: 1,
        drm: false,
      },
      "2026-08-10T00:00:00.000Z",
    );

    const removed = store.pruneProbeOutcomes("2026-08-05T00:00:00.000Z");
    expect(removed).toBe(1);

    const hosts = store.probeOutcomes().map((row) => row.host);
    expect(hosts).toEqual(["new.example"]);
  });

  test("a job row written with retired error code MUX_FAILED still reads back (dl-74)", () => {
    // Simulate a row from before dl-74 that has MUX_FAILED. The schema accepts
    // it for backward compatibility even though nothing can raise it anymore.
    create("mux-job");
    const muxFailedJson = JSON.stringify({
      code: "MUX_FAILED",
      message: "The video could not be assembled into a playable file.",
      retryable: false,
    });

    // Update the row directly to have MUX_FAILED (simulating a row from before dl-74)
    const updateStmt = db.prepare(`UPDATE jobs SET error_json = ? WHERE id = ?`);
    updateStmt.run(muxFailedJson, "mux-job");

    // The job should still read back successfully, with the MUX_FAILED code preserved
    const readBack = store.get("mux-job");
    expect(readBack.error?.code).toBe("MUX_FAILED");
    expect(readBack.error?.message).toBe("The video could not be assembled into a playable file.");
    expect(readBack.error?.retryable).toBe(false);
  });
});
