// The Assay signature: six stations on one thread. State is carried by fill, line style and a word.
import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { STATE_WORD } from "../case/model.js";
import { PayPalLogo } from "./PayPalLogo.jsx";

const linkState = (a, b) =>
  a.state === "broken" || b.state === "broken"
    ? "broken"
    : a.state === "verified" && b.state === "verified"
      ? "verified"
      : "pending";

export function ProofLine({ stations, selected, onSelect, size = "md", animate = false }) {
  const interactive = typeof onSelect === "function";
  return (
    <ol className="proofline" data-size={size} data-animate={animate || undefined} aria-label="Proof line from agreement to settlement">
      {stations.map((s, i) => {
        const body = (
          <>
            <span className="station-node" data-state={s.state} aria-hidden="true">
              {size !== "mini" && s.state === "verified" && <CheckIcon size={11} weight="bold" />}
              {size !== "mini" && s.state === "broken" && <XIcon size={10} weight="bold" />}
            </span>
            {size !== "mini" && (
              <span className="station-text">
                <span className="station-title">
                  {s.title}
                  {(s.key === "payment" || s.key === "settlement") && <PayPalLogo variant="mark" size="xs" />}
                </span>
                <span className="eyebrow" data-state={s.state}>{STATE_WORD[s.state]}</span>
              </span>
            )}
          </>
        );
        return (
          <li key={s.key} style={{ "--i": i }}>
            {i > 0 && <span className="station-link" data-state={linkState(stations[i - 1], s)} aria-hidden="true" />}
            {interactive ? (
              <button type="button" className="station" aria-pressed={selected === s.key} aria-label={`${s.title}: ${STATE_WORD[s.state]}. ${s.value}`} onClick={() => onSelect(s.key)}>
                {body}
              </button>
            ) : (
              <span className="station" title={size === "mini" ? `${s.title}: ${STATE_WORD[s.state]}` : undefined}>
                {body}
                {size === "mini" && <span className="sr-only">{s.title}: {STATE_WORD[s.state]}. </span>}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
