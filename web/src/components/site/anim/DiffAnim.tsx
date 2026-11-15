// Diff: subtract one visit from another. Steady stars cancel; whatever changed is left in colour.
import { useMemo, useRef, useState } from "react";
import { smooth, starField, useLoop } from "./useLoop";

const S = 180, Y = 74;
const X = [24, 248, 472];
const A: [number, number] = [84, 112], B: [number, number] = [104, 76]; // the mover, visit 1 then visit 2
const PANELS = ["Visit 1", "Visit 2", "Difference"] as const;
const STEP = 2.4;

export function DiffAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const time = useLoop(ref, 2 * STEP + 1.5);
  const on = pinned ?? Math.floor(time / STEP) % 3;
  // Inside the difference panel the steady stars fade away as the subtraction "happens".
  const cancel = pinned === 2 ? 1 : on === 2 ? smooth(((time % STEP) - 0.2) / 1.2) : 0;
  const stars = useMemo(() => starField(7, 22, 10, 10, S - 20, S - 20), []);

  const field = (i: number) => {
    const diff = i === 2;
    return (
      <g key={i} transform={`translate(${X[i]} ${Y})`} opacity={i === on ? 1 : 0.55}>
        <rect width={S} height={S} className={diff ? "fa-panel grey" : "fa-panel"} />
        {stars.map(([x, y, r], j) => (
          <circle key={j} cx={x} cy={y} r={r} className={diff ? "fa-resid" : "fa-star"} opacity={diff ? 0.7 * (1 - cancel) : 1} />
        ))}
        {i === 0 && <circle cx={A[0]} cy={A[1]} r={5} className="fa-star" />}
        {i === 1 && <circle cx={B[0]} cy={B[1]} r={5} className="fa-star" />}
        {diff && <>
          <circle cx={A[0]} cy={A[1]} r={7} className="fa-neg" opacity={0.25 + 0.75 * cancel} />
          <circle cx={B[0]} cy={B[1]} r={7} className="fa-pos" opacity={0.25 + 0.75 * cancel} />
        </>}
        {i === on && <rect x={-4} y={-4} width={S + 8} height={S + 8} className="fa-focus" />}
        <text x={S / 2} y={-14} textAnchor="middle" className={i === on ? "fa-mono on" : "fa-mono"}>{PANELS[i]}</text>
      </g>
    );
  };

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label="Animation: visit 1 minus visit 2 equals the difference. Every steady star cancels out; the star that moved leaves a magenta spot where it was and a cyan spot where it is now.">
        {[0, 1, 2].map(field)}
        <text x={226} y={Y + S / 2 + 10} textAnchor="middle" className="fa-op">−</text>
        <text x={450} y={Y + S / 2 + 10} textAnchor="middle" className="fa-op">=</text>
        <g transform={`translate(472 ${Y + S + 30})`}>
          <circle cx={6} cy={0} r={5} className="fa-neg" /><text x={18} y={4} className="pxa-label">faded: it was here</text>
          <circle cx={6} cy={22} r={5} className="fa-pos" /><text x={18} y={26} className="pxa-label">brighter: it is here now</text>
        </g>
      </svg>
      <div className="pxa-controls fa-seg" role="group" aria-label="Show panel">
        {PANELS.map((p, i) => (
          <button key={p} className="btn" aria-pressed={pinned === i} onClick={() => setPinned(pinned === i ? null : i)}>{p}</button>
        ))}
      </div>
      <figcaption>
        Subtract two visits and everything that stayed the same disappears. What's left is only what changed: a
        <b className="fa-c-neg"> magenta</b> spot where a star used to be and a <b className="fa-c-pos">cyan</b> spot
        where it is now. A star that brightens shows up the same way, as a single cyan spot.
      </figcaption>
    </figure>
  );
}
