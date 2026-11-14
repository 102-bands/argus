// Loads one field: static preset files first, else a live blink job streamed over SSE (PRD §6.2, §9.3).
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  type Epoch,
  type FrameMeta,
  type GaiaSource,
  type Manifest,
  type PhotPoint,
  fetchFrame,
  fetchGaia,
  fetchManifest,
  followJob,
  loadPresetManifest,
  startBlink,
} from "./api";
import type { DecodedFrame } from "./frame";
import type { GridWcs } from "./physics";
import { track } from "./analytics";
import type { WorkerIn, WorkerOut } from "../workers/frameDecoder.worker";

export interface Field {
  presetId: string | null;
  ra: number;
  dec: number;
  size: number;
}

export type Phase = "idle" | "coverage" | "loading" | "ready" | "error";

export interface SkyData {
  phase: Phase;
  done: number;
  total: number;
  epochs: Epoch[];
  frames: FrameMeta[];
  decoded: Map<string, DecodedFrame>;
  grid: GridWcs | null;
  photometry: PhotPoint[];
  gaia: GaiaSource[] | null;
  release: string;
  collections: string[];
  error: { code: string; title: string; detail: string } | null;
  startedAt: number;
}

const EMPTY: SkyData = {
  phase: "idle", done: 0, total: 0, epochs: [], frames: [], decoded: new Map(), grid: null, photometry: [],
  gaia: null, release: "", collections: [], error: null, startedAt: 0,
};

const FETCH_PARALLEL = 6;

export function useSkyData(field: Field | null, worker: Worker | null, retryToken: number): SkyData {
  const [data, setData] = useState<SkyData>(EMPTY);
  const decodedRef = useRef(new Map<string, DecodedFrame>());

  useEffect(() => {
    if (!field || !worker) {
      setData(EMPTY);
      return;
    }
    const ac = new AbortController();
    let stopJob: (() => void) | null = null;
    const queue: string[] = [];
    let inFlight = 0;
    let presetId: string | null = field.presetId;
    const decoded = new Map<string, DecodedFrame>();
    decodedRef.current = decoded;
    worker.postMessage({ type: "clear" } satisfies WorkerIn);
    const startedAt = performance.now();
    setData({ ...EMPTY, phase: "coverage", decoded, startedAt });

    const onWorker = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type !== "added" || decodedRef.current !== decoded) return;
      decoded.set(m.key, { header: m.header, pixels: m.pixels, layer: m.layer });
      setData((d) => ({ ...d, decoded: new Map(decoded) }));
    };
    worker.addEventListener("message", onWorker);

    const pump = () => {
      while (inFlight < FETCH_PARALLEL && queue.length) {
        const key = queue.shift()!;
        inFlight++;
        fetchFrame(key, presetId, ac.signal)
          .then((buffer) => worker.postMessage({ type: "add", key, buffer } satisfies WorkerIn, [buffer]))
          .catch(() => undefined)
          .finally(() => {
            inFlight--;
            pump();
          });
      }
    };

    const applyManifest = (m: Manifest, fromPreset: boolean) => {
      setData((d) => ({
        ...d,
        phase: "ready",
        epochs: m.epochs,
        frames: m.frames,
        grid: m.grid,
        photometry: m.photometry,
        gaia: m.gaia ?? d.gaia,
        release: m.release_marker,
        collections: m.collections,
        done: m.n_exposures,
        total: m.n_exposures,
      }));
      const have = new Set(decoded.keys());
      m.frames.forEach((f) => !have.has(f.key) && queue.push(f.key));
      pump();
      if (!fromPreset) loadGaia();
    };

    const loadGaia = () => {
      fetchGaia(field.ra, field.dec, Math.min(field.size * 0.75, 15))
        .then((g) => !ac.signal.aborted && setData((d) => ({ ...d, gaia: g })))
        .catch(() => undefined);
    };

    const fail = (code: string, title: string, detail: string) => {
      if (ac.signal.aborted) return;
      track("job_error", { code });
      setData((d) => ({ ...d, phase: "error", error: { code, title, detail } }));
    };

    (async () => {
      if (presetId) {
        const m = await loadPresetManifest(presetId);
        if (ac.signal.aborted) return;
        if (m && Math.abs(m.size_arcmin - field.size) < 1e-6) {
          applyManifest(m, true);
          return;
        }
        presetId = null; // different FOV than precomputed: go live
      }
      try {
        const start = await startBlink(field.ra, field.dec, field.size, ac.signal);
        if (start.kind === "cached") {
          applyManifest(start.manifest, false);
          return;
        }
        setData((d) => ({ ...d, phase: "loading" }));
        stopJob = followJob(start.jobId, {
          onProgress: (done, total, epochs) =>
            setData((d) => ({ ...d, done, total, epochs: epochs ?? d.epochs })),
          onFrame: (f) => {
            setData((d) => ({ ...d, frames: [...d.frames, f] }));
            queue.push(f.key);
            pump();
          },
          onDone: async () => {
            try {
              applyManifest(await fetchManifest(start.manifestKey), false);
              const secs = (performance.now() - startedAt) / 1000;
              track("job_time", { seconds_bucket: secs < 10 ? "<10" : secs < 30 ? "10-30" : secs < 120 ? "30-120" : "120+" });
            } catch (e) {
              fail("manifest", "Could not load the result", String(e));
            }
          },
          onError: (code, detail) => fail(code, "The job stopped", detail),
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        if (e instanceof ApiError) {
          const p = e.problem;
          const code = p.status === 404 ? "no_coverage" : p.status === 502 ? "irsa_503" : p.status === 429 ? "rate" : `http_${p.status}`;
          fail(code, p.title, p.detail ?? "");
        } else {
          fail("network", "Can't reach the Argus server", "Check your connection. The presets still work offline.");
        }
      }
    })();

    return () => {
      ac.abort();
      stopJob?.();
      worker.removeEventListener("message", onWorker);
    };
  }, [field?.presetId, field?.ra, field?.dec, field?.size, worker, retryToken]);

  return data;
}
