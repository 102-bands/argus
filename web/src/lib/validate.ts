// "Checked against Gaia": measure the preset target on each visit and compare with where Gaia's proper motion
// puts it. A port of centroid() in api/scripts/validate_motion.py; same 0.5 px pass mark.
import type { FrameMeta } from "./api";
import type { DecodedFrame } from "./frame";
import { mjdToYear, PIXEL_ARCSEC, propagate, worldToPixel, type GridWcs } from "./physics";

/** Preset positions are given at this epoch (api/argus/targets.py CENTRE_YEAR). */
export const TARGET_EPOCH = 2026.0;
export const PASS_PX = 0.5;
const MIN_SNR = 5;
/** Visits stacked from fewer exposures are too noisy to judge (2-exposure visits wander by ~0.6 px); listed, not counted. */
export const MIN_EXP = 5;

export interface MotionTarget {
  ra: number;
  dec: number;
  pmra: number; // mas/yr, includes cos δ
  pmdec: number;
}

export function targetPixel(grid: GridWcs, t: MotionTarget, mjd: number): [number, number] {
  const [ra, dec] = propagate(t.ra, t.dec, t.pmra, t.pmdec, mjdToYear(mjd) - TARGET_EPOCH);
  return worldToPixel(grid, ra, dec);
}

function quantiles(px: Float32Array, qs: number[]): number[] {
  const v = Array.from(px).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return qs.map(() => 0);
  return qs.map((q) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))]);
}

/** Background-subtracted, flux-weighted centroid in a box of radius r around (x0, y0), plus the box peak's SNR. */
export function centroid(px: Float32Array, n: number, x0: number, y0: number, r: number,
                         bg: number, sigma: number): { x: number; y: number; snr: number } | null {
  const xi = Math.round(x0);
  const yi = Math.round(y0);
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let peak = -Infinity;
  for (let y = yi - r; y <= yi + r; y++) {
    for (let x = xi - r; x <= xi + r; x++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const v = px[y * n + x];
      if (!Number.isFinite(v)) continue; // masked (e.g. saturated core): skip, as nan_to_num(0) did
      peak = Math.max(peak, v - bg);
      const w = Math.max(v - bg, 0);
      sw += w;
      sx += w * x;
      sy += w * y;
    }
  }
  if (sw <= 0) return null;
  return { x: sx / sw, y: sy / sw, snr: sigma > 0 ? peak / sigma : 0 };
}

export interface VisitCheck {
  epochLabel: string;
  predicted: [number, number];
  measured: [number, number] | null;
  offsetPx: number | null;
  detected: boolean;
  nExp: number;
  /** Counted towards pass/fail: detected and built from at least MIN_EXP exposures. */
  counted: boolean;
}

export interface MotionCheck {
  visits: VisitCheck[];
  worstPx: number | null; // over detected visits
  detected: number; // counted visits
  seen: number; // visits where the target is detected at all
  pass: boolean;
  moves: boolean; // expected motion over the span exceeds half a pixel
  spanPx: number; // predicted motion first → last visit
}

export function checkMotion(frames: FrameMeta[], decoded: Map<string, DecodedFrame>, grid: GridWcs,
                            t: MotionTarget, broadband: boolean): MotionCheck {
  const r = broadband ? 4 : 3;
  const visits: VisitCheck[] = frames.map((f) => {
    const d = decoded.get(f.key);
    const predicted = targetPixel(grid, t, f.t_mid);
    if (!d) return { epochLabel: f.epoch_label, predicted, measured: null, offsetPx: null, detected: false, nExp: f.n_exp, counted: false };
    const [q25, med, q75] = quantiles(d.pixels, [0.25, 0.5, 0.75]);
    const c = centroid(d.pixels, grid.n, predicted[0], predicted[1], r, med, (q75 - q25) / 1.349);
    const detected = !!c && c.snr >= MIN_SNR;
    return {
      epochLabel: f.epoch_label, predicted,
      measured: c ? [c.x, c.y] : null,
      offsetPx: c ? Math.hypot(c.x - predicted[0], c.y - predicted[1]) : null,
      detected,
      nExp: f.n_exp,
      counted: detected && f.n_exp >= MIN_EXP,
    };
  });
  const good = visits.filter((v) => v.counted && v.offsetPx !== null);
  const worstPx = good.length ? Math.max(...good.map((v) => v.offsetPx!)) : null;
  const a = visits[0]?.predicted;
  const b = visits[visits.length - 1]?.predicted;
  const spanPx = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
  return { visits, worstPx, detected: good.length, seen: visits.filter((v) => v.detected).length, pass: good.length >= 2 && worstPx !== null && worstPx <= PASS_PX,
           moves: spanPx > PASS_PX, spanPx };
}

export const pxToArcsec = (px: number) => px * PIXEL_ARCSEC;

/** Compact verdict for the panel. */
export function shortSummary(c: MotionCheck): string {
  const worst = `${pxToArcsec(c.worstPx!).toFixed(1)}″ (${c.worstPx!.toFixed(2)} px)`;
  if (!c.moves) return `${c.pass ? "Position steady" : "Position varies"}: worst ${worst}, ${c.detected} visits`;
  return `${c.pass ? "Matches Gaia" : "Differs from Gaia"}: worst ${worst}, ${c.detected} visits`;
}

/** One line for the PDF report (and the panel when the check can't run). */
export function summary(c: MotionCheck, band: string): string {
  const where = band === "all" ? "the combined bands" : band;
  if (c.detected < 2 && c.seen >= 2) return `Too few exposures per visit in ${where} to judge (need ${MIN_EXP}+); try “all”.`;
  if (c.detected < 2) return `Not detected in ${where}; try another band.`;
  const worst = `${pxToArcsec(c.worstPx!).toFixed(1)}″ (${c.worstPx!.toFixed(2)} px)`;
  if (!c.moves) return `${c.pass ? "Position steady" : "Position varies"}: worst offset ${worst} over ${c.detected} visits; no motion expected.`;
  return `${c.pass ? "Motion matches Gaia" : "Motion differs from Gaia"}: worst offset ${worst} over ${c.detected} visits, `
       + `for ${pxToArcsec(c.spanPx).toFixed(1)}″ of predicted motion.`;
}
