import type { ReactNode } from "react";
import { Preview } from "./Preview.tsx";

interface BoxHeadProps {
  /** For the region the head names, so each box's heading id is its own. */
  headingId?: string;
  title: string;
  subtitle: ReactNode;
  /** A tooltip on the subtitle — the job's full address, which the line shortens to its host. */
  subtitleTitle?: string;
  previewPath: string | null | undefined;
  /** The pills at the right of the head. */
  children: ReactNode;
}

/**
 * The head of a box once it knows what it found: the preview and the title, and
 * a line under them (dl-133). The analysis and the job it becomes draw it with
 * this one component, so pressing Download leaves the preview and the title
 * exactly where they were and only the line and the pills change.
 */
export function BoxHead({
  headingId,
  title,
  subtitle,
  subtitleTitle,
  previewPath,
  children,
}: BoxHeadProps): React.JSX.Element {
  return (
    <div className="card__head">
      {/* Grouped with the title rather than added as a third child of
          `card__head`, which is `space-between` — a bare third child would
          push the title into the middle of the row. `card__headline` collapses
          to just the title when there is no preview, so the layout does not
          depend on the image existing. */}
      <div className="card__headline">
        <Preview path={previewPath} size="panel" />
        <div className="job__titles">
          <h2 id={headingId} className="card__title">
            {title}
          </h2>
          <p className="muted job__subtitle" {...(subtitleTitle ? { title: subtitleTitle } : {})}>
            {subtitle}
          </p>
        </div>
      </div>
      <div className="pills">{children}</div>
    </div>
  );
}
