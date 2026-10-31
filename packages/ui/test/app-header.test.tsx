// @vitest-environment jsdom

/**
 * The header (repo-131): the tool's glyph, name and tagline, and the theme it
 * owns, so a tool's `App` carries no theme state.
 */

import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppHeader } from "../src/AppHeader.tsx";
import { THEME_COOKIE, applyTheme, saveTheme } from "../src/theme.ts";

afterEach(() => {
  cleanup();
  saveTheme("system");
  applyTheme("system");
});

const GLYPH = <svg data-testid="glyph" />;

test("renders the glyph, the name as the page's heading, and the tagline", () => {
  render(<AppHeader name="Downloader" tagline="Pull a stream down." glyph={GLYPH} />);

  expect(screen.getByRole("heading", { level: 1, name: "Downloader" })).toBeDefined();
  expect(screen.getByText("Pull a stream down.")).toBeDefined();
  // Decorative beside the name: hidden from a screen reader, which hears the name.
  expect(screen.getByTestId("glyph").parentElement?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("group", { name: "Colour theme" })).toBeDefined();
});

test("starts from the cookie, and a choice is applied and stored", () => {
  saveTheme("dark");
  render(<AppHeader name="Ledger" tagline="Shared account." glyph={GLYPH} />);

  expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);

  fireEvent.click(screen.getByRole("radio", { name: "Light" }));

  expect(document.documentElement.dataset["theme"]).toBe("light");
  expect(document.cookie).toContain(`${THEME_COOKIE}=light`);

  fireEvent.click(screen.getByRole("radio", { name: "System" }));

  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(document.cookie).not.toContain(THEME_COOKIE);
});
