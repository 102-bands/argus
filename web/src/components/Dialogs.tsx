import { useEffect, useRef, useState } from "react";
import { track } from "../lib/analytics";

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-h" tabIndex={-1} ref={ref}
           onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-h">{title}</h2>
        {children}
        <p><button className="btn" onClick={onClose}>Close</button></p>
      </div>
    </div>
  );
}

export function ShareDialog({ onClose }: { onClose: () => void }) {
  const url = window.location.href;
  const embed = `${window.location.origin}/embed${window.location.search || ""}`;
  const snippet = `<iframe src="${embed}" width="480" height="560" style="border:0" title="Argus SPHEREx viewer" loading="lazy"></iframe>`;
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      track(what === "link" ? "share_link" : "embed_copy");
    } catch {
      setCopied(null);
    }
  };
  return (
    <Dialog title="Share this view" onClose={onClose}>
      <p className="note">The link reproduces exactly this field, band, mode and stretch.</p>
      <input readOnly value={url} aria-label="Link to this view" onFocus={(e) => e.target.select()} />
      <p><button className="btn" onClick={() => copy(url, "link")}>{copied === "link" ? "Copied" : "Copy link"}</button></p>
      <p className="note">Embed it on your site:</p>
      <textarea readOnly rows={3} value={snippet} aria-label="Embed code" onFocus={(e) => e.target.select()} />
      <p><button className="btn" onClick={() => copy(snippet, "embed")}>{copied === "embed" ? "Copied" : "Copy embed code"}</button></p>
    </Dialog>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const keys: [string, string][] = [
    ["Space", "Play or pause"],
    ["← →", "Previous or next frame"],
    ["D", "Toggle difference mode"],
    ["G", "Toggle Gaia predictions"],
    ["F", "Toggle the flags overlay"],
    ["1 – 6", "Show one detector (D1 to D6)"],
    ["0", "All detectors"],
    ["+ / −", "Faster or slower"],
    ["?", "This help"],
  ];
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <div className="keys">
        {keys.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </div>
        ))}
      </div>
      <p className="note">
        How to read it: every frame is one visit of SPHEREx to this spot, with all its exposures added together.
        A star that moves jumps between frames. In difference mode, a mover becomes a magenta/cyan pair; the line
        from magenta to cyan is its direction.
      </p>
    </Dialog>
  );
}
