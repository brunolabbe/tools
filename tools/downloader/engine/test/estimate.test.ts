import { describe, expect, test } from "vitest";
import { AppError } from "@downloader/contract";
import type { MediaVariant } from "@downloader/contract";
import { assertDiskSpace, assertWithinSizeLimit, estimateVariantBytes } from "../src/estimate.ts";

function variant(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "v",
    protocol: "hls",
    url: "https://cdn.example/master.m3u8",
    hasVideo: true,
    hasAudio: true,
    label: "1080p",
    ...overrides,
  };
}

describe("estimateVariantBytes", () => {
  test("prefers a measured size", () => {
    const estimate = estimateVariantBytes(variant({ filesizeBytes: 12_345 }));
    expect(estimate).toMatchObject({ bytes: 12_345, basis: "measured" });
  });

  test("flags a resolver-supplied approximation as such", () => {
    const estimate = estimateVariantBytes(
      variant({ filesizeBytes: 12_345, filesizeIsEstimate: true }),
    );
    expect(estimate.basis).toBe("declared-estimate");
  });

  test("computes bitrate x duration when no size is known", () => {
    const estimate = estimateVariantBytes(variant({ bitrateBps: 8_000_000, durationSec: 100 }));

    // 8 Mbit/s for 100 s = 100 MB, plus 2% container overhead.
    expect(estimate.basis).toBe("bitrate-duration");
    expect(estimate.bytes).toBe(Math.round(100_000_000 * 1.02));
  });

  test("adds audio when the rendition is separate and its bitrate is unknown", () => {
    const muxed = estimateVariantBytes(variant({ bitrateBps: 1_000_000, durationSec: 60 }));
    const split = estimateVariantBytes(
      variant({
        bitrateBps: 1_000_000,
        durationSec: 60,
        audioUrl: "https://cdn.example/audio.m3u8",
      }),
    );

    expect(split.bytes ?? 0).toBeGreaterThan(muxed.bytes ?? 0);
  });

  test("budgets the separate rendition for an unverified track too, not just a claimed one", () => {
    // dl-42: `hasAudio` has three states, and this branch reads `!== false`
    // rather than truthiness on purpose — over-estimating against a size limit
    // is the safe direction, and refusing to budget for a track we are about to
    // mux in would let a job past the cap and fail late.
    const base = { bitrateBps: 1_000_000, durationSec: 60 } as const;
    const audioBytes = Math.round(((128_000 * 60) / 8) * 1.02);

    const claimed = estimateVariantBytes(
      variant({ ...base, hasAudio: true, audioUrl: "https://cdn.example/audio.m3u8" }),
    );
    const unverified = estimateVariantBytes(
      variant({ ...base, hasAudio: undefined, audioUrl: "https://cdn.example/audio.m3u8" }),
    );
    const silent = estimateVariantBytes(
      variant({ ...base, hasAudio: false, audioUrl: "https://cdn.example/audio.m3u8" }),
    );

    // Unverified is budgeted exactly as a claimed track is...
    expect(unverified.bytes).toBe(claimed.bytes);
    // ...and only a verified silence is not, by exactly the assumed audio.
    expect((claimed.bytes ?? 0) - (silent.bytes ?? 0)).toBe(audioBytes);
  });

  test("uses a live duration limit instead of a stale DVR-window size", () => {
    const estimate = estimateVariantBytes(
      variant({ filesizeBytes: 900_000_000_000, bitrateBps: 4_000_000 }),
      { liveDurationSec: 60 },
    );

    expect(estimate.basis).toBe("bitrate-duration");
    expect(estimate.bytes).toBe(Math.round(((4_000_000 * 60) / 8) * 1.02));
  });

  test("reports unknown rather than guessing", () => {
    const estimate = estimateVariantBytes(variant());
    expect(estimate).toMatchObject({ bytes: null, basis: "unknown" });
  });

  test("cannot be estimated without a duration, however good the bitrate is", () => {
    expect(estimateVariantBytes(variant({ bitrateBps: 5_000_000 })).bytes).toBeNull();
  });
});

describe("assertWithinSizeLimit", () => {
  const limit = 100 * 1024 * 1024;

  test("passes exactly at the limit and fails one byte over", () => {
    expect(
      assertWithinSizeLimit(
        {
          bytes: limit,
          basis: "measured",
          durationSec: null,
          bitrateBps: null,
        },
        limit,
      ),
    ).toBe(true);

    expect(() =>
      assertWithinSizeLimit(
        { bytes: limit + 1, basis: "measured", durationSec: null, bitrateBps: null },
        limit,
      ),
    ).toThrow(AppError);
  });

  test("raises SIZE_LIMIT_EXCEEDED with the evidence, before any download starts", () => {
    // A four-hour 4K stream: exactly the case this check exists for.
    const estimate = estimateVariantBytes(
      variant({ bitrateBps: 25_000_000, durationSec: 4 * 3600 }),
    );

    try {
      assertWithinSizeLimit(estimate, 4096 * 1024 * 1024, { jobId: "j1" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe("SIZE_LIMIT_EXCEEDED");
      expect(appError.retryable).toBe(false);
      expect(appError.details).toMatchObject({
        jobId: "j1",
        basis: "bitrate-duration",
        limitBytes: 4096 * 1024 * 1024,
      });
    }
  });

  test("an unknown estimate is not a failure — it reports that no check happened", () => {
    const checked = assertWithinSizeLimit(
      { bytes: null, basis: "unknown", durationSec: null, bitrateBps: null },
      1,
    );
    expect(checked).toBe(false);
  });
});

describe("assertDiskSpace", () => {
  test("throws DISK_FULL when the estimate plus headroom does not fit", async () => {
    await expect(
      assertDiskSpace("/storage", {
        requiredBytes: 1_000_000_000,
        headroomFactor: 2,
        minFreeBytes: 0,
        freeBytesImpl: async () => 1_500_000_000,
      }),
    ).rejects.toMatchObject({ code: "DISK_FULL" });
  });

  test("passes when there is room for the working copy and the result", async () => {
    await expect(
      assertDiskSpace("/storage", {
        requiredBytes: 1_000_000_000,
        headroomFactor: 2,
        minFreeBytes: 0,
        freeBytesImpl: async () => 3_000_000_000,
      }),
    ).resolves.toBeUndefined();
  });

  test("enforces the absolute free-space floor even for a tiny download", async () => {
    await expect(
      assertDiskSpace("/storage", {
        requiredBytes: 1024,
        minFreeBytes: 512 * 1024 * 1024,
        freeBytesImpl: async () => 10 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: "DISK_FULL" });
  });

  test("passes when the platform will not report free space", async () => {
    await expect(
      assertDiskSpace("/storage", {
        requiredBytes: 10 ** 15,
        freeBytesImpl: async () => null,
      }),
    ).resolves.toBeUndefined();
  });
});
