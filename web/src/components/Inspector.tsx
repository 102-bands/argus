import type { FrameMeta, PhotPoint } from "../lib/api";
import { LAYER_ALL_MASKED, LAYER_SATURATED, type DecodedFrame } from "../lib/frame";
import { formatDec, formatRa, pixelToWorld, type GridWcs } from "../lib/physics";
import type { Hover } from "./BlinkViewer";
import { LightCurve } from "./LightCurve";

interface Props {
  hover: Hover | null;
  grid: GridWcs | null;
  decoded: DecodedFrame | null;
  frame: FrameMeta | null;
  photometry: PhotPoint[];
  band: string;
  isMira: boolean;
}

export function Inspector({ hover, grid, decoded, frame, photometry, band, isMira }: Props) {
  let rows: [string, React.ReactNode][] = [];
  if (grid && hover) {
    const [ra, dec] = pixelToWorld(grid, hover.x, hover.y);
    const i = hover.y * grid.n + hover.x;
    const v = decoded?.pixels[i];
    const L = decoded?.layer[i] ?? 0;
    const flags = [L & LAYER_SATURATED ? "SATURATED" : "", L & LAYER_ALL_MASKED ? "NO GOOD DATA" : ""].filter(Boolean);
    rows = [
      ["x, y", `${hover.x}, ${hover.y}`],
      ["RA", `${formatRa(ra)}  ${ra.toFixed(5)}°`],
      ["Dec", `${formatDec(dec)}  ${dec.toFixed(5)}°`],
      ["value", v === undefined || Number.isNaN(v) ? "—" : `${v.toPrecision(4)} MJy/sr`],
      ["flags", flags.length ? <span className="flag-list">{flags.join(", ")}</span> : "none"],
    ];
  }
  if (frame) {
    rows.push(
      ["frame", `${frame.epoch_label} · ${frame.detector === "all" ? "all detectors" : frame.detector}`],
      ["λ", frame.detector === "all"
        ? `${frame.lambda_range[0].toFixed(2)}–${frame.lambda_range[1].toFixed(2)} µm`
        : `${frame.lambda_um.toFixed(3)} µm (${frame.lambda_range[0].toFixed(2)}–${frame.lambda_range[1].toFixed(2)})`],
      ["exposures", String(frame.n_exp)],
    );
  }
  return (
    <>
      <section className="panel" aria-labelledby="insp-h">
        <h2 id="insp-h" className="label">Inspector</h2>
        {rows.length ? (
          <dl className="kv">
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="note">Point at the image to read a pixel.</p>
        )}
      </section>
      <section className="panel" aria-labelledby="lc-h">
        <h2 id="lc-h" className="label">Light curve · centre source</h2>
        <LightCurve points={photometry} band={band} mira={isMira} />
      </section>
    </>
  );
}
