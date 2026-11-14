import { useMemo, useState } from "react";
import type { PhotPoint } from "../lib/api";
import { miraPhase, mjdToDate } from "../lib/physics";
import { track } from "../lib/analytics";

const DET_COLOURS: Record<string, string> = {
  D1: "var(--d1)", D2: "var(--d2)", D3: "var(--d3)", D4: "var(--d4)", D5: "var(--d5)", D6: "var(--d6)",
};

interface Props {
  width?: number;
  height?: number;
  points: PhotPoint[];
  band: string;
  mira: boolean; // R Dra: offer the phase axis
}

// Chart size in viewBox units; the Plots view passes a larger size so labels stay small.
const DEFAULT_W = 300;
const DEFAULT_H = 170;

export function LightCurve({ points, band, mira, width = DEFAULT_W, height = DEFAULT_H }: Props) {
  const W = width;
  const H = height;
  // Wider charts (Plots view) use bigger labels, so they need a wider left margin for the flux axis.
  const M = width > 400 ? { l: 56, r: 10, t: 10, b: 28 } : { l: 40, r: 8, t: 8, b: 24 };
  const [phase, setPhase] = useState(false);
  const pts = useMemo(() => points.filter((p) => (band === "all" || p.detector === band) && p.flux_ujy > 0), [points, band]);

  if (!pts.length) return <p className="note">No brightness measurements for this band yet.</p>;

  const xs = pts.map((p) => (phase ? miraPhase(p.mjd) : p.mjd));
  // Log flux: detectors differ by orders of magnitude for red objects.
  const ys = pts.map((p) => Math.log10(p.flux_ujy));
  const x0 = phase ? 0 : Math.min(...xs);
  const x1 = phase ? 1 : Math.max(...xs);
  const y0 = Math.min(...ys) - 0.05;
  const y1 = Math.max(...ys) + 0.05;
  const sx = (x: number) => M.l + ((x - x0) / Math.max(x1 - x0, 1e-9)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - y0) / Math.max(y1 - y0, 1e-9)) * (H - M.t - M.b);

  const yTicks = niceLogTicks(y0, y1);
  const xTicks = phase ? [0, 0.25, 0.5, 0.75, 1] : timeTicks(x0, x1);
  const anySat = pts.some((p) => p.saturated);

  return (
    <div>
      {mira && (
        <div className="tabs" role="group" aria-label="Light curve axis">
          <button className="btn" aria-pressed={!phase} onClick={() => setPhase(false)}>Date</button>
          <button className="btn" aria-pressed={phase} onClick={() => { setPhase(true); track("lightcurve_open", { band: "phase" }); }}>Mira phase</button>
        </div>
      )}
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Brightness of the centre source over time, ${pts.length} measurements`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.l} x2={W - M.r} y1={sy(Math.log10(t))} y2={sy(Math.log10(t))} />
            <text x={M.l - 4} y={sy(Math.log10(t)) + 3} textAnchor="end">{fmtFlux(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - 8} textAnchor="middle">
            {phase ? t.toFixed(2) : mjdToDate(t).toISOString().slice(0, 7)}
          </text>
        ))}
        <line className="axis" x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
        <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        {pts.map((p, i) => {
          const c = DET_COLOURS[p.detector];
          const lo = Math.log10(Math.max(p.flux_ujy - p.err, p.flux_ujy * 0.5));
          const hi = Math.log10(p.flux_ujy + p.err);
          return (
            <g key={i}>
              <line x1={sx(xs[i])} x2={sx(xs[i])} y1={sy(lo)} y2={sy(hi)} stroke={c} strokeOpacity={0.5} />
              <circle cx={sx(xs[i])} cy={sy(ys[i])} r={2.4} fill={p.saturated ? "none" : c} stroke={c}>
                <title>{`${p.detector} ${p.lambda_um.toFixed(2)} µm · ${mjdToDate(p.mjd).toISOString().slice(0, 10)} · ${fmtFlux(p.flux_ujy)} ± ${fmtFlux(p.err)}${p.saturated ? " · saturated" : ""}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="det-key">
        {Object.entries(DET_COLOURS).map(([d, c]) => (
          <span key={d} style={{ ["--c" as string]: c }}>{d}</span>
        ))}
        {anySat && <span style={{ color: "var(--amber)" }}>○ saturated</span>}
      </div>
    </div>
  );
}

function fmtFlux(ujy: number): string {
  if (ujy >= 1e6) return `${trim(ujy / 1e6)} Jy`;
  if (ujy >= 1e3) return `${trim(ujy / 1e3)} mJy`;
  return `${trim(ujy)} µJy`;
}

function niceLogTicks(y0: number, y1: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) {
    for (const m of [1, 3]) {
      const v = m * 10 ** e;
      if (Math.log10(v) >= y0 && Math.log10(v) <= y1) out.push(v);
    }
  }
  return out.length ? out : [10 ** ((y0 + y1) / 2)];
}

function timeTicks(x0: number, x1: number): number[] {
  const n = 3;
  return Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / n);
}

function trim(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toPrecision(2);
}
