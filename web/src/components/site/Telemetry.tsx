// Live counters, styled as an instrument readout. Counts up once when it scrolls into view.
import { useEffect, useRef, useState } from "react";
import { fetchStats, type Stats } from "../../lib/site";

const ROWS: { key: keyof Omit<Stats, "since">; label: string; note: string }[] = [
  { key: "fields_analysed", label: "Fields analysed", note: "every time someone opens a patch of sky and it finishes loading" },
  { key: "live_searches", label: "Live searches", note: "new positions built from the NASA archive on our server" },
  { key: "exposures_processed", label: "Exposures processed", note: "SPHEREx images read, cleaned and aligned for live searches" },
  { key: "downloads", label: "Reports and animations", note: "PDF reports and GIFs downloaded" },
  { key: "visits", label: "Visitors", note: "one per browser per day, no cookies" },
];

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function Telemetry() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  const [t, setT] = useState(0); // 0 → 1 count-up progress
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetchStats(ac.signal).then(setStats).catch(() => !ac.signal.aborted && setFailed(true));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!stats) return;
    if (reduced()) { setT(1); return; }
    const el = ref.current;
    let raf = 0;
    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const x = Math.min((now - t0) / 1400, 1);
        setT(1 - (1 - x) ** 3);
        if (x < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); run(); } }, { threshold: 0.3 });
    if (el) io.observe(el); else run();
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [stats]);

  return (
    <div className="telemetry" ref={ref} aria-live="polite">
      <div className="tm-head mono">
        <span>Argus telemetry</span>
        <span>{stats ? `since ${stats.since} · live` : failed ? "offline" : "connecting…"}</span>
      </div>
      <dl>
        {ROWS.map((r) => (
          <div key={r.key} className="tm-row" title={r.note}>
            <dt>{r.label}</dt>
            <dd className="mono">{stats ? Math.round(stats[r.key] * t).toLocaleString("en-US").padStart(7, " ") : "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="tm-note">Counted on our server as people use Argus. No personal data; hover a row to see what it counts.</p>
    </div>
  );
}
