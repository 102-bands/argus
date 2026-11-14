import { describe, expect, it } from "vitest";
import type { FrameMeta, GaiaSource } from "../api";
import type { DecodedFrame } from "../frame";
import { aperture, findCandidates, fitMotion, parallaxFactors, wls } from "../candidates";
import { GAIA_EPOCH, MJYSR_TO_UJY, pixelToWorld, type GridWcs } from "../physics";

const N = 64;
const GRID: GridWcs = { crval: [100, 10], crpix: [32.5, 32.5], cdelt: [-6.15 / 3600, 6.15 / 3600], n: N };
const YEARS = [2025.6, 2026.1, 2026.6, 2027.1, 2027.6];
const DETS = ["D1", "D2", "D3", "D4", "D5", "D6"];
const yearToMjd = (y: number) => 51544.5 + (y - 2000) * 365.25;

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

interface Src { x: number; y: number; vx?: number; amp: (det: string, visit: number) => number }

/** Gaussian stars (σ = 1 px) plus white noise, one frame per detector per visit and a broadband mean. */
function field(sources: Src[], noise = 0.01) {
  const r = rng(42);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const frames: FrameMeta[] = [];
  const decoded = new Map<string, DecodedFrame>();
  YEARS.forEach((yr, v) => {
    const dets: Float32Array[] = [];
    for (const det of [...DETS, "all"]) {
      const px = new Float32Array(N * N);
      if (det === "all") {
        for (let i = 0; i < px.length; i++) px[i] = dets.reduce((s, d) => s + d[i], 0) / dets.length;
      } else {
        for (let i = 0; i < px.length; i++) px[i] = noise * gauss();
        for (const s of sources) {
          const cx = s.x + (s.vx ?? 0) * (yr - YEARS[0]);
          const a = s.amp(det, v);
          for (let y = Math.floor(s.y) - 5; y <= s.y + 5; y++) {
            for (let x = Math.floor(cx) - 5; x <= cx + 5; x++) {
              if (x >= 0 && y >= 0 && x < N && y < N) px[y * N + x] += a * Math.exp(-((x - cx) ** 2 + (y - s.y) ** 2) / 2);
            }
          }
        }
        dets.push(px);
      }
      const key = `${det}-${v}`;
      const broadband = det === "all";
      frames.push({ key, product: broadband ? "broadband" : "per_detector", detector: broadband ? "all" : det, epoch: v,
                    epoch_label: `V${v}`, t_mid: yearToMjd(yr), lambda_um: 1, lambda_range: [1, 1], n_exp: 10,
                    flags: { saturated: false, n_saturated: 0 } });
      decoded.set(key, { header: {} as DecodedFrame["header"], pixels: px, layer: new Uint8Array(N * N) });
    }
  });
  return { frames, decoded };
}

const flat = (a: number) => () => a;

function scene() {
  const nodes: [number, number][] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) nodes.push([8 + 12 * i, 8 + 12 * j]);
  const special = {
    mover: nodes[12],
    variable: nodes[6],
    oneBand: nodes[8],
    red: nodes[16],
  };
  const sources: Src[] = [
    { x: special.mover[0] - 1.2, y: special.mover[1], vx: 1.2, amp: flat(1.5) },
    { x: special.variable[0], y: special.variable[1], amp: (d, v) => (d === "D3" || d === "D4" ? 1 + 0.4 * Math.sin(v * 1.3) : 1) },
    { x: special.oneBand[0], y: special.oneBand[1], amp: (d, v) => (d === "D2" ? 1 + 0.4 * Math.sin(v * 1.3) : 1) },
    { x: special.red[0], y: special.red[1], amp: (d) => (d === "D5" || d === "D6" ? 1.2 : 0) },
  ];
  const statics = nodes.filter((n) => !Object.values(special).includes(n));
  statics.forEach(([x, y]) => sources.push({ x, y, amp: flat(1) }));
  // Gaia knows every source except the mover and the red one, at its true position (no motion).
  const gaia: GaiaSource[] = [special.variable, special.oneBand, ...statics].map(([x, y], i) => {
    const [ra, dec] = pixelToWorld(GRID, x, y);
    return { source_id: String(i), ra, dec, pmra: 0, pmdec: 0, parallax: null, g: 12 };
  });
  return { special, sources, gaia, statics };
}

const near = (c: { x: number; y: number }, p: [number, number], r = 2) => Math.hypot(c.x - p[0], c.y - p[1]) < r;

describe("candidates", () => {
  const { special, sources, gaia, statics } = scene();
  const { frames, decoded } = field(sources);
  const res = findCandidates(frames, decoded, GRID, gaia);
  const at = (p: [number, number]) => res.candidates.find((c) => near(c, p))!;

  it("finds every source", () => {
    expect(res.candidates.length).toBe(sources.length);
  });

  it("flags the mover with the right motion and no Gaia match", () => {
    const c = at(special.mover);
    expect(c.kind).toBe("moving");
    expect(c.labels).toContain("Not in Gaia");
    const truth = 1.2 * 6150; // mas/yr, westward (x grows to the west on a north-up, east-left grid)
    expect(Math.abs(c.motion!.total - truth)).toBeLessThan(2 * c.motion!.err + 50);
    expect(c.motion!.pmra).toBeLessThan(0);
    expect(Math.round(c.motion!.pa)).toBe(270);
    expect(res.candidates[0]).toBe(c); // unmatched movers first
  });

  it("calls no static star a mover", () => {
    for (const p of statics) expect(at(p).kind).not.toBe("moving");
  });

  it("needs two detectors that agree before calling a source variable", () => {
    expect(at(special.variable).labels).toContain("Variable");
    expect(at(special.variable).variableIn.sort()).toEqual(["D3", "D4"]);
    expect(at(special.oneBand).labels).not.toContain("Variable");
  });

  it("flags a source seen only at long wavelengths as very red", () => {
    const c = at(special.red);
    expect(c.labels).toContain("Very red");
    expect(c.bandsSeen).toEqual(["D5", "D6"]);
  });

  it("matches Gaia sources", () => {
    expect(at(statics[0]).gaia?.id).toBeDefined();
    expect(res.counts.unknown).toBe(2);
  });
});

describe("candidate maths", () => {
  it("weighted least squares recovers a line and its error", () => {
    const t = [-1, -0.5, 0, 0.5, 1];
    const f = wls(t.map((x) => [1, x]), t.map((x) => 3 + 2 * x), t.map(() => 4))!;
    expect(f.p[0]).toBeCloseTo(3, 9);
    expect(f.p[1]).toBeCloseTo(2, 9);
    expect(Math.sqrt(f.cov[1][1])).toBeCloseTo(0.5 / Math.sqrt(2.5), 9); // σ / √Σ(t − t̄)²
  });

  it("aperture photometry returns the Gaussian's flux in µJy", () => {
    const px = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) px[y * N + x] = 0.2 + Math.exp(-((x - 30) ** 2 + (y - 30) ** 2) / 2);
    const m = aperture(px, N, 30, 30)!;
    // The r ≤ 2 px aperture holds ~84 % of a σ = 1 px Gaussian's total 2π.
    expect(m.flux / (MJYSR_TO_UJY * 2 * Math.PI)).toBeGreaterThan(0.8);
    expect(m.flux / (MJYSR_TO_UJY * 2 * Math.PI)).toBeLessThan(0.9);
  });

  it("parallax factors swing by about ±1 over a year", () => {
    const f = Array.from({ length: 12 }, (_, m) => parallaxFactors(270, 0, yearToMjd(2026 + m / 12))[0]);
    expect(Math.max(...f)).toBeGreaterThan(0.9);
    expect(Math.min(...f)).toBeLessThan(-0.9);
  });

  it("fits a known proper motion", () => {
    const visits = YEARS.map((year, i) => ({ epoch: i, label: "", year, x: 10 - (year - 2026) * 2, y: 10, sigma: 0.05 }));
    const m = fitMotion(visits, GRID, 100, 10, new Map(YEARS.map((y, i) => [i, yearToMjd(y)])))!;
    expect(m.pmra).toBeCloseTo(2 * 6150, 0); // x falling = moving east on an east-left grid
    expect(m.pmdec).toBeCloseTo(0, 6);
    expect(m.sigma).toBeGreaterThan(50);
    expect(GAIA_EPOCH).toBe(2016);
  });
});
