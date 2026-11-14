import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameMeta, Target } from "../lib/api";
import { parseDec, parseRa } from "../lib/physics";
import { BANDS, readState, writeState, type Band, type Mode, type ViewState } from "../lib/urlState";
import { useSkyData, type Field } from "../lib/useSkyData";
import { track } from "../lib/analytics";
import type { WorkerIn, WorkerOut } from "../workers/frameDecoder.worker";
import { BlinkViewer, type Hover } from "./BlinkViewer";
import { Controls } from "./Controls";
import { Timeline } from "./Timeline";
import { Inspector } from "./Inspector";
import { Plots } from "./Plots";
import { HelpDialog, ShareDialog } from "./Dialogs";

const SkyContext = lazy(() => import("./SkyContext"));

interface Props {
  presetId: string | null;
  targets: Target[];
  embed: boolean;
  navigate: (path: string) => void;
  shareOpen: boolean;
  onShareClose: () => void;
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function Explorer({ presetId, targets, embed, navigate, shareOpen, onShareClose }: Props) {
  const [view, setView] = useState<ViewState>(() => readState(window.location.search));
  const [soft, setSoft] = useState(0.1);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion());
  const [hover, setHover] = useState<Hover | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [bitmaps, setBitmaps] = useState<Map<string, ImageBitmap>>(new Map());
  const [announce, setAnnounce] = useState("");
  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount never leaves a terminated worker.
  const [worker, setWorker] = useState<Worker | null>(null);
  useEffect(() => {
    const w = new Worker(new URL("../workers/frameDecoder.worker.ts", import.meta.url), { type: "module" });
    setWorker(w);
    return () => w.terminate();
  }, []);

  // Re-read URL state when the route changes (back/forward, preset clicks).
  useEffect(() => {
    const onPop = () => setView(readState(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => setView(readState(window.location.search)), [presetId]);

  // Keep the URL in sync without adding history entries.
  useEffect(() => {
    const next = window.location.pathname + writeState(view);
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(null, "", next);
  }, [view]);

  const preset = presetId ? targets.find((t) => t.id === presetId) ?? null : null;
  const field: Field | null = useMemo(() => {
    if (preset) return { presetId: preset.id, ra: preset.ra, dec: preset.dec, size: view.size };
    const ra = view.ra !== null ? parseRa(view.ra) : null;
    const dec = view.dec !== null ? parseDec(view.dec) : null;
    if (ra !== null && dec !== null) return { presetId: null, ra, dec, size: view.size };
    const home = targets.find((t) => t.id === "barnard");
    return home ? { presetId: home.id, ra: home.ra, dec: home.dec, size: view.size } : null;
  }, [preset, view.ra, view.dec, view.size, targets]);
  const fieldTarget = field?.presetId ? targets.find((t) => t.id === field.presetId) ?? null : null;

  const data = useSkyData(field, worker, retry);
  const update = useCallback((patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch })), []);

  // Frames for the chosen band, in time order; only decoded ones can be shown.
  const { product, detector } = view.band === "all" ? { product: "broadband", detector: "all" } : { product: "per_detector", detector: view.band };
  const seq: FrameMeta[] = useMemo(
    () => data.frames.filter((f) => f.product === product && f.detector === detector).sort((a, b) => a.epoch - b.epoch),
    [data.frames, product, detector],
  );
  const ready = useMemo(() => seq.filter((f) => data.decoded.has(f.key)), [seq, data.decoded]);
  const bandsAvailable = useMemo(() => {
    const s = new Set<string>();
    data.frames.forEach((f) => s.add(f.product === "broadband" ? "all" : f.detector));
    return s;
  }, [data.frames]);
  const refFrame = ready.find((f) => f.epoch === view.epoch) ?? ready[0] ?? null;

  // Ask the worker to stretch and colour the ready frames.
  const renderId = useRef(0);
  useEffect(() => {
    if (!ready.length || !worker) {
      setBitmaps(new Map());
      return;
    }
    const id = ++renderId.current;
    const onMsg = async (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type !== "rendered" || m.id !== id) return;
      const entries = await Promise.all(
        m.images.map(async (im) => [im.key, await createImageBitmap(new ImageData(new Uint8ClampedArray(im.rgba), m.w, m.h))] as const),
      );
      if (id !== renderId.current) {
        entries.forEach(([, b]) => b.close());
        return;
      }
      setBitmaps((old) => {
        old.forEach((b) => b.close());
        return new Map(entries);
      });
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({
      type: "render", id, keys: ready.map((f) => f.key), stretch: view.stretch, soft, mode: view.mode,
      refKey: refFrame?.key ?? null,
    } satisfies WorkerIn);
    return () => worker.removeEventListener("message", onMsg);
  }, [ready, view.stretch, soft, view.mode, refFrame?.key, worker]);

  const n = ready.length;
  const cur = n ? ready[((idx % n) + n) % n] : null;
  const canPlay = n > 1 && view.mode !== "stack";

  // Playback starts once two visits are ready (PRD §9.3).
  useEffect(() => {
    if (!playing || !canPlay) return;
    const t = window.setInterval(() => setIdx((i) => i + 1), view.speed);
    return () => window.clearInterval(t);
  }, [playing, canPlay, view.speed]);

  useEffect(() => {
    if (!cur || playing) return;
    const d = new Date(Date.UTC(Number(cur.epoch_label.slice(0, 4)), Number(cur.epoch_label.slice(5, 7)) - 1, 15));
    setAnnounce(`Frame ${(((idx % n) + n) % n) + 1} of ${n}, ${d.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })}`);
  }, [cur?.key, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = useCallback((d: number) => {
    setPlaying(false);
    setIdx((i) => i + d);
  }, []);

  const setMode = useCallback((m: Mode) => {
    setView((v) => {
      if (v.mode !== m) track("mode_change", { from: v.mode, to: m });
      return { ...v, mode: m };
    });
  }, []);
  const setBand = useCallback((b: Band) => {
    track("detector_change", { band: b });
    update({ band: b });
  }, [update]);
  const toggleGaia = useCallback(() => setView((v) => {
    track("gaia_toggle", { on: !v.gaia });
    return { ...v, gaia: !v.gaia };
  }), []);
  const toggleFlags = useCallback(() => setView((v) => {
    track("flags_toggle", { on: !v.flags });
    return { ...v, flags: !v.flags };
  }), []);
  const togglePlay = useCallback(() => setPlaying((p) => {
    if (!p) track("blink_play", { band: view.band, mode: view.mode, n_frames: n });
    return !p;
  }), [view.band, view.mode, n]);

  // Keyboard (PRD §9.3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [role=dialog]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === " ") { togglePlay(); e.preventDefault(); }
      else if (k === "ArrowLeft") step(-1);
      else if (k === "ArrowRight") step(1);
      else if (k === "d" || k === "D") setMode(view.mode === "diff" ? "blink" : "diff");
      else if (k === "g" || k === "G") toggleGaia();
      else if (k === "f" || k === "F") toggleFlags();
      else if (k >= "0" && k <= "6") { const b = BANDS[Number(k)]; if (bandsAvailable.has(b)) setBand(b); }
      else if (k === "+" || k === "=") update({ speed: Math.max(100, view.speed - 100) });
      else if (k === "-" || k === "_") update({ speed: Math.min(2000, view.speed + 100) });
      else if (k === "p" || k === "P") update({ view: view.view === "plots" ? "image" : "plots" });
      else if (k === "?") setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, step, setMode, toggleGaia, toggleFlags, setBand, update, view.mode, view.speed, view.view, bandsAvailable]);

  const bitmap = cur ? bitmaps.get(view.mode === "stack" ? "stack" : cur.key) ?? null : null;
  const decoded = cur ? data.decoded.get(cur.key) ?? null : null;
  const epochTimes = useMemo(() => ready.map((f) => f.t_mid), [ready]);
  const loadedEpochs = useMemo(() => new Set(ready.map((f) => f.epoch)), [ready]);

  const label = cur ? (
    view.mode === "stack" ? (
      <>ALL VISITS · {detector === "all" ? "ALL DETECTORS" : detector} <span className="muted">· {n} frames</span></>
    ) : (
      <>
        {cur.epoch_label} · {detector === "all" ? "ALL" : detector} · {detector === "all" ? `${cur.lambda_range[0].toFixed(2)}–${cur.lambda_range[1].toFixed(2)}` : cur.lambda_um.toFixed(2)} µm
        <span className="muted"> · {cur.n_exp} exp{view.mode === "diff" && refFrame ? ` · minus ${refFrame.epoch_label}` : ""}</span>
      </>
    )
  ) : null;
  const badges = (
    <>
      {cur?.flags.saturated && <span className="badge warn" title="Some exposures were saturated at the centre. Brightness is a lower limit.">Saturated</span>}
      {data.release && <span className="badge info" title={`Collections: ${data.collections.join(", ")}`}>{data.collections.map((c) => c.replace("spherex_", "").toUpperCase()).join("+")}</span>}
    </>
  );

  let status: React.ReactNode = null;
  if (data.phase === "error" && data.error) {
    const e = data.error;
    status = (
      <div className="state-msg" role="alert">
        <h3>{e.code === "no_coverage" ? "No SPHEREx images here yet" : e.code === "irsa_503" ? "The NASA archive is busy" : e.title}</h3>
        <p>{e.code === "no_coverage" ? "SPHEREx hasn't imaged this spot in the releases we use yet. New data arrives weekly. Try a preset meanwhile." : e.detail}</p>
        {e.code !== "no_coverage" && <button className="btn" onClick={() => setRetry((r) => r + 1)}>Try again</button>}
      </div>
    );
  } else if (!n && (data.phase === "coverage" || data.phase === "loading" || data.phase === "ready")) {
    const frac = data.total ? data.done / data.total : 0;
    const elapsed = (performance.now() - data.startedAt) / 1000;
    const eta = data.done > 3 ? Math.round((elapsed / data.done) * (data.total - data.done)) : null;
    status = (
      <div className="state-msg" role="status" aria-live="polite">
        <h3>{data.phase === "coverage" ? "Asking the NASA archive what SPHEREx saw here…" : data.phase === "ready" && seq.length === 0 ? "No frames for this band" : "Building the flipbook"}</h3>
        {data.phase === "loading" && (
          <>
            <p className="mono">Fetching {data.done} / {data.total} exposures{eta !== null ? ` · about ${eta < 90 ? `${eta} s` : `${Math.round(eta / 60)} min`} left` : ""}</p>
            <div className="progress"><div style={{ width: `${frac * 100}%` }} /></div>
            <p className="note">Frames appear as each visit finishes. Playback starts with two.</p>
          </>
        )}
      </div>
    );
  }

  const viewer = (
    <BlinkViewer
      bitmap={bitmap}
      frame={cur}
      decoded={decoded}
      grid={data.grid ?? (data.frames.length && decoded ? decoded.header.wcs : null)}
      mode={view.mode}
      gaia={data.gaia}
      showGaia={view.gaia}
      showFlags={view.flags}
      epochTimes={epochTimes}
      hover={hover}
      onHover={setHover}
      onPick={setHover}
      label={label}
      badges={badges}
    >
      {status}
    </BlinkViewer>
  );

  const controls = (
    <Controls
      layout={embed ? "bar" : "rail"}
      playing={playing && canPlay}
      canPlay={canPlay}
      onPlay={togglePlay}
      onStep={step}
      speed={view.speed}
      onSpeed={(ms) => update({ speed: ms })}
      stretch={view.stretch}
      onStretch={(s) => update({ stretch: s })}
      soft={soft}
      onSoft={setSoft}
      mode={view.mode}
      onMode={setMode}
      band={view.band}
      bandsAvailable={bandsAvailable}
      onBand={setBand}
      size={view.size}
      onSize={(s) => {
        track("fov_change", { size: s });
        update({ size: s });
      }}
      gaia={view.gaia}
      onGaia={toggleGaia}
      flags={view.flags}
      onFlags={toggleFlags}
      onHelp={() => setHelpOpen(true)}
    />
  );

  const live = <div className="sr-only" aria-live="polite">{announce}</div>;

  if (embed) {
    const openHref = `${field?.presetId ? `/t/${field.presetId}` : "/"}${writeState(view)}`;
    return (
      <div className="embed">
        <a className="open-link" href={openHref} target="_blank" rel="noopener">Open in Argus ↗</a>
        <div className="viewer-wrap">{viewer}</div>
        {controls}
        {live}
      </div>
    );
  }

  const showPlots = view.view === "plots";

  return (
    <main className="explorer" id="main">
      <nav className="rail rail-left" aria-label="Controls">
        <div className="ctl-group">
          <span className="ctl-h" id="view-l">View</span>
          <div className="seg fill" role="group" aria-labelledby="view-l">
            <button className="btn" aria-pressed={!showPlots} onClick={() => update({ view: "image" })} title="The blink image (P)">Image</button>
            <button className="btn" aria-pressed={showPlots} onClick={() => update({ view: "plots" })}
                    title="Light curve and spectrum of the source at the centre (P)">Plots</button>
          </div>
        </div>
        {controls}
      </nav>
      <div className="stage">
        <Timeline
          compact
          epochs={data.epochs}
          loaded={loadedEpochs}
          current={view.mode === "stack" ? null : cur?.epoch ?? null}
          refEpoch={refFrame?.epoch ?? null}
          showRef={view.mode === "diff"}
          onSelect={(ep) => {
            setPlaying(false);
            const i = ready.findIndex((f) => f.epoch === ep);
            if (i >= 0) setIdx(i);
          }}
          onRef={(ep) => update({ epoch: ep })}
        />
        {showPlots ? (
          <div className="plots-wrap">
            <Plots photometry={data.photometry} band={view.band} isMira={fieldTarget?.id === "r-dra"} epochs={data.epochs}
                   epoch={cur?.epoch ?? null} targetName={fieldTarget?.name ?? null} />
          </div>
        ) : (
          <div className="viewer-wrap">{viewer}</div>
        )}
      </div>
      <aside className="rail side" aria-label="Details">
        {fieldTarget && (
          <section className="panel">
            <h2 className="label">{fieldTarget.name}</h2>
            <p className="note" style={{ margin: 0 }}>{fieldTarget.notes}</p>
          </section>
        )}
        <Inspector hover={hover} grid={data.grid} decoded={decoded} frame={cur} />
        {field && (
          <section className="panel" aria-labelledby="ctx-h">
            <h2 id="ctx-h" className="label">Sky context</h2>
            <Suspense fallback={<p className="note">Loading the sky map…</p>}>
              <SkyContext ra={field.ra} dec={field.dec} size={field.size} />
            </Suspense>
          </section>
        )}
        <section className="panel" aria-labelledby="pre-h">
          <h2 id="pre-h" className="label">Presets</h2>
          <div className="presets">
            {targets.map((t) => (
              <a key={t.id} href={`/t/${t.id}`} className="preset" aria-current={field?.presetId === t.id} title={t.notes}
                 onClick={(e) => {
                   e.preventDefault();
                   track("preset_click", { target: t.id });
                   navigate(`/t/${t.id}${t.band !== "all" ? `?band=${t.band}` : ""}`);
                 }}>
                <strong>{t.name}</strong>
                <small>{t.notes.split(/[.:]/)[0]}</small>
              </a>
            ))}
          </div>
        </section>
      </aside>
      {live}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {shareOpen && <ShareDialog onClose={onShareClose} />}
    </main>
  );
}
