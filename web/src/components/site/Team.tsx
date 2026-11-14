// 102 Bands: who built Argus. Public profile facts only (no phone numbers or personal emails).
import { SiteLayout } from "./SiteLayout";

interface Props {
  navigate: (path: string) => void;
}

interface Person {
  initials: string;
  name: string;
  role: string;
  study: string;
  bio: string;
  highlights: string[];
  links: [string, string][];
}

const TEAM: Person[] = [
  {
    initials: "UZ",
    name: "Umair Zia",
    role: "Team lead · data pipeline and web app",
    study: "BS Computer Science, PMAS-Arid Agriculture University Rawalpindi (expected 2029) · Islamabad, Pakistan",
    bio: "Machine-learning engineer and researcher who likes turning big open datasets into tools people can use. "
       + "For Argus he built the SPHEREx pipeline, the live server and the web app.",
    highlights: [
      "Founder and research scientist at Xin, working on world models",
      "AI research engineer intern at WaySel: cut LLM agent token use by 28–54%",
      "CANOPY, a satellite deforestation pipeline (Sentinel-1/2, Gemma 4 Good Hackathon)",
      "Kaggle Datasets Expert, top 2.2% worldwide; author of the swift-eda Python library",
    ],
    links: [["LinkedIn", "https://www.linkedin.com/in/yuozhe"], ["GitHub", "https://github.com/UZi-Senpai"],
            ["Kaggle", "https://www.kaggle.com/stealthtechnologies"]],
  },
  {
    initials: "AV",
    name: "Aliki Vidouri",
    role: "Astrophysics · science and outreach",
    study: "Boston College, class of 2031 · Astrophysics major, Space Engineering minor",
    bio: "Astrophysics student with hands-on space engineering projects, from satellite tracking antennas to "
       + "drone software. For Argus she shaped the science story and how it is explained to everyone.",
    highlights: [
      "Space plasma programme at the Academy of Athens' Center for Space Research & Technology, mentored by Dr. Stamatios Krimigis and Dr. Kostas Dialynas",
      "Harvard ASTR S-80: Planets, Moons, and the Search for Life",
      "OrbitTrack: a ground antenna that follows satellites in real time from orbital data",
      "Software manager at Hermis Drones; WRO Hellas robotics, 7th place nationally",
    ],
    links: [["LinkedIn", "https://www.linkedin.com/in/aliki-vidouri-6b346a26a/"]],
  },
];

export function Team({ navigate }: Props) {
  return (
    <SiteLayout page="team" navigate={navigate}>
      <main id="main" className="team-page">
        <header className="page-head">
          <h1>102 Bands</h1>
          <p className="lede">
            Named after SPHEREx's 102 infrared colours. Two students from Pakistan and Greece who built Argus for the
            2026 NASA International Space Apps Challenge.
          </p>
        </header>
        <div className="people">
          {TEAM.map((p) => (
            <article key={p.name} className="person">
              <div className="badge-initials" aria-hidden="true">{p.initials}</div>
              <h2>{p.name}</h2>
              <p className="role">{p.role}</p>
              <p className="study">{p.study}</p>
              <p>{p.bio}</p>
              <ul>{p.highlights.map((h) => <li key={h}>{h}</li>)}</ul>
              <p className="links">{p.links.map(([l, u]) => <a key={l} href={u} target="_blank" rel="noopener">{l} ↗</a>)}</p>
            </article>
          ))}
        </div>
      </main>
    </SiteLayout>
  );
}
