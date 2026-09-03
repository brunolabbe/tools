/**
 * Turns off zod's JIT-compiled validators in the browser, and it is dl-35's
 * doing rather than a performance choice.
 *
 * zod v4 compiles a specialised parse function per object schema when the
 * runtime allows it, and it works out whether the runtime allows it by
 * probing:
 *
 * ```js
 * try { new Function(""); return true } catch { return false }
 * ```
 *
 * Under `script-src 'self'` that `new Function` is refused. zod catches the
 * throw and falls back to its interpreted path, so **nothing breaks** — but the
 * browser still files a `securitypolicyviolation` and logs it, on every page
 * load, for a capability check that was always allowed to fail. Measured on the
 * built bundle: one violation, `effectiveDirective: "script-src"`,
 * `blockedURI: "eval"`, sourced at the bundle's own line. `jitless` is zod's own
 * answer to exactly this — its source says so at the guard that skips the probe
 * — and skipping the probe is the whole of what it buys here, since the probe's
 * answer under a CSP is `false` either way.
 *
 * **Why a side-effect module imported first, rather than a line in `main.tsx`.**
 * zod reads the flag while a schema is *constructed*, not while one is parsed,
 * and `@downloader/contract` builds its schemas at module scope. ES module
 * imports are evaluated before the importing module's body, so a `config()` call
 * in `main.tsx` runs after the probe has already fired — measured, not assumed:
 * with the call in `main.tsx`'s body the violation was still there.
 *
 * That makes the import order in `main.tsx` load-bearing, which is a thin thread
 * to hang on. The thing that actually holds it is
 * `e2e/csp.spec.ts`'s "the app's own page raises no violation", which asserts an
 * empty violation list and goes red if this import is ever moved below
 * `@downloader/contract`.
 *
 * Downloader-only, and deliberately not lifted anywhere: the planner serves no
 * CSP, so it reports nothing and has no reason to pay for this. Its CSP would be
 * the second consumer, and that is when this becomes shared code.
 */

import { config } from "zod";

config({ jitless: true });
