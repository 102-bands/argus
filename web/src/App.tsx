import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { Target } from "./lib/api";
import { loadPresetIndex, presetPath } from "./lib/api";
import { track } from "./lib/analytics";
import { countVisitOncePerDay } from "./lib/site";
import { SearchBox } from "./components/SearchBox";
import { Explorer } from "./components/Explorer";

// Website pages load on demand so the tool's first load stays small.
const Home = lazy(() => import("./components/site/Home").then((m) => ({ default: m.Home })));
const Paper = lazy(() => import("./components/site/Paper").then((m) => ({ default: m.Paper })));
const Team = lazy(() => import("./components/site/Team").then((m) => ({ default: m.Team })));
const Admin = lazy(() => import("./components/site/Admin").then((m) => ({ default: m.Admin })));

type Route =
  | { kind: "home" }
  | { kind: "explore"; presetId: string | null }
  | { kind: "embed"; presetId: string | null }
  | { kind: "about" }
  | { kind: "team" }
  | { kind: "admin" };

function parseRoute(path: string): Route {
  if (path === "/about") return { kind: "about" };
  if (path === "/team") return { kind: "team" };
  if (path === "/admin") return { kind: "admin" };
  const m = /\/t\/([a-z0-9-]+)\/?$/.exec(path);
  if (path.startsWith("/embed")) return { kind: "embed", presetId: m ? m[1] : null };
  if (m) return { kind: "explore", presetId: m[1] };
  if (path === "/app" || path === "/app/") return { kind: "explore", presetId: null };
  return { kind: "home" };
}

/** Links shared before the website existed opened the tool at /?ra=..&dec=..; send them to /app. */
function legacyRedirect(): void {
  const p = new URLSearchParams(window.location.search);
  if (window.location.pathname === "/" && p.has("ra") && p.has("dec")) {
    window.history.replaceState(null, "", `/app${window.location.search}`);
  }
}

export function App() {
  const [route, setRoute] = useState<Route>(() => { legacyRedirect(); return parseRoute(window.location.pathname); });
  const [targets, setTargets] = useState<Target[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [tourToken, setTourToken] = useState(0);

  useEffect(() => {
    loadPresetIndex().then(setTargets).catch(() => setTargets([]));
    countVisitOncePerDay();
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

  if (route.kind !== "explore") {
    return (
      <Suspense fallback={<div className="site-loading" aria-busy="true" />}>
        {route.kind === "home" && <Home targets={targets} navigate={navigate} />}
        {route.kind === "about" && <Paper navigate={navigate} />}
        {route.kind === "team" && <Team navigate={navigate} />}
        {route.kind === "admin" && <Admin navigate={navigate} />}
      </Suspense>
    );
  }

  return (
    <div className="app">
      <a href="#main" className="sr-only">Skip to content</a>
      <header className="topbar">
        <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} aria-label="Argus home">
          <img src="/ARGUS_logo_white.svg" alt="Argus" className="logo" />
        </a>
        <div data-tour="search" className="search-slot">
          <SearchBox
            targets={targets}
            onCoords={(ra, dec) => navigate(`/app?ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}`)}
            onPreset={(id) => {
              const t = targets.find((x) => x.id === id);
              track("preset_click", { target: id });
              navigate(t ? presetPath(t) : `/t/${id}`);
            }}
          />
        </div>
        <nav>
          <button className="btn" onClick={() => setTourToken((t) => t + 1)} title="A guided walk through every part of the tool">Tour</button>
          <button className="btn" data-tour="share" onClick={() => setShareOpen(true)}>Share</button>
          <a href="/about" onClick={(e) => { e.preventDefault(); navigate("/about"); }}>About</a>
        </nav>
      </header>
      <Explorer presetId={route.presetId} targets={targets} embed={false} navigate={navigate}
                shareOpen={shareOpen} onShareClose={() => setShareOpen(false)} tourToken={tourToken} />
      <footer className="footer">
        <span>Built for the 2026 NASA International Space Apps Challenge. Not affiliated with or endorsed by NASA.</span>
        <span>SPHEREx data: NASA/IPAC IRSA · Gaia DR3: ESA</span>
        <a href="/about">Credits, AI use and privacy</a>
      </footer>
    </div>
  );
}
