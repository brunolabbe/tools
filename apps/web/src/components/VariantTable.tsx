import { useId } from "react";
import type { MediaVariant } from "@downloader/shared";
import { sortVariantRows, toVariantRows } from "../lib/variants.ts";

interface VariantTableProps {
  variants: readonly MediaVariant[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
  const rows = sortVariantRows(toVariantRows(variants));

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
                    <span className="variants__res">{row.resolution}</span>
                    {row.hasVideo && row.fps !== "—" && <span className="muted">{row.fps}</span>}
                  </label>
                </th>
                <td>{row.videoCodec}</td>
                <td>
                  {row.hasAudio ? row.audioCodec : "none"}
                  {row.needsMux && (
                    <span className="tag" title="Audio is a separate stream and will be muxed in">
                      +mux
                    </span>
                  )}
                </td>
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
                <td className="muted">{row.protocol.toUpperCase()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
