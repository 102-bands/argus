// Spectrum of the centre source from one visit (PRD §7.9). Each exposure sees the source at a different
// wavelength because the filters vary across the detector, so one visit samples the whole 0.75–5 µm range.
import { useEffect, useMemo, useState } from "react";
import type { Epoch, PhotPoint } from "../lib/api";
import { track } from "../lib/analytics";
import { AxisTitles } from "./LightCurve";

// Chart size in viewBox units; the Plots view passes a larger size so labels stay small.
const DEFAULT_W = 300;
const DEFAULT_H = 170;
const R = 40; // binning resolution, Δ ln λ = 1/R

interface Props {
  width?: number;
  height?: number;
  points: PhotPoint[];
  epochs: Epoch[];
  initialEpoch: number | null;
}

export function Spectrum({ points, epochs, initialEpoch, width = DEFAULT_W, height = DEFAULT_H }: Props) {
  const W = width;
  const H = height;
  // Room for tick labels plus an axis title on each axis.
  const M = { l: 82, r: 24, t: 10, b: 50 };
  const withData = useMemo(() => epochs.filter((e) => points.some((p) => p.epoch === e.id && p.flux_ujy > 0)), [epochs, points]);
  const [epoch, setEpoch] = useState<number | null>(initialEpoch);
  useEffect(() => {
    if (epoch === null || !withData.some((e) => e.id === epoch)) {
      // Default: the visit with the most measurements.
      const best = [...withData].sort((a, b) => points.filter((p) => p.epoch === b.id).length - points.filter((p) => p.epoch === a.id).length)[0];
      setEpoch(best?.id ?? null);
    }
  }, [withData]); // eslint-disable-line react-hooks/exhaustive-deps

  const pts = points.filter((p) => p.epoch === epoch && p.flux_ujy > 0);
  const bins = useMemo(() => binLogLambda(pts), [pts]);
  if (!withData.length) return <p className="note">No measurements yet.</p>;

  const lx = (l: number) => Math.log(l);
  const x0 = lx(0.73);
  const x1 = lx(5.05);
  const ys = pts.map((p) => Math.log10(p.flux_ujy));
  const y0 = Math.min(...ys) - 0.1;
  const y1 = Math.max(...ys) + 0.1;
  const sx = (l: number) => M.l + ((lx(l) - x0) / (x1 - x0)) * (W - M.l - M.r);
  const sy = (y: number) => H - M.b - ((y - y0) / Math.max(y1 - y0, 1e-9)) * (H - M.t - M.b);

  return (
    <div>
      <label className="ctl" style={{ marginBottom: 8 }}>
        <span className="label">Visit</span>
        <select value={epoch ?? ""} onChange={(e) => { setEpoch(Number(e.target.value)); track("spectrum_open", { band: "epoch" }); }}
                aria-label="Visit for the spectrum">
          {withData.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </label>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Spectrum of the centre source, ${pts.length} exposures, ${bins.length} bins`}>
        {[1, 2, 3, 4, 5].map((l) => (
          <text key={l} x={sx(l)} y={H - M.b + 16} textAnchor="middle">{l} µm</text>
        ))}
        {logTicks(y0, y1).map((t) => (
          <g key={t}>
            <line className="grid" x1={M.l} x2={W - M.r} y1={sy(Math.log10(t))} y2={sy(Math.log10(t))} />
            <text x={M.l - 4} y={sy(Math.log10(t)) + 3} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        <line className="axis" x1={M.l} x2={M.l} y1={M.t} y2={H - M.b} />
        <line className="axis" x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} />
        <AxisTitles W={W} H={H} M={M} x="Wavelength (µm, log scale)" y="Brightness (log scale)" />
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p.lambda_um)} cy={sy(Math.log10(p.flux_ujy))} r={1.6}
                  fill={p.saturated ? "none" : "var(--fg-3)"} stroke="var(--fg-3)" />
        ))}
        <polyline fill="none" stroke="var(--cyan)" strokeWidth={1.5}
                  points={bins.map((b) => `${sx(b.lambda)},${sy(Math.log10(b.flux))}`).join(" ")} />
        {bins.map((b, i) => (
          <circle key={i} cx={sx(b.lambda)} cy={sy(Math.log10(b.flux))} r={2.2} fill="var(--cyan)">
            <title>{`${b.lambda.toFixed(3)} µm · ${fmt(b.flux)} ± ${fmt(b.err)} · ${b.n} exp`}</title>
          </circle>
        ))}
      </svg>
      <p className="note" style={{ fontSize: 11, margin: "4px 0 0" }}>
        Grey: single exposures. Cyan: weighted mean in bins of R ≈ {R}. Hollow: saturated. One visit only, so a variable star doesn't blur.
      </p>
    </div>
  );
}

function binLogLambda(pts: PhotPoint[]) {
  const groups = new Map<number, PhotPoint[]>();
  for (const p of pts) {
    const k = Math.floor(Math.log(p.lambda_um) * R);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, g]) => {
      const w = g.map((p) => (p.err > 0 ? 1 / (p.err * p.err) : 0));
      const sw = w.reduce((a, b) => a + b, 0) || g.length;
      const flux = sw === g.length && w.every((x) => x === 0)
        ? g.reduce((a, p) => a + p.flux_ujy, 0) / g.length
        : g.reduce((a, p, i) => a + w[i] * p.flux_ujy, 0) / sw;
      const lambda = Math.exp(g.reduce((a, p) => a + Math.log(p.lambda_um), 0) / g.length);
      return { lambda, flux, err: 1 / Math.sqrt(sw), n: g.length };
    })
    .filter((b) => b.flux > 0);
}

function fmt(ujy: number): string {
  if (ujy >= 1e6) return `${trim(ujy / 1e6)} Jy`;
  if (ujy >= 1e3) return `${trim(ujy / 1e3)} mJy`;
  return `${trim(ujy)} µJy`;
}

function logTicks(y0: number, y1: number): number[] {
  const out: number[] = [];
  for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) if (e >= y0 && e <= y1) out.push(10 ** e);
  return out.length ? out : [10 ** ((y0 + y1) / 2)];
}

function trim(v: number): string {
  return v >= 10 ? String(Math.round(v)) : v.toPrecision(2);
}
