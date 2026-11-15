// Header and footer for the website pages (home, paper, team, admin). The tool keeps its own compact bar.
import { CHALLENGE_URL } from "../../lib/site";
import "../../styles/site.css";

export type SitePage = "home" | "about" | "team" | "admin";

interface Props {
  page: SitePage;
  navigate: (path: string) => void;
  children: React.ReactNode;
}

const LINKS: { page: SitePage; href: string; label: string }[] = [
  { page: "home", href: "/", label: "Home" },
  { page: "about", href: "/about", label: "About Argus" },
  { page: "team", href: "/team", label: "102 Bands" },
];

export function SiteLayout({ page, navigate, children }: Props) {
  const go = (href: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
  return (
    <div className="site">
      <a href="#main" className="sr-only">Skip to content</a>
      <header className="site-head">
        <a href="/" onClick={go("/")} aria-label="Argus home" className="site-logo">
          <img src="/ARGUS_logo_white.svg" alt="Argus" />
        </a>
        <nav aria-label="Site">
          {LINKS.map((l) => (
            <a key={l.page} href={l.href} onClick={go(l.href)} aria-current={page === l.page ? "page" : undefined}>{l.label}</a>
          ))}
          <a href={CHALLENGE_URL} target="_blank" rel="noopener" className="ext">NASA Space Apps 2026 ↗</a>
        </nav>
        <div className="site-head-actions">
          <a href="https://github.com/102-bands/argus" target="_blank" rel="noopener" className="gh-link"
             aria-label="Source code on GitHub" title="Source code on GitHub">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          <a href="/app" onClick={go("/app")} className="btn btn-primary">Open the tool</a>
        </div>
      </header>
      {children}
      <footer className="site-foot">
        <div>
          <img src="/ARGUS_logo_white.svg" alt="" className="foot-logo" />
          <p>Built by Team 102 Bands for the 2026 NASA International Space Apps Challenge, challenge “Planet X and SPHEREx”.
            Not affiliated with or endorsed by NASA.</p>
        </div>
        <nav aria-label="Footer">
          <a href="/app" onClick={go("/app")}>The tool</a>
          <a href="/about" onClick={go("/about")}>About Argus</a>
          <a href="/team" onClick={go("/team")}>102 Bands</a>
          <a href="/#contact" onClick={(e) => { e.preventDefault(); navigate("/"); setTimeout(() => document.getElementById("contact")?.scrollIntoView(), 50); }}>Contact</a>
          <a href="https://github.com/102-bands/argus" target="_blank" rel="noopener">Source code ↗</a>
        </nav>
        <p className="foot-credits">SPHEREx data: NASA/IPAC IRSA (DR1 doi:10.26131/IRSA678, QR3 doi:10.26131/IRSA662) · Gaia DR3: ESA/Gaia/DPAC · Sky maps: CDS Aladin</p>
      </footer>
    </div>
  );
}
