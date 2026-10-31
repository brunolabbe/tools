/**
 * The downloader's mark: an arrow down into a tray (repo-131). Drawn in
 * `currentColor` so it follows the theme, on a 16-unit grid so it reads at
 * favicon size. `public/favicon.svg` is the same drawing; change both together.
 */
export function Glyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 1.5v8.5M4.5 6.5 8 10l3.5-3.5M2 11v2.5h12V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
