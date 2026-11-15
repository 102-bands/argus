// Plots: a variable star's brightness, visit by visit, drawn as a light curve.
import { useRef } from "react";
import { useLoop } from "./useLoop";

// Brightness relative to the mean on each visit (an irregular young star, RW Aur-like; illustrative values).
const REL = [1.0, 1.24, 0.84, 1.36, 0.93, 1.1, 0.76, 1.18];
const STEP = 0.9, HOLD = 2.4;
const CX = 352, CW = 290, CY = 40, CH = 220, LO = 0.6, HI = 1.5;

export function PlotsAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const time = useLoop(ref, REL.length * STEP);
  const t = time % (REL.length * STEP + HOLD);
  const n = Math.min(REL.length, Math.floor(t / STEP) + 1);
  const cur = REL[n - 1];
  const x = (i: number) => CX + 14 + (i / (REL.length - 1)) * (CW - 28);
  const y = (r: number) => CY + CH - ((r - LO) / (HI - LO)) * CH;

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label="Animation: a variable star brightens and fades from visit to visit while its light curve is drawn point by point.">
        <rect x={24} y={30} width={290} height={230} className="fa-panel" />
        <circle cx={169} cy={145} r={14 + 22 * cur} className="fa-var-glow" opacity={0.06 + 0.22 * (cur - LO)} />
        <circle cx={169} cy={145} r={4 + 7 * cur} className="fa-var" />
        <text x={36} y={52} className="fa-mono">visit {n} · {Math.round(cur * 100)}% of mean</text>

        <line x1={CX} x2={CX + CW} y1={y(1)} y2={y(1)} className="fa-threshold" />
        <text x={CX + CW} y={y(1) - 6} textAnchor="end" className="pxa-label">mean</text>
        <line x1={CX} x2={CX + CW} y1={CY + CH} y2={CY + CH} className="fa-axis" />
        <line x1={CX} x2={CX} y1={CY} y2={CY + CH} className="fa-axis" />
        <polyline points={REL.slice(0, n).map((r, i) => `${x(i)},${y(r)}`).join(" ")} className="fa-lc" />
        {REL.slice(0, n).map((r, i) => <circle key={i} cx={x(i)} cy={y(r)} r={i === n - 1 ? 5 : 3.5} className={i === n - 1 ? "fa-pt on" : "fa-pt"} />)}
        <text x={CX + CW / 2} y={CY + CH + 22} textAnchor="middle" className="pxa-label">visits →</text>
        <text x={CX - 8} y={CY + 6} textAnchor="end" className="pxa-label">bright</text>
        <text x={CX - 8} y={CY + CH} textAnchor="end" className="pxa-label">faint</text>
        <text x={CX + CW} y={CY - 10} textAnchor="end" className="pxa-note">illustrative values</text>
      </svg>
      <figcaption>
        Switch the tool to Plots and Argus measures the star at the centre on every visit: its light curve, and its
        spectrum across all 102 colours. A steady star sits on the line; a variable like RW Aurigae swings
        by <b className="mono">tens of percent</b>.
      </figcaption>
    </figure>
  );
}
