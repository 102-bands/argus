// How a Planet X search works: Earth's orbit makes a distant planet jump against the far stars between visits.
import { useEffect, useMemo, useRef, useState } from "react";

const SUN: [number, number] = [118, 170];
const ORBIT = 62;
const STRIP_X = 590;
const PERIOD_S = 8;
const ARCMIN_PER_AU = (2 * 180 * 60) / Math.PI; // a 2 AU baseline seen from d AU spans 2/d rad

/** Planet X's place in the (not to scale) diagram: closer planets sit nearer the Sun. */
function planetX(dAU: number): [number, number] {
  const f = Math.log(dAU / 200) / Math.log(1000 / 200);
  return [320 + f * 170, SUN[1]];
}

/** Where the line from Earth through Planet X meets the background stars. */
function onStrip(e: [number, number], p: [number, number]): number {
  return p[1] + (p[1] - e[1]) * (STRIP_X - p[0]) / (p[0] - e[0]);
}

const earthAt = (a: number): [number, number] => [SUN[0] + ORBIT * Math.cos(a), SUN[1] + ORBIT * Math.sin(a)];
const BEFORE = earthAt(-Math.PI / 2);
const NOW = earthAt(Math.PI / 2);

export function PlanetXAnim() {
  const [dAU, setDAU] = useState(500);
  const [angle, setAngle] = useState(0);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, visible = true, last = 0;
    const tick = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      setAngle((a) => (a + (2 * Math.PI * dt) / PERIOD_S) % (2 * Math.PI));
      raf = requestAnimationFrame(tick);
    };
    const play = () => { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; play(); });
    if (ref.current) io.observe(ref.current);
    document.addEventListener("visibilitychange", play);
    play();
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", play); };
  }, []);

  const stars = useMemo(() => {
    let s = 11;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return Array.from({ length: 34 }, () => [STRIP_X - 16 + r() * 34, 26 + r() * 288, 0.6 + r() * 1.3] as const);
  }, []);

  const px = planetX(dAU);
  const earth = earthAt(angle);
  const yBefore = onStrip(BEFORE, px), yNow = onStrip(NOW, px), yLive = onStrip(earth, px);
  const shift = ARCMIN_PER_AU / dAU;
  const fields = shift / 8;

  return (
    <figure className="pxa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label={`Diagram: as Earth orbits the Sun, the line of sight to a planet at ${dAU} AU sweeps across the background stars. Two SPHEREx visits six months apart see it ${shift.toFixed(1)} arcminutes apart.`}>
        {/* background stars, which are so far away they don't shift */}
        <rect x={STRIP_X - 22} y={14} width={46} height={312} className="pxa-strip" />
        {stars.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} className="pxa-star" />)}
        <text x={STRIP_X} y={338} textAnchor="middle" className="pxa-label">far stars</text>

        {/* the two visits' sight lines and where they land */}
        <line x1={BEFORE[0]} y1={BEFORE[1]} x2={STRIP_X} y2={yBefore} className="pxa-ray before" />
        <line x1={NOW[0]} y1={NOW[1]} x2={STRIP_X} y2={yNow} className="pxa-ray now" />
        <line x1={STRIP_X - 20} x2={STRIP_X + 20} y1={yBefore} y2={yBefore} className="pxa-tick before" />
        <line x1={STRIP_X - 20} x2={STRIP_X + 20} y1={yNow} y2={yNow} className="pxa-tick now" />
        <path d={`M${STRIP_X + 28} ${yBefore} h6 V${yNow} h-6`} className="pxa-bracket" />
        <text x={STRIP_X + 38} y={(yBefore + yNow) / 2 + 4} className="pxa-shift">{shift.toFixed(1)}′</text>

        {/* today's sight line follows Earth round its orbit */}
        <line x1={earth[0]} y1={earth[1]} x2={STRIP_X} y2={yLive} className="pxa-ray live" />
        <circle cx={STRIP_X} cy={yLive} r={4} className="pxa-seen" />

        {/* Sun, orbit, Earth, the two visit positions */}
        <circle cx={SUN[0]} cy={SUN[1]} r={ORBIT} className="pxa-orbit" />
        <circle cx={SUN[0]} cy={SUN[1]} r={9} className="pxa-sun" />
        <text x={SUN[0]} y={SUN[1] + 26} textAnchor="middle" className="pxa-label">Sun</text>
        <circle cx={BEFORE[0]} cy={BEFORE[1]} r={5} className="pxa-visit before" />
        <text x={BEFORE[0]} y={BEFORE[1] - 12} textAnchor="middle" className="pxa-label before">visit 1</text>
        <circle cx={NOW[0]} cy={NOW[1]} r={5} className="pxa-visit now" />
        <text x={NOW[0]} y={NOW[1] + 22} textAnchor="middle" className="pxa-label now">visit 2, six months later</text>
        <circle cx={earth[0]} cy={earth[1]} r={5.5} className="pxa-earth" />
        <text x={earth[0] + 10} y={earth[1] - 8} className="pxa-label">Earth</text>

        <circle cx={px[0]} cy={px[1]} r={4.5} className="pxa-planet" />
        <text x={px[0]} y={px[1] - 12} textAnchor="middle" className="pxa-label">Planet X</text>
        <text x={8} y={332} className="pxa-note">not to scale</text>
      </svg>
      <div className="pxa-controls">
        <label htmlFor="pxa-d">Distance</label>
        <input id="pxa-d" type="range" min={200} max={1000} step={50} value={dAU}
               onChange={(e) => setDAU(Number(e.target.value))} />
        <output htmlFor="pxa-d" className="mono">{dAU} AU</output>
      </div>
      <figcaption>
        Six months apart, Earth sits on opposite sides of the Sun, 2 AU apart. From those two spots a planet at {dAU} AU
        lands <b className="mono">{shift.toFixed(1)}′</b> apart against the far stars,{" "}
        {fields >= 1 ? `${fields.toFixed(1)}× the width of an 8′ Argus field` : "inside one 8′ Argus field"}. That jump
        between visits, not the dot itself, is what a search looks for.
      </figcaption>
    </figure>
  );
}
