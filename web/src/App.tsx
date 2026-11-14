import { useCallback, useEffect, useState } from "react";
import type { Target } from "./lib/api";
import { loadPresetIndex } from "./lib/api";
import { track } from "./lib/analytics";
import { SearchBox } from "./components/SearchBox";
import { Explorer } from "./components/Explorer";
import { About } from "./components/About";

type Route = { kind: "explore"; presetId: string | null } | { kind: "about" } | { kind: "embed"; presetId: string | null };

function parseRoute(path: string): Route {
  if (path === "/about") return { kind: "about" };
  const embed = path.startsWith("/embed");
  const m = /\/t\/([a-z0-9-]+)\/?$/.exec(path);
  return { kind: embed ? "embed" : "explore", presetId: m ? m[1] : null };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [targets, setTargets] = useState<Target[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    loadPresetIndex().then(setTargets).catch(() => setTargets([]));
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (route.kind === "embed") {
      let host = "direct";
      try {
        host = document.referrer ? new URL(document.referrer).hostname : "direct";
      } catch {
        // keep "direct"
      }
      track("embed_view", { referrer_host: host });
    }
  }, [route.kind]);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setRoute(parseRoute(window.location.pathname));
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, []);

  if (route.kind === "embed") {
    return <Explorer presetId={route.presetId} targets={targets} embed navigate={navigate} shareOpen={false} onShareClose={() => undefined} />;
  }

  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      <header className="topbar">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} aria-label="Argus home">
          <img src="/ARGUS_logo_white.svg" alt="Argus" className="logo" />
        </a>
        {route.kind === "explore" && (
          <SearchBox
            targets={targets}
            onCoords={(ra, dec) => navigate(`/?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}`)}
            onPreset={(id) => {
              const t = targets.find((x) => x.id === id);
              track("preset_click", { target: id });
              navigate(`/t/${id}${t && t.band !== "all" ? `?band=${t.band}` : ""}`);
            }}
          />
        )}
        <nav>
          {route.kind === "explore" && <button className="btn" onClick={() => setShareOpen(true)}>Share</button>}
          <a href="/about" onClick={(e) => { e.preventDefault(); navigate("/about"); }}>About</a>
        </nav>
      </header>
      {route.kind === "about" ? (
        <About />
      ) : (
        <Explorer presetId={route.presetId} targets={targets} embed={false} navigate={navigate}
                  shareOpen={shareOpen} onShareClose={() => setShareOpen(false)} />
      )}
      <footer className="footer">
        <span>Built for the 2026 NASA International Space Apps Challenge. Not affiliated with or endorsed by NASA.</span>
        <span>SPHEREx data: NASA/IPAC IRSA · Gaia DR3: ESA</span>
        <a href="/about">Credits, AI use and privacy</a>
      </footer>
    </div>
  );
}
