import { changelogUrl, releaseUrl, sourceUrl } from "./repository.ts";

interface AppFooterProps {
  /** The tool's directory name under `tools/`, which is also its release tag's prefix. */
  tool: string;
  /** The version the bundle was built at (`TOOL_VERSION`), or `unknown`. */
  version: string;
  /** The tool's terms page, a same-origin path. */
  termsHref: string;
}

/**
 * Every tool's footer (repo-131): `v<version> · Terms · Source`.
 *
 * The version is the bundle's own, written in at build time, and not a `/health`
 * fetch: the same process serves the page and the API, so a page that loaded
 * had a server a moment ago, and a footer that waits on one adds a state that
 * says nothing (owner, 2026-10-25). It links to that version's release, or, when
 * the build did not know its version, to the tool's changelog.
 */
export function AppFooter({ tool, version, termsHref }: AppFooterProps): React.JSX.Element {
  const known = version !== "unknown";
  return (
    <footer className="app-footer">
      <a href={known ? releaseUrl(tool, version) : changelogUrl(tool)}>
        {known ? `v${version}` : "Changelog"}
      </a>
      <span aria-hidden="true"> · </span>
      <a href={termsHref}>Terms</a>
      <span aria-hidden="true"> · </span>
      <a href={sourceUrl(tool)}>Source</a>
    </footer>
  );
}
