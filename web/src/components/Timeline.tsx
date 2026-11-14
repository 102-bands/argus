import type { Epoch } from "../lib/api";

interface Props {
  epochs: Epoch[];
  loaded: Set<number>;
  current: number | null;
  refEpoch: number | null;
  showRef: boolean;
  onSelect: (epochId: number) => void;
  onRef: (epochId: number) => void;
}

export function Timeline({ epochs, loaded, current, refEpoch, showRef, onSelect, onRef }: Props) {
  if (!epochs.length) return null;
  return (
    <div className="timeline">
      <span className="label">Timeline · {epochs.length} visits{showRef ? " · shift-click sets the reference" : ""}</span>
      <ol>
        {epochs.map((e) => {
          const n = Object.values(e.n_by_detector).reduce((a, b) => a + b, 0);
          const cls = [loaded.has(e.id) ? "loaded" : "", current === e.id ? "current" : "", showRef && refEpoch === e.id ? "ref" : ""].join(" ");
          return (
            <li key={e.id} className={cls}>
              <button
                onClick={(ev) => (ev.shiftKey && showRef ? onRef(e.id) : onSelect(e.id))}
                aria-label={`${e.label}, ${n} exposures${current === e.id ? ", showing" : ""}${loaded.has(e.id) ? "" : ", loading"}`}
                aria-current={current === e.id}
                disabled={!loaded.has(e.id)}
              >
                <span className="dot" />
                <span className="t">{e.label}</span>
                <span className="n">{n} exp</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
