// Right-rail panel: every source in the field, measured on every visit and labelled automatically.
import { formatDec, formatRa } from "../lib/physics";
import type { Candidate, CandidateResult } from "../lib/candidates";

interface Props {
  result: CandidateResult | null;
  selected: number | null;
  onSelect: (id: number | null) => void;
  onCentre: (c: Candidate) => void;
}

const KIND_LABEL: Record<Candidate["kind"], string> = { moving: "Moving", variable: "Variable", red: "Very red", steady: "Steady" };

function Sparkline({ trend }: { trend: Candidate["trend"] }) {
  const pts = trend.filter((t) => Number.isFinite(t.rel));
  if (pts.length < 2) return null;
  const lo = Math.min(0.8, ...pts.map((t) => t.rel));
  const hi = Math.max(1.2, ...pts.map((t) => t.rel));
  const W = 120, H = 28;
  const xy = pts.map((t, i) => [4 + (i * (W - 8)) / (pts.length - 1), H - 3 - ((t.rel - lo) / (hi - lo)) * (H - 6)]);
  const y1 = H - 3 - ((1 - lo) / (hi - lo)) * (H - 6);
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`Brightness per visit relative to the mean: ${pts.map((t) => `${t.label} ${(t.rel * 100).toFixed(0)}%`).join(", ")}`}>
      <line x1={0} x2={W} y1={y1} y2={y1} className="spark-mean" />
      <polyline points={xy.map((p) => p.join(",")).join(" ")} className="spark-line" />
      {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} className="spark-dot" />)}
    </svg>
  );
}

function Details({ c, onCentre }: { c: Candidate; onCentre: (c: Candidate) => void }) {
  const m = c.motion;
  return (
    <div className="cand-detail">
      <dl className="kv">
        <dt>Position</dt><dd className="mono">{formatRa(c.ra)} {formatDec(c.dec)}</dd>
        {m && <>
          <dt>Motion</dt>
          <dd className="mono">{(m.total / 1000).toFixed(2)} ± {(m.err / 1000).toFixed(2)}″/yr · PA {Math.round(m.pa)}° · {m.sigma.toFixed(1)}σ</dd>
          <dt>Shift</dt><dd className="mono">{m.shiftArcsec.toFixed(1)}″ over {c.visits.length} visits</dd>
          {m.parallax && <><dt>Parallax</dt><dd className="mono">≈ {m.parallax.value.toFixed(0)} ± {m.parallax.err.toFixed(0)} mas (estimate)</dd></>}
        </>}
        <dt>Seen in</dt><dd>{c.bandsSeen.length ? c.bandsSeen.join(" ") : "not measured"}{c.colour !== null ? ` · D1 − D6 = ${c.colour.toFixed(1)} mag` : ""}</dd>
        <dt>Gaia</dt>
        <dd>{c.gaia ? `DR3 ${c.gaia.id} · G ${c.gaia.g?.toFixed(1) ?? "?"}${c.gaia.pmra !== null && c.gaia.pmdec !== null
          ? ` · ${(Math.hypot(c.gaia.pmra, c.gaia.pmdec) / 1000).toFixed(2)}″/yr` : ""}` : c.gaiaComplete ? "no match within 9″" : "list incomplete here"}</dd>
      </dl>
      <Sparkline trend={c.trend} />
      <p className="note cand-why">{c.headline}</p>
      <button className="btn" onClick={() => onCentre(c)} title="Open a new field centred here: Plots then show this source's light curve and spectrum">Centre here</button>
    </div>
  );
}

export function Candidates({ result, selected, onSelect, onCentre }: Props) {
  return (
    <section className="panel cand-panel" aria-labelledby="cand-h" data-tour="candidates">
      <h2 id="cand-h" className="label">Candidates</h2>
      {!result ? <p className="note">Measuring every source once all visits are in…</p> : (
        <>
          <p className="cand-sum">
            {result.candidates.length} sources · {result.counts.moving} moving · {result.counts.variable} variable
            {result.counts.red ? ` · ${result.counts.red} very red` : ""} · {result.counts.unknown} not in Gaia
          </p>
          {result.candidates.length === 0 ? <p className="note">No sources above 5σ in this field.</p> : (
            <ul className="cand-list">
              {result.candidates.map((c) => (
                <li key={c.id} className={c.id === selected ? "open" : ""}>
                  <button className={`cand-row k-${c.kind}${c.labels.includes("Not in Gaia") ? " unknown" : ""}`}
                          aria-expanded={c.id === selected} onClick={() => onSelect(c.id === selected ? null : c.id)}>
                    <span className="cand-mark" aria-hidden="true" />
                    <span className="cand-kind">{KIND_LABEL[c.kind]}</span>
                    <span className="cand-tags">{c.labels.filter((l) => l !== KIND_LABEL[c.kind] && l !== "Moving").join(" · ")}</span>
                    <span className="cand-sig mono">{c.motion && c.kind === "moving" ? `${c.motion.sigma.toFixed(0)}σ` : `${c.snr.toFixed(0)}σ`}</span>
                  </button>
                  {c.id === selected && <Details c={c} onCentre={onCentre} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
