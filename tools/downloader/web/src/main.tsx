// **First, and that is load-bearing** (dl-35): it configures zod before
// `@downloader/contract` below constructs the schemas that read the setting.
// Moved down, the app still works and the browser reports a CSP violation on
// every page load. That file says why; `e2e/csp.spec.ts` is what notices.
// oxlint-disable-next-line import/no-unassigned-import -- a side effect is the point.
import "./lib/zod-jitless.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@downloader/contract";
import { bootTheme, migrateStoredTheme } from "@webtools/ui/theme";
import { App } from "./App.tsx";
import { getBrowserStorage } from "./lib/job-store.ts";
// Before the tool's own stylesheet, so its `:root` can set the values the shared names take.
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "@webtools/ui/tokens.css";
// The shared header and footer's rules, also before ours, so ours can override them.
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "@webtools/ui/chrome.css";
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "./styles.css";

// The theme, before React renders anything (repo-131). Here and not in an
// inline `<script>` in `index.html`: the document policy is `script-src 'self'`
// (dl-35). The choice used to be stored per origin under this key; it moves to
// the cookie every tool shares, once.
migrateStoredTheme(getBrowserStorage(), "downloader:theme:v1");
bootTheme();

const container = document.querySelector("#root");
if (!container) throw new AppError("INTERNAL", "The application root element is missing.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
