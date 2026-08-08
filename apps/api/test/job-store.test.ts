/**
 * The store is the only place the job FSM is enforced, so these tests are
 * really tests of that enforcement. The brief is explicit: reject illegal
 * transitions rather than tolerating them.
 */

import Database from "better-sqlite3";
import { AppError } from "@downloader/shared";
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
