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
        <a href="/app" onClick={go("/app")} className="btn btn-primary">Open the tool</a>
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
