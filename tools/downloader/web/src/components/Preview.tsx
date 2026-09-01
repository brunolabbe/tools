import { useEffect, useState } from "react";

interface PreviewProps {
  /**
   * A path on this API — `/api/thumbnail/<token>`. Never an origin URL: the
   * whole reason the bytes come through the API is that putting a page-chosen
   * address in an `<img src>` makes the user's browser fetch it, which no
   * server-side guard can see. See `tools/downloader/api/src/thumbnails.ts`.
   */
  path: string | null | undefined;
  /** `panel` sits beside the probe title; `card` is the smaller job-list one. */
  size: "panel" | "card";
}

/**
 * The preview image, or nothing.
 *
 * Three things it deliberately does:
 *
 *  - **Reserves its box.** The frame has a fixed aspect ratio and is rendered
 *    before the bytes arrive, so the panel does not reflow when the image lands
 *    or when it never does.
 *  - **`alt=""`.** It is decorative — the title is right beside it, and an alt
 *    of the video title would have a screen reader read the same string twice.
 *  - **Disappears on error** rather than leaving a broken-image glyph. "No
 *    preview" is the common case, not the exceptional one: plenty of pages have
 *    no `og:image`, and a token expires out of an in-memory store.
 */
export function Preview({ path, size }: PreviewProps): React.JSX.Element | null {
  const [failed, setFailed] = useState(false);

  // A different job, or a re-probe, is a different image and deserves a fresh
  // chance. Without this, one failure would suppress every later preview this
  // component instance is asked to show.
  useEffect(() => {
    setFailed(false);
  }, [path]);

  if (path === null || path === undefined || path === "" || failed) return null;

  return (
    <div className={`preview preview--${size}`}>
      <img src={path} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </div>
  );
}
