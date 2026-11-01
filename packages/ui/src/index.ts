/**
 * The shared header, footer and theme control (repo-131). The stylesheet they
 * need is a separate export, `@webtools/ui/chrome.css`, imported by a tool's
 * `main.tsx` after `tokens.css` and before its own `styles.css`.
 *
 * `@webtools/ui/theme` exports the theme functions alone, with no React, for a
 * tool's `web/theme.js`, the module its static terms page loads.
 */

export { AppFooter } from "./AppFooter.tsx";
export { AppHeader } from "./AppHeader.tsx";
export { ThemeToggle } from "./ThemeToggle.tsx";
export { TOOL_VERSION } from "./version.ts";
export {
  THEME_CHOICES,
  THEME_COOKIE,
  applyTheme,
  bootTheme,
  cookieDomain,
  isThemeChoice,
  loadTheme,
  migrateStoredTheme,
  readThemeCookie,
  saveTheme,
  themeCookie,
} from "./theme.ts";
export type { CookieJar, CookieSite, StorageLike, ThemeChoice } from "./theme.ts";
