// The theme for the static terms page (repo-131, lg-72), which `public/terms.html`
// loads as `<script type="module" src="/theme.js">`. A file in `public/` is
// copied as-is and cannot import a package, so this is a second build entry
// instead: `vite.config.ts` names it in `input` and writes it to `/theme.js`,
// unhashed, so the static page can name it. In development Vite serves this
// file at the same path. Plain JavaScript, because a built `.ts` name would be
// served with a MIME type no browser runs as a module.
import { bootTheme } from "@webtools/ui/theme";

bootTheme();
