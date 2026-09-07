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
 * must be indeterminate. That is the never-fake-progress rule at the other
 * place it lives, and since dl-43 it extends to the *narration*: the panel
 * shows the stage the server last reported and has no clock of its own. Every
 * case below therefore hands it a stage rather than advancing a timer, and the
 * ones that do advance a timer are there to prove nothing moves.
 */

import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PROBE_STAGES } from "@downloader/contract";
import type { ProbeStageEvent } from "@downloader/contract";
import { AnalysingPanel } from "../src/components/AnalysingPanel.tsx";
import { ScenarioHints } from "../src/components/ScenarioHints.tsx";
import { ThemeToggle } from "../src/components/ThemeToggle.tsx";
import { SCENARIOS, scenarioUrl } from "../src/api/scenarios.ts";
import { PROBE_STAGE_PENDING, probeStageText } from "../src/lib/probe-stages.ts";
import { THEME_CHOICES } from "../src/lib/theme.ts";
import type { ThemeChoice } from "../src/lib/theme.ts";
import { NOW, SOURCE_URL } from "./fixtures.ts";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// AnalysingPanel
// ---------------------------------------------------------------------------

/**
 * Which line the panel is showing.
 *
 * It is the live region itself, and that is the point: before dl-43 the state
 * was a class on one of five permanently-rendered `<li>`s, so this had to read
 * `aria-current` to find out anything, and the four lines the probe had not
 * reached were on screen the whole time. There is one line now, it is the text
 * of the polite region, and replacing it is what makes the region announce.
 */
function stageLine(): string {
  const line = document.querySelector(".stage");
  if (line === null) throw new Error("no stage line rendered");
  return line.textContent ?? "";
}

function analysing(stage: ProbeStageEvent | null = null): ReturnType<typeof vi.fn<() => void>> {
  const onCancel = vi.fn<() => void>();
  render(<AnalysingPanel url={SOURCE_URL} startedAt={NOW} stage={stage} onCancel={onCancel} />);
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
    expect(bar.className).toContain("progress--indeterminate");
    expect(screen.queryByText(/%/u)).toBeNull();
    expect(screen.getByText(SOURCE_URL)).toBeDefined();
    expect(screen.getByText("0s")).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

test("before the server says anything, the panel claims nothing about the server", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    analysing();
    // The POST is out and nothing has come back. That is all the client knows,
    // and the copy says exactly that rather than guessing at a first phase.
    expect(stageLine()).toBe(PROBE_STAGE_PENDING);

    // And no clock moves it. Sixteen seconds was where the old panel put "Still
    // going — some sites are slow to start playing"; the line is unchanged
    // because nothing happened, which is the whole fix.
    act(() => {
      vi.advanceTimersByTime(16_000);
    });
    expect(screen.getByText("16s")).toBeDefined();
    expect(stageLine()).toBe(PROBE_STAGE_PENDING);
  } finally {
    vi.useRealTimers();
  }
});

test("a stage the probe has not reached is absent from the document", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    analysing({ stage: "page-load", resolver: "browser" });

    expect(stageLine()).toBe("Loading the page");
    // Absent, not present and greyed. Every one of these is a later phase of
    // the same probe, and each was on screen from second zero before dl-43 —
    // which is how copy written to reassure at second 16 ended up reading as a
    // warning at second 0.
    for (const later of [
      "Waiting for the network to go quiet",
      "Settling the last outstanding requests",
      "Weighing the available qualities",
      "Provoking playback and watching network requests",
    ]) {
      expect(screen.queryByText(later)).toBeNull();
    }
    // Nor is there a list of stages to grey out any more.
    expect(screen.queryAllByRole("listitem")).toEqual([]);
  } finally {
    vi.useRealTimers();
  }
});

test("the text a screen reader is given changes when a stage advances", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const onCancel = vi.fn<() => void>();
    const view = render(
      <AnalysingPanel
        url={SOURCE_URL}
        startedAt={NOW}
        stage={{ stage: "browser-launch", resolver: "browser" }}
        onCancel={onCancel}
      />,
    );

    const region = document.querySelector(".stage");
    expect(region?.getAttribute("aria-live")).toBe("polite");
    const before = stageLine();
    expect(before).toBe("Opening a headless browser");

    view.rerender(
      <AnalysingPanel
        url={SOURCE_URL}
        startedAt={NOW}
        stage={{ stage: "provoke-playback", resolver: "browser" }}
        onCancel={onCancel}
      />,
    );

    // A *content* mutation, which is what a polite region announces. The list
    // this replaced changed only `className` and `aria-current`, so a screen
    // reader heard the five stages once and then silence for the whole probe.
    expect(document.querySelector(".stage")).toBe(region);
    expect(stageLine()).not.toBe(before);
    expect(stageLine()).toBe("Provoking playback and watching network requests");
  } finally {
    vi.useRealTimers();
  }
});

test("the tier being tried is named, and an unknown one does not leak its identifier", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    const onCancel = vi.fn<() => void>();
    const view = render(
      <AnalysingPanel
        url={SOURCE_URL}
        startedAt={NOW}
        stage={{ stage: "resolver-start", resolver: "yt-dlp" }}
        onCancel={onCancel}
      />,
    );
    expect(stageLine()).toBe("Trying yt-dlp");

    // A tier added server-side reaches an older bundle as a name it has never
    // heard of. Saying something true beats putting an internal identifier on
    // screen, and beats a blank line.
    view.rerender(
      <AnalysingPanel
        url={SOURCE_URL}
        startedAt={NOW}
        stage={{ stage: "resolver-start", resolver: "some-future-tier" }}
        onCancel={onCancel}
      />,
    );
    expect(stageLine()).toBe("Trying another method");
    expect(stageLine()).not.toContain("some-future-tier");
  } finally {
    vi.useRealTimers();
  }
});

test("waiting for a free browser is not reported as opening one", () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  try {
    analysing({ stage: "browser-slot", resolver: "browser" });
    // The mis-report the ticket was filed over: a probe queued behind a full
    // pool used to be told "Opening a headless browser", which is not what is
    // happening and does not explain why it is slow.
    expect(stageLine()).toBe("Waiting for a free browser — they are all busy");
    expect(stageLine()).not.toContain("Opening");
  } finally {
    vi.useRealTimers();
  }
});

test("every stage in the contract has a line, and no two share one", () => {
  // `PROBE_STAGES` is the closed vocabulary the server emits from. A stage with
  // no copy would render as an empty live region — an announcement of nothing,
  // which is worse than the silence it replaced.
  const lines = PROBE_STAGES.filter((stage) => stage !== "resolver-start").map((stage) =>
    probeStageText({ stage, resolver: "browser" }),
  );
  expect(lines.every((line) => line.length > 0)).toBe(true);
  expect(new Set(lines).size).toBe(lines.length);
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
