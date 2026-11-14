// Aladin Lite context map, loaded lazily after the blink viewer (PRD §5.3, §10.4).
// Bundled from npm (pinned 3.8.2) because the CDS CDN was down on 2026-11-14.
// Background: the IRSA SPHEREx DR1 all-sky cube. It combines many dates, so it is a still map only.
import { useEffect, useRef, useState } from "react";

const IRSA_HIPS = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
const CONTEXT_SLICE = 99;

interface Props {
  ra: number;
  dec: number;
  size: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function SkyContext({ ra, dec, size }: Props) {
  const div = useRef<HTMLDivElement>(null);
  const al = useRef<any>(null);
  const footprint = useRef<any>(null);
  const [failed, setFailed] = useState(false);
  const webgl2 = typeof document !== "undefined" && !!document.createElement("canvas").getContext("webgl2");

  useEffect(() => {
    if (!webgl2 || !div.current) return;
    let cancelled = false;
    (async () => {
      try {
        const A = (await import("aladin-lite")).default as any;
        await A.init;
        if (cancelled || !div.current) return;
        const a = A.aladin(div.current, {
          fov: Math.max((size * 6) / 60, 0.3),
          target: `${ra} ${dec}`,
          projection: "TAN",
          survey: IRSA_HIPS, // never the CDS default (DSS), which was down on 2026-11-14
          showReticle: false,
          showZoomControl: false,
          showFullscreenControl: false,
          showLayersControl: false,
          showGotoControl: false,
          showFrame: false,
          showCooGrid: false,
          showProjectionControl: false,
          showSimbadPointerControl: false,
          showCooGridControl: false,
          showSettingsControl: false,
          showShareControl: false,
          showStatusBar: false,
          showContextMenu: false,
        });
        const layer = a.createImageSurvey("spherex_allsky", "SPHEREx all-sky (DR1)", IRSA_HIPS, "equatorial", 5, {
          imgFormat: "png",
        });
        a.setImageSurvey(layer);
        // The cube has 102 slices and some tiles lack middle slices; slice 99 (~4.9 µm) is complete.
        layer.setSliceNumber?.(CONTEXT_SLICE);
        const overlay = A.graphicOverlay({ color: "#22B8D8", lineWidth: 2 });
        a.addOverlay(overlay);
        al.current = a;
        footprint.current = { A, overlay };
        draw();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      // Free the WebGL context; browsers allow only ~16 at once.
      try {
        al.current?.destroy?.();
      } catch {
        // already gone
      }
      al.current = null;
      if (div.current) div.current.innerHTML = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const draw = () => {
    const a = al.current;
    const f = footprint.current;
    if (!a || !f) return;
    a.gotoRaDec(ra, dec);
    a.setFoV(Math.max((size * 6) / 60, 0.3));
    f.overlay.removeAll();
    const h = size / 120;
    const c = Math.cos((dec * Math.PI) / 180) || 1e-6;
    f.overlay.add(f.A.polygon([
      [ra - h / c, dec - h], [ra + h / c, dec - h], [ra + h / c, dec + h], [ra - h / c, dec + h],
    ]));
  };
  useEffect(draw, [ra, dec, size]);

  if (!webgl2 || failed) {
    return <p className="note">The sky map needs WebGL2, which this browser doesn't offer. Everything else works.</p>;
  }
  return (
    <div>
      <div ref={div} style={{ width: "100%", aspectRatio: "1.4", background: "var(--ink-2)" }} aria-label="Sky map around the field" role="img" />
      <p className="note" style={{ fontSize: 11, marginBottom: 0 }}>SPHEREx DR1 all-sky map (IRSA). The cyan box is the blink field.</p>
    </div>
  );
}
