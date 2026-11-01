/**
 * The ledger's mark: an open book (lg-72). Drawn in `currentColor` so it follows
 * the theme, on a 16-unit grid so it reads at favicon size. `public/favicon.svg`
 * is the same drawing; change both together.
 */
export function Glyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M8 4C6.5 3 4.5 2.7 2 3v9c2.5-.3 4.5 0 6 1 1.5-1 3.5-1.3 6-1V3c-2.5-.3-4.5 0-6 1ZM8 4v9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
