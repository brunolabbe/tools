import type { StorageLike } from "./job-store.ts";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "downloader:theme:v1";
export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && (THEME_CHOICES as readonly string[]).includes(value);
}

export function loadTheme(storage: StorageLike): ThemeChoice {
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    return isThemeChoice(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(storage: StorageLike, choice: ThemeChoice): void {
  try {
    storage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Persisting a preference is not worth failing a render over.
  }
}

/**
 * `system` removes the attribute entirely rather than resolving it, so the
 * stylesheet's `prefers-color-scheme` query stays in charge and follows a
 * mid-session OS change without a listener.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "light dark";
  } else {
    root.setAttribute("data-theme", choice);
    root.style.colorScheme = choice;
  }
}
