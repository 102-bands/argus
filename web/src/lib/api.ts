// Data access: static presets first, then the live API (PRD §6.2, §9.3).
import type { GridWcs } from "./physics";

export const API_BASE: string = import.meta.env.VITE_API_BASE || "/api";

export interface Target {
  id: string;
  name: string;
  ra: number;
  dec: number;
  size: number;
  band: string;
  notes: string;
  pmra: number;
  pmdec: number;
}

export interface Epoch {
  id: number;
  label: string;
  t_start: number;
  t_end: number;
  n_by_detector: Record<string, number>;
}

export interface FrameMeta {
  key: string;
  product: "broadband" | "per_detector";
  detector: string;
  epoch: number;
  epoch_label: string;
  t_mid: number;
  lambda_um: number;
  lambda_range: [number, number];
  n_exp: number;
  flags: { saturated: boolean; n_saturated: number };
}

export interface PhotPoint {
  mjd: number;
  detector: string;
  lambda_um: number;
  flux_ujy: number;
  err: number;
  saturated: boolean;
  epoch: number;
}

export interface GaiaSource {
  source_id: string;
  ra: number;
  dec: number;
  pmra: number | null;
  pmdec: number | null;
  parallax: number | null;
  g: number | null;
}

export interface Manifest {
  key: string;
  ra: number;
  dec: number;
  size_arcmin: number;
  n: number;
  collections: string[];
  release_marker: string;
  pipeline_version: number;
  grid: GridWcs;
  epochs: Epoch[];
  frames: FrameMeta[];
  photometry: PhotPoint[];
  n_exposures: number;
  target?: Target;
  gaia?: GaiaSource[];
}

export interface Problem {
  title: string;
  detail?: string;
  status: number;
}

export class ApiError extends Error {
  constructor(public problem: Problem) {
    super(problem.title);
  }
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let p: Problem = { title: r.statusText || "Request failed", status: r.status };
    try {
      p = { ...p, ...(await r.json()) };
    } catch {
      // not JSON
    }
    throw new ApiError(p);
  }
  return r.json() as Promise<T>;
}

export async function loadPresetIndex(): Promise<Target[]> {
  try {
    return await json<Target[]>(await fetch("/presets/index.json"));
  } catch {
    return json<Target[]>(await fetch(`${API_BASE}/targets`));
  }
}

export async function loadPresetManifest(id: string): Promise<Manifest | null> {
  try {
    const r = await fetch(`/presets/${encodeURIComponent(id)}/manifest.json`);
    if (!r.ok || !(r.headers.get("content-type") || "").includes("json")) return null;
    return (await r.json()) as Manifest;
  } catch {
    return null;
  }
}

export function frameUrl(key: string, presetId: string | null): string {
  return presetId ? `/presets/${presetId}/frames/${key}.bin` : `${API_BASE}/frame/${key}`;
}

export async function fetchFrame(key: string, presetId: string | null, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(frameUrl(key, presetId), { signal });
  if (!r.ok) throw new ApiError({ title: "Frame missing", status: r.status });
  return r.arrayBuffer();
}

export type BlinkStart =
  | { kind: "cached"; manifest: Manifest }
  | { kind: "job"; jobId: string; manifestKey: string; framesExpected: number };

export async function startBlink(ra: number, dec: number, size: number, signal?: AbortSignal): Promise<BlinkStart> {
  const r = await fetch(`${API_BASE}/blink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ra, dec, size_arcmin: size, detectors: ["all"], products: ["broadband", "per_detector"] }),
    signal,
  });
  if (r.status === 202) {
    const b = await r.json();
    return { kind: "job", jobId: b.job_id, manifestKey: b.manifest_key, framesExpected: b.frames_expected };
  }
  return { kind: "cached", manifest: await json<Manifest>(r) };
}

export async function fetchManifest(key: string): Promise<Manifest> {
  return json<Manifest>(await fetch(`${API_BASE}/manifest/${key}`));
}

export async function fetchGaia(ra: number, dec: number, radiusArcmin: number): Promise<GaiaSource[]> {
  const q = new URLSearchParams({ ra: String(ra), dec: String(dec), radius_arcmin: String(radiusArcmin) });
  return json<GaiaSource[]>(await fetch(`${API_BASE}/gaia?${q}`));
}

export interface JobEvents {
  onProgress: (done: number, total: number, epochs?: Epoch[]) => void;
  onFrame: (f: FrameMeta) => void;
  onDone: () => void;
  onError: (code: string, detail: string) => void;
}

export function followJob(jobId: string, h: JobEvents): () => void {
  const es = new EventSource(`${API_BASE}/blink/${jobId}/events`);
  let finished = false;
  es.addEventListener("progress", (e) => {
    const d = JSON.parse((e as MessageEvent).data);
    h.onProgress(d.done, d.total, d.epochs);
  });
  es.addEventListener("frame", (e) => h.onFrame(JSON.parse((e as MessageEvent).data)));
  es.addEventListener("done", () => {
    finished = true;
    es.close();
    h.onDone();
  });
  es.addEventListener("error", (e) => {
    const data = (e as MessageEvent).data;
    if (data) {
      finished = true;
      const d = JSON.parse(data);
      es.close();
      h.onError(d.code, d.detail);
    } else if (!finished && es.readyState === EventSource.CLOSED) {
      h.onError("connection", "Lost the connection to the server.");
    }
  });
  return () => es.close();
}
