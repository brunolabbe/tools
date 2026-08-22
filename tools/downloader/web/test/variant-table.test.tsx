// @vitest-environment jsdom

/**
 * The rendition picker: what a row says, what order rows come in, and what a
 * click reports upward.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than
 * a vitest project of its own.
 *
 * Queried as `e2e/download.spec.ts` queries it — `getByRole("table")` and
 * `getByRole("radio")` — so the two suites go red together. The radios are the
 * whole accessibility claim of this component: native inputs in the row header
 * mean arrow keys move between renditions with no custom key handling, and a
 * test that clicked a `<tr>` would pass while that regressed.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MediaVariant } from "@downloader/contract";
import { VariantTable } from "../src/components/VariantTable.tsx";
import { pickDefaultVariantId } from "../src/lib/variants.ts";
import { variant, variants } from "./fixtures.ts";

afterEach(cleanup);

function mount(
  list: readonly MediaVariant[],
  selectedId: string | null = null,
): ReturnType<typeof vi.fn<(id: string) => void>> {
  const onSelect = vi.fn<(id: string) => void>();
  render(<VariantTable variants={list} selectedId={selectedId} onSelect={onSelect} />);
  return onSelect;
}

function radios(): HTMLInputElement[] {
  return within(screen.getByRole("table")).getAllByRole("radio") as HTMLInputElement[];
}

test("renditions are listed best-first, with video before audio-only", () => {
  mount(variants());

  // `sortVariantRows`: video first, then height descending. The fixture is
  // already in that order, so the interesting half is that audio-only sinks.
  expect(radios().map((input) => input.value)).toEqual(["v-2160", "v-1080", "v-audio"]);
});

test("a row spells out the rendition a user is choosing between", () => {
  mount(variants());

  const rows = within(screen.getByRole("table")).getAllByRole("row");
  // [0] is the header row; the rest follow the sorted order above.
  expect(rows[1]?.textContent).toContain("3840×2160");
  expect(rows[2]?.textContent).toContain("1920×1080");
  expect(rows[2]?.textContent).toContain("5.0 Mbps");
  expect(rows[2]?.textContent).toContain("401 MB");
  expect(rows[2]?.textContent).toContain("HLS");
});

test("an audio-only rendition says so rather than reporting a resolution", () => {
  mount(variants());

  const audioRow = within(screen.getByRole("table")).getAllByRole("row")[3];
  expect(audioRow?.textContent).toContain("audio only");
  // No video codec and no frame rate to report, and the table says so with the
  // same em dash it uses everywhere else rather than an empty cell.
  expect(audioRow?.textContent).toContain("—");
  expect(audioRow?.textContent).not.toContain("fps");
});

test("a rendition whose audio is a separate stream is marked as needing a mux", () => {
  mount(variants());

  const muxRow = within(screen.getByRole("table")).getAllByRole("row")[1];
  expect(muxRow?.textContent).toContain("+mux");
  // The 1080p one carries its own audio, so it is not marked.
  expect(within(screen.getByRole("table")).getAllByRole("row")[2]?.textContent).not.toContain(
    "+mux",
  );
});

test("a variant with no resolution renders the unknown marker, not a blank cell", () => {
  // Progressive downloads routinely arrive with no width or height at all.
  mount([variant({ id: "v-plain", width: undefined, height: undefined, fps: undefined })]);

  const row = within(screen.getByRole("table")).getAllByRole("row")[1];
  expect(row?.textContent).toContain("—");
  expect(row?.textContent).not.toContain("undefined");
  expect(row?.textContent).not.toContain("0p");
});

test("an estimated size is marked as an estimate", () => {
  mount([variant({ id: "v-est", filesizeIsEstimate: true })]);
  expect(screen.getByRole("table").textContent).toContain("est.");

  cleanup();
  mount([variant({ id: "v-measured", filesizeIsEstimate: false })]);
  expect(screen.getByRole("table").textContent).not.toContain("est.");
});

test("the selected rendition is the checked radio, and only that one", () => {
  mount(variants(), "v-1080");

  const checked = radios().filter((input) => input.checked);
  expect(checked.map((input) => input.value)).toEqual(["v-1080"]);
});

test("choosing another rendition reports its id upward", () => {
  const onSelect = mount(variants(), "v-1080");

  const audio = radios().find((input) => input.value === "v-audio");
  fireEvent.click(audio as HTMLInputElement);
  expect(onSelect).toHaveBeenCalledWith("v-audio");
});

test("the default selection is the one `pickDefaultVariantId` names", () => {
  // The rule is "highest quality that already carries audio", which for this
  // fixture means walking past the taller 2160p whose audio is a separate
  // stream. Asserted here against the table so the picker and the list agree;
  // `probe-panel.test.tsx` asserts the panel actually starts there.
  const list = variants();
  const chosen = pickDefaultVariantId(list);
  expect(chosen).toBe("v-1080");

  mount(list, chosen);
  expect(
    radios()
      .filter((input) => input.checked)
      .map((input) => input.value),
  ).toEqual(["v-1080"]);
});

test("an empty rendition list still renders a table with only its header", () => {
  mount([]);
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(1);
  expect(within(screen.getByRole("table")).queryAllByRole("radio")).toHaveLength(0);
});
