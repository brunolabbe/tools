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

/**
 * Which stage the panel is narrating, by ARIA state.
 *
 * This used to read `.stages__item--active`, because a class was all there was:
 * the stage list marked done, active and pending with CSS alone, so a screen
 * reader heard five items and no indication of which one was happening. dl-18
 * closed that here and at `JobCard`'s pipeline together — the two lists read as
 * siblings to a user, and narrating one without the other leaves the tool half
 * spoken for.
 */
function activeStage(): string {
  return screen.getByRole("listitem", { current: "step" }).textContent ?? "";
}

/** The stages the panel says are behind it, in list order. */
function doneStages(): string[] {
  return screen
    .getAllByRole("listitem", { name: /, done$/u })
    .map((item) => item.textContent ?? "");
}

/** The class the stylesheet keys off, which is set from the same expression. */
function stageClasses(): string[] {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((item) => item.className);
}

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

    // All five stage texts are on screen at every elapsed time — only the
    // *marking* moves. So asserting a stage's text is present proves nothing
    // about the clock, which is what this test used to do: freezing
    // `activeIndex` at 0 left all 162 tests green.
    expect(activeStage()).toBe("Opening a headless browser");
    // Nothing is behind the first stage, so no item claims to be done — and the
    // class the CSS keys off agrees, because both come from one expression.
    expect(screen.queryAllByRole("listitem", { name: /, done$/u })).toEqual([]);
    expect(stageClasses()[0]).toBe("stages__item stages__item--active");
    expect(stageClasses()[1]).toBe("stages__item");

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("5s")).toBeDefined();
    expect(activeStage()).toBe("Provoking playback and watching network requests");
    expect(doneStages()).toEqual([
      "Opening a headless browser",
      "Loading the page and dismissing consent banners",
    ]);
    expect(stageClasses()[0]).toBe("stages__item stages__item--done");

    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(screen.getByText("16s")).toBeDefined();
    expect(activeStage()).toBe("Still going — some sites are slow to start playing");

    // Narration throughout, and never a figure.
    expect(screen.getByRole("progressbar").hasAttribute("value")).toBe(false);
    expect(screen.queryByText(/%/u)).toBeNull();
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
