/**
 * `browser/variants.ts` builds variants from network evidence alone, and its own
 * docblock states the rule it has to keep: *fields are only populated when they
 * were observed*. Until dl-42 `progressiveVariants` broke that rule for exactly
 * one field, hardcoding `hasAudio: true` on a hit that carries a URL, a
 * `Content-Type` and a length and nothing about streams — the same claim the
 * direct tier made, reaching the same mux by the other route.
 *
 * The module had no test file at all, which is why reverting that one line left
 * the whole suite green. This is that file.
 */

import { describe, expect, test } from "vitest";
import { opaqueManifestVariant, progressiveVariants } from "../../src/browser/variants.ts";
import type { NetworkHit } from "../../src/browser/types.ts";

function hit(overrides: Partial<NetworkHit> = {}): NetworkHit {
  return {
    url: "https://cdn.example.com/media/clip.mp4",
    key: "cdn.example.com/media/clip.mp4",
    kind: "progressive",
    headers: { Referer: "https://site.example/watch" },
    contentType: "video/mp4",
    contentLength: 2_097_152,
    seq: 1,
    confirmed: true,
    ...overrides,
  };
}

describe("progressiveVariants", () => {
  test("does not claim an audio track a network hit never mentioned", () => {
    const [built] = progressiveVariants([hit()]);

    // Absent, not `false`: nothing was inspected, so neither answer is earned.
    expect(built?.hasAudio).toBeUndefined();
    expect("hasAudio" in (built ?? {})).toBe(false);
  });

  test("still populates what the hit really did observe", () => {
    // The guard against over-correcting: the fix removes one unearned field and
    // must leave the observed ones alone.
    const [built] = progressiveVariants([hit()]);

    expect(built).toMatchObject({
      id: "browser-file-0",
      protocol: "progressive",
      url: "https://cdn.example.com/media/clip.mp4",
      hasVideo: true,
      container: "mp4",
      filesizeBytes: 2_097_152,
      filesizeIsEstimate: false,
    });
    expect(built?.label).toBe("MP4 · 2.0 MB");
  });

  test("an audio-only hit is still video-less, and still says nothing about audio", () => {
    // `hasVideo` is a real observation — the Content-Type said `audio/` — so it
    // stays. `hasAudio` is not, even here, where it is the likelier of the two.
    const [built] = progressiveVariants([
      hit({ url: "https://cdn.example.com/media/track.m4a", contentType: "audio/mp4" }),
    ]);

    expect(built?.hasVideo).toBe(false);
    expect(built?.hasAudio).toBeUndefined();
    expect(built?.label).toContain("audio only");
  });
});

describe("opaqueManifestVariant", () => {
  test("still claims audio, deliberately, because that path cannot fail on it", () => {
    // dl-42 left this one alone and the exclusion is worth pinning rather than
    // leaving to be re-litigated. An HLS/DASH variant is downloaded through
    // `engine/src/download/manifest.ts`, which maps every stream with a trailing
    // `?` whatever `hasAudio` says — so an over-claim here cannot produce the
    // `Stream map '0:a:0' matches no streams` failure that motivated the change.
    const built = opaqueManifestVariant(hit({ kind: "hls" }), "browser-manifest-0");

    expect(built.hasAudio).toBe(true);
    expect(built.protocol).toBe("hls");
  });
});
