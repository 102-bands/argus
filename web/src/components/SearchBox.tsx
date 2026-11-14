import { useMemo, useState } from "react";
import type { Target } from "../lib/api";
import { parseCoords } from "../lib/physics";
import { round1, track } from "../lib/analytics";

interface Props {
  targets: Target[];
  onCoords: (ra: number, dec: number) => void;
  onPreset: (id: string) => void;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9ε]/g, "").replace("eps", "ε");

function score(t: Target, q: string): number {
  const nq = norm(q);
  if (!nq) return 0;
  const hay = [norm(t.name), norm(t.id), norm(t.name.replace("ε", "epsilon"))];
  if (hay.some((h) => h.startsWith(nq))) return 3;
  if (hay.some((h) => h.includes(nq))) return 2;
  // Loose subsequence match ("brnrd" → Barnard's Star).
  const h = hay[0];
  let i = 0;
  for (const ch of h) if (ch === nq[i]) i++;
  return i === nq.length ? 1 : 0;
}

export function SearchBox({ targets, onCoords, onPreset }: Props) {
  const [q, setQ] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);

  const matches = useMemo(
    () => targets.map((t) => [t, score(t, q)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([t]) => t),
    [targets, q],
  );

  const submit = () => {
    const c = parseCoords(q);
    if (c) {
      track("search", { kind: "coords", ra_r: round1(c.ra), dec_r: round1(c.dec) });
      setHint(null);
      setOpen(false);
      onCoords(c.ra, c.dec);
      return;
    }
    const m = matches[sel] ?? matches[0];
    if (m) {
      track("search", { kind: "preset" });
      setHint(null);
      setOpen(false);
      setQ(m.name);
      onPreset(m.id);
      return;
    }
    track("search", { kind: "invalid" });
    setHint("Try “269.45 4.77”, “08h55m10.8s −07d14m42s” or a preset name such as “Barnard”.");
  };

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="q" className="sr-only">Sky position or target name</label>
      <input
        id="q"
        value={q}
        placeholder="RA Dec (e.g. 08h55m10.8s −07d14m42s) or a name like “Barnard”"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={hint ? "true" : "false"}
        aria-describedby={hint ? "q-hint" : undefined}
        aria-expanded={open && matches.length > 0}
        aria-controls="q-list"
        role="combobox"
        onChange={(e) => {
          setQ(e.target.value);
          setHint(null);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { setSel((s) => Math.min(s + 1, matches.length - 1)); e.preventDefault(); }
          if (e.key === "ArrowUp") { setSel((s) => Math.max(s - 1, 0)); e.preventDefault(); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && q && matches.length > 0 && !parseCoords(q) && (
        <ul id="q-list" role="listbox">
          {matches.map((t, i) => (
            <li key={t.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(t.name); setOpen(false); onPreset(t.id); }}>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint && <div id="q-hint" className="hint" role="status">{hint}</div>}
    </form>
  );
}
