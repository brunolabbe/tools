import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@ledger/contract";
import { bootTheme } from "@webtools/ui/theme";
import { App } from "./App.tsx";
// Before the tool's own stylesheet, so its `:root` can set the values the shared names take.
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "@webtools/ui/tokens.css";
// The shared header and footer's rules, also before ours, so ours can override them.
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "@webtools/ui/chrome.css";
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "./styles.css";

// The stored theme, before React renders anything (repo-131), so a reader who
// chose dark does not see one light frame. The ledger never stored a theme
// before the shared cookie, so there is nothing to migrate.
bootTheme();

const container = document.querySelector("#root");
if (!container) throw new AppError("INTERNAL", "The application root element is missing.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
