/**
 * The public repository every tool's footer links into (owner, 2026-10-25:
 * `brunolabbe/tools` is public). One constant, so a move or a rename is one line.
 */
export const REPOSITORY_URL = "https://github.com/brunolabbe/tools";

/** The release page for one tool's version: tags read `<tool>-v<version>`. */
export function releaseUrl(tool: string, version: string): string {
  return `${REPOSITORY_URL}/releases/tag/${tool}-v${version}`;
}

/** The tool's changelog, for a build that does not know its own version. */
export function changelogUrl(tool: string): string {
  return `${REPOSITORY_URL}/blob/main/tools/${tool}/CHANGELOG.md`;
}

/** The tool's source tree. */
export function sourceUrl(tool: string): string {
  return `${REPOSITORY_URL}/tree/main/tools/${tool}`;
}
