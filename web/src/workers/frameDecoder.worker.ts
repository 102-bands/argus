/// <reference lib="webworker" />
// Decode + stretch + colour-map off the main thread (PRD §7.6, §10.4).
// Changing stretch or mode re-runs only render; frames are never refetched.
import { decodeFrame, type DecodedFrame } from "../lib/frame";

export type StretchKind = "asinh" | "linear" | "log" | "zscale";
export type RenderMode = "blink" | "diff" | "stack";

export type WorkerIn =
  | { type: "add"; key: string; buffer: ArrayBuffer }
  | { type: "clear" }
  | { type: "render"; id: number; keys: string[]; stretch: StretchKind; soft: number; mode: RenderMode; refKey: string | null };

export type WorkerOut =
  | { type: "added"; key: string; header: DecodedFrame["header"]; pixels: Float32Array; layer: Uint8Array }
  | { type: "error"; key: string; message: string }
  | { type: "rendered"; id: number; w: number; h: number; images: { key: string; rgba: ArrayBuffer }[]; lo: number; hi: number };

const frames = new Map<string, DecodedFrame>();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Brand signal colours: cyan = brighter now, magenta = brighter before (PRD §7.5, §9.4).
const CYAN = [0x22, 0xb8, 0xd8];
const MAGENTA = [0xe0, 0x4c, 0xf0];
const HATCH_A = [0x16, 0x16, 0x1d];
const HATCH_B = [0x22, 0x22, 0x2b];

function percentiles(values: Float32Array[], ps: number[]): number[] {
  let count = 0;
  for (const v of values) for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) count++;
  if (!count) return ps.map(() => 0);
  const all = new Float32Array(count);
  let j = 0;
  for (const v of values) for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) all[j++] = v[i];
  all.sort();
  return ps.map((p) => all[Math.min(count - 1, Math.max(0, Math.round((p / 100) * (count - 1))))]);
}

function mean(frs: Float32Array[]): Float32Array {
  const n = frs[0].length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (const f of frs) if (Number.isFinite(f[i])) { s += f[i]; c++; }
    out[i] = c ? s / c : NaN;
  }
  return out;
}

function makeScale(kind: StretchKind, lo: number, hi: number, soft: number): (x: number) => number {
  const span = Math.max(hi - lo, 1e-12);
  switch (kind) {
    case "linear":
    case "zscale":
      return (x) => (x - lo) / span;
    case "log": {
      const a = 1 / Math.max(soft, 1e-3);
      const d = Math.log10(1 + a);
      return (x) => Math.log10(1 + (a * Math.max(x - lo, 0)) / span) / d;
    }
    default: {
      const beta = span * Math.max(soft, 1e-3);
      const d = Math.asinh(span / beta);
      return (x) => Math.asinh((x - lo) / beta) / d;
    }
  }
}

function paint(data: Float32Array, w: number, h: number, colour: (x: number, out: number[]) => void): ArrayBuffer {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const c = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w; // FITS row 0 is south; draw north up
    for (let x = 0; x < w; x++) {
      const v = data[src + x];
      const o = (y * w + x) * 4;
      if (!Number.isFinite(v)) {
        const hc = (x + y) % 2 ? HATCH_A : HATCH_B;
        rgba[o] = hc[0]; rgba[o + 1] = hc[1]; rgba[o + 2] = hc[2];
      } else {
        colour(v, c);
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2];
      }
      rgba[o + 3] = 255;
    }
  }
  return rgba.buffer;
}

function render(msg: Extract<WorkerIn, { type: "render" }>): WorkerOut {
  const list = msg.keys.map((k) => frames.get(k)).filter((f): f is DecodedFrame => !!f);
  if (!list.length) return { type: "rendered", id: msg.id, w: 0, h: 0, images: [], lo: 0, hi: 1 };
  const { w, h } = list[0].header;

  if (msg.mode === "diff") {
    const ref = (msg.refKey && frames.get(msg.refKey)) || list[0];
    // Subtract each frame's sky median first: residual zodiacal light differs between visits and
    // would otherwise tint the whole difference image.
    const sky = (px: Float32Array) => percentiles([px], [50])[0];
    const refSky = sky(ref.pixels);
    const diffs = list.map((f) => {
      const s = sky(f.pixels);
      return f.pixels.map((v, i) => v - s - (ref.pixels[i] - refSky));
    });
    const [lim] = percentiles(diffs.map((d) => d.map(Math.abs)), [99.5]);
    const L = Math.max(lim, 1e-12);
    const images = list.map((f, i) => ({
      key: f.header.key,
      rgba: paint(diffs[i], w, h, (v, out) => {
        const t = Math.min(Math.abs(v) / L, 1) ** 0.6;
        const col = v >= 0 ? CYAN : MAGENTA;
        out[0] = col[0] * t; out[1] = col[1] * t; out[2] = col[2] * t;
      }),
    }));
    return { type: "rendered", id: msg.id, w, h, images, lo: -L, hi: L };
  }

  const sources = msg.mode === "stack" ? [mean(list.map((f) => f.pixels))] : list.map((f) => f.pixels);
  let lo: number;
  let hi: number;
  if (msg.stretch === "zscale") {
    const [q25, med, q75] = percentiles(sources, [25, 50, 75]);
    const sigma = (q75 - q25) / 1.349;
    lo = med - 2.5 * sigma;
    hi = med + 10 * sigma;
  } else {
    // Shared limits across every frame, so brightness never flickers for no reason (PRD §7.6).
    // The black point sits ~1σ below the sky median, not at the 0.5th percentile: with mostly-empty
    // fields that percentile is deep in the noise and leaves the sky mid-grey.
    const [p05, q25, med, q75, p995] = percentiles(sources, [0.5, 25, 50, 75, 99.5]);
    const sigma = (q75 - q25) / 1.349;
    lo = Math.max(p05, med - sigma);
    hi = p995;
  }
  const scale = makeScale(msg.stretch, lo, hi, msg.soft);
  const grey = (v: number, out: number[]) => {
    const g = Math.min(Math.max(scale(v), 0), 1) * 255;
    out[0] = g; out[1] = g; out[2] = g;
  };
  const keys = msg.mode === "stack" ? ["stack"] : list.map((f) => f.header.key);
  const images = sources.map((s, i) => ({ key: keys[i], rgba: paint(s, w, h, grey) }));
  return { type: "rendered", id: msg.id, w, h, images, lo, hi };
}

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const msg = e.data;
  if (msg.type === "clear") {
    frames.clear();
  } else if (msg.type === "add") {
    try {
      const f = decodeFrame(msg.buffer);
      f.header.key = msg.key;
      frames.set(msg.key, f);
      const out: WorkerOut = { type: "added", key: msg.key, header: f.header, pixels: f.pixels.slice(), layer: f.layer.slice() };
      ctx.postMessage(out);
    } catch (err) {
      ctx.postMessage({ type: "error", key: msg.key, message: String(err) } satisfies WorkerOut);
    }
  } else if (msg.type === "render") {
    const out = render(msg);
    if (out.type === "rendered") ctx.postMessage(out, out.images.map((i) => i.rgba));
  }
};
