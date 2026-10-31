/**
 * The version the bundle was built at, or `unknown`.
 *
 * Read through `typeof`, because the identifier exists only where a tool's
 * `vite.config.ts` defined it: Vite replaces the bare name with a string
 * literal, and anywhere it did not (a unit test renders `App` with no `define`)
 * `typeof` of an undeclared name is `"undefined"` rather than a
 * `ReferenceError`. `AppFooter` leaves an `unknown` version out.
 */
export const TOOL_VERSION: string =
  typeof __TOOL_VERSION__ === "string" && __TOOL_VERSION__ !== "" ? __TOOL_VERSION__ : "unknown";
