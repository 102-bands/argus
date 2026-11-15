// Finds: Argus measures every source on every visit and marks the ones that move, vary or are unusually red.
import { useMemo, useRef } from "react";
import { starField, useLoop } from "./useLoop";

const X0 = 24, X1 = 652, Y0 = 20, H = 270;
const SCAN = 5, LOOP = 9;
type Kind = "moving" | "variable" | "red";
const FINDS: { kind: Kind; x: number; y: number; label: string; unknown?: boolean }[] = [
  { kind: "moving", x: 190, y: 176, label: "Moving · matches Gaia" },
  { kind: "variable", x: 410, y: 96, label: "Variable" },
  { kind: "red", x: 548, y: 214, label: "Very red · not in Gaia", unknown: true },
];

export function FinderAnim() {
  const ref = useRef<SVGSVGElement>(null);
  const time = useLoop(ref, SCAN + 1);
  const t = time % LOOP;
  const scanX = X0 + Math.min(1, t / SCAN) * (X1 - X0);
  const fade = t > LOOP - 0.6 ? (LOOP - t) / 0.6 : 1;
  const stars = useMemo(() => starField(17, 44, X0 + 10, Y0 + 10, X1 - X0 - 20, H - 20), []);
  const all = stars.length + FINDS.length;
  const seen = stars.filter(([x]) => x < scanX).length + FINDS.filter((f) => f.x < scanX).length;
  const found = FINDS.filter((f) => f.x < scanX);
  const pulse = 0.65 + 0.35 * Math.sin(time * 5);

  const mark = (f: (typeof FINDS)[number]) => {
    const dash = f.unknown ? "4 3" : undefined;
    return (
      <g key={f.kind} opacity={fade}>
        {f.kind === "moving" && <>
          <line x1={f.x - 22} y1={f.y + 30} x2={f.x} y2={f.y} className="fa-movetrack" />
          <rect x={f.x - 11} y={f.y - 11} width={22} height={22} className="fa-m-moving" strokeDasharray={dash} />
        </>}
        {f.kind === "variable" && <rect x={f.x - 9} y={f.y - 9} width={18} height={18} transform={`rotate(45 ${f.x} ${f.y})`}
                                        className="fa-m-variable" strokeDasharray={dash} />}
        {f.kind === "red" && <circle cx={f.x} cy={f.y} r={12} className="fa-m-red" strokeDasharray={dash} />}
        <text x={f.x > 480 ? f.x - 18 : f.x + 18} y={f.y - 14} textAnchor={f.x > 480 ? "end" : "start"} className={`fa-tag k-${f.kind}`}>{f.label}</text>
      </g>
    );
  };

  return (
    <figure className="pxa fa">
      <svg ref={ref} viewBox="0 0 676 340" role="img"
           aria-label="Animation: a scan passes across a star field. Every source is measured; one is marked moving, one variable and one very red and missing from Gaia.">
        <rect x={X0} y={Y0} width={X1 - X0} height={H} className="fa-panel" />
        {stars.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} className="fa-star" />
            {x < scanX && scanX - x < 60 && <circle cx={x} cy={y} r={r + 4} className="fa-tick" opacity={1 - (scanX - x) / 60} />}
          </g>
        ))}
        {FINDS.map((f) => (
          <circle key={f.kind} cx={f.x} cy={f.y} r={f.kind === "red" ? 3 : 4.2}
                  className={f.kind === "red" ? "fa-redstar" : "fa-star"} opacity={f.kind === "variable" ? pulse : 1} />
        ))}
        {found.map(mark)}
        {t < SCAN && <line x1={scanX} x2={scanX} y1={Y0} y2={Y0 + H} className="fa-scan" />}
        <text x={X0} y={Y0 + H + 30} className="fa-mono">
          {seen} of {all} sources measured · {found.filter((f) => f.kind === "moving").length} moving ·{" "}
          {found.filter((f) => f.kind === "variable").length} variable · {found.filter((f) => f.kind === "red").length} very red
        </text>
      </svg>
      <figcaption>
        You don't have to spot everything by eye. Argus finds every source above <b className="mono">5σ</b>, measures its
        position and brightness on every visit, fits its motion and checks it against Gaia. Movers get a magenta
        square, variable stars an amber diamond, very red sources an orange circle, dashed when Gaia has never seen them.
      </figcaption>
    </figure>
  );
}
