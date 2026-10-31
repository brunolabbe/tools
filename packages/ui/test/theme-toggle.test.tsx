// @vitest-environment jsdom

/**
 * The theme switch, moved here from the downloader's `chrome.test.tsx` with the
 * component (repo-131), plus what the move added: an icon per choice, with the
 * accessible name kept in hidden text.
 *
 * The DOM arrives as a docblock, as in the tools' `web` suites: the `core`
 * project is node, and one line per file is cheaper than a second project.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "../src/ThemeToggle.tsx";
import { THEME_CHOICES } from "../src/theme.ts";
import type { ThemeChoice } from "../src/theme.ts";

afterEach(cleanup);

const NAMES: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

test("the theme switch offers every choice and marks whichever is current", () => {
  // Every choice, not one: a `checked` hard-coded against a single value would
  // pass a test that only ever mounted with `value="dark"`.
  for (const choice of THEME_CHOICES) {
    render(<ThemeToggle value={choice} onChange={vi.fn()} />);

    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios.map((input) => input.value)).toEqual([...THEME_CHOICES]);
    expect(radios.filter((input) => input.checked).map((input) => input.value)).toEqual([choice]);
    // The group is named for a screen reader even though the legend is visually
    // hidden, so "Colour theme" is what it answers to.
    expect(screen.getByRole("group", { name: "Colour theme" })).toBeDefined();
    cleanup();
  }
});

test("choosing a theme reports it upward without owning the state", () => {
  // Controlled-ness from both ends: whichever choice is clicked is reported,
  // and the selection does not move until the parent moves it. Swap `checked`
  // for `defaultChecked` in the component and the second half goes red.
  for (const choice of THEME_CHOICES.filter((candidate) => candidate !== "system")) {
    const onChange = vi.fn<(next: ThemeChoice) => void>();
    render(<ThemeToggle value="system" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: NAMES[choice] }));
    expect(onChange).toHaveBeenCalledWith(choice);
    expect(
      (screen.getAllByRole("radio") as HTMLInputElement[])
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(["system"]);
    cleanup();
  }
});

test("each choice shows an icon and keeps its name for a screen reader", () => {
  render(<ThemeToggle value="system" onChange={vi.fn()} />);

  for (const choice of THEME_CHOICES) {
    const radio = screen.getByRole("radio", { name: NAMES[choice] });
    const label = radio.closest("label");
    // The icon is decorative, so it does not double the name.
    const icon = label?.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    // The radio is hidden with the shared `.sr-only` (repo-130), not a
    // tool's own class, and stays a native radio so the arrow keys move it.
    expect(radio.className).toBe("sr-only");
    expect(label?.title).toBe(NAMES[choice]);
  }
});
