import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle.tsx";
import { applyTheme, loadTheme, saveTheme } from "./theme.ts";
import type { ThemeChoice } from "./theme.ts";

interface AppHeaderProps {
  /** The tool's name, the page's one `<h1>`. */
  name: string;
  /** One line under the name saying what the tool is for. */
  tagline: string;
  /** The tool's own mark, an inline SVG drawn in `currentColor`, so it follows the theme. */
  glyph: ReactNode;
}

/**
 * Every tool's header (repo-131): its glyph and name, the theme switch beside
 * them, and the tagline under both.
 *
 * It owns the theme, so a tool's `App` carries no theme state. The first value
 * is the cookie's, which `main.tsx` has already applied before the first render
 * (`bootTheme`); the effect then re-applies and stores each change.
 */
export function AppHeader({ name, tagline, glyph }: AppHeaderProps): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeChoice>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  return (
    <header className="app-header">
      <div className="app-header__bar">
        <span className="app-header__glyph" aria-hidden="true">
          {glyph}
        </span>
        <h1 className="app-header__name">{name}</h1>
        <ThemeToggle value={theme} onChange={setTheme} />
      </div>
      <p className="app-header__tagline">{tagline}</p>
    </header>
  );
}
