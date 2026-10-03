#!/usr/bin/env node
/**
 * The two markdown readers `status.mjs` and `review-record.mjs` share: a
 * record's lines, and its heading spans. They lived in `citations.mjs` until
 * the citation checker was retired (adr/006), and are kept as they were.
 */

/**
 * A record's own lines, with a trailing `\r` stripped from each (repo-82). A
 * CRLF checkout, or a record pasted from a Windows editor, ends every line in
 * `\r`, and a heading regex anchored on `$` then matches nothing — so a CRLF
 * record's `## Review` heading would be invisible. Only a trailing `\r` is
 * stripped, so line numbers still count physical lines.
 *
 * @param {string} markdown
 * @returns {string[]}
 */
export function splitLines(markdown) {
  return markdown.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * The heading spans of a record, in document order.
 *
 * A heading owns every line down to the next heading of the same level or
 * higher, so `## Review` carries its `###` subsections with it.
 *
 * **Fenced code is not searched for headings**: records here quote changelog
 * fragments, and a `### Fixes` read out of a quoted changelog would end the
 * real section early.
 *
 * @param {string} markdown
 * @returns {{title: string, level: number, start: number, end: number}[]}
 */
export function extractSections(markdown) {
  const lines = splitLines(markdown);
  /** @type {{title: string, level: number, start: number}[]} */
  const headings = [];
  /** @type {{char: string, length: number} | null} */
  let fence = null;

  lines.forEach((text, index) => {
    // A closing fence matches the opening one's character and is at least as
    // long, which is what lets a fenced block quote a shorter fence.
    const mark = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    // Per CommonMark, a backtick fence's info string may not itself contain a
    // backtick — a line whose backtick run is followed later on the same line
    // by another backtick never opens (or closes) a fence at all, unlike a
    // tilde fence, which has no such restriction.
    const disqualified =
      mark !== null && mark[1][0] === "`" && text.slice(mark[0].length).includes("`");
    if (mark && !disqualified) {
      const char = mark[1][0];
      const length = mark[1].length;
      if (fence === null) fence = { char, length };
      else if (char === fence.char && length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;

    const heading = /^(#{1,6})[ \t]+(.*\S)[ \t]*$/.exec(text);
    if (heading) headings.push({ title: heading[2], level: heading[1].length, start: index + 1 });
  });

  return headings.map((h, i) => {
    const next = headings.slice(i + 1).find((other) => other.level <= h.level);
    return { ...h, end: next ? next.start - 1 : lines.length };
  });
}

/** A heading as it appears in the record, for an error message that can be copied. */
const showHeading = (s) => `${"#".repeat(s.level)} ${s.title}`;

/**
 * Pick the one section a name refers to.
 *
 * Case-insensitive, exact before prefix: headings here read
 * `### Gate — 2026-09-01`, and exact winning outright is what keeps `Log`
 * meaning `## Log` in a record that also has `## Logging notes`. A name
 * matching more than one section, or none, throws rather than guessing.
 *
 * @param {ReturnType<typeof extractSections>} sections
 * @param {string} name
 */
export function selectSection(sections, name) {
  const wanted = name.trim().toLowerCase();
  const exact = sections.filter((s) => s.title.toLowerCase() === wanted);
  const matches =
    exact.length > 0 ? exact : sections.filter((s) => s.title.toLowerCase().startsWith(wanted));

  const [only] = matches;
  if (only && matches.length === 1) return only;
  if (matches.length === 0) {
    throw new Error(
      `no section matches "${name}". This record has:\n  ${sections.map(showHeading).join("\n  ") || "(no headings)"}`,
    );
  }
  throw new Error(
    `"${name}" matches ${matches.length} sections:\n  ${matches.map(showHeading).join("\n  ")}\n` +
      `Name one of them exactly.`,
  );
}
