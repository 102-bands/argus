// Aladin Lite context map, loaded lazily after the blink viewer (PRD §5.3, §10.4).
// Bundled from npm (pinned 3.8.2) because the CDS CDN was down on 2026-11-14.
// Background: the IRSA SPHEREx DR1 all-sky cube. It combines many dates, so it is a still map only.
import { useEffect, useRef, useState } from "react";

const IRSA_HIPS = "https://irsa.ipac.caltech.edu/data/hips/SPHEREx/spherex_allsky_cube";
const CONTEXT_SLICE = 99;

// Probe once per page. Probing on every render opened a new WebGL context each time; Chrome then
// dropped the oldest one, which was Aladin's, and the map went blank.
let webgl2Cache: boolean | null = null;
function hasWebgl2(): boolean {
  if (webgl2Cache === null) {
    const gl = document.createElement("canvas").getContext("webgl2");
    webgl2Cache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return webgl2Cache;
}

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
  const [webgl2] = useState(() => typeof document !== "undefined" && hasWebgl2());

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
          showCooLocation: false,
          showContextMenu: false,
        });
        const layer = a.createImageSurvey("spherex_allsky", "SPHEREx all-sky (DR1)", IRSA_HIPS, "equatorial", 5, {
          imgFormat: "png",
        });
        a.setImageSurvey(layer);
        // The cube has 102 slices and many tiles lack the middle ones (404); tile file _99 (~4.9 µm) is
        // complete. Aladin 3.8.2's setSliceNumber does not map to tile numbers (slice 99 asks for _0;
        // measured), but the tile it loads is floor((f - fmin) / (fmax - fmin) * depth) in frequency f,
        // so ask for the frequency at the middle of file _99. Only works once the layer has loaded.
        const setSlice = (tries: number) => {
          if (cancelled) return;
          if (layer.added && layer.cubeDepth) {
            const c = 299792458;
            const fmin = c / layer.emMax;
            const fmax = c / layer.emMin;
            layer.setFrequency({ value: fmin + ((CONTEXT_SLICE + 0.5) / layer.cubeDepth) * (fmax - fmin) });
          } else if (tries > 0) {
            setTimeout(() => setSlice(tries - 1), 200);
          }
        };
        setSlice(100);
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
      <div ref={div} className="sky-map" aria-label="Sky map around the field" role="img" />
      <p className="note sky-note">SPHEREx all-sky map (IRSA). The cyan box is the blink field.</p>
    </div>
  );
}
