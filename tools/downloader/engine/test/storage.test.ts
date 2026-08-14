import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AppError } from "@downloader/contract";
import { assertPathInside, sanitizeFilename, Storage } from "../src/storage.ts";

describe("sanitizeFilename", () => {
  test("collapses path traversal into a single harmless segment", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("_.._.._etc_passwd");
    expect(sanitizeFilename("..")).toBe("download");
    expect(sanitizeFilename("../..")).toBe("_");
    expect(sanitizeFilename("a/b\\c")).toBe("a_b_c");

    for (const hostile of ["../../../etc/passwd", "..", "../..", "a/b\\c", "..\\..\\win.ini"]) {
      const safe = sanitizeFilename(hostile);
      expect(safe).not.toContain("/");
      expect(safe).not.toContain("\\");
      expect(safe).not.toBe("..");
      expect(safe).not.toBe(".");
    }
  });

  test("removes characters Windows refuses and control characters", () => {
    expect(sanitizeFilename('a:b*c?d"e<f>g|h')).toBe("a_b_c_d_e_f_g_h");
    expect(sanitizeFilename("clip\u0000name\u001Fx.mp4")).toBe("clipnamex.mp4");
  });

  test("defuses reserved DOS device names, which still swallow writes", () => {
    expect(sanitizeFilename("CON")).toBe("_CON");
    expect(sanitizeFilename("nul.mp4")).toBe("_nul.mp4");
    expect(sanitizeFilename("COM1.mkv")).toBe("_COM1.mkv");
    expect(sanitizeFilename("LPT9")).toBe("_LPT9");
    // Not reserved — only the exact names are.
    expect(sanitizeFilename("console.mp4")).toBe("console.mp4");
  });

  test("strips leading and trailing dots and spaces", () => {
    expect(sanitizeFilename("  .hidden.mp4  ")).toBe("hidden.mp4");
    expect(sanitizeFilename("trailing.  ")).toBe("trailing");
  });

  test("caps the length while keeping the extension", () => {
    const name = sanitizeFilename(`${"x".repeat(400)}.mp4`, { maxLength: 40 });
    expect(name.length).toBeLessThanOrEqual(40);
    expect(name.endsWith(".mp4")).toBe(true);
  });

  test("falls back when nothing survives", () => {
    expect(sanitizeFilename("")).toBe("download");
    expect(sanitizeFilename("...")).toBe("download");
    expect(sanitizeFilename("\u0000\u0001")).toBe("download");
    expect(sanitizeFilename("", { fallback: "video.mp4" })).toBe("video.mp4");
  });

  test("keeps ordinary unicode titles intact", () => {
    expect(sanitizeFilename("Café — épisode 3.mp4")).toBe("Café — épisode 3.mp4");
  });
});

describe("assertPathInside", () => {
  const root = path.resolve("/storage");

  test("accepts a path under the root", () => {
    expect(assertPathInside(root, "out/job1/file.mp4")).toBe(
      path.join(root, "out", "job1", "file.mp4"),
    );
  });

  test("rejects traversal out of the root", () => {
    expect(() => assertPathInside(root, "../secrets.txt")).toThrow(AppError);
    expect(() => assertPathInside(root, "out/../../etc/passwd")).toThrow(AppError);
  });

  test("rejects an absolute path elsewhere", () => {
    const elsewhere = process.platform === "win32" ? "C:\\Windows\\system.ini" : "/etc/passwd";
    expect(() => assertPathInside(root, elsewhere)).toThrow(AppError);
  });

  test("rejects the root itself, which is never a valid destination", () => {
    expect(() => assertPathInside(root, ".")).toThrow(AppError);
  });

  test("does not confuse a sibling whose name starts with the root", () => {
    expect(() => assertPathInside(root, path.join(root + "-other", "x"))).toThrow(AppError);
  });

  test("throws AppError with a taxonomy code, never a bare Error", () => {
    try {
      assertPathInside(root, "../escape");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("INTERNAL");
    }
  });
});

describe("Storage", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-storage-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function storage(hours = 6, tmpHours = 6): Storage {
    return new Storage({
      storageDir: root,
      fileRetentionHours: hours,
      tmpRetentionHours: tmpHours,
    });
  }

  test("keeps a hostile job id and filename inside the storage root", () => {
    const store = storage();

    const outDir = store.outDir("../../escape");
    expect(outDir.startsWith(root)).toBe(true);

    const outPath = store.outPath("job1", "../../../etc/passwd");
    expect(outPath.startsWith(path.join(root, "out", "job1"))).toBe(true);
    expect(path.basename(outPath)).toBe("_.._.._etc_passwd");
  });

  test("cleanupJob removes tmp but leaves the finished artifact", async () => {
    const store = storage();
    await store.init();
    await store.createTmpDir("j1");
    await store.createOutDir("j1");
    await fs.writeFile(store.outPath("j1", "video.mp4"), "data");

    await store.cleanupJob("j1");

    await expect(fs.stat(store.tmpDir("j1"))).rejects.toThrow();
    await expect(fs.stat(store.outPath("j1", "video.mp4"))).resolves.toBeDefined();
  });

  test("removeJob takes the artifact too, so a failed job leaves nothing", async () => {
    const store = storage();
    await store.init();
    await store.createOutDir("j2");
    await fs.writeFile(store.outPath("j2", "partial.mp4"), "half");

    await store.removeJob("j2");
    await expect(fs.stat(store.outDir("j2"))).rejects.toThrow();
  });
});

/** Creates a job directory pair with a synthetic age via utimes. */
async function seed(store: Storage, jobId: string, ageHours: number): Promise<void> {
  const outDir = store.outDir(jobId);
  const tmpDir = store.tmpDir(jobId);
  await fs.mkdir(outDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  const outFile = path.join(outDir, "video.mp4");
  const tmpFile = path.join(tmpDir, "media.ts");
  await fs.writeFile(outFile, "x".repeat(1024));
  await fs.writeFile(tmpFile, "y".repeat(512));

  const when = new Date(Date.now() - ageHours * 3600 * 1000);
  for (const target of [outFile, tmpFile, outDir, tmpDir]) {
    await fs.utimes(target, when, when);
  }
}

describe("retention GC", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "engine-gc-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  test("removes only directories past the retention window", async () => {
    const store = new Storage({ storageDir: root, fileRetentionHours: 6 });
    await store.init();
    await seed(store, "old", 10);
    await seed(store, "fresh", 1);

    const report = await store.collectGarbage();

    expect(report.removedOutDirs.map((dir) => path.basename(dir))).toEqual(["old"]);
    expect(report.removedTmpDirs.map((dir) => path.basename(dir))).toEqual(["old"]);
    expect(report.freedBytes).toBe(1024 + 512);

    await expect(fs.stat(store.outDir("fresh"))).resolves.toBeDefined();
    await expect(fs.stat(store.outDir("old"))).rejects.toThrow();
  });

  test("sweeps an orphaned tmp dir on its own schedule", async () => {
    const store = new Storage({
      storageDir: root,
      fileRetentionHours: 24,
      tmpRetentionHours: 2,
    });
    await store.init();
    await seed(store, "crashed", 5);

    const report = await store.collectGarbage();

    // The artifact is still within its 24 h window; the tmp dir is not.
    expect(report.removedOutDirs).toEqual([]);
    expect(report.removedTmpDirs.map((dir) => path.basename(dir))).toEqual(["crashed"]);
  });

  test("an injected `now` drives the sweep, so age is testable without waiting", async () => {
    const store = new Storage({ storageDir: root, fileRetentionHours: 6 });
    await store.init();
    await seed(store, "recent", 0);

    expect((await store.collectGarbage()).removedOutDirs).toEqual([]);

    const sevenHoursOn = Date.now() + 7 * 3600 * 1000;
    const later = await store.collectGarbage(sevenHoursOn);
    expect(later.removedOutDirs.map((dir) => path.basename(dir))).toEqual(["recent"]);
  });
});
