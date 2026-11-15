// Right-rail panel: the preset target measured on every visit against Gaia's predicted position.
import { MIN_EXP, PASS_PX, pxToArcsec, shortSummary, summary, type MotionCheck } from "../lib/validate";

export function GaiaCheck({ check, band }: { check: MotionCheck; band: string }) {
  const ok = check.detected >= 2;
  return (
    <section className="panel" aria-labelledby="gaia-h" data-tour="gaiacheck">
      <h2 id="gaia-h" className="label">Checked against Gaia</h2>
      <p className={`check-sum ${ok ? (check.pass ? "pass" : "fail") : ""}`}>
        {ok && <span className="mark" aria-hidden="true">{check.pass ? "✓" : "!"}</span>}
        {ok ? shortSummary(check) : summary(check, band)}
      </p>
      {ok && (
        <details className="check-more">
          <summary>Per-visit offsets</summary>
          <table className="check-table">
          <thead><tr><th>Visit</th><th>Offset</th><th aria-label="Within 0.5 px" /></tr></thead>
          <tbody>
            {check.visits.map((v) => (
              <tr key={v.epochLabel} className={v.counted ? "" : "muted"}>
                <td>{v.epochLabel}</td>
                <td>{v.detected && v.offsetPx !== null ? `${pxToArcsec(v.offsetPx).toFixed(1)}″` : "not seen"}</td>
                <td>{!v.detected || v.offsetPx === null ? "–" : !v.counted ? `${v.nExp} exp` : v.offsetPx <= PASS_PX ? "✓" : "✗"}</td>
              </tr>
            ))}
          </tbody>
          </table>
          <p className="note check-note">Centre of light vs ESA Gaia DR3 moved to each date. Pass: within 0.5 px (3.1″) on visits with {MIN_EXP}+ exposures.</p>
        </details>
      )}
    </section>
  );
}
