/**
 * The tool's released version, written into the bundle by its own
 * `web/vite.config.ts` (`define`, repo-131) from `../api/package.json`, the file
 * release-please bumps. Declared here, once, and read only by `version.ts`, so
 * no tool's program needs to see it.
 *
 * Absent wherever no `define` ran — a vitest run, a config that forgot it — which
 * is why `version.ts` reads it through `typeof`.
 */
// oxlint-disable-next-line no-underscore-dangle -- the name is Vite's `define` convention, and the tools' configs spell it this way.
declare const __TOOL_VERSION__: string | undefined;
