// **First, and that is load-bearing** (dl-35): it configures zod before
// `@downloader/contract` below constructs the schemas that read the setting.
// Moved down, the app still works and the browser reports a CSP violation on
// every page load. That file says why; `e2e/csp.spec.ts` is what notices.
// oxlint-disable-next-line import/no-unassigned-import -- a side effect is the point.
import "./lib/zod-jitless.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@downloader/contract";
import { App } from "./App.tsx";
// oxlint-disable-next-line import/no-unassigned-import -- Vite injects the stylesheet; there is nothing to bind.
import "./styles.css";

const container = document.querySelector("#root");
if (!container) throw new AppError("INTERNAL", "The application root element is missing.");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
