// Website home: what Argus is, live counters, how it works, the five targets, validation, Planet X, team, contact.
import type { Target } from "../../lib/api";
import { presetPath } from "../../lib/api";
import { BlackHole } from "./BlackHole";
import { ContactForm } from "./ContactForm";
import { PlanetXAnim } from "./PlanetXAnim";
import { SiteLayout } from "./SiteLayout";
import { Telemetry } from "./Telemetry";

interface Props {
  targets: Target[];
  navigate: (path: string) => void;
}

const CHECKS: [string, string, string][] = [
  ["Barnard's Star", "all bands", "0.41 px (2.5″)"],
  ["ε Indi B", "all bands", "0.15 px (0.9″)"],
  ["WISE 0855−0714", "D6, 4.7 µm", "0.35 px (2.2″)"],
  ["RW Aur", "all bands", "steady, 0.19 px"],
  ["R Dra", "all bands", "steady, 0.38 px"],
];

export function Home({ targets, navigate }: Props) {
  const go = (href: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
  return (
    <SiteLayout page="home" navigate={navigate}>
      <main id="main">
        <section className="hero">
          <div className="hero-text">
            <p className="kicker">NASA SPHEREx · 0.75–5 µm · the whole sky every six months</p>
            <h1>Watch the infrared sky change.</h1>
            <p className="lede">
              Every six months NASA's SPHEREx telescope photographs the entire sky in 102 infrared colours. Argus lines
              those visits up for any spot you choose and plays them back, so you can watch nearby stars drift, cold
              brown dwarfs glow at long wavelengths and variable stars brighten and fade, with every motion checked
              against ESA's Gaia.
            </p>
            <div className="hero-cta">
              <a href="/app" onClick={go("/app")} className="btn btn-primary btn-lg">Open the tool</a>
              <a href="/about" onClick={go("/about")} className="btn btn-lg">Read the paper</a>
            </div>
            <p className="hero-meta mono">Free · no sign-up · works on phones · open source</p>
          </div>
          <div className="hero-view">
            <BlackHole />
          </div>
        </section>

        <section className="band telemetry-band" aria-labelledby="tm-h">
          <h2 id="tm-h" className="sr-only">Argus so far</h2>
          <Telemetry />
        </section>

        <section className="band" aria-labelledby="how-h">
          <h2 id="how-h">How it works</h2>
          <ol className="steps">
            <li>
              <h3>Ask the archive</h3>
              <p>Type a position or a star's name. Argus asks NASA's Infrared Science Archive which SPHEREx exposures
                cover it, and reads only the pixels it needs from the open cloud copy.</p>
            </li>
            <li>
              <h3>Line everything up</h3>
              <p>It removes the zodiacal glow, masks bad pixels, puts every exposure on one 6.15″ grid with north up,
                and stacks each visit, about 20 seconds for a new field.</p>
            </li>
            <li>
              <h3>Blink and check</h3>
              <p>Flip between visits, subtract them to see what changed, read the light curve and spectrum, and
                compare every motion with where Gaia says each star should be.</p>
            </li>
          </ol>
        </section>

        <section className="band" aria-labelledby="tg-h">
          <div className="band-head">
            <h2 id="tg-h">Five targets to start with</h2>
            <p>Each opens instantly, even when the archive is busy.</p>
          </div>
          <ul className="targets">
            {targets.map((t) => (
              <li key={t.id}>
                <a href={presetPath(t)} onClick={go(presetPath(t))}>
                  <img src={`/site/preset-${t.id}.jpg`} alt="" loading="lazy" width={240} height={240} />
                  <strong>{t.name}</strong>
                  <span>{t.notes.split(/[.:]/)[0]}.</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="band split" aria-labelledby="val-h">
          <div>
            <h2 id="val-h">Checked against Gaia</h2>
            <p>For every target, Argus measures where the star actually is on each visit and compares it with the
              position ESA's Gaia catalogue predicts for that date. Every one agrees to within half a SPHEREx pixel.</p>
            <a href="/about#validation" onClick={go("/about")} className="textlink">How we measured it →</a>
          </div>
          <table className="val-table">
            <thead><tr><th>Target</th><th>Band</th><th>Worst offset</th></tr></thead>
            <tbody>
              {CHECKS.map(([n, b, o]) => <tr key={n}><td>{n}</td><td>{b}</td><td className="mono">✓ {o}</td></tr>)}
            </tbody>
          </table>
        </section>

        <section className="band split" aria-labelledby="px-h2">
          <div>
            <h2 id="px-h2">The Planet X question</h2>
            <p>Planet X is a hypothesis: an unseen planet far beyond Neptune. Argus can't find it, since it would be
              about three magnitudes fainter than one SPHEREx visit can see. What it can do is show how the hunt works:
              a distant planet gives itself away by jumping between visits as Earth moves around the Sun. Turn on the
              Planet X overlay in the tool to draw that jump on real SPHEREx images.</p>
            <a href="/t/barnard?mode=diff&px=500" onClick={go("/t/barnard?mode=diff&px=500")} className="textlink">Try it on Barnard's Star →</a>
          </div>
          <PlanetXAnim />
        </section>

        <section className="band split" aria-labelledby="team-h">
          <div>
            <h2 id="team-h">Made by 102 Bands</h2>
            <p>Umair Zia (data pipeline, web app) and Aliki Vidouri (astrophysics, science and outreach), two students who
              built Argus for the 2026 NASA International Space Apps Challenge.</p>
            <a href="/team" onClick={go("/team")} className="textlink">Meet the team →</a>
          </div>
          <div className="team-chips">
            <span className="chip"><b>UZ</b> Umair Zia</span>
            <span className="chip"><b>AV</b> Aliki Vidouri</span>
          </div>
        </section>

        <section className="band contact" id="contact" aria-labelledby="contact-h">
          <div className="band-head">
            <h2 id="contact-h">Contact us</h2>
            <p>Questions, feedback, a bug, or an idea for a target? Write to us; we read every message.</p>
          </div>
          <ContactForm />
        </section>
      </main>
    </SiteLayout>
  );
}
