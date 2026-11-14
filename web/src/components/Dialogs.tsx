import { useEffect, useRef, useState } from "react";
import { track } from "../lib/analytics";
import type { GifInput } from "../lib/gif";
import type { ReportInput } from "../lib/report";

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

export interface ShareSources {
  /** Null until every frame is in (the report and GIF need all visits). */
  report: Omit<ReportInput, "onProgress"> | null;
  gif: GifInput | null;
}

const EMBED_SIZES = { small: [480, 560], large: [720, 820] } as const;

export function ShareDialog({ onClose, sources }: { onClose: () => void; sources: ShareSources }) {
  const url = window.location.href;
  // Keep the preset in the embed path (/embed/t/<id>): without it the embed showed the default field.
  const path = window.location.pathname.startsWith("/t/") ? window.location.pathname : "";
  const [tab, setTab] = useState<"embed" | "download">("embed");
  const [embedSize, setEmbedSize] = useState<keyof typeof EMBED_SIZES>("small");
  const [w, h] = EMBED_SIZES[embedSize];
  const embed = `${window.location.origin}/embed${path}${window.location.search || ""}`;
  const snippet = `<iframe src="${embed}" width="${w}" height="${h}" style="border:0;max-width:100%" title="Argus SPHEREx viewer" loading="lazy"></iframe>`;
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      track(what === "link" ? "share_link" : "embed_copy");
    } catch {
      setCopied(`${what}-failed`);
    }
  };
  const nativeShare = typeof navigator.share === "function";
  const run = async (what: "pdf" | "gif") => {
    setError(null);
    setBusy(what === "pdf" ? "Building the report" : "Building the animation");
    try {
      if (what === "pdf" && sources.report) {
        const { buildReport } = await import("../lib/report");
        await buildReport({ ...sources.report, onProgress: (m) => setBusy(`Report: ${m.toLowerCase()}`) });
        track("report_download", { frames: sources.report.frames.length });
      } else if (what === "gif" && sources.gif) {
        const { buildGif } = await import("../lib/gif");
        await buildGif(sources.gif);
        track("gif_download", { frames: sources.gif.frames.length, mode: sources.gif.mode });
      }
    } catch (e) {
      setError(`Couldn't build the ${what === "pdf" ? "report" : "animation"}: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(null);
    }
  };
  const notReady = !sources.report;
  return (
    <Dialog title="Share this view" onClose={onClose}>
      <p className="note">The link opens exactly this field, band, mode, stretch and view.</p>
      <input readOnly value={url} aria-label="Link to this view" onFocus={(e) => e.target.select()} />
      <div className="share-row">
        <button className="btn" onClick={() => copy(url, "link")}>{copied === "link" ? "Copied" : "Copy link"}</button>
        {nativeShare && (
          <button className="btn" onClick={() => navigator.share({ title: "Argus", text: document.title, url }).then(() => track("share_native")).catch(() => undefined)}>
            Share…
          </button>
        )}
        {copied === "link-failed" && <span className="note">Copying is blocked here; select the link and press Ctrl+C.</span>}
      </div>

      <div className="seg fill share-tabs" role="tablist" aria-label="Share options">
        <button className="btn" role="tab" aria-selected={tab === "embed"} aria-pressed={tab === "embed"} onClick={() => setTab("embed")}>Embed</button>
        <button className="btn" role="tab" aria-selected={tab === "download"} aria-pressed={tab === "download"} onClick={() => setTab("download")}>Download</button>
      </div>

      {tab === "embed" ? (
        <div role="tabpanel" aria-label="Embed">
          <p className="note">Put this viewer on a website or class page. Visitors can play it and open it in Argus.</p>
          <div className="share-row">
            <span className="label">Size</span>
            <div className="seg">
              {(Object.keys(EMBED_SIZES) as (keyof typeof EMBED_SIZES)[]).map((k) => (
                <button key={k} className="btn" aria-pressed={embedSize === k} onClick={() => setEmbedSize(k)}>
                  {k} ({EMBED_SIZES[k][0]}×{EMBED_SIZES[k][1]})
                </button>
              ))}
            </div>
          </div>
          <textarea readOnly rows={3} value={snippet} aria-label="Embed code" onFocus={(e) => e.target.select()} />
          <div className="share-row">
            <button className="btn" onClick={() => copy(snippet, "embed")}>{copied === "embed" ? "Copied" : "Copy embed code"}</button>
            {copied === "embed-failed" && <span className="note">Copying is blocked here; select the code and press Ctrl+C.</span>}
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label="Download">
          {notReady && <p className="note">Downloads unlock when processing finishes and every visit is in.</p>}
          <div className="share-item">
            <div>
              <strong>Report (PDF)</strong>
              <p className="note">A4 technical report: the stacked image, every visit on a timeline with what changed,
                the light curve and spectrum, and how the data were made.</p>
            </div>
            <button className="btn" disabled={notReady || !!busy} onClick={() => run("pdf")}>Download PDF</button>
          </div>
          <div className="share-item">
            <div>
              <strong>Animation (GIF)</strong>
              <p className="note">The {sources.gif?.mode === "diff" ? "difference" : "blink"} animation, 480 px, with the date on each frame.</p>
            </div>
            <button className="btn" disabled={notReady || !sources.gif || !!busy} onClick={() => run("gif")}>Download GIF</button>
          </div>
          {busy && <p className="note" role="status">{busy}<span className="dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span></p>}
          {error && <p className="note warn" role="alert">{error}</p>}
        </div>
      )}
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
    ["P", "Switch between the image and the plots"],
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
