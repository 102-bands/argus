// Centre view "Plots": the centre source's light curve and spectrum at full size (replaces the image).
import { useEffect } from "react";
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

const W = 560;
const H = 400;

export function Plots({ photometry, band, isMira, epochs, epoch, targetName }: Props) {
  useEffect(() => track("plots_open", { band }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const who = targetName ?? "the source at the centre";
  return (
    <div className="plots">
      <section className="plot" aria-labelledby="lc-h">
        <h2 id="lc-h" className="plot-title">Light curve</h2>
        <p className="note">Brightness of {who} on every exposure, over time. Colours are detectors D1–D6; hollow circles were saturated.</p>
        <LightCurve points={photometry} band={band} mira={isMira} width={W} height={H} />
      </section>
      <section className="plot" aria-labelledby="sp-h">
        <h2 id="sp-h" className="plot-title">Spectrum</h2>
        <p className="note">Brightness of {who} against wavelength, from SPHEREx's 102 colours, for one visit.</p>
        <Spectrum points={photometry} epochs={epochs} initialEpoch={epoch} width={W} height={H} />
      </section>
    </div>
  );
}
