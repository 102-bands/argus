import { BANDS, MODES, PX_MAX, PX_MIN, STRETCHES, type Band, type Mode, type Stretch } from "../lib/urlState";

interface Props {
  /** "rail": stacked sections in the dashboard's left column. "bar": one wrapping row (embed, phones). */
  layout: "rail" | "bar";
  playing: boolean;
  canPlay: boolean;
  onPlay: () => void;
  onStep: (d: number) => void;
  speed: number;
  onSpeed: (ms: number) => void;
  stretch: Stretch;
  onStretch: (s: Stretch) => void;
  soft: number;
  onSoft: (v: number) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  band: Band;
  bandsAvailable: Set<string>;
  onBand: (b: Band) => void;
  size: number;
  onSize: (s: number) => void;
  gaia: boolean;
  onGaia: () => void;
  flags: boolean;
  onFlags: () => void;
  /** Planet X overlay distance in AU, 0 = off. */
  planetX: number;
  onPlanetX: (au: number) => void;
  onHelp: () => void;
}

const MODE_TIPS: Record<Mode, string> = {
  blink: "Blink: flip between dates. Things that move jump; things that change pulse.",
  diff: "Difference: each date minus the reference date. Cyan is brighter now, magenta brighter before.",
  stack: "Stack: add every date together so faint things show up. Movers smear out.",
};

const SIZES = [1, 2, 3, 5, 8, 10, 15];

export function Controls(p: Props) {
  return (
    <div className={`controls ${p.layout}`} role="toolbar" aria-label="Playback and display">
      <div className="ctl-group">
        <span className="ctl-h" id="play-l">Playback</span>
        <div className="ctl">
          <div className="seg" role="group" aria-labelledby="play-l">
            <button className="btn icon" onClick={() => p.onStep(-1)} aria-label="Previous frame" title="Previous frame (←)" disabled={!p.canPlay}>◀</button>
            <button className="btn icon" onClick={p.onPlay} aria-label={p.playing ? "Pause" : "Play"} title="Play or pause (Space)" disabled={!p.canPlay}>
              {p.playing ? "❚❚" : "▶"}
            </button>
            <button className="btn icon" onClick={() => p.onStep(1)} aria-label="Next frame" title="Next frame (→)" disabled={!p.canPlay}>▶|</button>
          </div>
          <input type="range" min={100} max={2000} step={50} value={2100 - p.speed} className="speed"
                 aria-label="Playback speed" title="Speed: how long each frame stays on screen (+ / −)"
                 onChange={(e) => p.onSpeed(2100 - Number(e.target.value))} />
        </div>
      </div>

      <div className="ctl-group">
        <span className="ctl-h" id="mode-l">Mode</span>
        <div className="seg fill" role="group" aria-labelledby="mode-l">
          {MODES.map((m) => (
            <button key={m} className="btn" aria-pressed={p.mode === m} title={MODE_TIPS[m]} onClick={() => p.onMode(m)}>{m}</button>
          ))}
        </div>
      </div>

      <div className="ctl-group">
        <span className="ctl-h" id="band-l" title="SPHEREx has six detectors, D1 (0.75 µm) to D6 (5 µm). “all” adds them together.">Band</span>
        <div className="seg fill" role="group" aria-labelledby="band-l">
          {BANDS.map((b, i) => (
            <button key={b} className="btn" aria-pressed={p.band === b} disabled={!p.bandsAvailable.has(b)}
                    title={b === "all" ? "All detectors stacked (0)" : `Detector ${b} only (${i})`} onClick={() => p.onBand(b)}>{b}</button>
          ))}
        </div>
      </div>

      <div className="ctl-group">
        <span className="ctl-h" id="disp-l">Brightness</span>
        <div className="ctl" title="How brightness maps to grey. asinh shows faint and bright things together.">
          <select value={p.stretch} onChange={(e) => p.onStretch(e.target.value as Stretch)} aria-label="Stretch">
            {STRETCHES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input type="range" min={1} max={100} value={Math.round(p.soft * 100)} aria-label="Stretch softness"
                 title="Softness: lower shows fainter detail" onChange={(e) => p.onSoft(Number(e.target.value) / 100)}
                 disabled={p.stretch === "linear" || p.stretch === "zscale"} />
        </div>
      </div>

      <div className="ctl-group">
        <span className="ctl-h" id="field-l">Field of view</span>
        <div className="ctl" title="How much sky to show. Bigger fields take longer to build.">
          <select value={p.size} onChange={(e) => p.onSize(Number(e.target.value))} aria-label="Field of view in arcminutes">
            {SIZES.map((s) => <option key={s} value={s}>{s}′{s > 10 ? " (slow)" : ""}</option>)}
          </select>
        </div>
      </div>

      <div className="ctl-group">
        <span className="ctl-h" id="ovl-l">Overlays</span>
        <div className="ctl">
          <div className="seg fill" role="group" aria-labelledby="ovl-l">
            <button className="btn" aria-pressed={p.gaia} onClick={p.onGaia} title="Gaia: where ESA's Gaia catalogue predicts each star should be on this date (G)">Gaia</button>
            <button className="btn" aria-pressed={p.flags} onClick={p.onFlags} title="Flags: amber = saturated pixels; hatched = no good data (F)">Flags</button>
            <button className="btn" aria-pressed={p.planetX > 0} onClick={() => p.onPlanetX(p.planetX > 0 ? 0 : 500)}
                    title="Planet X: where a distant planet at the centre would appear on later visits (X)">Planet X</button>
          </div>
          <button className="btn icon" onClick={p.onHelp} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button>
        </div>
        {p.planetX > 0 && (
          <label className="ctl px-ctl" title="Distance of the imagined planet from the Sun (log scale)">
            <input type="range" min={Math.log10(PX_MIN)} max={Math.log10(PX_MAX)} step={0.01} value={Math.log10(p.planetX)}
                   aria-label="Planet X distance in astronomical units"
                   onChange={(e) => p.onPlanetX(Math.round(10 ** Number(e.target.value) / 10) * 10)} />
            <span className="mono">{p.planetX} AU</span>
          </label>
        )}
      </div>
    </div>
  );
}
