/**
 * dl-114: the attribute rule behind "a press that counts" (dl-100), without a
 * browser. `isPlayPress` reads the attributes in `PLAY_PRESS_ATTRIBUTES` off the
 * pressed element and hands them to `attributesMarkPlayPress`; these rows are
 * those attribute sets, built from that same list. Each row that was a probe of
 * its own through Chromium carries the `ctl=` name of its fixture
 * (`box-with-control.html`, or the deleted `player-poster-icon-grid.html`); the
 * rows `browser-resolver.test.ts` keeps stand here too, so the table is the
 * whole rule. `watch` and `xo` are not here: the `Watch` link and `xo`'s "Watch
 * now" button carry no attribute mark, so they take the visible-text path
 * (`clickByText`) and never reach this rule. A frame is not the reason:
 * `provoke.ts` runs the same selector press, with `isPlayPress`, in every frame.
 *
 * What the table cannot see is Playwright's own `getAttribute` in a real page.
 * That is covered thinly by the browser rows that remain: `ctl=jw` counts
 * through a class, and the pages that count through `id="play"`.
 */

import { describe, expect, test } from "vitest";
import { PLAY_PRESS_ATTRIBUTES, attributesMarkPlayPress } from "../../src/browser/provoke.ts";

const ATTRIBUTE_NAMES = ["aria-label", "title", "data-testid", "class", "id"] as const;
type Attributes = Partial<Record<(typeof ATTRIBUTE_NAMES)[number], string>>;

/**
 * What `isPlayPress` hands over: the attributes it reads, from the list it reads
 * them by, null where the element has none. An attribute dropped from that list
 * is therefore absent here too, and the rows that depend on it fail.
 */
function read(attributes: Attributes): ReadonlyMap<string, string | null> {
  return new Map<string, string | null>(
    PLAY_PRESS_ATTRIBUTES.map((name) => [name, attributes[name as keyof Attributes] ?? null]),
  );
}

describe("PLAY_PRESS_ATTRIBUTES", () => {
  test("is the five attributes the rows below can set, so a row cannot name one the read lacks", () => {
    expect(PLAY_PRESS_ATTRIBUTES.toSorted()).toEqual(ATTRIBUTE_NAMES.toSorted());
  });
});

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
