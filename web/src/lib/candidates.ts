// Automatic candidates: find every source in the field, measure it on every visit, and say whether it moves,
// varies, has brown-dwarf-like colours, and whether ESA's Gaia knows it. Pure functions on the decoded frames;
// the equations are written out in the paper (/about §3.6).
import type { FrameMeta, GaiaSource } from "./api";
import type { DecodedFrame } from "./frame";
import { LAYER_SATURATED } from "./frame";
import { earthHelio, GAIA_EPOCH, MJYSR_TO_UJY, mjdToYear, PIXEL_ARCSEC, pixelToWorld, propagate, worldToPixel,
         type GridWcs } from "./physics";
import { centroid, MIN_EXP, quantiles } from "./validate";

export const DETECT_SIGMA = 5;
export const MAX_SOURCES = 40;
export const MOVE_SIGMA = 5;
/** Smallest measured displacement over the span that counts as motion: the Gaia check's pass mark. */
export const MOVE_MIN_PX = 0.5;
/** Position error floor (px): reprojection and centroid systematics between visits. */
export const POS_FLOOR_PX = 0.1;
const PSF_SIGMA_PX = 1;
const VAR_CHI2 = 5;
const VAR_AMP = 0.15;
export const RED_COLOUR = 2.5;
export const GAIA_MATCH_PX = 1.5;
/** /api/gaia returns at most this many rows; a full list may be missing faint stars. */
const GAIA_CAP = 2000;
const AP_R = 2;
const ANN_IN = 4;
const ANN_OUT = 7;
const DETECTORS = ["D1", "D2", "D3", "D4", "D5", "D6"];

export type Kind = "moving" | "variable" | "red" | "steady";

export interface VisitPos {
  epoch: number;
  label: string;
  year: number;
  x: number;
  y: number;
  sigma: number;
}

export interface Motion {
  /** Proper motion east (μα*) and north (μδ), mas/yr, with 1σ errors. */
  pmra: number;
  pmdec: number;
  err: number;
  total: number;
  /** Position angle of the motion, degrees east of north. */
  pa: number;
  /** Motion score S = √Δχ² of the moving model over the fixed one (2 degrees of freedom, so not a Gaussian σ). */
  sigma: number;
  /** Measured displacement first → last visit, arcsec. */
  shiftArcsec: number;
  /** Parallax estimate (mas) when 5+ visits pin it down to 3σ. */
  parallax: { value: number; err: number } | null;
  /** χ² per degree of freedom of the fixed and the moving model (after error rescaling). */
  chi2Fixed: number;
  chi2Linear: number;
}

export interface Phot {
  detector: string;
  epoch: number;
  flux: number;
  err: number;
}

export interface Candidate {
  id: number;
  x: number;
  y: number;
  ra: number;
  dec: number;
  snr: number;
  kind: Kind;
  labels: string[];
  saturated: boolean;
  visits: VisitPos[];
  motion: Motion | null;
  phot: Phot[];
  /** Per-visit brightness relative to the mean, averaged over detectors (for a sparkline). */
  trend: { epoch: number; label: string; rel: number }[];
  variableIn: string[];
  bandsSeen: string[];
  /** AB colour D1 − D6; null when either is not measured. */
  colour: number | null;
  gaia: { id: string; g: number | null; pmra: number | null; pmdec: number | null; dpm: number | null } | null;
  gaiaComplete: boolean;
  headline: string;
}

export interface CandidateResult {
  candidates: Candidate[];
  visits: number;
  counts: { moving: number; variable: number; red: number; unknown: number };
}

// ---------------------------------------------------------------- small linear least squares

/** Weighted least squares: minimise Σ wᵢ (yᵢ − Aᵢ·p)². Returns p, its covariance and χ². */
export function wls(A: number[][], y: number[], w: number[]): { p: number[]; cov: number[][]; chi2: number } | null {
  const k = A[0]?.length ?? 0;
  const N = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  A.forEach((row, i) => {
    for (let r = 0; r < k; r++) {
      b[r] += w[i] * row[r] * y[i];
      for (let c = 0; c < k; c++) N[r][c] += w[i] * row[r] * row[c];
    }
  });
  const cov = invert(N);
  if (!cov) return null;
  const p = cov.map((row) => row.reduce((s, v, c) => s + v * b[c], 0));
  const chi2 = A.reduce((s, row, i) => s + w[i] * (y[i] - row.reduce((t, v, c) => t + v * p[c], 0)) ** 2, 0);
  return { p, cov, chi2 };
}

function invert(M: number[][]): number[][] | null {
  const n = M.length;
  const a = M.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

// ---------------------------------------------------------------- pixels

function robustStats(px: Float32Array): { med: number; sigma: number } {
  const [q25, med, q75] = quantiles(px, [0.25, 0.5, 0.75]);
  return { med, sigma: (q75 - q25) / 1.349 };
}

/** n_exp-weighted mean of the visit frames (NaN-aware): the reference image sources are found on. */
export function referenceStack(frames: DecodedFrame[], weights: number[]): Float32Array {
  const n = frames[0].pixels.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let sw = 0;
    frames.forEach((f, k) => {
      const v = f.pixels[i];
      if (Number.isFinite(v)) { s += weights[k] * v; sw += weights[k]; }
    });
    out[i] = sw > 0 ? s / sw : NaN;
  }
  return out;
}

/** Local maxima ≥ DETECT_SIGMA above the median, away from the edge, brightest first, at least 2.5 px apart. */
export function detect(img: Float32Array, n: number): { x: number; y: number; snr: number }[] {
  const { med, sigma } = robustStats(img);
  if (!(sigma > 0)) return [];
  const peaks: { x: number; y: number; snr: number }[] = [];
  for (let y = 3; y < n - 3; y++) {
    for (let x = 3; x < n - 3; x++) {
      const v = img[y * n + x];
      if (!Number.isFinite(v) || v - med < DETECT_SIGMA * sigma) continue;
      let top = true;
      for (let dy = -1; dy <= 1 && top; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && img[(y + dy) * n + x + dx] > v) { top = false; break; }
        }
      }
      if (top) peaks.push({ x, y, snr: (v - med) / sigma });
    }
  }
  peaks.sort((a, b) => b.snr - a.snr);
  const kept: typeof peaks = [];
  for (const p of peaks) {
    if (kept.every((k) => Math.hypot(k.x - p.x, k.y - p.y) >= 2.5)) kept.push(p);
    if (kept.length >= MAX_SOURCES) break;
  }
  return kept;
}

/** Aperture photometry at (x, y): radius AP_R, background = median of the AP_R..ANN_OUT annulus (µJy). */
export function aperture(px: Float32Array, n: number, x: number, y: number): { flux: number; err: number } | null {
  const ann: number[] = [];
  const ap: number[] = [];
  const xi = Math.round(x);
  const yi = Math.round(y);
  for (let j = yi - ANN_OUT; j <= yi + ANN_OUT; j++) {
    for (let i = xi - ANN_OUT; i <= xi + ANN_OUT; i++) {
      const r = Math.hypot(i - x, j - y);
      if (r > ANN_OUT) continue;
      if (i < 0 || j < 0 || i >= n || j >= n) { if (r <= AP_R) return null; continue; }
      const v = px[j * n + i];
      if (r <= AP_R) {
        if (!Number.isFinite(v)) return null; // masked core (saturated): no honest flux
        ap.push(v);
      } else if (r >= ANN_IN && Number.isFinite(v)) ann.push(v);
    }
  }
  if (ann.length < 8 || !ap.length) return null;
  ann.sort((a, b) => a - b);
  const B = ann[Math.floor(ann.length / 2)];
  const q = (f: number) => ann[Math.min(ann.length - 1, Math.round(f * (ann.length - 1)))];
  const sAnn = (q(0.75) - q(0.25)) / 1.349;
  const flux = MJYSR_TO_UJY * ap.reduce((s, v) => s + v - B, 0);
  const err = MJYSR_TO_UJY * sAnn * Math.sqrt(ap.length * (1 + ap.length / ann.length));
  return { flux, err: Math.max(err, 1e-6) };
}

const abMag = (ujy: number) => 23.9 - 2.5 * Math.log10(ujy);

// ---------------------------------------------------------------- astrometry

/** Parallax factors (Δα*, Δδ per unit parallax) for a star at (ra, dec) seen from Earth on mjd. */
export function parallaxFactors(ra: number, dec: number, mjd: number): [number, number] {
  const [X, Y, Z] = earthHelio(mjd);
  const a = (ra * Math.PI) / 180;
  const d = (dec * Math.PI) / 180;
  return [X * Math.sin(a) - Y * Math.cos(a), X * Math.cos(a) * Math.sin(d) + Y * Math.sin(a) * Math.sin(d) - Z * Math.cos(d)];
}

interface Track { visits: VisitPos[]; saturated: boolean }

function measureTrack(seed: { x: number; y: number }, visits: { meta: FrameMeta; d: DecodedFrame; bg: number; sigma: number }[],
                      n: number): Track {
  const out: VisitPos[] = [];
  let saturated = false;
  let at = { x: seed.x, y: seed.y };
  for (const v of visits) {
    const c1 = centroid(v.d.pixels, n, at.x, at.y, 3, v.bg, v.sigma);
    if (!c1) continue;
    const c = centroid(v.d.pixels, n, c1.x, c1.y, 2, v.bg, v.sigma) ?? c1;
    const core = Math.round(c.y) * n + Math.round(c.x);
    if (v.d.layer[core] & LAYER_SATURATED) saturated = true;
    if (c.snr < DETECT_SIGMA || Math.hypot(c.x - seed.x, c.y - seed.y) > 4) continue;
    out.push({ epoch: v.meta.epoch, label: v.meta.epoch_label, year: mjdToYear(v.meta.t_mid), x: c.x, y: c.y,
               sigma: Math.max(PSF_SIGMA_PX / c.snr, POS_FLOOR_PX) });
    at = { x: c.x, y: c.y };
  }
  return { visits: out, saturated };
}

/** Removes the per-visit shift shared by the whole field (alignment jitter): the median residual of all sources. */
function differential(tracks: Track[]): void {
  const full = tracks.filter((t) => t.visits.length >= 3);
  if (full.length < 5) return;
  const byEpoch = new Map<number, { dx: number[]; dy: number[] }>();
  for (const t of full) {
    const mx = t.visits.reduce((s, v) => s + v.x, 0) / t.visits.length;
    const my = t.visits.reduce((s, v) => s + v.y, 0) / t.visits.length;
    for (const v of t.visits) {
      const e = byEpoch.get(v.epoch) ?? { dx: [], dy: [] };
      e.dx.push(v.x - mx); e.dy.push(v.y - my);
      byEpoch.set(v.epoch, e);
    }
  }
  const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const shift = new Map<number, [number, number]>();
  byEpoch.forEach((e, k) => { if (e.dx.length >= 5) shift.set(k, [median(e.dx), median(e.dy)]); });
  for (const t of tracks) {
    for (const v of t.visits) {
      const s = shift.get(v.epoch);
      if (s) { v.x -= s[0]; v.y -= s[1]; }
    }
  }
}

/** Fits position = p₀ + μ (t − t̄) on each axis (and a parallax term with 5+ visits); motion in mas/yr. */
export function fitMotion(visits: VisitPos[], grid: GridWcs, ra: number, dec: number, mjds: Map<number, number>,
                          scale = 1): Motion | null {
  if (visits.length < 3) return null;
  // Tangent-plane offsets in mas: ξ east, η north (the grid is TAN, so they are linear in pixels).
  const mas = (deg: number) => deg * 3.6e6;
  const xi = visits.map((v) => mas(v.x * grid.cdelt[0]));
  const eta = visits.map((v) => mas(v.y * grid.cdelt[1]));
  const w = visits.map((v) => 1 / mas(scale * v.sigma * Math.abs(grid.cdelt[1])) ** 2);
  const tbar = visits.reduce((s, v, i) => s + w[i] * v.year, 0) / w.reduce((s, x) => s + x, 0);
  const dt = visits.map((v) => v.year - tbar);
  const lin = (y: number[]) => wls(dt.map((t) => [1, t]), y, w);
  const fixed = (y: number[]) => wls(dt.map(() => [1]), y, w);
  const fx = lin(xi), fy = lin(eta), f0x = fixed(xi), f0y = fixed(eta);
  if (!fx || !fy || !f0x || !f0y) return null;
  const pmra = fx.p[1], pmdec = fy.p[1];
  const err = Math.sqrt((fx.cov[1][1] + fy.cov[1][1]) / 2);
  const dchi2 = Math.max(0, f0x.chi2 + f0y.chi2 - fx.chi2 - fy.chi2);
  const span = Math.max(...dt) - Math.min(...dt);
  let parallax: Motion["parallax"] = null;
  if (visits.length >= 5) {
    // Joint fit of ξ and η: [ξ₀, η₀, μα*, μδ, ϖ].
    const A: number[][] = [];
    const y: number[] = [];
    const ww: number[] = [];
    visits.forEach((v, i) => {
      const [fa, fd] = parallaxFactors(ra, dec, mjds.get(v.epoch) ?? 0);
      A.push([1, 0, dt[i], 0, fa]); y.push(xi[i]); ww.push(w[i]);
      A.push([0, 1, 0, dt[i], fd]); y.push(eta[i]); ww.push(w[i]);
    });
    const f = wls(A, y, ww);
    if (f) {
      const e = Math.sqrt(f.cov[4][4]);
      if (e > 0 && f.p[4] / e >= 3) parallax = { value: f.p[4], err: e };
    }
  }
  const total = Math.hypot(pmra, pmdec);
  return {
    pmra, pmdec, err, total,
    pa: ((Math.atan2(pmra, pmdec) * 180) / Math.PI + 360) % 360,
    sigma: Math.sqrt(dchi2),
    shiftArcsec: (total * span) / 1000,
    parallax,
    chi2Fixed: (f0x.chi2 + f0y.chi2) / (2 * visits.length - 2),
    chi2Linear: (fx.chi2 + fy.chi2) / Math.max(1, 2 * visits.length - 4),
  };
}

// ---------------------------------------------------------------- the whole field

const fmtPm = (masyr: number) => (masyr >= 1000 ? `${(masyr / 1000).toFixed(1)}″/yr` : `${Math.round(masyr)} mas/yr`);

export function findCandidates(frames: FrameMeta[], decoded: Map<string, DecodedFrame>, grid: GridWcs,
                               gaia: GaiaSource[] | null): CandidateResult {
  const n = grid.n;
  const withStats = (meta: FrameMeta, d: DecodedFrame) => {
    const st = robustStats(d.pixels);
    return { meta, d, bg: st.med, sigma: st.sigma };
  };
  const broad = frames
    .filter((f) => f.product === "broadband" && decoded.has(f.key))
    .sort((a, b) => a.epoch - b.epoch)
    .map((meta) => withStats(meta, decoded.get(meta.key)!));
  const empty: CandidateResult = { candidates: [], visits: broad.length, counts: { moving: 0, variable: 0, red: 0, unknown: 0 } };
  if (!broad.length) return empty;
  const perDet = frames.filter((f) => f.product === "per_detector" && decoded.has(f.key));

  // Long-wavelength visits (D5 + D6 averaged): cold brown dwarfs are invisible in the combined image.
  const redVisits = broad.map((v) => {
    const parts = perDet.filter((f) => f.epoch === v.meta.epoch && (f.detector === "D5" || f.detector === "D6"));
    if (!parts.length) return null;
    const px = referenceStack(parts.map((f) => decoded.get(f.key)!), parts.map((f) => Math.max(1, f.n_exp)));
    const meta = { ...v.meta, n_exp: parts.reduce((s, f) => s + f.n_exp, 0) };
    return withStats(meta, { header: v.d.header, pixels: px, layer: v.d.layer });
  }).filter((v): v is NonNullable<typeof v> => !!v);

  const weightsOf = (vs: typeof broad) => vs.map((v) => Math.max(1, v.meta.n_exp));
  const peaksBroad = detect(referenceStack(broad.map((v) => v.d), weightsOf(broad)), n).map((p) => ({ ...p, red: false }));
  const peaksRed = redVisits.length ? detect(referenceStack(redVisits.map((v) => v.d), weightsOf(redVisits)), n) : [];
  const peaks = [...peaksBroad];
  for (const p of peaksRed) {
    // Kept unless it sits on a combined-image source: a brown dwarf can lie a pixel or two from a background star.
    if (peaks.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 1.2)) peaks.push({ ...p, red: true });
  }

  const astroBroad = broad.filter((v) => v.meta.n_exp >= MIN_EXP);
  const astroRed = redVisits.filter((v) => v.meta.n_exp >= MIN_EXP);
  const mjds = new Map(broad.map((v) => [v.meta.epoch, v.meta.t_mid]));
  const tracks = peaks.map((p) => measureTrack(p, p.red ? astroRed : astroBroad, n));
  differential(tracks);

  // Merge peaks that converged on the same source (e.g. a saturated core split in two); keep the brighter.
  const keep = peaks.map(() => true);
  const meanPos = tracks.map((t, i) => (t.visits.length
    ? [t.visits.reduce((s, v) => s + v.x, 0) / t.visits.length, t.visits.reduce((s, v) => s + v.y, 0) / t.visits.length]
    : [peaks[i].x, peaks[i].y]) as [number, number]);
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      if (!keep[i] || !keep[j]) continue;
      const d = Math.hypot(meanPos[i][0] - meanPos[j][0], meanPos[i][1] - meanPos[j][1]);
      // Same images: closer than 1.5 px is one source. Combined vs long-wavelength: only near-identical positions.
      if (peaks[i].red === peaks[j].red ? d < 1.5 : d < 0.8) keep[peaks[i].red && !peaks[j].red ? i : peaks[j].red && !peaks[i].red ? j : peaks[i].snr >= peaks[j].snr ? j : i] = false;
    }
  }
  const live = peaks.map((_, i) => i).filter((i) => keep[i]);

  // Astrometric error scale from the ensemble: most sources do not move, so their fixed-model χ²_ν should be ~1.
  const radec = (i: number) => pixelToWorld(grid, meanPos[i][0], meanPos[i][1]);
  const rawChi = live.map((i) => fitMotion(tracks[i].visits, grid, ...radec(i), mjds)?.chi2Fixed)
    .filter((c): c is number => c !== undefined && Number.isFinite(c));
  const median = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 1; };
  const astroScale = rawChi.length >= 5 ? Math.sqrt(Math.max(1, median(rawChi))) : 1;

  // Photometry on every per-detector visit frame, at the source's position on that visit when measured.
  const photOf = (i: number): Phot[] => {
    const out: Phot[] = [];
    for (const f of perDet) {
      const at = tracks[i].visits.find((v) => v.epoch === f.epoch) ?? { x: meanPos[i][0], y: meanPos[i][1] };
      const m = aperture(decoded.get(f.key)!.pixels, n, at.x, at.y);
      if (m) out.push({ detector: f.detector, epoch: f.epoch, flux: m.flux, err: m.err });
    }
    return out;
  };
  const phots = new Map(live.map((i) => [i, photOf(i)]));

  // Ensemble photometry: a zero point per detector and visit (median of F / F̄ over well-measured sources),
  // then an error scale per detector from the median χ²_ν, so only genuine changes stand out.
  const zp = new Map<string, number>();
  const photScale = new Map<string, number>();
  for (const det of DETECTORS) {
    const series = live.map((i) => phots.get(i)!.filter((q) => q.detector === det))
      .filter((pts) => pts.length >= 3 && pts.every((q) => q.flux > 10 * q.err));
    if (series.length < 5) continue;
    const ratios = new Map<number, number[]>();
    for (const pts of series) {
      const mean = pts.reduce((s, q) => s + q.flux, 0) / pts.length;
      for (const q of pts) ratios.set(q.epoch, [...(ratios.get(q.epoch) ?? []), q.flux / mean]);
    }
    ratios.forEach((r, e) => zp.set(`${det}:${e}`, median(r)));
    const chis = series.map((pts) => {
      const c = pts.map((q) => ({ f: q.flux / (zp.get(`${det}:${q.epoch}`) ?? 1), e: q.err }));
      const w = c.map((q) => 1 / q.e ** 2);
      const m = c.reduce((s, q, k) => s + w[k] * q.f, 0) / w.reduce((s, v) => s + v, 0);
      return c.reduce((s, q, k) => s + w[k] * (q.f - m) ** 2, 0) / (c.length - 1);
    });
    photScale.set(det, Math.sqrt(Math.max(1, median(chis))));
  }

  const gaiaComplete = !!gaia && gaia.length < GAIA_CAP;
  const years = broad.map((v) => mjdToYear(v.meta.t_mid));
  const tMean = years.reduce((s, y) => s + y, 0) / years.length;

  // Gaia, one to one: each Gaia star (moved to the mean epoch) belongs to the nearest source within GAIA_MATCH_PX,
  // so a faint neighbour of a catalogued star is not mistaken for it.
  const gaiaOf = new Map<number, { s: GaiaSource; r: number }>();
  for (const s of gaia ?? []) {
    const [sra, sdec] = propagate(s.ra, s.dec, s.pmra ?? 0, s.pmdec ?? 0, tMean - GAIA_EPOCH);
    const [gx, gy] = worldToPixel(grid, sra, sdec);
    let best = -1;
    let bestR = GAIA_MATCH_PX;
    for (const i of live) {
      const r = Math.hypot(gx - meanPos[i][0], gy - meanPos[i][1]);
      if (r < bestR) { bestR = r; best = i; }
    }
    if (best >= 0 && bestR < (gaiaOf.get(best)?.r ?? Infinity)) gaiaOf.set(best, { s, r: bestR });
  }

  const candidates: Candidate[] = live.map((i, id) => {
    const p = peaks[i];
    const tr = tracks[i];
    const [x, y] = meanPos[i];
    const [ra, dec] = pixelToWorld(grid, x, y);
    // Another source measured on the same images within 3 px pulls the centroid.
    const blended = live.some((j) => j !== i && peaks[j].red === p.red && Math.hypot(meanPos[j][0] - x, meanPos[j][1] - y) < 3);
    const motion = fitMotion(tr.visits, grid, ra, dec, mjds, astroScale);
    const consistent = !!motion && motion.chi2Linear <= 4;
    const significant = !!motion && motion.sigma >= MOVE_SIGMA && motion.shiftArcsec / PIXEL_ARCSEC >= MOVE_MIN_PX;

    const g = gaiaOf.get(i)?.s;
    const match: Candidate["gaia"] = g ? {
      id: g.source_id, g: g.g, pmra: g.pmra, pmdec: g.pmdec,
      dpm: motion && g.pmra !== null && g.pmdec !== null
        ? Math.hypot(motion.pmra - g.pmra, motion.pmdec - g.pmdec) / Math.max(motion.err, 1) : null,
    } : null;
    const gaiaAgrees = !!match && match.dpm !== null && match.dpm <= 3;
    // A saturated core or a close neighbour can drag the centroid; trust such motion only when Gaia confirms it.
    // Gaia's own proper motion outranks ours: a catalogued star whose Gaia motion disagrees is a measurement artefact.
    const gaiaDisagrees = !!match && match.dpm !== null && match.dpm > 3;
    const moving = significant && !gaiaDisagrees && ((consistent && !tr.saturated && !blended) || gaiaAgrees);

    const phot = phots.get(i)!.map((q) => {
      const z = zp.get(`${q.detector}:${q.epoch}`) ?? 1;
      return { ...q, flux: q.flux / z, err: (q.err / z) * (photScale.get(q.detector) ?? 1) };
    });

    // Variability: χ²_ν ≥ VAR_CHI2 and ≥ VAR_AMP peak-to-peak in two detectors that agree on the brightest visit.
    const variableIn: string[] = [];
    const brightest: Record<string, number> = {};
    const bandsSeen: string[] = [];
    const meanFlux: Record<string, { f: number; e: number }> = {};
    for (const det of DETECTORS) {
      const pts = phot.filter((q) => q.detector === det);
      if (!pts.length) continue;
      const w = pts.map((q) => 1 / q.err ** 2);
      const sw = w.reduce((s, v) => s + v, 0);
      const mean = pts.reduce((s, q, k) => s + w[k] * q.flux, 0) / sw;
      meanFlux[det] = { f: mean, e: 1 / Math.sqrt(sw) };
      if (mean > 3 / Math.sqrt(sw)) bandsSeen.push(det);
      if (pts.length < 3 || significant || blended || !(mean > 0)) continue;
      const chi2nu = pts.reduce((s, q, k) => s + w[k] * (q.flux - mean) ** 2, 0) / (pts.length - 1);
      const fl = pts.map((q) => q.flux);
      const amp = (Math.max(...fl) - Math.min(...fl)) / mean;
      if (chi2nu >= VAR_CHI2 && amp >= VAR_AMP) {
        variableIn.push(det);
        brightest[det] = pts.reduce((b, q) => (q.flux > b.flux ? q : b)).epoch;
      }
    }
    const peakEpochs = variableIn.map((d) => brightest[d]);
    const variable = variableIn.length >= 2 && peakEpochs.some((e, k) => peakEpochs.indexOf(e) !== k);

    const d1 = meanFlux.D1, d6 = meanFlux.D6;
    const colour = d1 && d6 && d1.f > 0 && d6.f > 0 ? abMag(d1.f) - abMag(d6.f) : null;
    const faintBlue = ["D1", "D2"].every((d) => !meanFlux[d] || meanFlux[d].f < 3 * meanFlux[d].e);
    // Found in the D5 + D6 image but not in the combined one is itself a red colour.
    const red = p.red || !tr.saturated && ((colour !== null && colour >= RED_COLOUR)
             || ((bandsSeen.includes("D5") || bandsSeen.includes("D6")) && faintBlue && !!(meanFlux.D1 || meanFlux.D2)));

    const kind: Kind = moving ? "moving" : variable ? "variable" : red ? "red" : "steady";
    const labels: string[] = [];
    if (moving) labels.push("Moving");
    if (variable) labels.push("Variable");
    if (red) labels.push("Very red");
    if (!match && gaia) labels.push(gaiaComplete ? "Not in Gaia" : "Gaia list incomplete");
    if (tr.saturated) labels.push("Saturated core");
    if (blended) labels.push("Blended");
    const unexplained = (moving && !gaiaAgrees) || (!match && gaiaComplete && (red || variable));
    if (unexplained) labels.push("Needs follow-up");

    // Per-visit brightness relative to each detector's mean, averaged over detectors.
    const trend = broad.map((v) => {
      const rel = phot.filter((q) => q.epoch === v.meta.epoch && meanFlux[q.detector]?.f > 0)
        .map((q) => q.flux / meanFlux[q.detector].f);
      return { epoch: v.meta.epoch, label: v.meta.epoch_label, rel: rel.length ? rel.reduce((s, r) => s + r, 0) / rel.length : NaN };
    });

    const parts: string[] = [];
    if (moving && motion) {
      parts.push(`Moving ${fmtPm(motion.total)} toward PA ${Math.round(motion.pa)}° (score ${motion.sigma.toFixed(1)})`);
      if (match) parts.push(gaiaAgrees ? "matches Gaia" : "Gaia has no motion for it");
      else if (gaia) parts.push(gaiaComplete ? "not in Gaia" : "Gaia list incomplete");
    } else if (variable) {
      parts.push(`Variable in ${variableIn.join(", ")}`);
    } else if (red) {
      parts.push(p.red ? "Found only at long wavelengths (D5–D6)"
        : colour !== null ? `Very red: D1 − D6 = ${colour.toFixed(1)} mag` : "Seen only at long wavelengths");
    } else if (significant && gaiaDisagrees) {
      parts.push(`Shift (score ${motion!.sigma.toFixed(1)}) disagrees with Gaia's motion: likely blending or an artefact`);
    } else if (significant && !consistent) {
      parts.push("Position jumps between visits (not a steady motion)");
    } else if (significant) {
      parts.push(`Shift (score ${motion!.sigma.toFixed(1)}) not trusted: ${tr.saturated ? "saturated core" : "close neighbour"}`);
    } else {
      parts.push(motion ? `Steady (motion score ${motion.sigma.toFixed(1)})` : "Steady");
    }
    if (!moving && match) parts.push(`Gaia G ${match.g?.toFixed(1) ?? "?"}`);
    if (!moving && !match && gaia) parts.push(gaiaComplete ? "not in Gaia" : "Gaia list incomplete");

    return { id, x, y, ra, dec, snr: p.snr, kind, labels, saturated: tr.saturated, visits: tr.visits, motion, phot, trend,
             variableIn: variable ? variableIn : [], bandsSeen, colour, gaia: match, gaiaComplete, headline: parts.join(" · ") };
  });

  const rank = (c: Candidate) => {
    const followUp = c.labels.includes("Needs follow-up") ? 0 : 1;
    const k = c.kind === "moving" ? 0 : c.kind === "variable" ? 1 : c.kind === "red" ? 2 : 3;
    return (k * 2 + followUp) * 1000 - Math.min(c.snr, 999);
  };
  candidates.sort((a, b) => rank(a) - rank(b));
  return {
    candidates,
    visits: astroBroad.length,
    counts: {
      moving: candidates.filter((c) => c.kind === "moving").length,
      variable: candidates.filter((c) => c.labels.includes("Variable")).length,
      red: candidates.filter((c) => c.labels.includes("Very red")).length,
      unknown: candidates.filter((c) => c.labels.includes("Not in Gaia")).length,
    },
  };
}
