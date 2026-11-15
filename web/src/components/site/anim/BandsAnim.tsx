// Colour bands: the same two objects seen from 0.75 to 5 µm. A cold brown dwarf only lights up at the red end.
import { useRef, useState } from "react";
import { useLoop } from "./useLoop";

// SPHEREx's six detectors (µm).
const BANDS: [string, number, number][] = [
  ["D1", 0.75, 1.09], ["D2", 1.1, 1.62], ["D3", 1.63, 2.41], ["D4", 2.42, 3.82], ["D5", 3.83, 4.41], ["D6", 4.42, 5.0],
];
const L0 = 0.75, L1 = 5;
// Schematic spectra, each scaled to a peak of 1: a hot star falls off to the red; a ~300 K brown dwarf is dark
// until its 4–5 µm window.
const star = (l: number) => (L0 / l) ** 2;
const dwarf = (l: number) => Math.min(1, 0.025 + 0.06 * Math.exp(-(((l - 1.27) / 0.1) ** 2)) + Math.exp(-(((l - 4.6) / 0.42) ** 2)));
const CX = 360, CW = 290, CY = 40, CH = 220;

export function BandsAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const time = useLoop(ref, 5.6);
  const p = (time % 12) / 6;
  const lam = pinned ?? L0 + (L1 - L0) * (p < 1 ? p : 2 - p);
  const band = BANDS.find(([, a, b]) => lam >= a - 0.005 && lam <= b + 0.005)?.[0] ?? "D1";
  const x = (l: number) => CX + ((l - L0) / (L1 - L0)) * CW;
  const y = (f: number) => CY + CH - f * CH;
  const line = (fn: (l: number) => number) =>
    Array.from({ length: 120 }, (_, i) => { const l = L0 + (i / 119) * (L1 - L0); return `${x(l)},${y(fn(l))}`; }).join(" ");
  const blob = (cx: number, f: number, cls: string, label: string) => (
    <g>
      <circle cx={cx} cy={140} r={8 + 34 * Math.sqrt(f)} className={`${cls}-glow`} opacity={0.08 + 0.3 * f} />
      <circle cx={cx} cy={140} r={3 + 13 * Math.sqrt(f)} className={cls} opacity={0.3 + 0.7 * Math.sqrt(f)} />
      <text x={cx} y={232} textAnchor="middle" className="pxa-label">{label}</text>
    </g>
  );

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label={`Animation: an ordinary star and a cold brown dwarf seen at ${lam.toFixed(2)} µm, in band ${band}. The star fades towards long wavelengths; the brown dwarf only appears near 4.5 µm.`}>
        <rect x={24} y={30} width={300} height={220} className="fa-panel" />
        {blob(104, star(lam), "fa-hot", "ordinary star")}
        {blob(244, dwarf(lam), "fa-cold", "cold brown dwarf")}
        <text x={36} y={52} className="fa-mono">{lam.toFixed(2)} µm · {band}</text>

        {BANDS.map(([n, a, b], i) => (
          <g key={n}>
            <rect x={x(a)} y={CY} width={x(b) - x(a)} height={CH} className="fa-band" style={{ fill: `var(--d${i + 1})` }}
                  opacity={n === band ? 0.18 : 0.05} />
            <text x={(x(a) + x(b)) / 2} y={CY + CH + 18} textAnchor="middle" className={n === band ? "fa-mono on" : "pxa-label"}>{n}</text>
          </g>
        ))}
        <polyline points={line(star)} className="fa-spec hot" />
        <polyline points={line(dwarf)} className="fa-spec cold" />
        <line x1={x(lam)} x2={x(lam)} y1={CY} y2={CY + CH} className="fa-cursor" />
        <circle cx={x(lam)} cy={y(star(lam))} r={4} className="fa-hot" />
        <circle cx={x(lam)} cy={y(dwarf(lam))} r={4} className="fa-cold" />
        <line x1={CX} x2={CX + CW} y1={CY + CH} y2={CY + CH} className="fa-axis" />
        <text x={CX} y={CY + CH + 38} className="pxa-label">0.75 µm</text>
        <text x={CX + CW} y={CY + CH + 38} textAnchor="end" className="pxa-label">5 µm</text>
        <text x={CX + CW} y={CY - 10} textAnchor="end" className="pxa-note">schematic spectra</text>
      </svg>
      <div className="pxa-controls">
        <label htmlFor="fa-bands">Wavelength</label>
        <input id="fa-bands" type="range" min={L0} max={L1} step={0.01} value={lam}
               onChange={(e) => setPinned(Number(e.target.value))} />
        <output htmlFor="fa-bands" className="mono">{band}</output>
      </div>
      <figcaption>
        SPHEREx sees each spot in six detector bands, D1 to D6. Ordinary stars are brightest at the blue end. A brown
        dwarf colder than freezing, like WISE 0855, is almost invisible there and only shows up around{" "}
        <b className="mono">4.5 µm</b>, in D5 and D6. Switch bands in the tool to find it.
      </figcaption>
    </figure>
  );
}
