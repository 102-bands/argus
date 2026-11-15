// Right-rail panel shown with the Planet X overlay: how the hunt works, stated honestly.
import { planetXShift, PIXEL_ARCSEC } from "../lib/physics";

interface Props {
  au: number;
  ra: number;
  dec: number;
  /** Reference visit (the body is at the centre then). Not named `ref`: React reserves that prop. */
  refVisit: { mjd: number; label: string } | null;
  last: { mjd: number; label: string } | null;
}

export function PlanetXPanel({ au, ra, dec, refVisit, last }: Props) {
  const jump = refVisit && last ? Math.hypot(...planetXShift(ra, dec, refVisit.mjd, last.mjd, au)) : null;
  return (
    <section className="panel" aria-labelledby="px-h">
      <h2 id="px-h" className="label">Hunting Planet X</h2>
      {jump !== null && refVisit && last && (
        <p className="px-read mono">
          {au} AU: jumps {jump >= 60 ? `${(jump / 60).toFixed(1)}′` : `${jump.toFixed(0)}″`} ({Math.round(jump / PIXEL_ARCSEC)} px)
          between {refVisit.label} and {last.label}
        </p>
      )}
      <p className="note">
        A hypothetical planet far beyond Neptune barely moves itself, but Earth's orbit shifts our view, so between
        visits it jumps this far. Hunters compare whole sky regions, not one cutout.
      </p>
      <p className="note px-limit">Honest limit: ~3 mag too faint for one SPHEREx visit. This shows the method, not a detection.</p>
    </section>
  );
}
