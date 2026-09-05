/**
 * `chooseVariant` reads `MediaVariant.hasAudio`, which since dl-42 has three
 * states rather than two: `true`, `false`, and absent for a tier that never
 * looked. Both readers here branched on truthiness, which silently folded
 * "unverified" into "silent" — the exact failure mode the optional field was
 * introduced to make impossible. This file pins the three-way behaviour of both.
 *
 * Pure functions, no fixtures, no engine.
 */

import { describe, expect, test } from "vitest";
import type { MediaVariant, ProbeResult } from "@downloader/contract";
import { chooseVariant, compareQuality } from "../src/jobs/variant-selection.ts";

function variant(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "v",
    protocol: "progressive",
    url: "https://cdn.example/file.mp4",
    hasVideo: true,
    hasAudio: true,
    width: 1280,
    height: 720,
    label: "720p",
    ...overrides,
  };
}

function probe(variants: readonly MediaVariant[]): ProbeResult {
  return {
    sourceUrl: "https://site.example/watch",
    resolver: "direct",
    title: "clip",
    variants: [...variants],
    subtitles: [],
    requestContext: { headers: {} },
    drm: { protected: false, systems: [] },
    isLive: false,
    probedAt: "2026-09-05T00:00:00.000Z",
  };
}

describe("audio as a tiebreak", () => {
  test("verified audio beats unverified, which beats verified silence", () => {
    const yes = variant({ id: "yes", hasAudio: true });
    const dunno = variant({ id: "dunno", hasAudio: undefined });
    const no = variant({ id: "no", hasAudio: false });

    // Identical pixels and bitrate, so `audioScore` is the only thing deciding.
    expect([no, dunno, yes].toSorted(compareQuality).map((item) => item.id)).toEqual([
      "yes",
      "dunno",
      "no",
    ]);

    // The pairwise claim, so the ordering cannot come out right by accident:
    // a variant nobody inspected must not be ranked below a known-silent one.
    expect(compareQuality(dunno, no)).toBeLessThan(0);
    expect(compareQuality(dunno, yes)).toBeGreaterThan(0);
  });

  test("resolution still outranks any of it", () => {
    const tall = variant({ id: "tall", width: 1920, height: 1080, hasAudio: false });
    const short = variant({ id: "short", hasAudio: true });
    expect([short, tall].toSorted(compareQuality).map((item) => item.id)).toEqual([
      "tall",
      "short",
    ]);
  });
});

describe("audioOnly narrowing", () => {
  test("keeps a variant nobody inspected as a candidate", () => {
    const dunno = variant({ id: "dunno", hasAudio: undefined });
    const silent = variant({ id: "silent", hasAudio: false, width: 3840, height: 2160 });

    // `silent` is the higher rendition and would win on pixels, so choosing
    // `dunno` can only be the filter doing its job. Truthiness would have
    // dropped `dunno` and handed back the one variant that certainly cannot
    // satisfy the request.
    const choice = chooseVariant(probe([silent, dunno]), { audioOnly: true });
    expect(choice.variant.id).toBe("dunno");
    expect(choice.substituted).toBe(false);
  });

  test("pixels still come before the audio tiebreak once both survive the filter", () => {
    const dunno = variant({ id: "dunno", hasAudio: undefined, width: 3840, height: 2160 });
    const yes = variant({ id: "yes", hasAudio: true });

    // Both survive the filter, so this is `audioScore` breaking the tie — and
    // it does not, here: `dunno` is 4K and pixels come first. That is the
    // documented order, and it is worth pinning so a future reshuffle of
    // `compareQuality` is a deliberate change rather than a silent one.
    expect(chooseVariant(probe([yes, dunno]), { audioOnly: true }).variant.id).toBe("dunno");
  });

  test("falls back to everything only when every variant is known to be silent", () => {
    const a = variant({ id: "a", hasAudio: false });
    const b = variant({ id: "b", hasAudio: false, width: 1920, height: 1080 });

    // Refusing would be worse than trying: ffmpeg will find the track or fail
    // with a message that says so.
    expect(chooseVariant(probe([a, b]), { audioOnly: true }).variant.id).toBe("b");
  });
});
