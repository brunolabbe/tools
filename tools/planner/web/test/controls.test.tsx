// @vitest-environment jsdom

/**
 * A control per question kind, rendered and round-tripped.
 *
 * **Why the environment is a docblock and not a project.** The `planner` vitest
 * project already collects every test under the tool, this one included, and it
 * is `environment: "node"` — which is right for the API suite, since it has no
 * business paying for a DOM. Vitest 4 removed `environmentMatchGlobs`, so the two ways to
 * give this file a DOM are the line above or a project of its own; a second
 * project would have to be carved back out of the planner project's glob to stop
 * both collecting these files, which is the same "two owners, no authoritative
 * answer" shape `tsconfig.tests.json` warns about for the compiler. One line at
 * the top of the file that needs it, and the tool's suite stays one project.
 *
 * The claim under test is the one that keeps a half-typed answer off the wire:
 * **every field reports `null` until it has a complete `AnswerValue`**, and
 * `null` is what disables the Next button. `dates` and `budget` carry the weight
 * — they are the two composites where a user can be half-way through.
 *
 * Queried by role throughout, and by accessible name wherever the field carries
 * its own. `text`, `text-list`, `number` and `number-list` do not: since pl-21
 * they are named by `aria-labelledby` pointing at the prompt, which `QuestionCard`
 * renders a level up and this suite does not mount. So they are queried by role
 * alone here, and **that they answer to their prompt is asserted in
 * `wizard.test.tsx`**, where the card that names them is on screen.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnswerValue, QuestionNode } from "@planner/contract";
import { QuestionField } from "../src/wizard/controls.tsx";
import { BASE } from "./fixtures.ts";

// Explicit, not automatic: the planner project runs with `globals: false`, so
// Testing Library never registers its own afterEach and a second render would
// otherwise find two copies of the field in the document.
afterEach(cleanup);

type Emit = ReturnType<typeof spy>;

function spy(): ReturnType<typeof vi.fn<(value: AnswerValue | null) => void>> {
  return vi.fn<(value: AnswerValue | null) => void>();
}

/** What the field last reported upward — the value the Next button acts on. */
function emitted(onChange: Emit): AnswerValue | null {
  const { calls } = onChange.mock;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] ?? null;
}

function mount(question: QuestionNode, initial: AnswerValue | null, onChange: Emit): void {
  render(<QuestionField question={question} initial={initial} onChange={onChange} />);
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

const CHOICES = [
  { value: "mountains", label: "Mountains" },
  { value: "coast", label: "Coast" },
] as const;

test("single-choice reads its answer back and reports the new one", async () => {
  const onChange = spy();
  const question: QuestionNode = { ...BASE, id: "q", kind: "single-choice", choices: CHOICES };
  mount(question, { kind: "single-choice", value: "coast" }, onChange);

  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Coast" }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Mountains" }).checked).toBe(false);
  expect(onChange).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("radio", { name: "Mountains" }));
  expect(emitted(onChange)).toEqual({ kind: "single-choice", value: "mountains" });
});

test("multi-choice adds to its answer, and an emptied one is not an answer", async () => {
  const onChange = spy();
  const question: QuestionNode = { ...BASE, id: "q", kind: "multi-choice", choices: CHOICES };
  mount(question, { kind: "multi-choice", values: ["coast"] }, onChange);

  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Coast" }).checked).toBe(true);

  await userEvent.click(screen.getByRole("checkbox", { name: "Mountains" }));
  expect(emitted(onChange)).toEqual({ kind: "multi-choice", values: ["coast", "mountains"] });

  await userEvent.click(screen.getByRole("checkbox", { name: "Coast" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Mountains" }));
  expect(emitted(onChange)).toBeNull();
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

test("text reads its answer back, and whitespace alone is not an answer", async () => {
  const onChange = spy();
  const question: QuestionNode = { ...BASE, id: "q", kind: "text", maxLength: 200 };
  mount(question, { kind: "text", value: "Somewhere green" }, onChange);

  const field = screen.getByRole<HTMLTextAreaElement>("textbox");
  expect(field.value).toBe("Somewhere green");
  expect(field.maxLength).toBe(200);

  await userEvent.clear(field);
  expect(emitted(onChange)).toBeNull();

  fireEvent.change(field, { target: { value: "   " } });
  expect(emitted(onChange)).toBeNull();

  fireEvent.change(field, { target: { value: "Somewhere blue" } });
  expect(emitted(onChange)).toEqual({ kind: "text", value: "Somewhere blue" });
});

test("text-list is one per line, and blank lines are dropped", () => {
  const onChange = spy();
  const question: QuestionNode = {
    ...BASE,
    id: "q",
    kind: "text-list",
    maxLength: 80,
    maxItems: 5,
  };
  mount(question, { kind: "text-list", values: ["Banff", "Jasper"] }, onChange);

  const field = screen.getByRole<HTMLTextAreaElement>("textbox");
  expect(field.value).toBe("Banff\nJasper");

  fireEvent.change(field, { target: { value: "Banff\n\n  Jasper  \nYoho\n" } });
  expect(emitted(onChange)).toEqual({ kind: "text-list", values: ["Banff", "Jasper", "Yoho"] });

  fireEvent.change(field, { target: { value: "\n \n" } });
  expect(emitted(onChange)).toBeNull();
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

test("number carries the node's bounds and refuses anything that is not one", () => {
  const onChange = spy();
  const question: QuestionNode = {
    ...BASE,
    id: "q",
    kind: "number",
    min: 1,
    max: 14,
    integer: true,
    unit: "hours",
  };
  mount(question, { kind: "number", value: 6 }, onChange);

  const field = screen.getByRole<HTMLInputElement>("spinbutton");
  expect(field.value).toBe("6");
  // Read off the node, never hard-coded in the browser.
  expect(field.min).toBe("1");
  expect(field.max).toBe("14");
  expect(field.step).toBe("1");
  expect(screen.getByText("hours")).toBeDefined();

  fireEvent.change(field, { target: { value: "8" } });
  expect(emitted(onChange)).toEqual({ kind: "number", value: 8 });

  fireEvent.change(field, { target: { value: "" } });
  expect(emitted(onChange)).toBeNull();
});

test("number-list refuses the whole answer when one entry will not parse", () => {
  const onChange = spy();
  const question: QuestionNode = {
    ...BASE,
    id: "q",
    kind: "number-list",
    min: 0,
    max: 110,
    integer: true,
    maxItems: 8,
    unit: null,
  };
  mount(question, { kind: "number-list", values: [41, 39, 7] }, onChange);

  const field = screen.getByRole<HTMLInputElement>("textbox");
  expect(field.value).toBe("41, 39, 7");

  fireEvent.change(field, { target: { value: "41, 39, 7, 4" } });
  expect(emitted(onChange)).toEqual({ kind: "number-list", values: [41, 39, 7, 4] });

  // A missing traveller's age is not a rounding error: one bad entry disables
  // the answer rather than being silently dropped.
  fireEvent.change(field, { target: { value: "41, 39, seven" } });
  expect(emitted(onChange)).toBeNull();
});

// ---------------------------------------------------------------------------
// Dates — the first composite
// ---------------------------------------------------------------------------

const DATES: QuestionNode = { ...BASE, id: "q", kind: "dates" };

test("dates reads an exact answer back and reports the pair", () => {
  const onChange = spy();
  mount(
    DATES,
    {
      kind: "dates",
      value: { kind: "exact", departure: "2026-07-04", return: "2026-07-18" },
    },
    onChange,
  );

  expect(screen.getByRole<HTMLInputElement>("radio", { name: "I know the dates" }).checked).toBe(
    true,
  );
  expect(screen.getByLabelText<HTMLInputElement>("Leaving").value).toBe("2026-07-04");
  expect(screen.getByLabelText<HTMLInputElement>("Back").value).toBe("2026-07-18");

  fireEvent.change(screen.getByLabelText("Back"), { target: { value: "2026-07-20" } });
  expect(emitted(onChange)).toEqual({
    kind: "dates",
    value: { kind: "exact", departure: "2026-07-04", return: "2026-07-20" },
  });
});

test("a half-filled dates answer stays null until the window is complete", async () => {
  const onChange = spy();
  mount(DATES, null, onChange);

  // Exact, with only one of the two dates: not an answer.
  fireEvent.change(screen.getByLabelText("Leaving"), { target: { value: "2026-07-04" } });
  expect(emitted(onChange)).toBeNull();

  await userEvent.click(screen.getByRole("radio", { name: "Sometime in a window" }));
  expect(emitted(onChange)).toBeNull();

  fireEvent.change(screen.getByLabelText("No earlier than"), { target: { value: "2026-05-01" } });
  fireEvent.change(screen.getByLabelText("No later than"), { target: { value: "2026-06-15" } });
  // Still short a night count.
  expect(emitted(onChange)).toBeNull();

  fireEvent.change(screen.getByLabelText("Nights"), { target: { value: "10" } });
  expect(emitted(onChange)).toEqual({
    kind: "dates",
    value: { kind: "window", earliest: "2026-05-01", latest: "2026-06-15", nights: 10 },
  });
});

test("dates offers an open answer, which is nights and nothing else", async () => {
  const onChange = spy();
  mount(DATES, null, onChange);

  await userEvent.click(screen.getByRole("radio", { name: "However long, whenever" }));
  expect(screen.queryByLabelText("Leaving")).toBeNull();
  expect(screen.queryByLabelText("No earlier than")).toBeNull();

  fireEvent.change(screen.getByLabelText("Nights"), { target: { value: "5" } });
  expect(emitted(onChange)).toEqual({ kind: "dates", value: { kind: "open", nights: 5 } });
});

// ---------------------------------------------------------------------------
// Budget — the second composite
// ---------------------------------------------------------------------------

const BUDGET: QuestionNode = { ...BASE, id: "q", kind: "budget" };

test("budget reads a band back and swaps to a figure", async () => {
  const onChange = spy();
  mount(BUDGET, { kind: "budget", value: { kind: "band", band: "moderate" } }, onChange);

  expect(screen.getByRole<HTMLInputElement>("radio", { name: "A feeling" }).checked).toBe(true);
  expect(screen.getByRole<HTMLInputElement>("radio", { name: "Moderate" }).checked).toBe(true);

  await userEvent.click(screen.getByRole("radio", { name: "Comfortable" }));
  expect(emitted(onChange)).toEqual({
    kind: "budget",
    value: { kind: "band", band: "comfortable" },
  });

  // An empty amount is not a figure, so switching modes withdraws the answer.
  await userEvent.click(screen.getByRole("radio", { name: "A figure" }));
  expect(emitted(onChange)).toBeNull();
});

test("a figure needs an amount and a three-letter currency before it is an answer", () => {
  const onChange = spy();
  mount(
    BUDGET,
    { kind: "budget", value: { kind: "amount", currency: "CAD", amount: 4000, basis: "total" } },
    onChange,
  );

  expect(screen.getByLabelText<HTMLInputElement>("Amount").value).toBe("4000");
  expect(screen.getByLabelText<HTMLInputElement>("Currency").value).toBe("CAD");

  fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "CA" } });
  expect(emitted(onChange)).toBeNull();

  // Lower case is a typo the control fixes rather than a 400 to interpret.
  fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "0" } });
  expect(emitted(onChange)).toBeNull();

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5200" } });
  fireEvent.change(screen.getByLabelText<HTMLSelectElement>("Counted"), {
    target: { value: "per-person" },
  });
  expect(emitted(onChange)).toEqual({
    kind: "budget",
    value: { kind: "amount", currency: "EUR", amount: 5200, basis: "per-person" },
  });
});
