// @vitest-environment jsdom

/**
 * The one field the whole product starts at.
 *
 * See `progress-bar.test.tsx` for why the DOM arrives as a docblock rather than
 * a vitest project of its own.
 *
 * Asked for by its label — `getByLabelText("Page address")` — which is exactly
 * the handle `e2e/download.spec.ts` uses. Renaming the label breaks both suites
 * together, which is the point; the fast one says so in a second.
 */

import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UrlForm } from "../src/components/UrlForm.tsx";
import { SOURCE_URL } from "./fixtures.ts";

afterEach(cleanup);

interface Mounted {
  onUrlChange: ReturnType<typeof vi.fn<(url: string) => void>>;
  onSubmit: ReturnType<typeof vi.fn<() => void>>;
}

function mount(props: { url?: string; busy?: boolean; invalid?: string | null } = {}): Mounted {
  const spies: Mounted = {
    onUrlChange: vi.fn<(url: string) => void>(),
    onSubmit: vi.fn<() => void>(),
  };
  render(
    <UrlForm
      url={props.url ?? ""}
      onUrlChange={spies.onUrlChange}
      onSubmit={spies.onSubmit}
      busy={props.busy ?? false}
      invalid={props.invalid ?? null}
    />,
  );
  return spies;
}

function field(): HTMLInputElement {
  return screen.getByLabelText("Page address") as HTMLInputElement;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /Analyse|Analysing/u }) as HTMLButtonElement;
}

test("an empty field cannot be submitted", () => {
  mount();
  expect(submitButton().disabled).toBe(true);
});

test("whitespace is not an address", () => {
  mount({ url: "   " });
  expect(submitButton().disabled).toBe(true);
});

test("a filled field can be submitted, and reports the address upward", async () => {
  const user = userEvent.setup();
  const spies = mount({ url: SOURCE_URL });

  expect(submitButton().disabled).toBe(false);
  await user.click(submitButton());
  expect(spies.onSubmit).toHaveBeenCalledOnce();
});

test("typing is reported a character at a time, and never swallowed", async () => {
  const user = userEvent.setup();
  const spies = mount();

  await user.type(field(), "ab");
  // Controlled input: the parent owns the value, so each keystroke arrives as
  // the parent's own `url` plus the character.
  expect(spies.onUrlChange.mock.calls.map(([value]) => value)).toEqual(["a", "b"]);
});

test("submitting from the keyboard works, and does not reload the page", async () => {
  const user = userEvent.setup();
  const spies = mount({ url: SOURCE_URL });

  await user.type(field(), "{Enter}");
  expect(spies.onSubmit).toHaveBeenCalledOnce();
});

test("a busy form says so and refuses a second submit", () => {
  const spies = mount({ url: SOURCE_URL, busy: true });

  const button = submitButton();
  expect(button.textContent).toBe("Analysing…");
  expect(button.disabled).toBe(true);
  expect(spies.onSubmit).not.toHaveBeenCalled();
});

test("a rejected address surfaces, wired to the field rather than floating beside it", () => {
  const message = "Enter a full http:// or https:// address.";
  mount({ url: "not a url", invalid: message });

  const alert = screen.getByRole("alert");
  expect(alert.textContent).toBe(message);
  expect(field().getAttribute("aria-invalid")).toBe("true");
  // The message is named as the field's description, so a screen reader reads
  // it with the field rather than leaving it as loose text on the page.
  expect(field().getAttribute("aria-describedby")).toBe(alert.id);
  expect(alert.id.length).toBeGreaterThan(0);
});

test("an acceptable address carries no validation state at all", () => {
  mount({ url: SOURCE_URL });

  expect(screen.queryByRole("alert")).toBeNull();
  expect(field().getAttribute("aria-invalid")).toBe("false");
  expect(field().hasAttribute("aria-describedby")).toBe(false);
});

test("a scheme the contract refuses still reaches the parent, so the rejection is shown", async () => {
  // Two guards sit in front of `onSubmit` and only one of them is ours. The
  // field is `type="url"`, so the *browser* refuses to submit a string that is
  // not a URL at all — asserted in the next test. What the browser is happy
  // with and `sourceUrlSchema` is not — a non-http scheme — has to reach the
  // parent, or `INVALID_URL` would never be raised and the user would be left
  // with a button that does nothing.
  const user = userEvent.setup();
  const spies = mount({
    url: "ftp://example.com/clip.mp4",
    invalid: "Enter a full http:// or https:// address.",
  });

  expect(submitButton().disabled).toBe(false);
  await user.click(submitButton());
  expect(spies.onSubmit).toHaveBeenCalledOnce();
});

test("the field's own type refuses a string that is not a URL at all", async () => {
  // Not a claim about our code so much as a note about where the first line of
  // defence is: `type="url"` means native constraint validation stops the
  // submit before React sees it, and the inline message is what explains why.
  const user = userEvent.setup();
  const spies = mount({ url: "not a url", invalid: "Enter a full http:// or https:// address." });

  await user.click(submitButton());
  expect(spies.onSubmit).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toBe("Enter a full http:// or https:// address.");
});
