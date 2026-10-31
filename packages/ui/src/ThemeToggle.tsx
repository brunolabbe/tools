import { THEME_CHOICES } from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";

interface ThemeToggleProps {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}

/** What each choice is called: its accessible name and its tooltip. */
const LABELS: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Drawn at 16 px in `currentColor`, so each follows the segment's text colour,
 * selected or not. Decorative: the label's hidden text is the accessible name.
 */
const ICONS: Record<ThemeChoice, React.JSX.Element> = {
  system: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" />
      <path d="M5.5 14h5M8 11.5V14" fill="none" stroke="currentColor" strokeLinecap="round" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.4 1.4M11.55 11.55l1.4 1.4M3.05 12.95l1.4-1.4M11.55 4.45l1.4-1.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

/**
 * The three-way theme switch, moved from the downloader, with an icon per
 * choice (repo-131). A radio group, so the arrow keys move between choices and
 * Tab reaches it once; the radios are hidden with `.sr-only` and the labels are
 * the hit targets, each at least 44 px tall (`chrome.css`).
 *
 * Controlled: it reports a choice and does not hold one. `AppHeader` owns the
 * state.
 */
export function ThemeToggle({ value, onChange }: ThemeToggleProps): React.JSX.Element {
  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Colour theme</legend>
      {THEME_CHOICES.map((choice) => (
        <label
          key={choice}
          title={LABELS[choice]}
          className={value === choice ? "theme-toggle__on" : undefined}
        >
          <input
            type="radio"
            name="theme"
            value={choice}
            checked={value === choice}
            onChange={() => onChange(choice)}
            className="sr-only"
          />
          {ICONS[choice]}
          <span className="sr-only">{LABELS[choice]}</span>
        </label>
      ))}
    </fieldset>
  );
}
