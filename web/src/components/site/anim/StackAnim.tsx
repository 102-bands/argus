// Stack: add exposures together. The noise averages down as 1/√N and faint sources climb out of it.
import { useMemo, useRef, useState } from "react";
import { seeded, useLoop } from "./useLoop";

const G = 30, C = 9, OX = 30, OY = 30;  // 30×30 pixels, 9 px each
const LAYERS = 64;
const SOURCES: [number, number, number][] = [[15, 14, 1.25], [7, 22, 0.9], [23, 7, 1.6]]; // col, row, peak (in single-exposure σ)
const PEAK = SOURCES[0][2];
// The S/N chart.
const CX = 384, CW = 260, CY = 46, CH = 236, SN_MAX = 11;

export function StackAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const time = useLoop(ref, 7.2);

  // 64 exposures' worth of noise, fixed so the picture is the same for everyone.
  const noise = useMemo(() => {
    const r = seeded(29);
    const out = new Float32Array(LAYERS * G * G);
    for (let i = 0; i < out.length; i += 2) {
      const u = Math.max(1e-9, r()), v = r(), m = Math.sqrt(-2 * Math.log(u));
      out[i] = m * Math.cos(2 * Math.PI * v);
      out[i + 1] = m * Math.sin(2 * Math.PI * v);
    }
    return out;
  }, []);
  const signal = useMemo(() => {
    const s = new Float32Array(G * G);
    for (let row = 0; row < G; row++) for (let col = 0; col < G; col++) {
      s[row * G + col] = SOURCES.reduce((a, [c, r, p]) => a + p * Math.exp(-((col - c) ** 2 + (row - r) ** 2) / (2 * 1.1 ** 2)), 0);
    }
    return s;
  }, []);

  // Auto: double the stack every 1.2 s from 1 to 64, hold, repeat.
  const phase = time % 9.6;
  const auto = 2 ** Math.min(6, Math.floor(phase / 1.2));
  const n = pinned ?? auto;

  const cells = [];
  for (let j = 0; j < G * G; j++) {
    let sum = 0;
    for (let l = 0; l < n; l++) sum += noise[l * G * G + j];
    const v = signal[j] + sum / n;
    const g = Math.round(255 * Math.min(1, Math.max(0, (v + 0.9) / 3.2)));
    cells.push(<rect key={j} x={OX + (j % G) * C} y={OY + Math.floor(j / G) * C} width={C} height={C} fill={`rgb(${g},${g},${g})`} />);
  }

  const sn = PEAK * Math.sqrt(n);
  const px = (k: number) => CX + (Math.log2(k) / 6) * CW;
  const py = (s: number) => CY + CH - (s / SN_MAX) * CH;
  const curve = Array.from({ length: 61 }, (_, i) => { const k = 2 ** (i / 10); return `${px(k)},${py(PEAK * Math.sqrt(k))}`; }).join(" ");

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label={`Animation: ${n} exposures added together. The random noise shrinks and three faint sources appear. Signal-to-noise of the central source: ${sn.toFixed(1)}.`}>
        <g shapeRendering="crispEdges">{cells}</g>
        <rect x={OX} y={OY} width={G * C} height={G * C} className="fa-panel-line" />
        <rect x={OX + SOURCES[0][0] * C - 14} y={OY + SOURCES[0][1] * C - 14} width={36} height={36} className={sn >= 5 ? "fa-box on" : "fa-box"} />
        <text x={OX} y={OY + G * C + 24} className="fa-mono">{n} exposure{n > 1 ? "s" : ""} stacked</text>

        {/* signal-to-noise grows as √N */}
        <line x1={CX} x2={CX + CW} y1={CY + CH} y2={CY + CH} className="fa-axis" />
        <line x1={CX} x2={CX} y1={CY} y2={CY + CH} className="fa-axis" />
        <line x1={CX} x2={CX + CW} y1={py(5)} y2={py(5)} className="fa-threshold" />
        <text x={CX + CW} y={py(5) - 6} textAnchor="end" className="pxa-label">5σ: the finder counts it</text>
        <polyline points={curve} className="fa-curve" />
        <circle cx={px(n)} cy={py(sn)} r={5} className={sn >= 5 ? "fa-pt on" : "fa-pt"} />
        {[1, 4, 16, 64].map((k) => <text key={k} x={px(k)} y={CY + CH + 18} textAnchor="middle" className="pxa-label">{k}</text>)}
        <text x={CX + CW / 2} y={CY + CH + 38} textAnchor="middle" className="pxa-label">exposures</text>
        <text x={CX - 8} y={CY + 6} textAnchor="end" className="pxa-label">S/N</text>
      </svg>
      <div className="pxa-controls">
        <label htmlFor="fa-stack">Exposures</label>
        <input id="fa-stack" type="range" min={0} max={6} step={1} value={Math.log2(n)}
               onChange={(e) => setPinned(2 ** Number(e.target.value))} />
        <output htmlFor="fa-stack" className="mono">{n}</output>
      </div>
      <figcaption>
        One exposure is mostly noise. Add <b className="mono">{n}</b> together and the noise drops by √{n} ={" "}
        <b className="mono">{Math.sqrt(n).toFixed(1)}×</b>: the central source goes from S/N {PEAK.toFixed(1)} to{" "}
        <b className="mono">{sn.toFixed(1)}</b>{sn >= 5 ? ", above the finder's 5σ cut" : ""}. Each SPHEREx visit has up to a few
        dozen exposures.
      </figcaption>
    </figure>
  );
}
