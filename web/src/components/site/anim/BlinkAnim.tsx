// Blink: the visits shown one after another. The far stars stay put; a nearby star hops along its path.
import { useMemo, useRef, useState } from "react";
import { starField, useLoop } from "./useLoop";

const VISITS = ["2025-03", "2025-09", "2026-03", "2026-09"];
const BOX = { x: 24, y: 20, s: 300 };
// The mover's path across the visits (drawn far larger than life so it reads at this size).
const PATH: [number, number][] = [[150, 228], [158, 196], [166, 164], [174, 132]];

export function BlinkAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const [hold, setHold] = useState(0.7);
  const time = useLoop(ref, 0);
  const k = Math.floor(time / hold) % VISITS.length;
  const stars = useMemo(() => starField(3, 46, BOX.x + 8, BOX.y + 8, BOX.s - 16, BOX.s - 16), []);
  const [mx, my] = PATH[k];

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label="Animation: four SPHEREx visits of the same patch of sky shown one after another. Every star stays still except one nearby star, which steps along a straight line from visit to visit.">
        <rect x={BOX.x} y={BOX.y} width={BOX.s} height={BOX.s} className="fa-panel" />
        {stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} className="fa-star" />)}
        {PATH.slice(0, k).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} className="fa-ghost" />)}
        <circle cx={mx} cy={my} r={6} className="fa-mover" />
        <circle cx={mx} cy={my} r={12} className="fa-mover-glow" />
        <text x={BOX.x + 10} y={BOX.y + 22} className="fa-mono">{VISITS[k]} · visit {k + 1} of 4</text>

        {/* the timeline, like the bar above the image in the tool */}
        <text x={372} y={58} className="pxa-label">Visits, six months apart</text>
        {VISITS.map((v, i) => (
          <g key={v} transform={`translate(372 ${86 + i * 52})`}>
            <rect width={270} height={40} className={i === k ? "fa-row on" : "fa-row"} />
            <circle cx={20} cy={20} r={5} className={i === k ? "fa-dot on" : "fa-dot"} />
            <text x={38} y={25} className="fa-mono">{v}</text>
            <text x={258} y={25} textAnchor="end" className="pxa-label">{i === 0 ? "start" : `${(i * 5.2).toFixed(1)}″ north`}</text>
          </g>
        ))}
      </svg>
      <div className="pxa-controls">
        <label htmlFor="fa-blink">Speed</label>
        <input id="fa-blink" type="range" min={0.25} max={1.5} step={0.05} value={1.75 - hold}
               onChange={(e) => setHold(1.75 - Number(e.target.value))} />
        <output htmlFor="fa-blink" className="mono">{hold.toFixed(2)} s</output>
      </div>
      <figcaption>
        Your eye is good at one thing: spotting what jumps. Barnard's Star moves about <b className="mono">5″</b> every six
        months, nearly a whole SPHEREx pixel, while the stars behind it don't move at all. (Motion drawn larger here.)
      </figcaption>
    </figure>
  );
}
