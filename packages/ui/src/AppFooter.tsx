interface AppFooterProps {
  /** The version the bundle was built at (`TOOL_VERSION`), or `unknown`. */
  version: string;
  /** The tool's terms page, a same-origin path. */
  termsHref: string;
}

/**
 * Every tool's footer (repo-131): `v<version> · Terms`.
 *
 * The version is the bundle's own, written in at build time, and not a `/health`
 * fetch: the same process serves the page and the API, so a page that loaded
 * had a server a moment ago, and a footer that waits on one adds a state that
 * says nothing (owner, 2026-10-25). It is text, not a link: the footer links to
 * nothing on GitHub (owner, 2026-10-31), and a build that did not know its
 * version leaves it out rather than print `vunknown`.
 */
export function AppFooter({ version, termsHref }: AppFooterProps): React.JSX.Element {
  return (
    <footer className="app-footer">
      {version !== "unknown" && (
        <>
          <span>v{version}</span>
          <span aria-hidden="true"> · </span>
        </>
      )}
      <a href={termsHref}>Terms</a>
    </footer>
  );
}
