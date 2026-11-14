import { useEffect, useRef } from "react";
import type { FrameMeta, GaiaSource } from "../lib/api";
import { LAYER_ALL_MASKED, LAYER_SATURATED, type DecodedFrame } from "../lib/frame";
import { PIXEL_ARCSEC, type GridWcs, mjdToYear, planetXShift, propagate, worldToPixel } from "../lib/physics";
import { targetPixel, type MotionTarget } from "../lib/validate";
import type { Mode } from "../lib/urlState";

export interface Hover {
  x: number; // FITS pixel, 0-based
  y: number;
}

interface Props {
  bitmap: ImageBitmap | null;
  frame: FrameMeta | null;
  decoded: DecodedFrame | null;
  grid: GridWcs | null;
  mode: Mode;
  gaia: GaiaSource[] | null;
  showGaia: boolean;
  showFlags: boolean;
  epochTimes: number[];
  hover: Hover | null;
  onHover: (h: Hover | null) => void;
  onPick: (h: Hover) => void;
  /** Frames are still arriving: blur the image under the Processing overlay. */
  busy?: boolean;
  /** Preset target: a pulsing ring follows it from visit to visit. */
  target?: MotionTarget | null;
  /** Planet X overlay: distance (AU) and the reference visit's time; the body sits at the centre then. */
  planetX?: { au: number; refMjd: number; refLabel: string } | null;
  label: React.ReactNode;
  badges: React.ReactNode;
  children?: React.ReactNode;
}

const GAIA_EPOCH = 2016.0;
const MIN_ARROW_PX = 0.3;

export function BlinkViewer(p: Props) {
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const n = p.grid?.n ?? 0;

  // Image layer: draw the stretched frame at native resolution; CSS scales it with pixelated rendering.
  useEffect(() => {
    const c = base.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    if (!p.bitmap) {
      g.clearRect(0, 0, c.width, c.height);
      return;
    }
    c.width = p.bitmap.width;
    c.height = p.bitmap.height;
    g.imageSmoothingEnabled = false;
    g.drawImage(p.bitmap, 0, 0);
  }, [p.bitmap]);

  // Overlay layer: Gaia arrows, flags, crosshair, scale bar, hover box. Drawn at device resolution.
  useEffect(() => {
    const c = over.current;
    if (!c || !p.grid) return;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    const s = c.width / n; // canvas px per sky px
    const toCanvas = (x: number, y: number): [number, number] => [(x + 0.5) * s, (n - 1 - y + 0.5) * s];

    if (p.showFlags && p.decoded && p.mode !== "stack") {
      const L = p.decoded.layer;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const v = L[y * n + x];
          if (!v) continue;
          const [cx, cy] = toCanvas(x, y);
          if (v & LAYER_SATURATED) {
            g.fillStyle = "rgba(242,179,61,0.35)";
            g.fillRect(cx - s / 2, cy - s / 2, s, s);
          }
          if (v & LAYER_ALL_MASKED) {
            g.strokeStyle = "rgba(255,255,255,0.35)";
            g.lineWidth = dpr;
            g.beginPath();
            g.moveTo(cx - s / 2, cy + s / 2);
            g.lineTo(cx + s / 2, cy - s / 2);
            g.stroke();
          }
        }
      }
    }

    if (p.showGaia && p.gaia && p.frame) {
      const yNow = mjdToYear(p.frame.t_mid);
      const years = p.epochTimes.map(mjdToYear);
      const y0 = Math.min(...years, yNow);
      const y1 = Math.max(...years, yNow);
      for (const src of p.gaia) {
        if (src.pmra === null || src.pmdec === null) continue;
        const [ra, dec] = propagate(src.ra, src.dec, src.pmra, src.pmdec, yNow - GAIA_EPOCH);
        const [x, y] = worldToPixel(p.grid, ra, dec);
        if (x < -2 || y < -2 || x > n + 1 || y > n + 1) continue;
        const [cx, cy] = toCanvas(x, y);
        const [ra0, dec0] = propagate(src.ra, src.dec, src.pmra, src.pmdec, y0 - GAIA_EPOCH);
        const [ra1, dec1] = propagate(src.ra, src.dec, src.pmra, src.pmdec, y1 - GAIA_EPOCH);
        const a = toCanvas(...worldToPixel(p.grid, ra0, dec0));
        const b = toCanvas(...worldToPixel(p.grid, ra1, dec1));
        const movePx = Math.hypot(b[0] - a[0], b[1] - a[1]) / s;
        const bright = src.g !== null && src.g < 14; // non-movers only when bright, to keep the field readable
        if (!bright && movePx < MIN_ARROW_PX) continue;
        g.strokeStyle = "#22B8D8";
        g.lineWidth = 1.5 * dpr;
        if (movePx >= MIN_ARROW_PX) {
          // Predicted track from the first to the last epoch, with an arrowhead.
          g.beginPath();
          g.moveTo(a[0], a[1]);
          g.lineTo(b[0], b[1]);
          g.stroke();
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
          const h = 6 * dpr;
          g.beginPath();
          g.moveTo(b[0], b[1]);
          g.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
          g.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45));
          g.closePath();
          g.fillStyle = "#22B8D8";
          g.fill();
        }
        g.beginPath();
        g.arc(cx, cy, Math.max(s * 1.6, 7 * dpr), 0, Math.PI * 2);
        g.stroke();
      }
    }

    if (p.planetX && p.frame) {
      // Where a body at the field centre on the reference visit appears on this visit (Earth-orbit parallax).
      const [de, dn] = planetXShift(p.grid.crval[0], p.grid.crval[1], p.planetX.refMjd, p.frame.t_mid, p.planetX.au);
      const cosd = Math.cos((p.grid.crval[1] * Math.PI) / 180) || 1e-9;
      const start = toCanvas(...worldToPixel(p.grid, p.grid.crval[0], p.grid.crval[1]));
      const end = toCanvas(...worldToPixel(p.grid, p.grid.crval[0] + de / 3600 / cosd, p.grid.crval[1] + dn / 3600));
      const jump = Math.hypot(de, dn);
      const label = jump >= 60 ? `${(jump / 60).toFixed(1)}′` : `${jump.toFixed(0)}″`;
      const W = c.width;
      const inside = end[0] >= 0 && end[1] >= 0 && end[0] <= W && end[1] <= W;
      // Clip the segment to the field so the arrow stops at the edge when the planet leaves it.
      let tEnd = 1;
      for (const [d0, d1] of [[start[0], end[0]], [start[1], end[1]]]) {
        if (d1 > W) tEnd = Math.min(tEnd, (W - d0) / (d1 - d0));
        if (d1 < 0) tEnd = Math.min(tEnd, (0 - d0) / (d1 - d0));
      }
      const tip: [number, number] = [start[0] + (end[0] - start[0]) * tEnd, start[1] + (end[1] - start[1]) * tEnd];
      g.strokeStyle = "#E04CF0";
      g.fillStyle = "#E04CF0";
      g.lineWidth = 1.5 * dpr;
      g.setLineDash([6 * dpr, 4 * dpr]);
      g.beginPath();
      g.moveTo(start[0], start[1]);
      g.lineTo(tip[0], tip[1]);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(start[0], start[1], 5 * dpr, 0, Math.PI * 2);
      g.stroke();
      if (jump > 1) {
        const ang = Math.atan2(tip[1] - start[1], tip[0] - start[0]);
        if (inside) {
          g.beginPath();
          g.arc(end[0], end[1], 9 * dpr, 0, Math.PI * 2);
          g.stroke();
        } else {
          const h = 10 * dpr;
          g.beginPath();
          g.moveTo(tip[0], tip[1]);
          g.lineTo(tip[0] - h * Math.cos(ang - 0.45), tip[1] - h * Math.sin(ang - 0.45));
          g.lineTo(tip[0] - h * Math.cos(ang + 0.45), tip[1] - h * Math.sin(ang + 0.45));
          g.closePath();
          g.fill();
        }
        g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
        const text = inside ? `Planet X? ${label}` : `${label} → leaves the field`;
        const tw = g.measureText(text).width;
        const lx = Math.min(Math.max((start[0] + tip[0]) / 2 - tw / 2, 6 * dpr), W - tw - 6 * dpr);
        const ly = Math.min(Math.max((start[1] + tip[1]) / 2 - 8 * dpr, 14 * dpr), W - 30 * dpr);
        g.fillStyle = "rgba(11,11,15,0.75)";
        g.fillRect(lx - 4 * dpr, ly - 11 * dpr, tw + 8 * dpr, 15 * dpr);
        g.fillStyle = "#E04CF0";
        g.fillText(text, lx, ly);
      } else {
        g.font = `${11 * dpr}px "JetBrains Mono", monospace`;
        g.fillText(`Planet X here on ${p.planetX.refLabel}`, start[0] + 8 * dpr, start[1] - 8 * dpr);
      }
    }

    // Centre crosshair (gap in the middle so the target stays visible).
    const cc = toCanvas((n - 1) / 2, (n - 1) / 2);
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = dpr;
    const r1 = Math.max(s * 2.5, 10 * dpr);
    const r2 = r1 + 8 * dpr;
    g.beginPath();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      g.moveTo(cc[0] + dx * r1, cc[1] + dy * r1);
      g.lineTo(cc[0] + dx * r2, cc[1] + dy * r2);
    });
    g.stroke();

    // Scale bar: 1′, or 30″ for small fields.
    const arcsec = n * PIXEL_ARCSEC > 150 ? 60 : 30;
    const len = (arcsec / PIXEL_ARCSEC) * s;
    const bx = 10 * dpr;
    const by = c.height - 28 * dpr;
    g.strokeStyle = "rgba(255,255,255,0.8)";
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + len, by);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.font = `${10 * dpr}px "JetBrains Mono", monospace`;
    g.fillText(arcsec === 60 ? "1′" : "30″", bx, by - 4 * dpr);

    if (p.hover) {
      const [hx, hy] = toCanvas(p.hover.x, p.hover.y);
      g.strokeStyle = "#FFFFFF";
      g.strokeRect(hx - s / 2, hy - s / 2, s, s);
    }
  }, [p.grid, p.decoded, p.frame, p.gaia, p.showGaia, p.showFlags, p.hover, p.mode, p.epochTimes, p.planetX, n]);

  const ring = p.target && p.grid && p.frame ? targetPixel(p.grid, p.target, p.frame.t_mid) : null;

  const pick = (e: React.MouseEvent<HTMLCanvasElement>): Hover | null => {
    if (!n) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * n);
    const row = Math.floor(((e.clientY - r.top) / r.height) * n);
    if (x < 0 || x >= n || row < 0 || row >= n) return null;
    return { x, y: n - 1 - row };
  };

  return (
    <div className="viewer-frame">
      {/* A row above the square, not overlaid: on narrow screens the label and badges wrap instead of colliding. */}
      <div className="viewer-head">
        <div className="frame-label" aria-hidden="true">{p.label}</div>
        <div className="badges">{p.badges}</div>
      </div>
      <div className={p.busy ? "viewer busy" : "viewer"}>
        <canvas ref={base} role="img" aria-label="SPHEREx image of the selected field" />
        <canvas
          ref={over}
          className="overlay"
          style={{ pointerEvents: "auto", cursor: "crosshair" }}
          onPointerMove={(e) => p.onHover(pick(e))}
          onPointerLeave={() => p.onHover(null)}
          onClick={(e) => {
            const h = pick(e);
            if (h) p.onPick(h);
          }}
        />
        {p.mode === "diff" && (
          <div className="legend" aria-label="Colour legend">
            <span className="now">▲ brighter now</span>
            <span className="before">▼ brighter before</span>
          </div>
        )}
        {ring && (
          <span className="mover-ring" aria-hidden="true"
                style={{ left: `${((ring[0] + 0.5) / n) * 100}%`, top: `${((n - 1 - ring[1] + 0.5) / n) * 100}%` }} />
        )}
        <div className="compass" aria-hidden="true">N ↑ · E ←</div>
        {p.children}
      </div>
    </div>
  );
}
