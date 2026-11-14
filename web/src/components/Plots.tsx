// Centre view "Plots": the centre source's light curve and spectrum at full size (replaces the image).
import { useEffect, useRef, useState } from "react";
import type { Epoch, PhotPoint } from "../lib/api";
import { track } from "../lib/analytics";
import { LightCurve } from "./LightCurve";
import { Spectrum } from "./Spectrum";

interface Props {
  photometry: PhotPoint[];
  band: string;
  isMira: boolean;
  epochs: Epoch[];
  epoch: number | null;
  targetName: string | null;
}

const GAP = 28; // the .plots column gap
const CHROME = 200; // title, caption, buttons and legend around each chart

export function Plots({ photometry, band, isMira, epochs, epoch, targetName }: Props) {
  useEffect(() => track("plots_open", { band }), []); // eslint-disable-line react-hooks/exhaustive-deps
  // Draw the charts at their on-screen pixel size (measured from the scroll area around them), so axis
  // text stays 12–14 px on any screen and the charts use the height the dashboard leaves them.
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const twoUp = box.w >= 720;
  const w = Math.max(280, Math.floor(twoUp ? (box.w - GAP) / 2 : box.w));
  const h = Math.max(220, Math.min(Math.round(w * 0.8), Math.floor(box.h - CHROME)));

  const who = targetName ?? "the source at the centre";
  return (
    <div className={twoUp ? "plots two-up" : "plots"} ref={ref}>
      <section className="plot" aria-labelledby="lc-h">
        <h2 id="lc-h" className="plot-title">Light curve</h2>
        <p className="note">Brightness of {who} on every exposure, over time. Colours are detectors D1–D6; hollow circles were saturated.</p>
        <LightCurve points={photometry} band={band} mira={isMira} width={w} height={h} />
      </section>
      <section className="plot" aria-labelledby="sp-h">
        <h2 id="sp-h" className="plot-title">Spectrum</h2>
        <p className="note">Brightness of {who} against wavelength, from SPHEREx's 102 colours, for one visit.</p>
        <Spectrum points={photometry} epochs={epochs} initialEpoch={epoch} width={w} height={h} />
      </section>
    </div>
  );
}
