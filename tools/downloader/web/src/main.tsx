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
