import { describe, expect, test } from "vitest";
import { sanitizeFilename } from "../src/filename.ts";

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
