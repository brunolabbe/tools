// @vitest-environment jsdom

/**
 * The three smaller components: the wait, the demo affordance, and the theme
 * switch.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than
 * a vitest project of its own.
 *
 * `AnalysingPanel` is the one with teeth. A browser probe reports no percentage
 * — it opens a page, provokes playback and waits for network quiet — so the bar
 * must be indeterminate and the reassurance has to come from elapsed time. That
 * is the never-fake-progress rule again, at the other place it lives.
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AnalysingPanel } from "../src/components/AnalysingPanel.tsx";
import { ScenarioHints } from "../src/components/ScenarioHints.tsx";
import { ThemeToggle } from "../src/components/ThemeToggle.tsx";
import { SCENARIOS, scenarioUrl } from "../src/api/scenarios.ts";
import { THEME_CHOICES } from "../src/lib/theme.ts";
import type { ThemeChoice } from "../src/lib/theme.ts";
import { NOW, SOURCE_URL } from "./fixtures.ts";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// AnalysingPanel
// ---------------------------------------------------------------------------

function analysing(): ReturnType<typeof vi.fn<() => void>> {
  const onCancel = vi.fn<() => void>();
  render(<AnalysingPanel url={SOURCE_URL} startedAt={NOW} onCancel={onCancel} />);
  return onCancel;
}

test("a probe in flight shows an indeterminate bar and never a percentage", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    analysing();

    const bar = screen.getByRole("progressbar");
    expect(bar.hasAttribute("value")).toBe(false);
    expect(bar.getAttribute("aria-label")).toBe("Analysing page: in progress, total unknown");
    expect(screen.queryByText(/%/u)).toBeNull();
    expect(screen.getByText(SOURCE_URL)).toBeDefined();
    expect(screen.getByText("0s")).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

test("the narration follows the clock rather than inventing progress", () => {
  // `useElapsed` reads `Date.now()` and drives a `setInterval`, so the system
  // time has to move with the timers — which is what vitest's fake timers do.
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    analysing();

    const stages = screen.getByRole("list");
    expect(within(stages).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("0s")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("5s")).toBeDefined();
    // Still narration, still no figure: the stage list is keyed to elapsed time.
    expect(screen.getByText("Provoking playback and watching network requests")).toBeDefined();
    expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("the wait can be abandoned", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const onCancel = analysing();
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    expect(onCancel).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

// ---------------------------------------------------------------------------
// ScenarioHints
// ---------------------------------------------------------------------------

test("the demo list offers every scenario plus the happy path, and says it is a mock", () => {
  const onPick = vi.fn<(url: string) => void>();
  render(<ScenarioHints onPick={onPick} />);

  expect(screen.getByText("mock API")).toBeDefined();
  const buttons = screen.getAllByRole("button");
  expect(buttons).toHaveLength(SCENARIOS.length + 1);
  expect(buttons[0]?.textContent).toContain("Happy path");
});

test("picking a scenario reports the URL that selects it", () => {
  const onPick = vi.fn<(url: string) => void>();
  render(<ScenarioHints onPick={onPick} />);

  const first = SCENARIOS[0];
  expect(first).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: new RegExp(first?.title ?? "", "u") }));
  expect(onPick).toHaveBeenCalledWith(scenarioUrl(first?.keyword ?? ""));

  fireEvent.click(screen.getAllByRole("button")[0] as HTMLButtonElement);
  expect(onPick).toHaveBeenLastCalledWith(scenarioUrl(""));
});

// ---------------------------------------------------------------------------
// ThemeToggle
// ---------------------------------------------------------------------------

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

    fireEvent.click(screen.getByRole("radio", { name: choice }));
    expect(onChange).toHaveBeenCalledWith(choice);
    expect(
      (screen.getAllByRole("radio") as HTMLInputElement[])
        .filter((input) => input.checked)
        .map((input) => input.value),
    ).toEqual(["system"]);
    cleanup();
  }
});
