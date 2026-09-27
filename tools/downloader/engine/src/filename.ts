/**
 * Filename safety.
 *
 * The name a visitor's browser saves is derived from a page title, which is
 * attacker-controlled: `../../../etc/cron.d/x`, a NUL byte and `CON.mp4` are
 * all things a title can contain. Nothing here is written to disk any more
 * (dl-53) — the name reaches only a `Content-Disposition` header — but the
 * visitor's own filesystem is still on the other end of it, so the rules are
 * the ones the stored-file layout needed.
 */

import { isControlCodePoint } from "./text.ts";

/**
 * Reserved DOS device names. Still special on modern Windows: opening `NUL.mp4`
 * writes to the null device, so the download silently vanishes.
 */
const RESERVED_WINDOWS_NAMES: ReadonlySet<string> = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/** Illegal on Windows, or a path separator, or a shell/quoting hazard. */
const UNSAFE_FILENAME_CHARS: ReadonlySet<string> = new Set([
  "/",
  "\\",
  ":",
  "*",
  "?",
  '"',
  "<",
  ">",
  "|",
]);

export interface SanitizeFilenameOptions {
  /** Used when nothing survives sanitisation. */
  fallback?: string;
  /** Total length cap, extension included. Most filesystems stop at 255 bytes. */
  maxLength?: number;
}

const DEFAULT_MAX_FILENAME_LENGTH = 120;

/**
 * Reduces an arbitrary string to a single safe path segment.
 *
 * The result never contains a separator, so it cannot express a directory, and
 * never matches a reserved device name.
 */
export function sanitizeFilename(name: string, options: SanitizeFilenameOptions = {}): string {
  const fallback = options.fallback ?? "download";
  const maxLength = options.maxLength ?? DEFAULT_MAX_FILENAME_LENGTH;

  let cleaned = "";
  for (const char of name.normalize("NFC")) {
    const code = char.codePointAt(0);
    if (code !== undefined && isControlCodePoint(code)) continue;
    cleaned += UNSAFE_FILENAME_CHARS.has(char) ? "_" : char;
  }

  // Collapse runs of whitespace and underscores introduced above.
  cleaned = cleaned.replaceAll(/\s+/gu, " ").trim();
  // Leading dots hide the file; trailing dots and spaces are stripped by Windows
  // itself, which turns "x. " into "x" behind our back and breaks the mapping
  // between the name we recorded and the name on disk.
  cleaned = cleaned.replace(/^[.\s]+/u, "").replace(/[.\s]+$/u, "");

  if (cleaned.length === 0) return fallback;

  const lastDot = cleaned.lastIndexOf(".");
  let stem = lastDot > 0 ? cleaned.slice(0, lastDot) : cleaned;
  const extension = lastDot > 0 ? cleaned.slice(lastDot) : "";

  if (RESERVED_WINDOWS_NAMES.has(stem.toLowerCase())) stem = `_${stem}`;

  const safeExtension = extension.length <= 12 ? extension : "";
  const stemBudget = Math.max(1, maxLength - safeExtension.length);
  if (stem.length > stemBudget) stem = stem.slice(0, stemBudget).trimEnd();
  if (stem.length === 0) stem = fallback;

  return `${stem}${safeExtension}`;
}
