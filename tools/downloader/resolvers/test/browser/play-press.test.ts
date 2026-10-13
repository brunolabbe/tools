/**
 * dl-114: the attribute rule behind "a press that counts" (dl-100), without a
 * browser. `isPlayPress` reads five attributes off the pressed element and
 * hands them to `attributesMarkPlayPress`; these rows are those attribute sets.
 * Each row that was a probe of its own through Chromium carries the `ctl=` name
 * of its fixture (`box-with-control.html`, `player-poster-icon-grid.html`); the
 * rows `browser-resolver.test.ts` keeps stand here too, so the table is the
 * whole rule. `watch` is not here: the `Watch` link takes the visible-text path,
 * and `xo` is a press in a frame, so neither reaches this rule.
 */

import { describe, expect, test } from "vitest";
import { attributesMarkPlayPress } from "../../src/browser/provoke.ts";

type Attributes = Partial<Record<"aria-label" | "title" | "data-testid" | "class" | "id", string>>;

/** What `isPlayPress` hands over: every attribute it reads, null where the element has none. */
function read(attributes: Attributes): ReadonlyMap<string, string | null> {
  return new Map<string, string | null>(
    (["aria-label", "title", "data-testid", "class", "id"] as const).map((name) => [
      name,
      attributes[name] ?? null,
    ]),
  );
}

describe("attributesMarkPlayPress: controls that are pressed but do not count", () => {
  test.each([
    // The Autoplay toggle and a display name: "play" sits inside the word.
    ["autoplay (kept in the browser)", { "aria-label": "Autoplay" }],
    ["display", { "data-testid": "display-name" }],
    // The word is read in the attribute the selector matched on, not in the
    // others: a `player-` class or id on the same element does not turn the
    // toggle into a play control.
    ["autoplay-cls", { "aria-label": "Autoplay", class: "player-autoplay-toggle" }],
    ["autoplay-id", { "aria-label": "Autoplay", id: "player-autoplay" }],
    ["autoplay-camel", { "data-testid": "autoPlayToggle" }],
    ["display-cls", { "data-testid": "display-name", class: "player-meta" }],
    // Nothing to read at all, and the neighbours of the library names.
    ["no attributes", {}],
    ["an id that only contains play", { id: "display" }],
    ["a class that is not a library's", { class: "vjs-control-bar" }],
  ] as const satisfies readonly (readonly [string, Attributes])[])("%s", (_ctl, attributes) => {
    expect(attributesMarkPlayPress(read(attributes))).toBe(false);
  });
});

describe("attributesMarkPlayPress: controls that count", () => {
  test.each([
    // A library's own class holds no "play" word at all for `jw`.
    ["jw (kept in the browser)", { class: "jw-icon-display" }],
    ["vjs", { class: "video-js vjs-big-play-button" }],
    ["ytp", { class: "ytp-large-play-button ytp-button" }],
    ["plyr", { class: "plyr__control--overlaid" }],
    // A word start in the data-testid, the class and the id, each alone.
    ["testid-word", { "data-testid": "play-toggle" }],
    ["class-btn", { class: "play-btn" }],
    ["id-button", { id: "play-button" }],
    ["id-play", { id: "play" }],
    ["carousel", { "aria-label": "Play slideshow" }],
    // Gate 1 of dl-100: an icon-only control marked in camelCase, with no label.
    ["camel-testid", { "data-testid": "videoPlayButton" }],
    ["camel-title", { title: "VideoPlay" }],
    // The harness's own control (`label`), and the title path.
    ["label", { "aria-label": "Play" }],
    ["title", { title: "Play video" }],
    // Errs toward counting: these start a word with "play".
    ["Playlist", { "aria-label": "Playlist" }],
    ["Player", { "aria-label": "Player info" }],
    // Matched by one selector, counted through another attribute's word.
    ["display-name with a Player title", { "data-testid": "display-name", title: "Player info" }],
  ] as const satisfies readonly (readonly [string, Attributes])[])("%s", (_ctl, attributes) => {
    expect(attributesMarkPlayPress(read(attributes))).toBe(true);
  });
});
