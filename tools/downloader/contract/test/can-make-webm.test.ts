/**
 * dl-99: the one rule the engine refuses by and the picker withholds by.
 * Each case is built to fail if its branch is removed.
 */

import { describe, expect, test } from "vitest";
import { canMakeWebm, DEFAULT_ERROR_MESSAGES, ERROR_CODES } from "../src/index.ts";
import type { MediaVariant } from "../src/index.ts";

function file(overrides: Partial<MediaVariant> = {}): MediaVariant {
  return {
    id: "f",
    protocol: "progressive",
    url: "https://cdn.example/a.mp4",
    hasVideo: true,
    hasAudio: true,
    label: "f",
    ...overrides,
  };
}

describe("canMakeWebm (dl-99)", () => {
  test("a file nothing describes cannot, whatever its container", () => {
    for (const container of [undefined, "mp4", "mkv", "flv", "m4a"]) {
      expect(canMakeWebm(file({ container }))).toBe(false);
    }
  });

  test("a WebM source can without naming a codec, in any spelling of its container", () => {
    for (const container of ["webm", "WebM", ".webm", " webm "]) {
      expect(canMakeWebm(file({ container }))).toBe(true);
    }
  });

  test("declared codecs can, because the engine transcodes what does not fit", () => {
    expect(canMakeWebm(file({ videoCodec: "avc1.42c01e", audioCodec: "mp4a.40.2" }))).toBe(true);
  });

  test("one undeclared track is enough to refuse", () => {
    expect(canMakeWebm(file({ videoCodec: "avc1" }))).toBe(false);
    expect(canMakeWebm(file({ audioCodec: "mp4a" }))).toBe(false);
  });

  test("none and unknown name nothing", () => {
    expect(canMakeWebm(file({ videoCodec: "none", audioCodec: "unknown" }))).toBe(false);
    expect(canMakeWebm(file({ videoCodec: " ", audioCodec: "mp4a" }))).toBe(false);
  });

  test("a track the file is known not to have needs no codec", () => {
    expect(canMakeWebm(file({ hasAudio: false, videoCodec: "avc1" }))).toBe(true);
    expect(canMakeWebm(file({ hasVideo: false, audioCodec: "mp4a" }))).toBe(true);
  });

  test("an audio-only cut needs the audio's codec and not the video's", () => {
    expect(canMakeWebm(file({ audioCodec: "mp4a" }), { audioOnly: true })).toBe(true);
    expect(canMakeWebm(file({ videoCodec: "avc1" }), { audioOnly: true })).toBe(false);
  });

  test("a separate audio file is judged on its own codec, not on the video's container", () => {
    const split = file({ container: "webm", audioUrl: "https://cdn.example/a.m4a" });
    expect(canMakeWebm(split)).toBe(false);
    expect(canMakeWebm({ ...split, audioCodec: "mp4a" })).toBe(true);
  });

  test("a manifest is not judged by this rule", () => {
    expect(canMakeWebm(file({ protocol: "hls" }))).toBe(true);
    expect(canMakeWebm(file({ protocol: "dash" }))).toBe(true);
  });

  test("the refusal has a code and copy of its own", () => {
    expect(ERROR_CODES).toContain("CONTAINER_UNSUPPORTED");
    expect(DEFAULT_ERROR_MESSAGES.CONTAINER_UNSUPPORTED).toMatch(/WebM/u);
  });
});
