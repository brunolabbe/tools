import { useId } from "react";
import type { MediaVariant } from "@downloader/contract";
import { toDisplayRows } from "../lib/variants.ts";

interface VariantTableProps {
  variants: readonly MediaVariant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * What the mirror count means, in one sentence, for both the tooltip and the
 * screen reader (dl-45).
 *
 * Written to close one specific misreading rather than to describe the feature:
 * the number must not be taken for a quality grade. "Availability" is the word
 * doing that work, and "same rendition" is there because the count is the only
 * thing on the row that varies without the media varying with it.
 */
function mirrorHint(count: number): string {
  return `Availability only: the same rendition is served from ${count} hosts, so a download can fail over if one stops answering. Not a higher-quality rendition.`;
}

/**
 * Native radios inside the row header: arrow keys move between renditions and
 * the whole label is a hit target, with no custom key handling to get wrong.
 */
export function VariantTable({
  variants,
  selectedId,
  onSelect,
}: VariantTableProps): React.JSX.Element {
  const groupName = useId();
  const { rows, showLanguage } = toDisplayRows(variants);

  return (
    <div className="tablewrap">
      <table className="variants">
        <caption className="visually-hidden">
          Available renditions. Choose one with the arrow keys, then start the download.
        </caption>
        <thead>
          <tr>
            <th scope="col">Quality</th>
            <th scope="col">Video</th>
            <th scope="col">Audio</th>
            {/* Present only when two renditions disagree on it, which is the
                only time it separates anything (dl-40). */}
            {showLanguage && <th scope="col">Language</th>}
            <th scope="col">Bitrate</th>
            <th scope="col">Size</th>
            <th scope="col">Delivery</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inputId = `${groupName}-${row.id}`;
            const selected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                className={selected ? "variants__row variants__row--on" : "variants__row"}
              >
                <th scope="row">
                  <label className="variants__label" htmlFor={inputId}>
                    <input
                      id={inputId}
                      type="radio"
                      name={groupName}
                      value={row.id}
                      checked={selected}
                      onChange={() => onSelect(row.id)}
                    />
                    <span className="variants__res">{row.quality}</span>
                    {row.hasVideo && row.fps !== "—" && <span className="muted">{row.fps}</span>}
                  </label>
                </th>
                <td>{row.videoCodec}</td>
                <td
                  {...(row.audio === "unverified"
                    ? { title: "Not inspected — this tier only saw the response headers" }
                    : {})}
                >
                  {/* Three states: `none` is a checked absence, `—` is silence
                      about it. Collapsing them is the dl-42 defect. */}
                  {row.audio === "absent" ? "none" : row.audioCodec}
                  {row.needsMux && (
                    <span className="tag" title="Audio is a separate stream and will be muxed in">
                      +mux
                    </span>
                  )}
                </td>
                {showLanguage && <td>{row.language === "" ? "—" : row.language}</td>}
                <td>{row.bitrate}</td>
                <td>
                  {row.size}
                  {row.sizeIsEstimate && row.size !== "—" && (
                    <span
                      className="tag tag--estimate"
                      title="Derived from bitrate × duration, not measured"
                    >
                      est.
                    </span>
                  )}
                </td>
                <td className="muted">
                  {row.protocol.toUpperCase()}
                  {/* dl-45's affordance, and it lives in Delivery on purpose.
                      A mirrored rendition is not a better rendition — it is the
                      same one, reachable from more places — so the count sits
                      beside the transport rather than beside the quality, and
                      says "servers" rather than anything that could be read as
                      a grade. dl-40 collapsed these rows precisely to stop the
                      table implying a difference; this must not put that
                      implication back under a new name. */}
                  {row.mirrors > 1 && (
                    <span className="tag" title={mirrorHint(row.mirrors)}>
                      <span aria-hidden="true">{row.mirrors} servers</span>
                      {/* The visible text is a fragment; a screen reader gets
                          the whole sentence, because `title` is not reliably
                          announced and "3 servers" on its own is exactly the
                          ambiguity this is supposed to close. */}
                      <span className="visually-hidden">{mirrorHint(row.mirrors)}</span>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
