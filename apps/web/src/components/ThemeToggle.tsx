import { THEME_CHOICES } from "../lib/theme.ts";
import type { ThemeChoice } from "../lib/theme.ts";

interface ThemeToggleProps {
  value: ThemeChoice;
  onChange: (choice: ThemeChoice) => void;
}

export function ThemeToggle({ value, onChange }: ThemeToggleProps): React.JSX.Element {
  return (
    <fieldset className="themetoggle">
      <legend className="visually-hidden">Colour theme</legend>
      {THEME_CHOICES.map((choice) => (
        <label key={choice} className={value === choice ? "themetoggle__on" : ""}>
          <input
            type="radio"
            name="theme"
            value={choice}
            checked={value === choice}
            onChange={() => onChange(choice)}
            className="visually-hidden"
          />
          {choice}
        </label>
      ))}
    </fieldset>
  );
}
