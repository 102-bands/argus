// Checked against Gaia: on each visit, where Gaia says the star should be (ring) and where Argus measured it (dot).
import { useMemo, useRef } from "react";
import { starField, useLoop } from "./useLoop";

const PX = 28; // drawing units per SPHEREx pixel
// Barnard's Star across five visits (drawn far apart so each one is visible), and the measured offsets in pixels.
const PRED: [number, number][] = [[96, 262], [126, 216], [158, 170], [190, 124], [222, 78]];
const OFF: [number, number][] = [[0.1, -0.08], [-0.32, 0.26], [0.18, 0.14], [-0.2, -0.22], [0.12, 0.06]];
const STEP = 1.3, HOLD = 3;

export function GaiaAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const time = useLoop(ref, PRED.length * STEP + 1);
  const t = time % (PRED.length * STEP + HOLD);
  const shown = Math.min(PRED.length, Math.floor(t / STEP) + 1);
  const done = t >= PRED.length * STEP;
  const stars = useMemo(() => starField(41, 26, 34, 30, 280, 280), []);

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label="Animation: for each of five visits, a ring marks where ESA's Gaia catalogue predicts Barnard's Star to be on that date, and a dot marks where Argus measured it. Every dot lands inside its ring: the worst offset is 0.41 pixels.">
        <rect x={24} y={20} width={300} height={300} className="fa-panel" />
        {stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} className="fa-star dim" />)}
        <line x1={PRED[0][0]} y1={PRED[0][1]} x2={PRED[4][0]} y2={PRED[4][1]} className="fa-track" />
        <path d={`M${PRED[4][0]} ${PRED[4][1]} l-4 10 l10 -2 z`} className="fa-arrowhead" />
        {PRED.slice(0, shown).map(([x, y], i) => {
          const last = i === shown - 1 && !done;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={PX / 2} className="fa-ring" />
              <circle cx={x + OFF[i][0] * PX} cy={y + OFF[i][1] * PX} r={last ? 5 : 3.5} className={last ? "fa-meas on" : "fa-meas"} />
            </g>
          );
        })}
        <text x={36} y={42} className="fa-mono">Barnard's Star · 5 visits</text>

        <g transform="translate(372 46)">
          <circle cx={6} cy={0} r={6} className="fa-ring" /><text x={20} y={4} className="pxa-label">Gaia's prediction for that date (½ pixel)</text>
          <circle cx={6} cy={24} r={3.5} className="fa-meas" /><text x={20} y={28} className="pxa-label">where Argus measured it</text>
          {PRED.map((_, i) => (
            <text key={i} x={0} y={78 + i * 30} className={i < shown ? "fa-mono" : "fa-mono off"}>
              visit {i + 1}{"  "}<tspan className="fa-ok">{i < shown ? "✓ inside" : ""}</tspan>
            </text>
          ))}
          <text x={0} y={250} className={done ? "fa-verdict on" : "fa-verdict"}>✓ worst offset 0.41 px (2.5″)</text>
        </g>
      </svg>
      <figcaption>
        Gaia knows where nearby stars are and how fast they move, so it can predict where each one should sit on
        the date of every SPHEREx visit. Argus measures the real position and compares. For all five targets the
        two agree to within <b className="mono">half a pixel</b>.
      </figcaption>
    </figure>
  );
}
