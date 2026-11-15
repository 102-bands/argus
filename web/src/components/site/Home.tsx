// Website home: what Argus is, live counters, how it works, each feature with its own animation, the five targets, team, contact.
import type { Target } from "../../lib/api";
import { presetPath } from "../../lib/api";
import { BlackHole } from "./BlackHole";
import { ContactForm } from "./ContactForm";
import { BandsAnim } from "./anim/BandsAnim";
import { BlinkAnim } from "./anim/BlinkAnim";
import { DiffAnim } from "./anim/DiffAnim";
import { FinderAnim } from "./anim/FinderAnim";
import { GaiaAnim } from "./anim/GaiaAnim";
import { PlotsAnim } from "./anim/PlotsAnim";
import { StackAnim } from "./anim/StackAnim";
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

interface Feature {
  id: string;
  title: string;
  text: string;
  link: [string, string];
  anim: React.ReactNode;
}

const FEATURES: Feature[] = [
  { id: "blink", title: "Blink between visits",
    text: "Argus plays the visits of one patch of sky like a flipbook, every frame on the same grid with north up. "
        + "Distant stars hold still, so anything close enough to move jumps out.",
    link: ["/t/barnard", "Blink Barnard's Star"], anim: <BlinkAnim /> },
  { id: "diff", title: "Subtract to see only what changed",
    text: "Diff mode takes one visit away from another. Everything steady cancels out and only the change is left, "
        + "in two colours you can read at a glance.",
    link: ["/t/barnard?mode=diff", "Try diff mode"], anim: <DiffAnim /> },
  { id: "stack", title: "Stack to go deeper",
    text: "Stack mode adds every exposure together. Noise averages away and sources too faint for a single "
        + "exposure come through.",
    link: ["/t/barnard?mode=stack", "Try stack mode"], anim: <StackAnim /> },
  { id: "bands", title: "Six infrared bands",
    text: "Pick a detector band from D1 (0.75 µm) to D6 (5 µm), or add them all. The coldest objects only show up "
        + "at the long-wavelength end.",
    link: ["/t/wise-0855?size=3&band=D6", "See WISE 0855 in D6"], anim: <BandsAnim /> },
  { id: "finds", title: "Finds, measured for you",
    text: "Once a field has loaded, Argus measures every source on every visit in your browser and labels what is "
        + "moving, variable or unusually red.",
    link: ["/t/wise-0855?size=3", "See what it finds"], anim: <FinderAnim /> },
  { id: "plots", title: "Light curves and spectra",
    text: "The Plots view turns the source at the centre into numbers: its brightness on each visit and its "
        + "spectrum across SPHEREx's 102 colours.",
    link: ["/t/rw-aur?view=plots", "Plot RW Aurigae"], anim: <PlotsAnim /> },
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
              <a href="https://youtu.be/6nosbx6FoFc" target="_blank" rel="noopener" className="btn btn-lg">Watch the 30-second demo ↗</a>
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
              <p>Argus measures every source on every visit and flags what moves, what varies and what is unusually red,
                then checks each one against Gaia. Flip between visits and read the light curve and spectrum yourself.</p>
            </li>
          </ol>
        </section>

        <section className="band feat-intro" aria-labelledby="feat-h">
          <div className="band-head">
            <h2 id="feat-h">What Argus shows you</h2>
            <p>Each of these is one button in the tool. Here's what it does.</p>
          </div>
        </section>
        {FEATURES.map((f, i) => (
          <section key={f.id} className={i % 2 ? "band split feat flip" : "band split feat"} aria-labelledby={`f-${f.id}`}>
            <div>
              <h2 id={`f-${f.id}`}>{f.title}</h2>
              <p>{f.text}</p>
              <a href={f.link[0]} onClick={go(f.link[0])} className="textlink">{f.link[1]} →</a>
            </div>
            {f.anim}
          </section>
        ))}

        <section className="band split feat" aria-labelledby="val-h">
          <div>
            <h2 id="val-h">Checked against Gaia</h2>
            <p>For every target, Argus measures where the star actually is on each visit and compares it with the
              position ESA's Gaia catalogue predicts for that date. Every one agrees to within half a SPHEREx pixel.</p>
            <table className="val-table">
              <thead><tr><th>Target</th><th>Band</th><th>Worst offset</th></tr></thead>
              <tbody>
                {CHECKS.map(([n, b, o]) => <tr key={n}><td>{n}</td><td>{b}</td><td className="mono">✓ {o}</td></tr>)}
              </tbody>
            </table>
            <a href="/about#validation" onClick={go("/about")} className="textlink">How we measured it →</a>
          </div>
          <GaiaAnim />
        </section>

        <section className="band split feat flip" aria-labelledby="px-h2">
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
